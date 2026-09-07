/* Porta comum do som por aplicativo, nas três plataformas.
 *
 * O que muda entre elas não é a ideia, é a entrega. No Linux criamos uma
 * entrada de áudio de verdade, com as ferramentas do PipeWire, e a página só a
 * captura. No macOS e no Windows não há dispositivo nenhum: vêm blocos de PCM,
 * que o worklet da página vira faixa. Daí para a frente é indistinguível —
 * inclusive para quem recebe.
 *
 * Em todas, o modelo é o mesmo: vão só os aplicativos escolhidos. O que não foi
 * escolhido não entra, e é isso que impede o Discord e as vozes da própria
 * chamada de voltarem para dentro da transmissão.
 */


const linux = require('./som-linux.cjs');
const pcm = require('./som-pcm.cjs');

const noLinux = process.platform === 'linux';
const backend = noLinux ? linux : pcm;

function pidsDesteApp() {
  try {
    return new Set(require('electron').app.getAppMetrics().map(p => String(p.pid)));
  } catch { return new Set(); }
}

/**
 * O que dá para fazer aqui: `{ disponivel, tudo }`.
 *
 * `tudo` é falso no Windows, onde a API captura um processo por vez. A
 * interface usa isso para não oferecer o que não existe.
 */
function recursos() {
  try { return backend.recursos(); } catch (e) { console.error(e); return { disponivel: false, tudo: false }; }
}

/** Aplicativos que podem ter o som levado, como `{ id, nome }`. */
async function aplicativos() {
  try {
    const lista = await backend.aplicativos();
    const nossos = pidsDesteApp();
    return lista.filter(a => !nossos.has(String(a.id)));
  } catch (e) { console.error(e); return []; }
}

/**
 * O que levar, deduzido do que esta sendo compartilhado. `null` quando nao ha
 * palpite — e ai nada liga sozinho.
 *
 * @param superficie 'monitor' ou 'window', do displaySurface da faixa de video
 * @param nomeDaFonte titulo da janela escolhida, onde o seletor sabe dizer
 */
async function sugestao(superficie, nomeDaFonte) {
  try { return await backend.sugestao(superficie, nomeDaFonte); }
  catch (e) { console.error(e); return null; }
}

/**
 * Liga o som dos aplicativos escolhidos.
 *
 * @param alvo `'tudo'`, ou array de ids vindo de aplicativos() — nome do
 *   aplicativo no Linux, PID nas outras
 * @param excluidos o que não deve entrar quando o alvo é `'tudo'`
 * @param aoReceberPcm chamado a cada bloco, só onde a entrega é por PCM
 * @returns `{ tipo: 'dispositivo', fonte }` ou `{ tipo: 'pcm', taxa, canais }`
 */
async function ligar(alvo, excluidos, aoReceberPcm) {
  /* Forma única: 'tudo' ou string[] de ids. PID/nome solto não entra —
     new Set('1234') viraria os caracteres, e um captura.exe só. */
  if (alvo !== 'tudo' && (!Array.isArray(alvo) || alvo.some(id => typeof id !== 'string' || id === ''))) {
    throw new Error('A seleção de som é inválida.');
  }
  if (!Array.isArray(excluidos) || excluidos.some(id => typeof id !== 'string')) {
    throw new Error('A lista de exclusões de som é inválida.');
  }
  if (Array.isArray(alvo)) {
    const nossos = pidsDesteApp();
    alvo = [...new Set(alvo.filter(id => !nossos.has(id)))];
    if (alvo.length === 0) {
      await desligar();
      return { tipo: 'desligado' };
    }
  }
  if (noLinux) {
    const { fonte } = await linux.ligar(alvo, excluidos);
    return { tipo: 'dispositivo', fonte };
  }
  return { tipo: 'pcm', ...(await pcm.ligar(alvo, excluidos, aoReceberPcm)) };
}

function desligar() {
  return Promise.resolve(backend.desligar()).catch(e => console.error(e));
}

module.exports = { recursos, aplicativos, sugestao, ligar, desligar };
