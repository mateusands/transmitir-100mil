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

export const eu = { sid: null, nome: '', sala: '', tela: false, mic: false };

let telaStream = null;  // vídeo da tela (+ áudio da aba/sistema, se houver)
let micStream = null;   // áudio do microfone

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
   transmite (ex.: 6 pessoas em 720p/60fps = 6 * 2,5 Mbps = 15 Mbps). Padrão
   é 720p: em teste real com upload comum, 1080p e 1440p ficaram piores que
   720p — o upload não aguenta o bitrate mais alto que essas resoluções
   pedem, e a imagem sofre mais com isso do que ganharia em nitidez. */
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

// mesma combinação do default de alternarTela/mudarQualidadeTela (720p/60) —
// é o teto que vale quando resolução+fps pedidos não batem com nenhuma linha
// da tabela, então tem que ser o mesmo padrão, não um valor menor à parte
const BITRATE_PADRAO = BITRATE_TELA['720p'][60];

let bitrateTela = BITRATE_PADRAO;
let escalaTela = 1;
let resolucaoAtual = '720p';

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

async function ajustarQualidadeTela(sender) {
  try {
    const params = sender.getParameters();
    params.encodings = params.encodings?.length ? params.encodings : [{}];
    params.encodings[0].maxBitrate = bitrateTela;
    params.encodings[0].scaleResolutionDownBy = escalaTela;
    // quando a rede aperta, cede um pouco de resolução e um pouco de fps
    // junto, em vez de zerar uma das duas pra proteger a outra
    params.degradationPreference = 'balanced';
    await sender.setParameters(params);
  } catch (e) {
    console.error('[rtc] falha ao ajustar bitrate da tela', e);
  }
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
    aoMudar();
  };

  return peer;
}

function fecharPeer(sid) {
  const peer = peers.get(sid);
  if (!peer) return;
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
export async function alternarTela({ resolucao = '720p', fps = 60 } = {}) {
  if (telaStream) { pararTela(); publicarEstado(); aoMudar(); return null; }

  // sem width/height: pedir isso pro getDisplayMedia não é respeitado pela
  // maioria dos navegadores em captura de tela. Pega a nativa e reduz depois
  // via scaleResolutionDownBy, que é garantido.
  telaStream = await navigator.mediaDevices.getDisplayMedia({
    video: { frameRate: { ideal: fps, max: fps } },
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
  });

  const track = telaStream.getVideoTracks()[0];
  // sinaliza pro codec priorizar nitidez (texto, janelas) em vez de
  // suavidade de movimento — é vídeo de tela, não webcam
  track.contentHint = 'detail';

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

  resolucaoAtual = resolucao;
  bitrateTela = BITRATE_TELA[resolucao]?.[fps] ?? BITRATE_PADRAO;
  escalaTela = calcularEscala(track, resolucao);

  // parar pelo botão nativo do navegador tem que refletir na interface
  track.addEventListener('ended', () => {
    if (telaStream) { pararTela(); publicarEstado(); aoMudar(); }
  });

  adicionar(telaStream);
  eu.tela = true;
  publicarEstado();
  aoMudar();
  return { audioDescartado };
}

/**
 * Troca resolução/fps/bitrate de uma captura já em andamento, sem reabrir o
 * diálogo do navegador nem derrubar a conexão com quem está assistindo. O fps
 * é o único pedido que applyConstraints costuma respeitar de verdade; a
 * resolução é sempre reforçada depois via scaleResolutionDownBy.
 */
export async function mudarQualidadeTela({ resolucao = '720p', fps = 60 } = {}) {
  const track = telaStream?.getVideoTracks()[0];
  if (!track) return;

  await track.applyConstraints({ frameRate: { ideal: fps, max: fps } });

  resolucaoAtual = resolucao;
  bitrateTela = BITRATE_TELA[resolucao]?.[fps] ?? BITRATE_PADRAO;
  escalaTela = calcularEscala(track, resolucao);

  for (const peer of peers.values()) {
    const sender = peer.pc.getSenders().find(s => s.track === track);
    if (sender) ajustarQualidadeTela(sender);
  }
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
