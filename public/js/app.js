/* Interface: a tela de entrada, o palco, a fila de pessoas e a barra.
   Toda a lógica de conexão mora em rtc.js — aqui só se desenha o resultado.

   Duas listas, de propósito: quem está compartilhando ganha uma tela no palco;
   todo mundo, compartilhando ou não, vira uma pastilha na fila de baixo. Uma
   grade de retângulos vazios não diz nada — e é nas pastilhas que mora o áudio
   de quem só está falando. */

import * as rtc from './rtc.js';
import * as conexao from './conexao.js';
import { icone } from './icones.js';

// exposto só pra depurar pelo console do navegador (ver resolução/bitrate
// reais saindo com stats.getStats()) — nada aqui é usado pela interface.
// Só em localhost: quem assiste pelo link público não precisa disso, e
// chrome://webrtc-internals já cobre o mesmo debug de qualquer lugar.
if (location.hostname === 'localhost') { window.__rtc = rtc; window.__conexao = conexao; }

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

$('resolucao-tela').value = localStorage.getItem('transmissor:resolucao') || '720p';
$('resolucao-tela').addEventListener('change', () => {
  localStorage.setItem('transmissor:resolucao', $('resolucao-tela').value);
});

$('fps-tela').value = localStorage.getItem('transmissor:fps') || '60';
$('fps-tela').addEventListener('change', () => {
  localStorage.setItem('transmissor:fps', $('fps-tela').value);
});

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
    /* Começa a medir junto com a chamada: o diagnóstico compara amostras, e
       quem só liga a medição depois que alguém reclama já perdeu o antes. */
    conexao.observar();
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
    const resultado = await rtc.alternarTela({
      resolucao: $('resolucao-tela').value,
      fps: Number($('fps-tela').value),
    });

    /* Só acontece no navegador. No app de mesa não chega áudio pelo
       getDisplayMedia — o som vem por aplicativo, e a dica de "compartilhe uma
       aba" mandaria a pessoa para o caminho errado justamente onde existe um
       melhor. */
    if (resultado?.audioDescartado && !ponteSom) {
      avisar('sala', 'O áudio do sistema não foi enviado: em janela ou tela '
        + 'inteira ele traria o som de outros apps junto. Pra levar som, '
        + 'compartilhe uma aba do Chrome.');
    }
  } catch (e) {
    // cancelar o diálogo do navegador é rotina, não erro
    if (e?.name !== 'NotAllowedError') avisar('sala', 'Não consegui capturar a tela: ' + e.message);
    return renderizar();
  }
  renderizar();
  if (somDisponivel) await somAutomatico();
}

async function pararDeCompartilhar() {
  await rtc.alternarTela();
  rtc.desligarSomDaTela();
  await ponteSom?.desligar();
  renderizar();
}

/* O painel só serve pra ajustar ao vivo, enquanto já está compartilhando —
   via applyConstraints, sem reabrir o diálogo do navegador nem cair a
   chamada. Compartilhar pela primeira vez não passa por aqui: vai direto com
   o que estiver salvo no localStorage, porque um painel antes de começar
   empilhava dois botões "Compartilhar tela" acentuados, um em cima do outro,
   no estado vazio — o mesmo clique virava dois pra todo mundo, mesmo quem
   nunca ia mexer em resolução. Quem quer outra qualidade ajusta uma vez pela
   engrenagem e a preferência fica. */
const painelQualidade = $('painel-qualidade');
let focoAntesDoPainel = null;

function abrirPainelQualidade(ancora) {
  focoAntesDoPainel = document.activeElement;
  painelQualidade.hidden = false;
  const a = ancora.getBoundingClientRect();
  const p = painelQualidade.getBoundingClientRect();
  painelQualidade.style.left = Math.max(8, Math.min(a.left, innerWidth - p.width - 8)) + 'px';
  painelQualidade.style.top = Math.max(8, a.top - p.height - 8) + 'px';
  $('resolucao-tela').focus();
}

function fecharPainelQualidade() {
  if (painelQualidade.hidden) return;
  painelQualidade.hidden = true;
  // devolve o foco pra quem abriu — sem isso ele fica preso no painel que sumiu
  if (focoAntesDoPainel && document.contains(focoAntesDoPainel)) focoAntesDoPainel.focus();
  focoAntesDoPainel = null;
}

/* ---------- painel de conexão ---------- */

