/* Som do aplicativo escolhido no Windows, pelos nossos próprios binários.
 *
 * Aqui não existe fonte de áudio virtual como no Linux: a captura entrega
 * blocos de PCM cru, e quem os transforma em faixa é o worklet da página
 * (public/js/pcm-worklet.js).
 *
 * Os dois executáveis vivem em desktop/nativo/win/, versionados, e saem do
 * fonte que está ao lado deles — `npm run compilar-windows` regenera os dois.
 * Não há biblioteca de terceiro no caminho: o `captura.exe` é uma versão enxuta
 * do exemplo ApplicationLoopback da Microsoft (MIT), sem o Media Foundation e
 * sem a WIL, e o `janelas.exe` é um EnumWindows.
 *
 * O formato é fixo e conhecido, porque é o nosso código que o fixa:
 * PCM 16 bits com sinal, 2 canais, 48000 Hz, intercalado.
 *
 * macOS ainda não tem som por aplicativo. O caminho existe — Core Audio
 * process taps, macOS 14.2+ — mas exige um binário que precisamos escrever e,
 * principalmente, PODER TESTAR num Mac. Enquanto isso, `disponivel` devolve
 * false lá e a opção nem aparece, o que é melhor que oferecer e falhar.
 */


const { spawn, execFile } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const TAXA = 48000;
const CANAIS = 2;

const PASTA = path.join(__dirname, 'nativo', 'win');
const CAPTURA = path.join(PASTA, 'captura.exe');
const JANELAS = path.join(PASTA, 'janelas.exe');

const AMOSTRAS_POR_BLOCO = TAXA / 100;
const BYTES_POR_BLOCO = AMOSTRAS_POR_BLOCO * CANAIS * 2;

let ativo = null;   // { processos, entregar, timer } enquanto há captura

let avisou = false;

/**
 * Só no Windows, e só se os binários estiverem no lugar.
 *
 * Eles vêm versionados, então normalmente estão. Se alguém os apagar, ou se
 * este repositório for consumido sem eles, a opção de som some — e sumir calado
 * faz parecer defeito. Então dizemos o que falta e como resolver, uma vez só:
 * isto é chamado a cada carga da página.
 */
function disponivel() {
  if (process.platform !== 'win32') return false;
  if (fs.existsSync(CAPTURA) && fs.existsSync(JANELAS)) return true;

  if (!avisou) {
    avisou = true;
    console.warn(
      `Som por aplicativo indisponível: faltam os binários em ${PASTA}.\n` +
      'Regenere com `npm run compilar-windows`, de qualquer Linux ou macOS — o\n' +
      'fonte deles está nessa mesma pasta. Compartilhar tela funciona sem eles.');
  }
  return false;
}

/**
 * Entrega os bytes como Uint8Array próprio.
 *
 * Duas armadilhas de uma vez. O Buffer do Node é uma janela sobre um bloco
 * compartilhado: passar `.buffer` mandaria junto o resto do bloco, com dados de
 * terceiros. E o PCM é de 16 bits — o cano pode cortar no meio de uma amostra,
 * e descartar o byte solto deslocaria TODAS as seguintes em meio sample, o que
 * não soa como falha, soa como ruído. O resto fica para o próximo bloco.
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

function somar(destino, origem) {
  for (let i = 0; i < BYTES_POR_BLOCO; i += 2) {
    const soma = destino.readInt16LE(i) + origem.readInt16LE(i);
    destino.writeInt16LE(Math.max(-32768, Math.min(32767, soma)), i);
  }
}

function misturar(captura) {
  const bloco = Buffer.alloc(BYTES_POR_BLOCO);
  for (const fluxo of captura.processos.values()) {
    /* Menos de 10 ms neste tick conta 0: somar o resto curto
       dessincroniza os outros captura.exe. Byte ímpar já ficou no fatiador. */
    if (fluxo.bytes.length < BYTES_POR_BLOCO) continue;
    const parte = fluxo.bytes.subarray(0, BYTES_POR_BLOCO);
    fluxo.bytes = fluxo.bytes.subarray(BYTES_POR_BLOCO);
    somar(bloco, parte);
  }
  captura.entregar(new Uint8Array(bloco));
}

