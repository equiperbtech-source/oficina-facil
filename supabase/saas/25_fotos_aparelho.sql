-- Etapa 25: fotos do aparelho (estado na entrada) na OS e no orçamento.
-- Bucket PRIVADO "lojas-privado": pasta por loja (<loja_id>/aparelhos/...). Só a equipe da loja lê, grava e apaga;
-- o sistema mostra as fotos por link temporário (assinado). Nada fica público: são fotos do aparelho do cliente.
-- Pode rodar de novo sem problema.
do $$ begin
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('lojas-privado', 'lojas-privado', false, 3145728, array['image/png', 'image/jpeg', 'image/webp'])
  on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

  drop policy if exists lojas_privado_ler on storage.objects;
  create policy lojas_privado_ler on storage.objects for select to authenticated
    using (bucket_id = 'lojas-privado' and (storage.foldername(name))[1] in (select public.minhas_lojas()::text));
  drop policy if exists lojas_privado_gravar on storage.objects;
  create policy lojas_privado_gravar on storage.objects for insert to authenticated
    with check (bucket_id = 'lojas-privado' and (storage.foldername(name))[1] in (select public.minhas_lojas()::text) and public.pode_escrever(((storage.foldername(name))[1])::uuid));
  drop policy if exists lojas_privado_apagar on storage.objects;
  create policy lojas_privado_apagar on storage.objects for delete to authenticated
    using (bucket_id = 'lojas-privado' and (storage.foldername(name))[1] in (select public.minhas_lojas()::text));
exception when undefined_table or invalid_schema_name or undefined_function then
  raise notice 'Storage indisponível neste banco: fotos do aparelho desativadas (%).', sqlerrm;
end $$;
