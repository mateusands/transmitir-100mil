/* Som por aplicativo no Linux, falando com o PipeWire pelas ferramentas que
 * vêm com ele: pw-dump para ler o grafo, pw-loopback para criar a fonte e
 * pw-link para ligar os fluxos nela. Sem addon nativo, sem binário de
 * terceiro — nada aqui que a gente não possa ler.
 *
 * A ideia é simples e foi medida antes de virar código: um laço de áudio cuja
 * ENTRADA não está ligada em nada, e cuja saída é uma fonte de captura. Depois
 * ligamos nela, porta a porta, só os aplicativos escolhidos. O que não for
 * ligado não entra — não há filtro para falhar, há ausência de fio.
 *
 * Ligar duplica o caminho do som em vez de desviá-lo: o aplicativo continua
 * saindo nos alto-falantes, então quem compartilha continua ouvindo.
 */


const { app } = require('electron');
const { execFile, spawn } = require('node:child_process');

const NOME_CAPTURA = 'transmissor_captura';
const NOME_FONTE = 'transmissor_som';
const DESCRICAO = 'Som do Transmissor';
const VIGIA_MS = 1000;

let laco = null;        // processo pw-loopback
let vigia = null;       // timer que liga fluxos que aparecem depois
let regra = null;       // { alvo, excluidos } enquanto há som indo
let fonteAtual = null;  // rótulo da fonte, para a página achá-la

/* ================= o grafo ================= */

function rodar(cmd, args, maxBuffer = 1 << 20) {
  return new Promise(resolve => {
    execFile(cmd, args, { timeout: 5000, maxBuffer }, (erro, saida) => resolve(erro ? null : String(saida)));
  });
}

/**
 * O grafo do PipeWire, já separado no que interessa.
 *
 * Uma chamada só: pedir nós, portas e ligações em momentos diferentes daria
 * uma foto inconsistente, e ligaríamos porta que acabou de sumir.
 */
async function grafo() {
  const bruto = await rodar('pw-dump', [], 16 << 20);
  if (!bruto) return null;
  let objetos;
  try { objetos = JSON.parse(bruto); } catch { return null; }

  const nos = new Map();
  const portas = [];
  const ligacoes = new Set();

  for (const o of objetos) {
    const props = o?.info?.props || {};
    if (o.type === 'PipeWire:Interface:Node') nos.set(o.id, props);
    else if (o.type === 'PipeWire:Interface:Port') {
      portas.push({ id: o.id, no: props['node.id'], direcao: props['port.direction'], canal: props['audio.channel'] });
    } else if (o.type === 'PipeWire:Interface:Link') {
      const i = o.info || {};
      ligacoes.add(`${i['output-port-id']}:${i['input-port-id']}`);
    }
  }
  return { nos, portas, ligacoes };
}

function disponivel() {
  return process.platform === 'linux';
}

/**
 * O PID que realmente toca o nosso áudio.
 *
 * Não é `process.pid`: no Chromium quem abre o fluxo de saída é um processo
 * separado, o "Audio Service". Excluir o principal não exclui nada.
 */
function nossosPids() {
  try {
    return new Set(app.getAppMetrics().map(p => p.pid).filter(Boolean));
  } catch { return new Set(); }
}

/** Nós de saída de áudio de aplicativos — sem nós, sem os nossos. */
function fluxosDeApp(g) {
  const meus = nossosPids();
  const saida = [];
  for (const [id, props] of g.nos) {
    if (props['media.class'] !== 'Stream/Output/Audio') continue;
    if (meus.has(props['application.process.id'])) continue;
    if (props['node.name'] === NOME_CAPTURA || props['node.name'] === NOME_FONTE) continue;
    const nome = props['application.name'] || props['node.name'];
    if (nome) saida.push({ id, nome, binario: props['application.process.binary'] || null });
  }
  return saida;
}

/** Aplicativos tocando agora, um por nome. Um jogo mudo não aparece. */
async function aplicativos() {
  const g = await grafo();
  if (!g) return [];
  const vistos = new Map();
  for (const f of fluxosDeApp(g)) {
    if (!vistos.has(f.nome)) vistos.set(f.nome, { id: f.nome, nome: f.nome, binario: f.binario });
  }
  return [...vistos.values()];
}

/* ================= o que compartilhar sugere ================= */

/* Saídas de vídeo se chamam assim: DP-1, HDMI-A-1, eDP-1, DVI-D-1, Virtual-1.
   Quando a pista é uma delas, o compartilhado é uma tela inteira. */
const NOME_DE_MONITOR = /^(DP|HDMI-A|HDMI|eDP|LVDS|VGA|DVI(-[ADI])?|Virtual|None)-?\d/i;

