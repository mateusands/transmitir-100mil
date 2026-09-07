#!/bin/bash
# O Terminal.app abre arquivos .command executáveis. Compatível com Bash 3.2.

set -u

# O Bash e o dirname do macOS bastam; não dependemos de readlink -f do GNU.
diretorio="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)" || exit 1
cd "$diretorio" || exit 1

esperar_saida() {
  local codigo="${1:-0}"
  printf '\nPressione Enter para fechar esta janela...'
  read -r _ || true
  exit "$codigo"
}

falhar() {
  printf '\n%s\n' "$1" >&2
  esperar_saida 1
}

command -v node >/dev/null 2>&1 || falhar 'Node.js 22 ou superior não foi encontrado. Instale-o e reabra o lançador.'
node_maior="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null)" || falhar 'Não foi possível identificar a versão do Node.js.'
[[ "$node_maior" =~ ^[0-9]+$ && "$node_maior" -ge 22 ]] || falhar "Este projeto precisa do Node.js 22 ou superior. Versão encontrada: $(node --version)"
command -v npm >/dev/null 2>&1 || falhar 'npm não foi encontrado. Instale-o junto com o Node.js.'

if ! command -v cloudflared >/dev/null 2>&1; then
  printf '\ncloudflared não foi encontrado. Continuando em modo local, sem link público.\n'
fi

if [[ ! -d node_modules ]]; then
  printf 'Instalando dependências pela primeira vez...\n'
  npm install || falhar 'Não foi possível instalar as dependências.'
fi

printf '\nIniciando a sala. O endereço disponível aparecerá abaixo.\n\n'
npm run hospedar
codigo=$?
if [[ "$codigo" -ne 0 ]]; then
  printf '\nNão foi possível iniciar a sala.\n' >&2
fi
esperar_saida "$codigo"
