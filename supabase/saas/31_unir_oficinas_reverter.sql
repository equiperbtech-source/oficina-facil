-- Reverter da 31 (unir oficinas): apaga as funções. As colunas unida_a/unida_em ficam (não apagam dados). Seguro rodar de novo.
drop function if exists public.admin_unir_lojas(uuid, uuid, text);
drop function if exists public.admin_duplicadas();
drop function if exists public.unir_oficinas(uuid, uuid);
