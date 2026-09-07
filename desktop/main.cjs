/* App de mesa: a mesma sala do navegador, com duas coisas que só existem aqui —
 * seletor de tela próprio (onde o sistema não tem um) e o som dos aplicativos
 * escolhidos, que nenhum navegador entrega.
 *
 * Uma página web não escolhe o que capturar: o getDisplayMedia sempre abre o
 * diálogo do navegador, e é proposital. Aqui somos o navegador, então o
 * setDisplayMediaRequestHandler responde com a fonte que nós escolhemos.
 *
 * A página em public/ não muda uma linha por causa disto.
 *
 *   npm run app                              abre na sala local
 *   TRANSMISSOR_URL=https://... npm run app  abre num endereço publicado
 */


const { app, BrowserWindow, Menu, desktopCapturer, ipcMain, session } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const net = require('node:net');
const { fork } = require('node:child_process');
const som = require('./som.cjs');

const RAIZ = path.join(__dirname, '..');
const PORTA = Number(process.env.PORT) || 3000;
const ENDERECO = process.env.TRANSMISSOR_URL || `http://localhost:${PORTA}`;

/**
 * Wayland de verdade, e não só o que as variáveis dizem.
 *
 * Flatpak e Snap apagam XDG_SESSION_TYPE, então confiar só nela dá falso
 * negativo justamente onde errar é caro. Conferir o socket no disco resolve.
 */
function sessaoWayland() {
  if (process.env.XDG_SESSION_TYPE?.trim() === 'wayland') return true;
  const display = process.env.WAYLAND_DISPLAY?.trim();
  if (!display) return false;
  try {
    const dir = process.env.XDG_RUNTIME_DIR || `/run/user/${process.getuid?.() ?? 1000}`;
    return fs.statSync(path.isAbsolute(display) ? display : path.join(dir, display)).isSocket();
  } catch { return false; }
}

/**
 * Quem mostra o seletor: o portal do ambiente, ou a nossa janela.
 *
 * No Wayland o portal JÁ É o seletor e não dá pra concorrer com ele:
 * `desktopCapturer.getSources()` não lista nada por conta própria — a chamada é
 * o que ABRE o diálogo do sistema, e o que volta já é a escolha da pessoa.
 * Nossa janela por cima disso nasceria vazia esperando o portal, que apareceria
 * atrás, e a pessoa escolheria duas vezes. O portal ainda faz mais do que
 * faríamos: busca, recorte de região e tela virtual.
 *
 * No X11 é o oposto, e o contrário do que este código assumia: `getSources()`
 * enumera EM SILÊNCIO, sem diálogo nenhum. Tratar X11 como portal fazia a
 * gente pegar a primeira fonte da lista e compartilhar sem perguntar — e o
 * seletor daqui nunca aparecia em Linux algum.
 *
 * Na dúvida, portal. O pior caso dele é o diálogo aparecer quando a pessoa
 * pediu; o pior caso do outro lado é transmitir uma tela que ninguém escolheu.
 *
 * (`useSystemPicker` não resolve: é opção de macOS, no Linux é ignorada.)
 */
function seletorDoSistema() {
  if (process.platform !== 'linux') return false;
  if (sessaoWayland()) return true;
  if (process.env.XDG_SESSION_TYPE?.trim() === 'x11') return false;
  return true;
}

const SELETOR_DO_SISTEMA = seletorDoSistema();

let janela = null;
let servidor = null;

/* ================= servidor ================= */

function portaOcupada(porta) {
  return new Promise(resolve => {
    const c = net.connect(porta, '127.0.0.1');
    c.once('connect', () => { c.end(); resolve(true); });
    c.once('error', () => { c.destroy(); resolve(false); });
  });
}

/**
 * Sobe o servidor só se ninguém estiver na porta — assim o app funciona tanto
 * sozinho quanto ao lado de um `npm run hospedar` já rodando, sem brigar por
 * ela. Com TRANSMISSOR_URL o endereço é de outra máquina; aí não há o que subir.
 */
