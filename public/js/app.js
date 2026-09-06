/* Interface: a tela de entrada, o palco, a fila de pessoas e a barra.
   Toda a lógica de conexão mora em rtc.js — aqui só se desenha o resultado.

   Duas listas, de propósito: quem está compartilhando ganha uma tela no palco;
   todo mundo, compartilhando ou não, vira uma pastilha na fila de baixo. Uma
   grade de retângulos vazios não diz nada — e é nas pastilhas que mora o áudio
   de quem só está falando. */

import * as rtc from './rtc.js';
import { icone } from './icones.js';

const $ = id => document.getElementById(id);

const telaEntrada = $('entrada');
const telaSala = $('sala-view');
const palco = $('palco');
const fila = $('pessoas');
const menu = $('menu');

let config = { ice_servers: [], limite_sala: 8 };
let socket = null;
let entrou = false;
let conexaoCaiu = false;
let nomeAtual = '';

/* Uma sala só: quem abre o link cai na mesma chamada. Não há o que escolher,
   então a tela de entrada pergunta apenas o nome. */
const SALA = 'call';

const tiles = new Map();    // sid -> tela no palco (só de quem compartilha)
const pessoas = new Map();  // sid -> pastilha na fila (de todo mundo, com o áudio)

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

/* A ponte só existe dentro do app de mesa. No navegador `window.transmissor`
   não existe, o botão fica escondido e nada disto roda — a página continua a
   mesma nos dois lugares. */
const ponteSom = window.transmissor?.som || null;

pintarIcones(document);

/* ================= entrada ================= */

$('nome').value = localStorage.getItem('transmissor:nome') || '';

$('form-entrar').addEventListener('submit', async e => {
  e.preventDefault();
  nomeAtual = $('nome').value.trim();

  if (!window.isSecureContext) {
    return avisar('entrada', 'Compartilhar tela só funciona em https (ou localhost). Abra pelo endereço do túnel.');
  }

  localStorage.setItem('transmissor:nome', nomeAtual);
  $('entrar').disabled = true;

  try {
    config = await fetch('/api/config').then(r => r.json());
    telaEntrada.hidden = true;
    telaSala.hidden = false;
    renderizar();

    socket = io();
    rtc.iniciar(socket, config, renderizar);
    socket.on('erro', ({ erro }) => { avisar('sala', erro); voltarParaEntrada(); });
    socket.on('sala', () => { entrou = true; conexaoCaiu = false; renderizar(); });

    /* O socket.io reconecta sozinho, mas o servidor já tirou a gente da sala
       nesse meio tempo — sem entrar de novo a chamada ficaria de pé só na
       aparência, com a fila cheia e ninguém do outro lado. */
    socket.on('disconnect', () => { conexaoCaiu = true; renderizar(); });
    socket.on('connect', () => { if (entrou) rtc.entrar(SALA, nomeAtual); });

    rtc.entrar(SALA, nomeAtual);
  } catch (e) {
    console.error(e);
    voltarParaEntrada();
    avisar('entrada', 'Não consegui falar com o servidor.');
  } finally {
    $('entrar').disabled = false;
  }
});

/* ================= barra ================= */

async function compartilhar() {
  if (rtc.eu.tela) return pararDeCompartilhar();
  await iniciarTela();
}

async function iniciarTela() {
  try {
    await rtc.alternarTela();
  } catch (e) {
    if (e?.name !== 'NotAllowedError') avisar('sala', 'Não consegui capturar a tela: ' + e.message);
    return renderizar();
  }
  renderizar();
}

/**
 * Leva o som de um aplicativo junto com a tela.
 *
 * Recebe o rótulo de volta em vez de supô-lo: o nome do dispositivo é o que a
 * página usa para achá-lo, e quem sabe qual ficou registrado é o sistema.
 */
async function levarSom(id, nome) {
  fecharMenu();
  const r = await ponteSom.ligar(id);
  if (!r.ok) return avisar('sala', 'Não consegui levar o som: ' + r.erro);

  try {
    /* Duas entregas, um resultado. No Linux o app criou uma entrada de áudio e
       a página só a captura; no macOS e no Windows chegam blocos de PCM, que o
       worklet vira faixa. O outro lado da chamada não distingue as duas. */
    if (r.tipo === 'pcm') await rtc.ligarSomDaTelaPcm(r, ponteSom.aoReceberPcm);
    else await rtc.ligarSomDaTela(r.fonte);
    alvoDoSom = nome;
  } catch (e) {
    await ponteSom.desligar();
    avisar('sala', e.message);
  }
  renderizar();
}

