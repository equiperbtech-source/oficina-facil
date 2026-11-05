-- Roda depois do banco montado (TESTES). Avisa o servidor de testes a cada mudança em public.itens,
-- para simular o "tempo real" do Supabase. Só manda as chaves (o NOTIFY tem limite de tamanho).
create or replace function public._teste_avisar_itens() returns trigger language plpgsql as $$
declare r record;
begin
  r := coalesce(new, old);
  perform pg_notify('teste_itens', jsonb_build_object('type', tg_op, 'loja_id', r.loja_id, 'colecao', r.colecao, 'id', r.id)::text);
  return null;
end $$;
drop trigger if exists _teste_avisar_itens on public.itens;
create trigger _teste_avisar_itens after insert or update or delete on public.itens
  for each row execute function public._teste_avisar_itens();
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
