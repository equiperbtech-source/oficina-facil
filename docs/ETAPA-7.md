# Etapa 7: personalização

## O que foi feito
- **Configurações → Aparência da oficina:** logo (qualquer formato; vira PNG no PDF), cor principal e cor ao tocar, nome, slogan, rodapé, dados da empresa e endereço curto. Prévia ao vivo no app. **Cor clara demais é recusada** com explicação (contraste WCAG AA). **Fundo sempre branco.**
- **Configurações → Oficina: listas e textos** (novo):
  - liga/desliga: previsão de entrega, resumo da garantia no WhatsApp, aprovação pelo link, preço de venda visível para o mecânico;
  - checklist de entrada por tipo (carro/moto), categorias de peças;
  - mensagens de WhatsApp de cada etapa com `{cliente}`, `{veiculo}`, `{placa}`, `{oficina}`, `{link}`, `{total}`, `{etapa}` e prévia;
  - prévia do PDF da OS.
- Já existiam e continuam: etapas do pátio (criar, renomear, tirar), catálogo de serviços, termos de entrada e garantia, rodapé do PDF, tipos atendidos e revisão padrão, parcelas por Serviços × Balcão.
- Tudo salvo por oficina, sincronizado e juntado campo a campo; só o que a oficina mudou é guardado.

## Testes (`tests/e2e/09-personalizacao.spec.cjs`)
- Cor clara recusada ✅ · oficina só de moto só oferece moto ✅
- Mudar o checklist e renomear a etapa **não altera a OS antiga** ✅
- Mensagem personalizada com variáveis; resumo da garantia desligado tira a garantia da mensagem ✅
- **Dois dispositivos** mudam configurações diferentes ao mesmo tempo e os dois valores ficam (também depois de recarregar) ✅

`npm run teste` → 31 testes verdes.