async function tirarSom() {
  fecharMenu();
  alvoDoSom = null;
  rtc.desligarSomDaTela();
  await ponteSom?.desligar();
  renderizar();
}

async function pararDeCompartilhar() {
  await rtc.alternarTela();
  alvoDoSom = null;
  await ponteSom?.desligar();
  renderizar();
}

$('btn-tela').addEventListener('click', compartilhar);
$('vazio-compartilhar').addEventListener('click', compartilhar);

$('btn-mic').addEventListener('click', async () => {
  try { await rtc.alternarMic(); }
  catch (e) {
    avisar('sala', e?.name === 'NotAllowedError'
      ? 'O navegador negou o microfone. Libere no cadeado da barra de endereço.'
      : 'Não consegui abrir o microfone: ' + e.message);
  }
  renderizar();
});

/* Som de UM aplicativo, escolhido por quem compartilha. Fora do app de mesa
   isto nem aparece.

   Não existe "levar tudo", e a ausência é o recurso: o que não foi escolhido
   não entra. É assim que a voz da chamada — a nossa e a de outro programa,
   como o Discord — não volta para dentro da transmissão. Quem já está na call
   não precisa se ouvir de novo, com atraso.

   Nada é ligado sozinho. Adivinhar erraria para o lado caro: mandar som que
   não era para ir só se descobre depois que já foi. */
let alvoDoSom = null;    // nome do aplicativo cujo som está indo, ou null
let somDisponivel = false;

ponteSom?.disponivel().then(pode => { somDisponivel = pode; });

/** Escolha do aplicativo, no botão direito da própria tela. */
async function itensDeSom() {
  const apps = await ponteSom.aplicativos();
  const itens = [];

  if (alvoDoSom) itens.push(itemBotao('volume-x', 'Parar o som', tirarSom));
  for (const app of apps) {
    if (alvoDoSom === app.nome) continue;
    itens.push(itemBotao('volume-2', `Levar o som de ${app.nome}`, () => levarSom(app.id, app.nome)));
  }

  /* Sem nenhum aplicativo tocando, a lista vazia pareceria defeito. O
     PipeWire só conhece quem tem fluxo de áudio aberto: um jogo em silêncio
     não aparece aqui, e é isso que a nota explica. */
  if (!apps.length) {
    const nota = document.createElement('div');
    nota.className = 'menu-nota';
    nota.textContent = 'nenhum aplicativo tocando agora';
    itens.push(nota);
  }
  return itens;
}

$('btn-sair').addEventListener('click', () => { rtc.sair(); voltarParaEntrada(); });

$('copiar').addEventListener('click', async () => {
  const link = location.origin;
  const rotulo = $('copiar').querySelector('.rotulo-botao');
  try {
    await navigator.clipboard.writeText(link);
    trocarIcone($('copiar'), 'check');
    rotulo.textContent = 'Copiado';
    setTimeout(() => { trocarIcone($('copiar'), 'copy'); rotulo.textContent = 'Copiar link'; }, 1600);
  } catch {
    prompt('Copie o link da chamada:', link);
  }
});

