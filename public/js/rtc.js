/* Malha WebRTC: cada participante conecta direto com cada outro.
 *
 * O servidor só repassa oferta/resposta/candidatos. Nada de mídia passa por
 * ele. Bom até umas 6–8 pessoas; acima disso o upload de quem transmite vira
 * o gargalo (ele manda uma cópia do vídeo pra cada um).
 *
 * A negociação usa o padrão "perfect negotiation": quando os dois lados
 * renegociam ao mesmo tempo (ex.: os dois ligam o mic juntos), um dos dois
 * cede em vez de a conexão travar em estado inválido.
 */

let socket = null;
let iceServers = [{ urls: 'stun:stun.l.google.com:19302' }];
let aoMudar = () => {};


/** sid -> { sid, nome, pc, polite, midias, meta, tela, mic, conexao } */
export const peers = new Map();

export const eu = { sid: null, nome: '', sala: '', tela: false, mic: false, somDaTela: false };

let telaStream = null;      // vídeo da tela (+ áudio da aba/sistema, se houver)
let micStream = null;       // áudio do microfone
let somTelaStream = null;   // áudio do aplicativo compartilhado, vindo do app de mesa
let somContexto = null;     // AudioContext do caminho PCM (macOS e Windows)
let somCancelar = null;     // encerra a assinatura dos blocos de PCM

/* Qualidade da tela: quem compartilha escolhe resolução e fps por separado
   antes de começar. Duas peças, cada uma resolvendo um problema diferente:
   -  width/height no getDisplayMedia é só um pedido "ideal" — a maioria dos
      navegadores IGNORA isso pra captura de tela e pega a resolução nativa
      de qualquer jeito. Por isso a resolução escolhida não fazia diferença
      nenhuma antes (só o fps mudava, porque frameRate é respeitado).
   -  scaleResolutionDownBy no RTCRtpSender não é um pedido: é o encoder do
      WebRTC reduzindo a imagem que ele manda, então funciona de verdade
      não importa o que o navegador decidiu capturar. É isso que agora força
      a resolução escolhida a valer.
   O bitrate é o que mais importa pra nitidez dentro da resolução já
   reduzida — sem um teto explícito o WebRTC negocia algo pensado pra webcam,
   bem menos que isso — e depende dos dois: mais fps custa mais bits pra
   manter a mesma nitidez, daí a tabela em vez de um valor por resolução. O
   custo é upload: cada pessoa assistindo consome até esse tanto de quem
   transmite (ex.: 6 pessoas em 720p/30fps = 6 * 1,5 Mbps = 9 Mbps). Padrão
   é 720p: em teste real com upload comum, 1080p e 1440p ficaram piores que
   720p — o upload não aguenta o bitrate mais alto que essas resoluções
   pedem, e a imagem sofre mais com isso do que ganharia em nitidez.

   E 30 fps, não 60. Tela não é vídeo: o que se compartilha fica parado a
   maior parte do tempo e o que importa é o texto legível, não a fluidez.
   Ninguém do ramo usa 60 aqui — o Discord entrega 30, e a referência técnica
   de compartilhamento de tela mede a 10. O custo de 60 é dobrado ou
   sextuplicado em codificação, e aqui isso multiplica de novo por espectador,
   porque a malha codifica a mesma tela uma vez para cada pessoa. 60 continua
   na lista para quem mostra jogo e aceita pagar. */
const RESOLUCOES_TELA = {
  '1440p': { largura: 2560, altura: 1440 },
  '1080p': { largura: 1920, altura: 1080 },
  '720p':  { largura: 1280, altura: 720 },
};

const BITRATE_TELA = {
  '1440p': { 60: 12_000_000, 30: 8_000_000, 15: 5_000_000 },
  '1080p': { 60: 6_000_000, 30: 4_000_000, 15: 2_500_000 },
  '720p':  { 60: 2_500_000, 30: 1_500_000, 15: 1_000_000 },
};

// mesma combinação do default de alternarTela/mudarQualidadeTela (720p/30) —
// é o teto que vale quando resolução+fps pedidos não batem com nenhuma linha
// da tabela, então tem que ser o mesmo padrão, não um valor menor à parte
const BITRATE_PADRAO = BITRATE_TELA['720p'][30];

/* O tipo de conteúdo decide DOIS parâmetros, nunca um.

   Medido na mesma cena com movimento e 3 espectadores: `detail` custou 10,2% de
   CPU entregando 1280 px de largura; `motion` custou 5,8% entregando 427. Quase
   toda a economia veio de o encoder ter derrubado a resolução — e quem autoriza
   isso é o `degradationPreference` que anda junto, não o hint. Trocar um sem o
   outro deixa escolher "jogo" e mesmo assim borrar texto, ou "texto" e engasgar
   o jogo. Por isso são um par, e não duas opções. */
