/* Avisos sonoros: entrou, saiu, começou a ver, parou de ver.
 *
 * Os sons são SINTETIZADOS aqui, não tocados de arquivo. Não é preciosismo: um
 * .mp3 ou .ogg seria um arquivo de terceiro entrando no repositório, e o
 * projeto já expulsou três binários de áudio por esse motivo. Duas senoides
 * somadas resolvem, pesam zero e qualquer um lê o que elas fazem.
 *
 * O desenho é o mesmo de todo aviso bom: par de notas curto, subindo para o
 * que chega e descendo para o que sai, grave para a sala e agudo para a tela.
 * Quem ouve precisa distinguir sem pensar — e precisa poder desligar.
 */

/* Um contexto só, criado no primeiro aviso e não na carga do módulo: antes de
   alguém clicar em algo, o navegador cria o AudioContext já suspenso, e ele
   fica assim para sempre. Como o primeiro aviso só acontece depois de entrar
   na sala, aqui ele nasce liberado. */
let contexto = null;

function audio() {
  if (!contexto) contexto = new (window.AudioContext || window.webkitAudioContext)();
  // voltar de "suspenso" é comum depois de a aba ficar em segundo plano
  if (contexto.state === 'suspended') contexto.resume().catch(() => {});
  return contexto;
}

/**
 * Uma nota.
 *
 * O ganho sobe e desce em rampa em vez de ligar e desligar seco: um oscilador
 * cortado no meio da onda estala, e o estalo é mais alto que a própria nota.
 */
function nota(ctx, { hz, comeca, dura, volume }) {
  const osc = ctx.createOscillator();
  const ganho = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.value = hz;

  const t = ctx.currentTime + comeca;
  ganho.gain.setValueAtTime(0, t);
  ganho.gain.linearRampToValueAtTime(volume, t + 0.015);
  ganho.gain.exponentialRampToValueAtTime(0.0001, t + dura);

  osc.connect(ganho).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + dura + 0.02);
}

/* Frequências em vez de nomes de nota: é o que a API recebe, e traduzir duas
   vezes só cria chance de erro. C5=523, E5=659, G5=784, C6=1047. */
const SONS = {
  entrou:      [{ hz: 523, dura: 0.12 }, { hz: 784, dura: 0.18, comeca: 0.09 }],
  saiu:        [{ hz: 784, dura: 0.12 }, { hz: 523, dura: 0.20, comeca: 0.09 }],
  // a tela é mais aguda e mais curta: acontece mais vezes e não pode pesar
  vendo:       [{ hz: 1047, dura: 0.10, volume: 0.06 }],
  parouDeVer:  [{ hz: 659, dura: 0.10, volume: 0.06 }],
};

const VOLUME_PADRAO = 0.09;   // aviso, não alarme

let ligado = true;

/** Liga ou desliga todos os avisos. A preferência é de quem ouve. */
export function silenciar(quieto) { ligado = !quieto; }
export function silenciado() { return !ligado; }

/**
 * Toca um aviso. Nunca lança: um som que falha não pode derrubar a chamada
 * junto, e é exatamente o tipo de coisa que quebra em navegador antigo.
 */
export function tocar(qual) {
  if (!ligado) return;
  const receita = SONS[qual];
  if (!receita) return;
  try {
    const ctx = audio();
    for (const n of receita) {
      nota(ctx, { comeca: 0, volume: VOLUME_PADRAO, ...n });
    }
  } catch (e) {
    console.warn('[avisos] não consegui tocar', qual, e);
  }
}