$('ativar-som').addEventListener('click', () => {
  $('ativar-som').hidden = true;
  for (const p of pessoas.values()) {
    p.audioVoz.play().catch(() => {});
    p.audioTela.play().catch(() => {});
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
  if (!tiles.has(sid)) return;
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

async function abrirMenu(sid, x, y) {
  const p = participante(sid);
  if (!p) return;

  const itens = [];

  /* Na sua própria tela, o menu é onde se escolhe de qual aplicativo levar o
     som — e onde se para de levar. */
  if (p.local && somDisponivel && rtc.eu.tela) {
    itens.push(...await itensDeSom());
  }

  if (!p.local) {
    const s = somDe(sid);

    /* Só o rótulo muda no clique. Reconstruir o menu inteiro aqui o fecharia:
       o botão sairia do DOM antes de o clique subir até o document, e o
       fechamento "clicou fora" não reconheceria mais o alvo como sendo daqui. */
    const btnMudo = itemBotao(s.mudo ? 'volume-2' : 'volume-x', rotuloMudo(s), () => {
      s.mudo = !s.mudo;
      aplicarSom(sid);
      trocarIcone(btnMudo, s.mudo ? 'volume-2' : 'volume-x');
      btnMudo.querySelector('span:last-child').textContent = rotuloMudo(s);
      renderizar();
    });
    itens.push(btnMudo);

    itens.push(itemSlider('Voz', s.voz, v => { s.voz = v; aplicarSom(sid); }, !rtc.temSom(rtc.streamDaVoz(p.peer))));
    itens.push(itemSlider('Som da tela', s.tela, v => { s.tela = v; aplicarSom(sid); }, !rtc.temSom(rtc.streamDaTela(p.peer))));

    const nota = document.createElement('div');
    nota.className = 'menu-nota';
    nota.textContent = 'só pra você — a pessoa não é avisada';
    itens.push(nota);
  }

  if (tiles.has(sid)) {
    if (itens.length) itens.push(document.createElement('hr'));
    itens.push(itemBotao(focado === sid ? 'minimize' : 'maximize',
      focado === sid ? 'Tirar do foco' : 'Ampliar', () => { focar(sid); fecharMenu(); }));
    itens.push(itemBotao('expand', 'Tela cheia', () => { telaCheia(sid); fecharMenu(); }));
  }

  // menu vazio é pior que menu nenhum: some sem explicar por quê
  if (!itens.length) return;

  menuAberto = sid;
  menu.replaceChildren(cabecalhoMenu(p), ...itens);
  menu.hidden = false;

  // posiciona depois de medir, pra não vazar pela borda da janela
  const r = menu.getBoundingClientRect();
  menu.style.left = Math.max(8, Math.min(x, innerWidth - r.width - 8)) + 'px';
  menu.style.top = Math.max(8, Math.min(y, innerHeight - r.height - 8)) + 'px';
}

function rotuloMudo(s) {
  return s.mudo ? 'Reativar som' : 'Silenciar pra mim';
}

function cabecalhoMenu(p) {
  const div = document.createElement('div');
  div.className = 'menu-nome';
  div.append(avatarDe(p.nome));
  const nome = document.createElement('span');
  nome.textContent = p.local ? `${p.nome} (você)` : p.nome;
  div.append(nome);
  return div;
}

function fecharMenu() {
  menuAberto = null;
  menu.hidden = true;
}

function itemBotao(nomeIcone, texto, aoClicar) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'menu-item';
  b.setAttribute('role', 'menuitem');
  b.append(icone(nomeIcone), document.createElement('span'));
  b.querySelector('span').textContent = texto;
  b.addEventListener('click', aoClicar);
  return b;
}

function itemSlider(rotulo, valor, aoMudar, desativado) {
  const div = document.createElement('div');
  div.className = 'menu-slider' + (desativado ? ' apagado' : '');

  const topo = document.createElement('label');
  const nome = document.createElement('span');
  nome.textContent = desativado ? `${rotulo} — sem áudio` : rotulo;
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
  range.setAttribute('aria-label', rotulo);
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

  for (const p of lista) {
    const streamTela = p.local ? rtc.minhaTela() : rtc.streamDaTela(p.peer);
    const streamVoz = p.local ? null : rtc.streamDaVoz(p.peer);
    /* Na própria tela basta a captura existir. Exigir imagem viva escondia o
       que estava sendo transmitido: no PipeWire a faixa passa um tempo `muted`
       antes do primeiro quadro, e quem compartilhava via "ninguém está
       compartilhando" enquanto o outro lado já recebia. */
    p.transmitindo = p.local ? !!streamTela : rtc.temImagem(streamTela);

    desenharPessoa(p, streamTela, streamVoz);
    if (p.transmitindo) desenharTile(p, streamTela);
    else removerTile(p.sid);
  }

  const vivos = new Set(lista.map(p => p.sid));
  for (const sid of [...pessoas.keys()]) if (!vivos.has(sid)) removerPessoa(sid);
  for (const sid of [...tiles.keys()]) if (!vivos.has(sid)) removerTile(sid);

  if (focado && !tiles.has(focado)) focado = null;
  palco.classList.toggle('foco', !!focado);

  const estado = conexaoCaiu ? 'erro' : !entrou ? 'conectando' : tiles.size ? null : 'vazio';
  $('estado-erro').hidden = estado !== 'erro';
  $('estado-conectando').hidden = estado !== 'conectando';
  $('estado-vazio').hidden = estado !== 'vazio';

  $('contagem-n').textContent = `${lista.length}/${config.limite_sala || 8}`;
  atualizarBotao($('btn-tela'), rtc.eu.tela, {
    ligado: ['screen-share-off', 'Parar de compartilhar'],
    desligado: ['screen-share', 'Compartilhar tela'],
  });
  atualizarBotao($('btn-mic'), rtc.eu.mic, {
    ligado: ['mic', 'Desligar microfone'],
    desligado: ['mic-off', 'Ligar microfone'],
  });
}

function atualizarBotao(botao, ligado, textos) {
  const [nomeIcone, texto] = ligado ? textos.ligado : textos.desligado;
  trocarIcone(botao, nomeIcone);
  botao.querySelector('.rotulo-botao').textContent = texto;
  botao.classList.toggle('ligado', ligado);
  // em tela estreita o rótulo some e sobra o ícone: o nome tem que vir por aqui
  botao.title = texto;
  botao.setAttribute('aria-label', texto);
}

/* ---------- pastilha (todo mundo) ---------- */

function desenharPessoa(p, streamTela, streamVoz) {
  let el = pessoas.get(p.sid);
  if (!el) {
    el = criarPessoa(p);
    pessoas.set(p.sid, el);
    fila.append(el.chip);
  }

  const s = p.local ? null : somDe(p.sid);

  el.nome.textContent = p.local ? `${p.nome} (você)` : p.nome;
  el.avatar.textContent = inicial(p.nome);
  el.chip.classList.toggle('transmitindo', !!p.transmitindo);
  el.chip.classList.toggle('caiu', ['failed', 'disconnected'].includes(p.conexao));
  el.chip.title = p.local ? 'você' : 'clique para o volume desta pessoa';

  trocarIcone(el.marcaMic, p.mic ? 'mic' : 'mic-off');
  el.marcaMic.classList.toggle('ligado', !!p.mic);
  el.marcaMic.title = p.mic ? 'microfone ligado' : 'microfone desligado';
  el.marcaMudo.hidden = !s?.mudo;

  if (!p.local) {
    // o mesmo stream da tela alimenta o <video> (mudo) e o <audio> do som dela
    trocarFonte(el.audioTela, rtc.temSom(streamTela) ? streamTela : null);
    trocarFonte(el.audioVoz, rtc.temSom(streamVoz) ? streamVoz : null);
    aplicarSom(p.sid);
  }
}

function criarPessoa(p) {
  const chip = document.createElement('button');
  chip.type = 'button';
  chip.className = 'pessoa';
  chip.dataset.sid = p.sid;

  const avatar = avatarDe(p.nome);
  const nome = document.createElement('span');
  nome.className = 'pessoa-nome';
  const marcaMic = document.createElement('span');
  marcaMic.className = 'marca-mic';
  marcaMic.append(icone('mic-off'));
  marcaMic.dataset.icone = 'mic-off';
  const marcaMudo = document.createElement('span');
  marcaMudo.className = 'marca-mudo';
  marcaMudo.title = 'silenciado só pra você';
  marcaMudo.hidden = true;
  marcaMudo.append(icone('volume-x'));
  chip.append(avatar, nome, marcaMic, marcaMudo);

  const audioVoz = document.createElement('audio');
  const audioTela = document.createElement('audio');
  for (const a of [audioVoz, audioTela]) { a.autoplay = true; chip.append(a); }

  const abrir = e => {
    e.preventDefault();
    /* sem isto o clique sobe até o document, que fecha "o menu aberto porque
       clicaram fora dele" — e o menu abriria e sumiria no mesmo evento */
    e.stopPropagation();
    const r = chip.getBoundingClientRect();
    abrirMenu(p.sid, e.clientX || r.left, e.clientY || r.top);
  };
  chip.addEventListener('click', abrir);
  chip.addEventListener('contextmenu', abrir);

  return { chip, avatar, nome, marcaMic, marcaMudo, audioVoz, audioTela };
}

function removerPessoa(sid) {
  pessoas.get(sid)?.chip.remove();
  pessoas.delete(sid);
  som.delete(sid);
  if (menuAberto === sid) fecharMenu();
}

/* ---------- tela no palco (só de quem compartilha) ---------- */

function desenharTile(p, streamTela) {
  let t = tiles.get(p.sid);
  if (!t) {
    t = criarTile(p);
    tiles.set(p.sid, t);
    palco.append(t.tile);
  }

  const s = p.local ? null : somDe(p.sid);
  if (t.video.srcObject !== streamTela) t.video.srcObject = streamTela;

  t.tile.classList.toggle('focado', focado === p.sid);
  t.nome.textContent = p.local ? `${p.nome} (você)` : p.nome;
  // sem botão de som, a etiqueta na tela é o único aviso de que ele está indo
  t.marcaSom.hidden = !(p.local ? rtc.eu.somDaTela : rtc.temSom(streamTela));
  t.marcaSom.title = p.local && alvoDoSom ? `levando o som de ${alvoDoSom}` : 'transmitindo com som';
  // o som não liga sozinho: o menu é o único lugar que o oferece, então ele
  // precisa estar dito em algum canto
  if (p.local && somDisponivel) {
    t.tile.title = 'clique para ampliar · duplo clique para tela cheia · botão direito para levar o som';
  }
  t.marcaMudo.hidden = !s?.mudo;
}

function criarTile(p) {
  const tile = document.createElement('div');
  tile.className = 'tile';
  tile.dataset.sid = p.sid;
  tile.tabIndex = 0;
  tile.title = 'clique para ampliar · duplo clique para tela cheia';

  const video = document.createElement('video');
  video.autoplay = true;
  video.playsInline = true;
  video.muted = true;   // o som sai pelos <audio> da pastilha; aqui daria eco
  tile.append(video);

  const rotulo = document.createElement('div');
  rotulo.className = 'rotulo';
  const nome = document.createElement('span');
  nome.className = 'nome';
  const marcaSom = document.createElement('span');
  marcaSom.className = 'marca-som';
  marcaSom.title = 'transmitindo com som';
  marcaSom.hidden = true;
  marcaSom.append(icone('volume-2'));
  const marcaMudo = document.createElement('span');
  marcaMudo.className = 'marca-mudo';
  marcaMudo.title = 'silenciado só pra você';
  marcaMudo.hidden = true;
  marcaMudo.append(icone('volume-x'));
  rotulo.append(nome, marcaSom, marcaMudo);
  tile.append(rotulo);

  tile.addEventListener('click', () => focar(p.sid));
  tile.addEventListener('dblclick', () => telaCheia(p.sid));
  tile.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); focar(p.sid); }
  });
  tile.addEventListener('contextmenu', e => {
    e.preventDefault();
    abrirMenu(p.sid, e.clientX, e.clientY);
  });

  return { tile, video, nome, marcaSom, marcaMudo };
}

