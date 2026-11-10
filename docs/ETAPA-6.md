# Etapa 6: fornecedores, estoque, vendas, financeiro e metas

## O que foi feito
- **Fornecedores** (menu "Fornecedores"): cadastro com nome, CNPJ, WhatsApp, telefone, e-mail, vendedor, prazo de entrega e observações; **histórico de compras** (pedidos e cotações enviados + notas importadas por XML).
- **Cotação e pedido pelo WhatsApp** (até 3 fornecedores de uma vez); a mensagem já leva o veículo: "Olá! Qual o valor da pastilha de freio dianteira do Onix 1.0 2019?".
- **XML de NF-e:** quantidade com decimal (óleo em litro); peça nova já ganha a unidade da nota (L, ml, kg, m, un).
- **Estoque:** peças e produtos num cadastro só com "vende no balcão", unidade, aplicação, marca, estoque mínimo e lista "comprar" (feito na Etapa 3).
- **Balcão (PDV):** venda de peças e acessórios, recibo em PDF/cupom, WhatsApp, caixa.
- **Parcelas no crédito:** taxa da maquininha por parcela e "sem juros até Nx", em tabelas separadas para **Serviços (OS)** e **Peças/produtos (balcão)** (Configurações → Parcelas no crédito). A taxa entra no lucro real.
- **Financeiro e relatórios:** lucro real e relatório **mão de obra × peças** (OS e balcão).
- **Metas:** OS concluídas contam para o mecânico responsável; sem mecânico (ou mecânico que não existe mais) contam para a oficina; OS que vai direto para "Pago" conta e registra quem finalizou.

## Testes (`tests/e2e/08-fornecedores-metas.spec.cjs`)
- Cotação com marca/modelo/ano para carro e moto ✅ · XML 4,5 L lido como 4,5 ✅ · estoque 4,5 − 0,75 = 3,75 ✅
- Parcelas em 3x: OS usa 6%, balcão usa 9% ✅
- Metas: Beto 2, Caio 1 (direto para Pago), oficina 3 (sem mecânico + mecânico "fantasma") ✅

`npm run teste` → **29 passaram, 0 falharam.**
