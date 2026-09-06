<!--
Título: tipo(escopo): descrição objetiva — ex.: fix(audio): separa voz do som da tela
Resultado, não intenção: "abri e usei" não vale; diga o que viu.
Apague as seções que não se aplicam. Um PR curto pode caber em três linhas.
-->

## Contexto

<!-- O problema em uma frase: quem sofre, o que vê hoje, o que deveria ver.
     Se for defeito, como reproduzir. Se for melhoria, o que motivou agora. -->

## O que muda

<!-- A solução, e por que esta forma e não outra. Cite `arquivo:linha` no que for central. -->

## O que NÃO muda

<!-- Fronteira explícita. Sem isto, um PR de correção é lido como refactor. -->

## Como foi validado

| O que | Resultado |
|---|---|
| `npm run check` | |
| Subiu, abriu e usou (`npm start`, console aberto) | |
| Chamada com duas pessoas — em máquinas diferentes, se possível | |
| Aparência: olhou a tela nos tamanhos que a mudança afeta | |

<!-- Cole o resultado, não o comando. "check exit=0", "chamada de 3 no Chrome:
     imagem e som chegaram, volume separado funcionou". -->

**Não coberto:** <!-- o que ficou de fora e por quê. Um PR que lista só o que
passou é lido como cobertura total; o limite escrito vale mais que o escondido. -->

## Mudança de comportamento

<!-- Sim/Não. Se sim: o que quem transmite ou quem assiste passa a ver de diferente. -->

## Risco e rollback

<!-- O pior caminho é o que PARECE sucesso: a chamada de pé com ninguém se ouvindo,
     o volume que só desce pra você mas some pros outros, a tela que congela sem erro
     no console. Aponte o commit de partida para o `git revert`. -->

---

<!-- Antes de colar o resultado, três armadilhas deste repositório:

     · `npm run check` lê a sintaxe, não o produto rodando. Ele passa com a
       página quebrada.
     · Duas abas na mesma máquina nunca pegam problema de NAT — que é a falha
       mais cara aqui. Se mexeu em faixas ou negociação, teste em duas máquinas
       ou diga que não testou.
     · Aparência não tem verificação automática. Contraste, hierarquia e
       espaçamento continuam olho humano; anexe capturas quando ajudarem.

     A lista completa está em AGENTS.md, na seção Validar. -->
