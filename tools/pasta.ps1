# Modo pasta no Windows: hospedar sem instalar nada na máquina.
#
# Mesma ideia do tools/pasta.sh: o que falta vem para dentro desta pasta —
# Node em .node\, cloudflared em .bin\ — e some junto com ela. O que já existe
# no sistema é reaproveitado.
#
#   powershell -ExecutionPolicy Bypass -File tools\pasta.ps1
#   powershell -ExecutionPolicy Bypass -File tools\pasta.ps1 verificar
#   powershell -ExecutionPolicy Bypass -File tools\pasta.ps1 limpar
#
# ATENÇÃO: escrito sem uma máquina Windows para exercitar. O caminho equivalente
# no Linux está testado; este aqui foi conferido só na leitura. Se falhar, o
# `verificar` é o lugar de começar a olhar.

param([string]$Comando = 'hospedar')

$ErrorActionPreference = 'Stop'
$NodeVersao = 'v22.23.2'   # LTS, mesma do pasta.sh

$Raiz       = Split-Path -Parent $PSScriptRoot
$PastaNode  = Join-Path $Raiz '.node'
$PastaBin   = Join-Path $Raiz '.bin'

function Msg($t)    { Write-Host "  $t" }
function Falhar($t) { Write-Host ""; Write-Error $t; exit 1 }

$Arq = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'x64' }

function NodeDoSistema {
  $node = Get-Command node -ErrorAction SilentlyContinue
  if (-not $node) { return $false }
  $maior = (& node -p 'process.versions.node.split(".")[0]' 2>$null)
  return ($maior -as [int]) -ge 22
}

function GarantirNode {
  if (Test-Path (Join-Path $PastaNode 'node.exe')) {
    Msg "Node desta pasta: $(& (Join-Path $PastaNode 'node.exe') --version)"
    return
  }
  if (NodeDoSistema) {
    Msg "Node do sistema: $(& node --version) — nada a baixar."
    return
  }

  $arquivo = "node-$NodeVersao-win-$Arq.zip"
  $base    = "https://nodejs.org/dist/$NodeVersao"
  $tmp     = Join-Path ([System.IO.Path]::GetTempPath()) ([System.Guid]::NewGuid())
  New-Item -ItemType Directory -Path $tmp | Out-Null

  try {
    Msg "Node 22+ nao encontrado. Baixando $arquivo (~30 MB) para esta pasta..."
    Invoke-WebRequest -Uri "$base/$arquivo" -OutFile "$tmp\$arquivo"
    Invoke-WebRequest -Uri "$base/SHASUMS256.txt" -OutFile "$tmp\SHASUMS256.txt"

    # confere antes de extrair: pega download truncado ou corrompido
    $linha = Select-String -Path "$tmp\SHASUMS256.txt" -Pattern " $arquivo$" | Select-Object -First 1
    if (-not $linha) { Falhar "O SHASUMS256.txt nao lista $arquivo." }
    $esperado = ($linha.Line -split '\s+')[0]
    $obtido   = (Get-FileHash "$tmp\$arquivo" -Algorithm SHA256).Hash.ToLower()
    if ($esperado -ne $obtido) { Falhar "Soma SHA-256 nao confere para $arquivo." }

    Expand-Archive -Path "$tmp\$arquivo" -DestinationPath $tmp -Force
    Move-Item -Path (Join-Path $tmp "node-$NodeVersao-win-$Arq") -Destination $PastaNode
  } finally {
    Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
  }

  Msg "Node desta pasta: $(& (Join-Path $PastaNode 'node.exe') --version)"
}

function GarantirCloudflared {
  $local = Join-Path $PastaBin 'cloudflared.exe'
  if (Test-Path $local) { Msg "cloudflared desta pasta: ja esta aqui."; return }
  if (Get-Command cloudflared -ErrorAction SilentlyContinue) {
    Msg "cloudflared do sistema encontrado — nada a baixar."
    return
  }

  New-Item -ItemType Directory -Path $PastaBin -Force | Out-Null
  Msg "cloudflared nao encontrado. Baixando para esta pasta..."
  Invoke-WebRequest -Uri "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe" -OutFile $local
  # a Cloudflare nao publica soma para o binario solto; o que da para conferir
  # e que ele executa e se identifica
  & $local --version | Out-Null
  Msg "cloudflared desta pasta: ok"
}

if ($Comando -eq 'limpar') {
  foreach ($p in @($PastaNode, $PastaBin, (Join-Path $Raiz 'node_modules'))) {
    Remove-Item -Recurse -Force $p -ErrorAction SilentlyContinue
  }
  Msg "Apagados: .node\, .bin\ e node_modules\."
  exit 0
}
if ($Comando -notin @('hospedar', 'verificar')) {
  Falhar "Uso: pasta.ps1 [hospedar|verificar|limpar]"
}

Write-Host ""
Msg "Modo pasta — windows $Arq"
Write-Host ""
GarantirNode
GarantirCloudflared

# a pasta vem primeiro no PATH: o que esta aqui dentro ganha do sistema
$env:PATH = "$PastaNode;$PastaBin;$env:PATH"

if (-not (Test-Path (Join-Path $Raiz 'node_modules'))) {
  Msg "Instalando dependencias (so na primeira vez)..."
  Push-Location $Raiz
  & npm install --silent
  Pop-Location
}

if ($Comando -eq 'verificar') {
  Write-Host ""
  Msg "Tudo pronto. Nada foi instalado fora desta pasta."
  Msg "node:        $((Get-Command node).Source)"
  Msg "cloudflared: $((Get-Command cloudflared).Source)"
  Write-Host ""
  exit 0
}

Write-Host ""
Set-Location $Raiz
& node tools\hospedar.mjs