const CONTEUDO_TELA = {
  texto: { hint: 'detail', degradacao: 'maintain-resolution' },
  jogo:  { hint: 'motion', degradacao: 'maintain-framerate' },
};
const CONTEUDO_PADRAO = 'texto';

let bitrateTela = BITRATE_PADRAO;
let escalaTela = 1;
let resolucaoAtual = '720p';
let conteudoAtual = CONTEUDO_PADRAO;

/* Quanto reduzir em relação ao que o navegador REALMENTE capturou — não ao
   que foi pedido, já que os dois podem ser bem diferentes. Nunca aumenta
   (Math.max com 1): se a tela nativa já é menor que a resolução escolhida,
   não tem o que fazer, fica na nativa mesmo. */
function calcularEscala(track, resolucao) {
  const dims = RESOLUCOES_TELA[resolucao] || RESOLUCOES_TELA['720p'];
  const nativa = track.getSettings();
  const larguraNativa = nativa.width || dims.largura;
  const alturaNativa = nativa.height || dims.altura;
  return Math.max(1, larguraNativa / dims.largura, alturaNativa / dims.altura);
}

/* O único lugar que decide qual qualidade vale agora.

   Os dois caminhos que mudam qualidade — começar a compartilhar e trocar no
   meio — faziam estas mesmas linhas cada um por conta própria. Eram três
   idênticas, e passaram a ser cinco quando o tipo de conteúdo entrou: duas
   cópias divergindo é questão de tempo, e a divergência aqui aparece como
   "escolhi jogo e continua borrando", que ninguém liga ao lugar certo. */
function fixarQualidade(track, { resolucao, fps, conteudo }) {
  resolucaoAtual = resolucao;
  conteudoAtual = CONTEUDO_TELA[conteudo] ? conteudo : CONTEUDO_PADRAO;
  bitrateTela = BITRATE_TELA[resolucao]?.[fps] ?? BITRATE_PADRAO;
  escalaTela = calcularEscala(track, resolucao);
  track.contentHint = CONTEUDO_TELA[conteudoAtual].hint;
}

/* A janela ou aba compartilhada pode mudar de tamanho no meio da
   transmissão (redimensionar, maximizar). Sem recalcular aqui, a escala
   fica presa ao tamanho nativo de quando começou e a resolução de saída
   desalinha do que foi escolhido.
   MediaStreamTrack não tem evento de resize — só o elemento <video> tem.
   Por isso esta função não se liga sozinha a nada: quem chama é a interface,
   a partir do resize do <video> que já existe no tile local (ver app.js). */
export function recalcularEscalaTela() {
  const track = telaStream?.getVideoTracks()[0];
  if (!track) return;
  escalaTela = calcularEscala(track, resolucaoAtual);
  for (const peer of peers.values()) {
    const sender = peer.pc.getSenders().find(s => s.track === track);
    if (sender) ajustarQualidadeTela(sender);
  }
}

/* Um escritor só por emissor.
   `setParameters` exige os parâmetros da leitura MAIS RECENTE. Duas chamadas
   se cruzando — a qualidade e a troca de codec — fazem a segunda falhar com
   DOMException, e o ajuste some sem ninguém notar. Custou um erro no console
   que só apareceu quando a troca de codec entrou. */
const filaDoEmissor = new WeakMap();

function aplicarNoEmissor(sender, mudar) {
  const anterior = filaDoEmissor.get(sender) || Promise.resolve();
  const proxima = anterior.catch(() => {}).then(async () => {
    try {
      const params = sender.getParameters();
      params.encodings = params.encodings?.length ? params.encodings : [{}];
      mudar(params);
      await sender.setParameters(params);
      return true;
    } catch (e) {
      console.error('[rtc] falha ao ajustar o emissor', e);
      return false;
    }
  });
  filaDoEmissor.set(sender, proxima);
  return proxima;
}

function ajustarQualidadeTela(sender) {
  return aplicarNoEmissor(sender, params => {
    params.encodings[0].maxBitrate = bitrateTela;
    params.encodings[0].scaleResolutionDownBy = escalaTela;
    /* O que ceder quando aperta vem do tipo de conteúdo: texto engasga mas não
       borra, jogo borra mas não engasga. O `balanced` que ficava aqui cedia as
       duas coisas e não protegia nenhuma. */
    params.degradationPreference = CONTEUDO_TELA[conteudoAtual].degradacao;
  });
}

/* ================= ciclo de vida ================= */

