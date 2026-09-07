/* Gera public/js/icones.js a partir do lucide-static.
 *
 * Os ícones entram no repositório já convertidos, e a página não busca nada de
 * CDN nenhum — importa porque a chamada roda por um túnel que pode ser a única
 * coisa que a rede de quem assiste alcança.
 *
 * O pacote NÃO é dependência do projeto: são 63 MB de SVG para produzir 4 KB
 * de saída, e o `npm install` os baixaria na máquina de todo mundo para nada,
 * porque o resultado já está versionado. Aqui ele é buscado na hora, conferido
 * pela soma que o npm publica, e some com a pasta temporária no fim.
 *
 * Uso:  npm run gerar-icones   (só quando mudar a lista abaixo)
 */

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const VERSAO = '1.41.0';
/* Soma do tarball publicado. Ao subir a versão, troque as duas linhas juntas:
   `npm view lucide-static@<versao> dist.integrity` diz a nova. */
const INTEGRIDADE = 'sha512-39fX7SH+Rwis0oUmLLOipOoFSiJll9yi2DyEGDaE7Sp0qQAEhEfMQ2scQNdWKeGVENGv1uXc5ZeZqBWsuhQSFg==';

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DESTINO = path.join(RAIZ, 'public', 'js', 'icones.js');

const tmp = mkdtempSync(path.join(tmpdir(), 'lucide-'));
process.on('exit', () => rmSync(tmp, { recursive: true, force: true }));

console.log(`  Baixando lucide-static@${VERSAO}…`);
const tgz = execFileSync('npm', ['pack', `lucide-static@${VERSAO}`, '--pack-destination', tmp],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().split('\n').pop();

// confere antes de extrair: o arquivo veio da rede e o que sai dele vai para o repositório
const soma = 'sha512-' + createHash('sha512').update(fs.readFileSync(path.join(tmp, tgz))).digest('base64');
if (soma !== INTEGRIDADE) {
  console.error(`  A soma nao confere.\n    esperada: ${INTEGRIDADE}\n    obtida:   ${soma}`);
  process.exit(1);
}
execFileSync('tar', ['-xzf', path.join(tmp, tgz), '-C', tmp]);

const PACOTE = path.join(tmp, 'package');
const ORIGEM = path.join(PACOTE, 'icons');

const USADOS = [
  'screen-share', 'screen-share-off',
  'mic', 'mic-off',
  'volume-2', 'volume-x',
  'maximize', 'minimize', 'expand',
  'users', 'copy', 'check', 'log-out',
  'monitor-off', 'circle-alert', 'loader-circle', 'speaker', 'settings',
];

/* só o miolo interessa: o <svg> de fora é montado no cliente, com o tamanho e
   a classe que cada lugar precisa */
function miolo(nome) {
  const svg = fs.readFileSync(path.join(ORIGEM, `${nome}.svg`), 'utf8');
  return svg
    .replace(/^[\s\S]*?<svg[^>]*>/, '')
    .replace(/<\/svg>\s*$/, '')
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean)
    .join('');
}

const corpo = USADOS.map(n => `  '${n}': '${miolo(n).replace(/'/g, "\\'")}',`).join('\n');

fs.writeFileSync(DESTINO, `/* GERADO por tools/gerar-icones.mjs — não edite à mão.
   Ícones do Lucide (ISC), v${JSON.parse(fs.readFileSync(path.join(PACOTE, 'package.json'), 'utf8')).version}. */

const CAMINHOS = {
${corpo}
};

/**
 * Um <svg> pronto pra pendurar no DOM. Herda a cor do texto, então segue o
 * estado do elemento em volta — que é o motivo de não usarmos emoji: aquele
 * tem cor fixa, muda de desenho a cada sistema e depende de fonte instalada.
 */
export function icone(nome, { tamanho = 20, classe = '' } = {}) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', tamanho);
  svg.setAttribute('height', tamanho);
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('icone');
  if (classe) svg.classList.add(classe);
  svg.innerHTML = CAMINHOS[nome] || '';
  return svg;
}
`);

console.log(`  ${USADOS.length} ícones gravados em public/js/icones.js`);
