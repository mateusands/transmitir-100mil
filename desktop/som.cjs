/* Porta comum do som por aplicativo, nas três plataformas.
 *
 * O que muda entre elas não é a ideia, é a entrega. No Linux o venmic cria uma
 * entrada de áudio de verdade e a página só a captura. No macOS e no Windows
 * não há dispositivo nenhum: vêm blocos de PCM, que o worklet da página vira
 * faixa. Daí para a frente é indistinguível — inclusive para quem recebe.
 *
 * Em todas, o modelo é o mesmo: vai só o aplicativo escolhido. O que não foi
 * escolhido não entra, e é isso que impede o Discord e as vozes da própria
 * chamada de voltarem para dentro da transmissão.
 */


const linux = require('./som-linux.cjs');
const pcm = require('./som-pcm.cjs');

const noLinux = process.platform === 'linux';
const backend = noLinux ? linux : pcm;

function disponivel() {
  try { return backend.disponivel(); } catch (e) { console.error(e); return false; }
}

/** Aplicativos que podem ter o som levado, como `{ id, nome }`. */
async function aplicativos() {
  try { return await backend.aplicativos(); } catch (e) { console.error(e); return []; }
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
 * Liga o som de um aplicativo.
 *
 * @param id `'tudo'`, ou vindo de aplicativos() — nome do aplicativo no Linux,
 *   PID nas outras
 * @param excluidos o que não deve entrar quando o id é `'tudo'`
 * @param aoReceberPcm chamado a cada bloco, só onde a entrega é por PCM
 * @returns `{ tipo: 'dispositivo', fonte }` ou `{ tipo: 'pcm', taxa, canais }`
 */
async function ligar(id, excluidos, aoReceberPcm) {
  if (noLinux) {
    const { fonte } = await linux.ligar(id, excluidos);
    return { tipo: 'dispositivo', fonte };
  }
  return { tipo: 'pcm', ...(await pcm.ligar(id, excluidos, aoReceberPcm)) };
}

function desligar() {
  return Promise.resolve(backend.desligar()).catch(e => console.error(e));
}

module.exports = { disponivel, aplicativos, sugestao, ligar, desligar };
