# Etapa 2: tema branco e azul

## O que foi feito

1. **Cores novas em todo o sistema:** fundo branco, cartões `#F5F7FA`, bordas `#E3E8EF`, texto `#0F172A`, botões azul `#1D4ED8` (com `#1E40AF` ao passar o dedo ou o mouse), destaque `#2563EB`, azul suave `#EFF6FF`/`#DBEAFE`. Não sobrou nenhum dourado nem fundo preto.
2. **Vidro ajustado para o fundo claro.** Botões e menus flutuantes com brilho branco na borda de cima e sombras leves. A janela da OS ficou quase sólida, porque transparente demais o texto perdia contraste.
3. **Cor própria da oficina (white-label):**
   - sem cor própria, vale o tema da Oficina Simples;
   - com cor própria, muda só o destaque (botões, links) e o resto continua claro e legível;
   - cor clara demais (ex.: amarelo) é recusada pela validação, como no original.
4. **Celular primeiro:**
   - botões, ícones, abas e campos com **44 px** ou mais;
   - os botões pequenos de "x" ficam com 28 px na tela, mas com 44 px de área de toque;
   - no topo do celular aparece o **nome da oficina** no lugar da marca, e "Atualizar o sistema" foi para o menu lateral.
5. **PDF e impressão:** moldura e linhas azuis, sem fundos escuros (economiza tinta). Seguem a cor da oficina quando ela escolhe uma.
6. **Páginas públicas, admin, ícone e manifest no tema novo:** link do cliente, pedido de orçamento, vitrine e entrada do admin, mais a cor da barra do celular e o manifest do app.
7. **E-mails** (migração `28_tema_claro.sql`, com reverter):
   - pedido de orçamento e pedido da vitrine em branco, com faixa e botão azuis;
   - o e-mail de boas-vindas da compra também mudou;
   - **corrigido o 55 fixo no link do WhatsApp dos e-mails:** agora segue a mesma regra do app (só número brasileiro ganha 55);
   - o e-mail de teste usa um veículo de exemplo (Onix 2019).
8. **Aparência padrão no banco** de uma oficina nova: azul e branco.

## Ajuste nas cores do documento (para passar no contraste AA)

Alguns tons do documento passam como **fundo e ícone**, mas ficam abaixo de 4,5:1 quando usados como **texto pequeno**. Para texto usei um tom um pouco mais escuro:

| Uso | Documento | Texto na tela |
|---|---|---|
| Sucesso | `#16A34A` (fundos, ícones) | `#137333` |
| Alerta | `#D97706` (fundos, ícones) | `#C2410C` |
| Erro | `#DC2626` (fundos, ícones) | `#B91C1C` |
| Texto secundário | `#64748B` | `#5B6B80` (o `#64748B` dá 4,4:1 sobre o cinza `#F5F7FA`) |

## Resultado dos testes

`npm run teste` → **20 passaram, 0 falharam.** Outros 6 são testes que rodam uma vez só (no celular) e aparecem como "pulados" na rodada do computador.

Novos nesta etapa:

| Teste | Celular | Computador |
|---|---|---|
| **Contraste AA (verificador axe)** em entrada, painel, lista de OS, detalhe da OS, pátio, link do cliente e entrada do admin | ✅ | ✅ |
| Nenhum dourado nem fundo preto nessas telas | ✅ | ✅ |
| Botões com 44 px ou mais no celular | ✅ | — |
| Sem rolagem lateral e sem erro no console | ✅ | ✅ |
| PDF da OS: tem azul, nada de dourado, sem faixas escuras, 1 página | ✅ | (uma vez) |
| E-mail de pedido: branco e azul, WhatsApp com 55 só para número do Brasil, contraste AA | ✅ | (uma vez) |
| Cor própria da oficina sobre fundo branco: legível; cor clara demais é recusada | ✅ | (uma vez) |
| Migração 28: reverter 2x e migração 2x sem erro | ✅ | (uma vez) |

Os testes acharam e eu corrigi:
- botões de idioma com 40 px;
- verde, laranja e cinza com 4,4:1 sobre fundos levemente coloridos;
- a janela da OS transparente demais;
- o nome da oficina cortado no topo do celular.

## Prints

Em [`docs/prints/etapa-2/`](prints/etapa-2/):
- celular e computador: entrada, painel, lista de OS, detalhe da OS, pátio, link do cliente e admin;
- só no celular: menu lateral, cor própria da oficina;
- PDF da OS e e-mail de pedido.

## Ainda não mudou (de propósito)

- Os **textos** ainda são de celular ("Aparelho", "IMEI", "Senha", "Bancada", "Loja criada!", "Técnico"), na tela, no link do cliente e no PDF. Isso é a Etapa 3, junto com placa, tipo de veículo e "Que veículos você atende?".
- O checklist do PDF ainda é o de celular (Etapa 4).

## O que você precisa fazer

Nada.