/* Um ícone só, que só muda de cor quando há o que dizer, e um painel que
   abre no clique. "Está travando" é a reclamação mais comum da chamada, e
   antes disto a única resposta possível era adivinhar. */
const painelConexao = $('painel-conexao');
let atualizaConexao = null;

function linhaConexao(nome, numeros, aviso, ruim) {
  const linha = document.createElement('div');
  linha.className = 'conexao-linha';

  const cabeca = document.createElement('div');
  cabeca.className = 'conexao-cabeca';
  const quem = document.createElement('span');
  quem.className = 'conexao-nome';
  quem.textContent = nome;
  const nums = document.createElement('span');
  nums.className = 'conexao-numeros';
  nums.textContent = numeros;
  cabeca.append(quem, nums);
  linha.append(cabeca);

  if (aviso) {
    const texto = document.createElement('div');
    texto.className = 'conexao-diagnostico' + (ruim ? ' ruim' : '');
    texto.textContent = aviso;
    linha.append(texto);
  }
  return linha;
}

function nota(texto) {
  const div = document.createElement('div');
  div.className = 'conexao-nota';
  div.textContent = texto;
  return div;
}

/**
 * Redesenha a lista e a cor do ícone.
 *
 * Roda mesmo com o painel fechado, porque é ela que decide se o ícone fica
 * vermelho — o aviso precisa aparecer sem ninguém ter clicado em nada.
 */
function desenharConexao() {
  const outros = participantes().filter(p => !p.local);
  const lista = $('conexao-lista');
  const filhos = [];
  let algumRuim = false;

  if (!outros.length) {
    filhos.push(nota('Só você na chamada.'));
  } else {
    for (const p of outros) {
      if (['failed', 'disconnected'].includes(p.conexao)) {
        filhos.push(linhaConexao(p.nome, 'sem conexão', 'A conexão com esta pessoa caiu. O navegador tenta refazer sozinho.', true));
        algumRuim = true;
        continue;
      }
      /* Sem mídia a conexão nem chega a existir — medido: zero transceptores,
         estado `new`, e o relatório traz só `peer-connection`. Um traço sozinho
         aqui parece defeito; dizer por que não há número é mais honesto. */
      if (p.conexao !== 'connected') {
        filhos.push(linhaConexao(p.nome, 'sem mídia',
          'A conexão só se forma quando alguém liga o microfone ou compartilha a tela.', false));
        continue;
      }
      const d = conexao.diagnostico(p.sid);
      if (!d) { filhos.push(linhaConexao(p.nome, 'medindo…', null, false)); continue; }

      const partes = [];
      if (d.pingMs !== null) partes.push(`${d.pingMs} ms`);
      if (d.perda !== null) partes.push(`${(d.perda * 100).toFixed(1)}% perda`);
      // o caminho só é dito quando NÃO é o direto: dizer "direto" sempre é ruído
      if (d.caminho && !d.direto) partes.push(d.caminho);
      /* Só mostramos o diagnóstico quando ele acusa alguém, ou quando a
         qualidade escolhida deixou de caber no cano. "Conexão saudável" escrito
         o tempo todo é ruído que ensina a ignorar o painel. */
      let aviso = d.culpa ? d.texto : null;
      if (!aviso && d.apertado) aviso = 'A qualidade escolhida está no limite do que o seu envio aguenta.';
      if (d.culpa) algumRuim = true;

      filhos.push(linhaConexao(p.nome, partes.join(' · ') || '—', aviso, !!d.culpa));
    }
  }

  // com o painel fechado só a cor do ícone importa; montar a lista seria
  // trabalho jogado fora a cada quadro de renderização
  if (!painelConexao.hidden) lista.replaceChildren(...filhos);
  $('btn-conexao').dataset.estado = algumRuim ? 'ruim' : 'ok';
}

function abrirPainelConexao(ancora) {
  focoAntesDoPainel = document.activeElement;
  desenharConexao();
  painelConexao.hidden = false;
  ancora.setAttribute('aria-expanded', 'true');
  const a = ancora.getBoundingClientRect();
  const p = painelConexao.getBoundingClientRect();
  painelConexao.style.left = Math.max(8, Math.min(a.left, innerWidth - p.width - 8)) + 'px';
  painelConexao.style.top = (a.bottom + 8) + 'px';
  // os números mudam sozinhos: painel aberto que congela parece defeito
  atualizaConexao = setInterval(desenharConexao, 2000);
  desenharConexao();   // com o painel já visível, agora a lista é montada
}

