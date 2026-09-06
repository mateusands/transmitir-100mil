# AGENTS.md — como trabalhar neste repositório

Guia para quem for mexer no código, humano ou agente. O `README.md` explica o
que o projeto faz e como usar; aqui está o que é preciso saber **antes de
editar**.

## O que este projeto é

Uma chamada de compartilhamento de tela. O servidor serve a página e repassa a
sinalização WebRTC; **mídia nenhuma passa por ele**. Sem banco, sem login, sem
build, sem framework. Node + Express + Socket.IO no servidor, JavaScript de
módulo ES no navegador.

Se uma mudança sua fizer o servidor tocar em áudio ou vídeo, ela está errada.

## Comandos

```bash
npm start            # servidor local em http://localhost:3000
npm run hospedar     # servidor + túnel do Cloudflare, encerrados juntos
npm run app          # app de mesa (Electron): seletor próprio e som por aplicativo
npm run check        # sintaxe de todos os módulos, inclusive desktop/
npm run gerar-icones # regera public/js/icones.js a partir do lucide-static
```

Node.js 22 ou mais novo. `public/` é servido como está, sem empacotador nem
transpilador. O app de mesa depende de três bibliotecas nativas, mas as três
**trazem binário pronto** — `npm install` não compila nada.

`npm run check` precisa sair com `exit=0` antes de qualquer commit. Cuidado com
`| tail` e `| grep`: eles reportam o status do último comando do cano, não o do
comando que interessa.

## O mapa

| Arquivo | Papel |
|---|---|
| `server/index.js` | estáticos, `/api/config`, relay de sinalização, estado das salas em memória |
| `public/js/rtc.js` | malha WebRTC: negociação, faixas, o que é voz e o que é som da tela |
| `public/js/app.js` | interface: palco, fila de pessoas, foco, menu de volume |
| `public/js/icones.js` | **gerado** — não edite à mão |
| `public/js/pcm-worklet.js` | PCM cru do app de mesa vira faixa de áudio (macOS/Windows) |
| `desktop/main.cjs` | app de mesa: janela, seletor de tela, servidor embutido |
| `desktop/som.cjs` | porta comum do som por aplicativo; despacha por plataforma |
| `desktop/som-linux.cjs` | Linux: fonte virtual e ligações, pelas ferramentas do PipeWire |
| `desktop/som-pcm.cjs` | macOS e Windows: blocos de PCM das bibliotecas nativas |
| `desktop/ponte.cjs` | ponte estreita entre a página e o processo principal |
| `tools/hospedar.mjs` | sobe servidor + túnel e derruba os dois no `Ctrl+C` |
| `iniciar-*.sh/.command/.bat` | lançadores: perguntam hospedar, app, ou os dois |

## Invariantes — quebrar isso quebra o produto

1. **A mídia é ponto a ponto.** O servidor repassa oferta, resposta e
   candidatos ICE. Nada de proxy de vídeo, nada de gravação.
2. **Uma chamada só.** Não há código de sala na interface: quem abre o link
   digita o nome e entra. O servidor ainda separa por nome de sala
   internamente (`SALA` em `app.js`) — é o que permitiria várias chamadas um
   dia, mas a interface não expõe isso.
3. **Voz e som da tela são coisas separadas.** Quem transmite anuncia os
   identificadores das próprias `MediaStream` (`tela_id`, `mic_id`); quem
   recebe agrupa as faixas pela stream de origem e toca cada uma no seu
   `<audio>`. É isso que permite baixar o jogo sem baixar a voz. Se você
   juntar os áudios num stream só, esse recurso morre em silêncio.
4. **Volume é ajuste de quem ouve.** `volume` do elemento local, nada é
   enviado pra rede, ninguém é avisado. Não transforme isso em moderação.
5. **Nada de CDN.** A página pode estar sendo servida por um túnel que é a
   única coisa que a rede de quem assiste alcança. Dependência nova de
   navegador entra convertida pro repositório (é o que `tools/gerar-icones.mjs`
   faz com os ícones do Lucide).
6. **Sem etapa de build no que é servido.** Os arquivos de `public/` vão como
   estão: sem empacotador, sem transpilador, sem passo de geração além do
   `gerar-icones`. Dependência nativa é permitida **desde que traga binário
   pronto** — se um pacote exige compilar na máquina de quem instala, ele está
   fora. Nada de driver de áudio, cabo virtual ou serviço no sistema.
   O áudio do Linux **não usa binário de terceiro nenhum**: falamos com o
   PipeWire pelo `pw-dump`, `pw-loopback` e `pw-link`, que vêm com ele. Se um
   dia entrar binário aqui, ele vem com a soma conferida e em versão exata,
   sem `^` — pacote pequeno com executável dentro não sobe de versão sozinho.