export function iniciar(sock, config, callback) {
  socket = sock;
  aoMudar = callback || (() => {});
  if (config?.ice_servers?.length) iceServers = config.ice_servers;

  socket.on('sala', ({ sala, eu: meu, peers: lista }) => {
    eu.sid = meu.sid;
    eu.nome = meu.nome;
    eu.sala = sala;
    // quem chega oferta pros que já estavam
    for (const p of lista) criarPeer(p, { iniciar: true });
    aoMudar();
  });

  socket.on('peer_entrou', ({ peer }) => {
    // o novo vai ofertar pra gente; aqui só preparamos a conexão
    criarPeer(peer, { iniciar: false });
    aoMudar();
  });

  socket.on('peer_saiu', ({ sid }) => { fecharPeer(sid); aoMudar(); });

  socket.on('peer_estado', ({ sid, tela, mic, tela_id, mic_id }) => {
    const p = peers.get(sid);
    if (!p) return;
    p.tela = tela;
    p.mic = mic;
    p.meta = { telaId: tela_id || null, micId: mic_id || null };
    aoMudar();
  });

  socket.on('sinal', ({ de, dados }) => tratarSinal(de, dados));

  socket.on('disconnect', () => {
    // do outro lado essas conexões já morreram; derruba pra não ficar tile fantasma
    for (const sid of [...peers.keys()]) fecharPeer(sid);
    aoMudar();
  });
}

export function entrar(sala, nome) {
  socket.emit('entrar', { sala, nome });
}

export function sair() {
  pararTela();
  pararMic();
  for (const sid of [...peers.keys()]) fecharPeer(sid);
  socket.emit('sair');
  eu.sala = '';
  aoMudar();
}

/* ================= codec da tela: H.264 na GPU ================= */

/* Nenhuma GPU de mercado codifica VP8 — nem AMD, nem NVIDIA, nem Intel. Como
   o WebRTC negocia VP8 por padrão, a tela cai no libvpx, na CPU, e o custo é
   POR ESPECTADOR: a malha codifica a mesma tela uma vez para cada pessoa.
   Medido aqui: VP8 por software 91,7% de CPU entregando 12 fps; H.264 na GPU
   11,5% entregando 55.

   A PRIMEIRA TENTATIVA QUEBROU UMA CHAMADA DE VERDADE, com tela preta e som
   normal do outro lado. Três coisas estavam erradas, e é por isso que este
   bloco tem a forma que tem:

   1. `setCodecPreferences` diz o que você prefere RECEBER, não o que envia.
      Quem escolhe o codec de saída é `encodings[].codec` do setParameters.
      (Chromium M124 passou a exigir a lista de RTCRtpReceiver justamente
      porque muita gente usava a de sender, como eu usei.)
   2. A lista de capacidade de ENVIO anuncia perfis que o decodificador da
      mesma máquina não aceita: aqui o envio oferece `profile-level-id=640033`
      (High, Level 5.1) e a recepção só vai até `64001f` (Level 3.1). Pedimos
      um perfil que ninguém decodifica.
   3. Nada avisava quem transmite que do outro lado não decodificava.

   Agora o codec sai de `getParameters().codecs`, que é o que foi NEGOCIADO com
   AQUELE peer — não o que esta máquina sabe fazer. E como isso não mexe no SDP,
   trocar de codec não pede renegociação. */

/* Constrained Baseline primeiro: é o H.264 que todo mundo decodifica, e é o
   que os apps do ramo usam para interoperar. Nada de High/Level 5.1. */
const PERFIS_H264 = ['42e01f', '42001f', '4d001f'];

/* packetization-mode=1 é obrigatório em qualquer endpoint; o modo 0 não sabe
   fragmentar, e um quadro-chave não cabe num pacote de rede. */
const MODO_1 = /packetization-mode=1/;

let h264Reprovado = false;   // alguém não decodificou: ninguém mais tenta nesta sessão

function codecH264De(sender) {
  for (const perfil of PERFIS_H264) {
    const achado = (sender.getParameters().codecs || []).find(c =>
      /\/H264$/i.test(c.mimeType)
      && MODO_1.test(c.sdpFmtpLine || '')
      && (c.sdpFmtpLine || '').includes('profile-level-id=' + perfil));
    if (achado) return achado;
  }
  return null;
}

function trocarCodecDeEnvio(sender, codec) {
  return aplicarNoEmissor(sender, params => {
    if (codec) params.encodings[0].codec = codec;
    else delete params.encodings[0].codec;
  });
}

/**
 * Volta todo mundo para VP8. Sem renegociar: o SDP não mudou.
 *
 * Nomeia o VP8 em vez de só apagar o campo: apagar não desfez a escolha na
 * prática — medido, o fluxo continuou saindo em H.264 depois de desistir, o
 * que deixaria a tela preta para sempre e tornaria este recuo decorativo.
 */
function abandonarH264(motivo) {
  if (h264Reprovado) return;
  h264Reprovado = true;
  console.warn(`[rtc] desistindo do H.264: ${motivo}`);
  for (const peer of peers.values()) {
    for (const s of peer.pc.getSenders()) {
      if (s.track?.kind !== 'video') continue;
      const vp8 = (s.getParameters().codecs || []).find(c => /\/VP8$/i.test(c.mimeType));
      trocarCodecDeEnvio(s, vp8 || null);
    }
  }
}

