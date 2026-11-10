# Etapa 3: veículos (carro e moto)

## O que foi feito
- **Saiu tudo de celular:** IMEI, senha e desenho de desbloqueio, "Aparelhos"/seminovos/troca, capa/película, checklist de celular, "bancada", "técnico". Arquivos `padrao.js` e `aparelhos.js` apagados.
- **Veículo** (`js/veiculo.js`): tipo carro ou moto; placa Mercosul e antiga (guardada sem hífen, em maiúsculas; ABC1234 = ABC1C34; formato estranho só avisa); marca, modelo, versão, anos, cor, km, combustível, chassi; carro: motor e câmbio; moto: cilindrada, partida e freio.
- **Placa única por oficina:** ao digitar uma placa já cadastrada aparece "Placa já cadastrada em {cliente}" com "Usar este cadastro".
- **Busca por placa** (com ou sem hífen) em clientes, OS, orçamentos e no assistente da OS.
- **Clientes:** vários veículos, CPF com aviso de inválido, botões grandes WhatsApp e Ligar, total gasto, última visita, observações e histórico de OS por veículo.
- **Checklist por tipo** (carro e moto) com OK / com defeito / não verificado; **combustível** visual (vazio a cheio); km na entrada. Cada OS guarda a lista usada.
- **Catálogo de serviços** criado com a oficina conforme a resposta de "Que veículos você atende?" (carro, moto ou os dois), com garantia em dias e km.
- **Pátio** no lugar da bancada: etapas Em análise, Aguardando aprovação, Aguardando peça, Em serviço, Pronto para retirada + card **Pago** fixo no fim; barra de rolagem em cima, setas e arrastar com o mouse; etapas renomeáveis.
- **Vocabulário de oficina** em telas, PDFs, mensagens e link do cliente. "Oficina não encontrada" com o botão "Ir para a minha oficina" para quem está logado.

## Testes
`npm run teste` → **25 passaram, 0 falharam.** Novos: placa (formatos, Mercosul = antiga, busca), busca por placa acha cliente/veículo/OS, placa repetida avisa, carro e moto mostram os campos certos, **nenhum termo de celular** em 12 telas + link do cliente.

## Pendente para os ajustes finos
- Espanhol das telas novas ainda incompleto (texto novo aparece em português no modo espanhol).
- Prints em [`docs/prints/etapa-3/`](prints/etapa-3/).