async function garantirServidor() {
  if (process.env.TRANSMISSOR_URL) return;
  if (await portaOcupada(PORTA)) return;
  servidor = fork(path.join(RAIZ, 'server', 'index.js'), [], {
    env: { ...process.env, PORT: String(PORTA) },
    stdio: 'inherit',
  });
  for (let i = 0; i < 60; i++) {
    if (await portaOcupada(PORTA)) return;
    await new Promise(r => setTimeout(r, 100));
  }
}

/* ================= seletor de tela ================= */

let pendente = null;   // { resolver, janela } enquanto o seletor está aberto
let ultimaFonte = null; // nome da fonte escolhida, para deduzir de quem é o som

async function listarFontes() {
  const fontes = await desktopCapturer.getSources({
    types: ['screen', 'window'],
    thumbnailSize: { width: 480, height: 270 },
    fetchWindowIcons: true,
  });

  return fontes.map(f => ({
    id: f.id,
    // no Wayland o compositor não entrega a lista de janelas: vem uma fonte só,
    // sem nome. Dar um nome aqui é melhor que mostrar um retângulo anônimo
    nome: f.name || (f.id.startsWith('screen') ? 'Tela inteira' : 'A tela toda'),
    tipo: f.id.startsWith('screen') ? 'tela' : 'janela',
    miniatura: f.thumbnail.isEmpty() ? null : f.thumbnail.toDataURL(),
    icone: f.appIcon && !f.appIcon.isEmpty() ? f.appIcon.toDataURL() : null,
  }));
}

function abrirSeletor(pai, fontes) {
  return new Promise(resolve => {
    const seletor = new BrowserWindow({
      parent: pai,
      modal: true,
      width: 900,
      height: 620,
      resizable: false,
      minimizable: false,
      maximizable: false,
      show: false,
      backgroundColor: '#0b0d10',
      title: 'Compartilhar tela',
      autoHideMenuBar: true,
      webPreferences: { preload: path.join(__dirname, 'preload.cjs') },
    });

    pendente = { resolver: resolve, janela: seletor, fontes };
    seletor.loadFile(path.join(__dirname, 'seletor.html'));
    seletor.once('ready-to-show', () => seletor.show());
    // fechar pela decoração da janela é cancelar, não travar o pedido
    seletor.on('closed', () => { if (pendente?.janela === seletor) responder(null); });
  });
}

function responder(escolha) {
  if (!pendente) return;
  const { resolver, janela: seletor } = pendente;
  pendente = null;
  resolver(escolha);
  if (!seletor.isDestroyed()) seletor.close();
}

/* As fontes já vêm listadas de fora: buscá-las com a janela aberta a faria
   nascer vazia enquanto o sistema responde. */
ipcMain.handle('seletor:fontes', () => ({
  fontes: pendente?.fontes || [],
  plataforma: process.platform,
}));
ipcMain.on('seletor:escolher', (_e, escolha) => responder(escolha));
ipcMain.on('seletor:cancelar', () => responder(null));

/* ================= som do aplicativo compartilhado ================= */

/* Não há "automático": no modelo include, quem escolhe o aplicativo é quem
   compartilha. Adivinhar levaria a errar para o lado caro — mandar som que
   não era para ir. */
ipcMain.handle('som:recursos', () => som.recursos());
ipcMain.handle('som:aplicativos', () => som.aplicativos());
ipcMain.handle('som:sugestao', (_e, superficie) => som.sugestao(superficie, ultimaFonte));
ipcMain.handle('som:ligar', async (evento, alvo, excluidos) => {
  const remetente = evento.sender;
  try {
    /* Onde a entrega é por PCM, os blocos sobem para a janela que pediu — e
       só para ela. Checar isDestroyed a cada bloco porque a captura é do
       sistema: ela não para sozinha quando a janela fecha. */
    return { ok: true, ...(await som.ligar(alvo, excluidos, bytes => {
      if (!remetente.isDestroyed()) remetente.send('som:pcm', bytes);
    })) };
  } catch (e) { return { ok: false, erro: e.message }; }
});
ipcMain.handle('som:desligar', async () => { await som.desligar(); return { ok: true }; });

