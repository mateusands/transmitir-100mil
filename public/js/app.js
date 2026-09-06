/* Interface: a tela de entrada, o palco e os três botões da barra.
   Toda a lógica de conexão mora em rtc.js — aqui só se desenha o resultado. */

import * as rtc from './rtc.js';

const $ = id => document.getElementById(id);

const telaEntrada = $('entrada');
const telaSala = $('sala-view');
const palco = $('palco');
const menu = $('menu');

let config = { ice_servers: [], limite_sala: 8 };
let socket = null;

/* Uma sala só: quem abre o link cai na mesma chamada. Não há o que escolher,
   então a tela de entrada pergunta apenas o nome. */
const SALA = 'call';

/* sid -> { tile, video, audioVoz, audioTela, ... }, pra atualizar sem recriar */
const tiles = new Map();

/**
 * Volume por pessoa, só pra quem está olhando. Ninguém mais é afetado: mexer
 * aqui não silencia a pessoa pros outros nem avisa ela. Voz e som da tela são
 * separados porque quase sempre se quer baixar um e manter o outro — o jogo
 * alto de quem transmite, a voz de quem está explicando.
 */
const som = new Map();   // sid -> { voz, tela, mudo }

function somDe(sid) {
  if (!som.has(sid)) som.set(sid, { voz: 1, tela: 1, mudo: false });
  return som.get(sid);
}

/** sid em foco (a tela grande), ou null pro mosaico normal */
let focado = null;

/* ================= entrada ================= */

$('nome').value = localStorage.getItem('transmissor:nome') || '';

$('form-entrar').addEventListener('submit', async e => {
  e.preventDefault();
  const nome = $('nome').value.trim();

  if (!window.isSecureContext) {
    return avisar('entrada', 'Compartilhar tela só funciona em https (ou localhost). Abra pelo endereço do túnel.');
  }

  localStorage.setItem('transmissor:nome', nome);
  $('entrar').disabled = true;

  try {
    config = await fetch('/api/config').then(r => r.json());
    socket = io();
    rtc.iniciar(socket, config, renderizar);
    socket.on('erro', ({ erro }) => { avisar('sala', erro); voltarParaEntrada(); });
    socket.on('sala', () => {
      telaEntrada.hidden = true;
      telaSala.hidden = false;
      renderizar();
    });
    rtc.entrar(SALA, nome);
  } catch (e) {
    console.error(e);
    avisar('entrada', 'Não consegui falar com o servidor.');
  } finally {
    $('entrar').disabled = false;
  }
});

/* ================= barra ================= */

$('btn-tela').addEventListener('click', async () => {
  try { await rtc.alternarTela(); }
  catch (e) {
    // cancelar o diálogo do navegador é rotina, não erro
    if (e?.name !== 'NotAllowedError') avisar('sala', 'Não consegui capturar a tela: ' + e.message);
  }
  renderizar();
});

$('btn-mic').addEventListener('click', async () => {
  try { await rtc.alternarMic(); }
  catch (e) {
    avisar('sala', e?.name === 'NotAllowedError'
      ? 'O navegador negou o microfone. Libere no cadeado da barra de endereço.'
      : 'Não consegui abrir o microfone: ' + e.message);
  }
  renderizar();
});

$('btn-sair').addEventListener('click', () => { rtc.sair(); voltarParaEntrada(); });

$('copiar').addEventListener('click', async () => {
  const link = location.origin;
  try {
    await navigator.clipboard.writeText(link);
    $('copiar').textContent = 'copiado!';
    setTimeout(() => { $('copiar').textContent = 'copiar link'; }, 1500);
  } catch {
    prompt('Copie o link da chamada:', link);
  }
});

$('ativar-som').addEventListener('click', () => {
  $('ativar-som').hidden = true;
  for (const t of tiles.values()) {
    t.audioVoz.play().catch(() => {});
    t.audioTela.play().catch(() => {});
  }
});

window.addEventListener('beforeunload', () => { try { rtc.sair(); } catch {} });

/* ================= foco ================= */

/**
 * Uma tela pequena no mosaico não serve pra ler código nem acompanhar um jogo.
 * Clicar promove aquela pessoa a tela grande e joga o resto numa fita embaixo;
 * clicar de novo volta. Duplo clique vai pra tela cheia de verdade.
 */
function focar(sid) {
  focado = focado === sid ? null : sid;
  renderizar();
}

function telaCheia(sid) {
  const t = tiles.get(sid);
  if (!t) return;
  if (document.fullscreenElement) document.exitFullscreen();
  else t.tile.requestFullscreen?.().catch(() => {});
}

document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  fecharMenu();
  if (focado && !document.fullscreenElement) { focado = null; renderizar(); }
});

