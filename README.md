# transmitir-100mil

Chamada para compartilhar tela — com ou sem som — direto do navegador. O
servidor só apresenta a página e repassa a sinalização; o vídeo vai ponto a
ponto entre os participantes. Nada é gravado, nada fica em disco.

Uma chamada só, sem código de sala: quem abre o link digita o nome e entra.

Há também um **app de mesa** para quem compartilha, com uma coisa que navegador
nenhum faz: levar o som de **um aplicativo escolhido**, sem levar a conversa do
Discord nem as vozes da própria chamada. Veja
[App de mesa](#app-de-mesa-levar-o-som-de-um-aplicativo).

## Requisitos

**Antes de abrir qualquer lançador, instale Node.js 22 ou superior e npm.**
Eles são obrigatórios para hospedar a sala. **Para gerar um link público e
convidar outras pessoas pela internet, instale também o `cloudflared`.**
As instruções por sistema estão na seção **Instalar**, logo abaixo.

Os lançadores **não instalam Node.js, npm ou `cloudflared` automaticamente**;
instalam apenas as dependências do projeto na primeira execução. Sem Node.js
ou npm, a sala não inicia. Sem `cloudflared`, ela inicia em modo local,
sem link público.

- **Node.js 22 ou superior** (só para quem hospeda)
- **npm** (gerenciador de dependências, normalmente instalado junto com o Node.js)
- **cloudflared** (só para quem hospeda, e só se for expor pra fora da máquina)
- Um navegador baseado em Chromium — Chrome, Edge, Brave, Vivaldi — para quem
  vai compartilhar tela **com som**. Firefox entra na chamada normalmente, mas
  não manda o áudio da tela.

Quem só vai assistir não precisa instalar nada: abre o link e pronto.

O **app de mesa** — o que leva o som de um aplicativo — pede um pouco mais de
cada sistema, porque conversa com o servidor de áudio da máquina. A lista está
em [O que cada sistema usa](#o-que-cada-sistema-usa).

## Instalar

### Linux

```bash
sudo pacman -S nodejs npm cloudflared libpulse    # Arch, CachyOS, Manjaro
```

```bash
sudo apt install nodejs npm libpulse0 pulseaudio-utils   # Debian, Ubuntu
```

O `libpulse` (e o `pulseaudio-utils`, no Debian) é só para o app de mesa levar
o som de um aplicativo. Para hospedar no navegador, Node e npm bastam.

No Debian/Ubuntu o `cloudflared` não está nos repositórios: pegue o `.deb` em
[github.com/cloudflare/cloudflared/releases](https://github.com/cloudflare/cloudflared/releases)
e instale com `sudo dpkg -i cloudflared-linux-amd64.deb`.

### macOS

```bash
brew install node cloudflared
```

### Windows

```powershell
winget install OpenJS.NodeJS.LTS
```

```powershell
winget install --id Cloudflare.cloudflared
```

Para o app de mesa, o Windows também precisa do redistribuível da Microsoft —
os binários de captura de áudio dependem dele. A maioria das máquinas já tem,
por causa de jogos e outros programas:

```powershell
winget install Microsoft.VCRedist.2015+.x64
```

Feche e reabra o terminal depois de instalar, para o `PATH` pegar os comandos.

## Hospedar

Uma pessoa hospeda; as outras só abrem o link.

```bash
npm install
```

```bash
npm run hospedar
```

Ele sobe o servidor, abre o túnel e imprime um endereço
`https://algo.trycloudflare.com`. Mande esse link. Quem abre digita o nome e já
está na chamada.

**Para encerrar:** `Ctrl+C` na mesma janela. Isso derruba o servidor e o túnel
juntos, e o endereço morre ali — a próxima execução gera outro.

### Abrir sem digitar comandos

**Primeiro, conclua a instalação dos requisitos acima.** Abrir um lançador
não substitui a instalação de Node.js, npm e, para acesso público, `cloudflared`.

Os lançadores validam Node 22+ e npm e instalam as dependências na primeira
execução.

Ao abrir, o lançador pergunta o que fazer:

```
  1) Hospedar a sala      link público, para convidar gente
  2) Abrir o app de mesa  som por aplicativo, só nesta máquina
  3) Os dois              link público e o app aberto aqui
```

A opção **3** é a do caso comum: você quer convidar gente pelo link **e** levar
o som de um aplicativo. Funciona porque o app não sobe servidor próprio quando
a porta já está ocupada — ele entra na sala que o túnel está publicando.

Sem `cloudflared`, as opções **1** e **3** avisam e seguem em modo local, sem
link público — e aí compartilhar tela exige usar `localhost`, porque o IP da
LAN não fornece o HTTPS que a captura pede. A opção **2** não usa `cloudflared`
para nada e nem menciona o assunto.

No Linux e no macOS, fechar a janela do app encerra o túnel junto. No Windows a
sala abre numa janela separada, porque o `.bat` não tem controle de tarefas.

Sem ninguém para responder — chamado por pipe, ou por um gerenciador de
arquivos sem terminal — ele não trava: segue em **1**.

- **Windows:** dê duplo clique em `iniciar-windows.bat`.
- **macOS:** dê duplo clique em `iniciar-macos.command`, na pasta do projeto.
  O Terminal.app abre e inicia a sala. O script usa recursos do Bash 3.2 do
  sistema, sem depender de `readlink -f`.
- **Linux (Ubuntu/Debian e Arch/CachyOS):** nas propriedades de
  `iniciar-linux.sh`, habilite a permissão de execução se necessário e use
  **Executar** ou **Executar no terminal**, caso o gerenciador ofereça essa ação.
  O duplo clique não é universal: no GNOME Files, por exemplo, o script pode
  abrir no editor. Nesse caso, abra um terminal na pasta do projeto e execute
  `bash iniciar-linux.sh`.

Ao executar o script Linux sem terminal, ele procura `x-terminal-emulator`
primeiro (preferência configurada no Debian/Ubuntu), depois o executável
indicado por `TERMINAL` e então Konsole, GNOME Terminal, Xfce Terminal,
Alacritty, Kitty, Foot ou XTerm. `TERMINAL` deve conter apenas o nome ou caminho
do executável, sem argumentos. Não há arquivo `.desktop` neste projeto.
Mantenha os lançadores na pasta do projeto; se extrair um ZIP no macOS e perder
a permissão de execução, habilite-a com `chmod +x iniciar-macos.command`.

Se a janela se perdeu:

```bash
pkill -f tools/hospedar.mjs                  # Linux e macOS
```

```powershell
taskkill /IM cloudflared.exe /F              # Windows
```

### Sem instalar nada na máquina

Se você não quer (ou não pode) instalar Node e cloudflared no computador:

```bash
tools/pasta.sh
```

Ele confere o que já existe e baixa **para dentro da pasta do projeto** só o que
faltar — Node em `.node/`, cloudflared em `.bin/`. Nada vai para o sistema: sem
gerenciador de pacotes, sem PATH global, sem serviço, sem nada em `~/`. Apagar a
pasta do projeto apaga tudo junto.

```bash
tools/pasta.sh verificar   # mostra o que seria usado, sem subir a sala
tools/pasta.sh limpar      # apaga .node/, .bin/ e node_modules/
```

No Windows:

```powershell
powershell -ExecutionPolicy Bypass -File tools\pasta.ps1
```

O download acontece **uma vez**: nas execuções seguintes ele reaproveita o que
está na pasta. Se a máquina já tem Node 22+ ou cloudflared, ele usa os seus e
não baixa nada. Custo em disco quando baixa os dois: cerca de 136 MB do Node
(já sem os cabeçalhos C, que só servem para compilar módulo nativo) e 38 MB do
cloudflared.

Enquanto roda é um processo em primeiro plano; `Ctrl+C` derruba servidor e túnel
juntos e não deixa nada ligado. Nenhuma parte disso roda ao ligar o computador.

Só na sua máquina, sem túnel nem link público:

```bash
npm start
```

Aí o endereço é `http://localhost:3000`. Serve para testar, mas só funciona
para quem está no mesmo computador.

## App de mesa: levar o som de um aplicativo

O navegador não sabe levar o som de um programa específico. Ou vai o áudio de
uma aba, ou — só no Windows — vai o sistema inteiro, e aí vai tudo junto:
o Discord, a música, e as vozes desta própria chamada voltando com atraso.

Levar **só o som do jogo** exige falar com o sistema de áudio da máquina, e é
isso que o app de mesa faz:

```bash
npm run app
```

Ele abre a mesma sala numa janela própria. Depois de compartilhar a tela, o
**botão direito na sua própria tela** lista os aplicativos que estão tocando
agora: escolha um, e só o som dele vai junto.

Nada liga sozinho, e a ausência é o recurso — o que não foi escolhido não entra.
É o que permite usar o Discord para conversar e o Transmissor para mostrar a
tela, sem que um coma o outro.

Para apontar o app para uma sala já publicada por outra pessoa:

```bash
TRANSMISSOR_URL=https://algo.trycloudflare.com npm run app
```

### O que cada sistema usa

| | como captura | além do Node |
|---|---|---|
| Linux | PipeWire, via venmic | PipeWire e `libpulse` — veja abaixo |
| macOS | Core Audio process taps, via `audiotee` | macOS 14.2 ou mais novo |
| Windows | WASAPI process loopback, via `application-loopback` | Windows 10 2004 (build 19041), **só x64**, e o VC++ Redistributable |

No **Linux**, o addon é ligado dinamicamente contra bibliotecas do sistema
(`libpipewire`, `libpulse`, `libdbus`, `libsndfile` e a cadeia de codecs do
libpulse). Além disso o app chama `pactl` para ler o rótulo da fonte que criou.
Na prática é um pacote só, porque o `pactl` e a `libpulse.so` vêm juntos:

| | pacote |
|---|---|
| Arch, CachyOS, Manjaro | `libpulse` |
| Debian, Ubuntu | `libpulse0` **e** `pulseaudio-utils` (lá o `pactl` vem separado) |

Quem já tem PipeWire com som funcionando quase certamente tem tudo isso — o
`pipewire-pulse` depende do `libpulse`. Numa instalação enxuta do Debian, o
`pactl` é o que costuma faltar.

No **Windows** não há biblioteca de áudio a instalar: os dois executáveis vêm
no pacote e usam a API do próprio sistema. O que eles exigem é o
**Visual C++ Redistributable 2015–2022 (x64)** — `MSVCP140.dll` e
`VCRUNTIME140.dll`. Quase toda máquina já tem; se faltar, é
`winget install Microsoft.VCRedist.2015+.x64`.

São as APIs que os próprios sistemas criaram para isto. Os binários vêm
prontos: `npm install` não compila nada, e nada é instalado fora da pasta do
projeto — sem driver de áudio virtual, sem serviço, sem cabo virtual.

O addon do Linux é **versionado** em `desktop/nativo/`, em vez de vir do npm.
O pacote arrastava 71 dependências que nunca executam, e o binário publicado
tem 25 MB de `debug_info` que não servem para nada em produção. Enxuto, são
1,8 MB por arquitetura. Para atualizá-lo:

```bash
npm run atualizar-venmic
```

**Ressalvas honestas:**

- O caminho de **macOS e Windows ainda não foi exercitado em máquina real**. Foi
  escrito contra a API e o formato de PCM lidos no fonte das bibliotecas, e
  validado de ponta a ponta com áudio sintético. No Linux está testado com duas
  pessoas. Se falhar num Mac ou num Windows, comece a olhar por aí.
- No **macOS** a lista mostra aplicativos abertos, não aplicativos tocando: não
  há como saber quem tem som sem código nativo. Escolher um que está mudo
  devolve erro, não silêncio.
- No **Windows** só há binário x64. Windows em ARM não roda.

## Na chamada

A tela mostra duas listas, de propósito: quem está compartilhando ganha uma
tela grande no palco; **todo mundo** aparece como pastilha na fila de baixo,
compartilhando ou não. É na pastilha que fica o áudio de quem só está falando —
e é por ela que se chega no volume de cada um.

- **Compartilhar tela** — abre o diálogo do navegador para escolher a tela, a
  janela ou a aba. É nele que se decide o **com som ou sem** (detalhes por
  sistema logo abaixo).
- **Ligar microfone** — independente da tela. Dá para falar sem compartilhar
  nada, ou compartilhar mudo.
- **Clique numa pessoa** — a tela dela vira a grande e o resto encolhe numa
  fita embaixo. Clicar de novo (ou `Esc`) volta ao mosaico.
- **Duplo clique** — tela cheia de verdade. `Esc` sai.
- **Botão direito na sua própria tela** (só no app de mesa) — escolhe de qual
  aplicativo levar o som, ou para de levar.
- **Botão direito numa pessoa** — abre o controle de volume dela:
  - **Voz** — o microfone da pessoa.
  - **Som da tela** — o áudio do que ela está transmitindo (jogo, vídeo, música).
  - **Silenciar pra mim** — corta os dois.

  Os três valem **só para você**: ninguém mais é afetado e a pessoa não é
  avisada. É o mesmo modelo do Discord — baixar o volume de alguém é ajuste do
  ouvinte, não moderação. Ter voz e som da tela separados resolve o caso comum
  de o jogo estar alto demais e a voz de quem explica estar baixa.

- **Sair** — fecha suas conexões. Fechar a aba faz o mesmo.

O ícone de microfone na pastilha fica verde quando a pessoa está com o mic
ligado; a borda fica vermelha quando a conexão com ela caiu, e azul enquanto
ela transmite.

## Áudio da tela pelo navegador

Esta seção é sobre quem entra pelo **link, no navegador**. Quem usa o app de
mesa não passa por nada disto — lá o som é escolhido por aplicativo.

O que o navegador deixa capturar depende dele e do sistema; é limitação deles,
não do projeto:

| | Áudio da aba | Áudio da tela inteira |
|---|---|---|
| Chrome/Edge no Windows | sim | sim |
| Chrome/Edge no Linux | sim | não |
| Chrome/Edge no macOS | sim | não |
| Firefox | não | não |

Ou seja: para levar o som junto fora do Windows, compartilhe **uma aba do
navegador** e marque *Compartilhar áudio da aba* no diálogo. No Windows, ao
escolher a tela inteira, aparece *Compartilhar áudio do sistema* — e ele leva
mesmo **tudo**, inclusive o Discord e as vozes desta chamada. Se isso incomodar,
é exatamente o caso de usar o app de mesa.

No **macOS**, na primeira vez o sistema pede autorização: Ajustes do Sistema →
Privacidade e Segurança → Gravação de Tela → marque o navegador e reabra ele.

No **Linux com Wayland**, quem escolhe a janela é o portal do sistema
(`xdg-desktop-portal`), não o navegador — a lista aparece numa janela do
próprio ambiente. Se ela não abrir, falta o pacote
`xdg-desktop-portal-gnome`, `-kde` ou `-wlr`, conforme a sua área de trabalho.

## Limites que valem saber

- **Malha P2P.** Cada um manda uma cópia do vídeo para cada outro participante.
  Vai bem até 6–8 pessoas; acima disso o upload de quem transmite satura. O
  limite da chamada é 8 (`LIMITE_SALA` muda isso).
- **https é obrigatório.** `getDisplayMedia` só existe em contexto seguro. Pelo
  túnel funciona; por `http://<ip-da-lan>:3000` não.
- **CGNAT quebra o P2P.** Se as duas pontas estiverem atrás de NAT simétrico
  (4G, alguns provedores), o STUN não fecha a conexão e é preciso um TURN:

  ```bash
  TURN_URL=turn:host:3478 TURN_USER=usuario TURN_PASS=senha npm run hospedar
  ```

- **Toque longo no celular** abre o menu de volume em Android; no iOS não há
  equivalente ao botão direito.

## Desenvolver

```bash
npm start         # servidor local em http://localhost:3000
```

```bash
npm run app       # app de mesa, com o som por aplicativo
```

```bash
npm run check     # sintaxe de todos os módulos, inclusive desktop/
```

Não há empacotador nem transpilador: os arquivos de `public/` são servidos como
estão. Editou, recarregou, viu. As bibliotecas nativas do app de mesa trazem
binário pronto, então `npm install` também não compila nada.

Para uma chamada de duas pessoas na mesma máquina, abra o endereço em duas abas
(ou numa janela anônima). Vale lembrar que compartilhar tela exige contexto
seguro — `localhost` conta, o IP da LAN não.

Como validar uma mudança fica a critério de quem mexe; o que precisa ser
verificado está em [AGENTS.md](AGENTS.md).

### Ícones

São do [Lucide](https://lucide.dev) (ISC), convertidos para dentro do projeto:

```bash
npm run gerar-icones   # só quando mudar a lista em tools/gerar-icones.mjs
```

O addon de áudio do Linux segue a mesma ideia — entra convertido para o
repositório em vez de ser baixado a cada instalação:

```bash
npm run atualizar-venmic   # só quando subir a versão em tools/atualizar-venmic.mjs
```

O pacote é dependência de desenvolvimento e não vai pro navegador — a página
não busca nada de CDN nenhum, porque o túnel pode ser a única coisa que a rede
de quem assiste alcança. Emoji não entra na interface: o desenho muda a cada
sistema, a cor é fixa e não segue o estado do elemento.

## Estrutura

```
server/index.js         servidor: arquivos estáticos + relay de sinalização
public/js/rtc.js        malha WebRTC (perfect negotiation), separa voz e som da tela
public/js/app.js        interface: palco, fila de pessoas, foco, menu de volume
public/js/pcm-worklet.js  PCM cru do app de mesa vira faixa de áudio (macOS/Windows)
public/js/icones.js     gerado — ícones do Lucide embutidos
desktop/main.cjs        app de mesa: janela, seletor de tela, servidor embutido
desktop/som.cjs         porta comum do som por aplicativo, nas três plataformas
desktop/som-linux.cjs     Linux: fonte virtual no PipeWire, via venmic
desktop/som-pcm.cjs       macOS e Windows: blocos de PCM das bibliotecas nativas
desktop/nativo/*.node   versionado — addon do venmic, enxuto (1,8 MB por arquitetura)
desktop/seletor.html    seletor de tela próprio (onde o sistema não tem um)
desktop/ponte.cjs       ponte estreita entre a página e o processo principal
tools/hospedar.mjs      servidor + túnel, encerrados juntos
tools/pasta.sh          modo pasta: Node e cloudflared dentro do projeto (Linux/macOS)
tools/pasta.ps1         o mesmo no Windows
tools/gerar-icones.mjs  regera public/js/icones.js
```

O servidor nunca vê mídia. Ele repassa oferta, resposta e candidatos ICE, e
guarda em memória quem está na chamada — nada mais. Para saber qual áudio é voz
e qual é som da tela, quem transmite anuncia os identificadores das próprias
streams; quem recebe usa isso para separar os dois controles de volume.

## Contribuir

O guia de estilo e as armadilhas já pagas estão em [AGENTS.md](AGENTS.md); como
mandar uma mudança, em [CONTRIBUTING.md](CONTRIBUTING.md).

## 🤖 Uso de IA

Transparência importa aqui, então: este projeto foi construído **com auxílio de
inteligência artificial** usada como assistente ao longo do desenvolvimento e da manutenção.

Na prática, a IA entra no trabalho repetitivo e de baixo nível: escrever o
código de um caminho já decidido, converter ícones, redigir e atualizar
documentação, montar scripts de validação, procurar o ponto exato de um defeito.
As decisões de escopo, arquitetura e desenho são humanas, e **toda mudança passa
por revisão de gente antes de entrar** — inclusive as que a IA escreveu por
inteiro.

As regras que o assistente segue neste repositório estão versionadas em
[AGENTS.md](AGENTS.md) e [CLAUDE.md](CLAUDE.md): são as mesmas que valem para
qualquer pessoa que mexa no código.

> **AI Usage Disclosure** — Transparency and integrity are important to this
> project. Artificial Intelligence (AI) tools were used as part of the
> development and maintenance workflow, serving as an assistant for repetitive,
> time-consuming and low-level tasks. Scope, architecture and design decisions
> are human, and every change is reviewed by a person before it lands.

## Licença

[MIT](LICENSE).
