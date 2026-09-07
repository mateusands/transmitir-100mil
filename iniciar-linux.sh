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
if [[ ! -d node_modules ]]; then
  printf 'Instalando dependências pela primeira vez...\n'
  npm install || falhar 'Não foi possível instalar as dependências.'
fi

# Só quem vai publicar precisa do túnel. Avisar antes do menu assustava quem ia
# escolher só o app de mesa, que não usa cloudflared para nada.
avisar_cloudflared() {
  command -v cloudflared >/dev/null 2>&1 && return 0
  printf '\ncloudflared não foi encontrado. A sala sobe em modo local, sem link público.\n'
}

# ---------- o que abrir ----------

# Sem ninguém para responder (pipe, CI, gerenciador sem terminal), segue no modo
# de sempre em vez de travar esperando uma tecla que não vem.
modo=1
if [[ -t 0 ]]; then
  printf '\n  O que você quer fazer?\n\n'
  printf '    1) Hospedar a sala      link público, para convidar gente\n'
  printf '    2) Abrir o app de mesa  som por aplicativo, só nesta máquina\n'
  printf '    3) Os dois              link público e o app aberto aqui\n\n'
  while true; do
    printf '  Escolha [1]: '
    read -r modo || { modo=1; printf '\n'; break; }
    modo="${modo:-1}"
    [[ "$modo" =~ ^[123]$ ]] && break
    printf '  Responda 1, 2 ou 3.\n'
  done
fi

# O app só sobe servidor próprio se a porta estiver livre — é o que permite ele
# conviver com o túnel. Esperar a porta antes de abrir evita os dois brigarem.
esperar_porta() {
  local i
  # 10s: é o servidor local que esperamos, não o túnel — esse demora mais e o
  # app não depende dele
  for i in $(seq 1 50); do
    node -e 'const s=require("net").connect(Number(process.env.PORT)||3000,"127.0.0.1");s.on("connect",()=>{s.end();process.exit(0)});s.on("error",()=>process.exit(1))' 2>/dev/null && return 0
    sleep 0.2
  done
  return 1
}

case "$modo" in
  2)
    printf '\nAbrindo o app de mesa...\n\n'
    npm run app
    ;;
  3)
    avisar_cloudflared
    printf '\nHospedando a sala e abrindo o app de mesa...\n\n'
    npm run hospedar &
    hospedar_pid=$!
    esperar_porta || printf '\nO servidor demorou a subir; abrindo o app mesmo assim.\n'
    npm run app
    # fechar a janela do app encerra o túnel junto: ninguém fica com link no ar
    kill "$hospedar_pid" 2>/dev/null || true
    wait "$hospedar_pid" 2>/dev/null || true
    ;;
  *)
    avisar_cloudflared
    printf '\nIniciando a sala. O endereço disponível aparecerá abaixo.\n\n'
    npm run hospedar
    ;;
esac
codigo=$?
if [[ "$codigo" -ne 0 ]]; then
  printf '\nNão foi possível iniciar.\n' >&2
fi
esperar_saida "$codigo"
