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

if not exist node_modules (
  echo Instalando dependencias pela primeira vez...
  call npm install
  if errorlevel 1 goto falhou
)

echo.
echo   O que voce quer fazer?
echo.
echo     1) Hospedar a sala      link publico, para convidar gente
echo     2) Abrir o app de mesa  som por aplicativo, so nesta maquina
echo     3) Os dois              a sala numa janela e o app nesta
echo.
rem Sem ninguem para responder, o set /p deixa a variavel intacta e cai no 1
set "MODO="
set /p "MODO=  Escolha [1]: "
if not defined MODO set "MODO=1"
if "%MODO%"=="2" goto modo_app
if "%MODO%"=="3" goto modo_ambos

call :aviso_cloudflared
echo.
echo Iniciando a sala. O endereco disponivel aparecera abaixo.
echo.
call npm run hospedar
if errorlevel 1 goto falhou
goto encerrar

:modo_app
echo.
echo Abrindo o app de mesa...
echo.
call npm run app
if errorlevel 1 goto falhou
goto encerrar

:modo_ambos
rem O .bat nao tem controle de tarefas como o shell: a sala vai para uma janela
rem propria, que mostra o link e se encerra com Ctrl+C. O app fica nesta.
call :aviso_cloudflared
echo.
echo Abrindo a sala numa janela separada, e o app de mesa nesta...
echo.
start "Transmissor - sala" cmd /k npm run hospedar
call npm run app
if errorlevel 1 goto falhou
goto encerrar

:falhou
echo.
echo Nao foi possivel iniciar.

:erro
set "CODIGO_SAIDA=1"

:encerrar
echo.
pause
exit /b %CODIGO_SAIDA%

rem So quem vai publicar precisa do tunel; quem abre so o app nao usa cloudflared.
:aviso_cloudflared
where cloudflared >nul 2>nul
if errorlevel 1 (
  echo.
  echo cloudflared nao foi encontrado. A sala sobe em modo local, sem link publico.
  echo Para habilitar o link publico: winget install --id Cloudflare.cloudflared
)
goto :eof
