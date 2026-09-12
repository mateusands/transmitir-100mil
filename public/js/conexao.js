/* Mede a qualidade de cada conexão e diz DE QUEM é o problema.
 *
 * "Tá travando" é a reclamação mais comum e a menos acionável: pode ser o
 * computador de quem transmite não dando conta de codificar, a rede entre os
 * dois perdendo pacote, ou a máquina de quem assiste não conseguindo
 * decodificar. Os três parecem iguais na tela e têm soluções opostas.
 *
 * O WebRTC sabe diferenciar, e diz de graça no getStats(). O que falta é
 * perguntar e traduzir.
 *
 * Quase tudo que ele devolve é CONTADOR ACUMULADO desde o início da chamada —
 * "285 quadros descartados" não diz se foi agora ou há dez minutos. Por isso
 * guardamos amostras e trabalhamos com a diferença entre duas.
 */

import { peers } from './rtc.js';

const INTERVALO = 2000;
const JANELA = 30;        // ~1 minuto de histórico por peer

/* Acima disto, a rede está atrapalhando de verdade. 2% é onde o vídeo começa a
   mostrar bloco e o áudio a engasgar; abaixo, o WebRTC absorve sem aparecer. */
const PERDA_RUIM = 0.02;

/** sid -> [{ t, ...medidas }] */
const historico = new Map();
let timer = null;

/**
 * Uma leitura de todos os números que interessam, de um peer.
 *
 * `remote-inbound-rtp` é o mais valioso e o menos óbvio: é o relatório que o
 * OUTRO lado manda de volta sobre o que ele está recebendo de nós. É por ele
 * que quem transmite descobre que o outro está perdendo pacote — sem precisar
 * perguntar.
 */
async function medir(pc) {
  const relatorio = await pc.getStats();
  const m = { t: Date.now() };

  /* Há um candidate-pair por caminho testado — foram sete numa chamada local.
     Só um está em uso, e quem sabe qual é o transport. Pegar "o primeiro que
     deu certo" pega o par errado, que vem sem os números de banda. */
  let parEmUso = null;
  const candidatos = new Map();
  for (const s of relatorio.values()) {
    if (s.type === 'transport' && s.selectedCandidatePairId) parEmUso = s.selectedCandidatePairId;
    if (s.type === 'local-candidate' || s.type === 'remote-candidate') candidatos.set(s.id, s);
  }

  for (const s of relatorio.values()) {
    if (s.type === 'outbound-rtp' && s.kind === 'video') {
      m.enviaLargura = s.frameWidth;
      m.enviaAltura = s.frameHeight;
      m.enviaFps = s.framesPerSecond;
      m.encoder = s.encoderImplementation;
      m.alvoBitrate = s.targetBitrate;
      m.motivoLimite = s.qualityLimitationReason;
      m.limitePorCpu = s.qualityLimitationDurations?.cpu ?? 0;
      m.limitePorRede = s.qualityLimitationDurations?.bandwidth ?? 0;
      m.bytesEnviados = s.bytesSent;
    } else if (s.type === 'remote-inbound-rtp' && s.kind === 'video') {
      // o que o outro lado relata sobre o nosso vídeo
      if (typeof s.roundTripTime === 'number') m.rtt = s.roundTripTime;
      m.perdaRelatada = s.fractionLost;
      m.pacotesPerdidosLa = s.packetsLost;
    } else if (s.type === 'inbound-rtp' && s.kind === 'video') {
      m.recebeLargura = s.frameWidth;
      m.recebeAltura = s.frameHeight;
      m.recebeFps = s.framesPerSecond;
      m.quadrosDescartados = s.framesDropped;
      m.congelamentos = s.freezeCount;
      m.tempoCongelado = s.totalFreezesDuration;
      m.pacotesPerdidos = s.packetsLost;
      m.pacotesRecebidos = s.packetsReceived;
      /* Quadro que chega e não decodifica é tela preta com áudio normal — o
         som vai por Opus, que sempre decodifica. Sem estes dois, a tela preta
         cai no ramo genérico e a pessoa é mandada a fechar abas, que não
         resolve nada. Custou um caso real. */
      m.quadrosChegaram = s.framesReceived;
      m.quadrosDecodificados = s.framesDecoded;
    } else if (s.type === 'inbound-rtp' && s.kind === 'audio') {
      // amostras que o decodificador INVENTOU para tapar buraco: é a medida
      // que corresponde ao engasgo que o ouvido percebe
      m.amostrasInventadas = s.concealedSamples;
      m.amostrasTotais = s.totalSamplesReceived;
    } else if (s.type === 'candidate-pair' && (parEmUso ? s.id === parEmUso : s.nominated)) {
      // `typeof` e não verdadeiro: numa rede local o RTT é 0, e zero é medida,
      // não ausência de medida
      if (typeof s.currentRoundTripTime === 'number') m.rttCano = s.currentRoundTripTime;
      if (typeof s.availableOutgoingBitrate === 'number') m.bitrateDisponivel = s.availableOutgoingBitrate;
      /* Por onde a mídia está indo. `host` é direto; `srflx`/`prflx` saem da
         máquina e voltam pela internet, mesmo entre dois computadores da mesma
         casa; `relay` passa por um servidor TURN, que é o pior dos três.
         Isto costuma ser o que explica latência alta sem perda nenhuma. */
      m.tipoLocal = candidatos.get(s.localCandidateId)?.candidateType;
      m.tipoRemoto = candidatos.get(s.remoteCandidateId)?.candidateType;
    }
  }
  return m;
}

