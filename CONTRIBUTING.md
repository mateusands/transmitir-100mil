# Contribuir

Obrigado por olhar o código. Este é um projeto pequeno e quer continuar assim:
uma chamada que sobe num comando, sem banco, sem build, sem framework.

## Começar

```bash
git clone https://github.com/mateusands/transmitir-100mil
cd transmitir-100mil
npm install
npm start
```

Abra `http://localhost:3000` em duas abas para ver uma chamada de duas pessoas.
Para exercitar o caminho real — com https e outra máquina — use
`npm run hospedar`, que publica um túnel do Cloudflare.

Requisitos: Node.js 22 ou mais novo. Nada além disso — não há etapa de build.

## Antes de abrir um PR

```bash
npm run check     # precisa sair com exit=0
```

Depois, **suba e use**. O repositório não traz suíte: cada um valida com a
ferramenta que preferir, e o que precisa ser verificado em cada tipo de mudança
está na seção *Validar* do [AGENTS.md](AGENTS.md). Diga no PR como você validou.

Duas coisas que nenhuma automação substitui: aparência é olho humano — anexe
capturas quando ajudarem a explicar —, e mudança em áudio, faixas ou negociação
WebRTC precisa de duas pessoas de verdade, em máquinas diferentes. Duas abas na
mesma máquina não pegam problema de NAT.

## O que o PR precisa ter

- **Um assunto por PR.** Refatoração misturada com correção dobra o tempo de
  revisão e esconde o que interessa.
- **Como você validou**, em uma linha. O que foi conferido, em qual navegador,
  com quantas pessoas.
- **Mensagem de commit que explica o porquê.** O quê já está no diff. Escreva
  em português, imperativo, primeira linha curta.
- **Nada de commit em `main` direto.** Trabalhe num branch e abra o PR.

## Estilo

O guia completo está em [AGENTS.md](AGENTS.md). O resumo:

- Código, nomes e comentários em português.
- Comentário explica **por que**, não o quê.
- Cor, raio e espaçamento vêm das variáveis no `:root` do CSS — nunca um valor
  literal dentro de um componente.
- Sem emoji na interface: use os ícones do Lucide via `icone('nome')`.
- Cinco estados em cada controle, três em cada painel de dados.
- Contraste mínimo de 4.5:1 para texto — meça, não confie na impressão.

## O que provavelmente será recusado

Não por ser ruim, mas por ser outro projeto:

- Framework de interface, empacotador ou etapa de build.
- Dependência carregada de CDN. A página precisa funcionar quando o túnel é a
  única coisa que a rede de quem assiste alcança.
- Qualquer coisa que faça a mídia passar pelo servidor (gravação, proxy de
  vídeo, transcodificação). Um SFU resolveria o limite de 6–8 pessoas, mas é
  outro produto — abra uma issue antes de escrever código.
- Controle de volume que afete os outros participantes. Baixar o som de alguém
  é ajuste de quem ouve, não moderação.

Em dúvida se a ideia cabe? Abra uma issue antes. É mais barato conversar do que
jogar fora código pronto.

## Licença

Ao contribuir, você concorda em licenciar sua contribuição sob a
[licença MIT](LICENSE) do projeto.
