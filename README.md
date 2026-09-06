# Transmissor

Chamada para compartilhar tela — com ou sem som — direto do navegador. O
servidor só apresenta a página e repassa a sinalização; o vídeo vai ponto a
ponto entre os participantes. Nada é gravado, nada fica em disco.

Uma chamada só, sem código de sala: quem abre o link digita o nome e entra.

## Requisitos

- **Node.js 22 ou superior** (só para quem hospeda)
- **cloudflared** (só para quem hospeda, e só se for expor pra fora da máquina)
- Um navegador baseado em Chromium — Chrome, Edge, Brave, Vivaldi — para quem
  vai compartilhar tela **com som**. Firefox entra na chamada normalmente, mas
  não manda o áudio da tela.

Quem só vai assistir não precisa instalar nada: abre o link e pronto.

## Instalar

### Linux

```bash
sudo pacman -S nodejs npm cloudflared        # Arch, CachyOS, Manjaro
```

```bash
sudo apt install nodejs npm                  # Debian, Ubuntu
```

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

Se a janela se perdeu:

```bash
pkill -f tools/hospedar.mjs                  # Linux e macOS
```

```powershell
taskkill /IM cloudflared.exe /F              # Windows
```

Só na sua máquina, sem túnel nem link público:

```bash
npm start
```

Aí o endereço é `http://localhost:3000`. Serve para testar, mas só funciona
para quem está no mesmo computador.

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

## Áudio da tela, por sistema

O que dá para capturar depende do navegador e do sistema — é limitação deles,
não do projeto:

| | Áudio da aba | Áudio da tela inteira |
|---|---|---|
| Chrome/Edge no Windows | sim | sim |
| Chrome/Edge no Linux | sim | não |
| Chrome/Edge no macOS | sim | não |
| Firefox | não | não |

Ou seja: para levar o som junto fora do Windows, compartilhe **uma aba do
navegador** e marque *Compartilhar áudio da aba* no diálogo. No Windows, ao
escolher a tela inteira, aparece *Compartilhar áudio do sistema*.

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
npm run check     # sintaxe de todos os módulos
```

Não há etapa de build: os arquivos de `public/` são servidos como estão. Editou,
recarregou, viu.

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

O pacote é dependência de desenvolvimento e não vai pro navegador — a página
não busca nada de CDN nenhum, porque o túnel pode ser a única coisa que a rede
de quem assiste alcança. Emoji não entra na interface: o desenho muda a cada
sistema, a cor é fixa e não segue o estado do elemento.

## Estrutura

```
server/index.js       servidor: arquivos estáticos + relay de sinalização
public/js/rtc.js      malha WebRTC (perfect negotiation), separa voz e som da tela
public/js/app.js      interface: palco, fila de pessoas, foco, menu de volume
public/js/icones.js   gerado — ícones do Lucide embutidos
tools/hospedar.mjs    servidor + túnel, encerrados juntos
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
