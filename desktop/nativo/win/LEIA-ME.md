# Binários de captura do Windows

Este diretório tem o **fonte** da captura de áudio do Windows e os executáveis
compilados a partir dele. Ambos são nossos: não há biblioteca de terceiro no
caminho do áudio.

## Regenerar

De qualquer Linux ou macOS, sem instalar nada no sistema:

```bash
npm run compilar-windows
```

Ele baixa a toolchain **llvm-mingw** para dentro de `.bin/` (como o `pasta.sh`
faz com o Node), confere a soma sha256 antes de extrair, e compila os dois.
Apagar `.bin/` apaga tudo.

A CI faz o mesmo com o **MSVC**, que é o compilador da própria Microsoft — se
os dois concordam, é sinal melhor do que só um. O artefato
`binarios-windows-x64` fica anexado a cada execução do workflow.

Com o Visual Studio à mão, num *Developer Command Prompt*:

```bat
cl /nologo /EHsc /O2 /W4 /MT /std:c++17 /DUNICODE /D_UNICODE ^
   captura.cpp /link ole32.lib mmdevapi.lib
cl /nologo /EHsc /O2 /W4 /MT /std:c++17 /DUNICODE /D_UNICODE ^
   janelas.cpp /link user32.lib
```

## Do que eles dependem

Nada que precise instalar. Conferido nos binários:

```
api-ms-win-crt-*.dll                    Universal CRT, vem com o Windows 10+
KERNEL32, USER32, ole32, mmdevapi       DLLs do próprio sistema
```

Sem `MSVCP140.dll` nem `VCRUNTIME140.dll` — ou seja, **sem VC++
Redistributable**, que as bibliotecas de terceiro que usávamos antes exigiam.

## O que ainda não foi feito

**Ninguém rodou isto num Windows.** Compila com dois compiladores diferentes, e
só. A API de captura por processo exige **Windows 10 build 20348**; em sistema
anterior a ativação falha, o `captura.exe` sai com código diferente de zero e o
app avisa em vez de transmitir mudo.

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
