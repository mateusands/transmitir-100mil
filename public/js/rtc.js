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

  for (const t of telaStream?.getTracks() || []) pc.addTrack(t, telaStream);
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
 */
export async function alternarTela() {
  if (telaStream) { pararTela(); publicarEstado(); aoMudar(); return; }

  telaStream = await navigator.mediaDevices.getDisplayMedia({
    video: { frameRate: { ideal: 30, max: 60 } },
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
  });

  const track = telaStream.getVideoTracks()[0];

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
 * demora a notar a fonte recém-criada no sistema — o app já a vê no `pactl`
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
      try { peer.pc.addTrack(track, stream); } catch (e) { console.error(e); }
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
