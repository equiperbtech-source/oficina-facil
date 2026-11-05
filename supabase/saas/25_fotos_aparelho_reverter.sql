-- Reverte a etapa 25: tira as regras de acesso do bucket privado. As fotos já enviadas continuam guardadas
-- (para apagar de vez, esvazie e exclua o bucket "lojas-privado" no painel do Supabase > Storage).
do $$ begin
  drop policy if exists lojas_privado_ler on storage.objects;
  drop policy if exists lojas_privado_gravar on storage.objects;
  drop policy if exists lojas_privado_apagar on storage.objects;
exception when undefined_table or invalid_schema_name then null; end $$;