/* ================= menu do botão direito ================= */

let menuAberto = null;

function abrirMenu(sid, x, y) {
  const p = participante(sid);
  if (!p) return;
  menuAberto = sid;
  menu.replaceChildren();

  const cabecalho = document.createElement('div');
  cabecalho.className = 'menu-nome';
  cabecalho.textContent = p.nome;
  menu.append(cabecalho);

  if (!p.local) {
    const s = somDe(sid);

    /* Só o rótulo muda no clique. Reconstruir o menu inteiro aqui o fecharia:
       o botão sairia do DOM antes de o clique subir até o document, e o
       fechamento "clicou fora" não reconheceria mais o alvo como sendo daqui. */
    const btnMudo = itemBotao(s.mudo ? 'Reativar som' : 'Silenciar pra mim', () => {
      s.mudo = !s.mudo;
      aplicarSom(sid);
      btnMudo.textContent = s.mudo ? 'Reativar som' : 'Silenciar pra mim';
      renderizar();
    });
    menu.append(btnMudo);

    menu.append(itemSlider('Voz', s.voz, v => { s.voz = v; aplicarSom(sid); }, !rtc.temSom(rtc.streamDaVoz(p.peer))));
    menu.append(itemSlider('Som da tela', s.tela, v => { s.tela = v; aplicarSom(sid); }, !rtc.temSom(rtc.streamDaTela(p.peer))));

    const nota = document.createElement('div');
    nota.className = 'menu-nota';
    nota.textContent = 'só pra você — a pessoa não é avisada';
    menu.append(nota);
  }

  menu.append(document.createElement('hr'));
  menu.append(itemBotao(focado === sid ? 'Tirar do foco' : 'Ampliar', () => { focar(sid); fecharMenu(); }));
  menu.append(itemBotao('Tela cheia', () => { telaCheia(sid); fecharMenu(); }));

  menu.hidden = false;
  // posiciona depois de medir, pra não vazar pela borda da janela
  const r = menu.getBoundingClientRect();
  menu.style.left = Math.min(x, innerWidth - r.width - 8) + 'px';
  menu.style.top = Math.min(y, innerHeight - r.height - 8) + 'px';
}

function fecharMenu() {
  menuAberto = null;
  menu.hidden = true;
}

function itemBotao(texto, aoClicar) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'menu-item';
  b.textContent = texto;
  b.addEventListener('click', aoClicar);
  return b;
}

function itemSlider(rotulo, valor, aoMudar, desativado) {
  const div = document.createElement('div');
  div.className = 'menu-slider' + (desativado ? ' apagado' : '');

  const topo = document.createElement('label');
  const nome = document.createElement('span');
  nome.textContent = desativado ? `${rotulo} (sem áudio)` : rotulo;
  const pct = document.createElement('span');
  pct.className = 'pct';
  pct.textContent = Math.round(valor * 100) + '%';
  topo.append(nome, pct);

  const range = document.createElement('input');
  range.type = 'range';
  range.min = 0;
  range.max = 100;
  range.value = Math.round(valor * 100);
  range.disabled = desativado;
  range.addEventListener('input', () => {
    pct.textContent = range.value + '%';
    aoMudar(Number(range.value) / 100);
  });

  div.append(topo, range);
  return div;
}

document.addEventListener('click', e => {
  if (menuAberto && !menu.hidden && !menu.contains(e.target)) fecharMenu();
});
palco.addEventListener('scroll', fecharMenu);
window.addEventListener('resize', fecharMenu);
window.addEventListener('blur', fecharMenu);

/* ================= desenho ================= */

function participantes() {
  const eu = rtc.eu;
  return [
    { sid: eu.sid, nome: eu.nome, local: true, tela: eu.tela, mic: eu.mic, conexao: 'connected' },
    ...[...rtc.peers.values()].map(p => ({
      sid: p.sid, nome: p.nome, local: false, tela: p.tela, mic: p.mic, conexao: p.conexao, peer: p,
    })),
  ].filter(p => p.sid);
}

function participante(sid) {
  return participantes().find(p => p.sid === sid) || null;
}

