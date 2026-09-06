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
    vistos.set(nome, { id: nome, nome });
  }
  return [...vistos.values()];
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
 * Liga o som de um aplicativo e devolve o rótulo da fonte criada.
 *
 * @param nome `application.name` vindo de aplicativos(). Por aplicativo, não
 *   por aba: as abas de um navegador dividem o mesmo nome.
 */
async function ligar(nome) {
  const b = instancia();
  if (!b) throw new Error('O venmic não está disponível nesta máquina.');

  await desligar();
  const antes = nomesDasFontes(await pactl(['list', 'sources']));

  // mute:false de propósito: quem compartilha continua ouvindo o próprio jogo.
  // Com mute:true o venmic silencia o aplicativo na máquina de quem transmite
  const ok = b.link({ include: [{ 'application.name': nome }], exclude: nossosNos(), mute: false });
  if (!ok) throw new Error(`Não consegui ligar o som de ${nome}.`);

  const fonte = await esperarFonteNova(antes);
  if (!fonte) {
    await desligar();
    throw new Error('A fonte de áudio não subiu. O aplicativo ainda está tocando?');
  }
  return { fonte, alvo: nome };
}

async function desligar() {
  if (!bay) return;
  try { bay.unlink(); } catch (e) { console.error(e); }
}

/* Não há varredura de sobras: o venmic desfaz as ligações no unlink e não
   deixa módulo carregado no servidor de áudio. O module-remap-source de antes
   ficava pendurado quando o app morria à força, e por isso precisava dela. */

module.exports = { disponivel, aplicativos, ligar, desligar };
