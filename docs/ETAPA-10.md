# Etapa 10: revisão final

## O que foi feito
- `npm run teste` rodado do zero (Postgres novo, `TUDO.sql` 2x): **resultado no fim deste arquivo**.
- **Nenhum segredo no repositório:** procurei chaves do Supabase (secret/service_role e JWTs), Brevo, Stripe/AWS e chaves privadas. Só há chaves de mentira do servidor de teste local.
- **Build de produção:** sem as variáveis do Supabase a publicação para com erro (de propósito); com elas, sai normal, incluindo a landing.
- `docs/PUBLICACAO.md`: prévia sem banco (Parte 1), produção passo a passo — Supabase, `TUDO.sql`, Vercel e variáveis `OFICINA_*`, domínio e subdomínio curinga, Kiwify e webhook, Brevo, Pixel (Parte 2) e o roteiro de teste manual de 15 minutos (Parte 3).

## Textos PT/ES
O português foi revisado tela a tela (nenhum termo de celular, teste automático). O espanhol das telas novas ficou para os ajustes finos (`PENDENCIAS.md`).

## Resultado final
`npm run teste` → **34 passaram, 0 falharam** (14 rodam uma vez só, no celular, e aparecem como "pulados" na rodada do computador). Todos os testes falham com qualquer erro no console.
