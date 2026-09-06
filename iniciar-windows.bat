@echo off
setlocal
title Transmissor
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 22 ou superior nao foi encontrado.
  echo Instale com: winget install OpenJS.NodeJS.LTS
  goto encerrar
)

for /f "tokens=1 delims=." %%V in ('node -p "process.versions.node"') do set "NODE_MAIOR=%%V"
if %NODE_MAIOR% LSS 22 (
  echo Este projeto precisa do Node.js 22 ou superior. Versao encontrada:
  node --version
  goto encerrar
)

where cloudflared >nul 2>nul
if errorlevel 1 (
  echo cloudflared nao foi encontrado.
  echo Instale com: winget install --id Cloudflare.cloudflared
  goto encerrar
)

if not exist node_modules (
  echo Instalando dependencias pela primeira vez...
  call npm install
  if errorlevel 1 goto falhou
)

echo.
echo Iniciando a sala. Copie o link HTTPS que aparecera abaixo.
echo.
call npm run hospedar
if errorlevel 1 goto falhou
goto encerrar

:falhou
echo.
echo Nao foi possivel iniciar a sala.

:encerrar
echo.
pause
exit /b