/**
 * Prova, dentro desta máquina, que o H.264 do NOSSO encoder é decodificável.
 *
 * Medido: o `VaapiVideoEncodeAccelerator` desta GPU produz um fluxo que o
 * próprio Chromium não decodifica — 745 quadros chegaram, ZERO decodificados,
 * com o som passando normal. O mesmo H.264 por software (OpenH264) decodifica
 * sem falha. Ou seja, o problema não é o codec nem o decodificador: é o
 * bitstream de um encoder específico, e não dá para saber qual pela capacidade
 * anunciada — só codificando e tentando decodificar.
 *
 * Por isso o teste é uma chamada de mentira contra nós mesmos. Se o nosso
 * decodificador recusa o que o nosso encoder faz, nenhum outro vai aceitar, e
 * ninguém precisa ver tela preta para a gente descobrir. Roda uma vez.
 *
 * 720p porque o encoder de hardware ignora resoluções pequenas e cai em
 * software — testar em 320x240 provaria o caminho errado.
 */
let provaH264 = null;   // null = ainda não testado; depois, a promessa do veredito

function provarH264() {
  if (provaH264) return provaH264;
  provaH264 = (async () => {
    let a = null, b = null, pincel = null;
    try {
      const tela = document.createElement('canvas');
      tela.width = 1280;
      tela.height = 720;
      const tinta = tela.getContext('2d');
      let n = 0;
      // sem movimento não há quadro novo, e sem quadro novo não há o que medir
      pincel = setInterval(() => {
        n++;
        tinta.fillStyle = `hsl(${(n * 9) % 360}, 80%, 50%)`;
        tinta.fillRect(0, 0, 1280, 720);
        tinta.fillStyle = '#fff';
        tinta.fillRect((n * 37) % 1200, 300, 80, 80);
      }, 33);

      const faixa = tela.captureStream(30).getVideoTracks()[0];
      // o mesmo hint da transmissão de verdade: provar um encoder e usar outro
      // devolveria um veredito sobre um caminho que ninguém percorre
      faixa.contentHint = CONTEUDO_TELA[conteudoAtual].hint;
      a = new RTCPeerConnection();
      b = new RTCPeerConnection();
      a.onicecandidate = e => e.candidate && b.addIceCandidate(e.candidate);
      b.onicecandidate = e => e.candidate && a.addIceCandidate(e.candidate);
      const emissor = a.addTrack(faixa);
      await a.setLocalDescription();
      await b.setRemoteDescription(a.localDescription);
      await b.setLocalDescription();
      await a.setRemoteDescription(b.localDescription);

      const codec = codecH264De(emissor);
      if (!codec) return false;                       // não foi negociado
      if (!await trocarCodecDeEnvio(emissor, codec)) return false;

      for (let i = 0; i < 12; i++) {
        await new Promise(r => setTimeout(r, 500));
        for (const st of (await b.getStats()).values()) {
          if (st.type !== 'inbound-rtp' || st.kind !== 'video') continue;
          if (st.framesDecoded > 0) return true;      // decodificou: pode usar
          // chegou bastante e não decodificou nenhum: é a falha que procuramos
          if (st.framesReceived > 20) return false;
        }
      }
      return false;   // não deu para provar; na dúvida, não arrisca
    } catch (e) {
      console.warn('[rtc] não deu para provar o H.264', e);
      return false;
    } finally {
      clearInterval(pincel);
      try { a?.close(); b?.close(); } catch { /* já fechados */ }
    }
  })();
  return provaH264;
}

/**
 * Tenta o H.264 e confere se valeu.
 *
 * Só vale se for para o hardware: em software o OpenH264 é pior que o libvpx
 * para tela, por não ter as ferramentas de conteúdo sintético que o VP8 usa.
 * Como a capacidade anunciada não diz nada sobre a GPU da máquina, a única
 * forma de saber é codificar e olhar.
 */
async function tentarH264(peer) {
  if (h264Reprovado) return;
  const sender = peer.pc.getSenders().find(s => s.track?.kind === 'video');
  if (!sender) return;

  /* Antes de mandar para alguém: o nosso próprio encoder passa no teste? */
  if (!await provarH264()) {
    abandonarH264('o nosso H.264 não decodifica nem aqui dentro');
    return;
  }
  if (!peers.has(peer.sid) || h264Reprovado) return;   // a prova demora

  const codec = codecH264De(sender);
  if (!codec) return;                       // não foi negociado: nada a fazer
  if (!await trocarCodecDeEnvio(sender, codec)) return;

  for (let i = 0; i < 8; i++) {
    await new Promise(r => setTimeout(r, 2000));
    if (!peers.has(peer.sid) || h264Reprovado) return;
    let saida = null;
    for (const st of (await peer.pc.getStats()).values()) {
      if (st.type === 'outbound-rtp' && st.kind === 'video' && st.framesEncoded > 60) saida = st;
    }
    if (!saida) continue;
    const impl = saida.encoderImplementation || '';
    if (saida.powerEfficientEncoder === false || /libvpx|openh264|ffmpeg/i.test(impl)) {
      abandonarH264(`ficou em software (${impl})`);
    } else {
      console.info(`[rtc] tela codificando na GPU (${impl})`);
    }
    return;
  }
}

