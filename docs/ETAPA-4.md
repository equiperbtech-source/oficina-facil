# Etapa 4: OS da oficina

## O que foi feito
- **Assistente em 4 passos:** placa ou cliente → veículo → entrada (km, combustível, checklist, fotos, assinatura) → serviços e peças.
- **Mão de obra e peças separados** na OS, no orçamento, no PDF, no link e no financeiro. Total = mão de obra + peças − desconto; a OS continua gravando `valor` (o total).
- **Itens:** serviço (nome, qtd, valor, mecânico, garantia em dias e km) e peça (do estoque ou avulsa, qtd com decimal, valor, custo, quem lançou e quando). A peça do estoque **baixa ao entrar e volta se sair** da OS.
- **Orçamento** com os mesmos itens; ao aprovar no app, os itens vão para a OS. PDF do orçamento.
- **Aprovação pelo link** ("Aguardar aprovação do cliente" na OS): o cliente aprova com um toque e a OS vai para "Em serviço".
- **Link do cliente** reescrito (migração `30_link_oficina.sql`, com reverter): lista fechada — placa mascarada (ABC•••3), primeiro nome, itens e total; nunca CPF, telefone, assinatura, fotos de entrada ou custo. `?pdf=garantia` e `?pdf=comprovante` baixam direto.
- **Garantia por prazo e/ou km** ("3 meses ou 5.000 km, o que vier primeiro") no PDF, link e WhatsApp. Comprovante de pagamento em PDF.
- **Fotos:** até 12, reduzidas no celular (~1600 px), com etiqueta de um toque e escolha de quais saem no PDF.
- **Impressão:** termo de entrada A4 e cupom 58/80 mm com placa em destaque e a cláusula de abandono (90 dias); etiqueta com a placa grande.
- **WhatsApp** por `api.whatsapp.com/send`; mensagem de "pronto" com resumo da garantia (liga/desliga); agradecimento por escolher a oficina ao pagar.
- Também entraram: balcão de peças, metas por mecânico (sem mecânico conta para a oficina), pós-venda com lembretes de revisão e orçamentos não aprovados, parcelas no crédito por Serviços × Balcão.

## Testes (`tests/e2e/06-veiculos-os.spec.cjs`)
- Soma 80 + 2×90 − 10 = **R$ 250,00** na tela, na OS, no PDF, no link e no financeiro (mão de obra + peças = 250). ✅
- Estoque 10 → 8 ao lançar; volta a 10 ao tirar a peça. ✅
- Aprovar pelo link move a OS para "Em serviço" (chega no app em tempo real). ✅
- Link não devolve placa completa, telefone, sobrenome, assinatura nem custo. ✅
- PDF da OS sem fotos em **1 página**, com placa e cláusula de abandono. ✅
- OS paga nunca aparece como atrasada. ✅