function removerTile(sid) {
  tiles.get(sid)?.tile.remove();
  tiles.delete(sid);
}

/* ---------- áudio ---------- */

/**
 * Trocar o srcObject reinicia a reprodução, então só troca quando muda mesmo.
 * O navegador pode barrar o autoplay com som antes de qualquer clique — daí o
 * botão de destravar, que tenta de novo com um gesto do usuário na mão.
 */
function trocarFonte(el, stream) {
  const mesma = el.srcObject === (stream || null);
  if (!mesma) el.srcObject = stream || null;
  // já está tocando o mesmo stream: não há o que fazer
  else if (!stream || !el.paused) return;

  /* Repetimos o play() quando o elemento está parado, mesmo com o stream
     igual. O som da tela chega DEPOIS do vídeo — é escolhido depois de
     compartilhar —, e no celular o navegador barra a reprodução até haver um
     gesto. Sem esta segunda tentativa, o botão de destravar nunca aparecia e o
     áudio ficava mudo para sempre. */
  if (stream) el.play().catch(() => { $('ativar-som').hidden = false; });
}

function aplicarSom(sid) {
  const el = pessoas.get(sid);
  if (!el) return;
  const s = somDe(sid);
  el.audioVoz.volume = s.mudo ? 0 : s.voz;
  el.audioTela.volume = s.mudo ? 0 : s.tela;
}