/**
 * Do lado de quem ASSISTE: quadro chegando e nenhum decodificando.
 *
 * É o defeito que derrubou a primeira tentativa — som normal, imagem preta —
 * e quem sofre não é quem escolheu o codec. Por isso a descoberta viaja de
 * volta pelo canal de sinalização: quem transmite é que precisa mudar.
 */
function vigiarDecodificacao(peer) {
  let zerados = 0;
  let ultimoChegaram = 0;
  let ultimoDecodificados = 0;
  peer.vigiaCodec = setInterval(async () => {
    if (!peers.has(peer.sid)) return pararVigia(peer);
    let entrada = null;
    try {
      for (const st of (await peer.pc.getStats()).values()) {
        if (st.type === 'inbound-rtp' && st.kind === 'video') entrada = st;
      }
    } catch { return; }
    if (!entrada) return;

    const chegaram = (entrada.framesReceived || 0) - ultimoChegaram;
    const decodificados = (entrada.framesDecoded || 0) - ultimoDecodificados;
    ultimoChegaram = entrada.framesReceived || 0;
    ultimoDecodificados = entrada.framesDecoded || 0;

    if (chegaram > 0 && decodificados === 0) zerados++;
    else zerados = 0;

    // três janelas seguidas: não é o começo da conexão, é recusa mesmo
    if (zerados >= 3) {
      console.warn('[rtc] vídeo chegando sem decodificar — avisando quem transmite');
      enviar(peer.sid, { naoDecodifica: true });
      pararVigia(peer);
    }
  }, 1000);
}

function pararVigia(peer) {
  clearInterval(peer.vigiaCodec);
  peer.vigiaCodec = null;
}

/* ================= peers ================= */

function criarPeer(info, { iniciar: souEuQueOferto }) {
  if (peers.has(info.sid)) return peers.get(info.sid);

  const pc = new RTCPeerConnection({ iceServers });
  const peer = {
    sid: info.sid,
    nome: info.nome,
    pc,
    polite: !souEuQueOferto,   // quem já estava cede em caso de colisão
    fazendoOferta: false,
    ignorandoOferta: false,
    /* streamId -> MediaStream, do jeito que chegou. Quem é quem vem do meta. */
    midias: new Map(),
    meta: { telaId: info.tela_id || null, micId: info.mic_id || null },
    tela: !!info.tela,
    mic: !!info.mic,
    conexao: 'novo',
  };
  peers.set(info.sid, peer);

  for (const t of telaStream?.getTracks() || []) {
    const sender = pc.addTrack(t, telaStream);
    if (t.kind === 'video') ajustarQualidadeTela(sender);
  }
  for (const t of micStream?.getTracks() || []) pc.addTrack(t, micStream);

  pc.onnegotiationneeded = async () => {
    try {
      peer.fazendoOferta = true;
      await pc.setLocalDescription();
      enviar(peer.sid, { desc: pc.localDescription });
    } catch (e) {
      console.error('[rtc] falha ao ofertar', e);
    } finally {
      peer.fazendoOferta = false;
    }
  };

  pc.onicecandidate = ({ candidate }) => {
    if (candidate) enviar(peer.sid, { candidate });
  };

  /* Guarda as faixas agrupadas pela stream de origem — é esse id que o meta
     usa pra dizer "esta é a tela, esta é a voz". Sem o agrupamento o som da
     tela e o do microfone virariam a mesma coisa aqui. */
  pc.ontrack = ({ track, streams }) => {
    const origem = streams[0];
    if (!origem) return;

    let midia = peer.midias.get(origem.id);
    if (!midia) { midia = new MediaStream(); peer.midias.set(origem.id, midia); }

    /* Faixa que o outro lado removeu não termina: o Chrome a deixa no stream
       marcada como `muted`, e o nosso `onended` nunca dispara. Quem parava e
       voltava a levar o som acabava com duas faixas de áudio — a velha muda na
       frente da nova. E o <audio> toca a PRIMEIRA, então saía silêncio até
       parar de compartilhar e começar de novo.
       Só limpamos no momento em que chega uma substituta, então uma faixa
       muda por soluço de rede não é descartada à toa. */
    if (track.kind === 'audio') {
      for (const velha of midia.getAudioTracks()) {
        if (velha.readyState === 'ended' || velha.muted) midia.removeTrack(velha);
      }
    }
    midia.addTrack(track);

    track.onended = () => {
      try { midia.removeTrack(track); } catch {}
      if (!midia.getTracks().length) peer.midias.delete(origem.id);
      aoMudar();
    };
    track.onmute = () => aoMudar();
    track.onunmute = () => aoMudar();
    aoMudar();
  };

  pc.onconnectionstatechange = () => {
    peer.conexao = pc.connectionState;
    if (pc.connectionState === 'failed') pc.restartIce();
    /* Só depois de conectado: `getParameters().codecs` só tem o que foi
       negociado quando a negociação terminou. */
    if (pc.connectionState === 'connected') {
      tentarH264(peer);
      if (!peer.vigiaCodec) vigiarDecodificacao(peer);
    }
    aoMudar();
  };

  return peer;
}

