# Etapa 5: mecânico rápido e clientes

## O que foi feito
- **Tela do mecânico** (menu "Mecânico"; o mecânico já abre nela): cartões grandes com a placa em destaque.
  - **Fotos:** câmera traseira direto, várias seguidas, reduzidas no celular (~1600 px, JPEG 0,75). Entram numa **fila no IndexedDB** e sobem sozinhas quando há internet ("Enviando 2 de 5"). Nunca no localStorage.
  - **+ Peça:** usadas há pouco, busca por nome/código/aplicação e **leitura de código de barras** pela câmera (quando o navegador permite). Baixa do estoque na hora.
  - **Etapa:** mover com um toque.
  - O mecânico **não vê custo, lucro nem financeiro** (telas escondidas e valores tirados das telas que ele vê).
- **Clientes:** ficha com WhatsApp/Ligar, veículos, histórico por veículo, total gasto, última visita, observações, CPF com aviso e **foto do documento** (bucket privado, nunca sai em PDF).
- **Histórico por placa** na OS (botão "Histórico desta placa").
- **Próxima revisão** na OS (data e/ou km), com padrões em Configurações (carro 10.000 km / 12 meses; moto 3.000 km / 3 meses). Só km: data estimada pela média de km/dia da placa; sem histórico, prazo padrão.
- **Pós-venda:** lembretes do dia e da semana com WhatsApp pronto (revisão — Pro; retorno de 7 dias; orçamento não aprovado; não retirados; garantia acabando; aniversariantes).
- **Importar planilha (CSV):** nome, telefone, CPF, placa, marca, modelo, ano. Mesmo telefone/CPF = mesmo cliente; placa já cadastrada (inclusive antiga × Mercosul) não duplica.

## Testes (`tests/e2e/07-mecanico.spec.cjs`)
- Abrir OS + 5 fotos + 3 peças no celular em **menos de 30 s**. ✅
- Sem internet, 2 fotos ficam na fila; com a conexão de volta, sobem e entram na OS. ✅
- Mecânico não vê "custo", "lucro" nem valores de custo em 8 telas + detalhe e itens da OS; financeiro, caixa, relatórios e balcão bloqueados. ✅
- CSV: 2 clientes, 2 veículos, 1 placa repetida ignorada; revisão vencida aparece com a mensagem pronta. ✅

`npm run teste` → **28 passaram, 0 falharam.** Prints: [`docs/prints/etapa-5/`](prints/etapa-5/).