/* ================= utilidades ================= */

function pintarIcones(raiz) {
  for (const el of raiz.querySelectorAll('[data-icone]')) {
    if (!el.firstElementChild) el.append(icone(el.dataset.icone));
  }
}

function trocarIcone(dentroDe, nome) {
  const alvo = dentroDe.matches('[data-icone]') ? dentroDe : dentroDe.querySelector('[data-icone]');
  if (!alvo || alvo.dataset.icone === nome) return;
  alvo.dataset.icone = nome;
  alvo.replaceChildren(icone(nome));
}

function avatarDe(nome) {
  const el = document.createElement('span');
  el.className = 'avatar';
  el.textContent = inicial(nome);
  el.setAttribute('aria-hidden', 'true');
  return el;
}

function inicial(nome) {
  return (nome || '?').trim().charAt(0) || '?';
}

function voltarParaEntrada() {
  fecharMenu();
  focado = null;
  entrou = false;
  conexaoCaiu = false;
  telaSala.hidden = true;
  telaEntrada.hidden = false;
  for (const sid of [...tiles.keys()]) removerTile(sid);
  for (const sid of [...pessoas.keys()]) removerPessoa(sid);
}

function avisar(onde, texto) {
  const el = onde === 'entrada' ? $('aviso-entrada') : $('aviso-sala');
  el.textContent = texto;
  el.hidden = false;
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.hidden = true; }, 6000);
}