/** Casa a pista do compositor ('brave-browser') com um aplicativo ('Brave'). */
function casar(pista, apps) {
  const so = t => String(t || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const alvo = so(pista.replace(/-(browser|bin|desktop)$/, ''));
  // menos de três letras casa com quase tudo, e casar errado manda o som errado
  if (alvo.length < 3) return null;
  return apps.find(({ nome, binario }) => {
    for (const candidato of [so(nome), so(binario)]) {
      if (candidato && candidato.length >= 3 &&
          (alvo.includes(candidato) || candidato.includes(alvo))) return true;
    }
    return false;
  }) || null;
}

/**
 * O que levar, deduzido do que está sendo compartilhado.
 *
 * NÃO usamos o `displaySurface` do navegador, e isso é medido: o portal do KDE
 * devolve fonte com id de `window:` mesmo quando o escolhido é um monitor.
 * Quem sabe a verdade é o compositor — ele batiza o nó da captura com o nome
 * da saída (`DP-1`) para tela inteira, e com o id do aplicativo para janela.
 */
async function sugestao() {
  for (let i = 0; i < 8; i++) {
    const g = await grafo();
    if (g) {
      for (const props of g.nos.values()) {
        const nome = String(props['media.name'] || '');
        if (props['media.class'] !== 'Stream/Output/Video') continue;
        if (!nome.startsWith('kwin-screencast-')) continue;
        const pista = nome.slice('kwin-screencast-'.length);
        if (NOME_DE_MONITOR.test(pista)) return { id: 'tudo', nome: 'tudo' };
        const achado = casar(pista, fluxosDeApp(g));
        return achado ? { id: achado.nome, nome: achado.nome } : { id: 'tudo', nome: 'tudo' };
      }
    }
    await new Promise(r => setTimeout(r, 250));
  }
  return { id: 'tudo', nome: 'tudo' };   // GNOME, X11: sem pista, tudo é o palpite honesto
}

/* ================= a fonte ================= */

/**
 * Sobe o laço que vira a nossa fonte de áudio.
 *
 * `node.autoconnect=false` na captura não é detalhe: sem ele o WirePlumber liga
 * o MICROFONE na nossa entrada por conta própria, e a voz de quem compartilha
 * iria junto com o som do jogo. Isso foi medido, não suposto.
 */
async function garantirFonte() {
  if (fonteAtual) return fonteAtual;

  laco = spawn('pw-loopback', [
    '--capture-props', `{ node.name=${NOME_CAPTURA} node.autoconnect=false node.passive=true }`,
    '--playback-props', `{ media.class=Audio/Source node.name=${NOME_FONTE} node.description="${DESCRICAO}" }`,
  ], { stdio: 'ignore' });
  laco.on('exit', () => { laco = null; });

  for (let i = 0; i < 40; i++) {
    await new Promise(r => setTimeout(r, 150));
    const g = await grafo();
    for (const props of g?.nos.values() || []) {
      if (props['node.name'] === NOME_FONTE) {
        // o rótulo que a página vai procurar é o que o sistema registrou
        fonteAtual = props['node.description'] || DESCRICAO;
        return fonteAtual;
      }
    }
  }
  throw new Error('A fonte de áudio não subiu. O pw-loopback está instalado?');
}

/* ================= as ligações ================= */

/** Portas de um nó, na direção pedida, indexadas por canal. */
function portasDe(g, noId, direcao) {
  return g.portas.filter(p => p.no === noId && p.direcao === direcao);
}

function noPorNome(g, nome) {
  for (const [id, props] of g.nos) if (props['node.name'] === nome) return id;
  return null;
}

/**
 * Liga (e desliga) o que for preciso para o grafo refletir a regra.
 *
 * Reconcilia em vez de só acrescentar: quando você troca de aplicativo ou
 * exclui um, os fios antigos precisam sair — senão o som do anterior continua
 * indo e ninguém percebe.
 */
async function sincronizar() {
  if (!regra) return;
  const g = await grafo();
  if (!g) return;

  const captura = noPorNome(g, NOME_CAPTURA);
  if (captura === null) return;
  const entradas = portasDe(g, captura, 'in');
  if (!entradas.length) return;

  const { alvo, excluidos } = regra;
  const querido = new Set();

  for (const fluxo of fluxosDeApp(g)) {
    const dentro = alvo === 'tudo' ? !excluidos.includes(fluxo.nome) : fluxo.nome === alvo;
    if (!dentro) continue;
    for (const saida of portasDe(g, fluxo.id, 'out')) {
      for (const entrada of entradas) {
        // canal com canal; fonte mono alimenta os dois lados
        if (saida.canal === entrada.canal || saida.canal === 'MONO' || entradas.length === 1) {
          querido.add(`${saida.id}:${entrada.id}`);
        }
      }
    }
  }

  const nossas = new Set();
  for (const chave of g.ligacoes) {
    const entrada = Number(chave.split(':')[1]);
    if (entradas.some(e => e.id === entrada)) nossas.add(chave);
  }

  for (const chave of querido) {
    if (!nossas.has(chave)) await rodar('pw-link', chave.split(':'));
  }
  for (const chave of nossas) {
    if (!querido.has(chave)) await rodar('pw-link', ['-d', ...chave.split(':')]);
  }
}

/**
 * Liga o som e devolve o rótulo da fonte.
 *
 * @param alvo `'tudo'` ou o nome de um aplicativo vindo de aplicativos()
 * @param excluidos nomes que não entram quando o alvo é `'tudo'`
 */
async function ligar(alvo, excluidos = []) {
  const fonte = await garantirFonte();
  regra = { alvo, excluidos };
  await sincronizar();

  /* Fluxo que nasce depois — o jogo que você abre no meio da conversa, ou a
     aba que começa a tocar — não se liga sozinho. O vigia existe para isso, e
     é ele que faz "todo o som" continuar sendo todo o som. */
  if (!vigia) vigia = setInterval(() => { sincronizar().catch(e => console.error(e)); }, VIGIA_MS);
  return { fonte, alvo };
}

async function desligar() {
  regra = null;
  if (vigia) { clearInterval(vigia); vigia = null; }
  fonteAtual = null;
  // matar o laço leva as ligações junto: elas pertencem a ele
  if (laco) { try { laco.kill(); } catch (e) { console.error(e); } laco = null; }
}

module.exports = { disponivel, aplicativos, sugestao, ligar, desligar };
