/* Som do aplicativo compartilhado, no Linux, pelo venmic (PipeWire).
 *
 * Modelo "include": ligamos na fonte virtual SÓ o aplicativo escolhido. É o
 * que impede o Discord e as vozes da nossa própria chamada de vazarem — elas
 * não são filtradas depois, elas nunca entram. O modelo anterior capturava o
 * monitor da saída padrão e levava tudo junto; não havia parâmetro que
 * consertasse aquilo.
 *
 * Por que venmic e não pw-loopback na mão: um aplicativo pode ter vários
 * fluxos de áudio ao mesmo tempo (um navegador abre um por contexto) e abrir
 * outros depois que a captura já começou. O venmic casa por propriedade e
 * religa sozinho. O `target.object` do pw-loopback prende um nó só, o primeiro
 * que existir — o segundo fluxo ficaria mudo, sem aviso nenhum.
 */


const { app } = require('electron');
const { execFile } = require('node:child_process');
const path = require('node:path');

let PatchBay = null;   // classe do addon, carregada uma vez
let bay = null;        // instância viva enquanto há som indo
let carregou = false;
let fonteAtual = null; // rótulo da fonte enquanto ela existe

/**
 * Carrega o addon de `desktop/nativo/`, não do npm.
 *
 * O pacote @vencord/venmic declara o cmake-js como dependência de RUNTIME, e
 * ele arrasta 71 pacotes que nunca executam — o binário já vem pronto, o
 * cmake-js só serviria para compilar. Versionar o `.node` (enxuto, 1,8 MB por
 * arquitetura) sai mais barato para quem instala. `tools/atualizar-venmic.mjs`
 * regenera os arquivos.
 */
function carregar() {
  if (carregou) return;
  carregou = true;
  const arquivo = path.join(__dirname, 'nativo', `venmic-linux-${process.arch}.node`);
  try { ({ PatchBay } = require(arquivo)); }
  catch (e) { console.error('venmic não carregou:', e.message); }
}

function disponivel() {
  if (process.platform !== 'linux') return false;
  carregar();
  try { return !!PatchBay?.hasPipeWire(); } catch { return false; }
}

function instancia() {
  carregar();
  if (!PatchBay) return null;
  if (!bay) { try { bay = new PatchBay(); } catch (e) { console.error(e); return null; } }
  return bay;
}

/**
 * O PID que realmente toca o nosso áudio.
 *
 * Não é `process.pid`: no Chromium quem abre o fluxo de saída é um processo
 * separado, o "Audio Service". Excluir o processo principal não exclui nada.
 */
function nossoPid() {
  try {
    return app.getAppMetrics().find(p => p.name === 'Audio Service')?.pid?.toString() || null;
  } catch { return null; }
}

/* Mesmo no modelo include vale excluir: se alguém escolher um aplicativo que
   por acaso se chame como nós, a exclusão desempata a favor do silêncio. */
function nossosNos() {
  const pid = nossoPid();
  return pid ? [{ 'application.process.id': pid }] : [];
}

/**
 * Aplicativos com áudio tocando agora, um por nome. Um jogo mudo não aparece —
 * o PipeWire só conhece quem tem fluxo aberto.
 *
 * `list()` sem argumento de propósito: o venmic não usa a lista de propriedades
 * para escolher o que devolver, e sim para FILTRAR os nós que têm todas elas —
 * e devolve o nó inteiro de qualquer jeito. Pedir `application.process.binary`
 * escondia calado todo aplicativo que não expõe essa chave, que é opcional.
 * Medido: 7 nós sem argumento, 1 nó pedindo as cinco propriedades.
 */
function aplicativos() {
  const b = instancia();
  if (!b) return [];
  const meu = nossoPid();
  const vistos = new Map();

  for (const no of b.list()) {
    if (no['media.class'] !== 'Stream/Output/Audio') continue;
    if (meu && no['application.process.id'] === meu) continue;
    const nome = no['application.name'] || no['node.name'];
    if (!nome || vistos.has(nome)) continue;
    // id é o próprio nome: é por application.name que o venmic casa os fluxos
    vistos.set(nome, { id: nome, nome, binario: no['application.process.binary'] || null });
  }
  return [...vistos.values()];
}

/**
 * Qual janela o compositor está capturando, segundo o próprio PipeWire.
 *
 * O KWin batiza o nó da captura como `kwin-screencast-<id do aplicativo>` — é
 * a única pista disponível, porque o portal devolve ao navegador uma faixa de
 * rótulo vazio. Em GNOME ou X11 volta null, e aí o automático cai em "tudo",
 * que é um palpite honesto: quem compartilha uma janela e recebe o som da
 * máquina corrige em um clique; quem recebe silêncio não sabe o que houve.
 */
function pistaDaCaptura() {
  return new Promise(resolve => {
    execFile('pw-dump', { maxBuffer: 8 << 20 }, (erro, saida) => {
      if (erro) return resolve(null);
      try {
        for (const objeto of JSON.parse(saida)) {
          const props = objeto?.info?.props || {};
          const nome = String(props['media.name'] || '');
          if (props['media.class'] === 'Stream/Output/Video' && nome.startsWith('kwin-screencast-')) {
            return resolve(nome.slice('kwin-screencast-'.length));
          }
        }
      } catch { /* pw-dump devolveu algo que não é JSON */ }
      resolve(null);
    });
  });
}

/* Saídas de vídeo se chamam assim: DP-1, HDMI-A-1, eDP-1, DVI-D-1, Virtual-1.
   Quando a pista é uma delas, o que está sendo compartilhado é uma tela
   inteira — e aí o som é o da máquina toda. */