7. **O nosso próprio áudio nunca entra na captura.** Levar o som da máquina
   inteira é opção legítima e existe ("Levar todo o som"), mas o processo
   `"Audio Service"` do Chromium fica **sempre** de fora — senão as vozes desta
   chamada voltariam para dentro dela, com atraso. Quem conversa por outro
   programa exclui esse também, pelo menu, e a escolha é lembrada.
   O som liga junto com a tela, deduzido do que foi compartilhado — mas a
   exclusão vale igual, e um aplicativo marcado como "nunca levar" não é ligado
   nem pela dedução.
   No Windows não existe "tudo menos": o `application-loopback` só sabe incluir
   um processo. Lá é um aplicativo por vez, e o pedido de "tudo" é recusado com
   mensagem em vez de virar captura sem filtro.

## Convenções

- **Código e comentários em português.** Nomes de variáveis também.
- **Comentário explica o porquê**, não o quê. Se o comentário só narra a linha
  seguinte, apague-o. Os que existem hoje registram armadilhas reais — leia
  antes de mexer na linha que eles protegem.
- **Uma fonte de cor, raio e espaçamento**: as variáveis no `:root` de
  `public/css/style.css`. Valor literal de cor dentro de um componente é
  defeito.
- **Sem emoji na interface.** O desenho muda a cada sistema, a cor é fixa e não
  segue o estado do elemento. Use `icone('nome')` de `public/js/icones.js`; se
  faltar um ícone, acrescente à lista em `tools/gerar-icones.mjs` e regere.
- **Cinco estados** em cada controle: repouso, hover, ativo, foco e desativado.
  O desativado escurece o **fundo** junto com o texto — apagar só a letra deixa
  um botão sem contraste que continua parecendo clicável.
- **Três estados** em cada painel de dados: carregando, vazio e erro. Os três
  existem em `index.html` (`#estado-conectando`, `#estado-vazio`,
  `#estado-erro`); mantenha-os quando mexer no palco.
- **Contraste com número, não no olho.** O mínimo é 4.5:1 para texto. Meça (o
  próprio navegador calcula, no inspetor) em vez de confiar na impressão.
- **Um acento por função.** O azul é a ação principal do momento. Ele não mora
  num botão que às vezes diz "parar".
- `transition` com as propriedades nomeadas, nunca `transition: all`.

## Validar

Não há suíte no repositório, e é de propósito: cada um valida como preferir, com
a ferramenta que já usa. O que **precisa** ser verificado numa mudança:

| Você mexeu em | Confira |
|---|---|
| entrada, palco, fila, menu | os três estados do painel (conectando, vazio, erro) continuam aparecendo na hora certa |
| áudio ou faixas | voz e som da tela chegam em `<audio>` **separados**, e o volume de um não mexe no outro |
| negociação WebRTC | uma segunda pessoa recebe imagem e som — e as duas continuam se vendo depois de parar e voltar a compartilhar |
| qualquer coisa visual | os cinco estados de cada controle, e o contraste de texto acima de 4.5:1 |
| rotas do servidor | `/api/ping`, um arquivo de `public/` e uma rota inexistente (que devolve a página) |
| som por aplicativo | escolheu um app, **só ele** vai; o app segue audível para quem compartilha; parar a tela para o som junto |
| som "todo o som" | o excluído no menu não entra (meça: RMS zero), e o excluído é lembrado entre sessões |
| trocar a regra do som | mudar de app, ou mexer na exclusão, **não** derruba a faixa de quem recebe |
| começar a compartilhar | o som liga sozinho: tela inteira leva tudo, janela leva o som do dono dela |
| som por aplicativo | pausar e voltar a tocar no app escolhido — o som volta sozinho, sem reescolher |
| captura de tela no Linux | no Wayland quem pergunta é o portal; no X11 tem que aparecer o **nosso** seletor, e não compartilhar direto |
| lançadores | as três opções despacham certo, e por pipe (sem terminal) não travam |

Duas coisas que valem por qualquer automação:

- **Duas pessoas de verdade, em máquinas diferentes.** Dois navegadores na mesma
  máquina nunca pegam problema de NAT, que é a falha mais cara aqui.
- **Aparência é olho humano.** Hierarquia, espaçamento e ritmo não têm teste
  automático. Abra e olhe — e, se não olhou, diga que não olhou em vez de
  afirmar que funciona com base em checagem estática.

Se for automatizar do seu lado: a captura de tela real passa pelo seletor do
navegador, que não existe em ambiente automatizado — o caminho é substituir
`getDisplayMedia` e `getUserMedia` por uma fonte falsa (um canvas animado e um
oscilador dão conta) e exercitar o nosso código, não o diálogo do Chrome. E
lembre que a chamada é **uma sala só**: dois testes contra o mesmo servidor se
enxergam na fila um do outro.

