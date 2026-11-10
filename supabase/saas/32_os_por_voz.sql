-- 32 · "Preencher OS por voz": limite de uso por oficina e a lista de serviços e peças para a IA.
-- ADITIVA: tabela nova (sem acesso pelo app) e duas funções. Seguro rodar de novo. Reverter: 32_os_por_voz_reverter.sql
--   - Cada áudio enviado conta 1 uso. Limite: 30 por hora por oficina. Guarda só a hora (nunca o áudio).
--   - voz_catalogo devolve id e nome dos serviços e das peças da oficina (o servidor manda para a IA escolher entre eles).

create table if not exists public.voz_uso (
  id bigserial primary key,
  loja_id uuid not null references public.lojas(id) on delete cascade,
  user_id uuid,
  em timestamptz not null default now()
);
create index if not exists voz_uso_loja_em_idx on public.voz_uso (loja_id, em);
alter table public.voz_uso enable row level security;
revoke all on public.voz_uso from anon, authenticated;

-- 'ok' (conta o uso), 'sem_login', 'sem_acesso' (não é da equipe ou oficina em somente leitura) ou 'limite'
create or replace function public.registrar_uso_voz(p_loja uuid) returns text
  language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return 'sem_login'; end if;
  if p_loja is null or p_loja not in (select public.minhas_lojas()) or not public.pode_escrever(p_loja) then return 'sem_acesso'; end if;
  perform pg_advisory_xact_lock(hashtext('voz:' || p_loja::text));
  if (select count(*) from public.voz_uso where loja_id = p_loja and em > now() - interval '1 hour') >= 30 then return 'limite'; end if;
  insert into public.voz_uso(loja_id, user_id) values (p_loja, auth.uid());
  delete from public.voz_uso where loja_id = p_loja and em < now() - interval '1 day';
  return 'ok';
end $$;
revoke all on function public.registrar_uso_voz(uuid) from public, anon;
grant execute on function public.registrar_uso_voz(uuid) to authenticated;

-- serviços e peças da oficina (só para quem é da equipe): [{ id, nome }] e [{ id, nome, codigo }]
create or replace function public.voz_catalogo(p_loja uuid) returns jsonb
  language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'servicos', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'nome', i.dados ->> 'nome') order by i.dados ->> 'nome')
                  from public.itens i where i.loja_id = p_loja and i.colecao = 'servicos' and coalesce((i.dados ->> 'deleted')::boolean, false) = false), '[]'::jsonb),
    'pecas', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'nome', i.dados ->> 'nome', 'codigo', i.dados ->> 'codigo') order by i.dados ->> 'nome')
                  from public.itens i where i.loja_id = p_loja and i.colecao = 'pecas' and coalesce((i.dados ->> 'deleted')::boolean, false) = false), '[]'::jsonb))
  where p_loja in (select public.minhas_lojas())
$$;
revoke all on function public.voz_catalogo(uuid) from public, anon;
grant execute on function public.voz_catalogo(uuid) to authenticated;