function fecharPeer(sid) {
  const peer = peers.get(sid);
  if (!peer) return;
  pararVigia(peer);   // senão o intervalo sobrevive ao peer e mede o nada
  try { peer.pc.close(); } catch {}
  peers.delete(sid);
}

function enviar(para, dados) {
  socket.emit('sinal', { para, dados });
}

async function tratarSinal(de, dados) {
  const peer = peers.get(de);
  if (!peer || !dados) return;
  const pc = peer.pc;

  try {
    if (dados.desc) {
      const colisao = dados.desc.type === 'offer'
        && (peer.fazendoOferta || pc.signalingState !== 'stable');
      peer.ignorandoOferta = !peer.polite && colisao;
      if (peer.ignorandoOferta) return;

      await pc.setRemoteDescription(dados.desc);
      if (dados.desc.type === 'offer') {
        await pc.setLocalDescription();
        enviar(de, { desc: pc.localDescription });
      }
    } else if (dados.naoDecodifica) {
      /* Quem assiste não conseguiu decodificar o que mandamos. Não há o que
         negociar: o codec sai de cena para todos, e para o resto da sessão. */
      abandonarH264('quem assiste não decodificou');
    } else if (dados.candidate) {
      try { await pc.addIceCandidate(dados.candidate); }
      catch (e) { if (!peer.ignorandoOferta) throw e; }
    }
  } catch (e) {
    console.error('[rtc] sinal recusado', e);
  }
}

/* ================= mídia local ================= */

/**
 * O "com som ou sem" é decisão de quem compartilha, no diálogo do navegador:
 * pedimos áudio junto e o Chrome mostra a caixinha "compartilhar áudio". Se
 * ele negar ou o usuário não marcar, vai só o vídeo — não é erro.
 *
 * Devolve { audioDescartado } pra a interface avisar quando o áudio pedido
 * não foi enviado por causa do que está descrito no bloco abaixo.
 */
export async function alternarTela({ resolucao = '720p', fps = 30, conteudo = CONTEUDO_PADRAO } = {}) {
  if (telaStream) { pararTela(); publicarEstado(); aoMudar(); return null; }

  /* Pedir largura/altura aqui VALE a pena, ao contrário do que este comentário
     dizia antes. Medido: pedindo 1280x720 numa tela de 1920x1080, o Chromium
     devolveu exatamente 1280x720, com `resizeMode: crop-and-scale`.

     A diferença importa na malha: reduzir aqui acontece UMA vez, na captura;
     reduzir por `scaleResolutionDownBy` acontece uma vez POR ENCODER, e há um
     encoder por espectador. O `scaleResolutionDownBy` continua abaixo como rede
     de proteção para quem ignorar o pedido — onde ele for respeitado, a escala
     dá 1 sozinha e não custa nada. */
  const dims = RESOLUCOES_TELA[resolucao] || RESOLUCOES_TELA['720p'];
  telaStream = await navigator.mediaDevices.getDisplayMedia({
    video: {
      width: { ideal: dims.largura },
      height: { ideal: dims.altura },
      frameRate: { ideal: fps, max: fps },
    },
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
  });

  const track = telaStream.getVideoTracks()[0];

  /* O áudio do getDisplayMedia só vem recortado pro que está na tela quando a
     pessoa compartilha uma ABA do Chrome — aí a caixinha é "áudio da aba".
     Em janela ou tela inteira, o que o Chromium oferece é o áudio do SISTEMA
     INTEIRO: quem assiste ouviria notificação, música, qualquer outro app
     aberto, não só o que está sendo mostrado. Não existe opção de API pra
     "áudio só deste app" fora de uma aba — isolar por aplicativo exige suporte
     do sistema operacional (é o que o app de mesa em Electron, à parte deste
     projeto, faz com código nativo). Sem esse suporte aqui, a única forma de
     garantir que ninguém ouça o que não devia é não mandar esse áudio. */
  const audioTrack = telaStream.getAudioTracks()[0];
  const audioDescartado = !!audioTrack && track.getSettings().displaySurface !== 'browser';
  if (audioDescartado) {
    audioTrack.stop();
    telaStream.removeTrack(audioTrack);
  }

  fixarQualidade(track, { resolucao, fps, conteudo });


  // parar pelo botão nativo do navegador tem que refletir na interface
  track.addEventListener('ended', () => {
    if (telaStream) { pararTela(); publicarEstado(); aoMudar(); }
  });

  /* No Linux a captura vem do PipeWire e a faixa nasce `muted`, só desmutando
     quando o primeiro quadro chega. Sem escutar isso, a tela era compartilhada
     de verdade e a interface continuava mostrando "ninguém está compartilhando"
     — a faixa mudava de estado e ninguém redesenhava. */
  track.addEventListener('mute', aoMudar);
  track.addEventListener('unmute', aoMudar);

  adicionar(telaStream);
  eu.tela = true;
  publicarEstado();
  aoMudar();
  return { audioDescartado };
}

