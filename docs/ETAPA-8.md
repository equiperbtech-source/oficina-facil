# Etapa 8: banco, segurança, pagamento e admin

## O que foi feito
- **Banco novo começa por um arquivo só:** `supabase/saas/00_base.sql` (schema + migrações 01–27 do original, na ordem), já **sem "oficina padrão"**, **sem função que apaga oficinas** e com o índice único **"1 oficina principal por dono"**. O `TUDO.sql` = `00_base` + migrações 28–31 e é o único arquivo para rodar num Supabase novo. Os arquivos antigos foram para `supabase/legado/` (histórico).
- Textos do pedido público do cliente falando de veículo.
- **Unir oficinas duplicadas do mesmo e-mail** (migração `31_unir_oficinas.sql` + reverter): a com mais cadastros prevalece e **nada dela é substituído**; da outra só entra o que falta, números repetidos ganham o próximo livre; a outra **não é apagada** (fica marcada como unida e sem equipe). Tudo com auditoria.
- **Admin:** abas **Em teste**, **Bloqueadas e expiradas** e **Duplicadas** (com "Unir as duas"); **vincular compra a uma oficina com busca** (antes era colar o ID). Já existiam: carrinhos abandonados, alterar plano (ativar manualmente), cortesia, teste grátis, bloquear, entrar como a oficina.
- Kiwify com webhook validado e idempotente e fila "compras sem oficina" (do original, mantidos).

## Testes
- `TUDO.sql` 2x sem erro; **reverter de cada migração 2x** e a migração 2x (28–31) ✅
- **Duas oficinas isoladas:** B não vê clientes, OS com veículo, fornecedores, orçamentos, notas, equipe nem fotos de A, nem pelo servidor; não grava nem altera nada de A ✅
- **Webhook idempotente:** o mesmo evento 2x = um registro e uma ativação ✅
- **Unir oficinas:** nada sobrescrito, nada perdido, OS renumerada, a outra continua existindo ✅
- Banco sem "oficina padrão" e sem as funções que apagavam oficinas ✅

`npm run teste` → **32 passaram, 0 falharam.**

## Pendente
Multi-oficinas no Pro (ver `PENDENCIAS.md`).
