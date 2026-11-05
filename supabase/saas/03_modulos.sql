-- =====================================================================
-- SaaS · Etapa 3: vitrine pública, fotos (Storage), notas de entrada (XML) e lotes
-- ADITIVA. Os dados novos (lotes, notas de entrada, follow-ups, metas por funcionário)
-- ficam na mesma tabela itens, com loja_id e as regras (RLS) da etapa 2.
-- Reverter: 03_modulos_reverter.sql
-- =====================================================================

-- Nota de entrada (XML) é gravada com id = chave da NF-e: a chave primária (loja, coleção, id)
-- já impede importar a mesma nota duas vezes na mesma loja. Índice extra para busca por chave:
create index if not exists itens_nfe_chave_idx on public.itens (loja_id, (dados ->> 'chave')) where colecao = 'nfe_entradas';
create index if not exists itens_lotes_item_idx on public.itens (loja_id, (dados ->> 'itemId')) where colecao = 'lotes';

-- ---------- Vitrine pública ----------
-- Devolve só o que a loja marcou para a vitrine, com campos públicos (nunca custo, fornecedor, IMEI etc.).
-- Conversões tolerantes: um campo salvo vazio ou com vírgula ("", "1,5") não pode derrubar a vitrine inteira
create or replace function public.num_seguro(t text) returns numeric language plpgsql immutable as $$
begin
  return nullif(replace(trim(t), ',', '.'), '')::numeric;
exception when others then return null;
end $$;
create or replace function public.sim_seguro(t text) returns boolean language sql immutable as $$
  select lower(trim(coalesce(t, ''))) in ('true', 't', '1', 'sim', 'yes')
$$;

create or replace function public.vitrine_publica(p_ref text, p_host text) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
declare l uuid := public.loja_publica(p_ref, p_host); s jsonb;
begin
  if l is null then return null; end if;
  if not public.tem_recurso(l, 'vitrine') then return jsonb_build_object('indisponivel', true); end if;
  select dados into s from public.itens where loja_id = l and colecao = 'meta' and id = 'settings';
  return jsonb_build_object(
    'loja', jsonb_build_object('nome', coalesce(s ->> 'loja', (select nome from public.lojas where id = l)),
      'telefone', s ->> 'telefone', 'whatsapp', coalesce(s ->> 'whatsapp', s ->> 'telefone'), 'endereco', s ->> 'endereco', 'instagram', s ->> 'instagram'),
    'itens', coalesce((select jsonb_agg(jsonb_build_object(
        'id', i.id, 'nome', i.dados ->> 'nome', 'preco', public.num_seguro(i.dados ->> 'preco'), 'descricao', i.dados ->> 'descricao',
        'fotos', coalesce(i.dados -> 'fotos', '[]'::jsonb), 'cor', i.dados ->> 'cor', 'armazenamento', i.dados ->> 'armazenamento',
        'condicao', case when public.sim_seguro(i.dados ->> 'seminovo') then 'seminovo' when i.dados ->> 'tipoProduto' = 'novo' then 'novo' else 'acessorio' end,
        'bateria', i.dados ->> 'bateria', 'categoria', i.dados ->> 'categoria',
        'disponivel', coalesce(public.num_seguro(i.dados ->> 'qtd'), 0) > 0)
        order by (coalesce(public.num_seguro(i.dados ->> 'qtd'), 0) > 0) desc, i.dados ->> 'nome')
      from public.itens i
      where i.loja_id = l and i.colecao = 'produtos' and public.sim_seguro(i.dados ->> 'vitrine')
        and not public.sim_seguro(i.dados ->> 'deleted')), '[]'::jsonb));
end $$;
revoke all on function public.vitrine_publica(text, text) from public;
grant execute on function public.vitrine_publica(text, text) to anon, authenticated;

-- ---------- Fotos e logos (Supabase Storage) ----------
-- Pasta por loja: <loja_id>/... Só a equipe da loja grava na pasta dela; leitura pública (vitrine e logo).
do $$ begin
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('lojas-publico', 'lojas-publico', true, 2097152, array['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'])
  on conflict (id) do nothing;

  drop policy if exists lojas_publico_ler on storage.objects;
  create policy lojas_publico_ler on storage.objects for select using (bucket_id = 'lojas-publico');
  drop policy if exists lojas_publico_gravar on storage.objects;
  create policy lojas_publico_gravar on storage.objects for insert to authenticated
    with check (bucket_id = 'lojas-publico' and (storage.foldername(name))[1] in (select public.minhas_lojas()::text) and public.pode_escrever(((storage.foldername(name))[1])::uuid));
  drop policy if exists lojas_publico_alterar on storage.objects;
  create policy lojas_publico_alterar on storage.objects for update to authenticated
    using (bucket_id = 'lojas-publico' and (storage.foldername(name))[1] in (select public.minhas_lojas()::text));
  drop policy if exists lojas_publico_apagar on storage.objects;
  create policy lojas_publico_apagar on storage.objects for delete to authenticated
    using (bucket_id = 'lojas-publico' and (storage.foldername(name))[1] in (select public.minhas_lojas()::text));
exception when undefined_table or invalid_schema_name or undefined_function then
  raise notice 'Storage indisponível neste banco: fotos e logos desativados (%).', sqlerrm;
end $$;