async function iniciarCaptura(captura, id) {
  id = String(id);
  const fluxo = { bytes: Buffer.alloc(0), processo: null, morreu: null };
  const entregar = fatiador(bytes => { fluxo.bytes = Buffer.concat([fluxo.bytes, Buffer.from(bytes)]); });
  const proc = spawn(CAPTURA, [id], { stdio: ['ignore', 'pipe', 'pipe'] });
  fluxo.processo = proc;
  captura.processos.set(id, fluxo);
  proc.stdout.on('data', entregar);
  proc.stderr.on('data', d => console.error('captura.exe:', String(d).trim()));
  proc.on('exit', codigo => {
    fluxo.morreu = codigo;
    if (captura.processos.get(id) === fluxo) captura.processos.delete(id);
  });

  // O binário só descobre PID inválido depois de tentar ativá-lo.
  await new Promise(r => setTimeout(r, 400));
  if (fluxo.morreu !== null) {
    if (captura.processos.get(id) === fluxo) captura.processos.delete(id);
    throw new Error(`Não consegui capturar o som de ${id}.`);
  }
}

function pararCaptura(captura, id) {
  id = String(id);
  const fluxo = captura.processos.get(id);
  if (!fluxo) return;
  captura.processos.delete(id);
  try { fluxo.processo.kill(); } catch (e) { console.error(e); }
}

/**
 * Janelas visíveis e o processo dono de cada uma.
 *
 * É a lista de aplicativos ABERTOS, não de aplicativos tocando: a captura é por
 * PID e o Windows não diz quem tem som sem mais código nativo. Escolher um que
 * está mudo devolve silêncio, não erro.
 */
function aplicativos() {
  if (!disponivel()) return Promise.resolve([]);
  return new Promise(resolve => {
    execFile(JANELAS, { timeout: 5000, maxBuffer: 4 << 20 }, (erro, saida) => {
      if (erro) return resolve([]);
      const itens = [];
      for (const linha of String(saida).split('\n')) {
        const corte = linha.indexOf('\t');
        if (corte < 1) continue;
        const id = linha.slice(0, corte).trim();
        const nome = linha.slice(corte + 1).trim();
        if (id && nome) itens.push({ id, nome });
      }
      return resolve(itens);
    });
  });
}

/**
 * O que levar, deduzido do que está sendo compartilhado.
 *
 * Não existe "tudo" aqui: a API captura um processo por vez. Casamos o título
 * da janela compartilhada com a lista de janelas abertas; sem casar, não
 * sugerimos nada e a pessoa escolhe no menu.
 */
async function sugestao(superficie, nomeDaFonte) {
  if (!disponivel() || superficie !== 'window' || !nomeDaFonte) return null;
  return (await aplicativos()).find(j => j.nome === nomeDaFonte) || null;
}

/**
 * Ajusta as capturas por PID sem trocar a entrega PCM que a página já ligou.
 */
async function ligar(alvo, excluidos, aoReceber) {
  if (!disponivel()) throw new Error('A captura de áudio do Windows não está instalada.');

  /* Não há "tudo menos" no Windows: a API só sabe incluir um processo, e
     capturar o sistema sem filtro devolveria o Discord e as vozes desta
     chamada — justamente o que não pode ir. */
  if (alvo === 'tudo') {
    throw new Error('No Windows não dá para levar todo o som; escolha os aplicativos.');
  }
  if (!Array.isArray(alvo)) {
    throw new Error('A seleção de som é inválida.');
  }

  /* Religar o conjunto não troca a entrega: a página assinou o PCM uma vez
     e a faixa WebRTC já existe. Trocar o callback ou chamar desligar()
     derrubaria a faixa ao marcar o segundo app. */
  if (!ativo) {
    const captura = { processos: new Map(), entregar: aoReceber, timer: null };
    captura.timer = setInterval(() => misturar(captura), 10);
    ativo = captura;
  }
  const desejados = new Set(alvo.map(String));
  for (const id of [...ativo.processos.keys()]) {
    if (!desejados.has(id)) pararCaptura(ativo, id);
  }
  for (const id of desejados) {
    if (!ativo.processos.has(id)) await iniciarCaptura(ativo, id);
  }
  return { taxa: TAXA, canais: CANAIS };
}

async function desligar() {
  if (!ativo) return;
  const captura = ativo;
  ativo = null;
  clearInterval(captura.timer);
  for (const id of [...captura.processos.keys()]) pararCaptura(captura, id);
}

/* `tudo: false` porque a API do Windows captura um processo por vez. Sem isto
   o menu ofereceria "Levar todo o som" e o clique daria erro. */
function recursos() {
  return { disponivel: disponivel(), tudo: false };
}

module.exports = { recursos, aplicativos, sugestao, ligar, desligar };
