/* Som do aplicativo escolhido no Windows.
 *
 * Aqui não existe fonte de áudio virtual como no Linux: a biblioteca nativa
 * entrega blocos de PCM cru, e quem os transforma em faixa é o worklet da
 * página (public/js/pcm-worklet.js).
 *
 * O formato NÃO é suposição — foi lido no fonte: LoopbackCapture.cpp fixa
 * WAVE_FORMAT_PCM, 2 canais, 48000 Hz, 16 bits. É a API que a própria
 * Microsoft criou para isto, o WASAPI process loopback.
 *
 * macOS ainda não tem som por aplicativo. O caminho existe — Core Audio
 * process taps, macOS 14.2+ — mas exige um binário Swift que precisamos
 * escrever e, principalmente, PODER TESTAR num Mac. Enquanto isso, `disponivel`
 * devolve false lá e a opção nem aparece, o que é melhor que oferecer e falhar.
 */


const TAXA = 48000;
const FORMATO = { win32: { taxa: TAXA, canais: 2 } };

let ativo = null;   // { parar() } enquanto há captura

function disponivel() {
  const f = FORMATO[process.platform];
  if (!f) return false;
  try { require('application-loopback'); return true; }
  catch (e) { console.error('captura de áudio não carregou:', e.message); return false; }
}

/**
 * Entrega os bytes como ArrayBuffer próprio.
 *
 * Duas armadilhas de uma vez. O Buffer do Node é uma janela sobre um bloco
 * compartilhado: passar `.buffer` mandaria junto o resto do bloco, com dados
 * de terceiros. E o PCM é de 16 bits — se um bloco terminar num byte solto,
 * cortar esse byte deslocaria TODAS as amostras seguintes em meio sample, o
 * que não soa como falha, soa como ruído. O resto fica para o próximo bloco.
 */
function fatiador(aoReceber) {
  let sobra = null;
  return bytes => {
    let dados = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (sobra) { dados = Buffer.concat([sobra, dados]); sobra = null; }
    if (dados.length % 2) {
      sobra = Buffer.from(dados.subarray(dados.length - 1));
      dados = dados.subarray(0, dados.length - 1);
    }
    if (dados.length) aoReceber(new Uint8Array(dados));   // cópia, desprendida do bloco
  };
}

/* ================= Windows ================= */

async function aplicativosWin() {
  const lib = require('application-loopback');
  const janelas = await lib.getActiveWindowProcessIds();
  const vistos = new Map();
  for (const j of janelas) {
    // uma janela por aplicativo: um navegador com cinco janelas viraria cinco itens
    if (!j.title || vistos.has(j.processId)) continue;
    vistos.set(j.processId, { id: String(j.processId), nome: j.title });
  }
  return [...vistos.values()];
}

function ligarWin(processId, aoReceber) {
  /* O application-loopback só sabe INCLUIR um processo, ou capturar o sistema
     inteiro sem filtro nenhum. "Tudo menos" exigiria o modo exclude da API do
     Windows, que ele não expõe — e capturar tudo sem filtro devolveria o
     Discord e as vozes desta chamada, que é justamente o que não pode. */
  if (processId === 'tudo') {
    throw new Error('No Windows dá para levar o som de um aplicativo por vez, não o de todos.');
  }
  const lib = require('application-loopback');
  const entregar = fatiador(aoReceber);
  const id = String(processId);
  lib.startAudioCapture(id, { onData: dados => entregar(dados) });
  ativo = { parar: () => lib.stopAudioCapture(id) };
  return FORMATO.win32;
}

/**
 * O que levar, deduzido do que está sendo compartilhado.
 *
 * No macOS a tela inteira leva tudo; para uma janela não temos como saber de
 * quem ela é sem codigo nativo, e "tudo" e um palpite honesto — som demais se
 * corrige em um clique, silencio ninguem entende.
 *
 * No Windows nao existe "tudo": so da para incluir um processo. Tentamos casar
 * o titulo da janela compartilhada com a lista de janelas abertas; sem casar,
 * nao sugerimos nada e a pessoa escolhe no menu.
 */
async function sugestao(superficie, nomeDaFonte) {
  if (process.platform !== 'win32') return null;
  if (superficie !== 'window' || !nomeDaFonte) return null;

  const achado = (await aplicativosWin()).find(j => j.nome === nomeDaFonte);
  return achado || null;
}

/* ================= porta comum ================= */

function aplicativos() {
  if (process.platform === 'win32') return aplicativosWin();
  return Promise.resolve([]);
}

/**
 * Começa a capturar e devolve o formato dos blocos, para o worklet montar a
 * faixa. Os blocos chegam em `aoReceber` como Uint8Array.
 */
async function ligar(id, excluidos = [], aoReceber) {
  await desligar();
  if (process.platform === 'win32') return ligarWin(id, aoReceber);
  throw new Error('Esta plataforma não tem captura por aplicativo.');
}

async function desligar() {
  if (!ativo) return;
  const parar = ativo.parar;
  ativo = null;
  try { await parar(); } catch (e) { console.error(e); }
}

module.exports = { disponivel, aplicativos, sugestao, ligar, desligar };
