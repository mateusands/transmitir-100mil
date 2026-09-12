/* Servidor da sala.
 *
 * Faz duas coisas e nada além disso: serve a página e repassa a sinalização
 * WebRTC entre quem está na mesma sala. A mídia (tela, som) nunca passa por
 * aqui — vai direto de um navegador pro outro.
 *
 * Sem banco, sem login, sem estado em disco: quem sabe o código da sala entra.
 */

import express from 'express';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORTA = Number(process.env.PORT) || 3000;
const LIMITE_POR_SALA = Number(process.env.LIMITE_SALA) || 8;
let urlPublica = null;

const app = express();
app.set('trust proxy', true);

/* Sinal de vida — útil pra conferir se o túnel está de pé sem abrir a página. */
app.get('/api/ping', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
  res.json({ ok: true, servidor: 'transmissor' });
});

/**
 * O que o cliente precisa saber antes de abrir uma conexão.
 *
 * STUN basta na maioria das redes domésticas. Atrás de CGNAT (4G, alguns
 * provedores) o P2P não fecha sozinho e é preciso um TURN — daí as variáveis.
 */
app.get('/api/config', (req, res) => {
  const ice = [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  ];
  if (process.env.TURN_URL) {
    ice.push({
      urls: process.env.TURN_URL.split(',').map(s => s.trim()),
      username: process.env.TURN_USER || '',
      credential: process.env.TURN_PASS || '',
    });
  }
  // Quem abre localhost enquanto o túnel está de pé ainda precisa copiar o
  // endereço público. Sem essa informação, location.origin convidaria só a
  // própria máquina e a sala pareceria publicada sem estar acessível.
  res.setHeader('Cache-Control', 'no-store');
  res.json({ ice_servers: ice, limite_sala: LIMITE_POR_SALA, url_publica: urlPublica });
});

/* O processo que abriu o túnel é o único que conhece seu endereço efêmero.
   A mensagem fica só entre os dois processos locais; ela não participa da
   sinalização e jamais carrega mídia. */
process.on('message', mensagem => {
  if (mensagem?.tipo !== 'url-publica') return;
  try {
    const url = new URL(mensagem.url);
    urlPublica = url.protocol === 'https:' ? url.origin : null;
  } catch { urlPublica = null; }
});

/* no-cache, não "sem cache": o navegador guarda, mas confere se mudou antes de
   reusar. Sem isso ele aplica cache heurístico e fica servindo CSS/JS velho
   depois de uma edição — barato aqui, já que são poucos arquivos pequenos. */
app.use(express.static(path.join(RAIZ, 'public'), {
  extensions: ['html'],
  setHeaders: res => res.setHeader('Cache-Control', 'no-cache'),
}));
/* Fallback da página. Um middleware sem caminho pega tudo que sobrou — o
   curinga '*' como rota deixou de existir no Express 5 (path-to-regexp v8) e
   hoje lança na subida do servidor. */
app.use((req, res, next) => {
  if (req.method !== 'GET') return next();
  if (req.path.startsWith('/api/') || req.path.startsWith('/socket.io/')) return next();
  res.sendFile(path.join(RAIZ, 'public', 'index.html'));
});

const servidor = http.createServer(app);
const io = new Server(servidor, {
  // a sinalização é texto miúdo; corta payload absurdo antes de processar
  maxHttpBufferSize: 512 * 1024,
  cors: { origin: '*' },
});

/* ================= salas =================
   codigo -> Map<sid, { sid, nome, tela, mic, tela_id, mic_id }>

   Os *_id são os identificadores das MediaStreams de quem transmite. Quem
   recebe precisa deles pra saber qual áudio é voz e qual é som da tela — sem
   isso os dois chegam misturados e não dá pra baixar um sem baixar o outro. */
const salas = new Map();
/** sid -> codigo, pra saber de onde tirar alguém que caiu */
const salaDoSocket = new Map();

const CODIGO_VALIDO = /^[a-z0-9-]{3,32}$/;

/** Identificador de MediaStream é um UUID; qualquer coisa fora disso é lixo. */
function idLimpo(id) {
  const v = String(id ?? '').trim();
  return /^[A-Za-z0-9_-]{1,64}$/.test(v) ? v : null;
}

function nomeLimpo(nome) {
  const n = String(nome ?? '').trim().slice(0, 24);
  return n || 'Anônimo';
}

io.on('connection', socket => {
  socket.on('entrar', ({ sala, nome } = {}) => {
    const codigo = String(sala ?? '').trim().toLowerCase();
    if (!CODIGO_VALIDO.test(codigo)) {
      return socket.emit('erro', { erro: 'Código de sala inválido' });
    }

    sair(socket, { silencioso: true });

    if (!salas.has(codigo)) salas.set(codigo, new Map());
    const membros = salas.get(codigo);

    if (membros.size >= LIMITE_POR_SALA) {
      return socket.emit('erro', { erro: `A sala está cheia (limite de ${LIMITE_POR_SALA})` });
    }

    const eu = { sid: socket.id, nome: nomeLimpo(nome), tela: false, mic: false, tela_id: null, mic_id: null };
    // a lista dos que já estavam sai antes da inserção: quem chega oferta pra eles
    const jaEstavam = [...membros.values()];

    membros.set(socket.id, eu);
    salaDoSocket.set(socket.id, codigo);
    socket.join(codigo);

    socket.emit('sala', { sala: codigo, eu, peers: jaEstavam });
    socket.to(codigo).emit('peer_entrou', { peer: eu });
  });

  /* Repasse puro de sinalização. O servidor não lê o conteúdo — só confere
     que as duas pontas estão na mesma sala antes de entregar. */
  socket.on('sinal', ({ para, dados } = {}) => {
    const minha = salaDoSocket.get(socket.id);
    if (!minha || minha !== salaDoSocket.get(para)) return;
    io.to(para).emit('sinal', { de: socket.id, dados });
  });

  socket.on('estado', (patch = {}) => {
    const codigo = salaDoSocket.get(socket.id);
    const eu = codigo && salas.get(codigo)?.get(socket.id);
    if (!eu) return;
    if ('tela' in patch) eu.tela = !!patch.tela;
    if ('mic' in patch) eu.mic = !!patch.mic;
    if ('tela_id' in patch) eu.tela_id = idLimpo(patch.tela_id);
    if ('mic_id' in patch) eu.mic_id = idLimpo(patch.mic_id);
    io.to(codigo).emit('peer_estado', {
      sid: socket.id, tela: eu.tela, mic: eu.mic, tela_id: eu.tela_id, mic_id: eu.mic_id,
    });
  });

  socket.on('sair', () => sair(socket));
  socket.on('disconnect', () => sair(socket, { silencioso: true, fechado: true }));
});

function sair(socket, { silencioso = false, fechado = false } = {}) {
  const codigo = salaDoSocket.get(socket.id);
  if (!codigo) return;

  salaDoSocket.delete(socket.id);
  const membros = salas.get(codigo);
  if (membros) {
    membros.delete(socket.id);
    if (!membros.size) salas.delete(codigo);
  }
  if (!fechado) socket.leave(codigo);
  io.to(codigo).emit('peer_saiu', { sid: socket.id });
  if (!silencioso) socket.emit('saiu');
}

servidor.listen(PORTA, '0.0.0.0', () => {
  console.log(`\n  Servidor ouvindo em http://localhost:${PORTA}`);
  console.log(`  Acesso externo:  cloudflared tunnel --url http://localhost:${PORTA}\n`);
});
