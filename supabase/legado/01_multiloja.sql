-- =====================================================================
-- SaaS · Etapa 1: multi-loja por endereço (host) e acompanhamento em tempo real
-- Migração ADITIVA: só cria colunas/tabelas/funções novas. Não altera nem apaga
-- nenhum registro existente. Pode rodar mais de uma vez (idempotente).
-- Reverter: 01_multiloja_reverter.sql
-- =====================================================================

-- Configurações gerais da plataforma (só funções e o painel admin acessam)
create table if not exists public.plataforma_config (
  chave text primary key,
  valor jsonb not null,
  atualizado_em timestamptz not null default now()
);
alter table public.plataforma_config enable row level security;
revoke all on public.plataforma_config from anon, authenticated;
-- Domínios da plataforma onde cada loja ganha um subdomínio (ex.: minhaloja.seudominio.com.br)
insert into public.plataforma_config(chave, valor) values ('dominios_base', '[]'::jsonb) on conflict (chave) do nothing;

-- Endereço curto da loja (subdomínio / link público)
alter table public.lojas add column if not exists slug text;
create unique index if not exists lojas_slug_unico on public.lojas (lower(slug)) where slug is not null;
do $$ begin
  alter table public.lojas add constraint lojas_slug_formato check (slug is null or slug ~ '^[a-z0-9]([a-z0-9-]{1,38}[a-z0-9])?$');
exception when duplicate_object then null; end $$;

-- Domínios próprios das lojas (ex.: sistema.minhaloja.com.br)
create table if not exists public.lojas_dominios (
  dominio text primary key check (dominio = lower(dominio) and dominio ~ '^[a-z0-9.-]+\.[a-z]{2,}$'),
  loja_id uuid not null references public.lojas(id) on delete cascade,
  verificado boolean not null default false,
  criado_em timestamptz not null default now()
);
create index if not exists lojas_dominios_loja_idx on public.lojas_dominios(loja_id);
alter table public.lojas_dominios enable row level security;
drop policy if exists lojas_dominios_ver on public.lojas_dominios;
create policy lojas_dominios_ver on public.lojas_dominios for select using (loja_id in (select public.minhas_lojas()));
drop policy if exists lojas_dominios_dono on public.lojas_dominios;
create policy lojas_dominios_dono on public.lojas_dominios for all using (public.sou_dono(loja_id)) with check (public.sou_dono(loja_id) and verificado = false);

-- Descobre a loja pelo endereço acessado (domínio próprio verificado ou subdomínio da plataforma).
-- Público: devolve só dados de vitrine (id, slug, nome). Nunca dados internos.
create or replace function public.loja_por_host(p_host text) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
declare h text := lower(split_part(coalesce(p_host, ''), ':', 1)); base text; sub text; l public.lojas;
begin
  if h = '' then return null; end if;
  select lo.* into l from public.lojas_dominios d join public.lojas lo on lo.id = d.loja_id where d.dominio = h and d.verificado;
  if not found then
    for base in select jsonb_array_elements_text(valor) from public.plataforma_config where chave = 'dominios_base' loop
      if h like '%.' || lower(base) then
        sub := left(h, length(h) - length(base) - 1);
        if sub !~ '\.' then select * into l from public.lojas where lower(slug) = sub; end if;
        exit;
      end if;
    end loop;
  end if;
  if l.id is null then return null; end if;
  return jsonb_build_object('id', l.id, 'slug', l.slug,
    'nome', coalesce((select s.dados ->> 'loja' from public.itens s where s.loja_id = l.id and s.colecao = 'meta' and s.id = 'settings'), l.nome));
end $$;
revoke all on function public.loja_por_host(text) from public;
grant execute on function public.loja_por_host(text) to anon, authenticated;

-- Loja pelo slug (links públicos /pedido/<slug>, /vitrine/<slug>)
create or replace function public.loja_por_slug(p_slug text) returns uuid
  language sql stable security definer set search_path = public as $$
  select id from public.lojas where lower(slug) = lower(trim(p_slug))
$$;
revoke all on function public.loja_por_slug(text) from public;
grant execute on function public.loja_por_slug(text) to anon, authenticated;

-- Dono escolhe o endereço curto da loja
create or replace function public.definir_slug(p_loja uuid, p_slug text) returns text
  language plpgsql security definer set search_path = public as $$
declare s text := lower(trim(p_slug));
begin
  if not public.sou_dono(p_loja) then raise exception 'apenas o dono pode alterar o endereço'; end if;
  if s in ('www', 'app', 'admin', 'api', 'painel', 'suporte', 'pedido', 'vitrine', 'acompanhar') then raise exception 'endereço reservado'; end if;
  if exists (select 1 from public.lojas where lower(slug) = s and id <> p_loja) then raise exception 'este endereço já está em uso'; end if;
  update public.lojas set slug = s where id = p_loja;
  return s;
end $$;
revoke all on function public.definir_slug(uuid, text) from public, anon;
grant execute on function public.definir_slug(uuid, text) to authenticated;

-- ---------- Acompanhamento da OS em tempo real ----------
-- Quando uma OS com link muda, avisa só o canal daquele link ("os-<token>").
-- A mensagem não leva dados: a página pública busca de novo pelo acompanhar_os (que só expõe o permitido).
create or replace function public.avisar_os_publica() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if new.colecao = 'os' and coalesce(new.dados ->> 'token', '') <> '' and new.dados is distinct from old.dados then
    begin
      perform realtime.send(jsonb_build_object('em', now()), 'mudou', 'os-' || (new.dados ->> 'token'), false);
    exception when others then null; -- sem Realtime disponível: a página continua atualizando a cada 15 s
    end;
  end if;
  return new;
end $$;
drop trigger if exists itens_avisar_os_publica on public.itens;
create trigger itens_avisar_os_publica after update on public.itens
  for each row when (new.colecao = 'os') execute function public.avisar_os_publica();

-- Loja padrão da plataforma = a loja mais antiga (a sua). Mantém funcionando os links antigos
-- sem loja no endereço (ex.: /pedido) mesmo depois que outras lojas forem cadastradas.
insert into public.plataforma_config(chave, valor)
  select 'loja_padrao', to_jsonb(id::text) from public.lojas order by criado_em limit 1
on conflict (chave) do nothing;

-- Resolve a loja de uma página pública: id no link, endereço curto, domínio ou loja padrão
create or replace function public.loja_publica(p_ref text, p_host text) returns uuid
  language plpgsql stable security definer set search_path = public as $$
declare r text := trim(coalesce(p_ref, '')); l uuid;
begin
  if r ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    select id into l from public.lojas where id = r::uuid;
  elsif r <> '' then
    l := public.loja_por_slug(r);
  else
    l := (public.loja_por_host(p_host) ->> 'id')::uuid;
    if l is null then select (valor #>> '{}')::uuid into l from public.plataforma_config where chave = 'loja_padrao'; end if;
    -- sem loja padrão válida: se existir uma única loja, usa ela
    if l is null or not exists (select 1 from public.lojas where id = l) then
      select id into l from public.lojas where (select count(*) from public.lojas) = 1;
    end if;
  end if;
  return (select id from public.lojas where id = l);
end $$;
revoke all on function public.loja_publica(text, text) from public;
grant execute on function public.loja_publica(text, text) to anon, authenticated;
