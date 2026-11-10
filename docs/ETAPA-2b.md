# Etapa 2b: azul escuro

## O que foi feito

1. **Azul escuro em todo o sistema** (as variáveis continuam com o nome `--gold*`, que já eram o azul):
   - botões principais, menu selecionado, títulos de seção, botão flutuante e ícones de destaque: **`#1E3A8A`**;
   - ao passar o dedo ou o mouse (pressionado): **`#172554`**;
   - links, ícones de informação e foco: **`#1D4ED8`** (o azul médio ficou só para isso).
   - Fundo continua sempre branco; cartões `#F5F7FA`, bordas `#E3E8EF`.
2. **Logo** (roda + chave) refeito em azul escuro, em SVG e PNG 32/180/192/512. O manifest do app também.
3. **PDF e impressão:** moldura, linhas e carimbos em azul escuro, fundo branco, sem faixas escuras.
4. **E-mails** (migração nova `29_azul_escuro.sql`, com `29_azul_escuro_reverter.sql`): faixa de cima, nome e botão em azul escuro. O e-mail de boas-vindas da compra (servidor) também.
5. **Aparência padrão no banco** de uma oficina nova: azul escuro. Oficinas que nunca mexeram na cor (com o azul médio da Etapa 2) passam ao novo padrão.
6. Cores de etapa "Em análise" no app e no link do cliente: do azul claro antigo para `#1D4ED8`.
7. Versão do modo offline subiu (`oficina-v2`), para o celular pegar o visual novo.

## Resultado dos testes

`npm run teste` → **20 passaram, 0 falharam** (6 testes rodam só uma vez, no celular, e aparecem como "pulados" no computador).

Novos nesta etapa:
- **Sem azul médio antigo nos botões:** em login, painel, lista de OS, pátio, link do cliente e admin, nenhum botão principal, menu selecionado ou botão flutuante usa `#1D4ED8`/`#2563EB`/`#1E40AF` como fundo, e o botão principal é `#1E3A8A`.
- **Migrações novas:** o teste de banco agora roda o reverter de **cada** migração da Oficina Simples (28 em diante) 2 vezes, do último para o primeiro, e depois cada migração 2 vezes. E confere que o padrão final é `#1E3A8A`.
- Contraste AA (axe), PDF em 1 página e sem rolagem lateral continuam passando.

## Prints

Em [`docs/prints/etapa-2b/`](prints/etapa-2b/): entrada, painel, lista e detalhe da OS, pátio, menu, link do cliente, admin (celular e computador), PDF da OS, e-mail e cor própria da oficina.

## Decisões

- O gradiente dos botões ficou "chapado" em `#1E3A8A` (com o brilho branco do vidro por cima), para não aparecer azul médio na parte de cima do botão.
- A barra de status do celular (`theme-color` das páginas) continua **branca**, porque o fundo é sempre branco; o manifest usa o azul escuro.