/* ================= janela principal ================= */

function criarJanela() {
  janela = new BrowserWindow({
    width: 1180,
    height: 780,
    backgroundColor: '#0b0d10',
    title: 'Transmissor',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      // ponte estreitíssima: só o som do sistema. O seletor de tela não passa
      // por aqui — ele é intermediado pela sessão, sem a página participar
      preload: path.join(__dirname, 'ponte.cjs'),
    },
  });

  /* A ponte carrega junto com a janela, então a janela não pode sair da nossa
     origem: sem isto, um clique num link externo levaria uma página qualquer
     para dentro de um contexto que sabe carregar módulo de áudio. */
  const origem = new URL(ENDERECO).origin;
  janela.webContents.on('will-navigate', (evento, destino) => {
    if (!destino.startsWith(origem)) evento.preventDefault();
  });
  janela.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  janela.loadURL(ENDERECO);
}

app.whenReady().then(async () => {
  // sem menu de aplicativo: File/Edit/View não significam nada aqui
  Menu.setApplicationMenu(null);

  /* Sem um handler, o Chromium recusa clipboard-sanitized-write no Electron
     e o fallback antigo era prompt() — que o Electron não implementa. */
  session.defaultSession.setPermissionCheckHandler(() => true);

  await garantirServidor();

  const origem = new URL(ENDERECO).origin;

  /* O pedido de tela da página cai aqui em vez de num diálogo do Chromium. */
  session.defaultSession.setDisplayMediaRequestHandler(async (pedido, callback) => {
    if (SELETOR_DO_SISTEMA) {
      // pedir as fontes é o que abre o diálogo do sistema; o que volta já é a
      // escolha da pessoa. Uma janela só, a do ambiente dela.
      const [fonte] = await desktopCapturer.getSources({
        types: ['screen', 'window'],
        thumbnailSize: { width: 0, height: 0 },   // ninguém vai desenhar nada
      });
      // no Wayland o portal não diz o nome; quem deduz é o som-linux, pelo grafo
      ultimaFonte = fonte?.name || null;
      return callback(fonte ? { video: fonte } : undefined);
    }

    const fontes = await listarFontes();
    const escolha = await abrirSeletor(janela, fontes);
    if (!escolha) return callback();   // cancelou: a página recebe NotAllowedError, que ela já trata

    ultimaFonte = escolha.nome || null;
    /* Só vídeo. O 'loopback' do Chromium existe no Windows, mas é o sistema
       inteiro: levaria o Discord e as vozes da nossa própria chamada de volta
       para dentro da transmissão. O som vai pelo caminho por aplicativo, que a
       pessoa escolhe no menu da própria tela. */
    callback({ video: { id: escolha.id, name: escolha.nome } });
  });

  /* Microfone: liberado só para a nossa própria origem. Qualquer outra coisa
     que a página venha a carregar não herda a permissão. */
  session.defaultSession.setPermissionRequestHandler((conteudo, permissao, permitir) => {
    const daCasa = conteudo.getURL().startsWith(origem);
    permitir(daCasa && ['media', 'display-capture'].includes(permissao));
  });

  criarJanela();
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) criarJanela(); });
});

/* Fechou a janela, acabou: o servidor que este processo subiu morre junto, sem
   deixar porta ocupada nem processo pendurado. */
app.on('window-all-closed', () => app.quit());
app.on('before-quit', async () => {
  try { servidor?.kill(); } catch {}
  // o módulo de áudio é do sistema, não do app: sair sem descarregar deixaria
  // uma fonte fantasma na configuração de quem usou
  await som.desligar();
});
