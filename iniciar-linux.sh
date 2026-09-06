#!/usr/bin/env bash
# Lançador para Ubuntu e Debian. Pode ser aberto por duplo clique via o .desktop.

set -u

arquivo_script="$(readlink -f -- "${BASH_SOURCE[0]}")"

# Executado pelo gerenciador de arquivos, o script normalmente não recebe um
# terminal. Ubuntu e Debian oferecem x-terminal-emulator para abrir o terminal
# configurado pelo usuário; dentro dele a variável evita abrir uma segunda vez.
if [[ ! -t 0 && "${TRANSMISSOR_EM_TERMINAL:-}" != '1' ]]; then
  command -v x-terminal-emulator >/dev/null 2>&1 \
    || { printf 'Não encontrei um terminal para abrir o Transmissor.\n' >&2; exit 1; }
  exec x-terminal-emulator -e env TRANSMISSOR_EM_TERMINAL=1 "$arquivo_script"
fi

diretorio="$(dirname -- "$arquivo_script")"
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

command -v node >/dev/null 2>&1 || falhar 'Node.js 22 ou superior não foi encontrado.'
node_maior="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null)" || falhar 'Não foi possível identificar a versão do Node.js.'
[[ "$node_maior" =~ ^[0-9]+$ && "$node_maior" -ge 22 ]] || falhar "Este projeto precisa do Node.js 22 ou superior. Versão encontrada: $(node --version)"

command -v cloudflared >/dev/null 2>&1 || falhar 'cloudflared não foi encontrado. Instale-o antes de abrir este lançador.'

if [[ ! -d node_modules ]]; then
  printf 'Instalando dependências pela primeira vez...\n'
  npm install || falhar 'Não foi possível instalar as dependências.'
fi

printf '\nIniciando a sala. Copie o link HTTPS que aparecer abaixo.\n\n'
npm run hospedar
codigo=$?

if [[ "$codigo" -ne 0 ]]; then
  printf '\nNão foi possível iniciar a sala.\n' >&2
fi
esperar_saida "$codigo"
