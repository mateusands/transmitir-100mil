/* Compila os binários de captura do Windows, a partir do Linux ou do macOS.
 *
 * A toolchain é baixada para dentro do projeto (`.bin/`), como o `pasta.sh` faz
 * com o Node — nada é instalado no sistema, e apagar a pasta apaga tudo. É o
 * llvm-mingw, que traz clang, headers e bibliotecas do Windows num tarball só.
 *
 * Por que compilar aqui e não só na CI: poder rodar `node
 * tools/compilar-windows.mjs` e ver o erro na hora vale mais do que esperar um
 * push. A CI continua compilando com o MSVC de verdade, que é o compilador que
 * a Microsoft usa — se os dois concordam, é sinal melhor ainda.
 *
 *   node tools/compilar-windows.mjs
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const VERSAO = '20260826';
const TARBALL = `llvm-mingw-${VERSAO}-ucrt-ubuntu-22.04-x86_64.tar.xz`;
const URL = `https://github.com/mstorsjo/llvm-mingw/releases/download/${VERSAO}/${TARBALL}`;
/* Confira antes de extrair: o arquivo veio da rede e o que sai dele compila
   código que vai rodar na máquina de outras pessoas. Ao subir a versão, troque
   as duas linhas juntas. */
const SHA256 = 'cee8d2ce3da5145ce4dc882e70d0b0719a783d53a99752c60948fc0659975a65';

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const FONTE = path.join(RAIZ, 'desktop', 'nativo', 'win');
const PASTA = path.join(RAIZ, '.bin', 'llvm-mingw');
const CXX = path.join(PASTA, `llvm-mingw-${VERSAO}-ucrt-ubuntu-22.04-x86_64`, 'bin', 'x86_64-w64-mingw32-clang++');

const rodar = (cmd, args, opcoes = {}) =>
  execFileSync(cmd, args, { stdio: 'inherit', ...opcoes });

function garantirToolchain() {
  if (fs.existsSync(CXX)) {
    console.log('  Toolchain já está em .bin/llvm-mingw.');
    return;
  }
  fs.mkdirSync(PASTA, { recursive: true });
  const tgz = path.join(PASTA, TARBALL);
  console.log(`  Baixando llvm-mingw ${VERSAO} (~80 MB) para .bin/…`);
  rodar('curl', ['-fL', '--progress-bar', URL, '-o', tgz]);

  const soma = createHash('sha256').update(fs.readFileSync(tgz)).digest('hex');
  if (soma !== SHA256) {
    console.error(`  A soma nao confere.\n    esperada: ${SHA256}\n    obtida:   ${soma}`);
    fs.rmSync(tgz, { force: true });
    process.exit(1);
  }
  console.log('  Soma sha256 confere.');
  rodar('tar', ['-xf', tgz, '-C', PASTA]);
  fs.rmSync(tgz, { force: true });   // 80 MB que não servem mais para nada
  if (!fs.existsSync(CXX)) {
    console.error('  O compilador nao apareceu onde eu esperava.');
    process.exit(1);
  }
}

const COMUNS = ['-O2', '-Wall', '-Wextra', '-std=c++17', '-static', '-DUNICODE', '-D_UNICODE'];

function compilar(nome, extras) {
  const saida = path.join(FONTE, `${nome}.exe`);
  console.log(`  Compilando ${nome}.cpp…`);
  rodar(CXX, [...COMUNS, ...extras, path.join(FONTE, `${nome}.cpp`), '-o', saida]);
  const tamanho = (fs.statSync(saida).size / 1024).toFixed(0);
  console.log(`    ${nome}.exe  ${tamanho} KB`);
}

garantirToolchain();
// -municode porque o captura.cpp entra por wmain, para receber argumento em UTF-16
compilar('captura', ['-municode', '-lole32', '-lmmdevapi']);
compilar('janelas', ['-luser32']);

console.log('\n  Prontos em desktop/nativo/win/.');
console.log('  Compilar nao e testar: rodar de verdade ainda precisa de um Windows.');