function fecharPainelConexao() {
  if (painelConexao.hidden) return;
  painelConexao.hidden = true;
  $('btn-conexao').setAttribute('aria-expanded', 'false');
  if (atualizaConexao) { clearInterval(atualizaConexao); atualizaConexao = null; }
  if (focoAntesDoPainel && document.contains(focoAntesDoPainel)) focoAntesDoPainel.focus();
  focoAntesDoPainel = null;
}

$('btn-conexao').addEventListener('click', () => {
  if (painelConexao.hidden) abrirPainelConexao($('btn-conexao'));
  else fecharPainelConexao();
});

function fecharPopups() {
  fecharMenu();
  fecharPainelQualidade();
  fecharPainelConexao();
}

$('btn-tela').addEventListener('click', () => compartilhar());
$('btn-qualidade').addEventListener('click', () => abrirPainelQualidade($('btn-qualidade')));
$('vazio-compartilhar').addEventListener('click', () => compartilhar());

$('painel-compartilhar').addEventListener('click', async () => {
  fecharPainelQualidade();
  try {
    await rtc.mudarQualidadeTela({
      resolucao: $('resolucao-tela').value,
      fps: Number($('fps-tela').value),
    });
  } catch (e) {
    avisar('sala', 'Não consegui aplicar a qualidade: ' + e.message);
  }
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

/* Som por aplicativo, escolhido por quem compartilha. Fora do app de mesa
   isto nem aparece.
   O áudio desta chamada nunca entra. O que for marcado como "nunca levar"
   também não entra por dedução nem por caixa de seleção. */
let somDisponivel = false;
let somTudo = false;   // o Windows mistura N processos e recusa "tudo"

ponteSom?.recursos().then(r => { somDisponivel = r.disponivel; somTudo = r.tudo; });

/* Quem fica de fora quando o som é "tudo". O nosso próprio app já sai sempre,
   por PID, do lado de lá — esta lista é para o resto, e existe por um caso
   concreto: conversar no Discord e mostrar a tela por aqui. Sem ela, a voz da
   conversa voltaria para dentro da transmissão, com atraso.
   Fica na máquina de quem compartilha: é preferência, não moderação. */
const CHAVE_FORA = 'transmissor:som-fora';
let foraDoSom = new Set();
try { foraDoSom = new Set(JSON.parse(localStorage.getItem(CHAVE_FORA) || '[]')); } catch { /* primeira vez */ }

/* Conjunto de nomes (nunca PIDs: no Windows o PID muda) ou modo 'tudo'.
   Chaves do contrato: escolhidos + modo. 'tudo' só faz sentido no Linux. */
const CHAVE_ESCOLHIDOS = 'transmissor:som-escolhidos';
const CHAVE_MODO = 'transmissor:som-modo';
let alvoDoSom = new Set();
try {
  if (localStorage.getItem(CHAVE_MODO) === 'tudo') alvoDoSom = 'tudo';
  else {
    const salvo = JSON.parse(localStorage.getItem(CHAVE_ESCOLHIDOS) || '[]');
    if (Array.isArray(salvo)) alvoDoSom = new Set(salvo.filter(n => typeof n === 'string' && n));
  }
} catch { /* primeira vez */ }
if (alvoDoSom instanceof Set) for (const nome of foraDoSom) alvoDoSom.delete(nome);

function salvarAlvo() {
  try {
    if (alvoDoSom === 'tudo') {
      localStorage.setItem(CHAVE_MODO, 'tudo');
      localStorage.setItem(CHAVE_ESCOLHIDOS, JSON.stringify([]));
    } else {
      localStorage.removeItem(CHAVE_MODO);
      localStorage.setItem(CHAVE_ESCOLHIDOS, JSON.stringify([...(alvoDoSom instanceof Set ? alvoDoSom : [])]));
    }
  } catch { /* sem espaço */ }
}

function idsParaLigar(apps) {
  /* Sempre string[]. Espalhar 'tudo' ou um nome solto viraria caracteres. */
  if (!(alvoDoSom instanceof Set)) return [];
  if (somTudo) {
    /* Linux: id === nome. Manda o conjunto inteiro, mesmo o jogo ainda
       mudo — o vigia liga quando o fluxo nascer. */
    return [...alvoDoSom].filter(nome => typeof nome === 'string' && nome && !foraDoSom.has(nome));
  }
  return (apps || []).filter(a => alvoDoSom.has(a.nome) && !foraDoSom.has(a.nome)).map(a => a.id);
}

/**
 * Aplica o conjunto de ids ao backend e sincroniza a faixa WebRTC.
 * Mudar o conjunto não recria a faixa; array vazio equivale a desligar.
 * Com o menu aberto não chama renderizar: reconstruir o menu no clique
 * desfaz o alvo e o "clicou fora" fecha tudo.
 */
function atualizarMarcaSomLocal() {
  const t = tiles.get(rtc.eu.sid);
  if (!t) return;
  t.marcaSom.hidden = !rtc.eu.somDaTela;
  t.marcaSom.title = (alvoDoSom instanceof Set && alvoDoSom.size)
    ? `levando o som de ${[...alvoDoSom].join(', ')}`
    : 'transmitindo com som';
}

function depoisDeMudarSom() {
  if (menuAberto && !menu.hidden) atualizarMarcaSomLocal();
  else renderizar();
}

async function aplicarAlvo(ids) {
  if (!ids || ids.length === 0) {
    await ponteSom?.ligar([], []);
    rtc.desligarSomDaTela();
    depoisDeMudarSom();
    return;
  }

  const r = await ponteSom.ligar(ids, []);
  if (!r.ok) {
    avisar('sala', 'Não consegui levar o som: ' + r.erro);
    return;
  }

  if (r.tipo === 'desligado') {
    rtc.desligarSomDaTela();
    depoisDeMudarSom();
    return;
  }

  /* A faixa já ligada fica: rtc.ligarSomDaTela / Pcm no-op se somTelaStream
     existe. Não chamar desligarSomDaTela no meio. */
  if (!rtc.eu.somDaTela) {
    try {
      if (r.tipo === 'pcm') await rtc.ligarSomDaTelaPcm(r, ponteSom.aoReceberPcm);
      else await rtc.ligarSomDaTela(r.fonte);
    } catch (e) {
      await ponteSom.desligar();
      avisar('sala', e.message);
    }
  }
  depoisDeMudarSom();
}

/**
 * Leva todo o som do sistema (Linux).
 * Entrar em tudo limpa as marcas individuais de aplicativos.
 */
async function levarTudo() {
  fecharMenu();
  if (alvoDoSom instanceof Set) alvoDoSom.clear();
  alvoDoSom = 'tudo';
  salvarAlvo();

  const r = await ponteSom.ligar('tudo', [...foraDoSom]);
  if (!r.ok) return avisar('sala', 'Não consegui levar o som: ' + r.erro);

  if (!rtc.eu.somDaTela) {
    try {
      if (r.tipo === 'pcm') await rtc.ligarSomDaTelaPcm(r, ponteSom.aoReceberPcm);
      else await rtc.ligarSomDaTela(r.fonte);
    } catch (e) {
      await ponteSom.desligar();
      avisar('sala', e.message);
    }
  }
  renderizar();
}

/**
 * Para o som da tela e limpa as escolhas.
 * “Parar o som” fecha o menu.
 */
async function tirarSom() {
  fecharMenu();
  if (alvoDoSom instanceof Set) alvoDoSom.clear();
  else alvoDoSom = new Set();
  salvarAlvo();
  rtc.desligarSomDaTela();
  await ponteSom?.desligar();
  renderizar();
}

/**
 * Ao compartilhar tela, semente por sugestão sem apagar as marcas da sessão.
 * Marcado como nunca levar não entra por caixa nem dedução.
 */
async function somAutomatico() {
  const sugestao = await ponteSom.sugestao(rtc.superficieDaTela());
  const jaTemTudo = alvoDoSom === 'tudo';
  const jaTemConjunto = alvoDoSom instanceof Set && alvoDoSom.size > 0;

  /* Semear só na sessão vazia. 'tudo' ou marcas já escolhidas ficam —
     senão compartilhar uma janela derrubaria "Levar todo o som". */
  if (!jaTemTudo && !jaTemConjunto && sugestao) {
    if (sugestao.id === 'tudo') {
      if (somTudo) alvoDoSom = 'tudo';
    } else if (sugestao.nome && !foraDoSom.has(sugestao.nome)) {
      alvoDoSom = new Set([sugestao.nome]);
      salvarAlvo();
    }
  }

  if (alvoDoSom === 'tudo') {
    await levarTudo();
  } else if (alvoDoSom instanceof Set && alvoDoSom.size > 0) {
    const apps = await ponteSom.aplicativos();
    const ids = idsParaLigar(apps);
    if (ids.length > 0) await aplicarAlvo(ids);
  }
}

async function alternarFora(nome) {
  fecharMenu();
  if (foraDoSom.has(nome)) foraDoSom.delete(nome);
  else foraDoSom.add(nome);
  try { localStorage.setItem(CHAVE_FORA, JSON.stringify([...foraDoSom])); } catch { /* sem espaço */ }

  if (alvoDoSom instanceof Set && alvoDoSom.has(nome)) {
    alvoDoSom.delete(nome);
    salvarAlvo();
  }

  /* Trocar a regra não derruba a fonte de áudio, então a faixa que o outro
     lado recebe continua a mesma — sem renegociar, sem cortar o som. */
  if (alvoDoSom === 'tudo') {
    const r = await ponteSom.ligar('tudo', [...foraDoSom]);
    if (!r.ok) avisar('sala', 'Não consegui mudar o som: ' + r.erro);
  }
  renderizar();
}

/**
 * Linha de aplicativo com caixa de marcação.
 * O clique alterna a seleção e chama ligar com o conjunto novo
 * SEM fechar o menu e SEM reconstruí-lo, atualizando apenas esta linha.
 */
/* O nome que o PipeWire dá ao fluxo nem sempre é o nome do programa: o Discord
   registra o dele como "WEBRTC VoiceEngine". Quem lê o menu precisa reconhecer
   o programa que quer tirar da transmissão, então o binário entra junto quando
   o nome não o contém. A identidade continua sendo `nome` — é a chave gravada
   em foraDoSom e nos escolhidos, e renomear quebraria a escolha já salva. */
function rotuloDoApp(nome, binario) {
  if (!binario) return nome;
  const cru = t => t.toLowerCase().replace(/[^a-z0-9]/g, '');
  return cru(nome).includes(cru(binario)) ? nome : `${nome} (${binario})`;
}

function itemAppCaixa(app, apps) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'menu-item';
  btn.setAttribute('role', 'menuitemcheckbox');

  const marcado = alvoDoSom instanceof Set && alvoDoSom.has(app.nome);
  const bloqueado = foraDoSom.has(app.nome);
  const rotulo = rotuloDoApp(app.nome, app.binario);

  btn.setAttribute('aria-checked', String(marcado));
  btn.disabled = bloqueado;
  if (bloqueado) {
    btn.title = `${rotulo} (marcado como nunca levar)`;
  } else {
    btn.title = marcado ? `Deixar de levar o som de ${rotulo}` : `Levar o som de ${rotulo}`;
  }

  const spanIcone = document.createElement('span');
  spanIcone.dataset.icone = marcado ? 'check-square' : 'square';
  spanIcone.append(icone(spanIcone.dataset.icone));

  const spanTexto = document.createElement('span');
  spanTexto.textContent = rotulo;
  btn.append(spanIcone, spanTexto);

  btn.addEventListener('click', async e => {
    e.stopPropagation();
    if (btn.disabled) return;

    let novoMarcado;
    if (alvoDoSom === 'tudo') {
      alvoDoSom = new Set([app.nome]);
      novoMarcado = true;
    } else {
      if (!(alvoDoSom instanceof Set)) alvoDoSom = new Set();
      if (alvoDoSom.has(app.nome)) {
        alvoDoSom.delete(app.nome);
        novoMarcado = false;
      } else {
        alvoDoSom.add(app.nome);
        novoMarcado = true;
      }
    }
    salvarAlvo();

    trocarIcone(btn, novoMarcado ? 'check-square' : 'square');
    btn.setAttribute('aria-checked', String(novoMarcado));
    btn.title = novoMarcado ? `Deixar de levar o som de ${rotulo}` : `Levar o som de ${rotulo}`;
    spanTexto.textContent = rotulo;

    const ids = idsParaLigar(apps);
    await aplicarAlvo(ids);
  });

  return btn;
}

/** Escolha do aplicativo, no botão direito da própria tela. */
async function itensDeSom() {
  const apps = await ponteSom.aplicativos();
  const itens = [];
  const somAtivo = alvoDoSom === 'tudo' || (alvoDoSom instanceof Set && alvoDoSom.size > 0);

  if (somAtivo) itens.push(itemBotao('volume-x', 'Parar o som', tirarSom));

  // sem "tudo" onde a plataforma não sabe fazer: o clique só daria erro
  if (somTudo && alvoDoSom !== 'tudo') {
    itens.push(itemBotao('speaker', 'Levar todo o som', levarTudo));
  }

  for (const app of apps) {
    /* Exclusão só no modo 'tudo' (itens "Nunca levar" abaixo). Fora dele
       um app em foraDoSom não ganha caixa desativada. */
    if (foraDoSom.has(app.nome)) continue;
    itens.push(itemAppCaixa(app, apps));
  }

  /* A exclusão só aparece no modo "tudo": é o único em que ela muda alguma
     coisa. Levando o som de um aplicativo só, nada mais entra por definição.
     A lista inclui quem já está excluído mesmo sem estar tocando — senão não
     haveria como desfazer depois que o programa fecha. */
  if (alvoDoSom === 'tudo') {
    const nomes = [...new Set([...apps.map(a => a.nome), ...foraDoSom])];
    /* Quem está excluído sem estar tocando não tem binário para consultar:
       o rótulo cai no nome gravado, que foi o que a pessoa viu ao excluir. */
    const binarios = new Map(apps.map(a => [a.nome, a.binario]));
    if (nomes.length) itens.push(document.createElement('hr'));
    for (const nome of nomes) {
      const fora = foraDoSom.has(nome);
      const rotulo = rotuloDoApp(nome, binarios.get(nome));
      itens.push(itemBotao(fora ? 'volume-2' : 'volume-x',
        fora ? `Voltar a levar ${rotulo}` : `Nunca levar ${rotulo}`,
        () => alternarFora(nome)));
    }
  }

  /* Sem aplicativo nenhum tocando, "levar todo o som" ainda funciona (o que
     começar depois entra sozinho), mas a lista curta pareceria defeito. */
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
  if (await copiarTexto(link)) {
    trocarIcone($('copiar'), 'check');
    rotulo.textContent = 'Copiado';
    setTimeout(() => { trocarIcone($('copiar'), 'copy'); rotulo.textContent = 'Copiar link'; }, 1600);
  } else {
    avisar('sala', 'O link é ' + link);
  }
});

