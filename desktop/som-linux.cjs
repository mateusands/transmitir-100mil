/* Som do sistema no Linux, sem tirar o áudio de quem compartilha.
 *
 * O Chromium esconde os monitores do PipeWire da lista de entradas, então
 * "escolha o monitor como microfone" não é possível: ele nem aparece. Daí os
 * dois caminhos daqui — remap-source para tudo, pw-loopback para um aplicativo.
 *
 * O pw-loopback LIGA a saída do aplicativo à nossa fonte em vez de desviá-la:
 * `pw-link -l` mostra os dois destinos, e por isso quem compartilha continua
 * ouvindo, sem atraso e sem ficar mudo se o app fechar.
 */


const { execFile, spawn } = require('node:child_process');
const path = require('node:path');

const NOME_FONTE = 'transmissor_som';
const DESCRICAO = 'Som do sistema (Transmissor)';
const NOSSO_BINARIO = path.basename(process.execPath);

let modulo = null;     // id do module-remap-source, quando é "tudo"
let processo = null;   // pw-loopback, quando é um aplicativo só

function pactl(args) {
  return new Promise((resolve, reject) => {
    // LC_ALL=C porque lemos rótulos da saída ('Description:'); traduzido, o parser cega
    const opcoes = { timeout: 5000, env: { ...process.env, LC_ALL: 'C' } };
    execFile('pactl', args, opcoes, (erro, saida) => {
      if (erro) reject(erro); else resolve(String(saida).trim());
    });
  });
}

async function disponivel() {
  if (process.platform !== 'linux') return false;
  try { await pactl(['--version']); return true; } catch { return false; }
}

