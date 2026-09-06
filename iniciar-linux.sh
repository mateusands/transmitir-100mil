#!/usr/bin/env bash
# Lançador Linux; a execução de scripts pelo gerenciador de arquivos depende dele.

set -u

arquivo_script="$(readlink -f -- "${BASH_SOURCE[0]}")"

# Executado pelo gerenciador de arquivos, o script normalmente não recebe um
# terminal. A alternativa Debian tem preferência; nas outras distribuições
# procuramos um emulador instalado. A variável evita abrir uma segunda janela.
if [[ ! -t 0 && "${TRANSMISSOR_EM_TERMINAL:-}" != '1' ]]; then
  for terminal in x-terminal-emulator "${TERMINAL:-}" konsole gnome-terminal xfce4-terminal alacritty kitty foot xterm; do
    [[ -n "$terminal" ]] && command -v "$terminal" >/dev/null 2>&1 || continue
    # GNOME e Xfce precisam de delimitadores próprios para preservar os argumentos.
    case "${terminal##*/}" in
      gnome-terminal) separador='--' ;;
      xfce4-terminal) separador='--execute' ;;
      *) separador='-e' ;;
    esac
    exec "$terminal" "$separador" env TRANSMISSOR_EM_TERMINAL=1 "$arquivo_script"
  done
  mensagem='Não encontrei um terminal para abrir o Transmissor. Instale um terminal ou execute bash iniciar-linux.sh em um terminal existente.'
  printf '%s\n' "$mensagem" >&2
  # Sem terminal, stderr fica invisível ao abrir pelo gerenciador de arquivos.
  if command -v zenity >/dev/null 2>&1; then
    zenity --error --text="$mensagem"
  elif command -v kdialog >/dev/null 2>&1; then
    kdialog --error "$mensagem"
  fi
  exit 1
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