/** Electron não implementa `prompt()`: o fallback antigo sumia no clique. */
async function copiarTexto(texto) {
  try {
    await navigator.clipboard.writeText(texto);
    return true;
  } catch { /* sem permissão de clipboard — tenta o caminho velho */ }
  const campo = document.createElement('textarea');
  campo.value = texto;
  campo.setAttribute('readonly', '');
  campo.style.position = 'fixed';
  campo.style.left = '-9999px';
  document.body.append(campo);
  campo.select();
  try { return document.execCommand('copy'); }
  finally { campo.remove(); }
}

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
  fecharPopups();
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
  const spanIcone = document.createElement('span');
  spanIcone.dataset.icone = nomeIcone;
  spanIcone.append(icone(nomeIcone));
  const spanTexto = document.createElement('span');
  spanTexto.textContent = texto;
  b.append(spanIcone, spanTexto);
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
  if (!painelQualidade.hidden && !painelQualidade.contains(e.target)
    && !e.target.closest('#btn-tela, #btn-qualidade, #vazio-compartilhar')) {
    fecharPainelQualidade();
  }
  if (!painelConexao.hidden && !painelConexao.contains(e.target)
    && !e.target.closest('#btn-conexao')) {
    fecharPainelConexao();
  }
});
palco.addEventListener('scroll', fecharPopups);
window.addEventListener('resize', fecharPopups);
window.addEventListener('blur', fecharPopups);

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
  $('btn-qualidade').hidden = !rtc.eu.tela;
  // se a tela caiu (ex.: botão nativo do navegador) com o painel de ajuste
  // ao vivo aberto, ele não faz mais sentido — fecha
  if (!painelQualidade.hidden && !rtc.eu.tela) fecharPainelQualidade();
  desenharConexao();
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
  t.marcaSom.hidden = !(p.local ? rtc.eu.somDaTela : rtc.temSom(streamTela));
  t.marcaSom.title = !p.local ? 'transmitindo com som'
    : (alvoDoSom instanceof Set && alvoDoSom.size) ? `levando o som de ${[...alvoDoSom].join(', ')}`
    : 'transmitindo com som';
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
  // só a própria tela: se a janela compartilhada mudar de tamanho, a escala
  // de saída precisa acompanhar — MediaStreamTrack não avisa disso, só o
  // <video> que já está exibindo o preview local
  if (p.local) video.addEventListener('resize', () => rtc.recalcularEscalaTela());
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
  conexao.parar();
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
