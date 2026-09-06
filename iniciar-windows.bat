@echo off
setlocal
set "CODIGO_SAIDA=0"
title Transmissor
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 22 ou superior nao foi encontrado.
  echo Instale com: winget install OpenJS.NodeJS.LTS
  goto erro
)

set "NODE_MAIOR="
for /f "tokens=1 delims=." %%V in ('node -p "process.versions.node"') do set "NODE_MAIOR=%%V"
if not defined NODE_MAIOR (
  echo Nao foi possivel identificar a versao do Node.js.
  goto erro
)
if %NODE_MAIOR% LSS 22 (
  echo Este projeto precisa do Node.js 22 ou superior. Versao encontrada:
  node --version
  goto erro
)

where npm >nul 2>nul
if errorlevel 1 (
  echo npm nao foi encontrado. Instale-o junto com o Node.js.
  goto erro
)

where cloudflared >nul 2>nul
if errorlevel 1 (
  echo cloudflared nao foi encontrado. Continuando em modo local, sem link publico.
  echo Para habilitar o link publico, instale com: winget install --id Cloudflare.cloudflared
)

if not exist node_modules (
  echo Instalando dependencias pela primeira vez...
  call npm install
  if errorlevel 1 goto falhou
)

echo.
echo Iniciando a sala. O endereco disponivel aparecera abaixo.
echo.
call npm run hospedar
if errorlevel 1 goto falhou
goto encerrar

:falhou
echo.
echo Nao foi possivel iniciar a sala.

:erro
set "CODIGO_SAIDA=1"

:encerrar
echo.
pause
exit /b %CODIGO_SAIDA%