const cresceu = (novo, velho, campo) => (novo[campo] ?? 0) - (velho[campo] ?? 0);

/**
 * Traduz duas amostras num veredito.
 *
 * A ordem das perguntas importa, e é do mais específico para o mais genérico:
 * a CPU do emissor é a única causa que o próprio WebRTC nomeia, então ela vem
 * primeiro. Perda e falta de banda são a rede. Sobra quem assiste — e esse só
 * é acusado quando não há perda nenhuma, senão estaríamos culpando a vítima de
 * uma rede ruim.
 */
function julgar(novo, velho) {
  const segundos = (novo.t - velho.t) / 1000 || 1;
  const perda = novo.perdaRelatada ?? 0;
  const cpu = cresceu(novo, velho, 'limitePorCpu');
  const rede = cresceu(novo, velho, 'limitePorRede');
  const descartados = cresceu(novo, velho, 'quadrosDescartados');
  const congelou = cresceu(novo, velho, 'tempoCongelado');
  const recebidos = cresceu(novo, velho, 'pacotesRecebidos');
  const perdidosAqui = cresceu(novo, velho, 'pacotesPerdidos');
  const chegaram = cresceu(novo, velho, 'quadrosChegaram');
  const decodificados = cresceu(novo, velho, 'quadrosDecodificados');

  /* Antes de tudo: quadro chegando e nenhum decodificando não é rede nem CPU,
     é o vídeo não sendo aceito pelo decodificador. É o único ramo em que o
     número não deixa dúvida, então vem primeiro — e é o que separa "tela preta
     com som funcionando" de todo o resto. */
  if (chegaram > 0 && decodificados === 0) {
    return { culpa: 'formato',
      texto: 'O vídeo está chegando mas não está sendo decodificado por esta máquina — o som passa e a imagem fica preta. Fechar abas não resolve; quem transmite precisa baixar a qualidade ou atualizar o app.' };
  }

  if (cpu > segundos * 0.3) {
    return { culpa: 'quem-transmite',
      texto: 'O computador de quem transmite não está dando conta de codificar. Baixar a resolução ou os quadros por segundo resolve.' };
  }
  if (perda > PERDA_RUIM || rede > segundos * 0.3) {
    return { culpa: 'rede',
      texto: `A rede entre vocês está perdendo pacote (${(perda * 100).toFixed(1)}%). Quem transmite pode baixar a qualidade; trocar wi-fi por cabo costuma resolver mais.` };
  }
  /* Só acusa quem assiste quando o caminho até ele estava limpo: com perda no
     meio, congelar é consequência, não causa. */
  const perdaAqui = recebidos > 0 ? perdidosAqui / (recebidos + perdidosAqui) : 0;
  if (perdaAqui < PERDA_RUIM && (descartados > 0 || congelou > 0.2)) {
    return { culpa: 'quem-assiste',
      texto: 'Chegou inteiro, mas a máquina de quem assiste não está conseguindo exibir. Fechar abas e outros programas costuma resolver.' };
  }
  return { culpa: null, texto: 'Conexão saudável.' };
}