const NOME_DE_MONITOR = /^(DP|HDMI-A|HDMI|eDP|LVDS|VGA|DVI(-[ADI])?|Virtual|None)-?\d/i;

/** Casa a pista do compositor ('brave-browser') com um aplicativo tocando ('Brave'). */
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
 * O que levar, deduzido do que está sendo compartilhado: a tela toda leva o som
 * da máquina, uma janela leva o som de quem é dono dela.
 *
 * NÃO usamos o `displaySurface` do navegador aqui, e isso é medido: o portal do
 * KDE devolve uma fonte com id de `window:` mesmo quando o escolhido é um
 * monitor, e o Electron repassa `displaySurface: 'window'`. Quem sabe a verdade
 * é o compositor — a pista dele para uma tela é o nome da saída (`DP-1`), e
 * para uma janela é o id do aplicativo.
 *
 * A captura demora a aparecer no grafo do PipeWire, então tentamos algumas
 * vezes: desistir cedo cairia em "tudo" mesmo quando havia janela para achar.
 */
async function sugestao() {
  for (let i = 0; i < 8; i++) {
    const pista = await pistaDaCaptura();
    if (pista) {
      if (NOME_DE_MONITOR.test(pista)) break;               // tela inteira
      const achado = casar(pista, aplicativos());
      if (achado) return { id: achado.id, nome: achado.nome };
      break;   // é uma janela, mas o dono dela não está tocando nada
    }
    await new Promise(r => setTimeout(r, 250));
  }
  return { id: 'tudo', nome: 'tudo' };
}

function pactl(args) {
  return new Promise(resolve => {
    // LC_ALL=C porque lemos rótulos da saída; traduzida, a leitura cega
    execFile('pactl', args, { timeout: 5000, env: { ...process.env, LC_ALL: 'C' } },
      (erro, saida) => resolve(erro ? '' : String(saida)));
  });
}

function nomesDasFontes(bruto) {
  return new Set([...bruto.matchAll(/^\s*Name: (.+)$/gm)].map(m => m[1]));
}

/**
 * Espera a fonte do venmic subir e devolve o rótulo com que a página vai
 * achá-la em `enumerateDevices`.
 *
 * Descobre qual é comparando com as fontes de antes, em vez de assumir o nome:
 * hoje o venmic batiza o nó de `vencord-screen-share`, e isso é detalhe dele,
 * não contrato nosso. Confiar num rótulo suposto já custou caro aqui — o certo
 * é ler o que o sistema registrou.
 */
async function esperarFonteNova(antes, tentativas = 25) {
  for (let i = 0; i < tentativas; i++) {
    const bruto = await pactl(['list', 'sources']);
    for (const bloco of bruto.split(/^Source #/m)) {
      const nome = bloco.match(/^\s*Name: (.+)$/m)?.[1];
      if (!nome || antes.has(nome)) continue;
      const descricao = bloco.match(/^\s*Description: (.+)$/m)?.[1];
      if (descricao) return descricao;
    }
    await new Promise(r => setTimeout(r, 200));
  }
  return null;
}

/**
 * A regra de captura.
 *
 * `'tudo'` leva o som da máquina inteira menos o que estiver na exclusão — e
 * nós estamos sempre nela, senão as vozes desta chamada voltariam com atraso.
 * Um nome de aplicativo leva só ele, e aí nada mais entra por definição.
 */
function montarRegra(alvo, excluidos) {
  // mute:false de propósito: quem compartilha continua ouvindo o próprio jogo.
  // Com mute:true o venmic silencia o aplicativo na máquina de quem transmite
  const base = { mute: false, exclude: nossosNos() };
  if (alvo === 'tudo') {
    base.include = [];
    for (const nome of excluidos) base.exclude.push({ 'application.name': nome });
    return base;
  }
  return { ...base, include: [{ 'application.name': alvo }] };
}

/**
 * Liga o som e devolve o rótulo da fonte, para a página achá-la.
 *
 * @param alvo `'tudo'` ou o `application.name` vindo de aplicativos()
 * @param excluidos nomes que não devem entrar quando o alvo é `'tudo'`
 */
async function ligar(alvo, excluidos = []) {
  const b = instancia();
  if (!b) throw new Error('O venmic não está disponível nesta máquina.');
  const regra = montarRegra(alvo, excluidos);

  /* Já ligado: trocar a regra NÃO derruba a fonte — o link() do venmic
     substitui o roteamento e o dispositivo continua o mesmo. Isso é o que
     permite trocar de aplicativo, ou mexer na exclusão, sem que a faixa morra
     e precise renegociar com todo mundo. Derrubar aqui era o caminho para o
     stream ficar com faixa velha e muda na frente da nova. */
  if (fonteAtual) {
    if (!b.link(regra)) throw new Error('Não consegui trocar a fonte do som.');
    return { fonte: fonteAtual, alvo };
  }

  const antes = nomesDasFontes(await pactl(['list', 'sources']));
  if (!b.link(regra)) throw new Error('Não consegui ligar o som.');

  const fonte = await esperarFonteNova(antes);
  if (!fonte) {
    await desligar();
    throw new Error('A fonte de áudio não subiu. Há algum aplicativo tocando?');
  }
  fonteAtual = fonte;
  return { fonte, alvo };
}

async function desligar() {
  fonteAtual = null;
  if (!bay) return;
  try { bay.unlink(); } catch (e) { console.error(e); }
}

/* Não há varredura de sobras: o venmic desfaz as ligações no unlink e não
   deixa módulo carregado no servidor de áudio. O module-remap-source de antes
   ficava pendurado quando o app morria à força, e por isso precisava dela. */

module.exports = { disponivel, aplicativos, sugestao, ligar, desligar };
