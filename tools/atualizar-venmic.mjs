/* Traz o addon do venmic para dentro do repositório, enxuto.
 *
 * Por que versionar em vez de depender do pacote npm: o @vencord/venmic declara
 * o cmake-js como dependência de RUNTIME, e ele arrasta 71 pacotes — incluindo
 * npmlog, gauge e tar@6, todos marcados obsoletos pelo npm, o último com
 * vulnerabilidades divulgadas. Nada disso executa: o pacote já traz binário
 * pronto, e o cmake-js só serviria para compilar. É custo puro para quem
 * instala. O Vesktop, de onde o venmic vem, faz o mesmo que fazemos aqui.
 *
 * E por que passar o strip: o binário publicado tem 25 MB, dos quais ~23 são
 * debug_info. Sem eles são 1,8 MB — versionável sem doer.
 *
 *   node tools/atualizar-venmic.mjs
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, copyFileSync, mkdirSync, statSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const VERSAO = '7.2.1';   // trocar aqui é a única mudança necessária
const ARQUITETURAS = ['x64', 'arm64'];

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DESTINO = path.join(RAIZ, 'desktop', 'nativo');

const rodar = (cmd, args, opcoes = {}) =>
  execFileSync(cmd, args, { encoding: 'utf8', ...opcoes }).trim();

/* O strip do binutils só entende a arquitetura da própria máquina; o do LLVM
   entende todas. Sem ele dá para gerar só o binário do seu próprio arco. */
function acharStrip() {
  for (const cmd of ['llvm-strip', 'eu-strip']) {
    // executar direto em vez de perguntar ao shell: com shell + argumentos o
    // Node avisa de injeção, e aqui não há motivo para passar por ele
    try { rodar(cmd, ['--version'], { stdio: ['ignore', 'pipe', 'ignore'] }); return cmd; }
    catch { /* não existe nesta máquina */ }
  }
  return null;
}

const strip = acharStrip();
if (!strip) {
  console.error('Preciso do llvm-strip (pacote llvm) ou do eu-strip (elfutils).');
  process.exit(1);
}

const tmp = mkdtempSync(path.join(tmpdir(), 'venmic-'));
try {
  console.log(`  Baixando @vencord/venmic@${VERSAO}…`);
  // o npm despeja o inventário do pacote em stderr; só o nome do .tgz interessa
  const tgz = rodar('npm', ['pack', `@vencord/venmic@${VERSAO}`, '--pack-destination', tmp],
    { stdio: ['ignore', 'pipe', 'ignore'] }).split('\n').pop();
  rodar('tar', ['-xzf', path.join(tmp, tgz), '-C', tmp]);

  mkdirSync(DESTINO, { recursive: true });
  for (const arco of ARQUITETURAS) {
    const origem = path.join(tmp, 'package', 'prebuilds', `venmic-addon-linux-${arco}`, 'node-napi-v7.node');
    const alvo = path.join(DESTINO, `venmic-linux-${arco}.node`);
    const antes = statSync(origem).size;
    copyFileSync(origem, alvo);
    rodar(strip, ['--strip-unneeded', alvo]);
    const depois = statSync(alvo).size;
    const mb = n => (n / 1024 / 1024).toFixed(1) + ' MB';
    console.log(`  ${path.basename(alvo)}: ${mb(antes)} → ${mb(depois)}`);
  }

  console.log(`\n  Em desktop/nativo/: ${readdirSync(DESTINO).join(', ')}`);
  console.log('  Confira que o app ainda liga o som antes de commitar.');
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
