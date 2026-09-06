# Binários de captura do Windows

Este diretório tem o **fonte** da captura de áudio do Windows. Os executáveis
não estão versionados — e a ausência é proposital.

## Por que não estão aqui

Binário no repositório é código que ninguém consegue conferir contra o fonte
só de olhar o diff. O projeto já teve três bibliotecas de áudio de terceiros e
saiu com zero justamente por isso. Se um `.exe` volta a entrar, entra com
alguém sabendo de onde veio.

## Como obtê-los

O `.github/workflows/binarios-windows.yml` compila os dois com MSVC num runner
Windows a cada push que toque esta pasta.

1. Abra a execução do workflow no GitHub.
2. Baixe o artefato `binarios-windows-x64`.
3. Coloque `captura.exe` e `janelas.exe` **aqui**.

Enquanto eles não estiverem, o app avisa no console e a opção de som não
aparece no Windows. **Compartilhar tela continua funcionando** — só o som por
aplicativo depende disto.

## Compilar na mão

Com o Visual Studio instalado, num *Developer Command Prompt*:

```bat
cl /nologo /EHsc /O2 /W4 /MT /std:c++17 /DUNICODE /D_UNICODE ^
   captura.cpp /link ole32.lib mmdevapi.lib
cl /nologo /EHsc /O2 /W4 /MT /std:c++17 /DUNICODE /D_UNICODE ^
   janelas.cpp /link user32.lib
```

O `/MT` liga o runtime da Microsoft estaticamente: sem ele os executáveis
exigiriam o VC++ Redistributable na máquina de quem usa, e a falha apareceria
como um diálogo de DLL ausente — não como uma mensagem nossa.

## O que cada um faz

| | |
|---|---|
| `captura.cpp` | recebe um PID e despeja no stdout PCM 16 bits, 2 canais, 48000 Hz |
| `janelas.cpp` | lista janelas visíveis como `pid<TAB>título`, em UTF-8 |

O `captura.cpp` é uma versão enxuta do exemplo `ApplicationLoopback` da
Microsoft, que é MIT — o aviso de copyright está no cabeçalho dele, como a
licença exige. Tiramos o Media Foundation (só servia para escrever `.wav`) e a
WIL/WRL (biblioteca de header da Microsoft), porque trocar um terceiro por
outro não seria progresso.