function renderizar() {
  const lista = participantes();
  const vistos = new Set();

  // alguém pode ter saído estando em foco
  if (focado && !lista.some(p => p.sid === focado)) focado = null;

  for (const p of lista) {
    vistos.add(p.sid);

    let t = tiles.get(p.sid);
    if (!t) {
      t = criarTile(p);
      tiles.set(p.sid, t);
      palco.append(t.tile);
    }

    const streamTela = p.local ? rtc.minhaTela() : rtc.streamDaTela(p.peer);
    const streamVoz = p.local ? null : rtc.streamDaVoz(p.peer);
    const temImagem = rtc.temImagem(streamTela);

    if (t.video.srcObject !== (streamTela || null)) t.video.srcObject = streamTela || null;

    if (!p.local) {
      // o mesmo stream da tela alimenta o <video> (mudo) e o <audio> do som dela
      trocarFonte(t.audioTela, rtc.temSom(streamTela) ? streamTela : null);
      trocarFonte(t.audioVoz, rtc.temSom(streamVoz) ? streamVoz : null);
      aplicarSom(p.sid);
    }

    const s = p.local ? null : somDe(p.sid);
    t.tile.classList.toggle('sem-video', !temImagem);
    t.tile.classList.toggle('focado', focado === p.sid);
    t.tile.classList.toggle('mudo', !!s?.mudo);
    t.nome.textContent = p.local ? `${p.nome} (você)` : p.nome;
    t.vazio.textContent = p.local ? 'sua tela aparece aqui' : `${p.nome} não está compartilhando`;
    t.ponto.className = 'ponto'
      + (p.mic ? ' ligado' : '')
      + (['failed', 'disconnected'].includes(p.conexao) ? ' ruim' : '');
    t.ponto.title = p.mic ? 'microfone ligado' : 'microfone desligado';
    t.silenciado.hidden = !s?.mudo;
  }

  for (const [sid, t] of tiles) {
    if (vistos.has(sid)) continue;
    t.tile.remove();
    tiles.delete(sid);
    som.delete(sid);
    if (menuAberto === sid) fecharMenu();
  }

  palco.classList.toggle('foco', !!focado);
  $('contagem').textContent = `${lista.length} de ${config.limite_sala || 8}`;
  $('btn-tela').textContent = rtc.eu.tela ? 'Parar de compartilhar' : 'Compartilhar tela';
  $('btn-tela').classList.toggle('ativo', rtc.eu.tela);
  $('btn-mic').textContent = rtc.eu.mic ? 'Desligar microfone' : 'Ligar microfone';
  $('btn-mic').classList.toggle('ativo', rtc.eu.mic);
}

function criarTile(p) {
  const tile = document.createElement('div');
  tile.className = 'tile sem-video';
  tile.dataset.sid = p.sid;
  tile.tabIndex = 0;

  const video = document.createElement('video');
  video.autoplay = true;
  video.playsInline = true;
  video.muted = true;   // o som sai pelos <audio>; aqui só evitaria eco
  tile.append(video);

  const vazio = document.createElement('div');
  vazio.className = 'vazio';
  tile.append(vazio);

  const rotulo = document.createElement('div');
  rotulo.className = 'rotulo';
  const ponto = document.createElement('span');
  ponto.className = 'ponto';
  const nome = document.createElement('span');
  const silenciado = document.createElement('span');
  silenciado.textContent = '🔇';
  silenciado.title = 'silenciado só pra você';
  silenciado.hidden = true;
  rotulo.append(ponto, nome, silenciado);
  tile.append(rotulo);

  const audioVoz = document.createElement('audio');
  const audioTela = document.createElement('audio');
  for (const a of [audioVoz, audioTela]) { a.autoplay = true; tile.append(a); }

  tile.addEventListener('click', () => focar(p.sid));
  tile.addEventListener('dblclick', () => telaCheia(p.sid));
  tile.addEventListener('contextmenu', e => {
    e.preventDefault();
    abrirMenu(p.sid, e.clientX, e.clientY);
  });

  return { tile, video, vazio, nome, ponto, silenciado, audioVoz, audioTela };
}

/**
 * Trocar o srcObject reinicia a reprodução, então só troca quando muda mesmo.
 * O navegador pode barrar o autoplay com som antes de qualquer clique — daí o
 * botão de destravar, que tenta de novo com um gesto do usuário na mão.
 */
function trocarFonte(el, stream) {
  if (el.srcObject === (stream || null)) return;
  el.srcObject = stream || null;
  if (stream) el.play().catch(() => { $('ativar-som').hidden = false; });
}

function aplicarSom(sid) {
  const t = tiles.get(sid);
  if (!t) return;
  const s = somDe(sid);
  t.audioVoz.volume = s.mudo ? 0 : s.voz;
  t.audioTela.volume = s.mudo ? 0 : s.tela;
}

/* ================= utilidades ================= */

function voltarParaEntrada() {
  fecharMenu();
  focado = null;
  telaSala.hidden = true;
  telaEntrada.hidden = false;
  for (const t of tiles.values()) t.tile.remove();
  tiles.clear();
  som.clear();
}

function avisar(onde, texto) {
  const el = onde === 'entrada' ? $('aviso-entrada') : $('aviso-sala');
  el.textContent = texto;
  el.hidden = false;
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.hidden = true; }, 6000);
}
