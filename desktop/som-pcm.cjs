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

let ativo = null;   // { parar() } enquanto há captura

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
 * Começa a capturar e devolve o formato dos blocos, para o worklet montar a
 * faixa. Os blocos chegam em `aoReceber` como Uint8Array.
 */
async function ligar(id, excluidos, aoReceber) {
  await desligar();
  if (!disponivel()) throw new Error('A captura de áudio do Windows não está instalada.');

  /* Não há "tudo menos" no Windows: a API só sabe incluir um processo, e
     capturar o sistema sem filtro devolveria o Discord e as vozes desta
     chamada — justamente o que não pode ir. */
  if (id === 'tudo') {
    throw new Error('No Windows dá para levar o som de um aplicativo por vez, não o de todos.');
  }

  const entregar = fatiador(aoReceber);
  const proc = spawn(CAPTURA, [String(id)], { stdio: ['ignore', 'pipe', 'pipe'] });
  proc.stdout.on('data', entregar);
  proc.stderr.on('data', d => console.error('captura.exe:', String(d).trim()));

  let morreu = null;
  proc.on('exit', codigo => { if (codigo) morreu = codigo; ativo = null; });

  /* O binário só descobre que o PID não serve depois de tentar ativar, e isso
     chega como saída não-zero. Esperar um instante troca um erro dito na cara
     por uma transmissão muda que ninguém entende. */
  await new Promise(r => setTimeout(r, 400));
  if (morreu !== null) throw new Error('Não consegui capturar o som desse aplicativo.');

  ativo = { parar: () => proc.kill() };
  return { taxa: TAXA, canais: CANAIS };
}

async function desligar() {
  if (!ativo) return;
  const parar = ativo.parar;
  ativo = null;
  try { await parar(); } catch (e) { console.error(e); }
}

/* `tudo: false` porque a API do Windows captura um processo por vez. Sem isto
   o menu ofereceria "Levar todo o som" e o clique daria erro. */
function recursos() {
  return { disponivel: disponivel(), tudo: false };
}

module.exports = { recursos, aplicativos, sugestao, ligar, desligar };