/** Aplicativos com fluxo de áudio aberto agora. Um jogo mudo não aparece. */
async function aplicativos() {
  try {
    const bruto = await pactl(['list', 'sink-inputs']);
    const vistos = new Map();
    for (const bloco of bruto.split(/Sink Input #/).slice(1)) {
      const nome = bloco.match(/application\.name = "(.+)"/)?.[1];
      const no = bloco.match(/node\.name = "(.+)"/)?.[1];
      if (!no || !nome) continue;
      const binario = bloco.match(/application\.process\.binary = "(.+)"/)?.[1];

      // capturar a nossa própria saída devolveria à chamada o que ela está
      // tocando: a voz dos outros voltaria como "som da tela"
      if (binario === NOSSO_BINARIO || nome === 'WEBRTC VoiceEngine') continue;
      if (nome === DESCRICAO || no === NOME_FONTE) continue;
      if (!vistos.has(no)) vistos.set(no, { no, nome, binario });
    }
    return [...vistos.values()];
  } catch { return []; }
}

/**
 * Espera a fonte subir (o pw-loopback é assíncrono) e devolve a descrição que
 * o sistema REGISTROU — não a que pedimos.
 *
 * A página acha o dispositivo pelo rótulo, e o rótulo é esta descrição. Já
 * divergiu: o `pactl load-module` cortava a descrição no primeiro espaço, a
 * fonte subia com o nome certo, e o erro só aparecia do outro lado, na página,
 * como "não encontrei a fonte". Quem sabe o rótulo verdadeiro é quem o lê aqui.
 */
async function esperarFonte(tentativas = 25) {
  for (let i = 0; i < tentativas; i++) {
    try {
      const bloco = (await pactl(['list', 'sources']))
        .split(/^Source #/m)
        .find(b => new RegExp(`^\\s*Name: ${NOME_FONTE}$`, 'm').test(b));
      const descricao = bloco?.match(/^\s*Description: (.+)$/m)?.[1];
      if (descricao) return descricao;
    } catch { /* tenta de novo */ }
    await new Promise(r => setTimeout(r, 200));
  }
  return null;
}

/**
 * O que o compositor está capturando, segundo o próprio PipeWire.
 *
 * O KWin batiza o nó da captura como `kwin-screencast-<id do aplicativo>` —
 * é a única pista de qual janela foi escolhida, já que o portal devolve ao
 * navegador uma faixa de rótulo vazio. Tela inteira não casa com aplicativo
 * nenhum, e é isso que faz o automático cair em "tudo" sem precisar saber
 * como o compositor nomeia esse caso.
 *
 * Devolve null em qualquer outro ambiente (GNOME, X11), e aí o automático
 * também cai em "tudo".
 */
async function pistaDaCaptura() {
  for (let i = 0; i < 8; i++) {
    try {
      const dump = JSON.parse(await new Promise((ok, falha) =>
        execFile('pw-dump', { maxBuffer: 8 << 20 }, (e, s) => e ? falha(e) : ok(s))));
      for (const objeto of dump) {
        const props = objeto?.info?.props || {};
        const nome = String(props['media.name'] || '');
        if (props['media.class'] === 'Stream/Output/Video' && nome.startsWith('kwin-screencast-')) {
          return nome.slice('kwin-screencast-'.length);
        }
      }
    } catch { /* pw-dump pode não existir */ }
    await new Promise(r => setTimeout(r, 250));
  }
  return null;
}

/** Casa a pista do compositor ('brave-browser') com um aplicativo tocando ('Brave'). */
function casar(pista, apps) {
  const so = t => String(t || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const alvo = so(pista.replace(/-(browser|bin|desktop)$/, ''));
  if (!alvo) return null;
  return apps.find(({ nome, binario }) => {
    for (const candidato of [so(nome), so(binario)]) {
      if (candidato && (alvo.includes(candidato) || candidato.includes(alvo))) return true;
    }
    return false;
  }) || null;
}

/**
 * Liga o som sozinho, no escopo do que está sendo compartilhado: janela de um
 * aplicativo leva o som dele, tela inteira leva tudo.
 */
async function ligarAutomatico() {
  const pista = await pistaDaCaptura();
  const apps = await aplicativos();
  const escolhido = pista ? casar(pista, apps) : null;

  if (escolhido) {
    const { fonte } = await ligar(escolhido.no);
    return { fonte, escopo: `o som de ${escolhido.nome}`, alvo: escolhido.no };
  }
  const { fonte } = await ligar('tudo');
  return { fonte, escopo: 'todo o som', alvo: 'tudo' };
}

/**
 * Cria a fonte de áudio e devolve seu rótulo, para a página achá-la entre os
 * dispositivos. Substitui a anterior, se houver.
 *
 * @param alvo 'tudo' (a saída inteira) ou o node.name vindo de aplicativos().
 *   Por aplicativo, não por aba: as abas do navegador dividem um nó só.
 */
async function ligar(alvo = 'tudo') {
  await desligar();

  if (alvo === 'tudo') {
    const saida = await pactl(['get-default-sink']);
    if (!saida || saida === '@DEFAULT_SINK@') {
      throw new Error('Não consegui descobrir a saída de áudio padrão.');
    }
    // presa à saída deste instante: trocar de fone depois não muda o que sai
    modulo = await pactl([
      'load-module', 'module-remap-source',
      `master=${saida}.monitor`,
      `source_name=${NOME_FONTE}`,
      // a lista inteira entre aspas: o parser de módulo do pipewire-pulse quebra
      // o argumento nos espaços ANTES de honrar as aspas de dentro, e a descrição
      // chegava truncada no primeiro espaço ('Som')
      `source_properties='device.description="${DESCRICAO}"'`,
    ]);
  } else {
    processo = spawn('pw-loopback', [
      '--capture-props', `{ target.object="${alvo}" stream.dont-remix=true node.passive=true }`,
      '--playback-props', `{ media.class=Audio/Source node.name=${NOME_FONTE} node.description="${DESCRICAO}" }`,
    ], { stdio: 'ignore' });
    processo.on('exit', () => { processo = null; });
  }

  const fonte = await esperarFonte();
  if (!fonte) {
    await desligar();
    throw new Error('A fonte de áudio não subiu. O aplicativo ainda está tocando?');
  }
  return { fonte, alvo };
}

async function desligar() {
  if (processo) { try { processo.kill(); } catch {} processo = null; }
  if (modulo) {
    const id = modulo;
    modulo = null;
    try { await pactl(['unload-module', id]); } catch { /* já não existe */ }
  }
}

/** Limpa fontes deixadas por uma sessão morta à força; elas se acumulariam. */
async function varrerSobras() {
  try {
    for (const linha of (await pactl(['list', 'short', 'modules'])).split('\n')) {
      if (!linha.includes(NOME_FONTE)) continue;
      try { await pactl(['unload-module', linha.split('\t')[0]]); } catch {}
    }
  } catch { /* sem pactl, nada a varrer */ }

  // o padrão inclui nosso nome de nó: não derruba loopback de terceiro
  await new Promise(resolve => {
    execFile('pkill', ['-f', `node.name=${NOME_FONTE}`], () => resolve());
  });
}

module.exports = { disponivel, aplicativos, ligar, ligarAutomatico, desligar, varrerSobras };
