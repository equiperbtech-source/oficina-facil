-- Reverte a etapa 3 (os registros de lotes/notas/follow-ups/metas continuam guardados em itens)
do $$ begin
  drop policy if exists lojas_publico_ler on storage.objects;
  drop policy if exists lojas_publico_gravar on storage.objects;
  drop policy if exists lojas_publico_alterar on storage.objects;
  drop policy if exists lojas_publico_apagar on storage.objects;
exception when undefined_table or invalid_schema_name then null; end $$;
drop function if exists public.vitrine_publica(text, text);
drop function if exists public.num_seguro(text);
drop function if exists public.sim_seguro(text);
drop index if exists public.itens_lotes_item_idx;
drop index if exists public.itens_nfe_chave_idx;
