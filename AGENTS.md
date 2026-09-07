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
npm run check        # sintaxe de todos os módulos
npm run gerar-icones # regera public/js/icones.js a partir do lucide-static
```

Node.js 22 ou mais novo. Sem etapa de build: `public/` é servido como está.

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
| `tools/hospedar.mjs` | sobe servidor + túnel e derruba os dois no `Ctrl+C` |

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
6. **Sem etapa de build.** Os arquivos de `public/` são servidos como estão.

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
- **O áudio do `getDisplayMedia` só é "recortado" pro que está na tela quando
  a pessoa compartilha uma aba do Chrome.** Em janela ou tela inteira, o
  áudio que o Chromium oferece é o do sistema inteiro — não existe opção de
  API pra "só o som deste app" fora de aba. `alternarTela` em `rtc.js`
  descarta esse áudio quando `displaySurface !== 'browser'`, pra ninguém
  ouvir o que não devia; isolar áudio por app de verdade (janela ou tela
  inteira) exige suporte do sistema operacional, fora do que este projeto
  (sem build, sem app nativo) se propõe a fazer.
