# CLAUDE.md

**Leia o [AGENTS.md](AGENTS.md) primeiro.** Ele tem o mapa do código, os
invariantes, as convenções e as armadilhas já pagas. O que está aqui é só o que
muda quando quem está no teclado é o Claude Code.

## O ciclo

```bash
npm run check     # exit=0
npm start         # e então ABRA http://localhost:3000
```

Checagem estática não é prova de que funciona: ela lê o código, não o produto
rodando. Depois do `exit=0`, abra a página e use como usuário, com o console
aberto. Se você não abriu, diga que não abriu.

O repositório não traz suíte nem ferramenta de validação — isso é escolha de
cada máquina. Se você tiver um navegador dirigível na sessão, "abra e olhe" é
literal: navegue, tire print, passe o mouse, ande com Tab pela ordem de foco,
redimensione. É o que alcança o que nenhuma checagem estática alcança — os
cinco estados de um controle, o buraco que uma condição deixa na tela, o
contraste calculado em vez de chutado.

O que precisa ser verificado em cada tipo de mudança está na seção **Validar**
do `AGENTS.md`.

## Skills

Este projeto foi escrito seguindo três skills do
[crew-kit](https://github.com/mateusands/claude-code-crew-kit): `frontend`,
`design-review` e `local-testing`. **Elas não são versionadas aqui** — `.claude/`
está no `.gitignore`, porque é configuração de máquina, não do projeto.

Se quiser trabalhar com elas, instale o kit e copie as três para
`.claude/skills/`, substituindo os marcadores pelos comandos daqui:

| Marcador | Valor neste projeto |
|---|---|
| `{{CMD_DEV}}` | `npm start` |
| `{{LOCAL_URL}}` | `http://localhost:3000` |
| `{{CMD_TYPECHECK}}`, `{{CMD_LINT}}`, `{{CMD_BUILD}}` | `npm run check` (não há build) |
| `{{CMD_TEST}}`, `{{TESTS_DIR}}` | não versionados — use a sua |

Sem as skills instaladas, as regras que importam já estão destiladas no
`AGENTS.md` — a seção **Convenções** é o resumo do que elas exigem.

## Escopo

- Commit e push **só quando pedirem**.
- Não introduza framework, empacotador nem dependência de navegador: veja os
  invariantes 5 e 6 do `AGENTS.md`.
- Comentário aqui explica **por que**, e em português. Vários dos que existem
  marcam uma armadilha real — antes de apagar um, entenda o que ele protege.
