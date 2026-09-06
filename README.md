# Transmissor

Chamada para compartilhar tela — com ou sem som — direto do navegador. O
servidor só apresenta a página e repassa a sinalização; o vídeo vai ponto a
ponto entre os participantes. Nada é gravado, nada fica em disco.

Uma chamada só, sem código de sala: quem abre o link digita o nome e entra.

## Requisitos

- **Node.js 20 ou superior** (só para quem hospeda)
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

O ponto ao lado do nome fica verde quando o microfone da pessoa está ligado, e
vermelho quando a conexão com ela caiu.

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

## Estrutura

```
server/index.js     servidor: arquivos estáticos + relay de sinalização
public/js/rtc.js    malha WebRTC (perfect negotiation), separa voz e som da tela
public/js/app.js    interface: palco, foco, menu de volume
tools/hospedar.mjs  servidor + túnel, encerrados juntos
```

O servidor nunca vê mídia. Ele repassa oferta, resposta e candidatos ICE, e
guarda em memória quem está na chamada — nada mais. Para saber qual áudio é voz
e qual é som da tela, quem transmite anuncia os identificadores das próprias
streams; quem recebe usa isso para separar os dois controles de volume.