/**
 * Troca resolução/fps/conteúdo de uma captura já em andamento, sem reabrir o
 * diálogo do navegador nem derrubar a conexão com quem está assistindo.
 */
export async function mudarQualidadeTela({ resolucao = '720p', fps = 30, conteudo = CONTEUDO_PADRAO } = {}) {
  const track = telaStream?.getVideoTracks()[0];
  if (!track) return;

  /* A restrição recusada não pode abortar o resto: bitrate e escala ainda
     precisam ser aplicados, e o `scaleResolutionDownBy` sozinho já entrega a
     resolução pedida. Deixar a exceção subir trocaria uma redução parcial por
     nenhuma, e a interface diria "não consegui aplicar" com o fps já mudado. */
  const dims = RESOLUCOES_TELA[resolucao] || RESOLUCOES_TELA['720p'];
  try {
    await track.applyConstraints({
      width: { ideal: dims.largura },
      height: { ideal: dims.altura },
      frameRate: { ideal: fps, max: fps },
    });
  } catch (e) {
    console.warn('[rtc] a captura recusou a restrição; a redução fica com o encoder', e);
  }

  fixarQualidade(track, { resolucao, fps, conteudo });

  for (const peer of peers.values()) {
    const sender = peer.pc.getSenders().find(s => s.track === track);
    if (sender) ajustarQualidadeTela(sender);
  }
}

/**
 * Caminho do Linux: o app criou uma entrada de áudio de verdade, e a página só
 * a captura. Recebe o rótulo porque o id do dispositivo só existe depois que o
 * navegador enumera.
 */
export async function ligarSomDaTela(rotulo) {
  if (!telaStream) throw new Error('Compartilhe a tela antes de ligar o som do sistema.');
  if (somTelaStream) return;

  const deviceId = await acharEntrada(rotulo);
  if (!deviceId) throw new Error(`Não encontrei a fonte de áudio "${rotulo}".`);

  adotarSomDaTela(await navigator.mediaDevices.getUserMedia({
    // som de aplicativo não é voz: cancelar eco ou "melhorar" o sinal só estraga
    audio: {
      deviceId: { exact: deviceId },
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    },
  }));
}

/**
 * O mesmo som, onde não existe dispositivo para capturar.
 *
 * No macOS e no Windows as bibliotecas nativas não criam entrada de áudio
 * nenhuma: elas entregam blocos de PCM. O worklet transforma esses blocos numa
 * faixa, e daí para a frente é indistinguível do caminho do Linux — inclusive
 * para o outro lado da chamada.
 *
 * @param assinar recebe uma função que será chamada a cada bloco e devolve
 *   como cancelar a assinatura.
 */
export async function ligarSomDaTelaPcm({ taxa, canais }, assinar) {
  if (!telaStream) throw new Error('Compartilhe a tela antes de ligar o som.');
  if (somTelaStream) return;

  // o contexto nasce na taxa do PCM: assim ninguém reamostra no caminho
  const ctx = new AudioContext({ sampleRate: taxa });
  try {
    await ctx.audioWorklet.addModule('/js/pcm-worklet.js');
    const no = new AudioWorkletNode(ctx, 'fonte-de-pcm', {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [canais],
      processorOptions: { canais },
    });
    const destino = ctx.createMediaStreamDestination();
    no.connect(destino);
    await ctx.resume().catch(() => {});

    somContexto = ctx;
    // transfere o buffer em vez de copiar: são blocos a cada 200ms, sem parar
    somCancelar = assinar(buffer => {
      try { no.port.postMessage(buffer, [buffer]); } catch (e) { console.error(e); }
    });
    adotarSomDaTela(destino.stream);
  } catch (e) {
    ctx.close().catch(() => {});
    somContexto = null;
    throw e;
  }
}

/**
 * As faixas entram em `telaStream`, não numa stream própria: assim chegam do
 * outro lado com o id da tela e caem no controle "Som da tela", separadas da
 * voz. É o invariante 3 — juntar os áudios num stream só mataria isso.
 */
function adotarSomDaTela(stream) {
  somTelaStream = stream;
  for (const faixa of stream.getAudioTracks()) {
    telaStream.addTrack(faixa);
    for (const peer of peers.values()) {
      try { peer.pc.addTrack(faixa, telaStream); } catch (e) { console.error(e); }
    }
  }
  eu.somDaTela = true;
  aoMudar();
}