## Antes de dizer que terminou

1. `npm run check` → `exit=0`
2. Subiu, abriu e usou como usuário, com o console aberto.
3. Mexeu em áudio, faixas ou negociação? Duas pessoas de verdade.
4. Commit e push só quando pedirem.

## Armadilhas já pagas

- **`[hidden]` não esconde `display: grid`.** A regra do navegador perde para a
  da classe. Existe um `[hidden] { display: none !important }` no CSS por isso.
- **Abrir um menu no clique e fechá-lo no "clicou fora"** é o mesmo evento: sem
  `stopPropagation`, o menu abre e some no mesmo gesto.
- **Reconstruir um menu de dentro do clique de um item dele** desfaz o alvo
  antes do evento subir, e o fechamento por clique-fora não reconhece mais de
  onde veio. Troque o rótulo, não o menu.
- **Cache heurístico do navegador** servia CSS velho depois de editar, porque a
  resposta não tinha `Cache-Control`. Os estáticos vão com `no-cache` (guarda,
  mas revalida).
- **`getDisplayMedia` só existe em contexto seguro.** Pelo túnel funciona; por
  `http://<ip-da-lan>:3000`, não.

### App de mesa e áudio

- **`desktopCapturer.getSources()` faz coisas opostas conforme a sessão.** No
  Wayland a chamada **abre** o portal e o que volta já é a escolha da pessoa —
  uma fonte só. No X11 ela **enumera em silêncio**, sem diálogo nenhum. Pegar
  `sources[0]` sem distinguir os dois faz o app compartilhar a primeira tela da
  lista sem perguntar nada. E não confie só em `XDG_SESSION_TYPE`: Flatpak e
  Snap apagam essa variável — confira o socket do Wayland no disco.
- **Quem toca o áudio no Electron não é `process.pid`.** É um processo separado,
  o `"Audio Service"`, achável em `app.getAppMetrics()`. Excluir o processo
  principal da captura não exclui absolutamente nada.
- **Leia o rótulo que o sistema registrou; não suponha o que você pediu.** A
  página acha o dispositivo por rótulo. Já aconteceu de a fonte subir com o nome
  certo e a descrição truncada: o módulo dizia sucesso e o erro só aparecia do
  outro lado, na página, como "não encontrei a fonte".
- **PCM de 16 bits não perdoa byte ímpar.** Se um bloco terminar no meio de uma
  amostra e você descartar o byte solto, **todas** as amostras seguintes andam
  meio sample. Não soa como defeito, soa como ruído. Guarde o resto para o
  bloco seguinte.
- **Faixa `live` não prova som.** Uma faixa de áudio existe e fica viva mesmo
  carregando silêncio absoluto. Para dizer que o som chegou, meça — um
  `AnalyserNode` do lado de quem recebe resolve, e é a diferença entre "a faixa
  chegou" e "dá pra ouvir".
- **Fluxo que some e volta precisa ser religado, e isso é nosso trabalho.** Um
  aplicativo pausado mantém o nó (fica `Corked`) e continua na lista; um que
  fecha o fluxo some do grafo e leva as ligações junto. O vigia de
  `som-linux.cjs` reconcilia a cada segundo — é ele que faz "todo o som"
  continuar valendo para o jogo que você abre no meio da conversa. Se o som
  parar de voltar sozinho, é aí que se olha.
- **`node.autoconnect=false` na captura não é enfeite.** Sem ele o WirePlumber
  liga o **microfone** na nossa entrada por conta própria, e a voz de quem
  compartilha vai junto com o som do jogo. Medido.

#### Capturamos o fluxo, não a saída

Ligamos as portas do **aplicativo**, não o monitor de um alto-falante. Então o
som vai mesmo quando o programa toca num dispositivo que não é o padrão — jogo
num fone USB enquanto o padrão é outro, por exemplo. Medido: um tom tocando num
sink nulo (que não é a saída padrão) foi capturado sem perda nenhuma.

E sem perda é literal: tom de referência a −30,1 dB, capturado a −30,1 dB.

### Ao trabalhar neste repositório

- **`pkill -f <padrão>` casa com o próprio shell que o executou**, porque o
  padrão aparece na linha de comando dele. Mata a sua sessão e a mensagem de
  erro não diz isso. Use `pkill -x <nome>`, ou filtre por PID.
- **Teste de áudio toca no fone de quem está na máquina.** Se for gerar tom para
  medir, mande para um sink nulo — ou avise antes, e mate o processo ao fim de
  cada medição em vez de deixá-lo tocando entre um comando e outro.
- **Lançador que pergunta precisa aguentar não ter ninguém.** Ele se re-executa
  dentro de um emulador de terminal e pode ser chamado por pipe; sem um
  `[[ -t 0 ]]` na frente do `read`, ele pendura para sempre.