/* O pior dos dois lados manda: se um está atrás de NAT, o caminho todo é. */
function caminho(local, remoto) {
  const tipos = [local, remoto];
  if (tipos.includes('relay')) return { nome: 'por servidor intermediário', direto: false };
  if (tipos.includes('srflx') || tipos.includes('prflx')) return { nome: 'pela internet', direto: false };
  if (tipos.includes('host')) return { nome: 'direto', direto: true };
  return null;
}

/** O último veredito de um peer, ou null se ainda não há duas amostras. */
export function diagnostico(sid) {
  const amostras = historico.get(sid);
  if (!amostras || amostras.length < 2) return null;

  const novo = amostras[amostras.length - 1];
  const velho = amostras[amostras.length - 2];
  const { culpa, texto } = julgar(novo, velho);

  // o RTT do relatório do outro lado é o mais fiel; o do cano serve para quem
  // só recebe, que não tem relatório de volta sobre nada
  const rtt = typeof novo.rtt === 'number' ? novo.rtt : novo.rttCano;
  const rota = caminho(novo.tipoLocal, novo.tipoRemoto);
  return {
    culpa,
    texto,
    caminho: rota?.nome ?? null,
    direto: rota?.direto ?? null,
    pingMs: typeof rtt === 'number' ? Math.round(rtt * 1000) : null,
    perda: novo.perdaRelatada ?? null,
    encoder: novo.encoder ?? null,
    enviando: novo.enviaLargura ? `${novo.enviaLargura}x${novo.enviaAltura}@${novo.enviaFps ?? '?'}` : null,
    recebendo: novo.recebeLargura ? `${novo.recebeLargura}x${novo.recebeAltura}@${novo.recebeFps ?? '?'}` : null,
    bitrateDisponivel: novo.bitrateDisponivel ?? null,
    alvoBitrate: novo.alvoBitrate ?? null,
    /* Quando o disponível cai abaixo do alvo, a qualidade escolhida deixou de
       caber no cano — é o aviso mais acionável que dá para dar a quem transmite. */
    apertado: !!(novo.bitrateDisponivel && novo.alvoBitrate && novo.bitrateDisponivel < novo.alvoBitrate),
  };
}

/** Tudo que foi medido, para depurar no console. */
export function amostras(sid) {
  return sid ? (historico.get(sid) || []) : Object.fromEntries(historico);
}

async function ciclo() {
  for (const [sid, peer] of peers) {
    try {
      const fila = historico.get(sid) || [];
      fila.push(await medir(peer.pc));
      if (fila.length > JANELA) fila.shift();
      historico.set(sid, fila);
    } catch (e) {
      console.error('[conexao] falha ao medir', sid, e);
    }
  }
  // quem saiu da chamada não precisa de histórico ocupando memória
  for (const sid of [...historico.keys()]) if (!peers.has(sid)) historico.delete(sid);
}

export function observar() {
  if (timer) return;
  timer = setInterval(() => { ciclo().catch(e => console.error(e)); }, INTERVALO);
}

export function parar() {
  if (timer) { clearInterval(timer); timer = null; }
  historico.clear();
}
