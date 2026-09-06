#!/usr/bin/env bash
# Modo pasta: hospedar sem instalar nada na máquina.
#
# O que falta vem para .node/ e .bin/ e sai junto com a pasta do projeto. O que
# já existe no sistema é reaproveitado.
#
#   tools/pasta.sh             sobe a sala
#   tools/pasta.sh verificar   mostra o que seria usado, sem subir nada
#   tools/pasta.sh limpar      apaga .node/, .bin/ e node_modules/

set -euo pipefail

NODE_VERSAO="v22.23.2"   # LTS. Trocar aqui é a única mudança necessária.

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PASTA_NODE="$RAIZ/.node"
PASTA_BIN="$RAIZ/.bin"

msg()   { printf '  %s\n' "$1"; }
falhar() { printf '\n  %s\n\n' "$1" >&2; exit 1; }

# ---------- plataforma ----------

case "$(uname -s)" in
  Linux)  SO=linux;  SO_CF=linux ;;
  Darwin) SO=darwin; SO_CF=darwin ;;
  *) falhar "Sistema não reconhecido: $(uname -s). No Windows, use tools\\pasta.ps1." ;;
esac

case "$(uname -m)" in
  x86_64|amd64)  ARQ=x64;   ARQ_CF=amd64 ;;
  aarch64|arm64) ARQ=arm64; ARQ_CF=arm64 ;;
  *) falhar "Arquitetura não reconhecida: $(uname -m)." ;;
esac

# ---------- ferramentas ----------

soma_sha256() {
  # o coreutils traz sha256sum; o macOS, shasum
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1
  else shasum -a 256 "$1" | cut -d' ' -f1
  fi
}

baixar() {
  # -f: falha em 404 em vez de gravar a página de erro no disco
  curl -fL --progress-bar "$1" -o "$2" || falhar "Não consegui baixar: $1"
}

node_do_sistema() {
  command -v node >/dev/null 2>&1 || return 1
  local maior
  maior="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null)" || return 1
  [ "$maior" -ge 22 ] 2>/dev/null
}

# ---------- Node ----------

garantir_node() {
  if [ -x "$PASTA_NODE/bin/node" ]; then
    msg "Node desta pasta: $("$PASTA_NODE/bin/node" --version)"
    return
  fi
  if node_do_sistema; then
    msg "Node do sistema: $(node --version) — nada a baixar."
    return
  fi

  local arquivo="node-$NODE_VERSAO-$SO-$ARQ.tar.xz"
  local base="https://nodejs.org/dist/$NODE_VERSAO"
  local tmp
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' RETURN

  msg "Node 22+ não encontrado. Baixando $arquivo (~30 MB) para esta pasta…"
  baixar "$base/$arquivo" "$tmp/$arquivo"
  baixar "$base/SHASUMS256.txt" "$tmp/SHASUMS256.txt"

  # confere antes de extrair: o arquivo veio da rede, e a lista é assinada pelo
  # mesmo host mas serve para pegar download truncado ou corrompido
  local esperado obtido
  # sem o `|| true`, o set -e mataria o script no grep vazio e a mensagem
  # abaixo, que é a útil, nunca apareceria
  esperado="$(grep " $arquivo\$" "$tmp/SHASUMS256.txt" | cut -d' ' -f1 || true)"
  [ -n "$esperado" ] || falhar "O SHASUMS256.txt não lista $arquivo."
  obtido="$(soma_sha256 "$tmp/$arquivo")"
  [ "$esperado" = "$obtido" ] || falhar "Soma SHA-256 não confere para $arquivo. Baixe de novo."

  mkdir -p "$PASTA_NODE"
  tar -xJf "$tmp/$arquivo" -C "$PASTA_NODE" --strip-components=1
  [ -x "$PASTA_NODE/bin/node" ] || falhar "O Node não ficou executável em .node/bin."

  # 63 MB de cabeçalhos C que só servem para compilar módulo nativo — este
  # projeto não tem nenhum, e o node-gyp baixa os dele quando precisa. Sai fora:
  # é quase um terço do que o Node ocupa em disco.
  rm -rf "$PASTA_NODE/include" "$PASTA_NODE/share" "$PASTA_NODE/CHANGELOG.md"
  msg "Node desta pasta: $("$PASTA_NODE/bin/node" --version)"
}

# ---------- cloudflared ----------

garantir_cloudflared() {
  if [ -x "$PASTA_BIN/cloudflared" ]; then
    msg "cloudflared desta pasta: $("$PASTA_BIN/cloudflared" --version 2>/dev/null | head -1)"
    return
  fi
  if command -v cloudflared >/dev/null 2>&1; then
    msg "cloudflared do sistema: $(cloudflared --version 2>/dev/null | head -1) — nada a baixar."
    return
  fi

  local base="https://github.com/cloudflare/cloudflared/releases/latest/download"
  mkdir -p "$PASTA_BIN"
  msg "cloudflared não encontrado. Baixando para esta pasta…"

  if [ "$SO_CF" = darwin ]; then
    local tmp
    tmp="$(mktemp -d)"
    trap 'rm -rf "$tmp"' RETURN
    baixar "$base/cloudflared-darwin-$ARQ_CF.tgz" "$tmp/cf.tgz"
    tar -xzf "$tmp/cf.tgz" -C "$PASTA_BIN"
  else
    baixar "$base/cloudflared-linux-$ARQ_CF" "$PASTA_BIN/cloudflared"
  fi

  chmod +x "$PASTA_BIN/cloudflared"
  # a Cloudflare não publica soma para o binário solto; o que dá para conferir é
  # que ele executa e se identifica
  "$PASTA_BIN/cloudflared" --version >/dev/null 2>&1 \
    || falhar "O cloudflared baixado não executou. Apague .bin/ e tente de novo."
  msg "cloudflared desta pasta: $("$PASTA_BIN/cloudflared" --version 2>/dev/null | head -1)"
}

# ---------- comandos ----------

limpar() {
  rm -rf "$PASTA_NODE" "$PASTA_BIN" "$RAIZ/node_modules"
  msg "Apagados: .node/, .bin/ e node_modules/."
  msg "O que sobra na pasta é só o código do projeto."
}

case "${1:-hospedar}" in
  limpar) limpar; exit 0 ;;
  verificar|hospedar) ;;
  *) falhar "Uso: tools/pasta.sh [hospedar|verificar|limpar]" ;;
esac

printf '\n  Modo pasta — %s %s\n\n' "$SO" "$ARQ"
garantir_node
garantir_cloudflared

# a pasta vem primeiro no PATH: o que está aqui dentro ganha do que está no
# sistema, e o hospedar.mjs acha o cloudflared sem saber de nada disso
export PATH="$PASTA_NODE/bin:$PASTA_BIN:$PATH"

if [ ! -d "$RAIZ/node_modules" ]; then
  msg "Instalando dependências (só na primeira vez)…"
  (cd "$RAIZ" && npm install --silent) || falhar "npm install falhou."
fi

if [ "${1:-hospedar}" = verificar ]; then
  printf '\n  Tudo pronto. Nada foi instalado fora desta pasta.\n'
  printf '  node:        %s\n' "$(command -v node)"
  printf '  npm:         %s\n' "$(command -v npm)"
  printf '  cloudflared: %s\n' "$(command -v cloudflared)"
  printf '  Para subir:  tools/pasta.sh\n\n'
  exit 0
fi

printf '\n'
cd "$RAIZ"
# exec: o Node assume este processo. Ctrl+C chega nele, que derruba servidor e
# túnel juntos — sem shell intermediário para deixar processo pendurado.
exec node tools/hospedar.mjs
