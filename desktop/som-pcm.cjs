/* Som do aplicativo escolhido no macOS e no Windows.
 *
 * Aqui não existe fonte de áudio virtual como no Linux: as bibliotecas nativas
 * entregam blocos de PCM cru, e quem os transforma em faixa é o worklet da
 * página (public/js/pcm-worklet.js).
 *
 * O formato NÃO é suposição — foi lido no fonte das duas:
 *   - Windows: LoopbackCapture.cpp fixa WAVE_FORMAT_PCM, 2 canais, 48000 Hz,
 *     16 bits. É uma porta do exemplo ApplicationLoopback da Microsoft.
 *   - macOS: o AudioFormatConverter do audiotee monta o formato de destino com
 *     kAudioFormatFlagIsSignedInteger, então pedir uma taxa garante inteiro de
 *     16 bits. Vem em 1 canal.
 *
 * As duas usam a API que o próprio sistema criou para isto — WASAPI process
 * loopback e Core Audio process taps — e ambas exigem sistema recente.
 */


const { app } = require('electron');
const { execFile } = require('node:child_process');

const TAXA = 48000;
const FORMATO = {
  darwin: { taxa: TAXA, canais: 1 },
  win32: { taxa: TAXA, canais: 2 },
};

let ativo = null;   // { parar() } enquanto há captura

function disponivel() {
  const f = FORMATO[process.platform];
  if (!f) return false;
  try { require(process.platform === 'darwin' ? 'audiotee' : 'application-loopback'); return true; }
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

/* ================= macOS ================= */

/**
 * Aplicativos com janela, que é o que dá para saber sem código nativo.
 *
 * O audiotee captura por PID mas não lista nada, e não há API no Electron que
 * diga quem está tocando. Então a lista é de aplicativos abertos, não de
 * aplicativos com som — escolher um que está mudo devolve erro em vez de
 * silêncio, e é assim que a pessoa descobre.
 */
function aplicativosMac() {
  return new Promise(resolve => {
    execFile('ps', ['-axo', 'pid=,comm='], { maxBuffer: 4 << 20 }, (erro, saida) => {
      if (erro) return resolve([]);
      const vistos = new Map();
      for (const linha of String(saida).split('\n')) {
        const m = linha.trim().match(/^(\d+)\s+(.*\/([^/]+)\.app\/Contents\/MacOS\/.+)$/);
        if (!m) continue;
        const nome = m[3];
        if (!vistos.has(nome)) vistos.set(nome, { id: m[1], nome });
      }
      resolve([...vistos.values()]);
    });
  });
}

/** Os PIDs que tocam o nosso próprio áudio — nunca podem entrar na captura. */
function nossosPids() {
  try { return app.getAppMetrics().map(p => p.pid).filter(Boolean); } catch { return []; }
}

async function ligarMac(alvo, excluidos, aoReceber) {
  const { AudioTee } = require('audiotee');

  /* 'tudo' vira exclusão por PID: o audiotee aceita vários. Traduzimos os
     nomes excluídos para PID agora, porque é o que ele entende — e porque o
     PID de ontem não serve para o processo de hoje. */
  let opcoes;
  if (alvo === 'tudo') {
    const abertos = await aplicativosMac();
    const fora = abertos.filter(a => excluidos.includes(a.nome)).map(a => Number(a.id));
    opcoes = { excludeProcesses: [...nossosPids(), ...fora] };
  } else {
    opcoes = { includeProcesses: [Number(alvo)] };
  }

  // pedir a taxa é o que força a conversão para inteiro de 16 bits
  const tee = new AudioTee({ sampleRate: TAXA, ...opcoes });
  const entregar = fatiador(aoReceber);

  let falha = null;
  tee.on('error', e => { falha = e; console.error('audiotee:', e.message); });
  tee.on('data', pedaco => entregar(pedaco.data));
  await tee.start();

  /* O binário morre se o PID escolhido não estiver tocando nada, e isso chega
     depois do start(). Esperar um pouco troca um erro dito na cara por uma
     transmissão muda que ninguém entende. */
  await new Promise(r => setTimeout(r, 600));
  if (falha) { try { await tee.stop(); } catch {} throw new Error(`${falha.message} — esse aplicativo está tocando algo?`); }

  ativo = { parar: () => tee.stop() };
  return FORMATO.darwin;
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

/* ================= porta comum ================= */

function aplicativos() {
  if (process.platform === 'darwin') return aplicativosMac();
  if (process.platform === 'win32') return aplicativosWin();
  return Promise.resolve([]);
}

/**
 * Começa a capturar e devolve o formato dos blocos, para o worklet montar a
 * faixa. Os blocos chegam em `aoReceber` como Uint8Array.
 */
async function ligar(id, excluidos = [], aoReceber) {
  await desligar();
  if (process.platform === 'darwin') return ligarMac(id, excluidos, aoReceber);
  if (process.platform === 'win32') return ligarWin(id, aoReceber);
  throw new Error('Esta plataforma não tem captura por aplicativo.');
}

async function desligar() {
  if (!ativo) return;
  const parar = ativo.parar;
  ativo = null;
  try { await parar(); } catch (e) { console.error(e); }
}

module.exports = { disponivel, aplicativos, ligar, desligar };
