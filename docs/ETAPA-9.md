# Etapa 9: landing

## O que foi feito
- `landing/index.html` (publicada em `/landing/`): celular primeiro, curta, branca com azul escuro, barra fixa **"Testar grátis"**.
- Dores da oficina (veículo parado sem previsão, cliente ligando, peça não cobrada, cliente que não volta para a revisão, briga por risco na lataria), planos lado a lado (Essencial R$ 49,99 · Pro R$ 89,99) e perguntas, inclusive como instalar no celular pelo navegador.
- **UTMs** (e fbclid/gclid) passam para o link de cadastro e para o checkout; **Meta Pixel e Clarity** por configuração no topo do script (`LANDING`), vazios por padrão. Os links de checkout também ficam ali (vazios = vai para o cadastro com teste grátis).
- Nada inventado: sem depoimentos, números, notas, descontos ou contagem regressiva; sem citar concorrentes.

## Testes (`tests/e2e/11-landing.spec.cjs`)
390 px sem rolagem lateral ✅ · contraste AA (axe) ✅ · UTMs no link de cadastro ✅ · nada inventado ✅ (celular e computador)
