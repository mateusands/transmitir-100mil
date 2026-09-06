/* Gera public/js/icones.js a partir do lucide-static.
 *
 * Os ícones entram no repositório já convertidos: o pacote é dependência de
 * desenvolvimento, não vai pro navegador, e a página não busca nada de CDN
 * nenhum — importa porque a chamada roda por um túnel que pode ser a única
 * coisa que a rede de quem assiste alcança.
 *
 * Uso:  npm run gerar-icones   (só quando mudar a lista abaixo)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const ORIGEM = path.join(RAIZ, 'node_modules', 'lucide-static', 'icons');
const DESTINO = path.join(RAIZ, 'public', 'js', 'icones.js');

const USADOS = [
  'screen-share', 'screen-share-off',
  'mic', 'mic-off',
  'volume-2', 'volume-x',
  'maximize', 'minimize', 'expand',
  'users', 'copy', 'check', 'log-out',
  'monitor-off', 'circle-alert', 'loader-circle',
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
   Ícones do Lucide (ISC), v${JSON.parse(fs.readFileSync(path.join(RAIZ, 'node_modules', 'lucide-static', 'package.json'), 'utf8')).version}. */

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