export function desligarSomDaTela() {
  if (!somTelaStream) return;
  remover(somTelaStream);
  for (const faixa of somTelaStream.getAudioTracks()) {
    try { telaStream?.removeTrack(faixa); } catch {}
    faixa.stop();
  }
  somTelaStream = null;

  // a assinatura primeiro: sem isso chegariam blocos para um worklet já morto
  if (somCancelar) { try { somCancelar(); } catch (e) { console.error(e); } somCancelar = null; }
  if (somContexto) { somContexto.close().catch(() => {}); somContexto = null; }

  eu.somDaTela = false;
  aoMudar();
}

/**
 * Acha a entrada de áudio pelo rótulo, esperando ela aparecer.
 *
 * Duas esperas embutidas: o navegador só devolve rótulo depois de alguma
 * permissão de áudio concedida, e a lista de dispositivos dele é um cache que
 * demora a notar a fonte recém-criada no sistema — o app já a vê no grafo
 * enquanto o Chromium ainda não. Sem o laço, o primeiro compartilhamento falha
 * com "não encontrei a fonte" e o segundo funciona.
 */
async function acharEntrada(rotulo, esperaMax = 6000) {
  const ateQuando = Date.now() + esperaMax;
  let liberou = false;

  while (Date.now() < ateQuando) {
    const lista = await navigator.mediaDevices.enumerateDevices();

    if (!liberou && !lista.some(d => d.kind === 'audioinput' && d.label)) {
      const temporario = await navigator.mediaDevices.getUserMedia({ audio: true });
      for (const t of temporario.getTracks()) t.stop();
      liberou = true;
      continue;
    }

    const achado = lista.find(d => d.kind === 'audioinput' && d.label.includes(rotulo));
    if (achado) return achado.deviceId;
    await new Promise(r => setTimeout(r, 300));
  }
  return null;
}

export async function alternarMic() {
  if (micStream) { pararMic(); publicarEstado(); aoMudar(); return; }

  micStream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
  adicionar(micStream);
  eu.mic = true;
  publicarEstado();
  aoMudar();
}

function adicionar(stream) {
  for (const peer of peers.values()) {
    for (const track of stream.getTracks()) {
      try {
        const sender = peer.pc.addTrack(track, stream);
        if (track.kind === 'video') ajustarQualidadeTela(sender);
      } catch (e) { console.error(e); }
    }
  }
}

function remover(stream) {
  const ids = new Set(stream.getTracks().map(t => t.id));
  for (const peer of peers.values()) {
    for (const sender of peer.pc.getSenders()) {
      if (sender.track && ids.has(sender.track.id)) {
        try { peer.pc.removeTrack(sender); } catch (e) { console.error(e); }
      }
    }
  }
}

function pararTela() {
  if (!telaStream) return;
  // o som do sistema viaja com a tela: parou a tela, ele não tem mais onde morar
  desligarSomDaTela();
  remover(telaStream);
  for (const t of telaStream.getTracks()) t.stop();
  telaStream = null;
  eu.tela = false;
}

function pararMic() {
  if (!micStream) return;
  remover(micStream);
  for (const t of micStream.getTracks()) t.stop();
  micStream = null;
  eu.mic = false;
}

function publicarEstado() {
  socket.emit('estado', {
    tela: eu.tela,
    mic: eu.mic,
    tela_id: telaStream?.id || null,
    mic_id: micStream?.id || null,
  });
}

export function minhaTela() { return telaStream; }

/**
 * Como o navegador classifica o que está sendo capturado: 'monitor' é a tela
 * inteira, 'window' é uma janela. É o que permite ao app de mesa deduzir se o
 * som deve ser o da máquina toda ou o de um aplicativo só.
 */
export function superficieDaTela() {
  return telaStream?.getVideoTracks()[0]?.getSettings().displaySurface || null;
}

/* ================= o que tocar de cada peer ================= */

export function streamDaTela(peer) {
  return (peer.meta.telaId && peer.midias.get(peer.meta.telaId)) || null;
}

/**
 * A voz do peer. O meta pode não ter chegado ainda (ele viaja pelo socket, a
 * faixa pela conexão P2P); nesse caso qualquer áudio que não seja o da tela
 * conta como voz, pra ninguém ficar mudo por causa da ordem de chegada.
 */
export function streamDaVoz(peer) {
  if (peer.meta.micId) return peer.midias.get(peer.meta.micId) || null;
  for (const [id, midia] of peer.midias) {
    if (id !== peer.meta.telaId && midia.getAudioTracks().length) return midia;
  }
  return null;
}

export function temSom(stream) {
  return !!stream?.getAudioTracks().some(t => t.readyState === 'live' && !t.muted);
}

export function temImagem(stream) {
  return !!stream?.getVideoTracks().some(t => t.readyState === 'live' && !t.muted);
}
