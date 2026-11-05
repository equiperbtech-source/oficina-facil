# Oficina Simples

Sistema para oficinas de **carro e moto**: ordens de serviço, pátio, orçamentos, estoque de peças, vendas, financeiro e equipe. Funciona no celular e no computador, como aplicativo (PWA), também sem internet.

Feito a partir do código do Reparo Simples, mas é um **produto separado**: tem banco próprio (Supabase), publicação própria (Vercel), pagamento próprio (Kiwify) e domínio próprio. Não compartilha nenhuma chave, banco ou login com o original.

> Em construção, por etapas. O plano e o andamento estão em [`docs/`](docs/).

## Como está organizado

| Pasta / arquivo | O que tem |
|---|---|
| `index.html`, `js/`, `css/` | O app (JavaScript puro, sem framework) |
| `acompanhar.html`, `pedido.html`, `vitrine.html` | Páginas públicas: link do cliente, pedido de orçamento e vitrine |
| `admin.html`, `js/admin.js`, `api/admin.js` | Painel do dono da plataforma |
| `api/` | Funções do servidor na Vercel (webhooks de pagamento, convite da equipe) |
| `supabase/schema.sql` + `supabase/saas/NN_*.sql` | Banco: base e migrações (cada uma com o seu `_reverter.sql`) |
| `supabase/saas/TUDO.sql` | Todas as migrações juntas (gerado por `npm run migracoes`, roda duas vezes sem erro) |
| `scripts/` | Build (`dist/`), geração do `js/config.js` na publicação e junção das migrações |
| `tests/` | Testes automáticos (ver abaixo) |

## Testes automáticos

Rodam numa máquina com Node 20+, PostgreSQL 16 e o Chromium do Playwright:

```bash
npm install
```

```bash
npm run teste
```

O que acontece:

1. Um Postgres local é ligado (porta 54329, pasta `.pgtest/`).
2. O banco é montado do zero: simulação do Supabase, `schema.sql` e `TUDO.sql` **duas vezes**.
3. Um "Supabase de mentira" (`tests/servidor/supabase-falso.cjs`) cuida do login, dos dados, das fotos e do tempo real. Ele usa o Postgres de verdade, com as mesmas regras de segurança (RLS) do banco real.
4. O Playwright abre o app no **celular (390×844)** e no **computador** e testa de ponta a ponta. Os testes falham com qualquer erro no console e com rolagem lateral.

Os prints ficam em `tests/prints/`.

Para usar o app à mão com o banco de teste, rode `npm run teste:servidor` e abra http://127.0.0.1:4173.

## Publicação

Nada de chave no código. Tudo vai em variáveis de ambiente na Vercel (veja `.env.example`). Em produção, sem as variáveis do Supabase, a publicação **para com erro**, para nunca sair um app sem nuvem por engano. O passo a passo completo fica para a etapa de publicação.
