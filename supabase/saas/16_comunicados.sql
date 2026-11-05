-- =====================================================================
-- SaaS · Etapa 16: comunicados da plataforma para todas as lojas.
-- O admin escreve uma mensagem em /admin → Comunicados; cada pessoa de qualquer loja vê um pop-up
-- ao abrir o sistema, uma vez só (fica marcado como lido para aquela pessoa, em qualquer aparelho).
-- ADITIVA (duas tabelas novas e funções novas). Reverter: 16_comunicados_reverter.sql
-- =====================================================================

create table if not exists public.comunicados (
  id bigserial primary key,
  titulo text not null default '',
  mensagem text not null check (length(trim(mensagem)) > 0 and length(mensagem) <= 4000),
  idioma text not null default 'todos' check (idioma in ('todos', 'pt', 'es')),
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  criado_por uuid
);
create table if not exists public.comunicados_lidos (
  comunicado_id bigint not null references public.comunicados(id) on delete cascade,
  user_id uuid not null,
  lido_em timestamptz not null default now(),
  primary key (comunicado_id, user_id)
);
alter table public.comunicados enable row level security;
alter table public.comunicados_lidos enable row level security;
revoke all on public.comunicados, public.comunicados_lidos from anon, authenticated;

-- ---------- Admin ----------
create or replace function public.admin_comunicados() returns jsonb
  language plpgsql stable security definer set search_path = public as $$
begin
  perform public.exigir_admin();
  return coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'titulo', c.titulo, 'mensagem', c.mensagem, 'idioma', c.idioma,
      'ativo', c.ativo, 'criado_em', c.criado_em, 'lidos', (select count(*) from public.comunicados_lidos l where l.comunicado_id = c.id))
    order by c.criado_em desc) from public.comunicados c), '[]'::jsonb);
end $$;

create or replace function public.admin_salvar_comunicado(p_titulo text, p_mensagem text, p_idioma text) returns bigint
  language plpgsql security definer set search_path = public as $$
declare novo bigint;
begin
  perform public.exigir_admin();
  if coalesce(trim(p_mensagem), '') = '' then raise exception 'escreva a mensagem'; end if;
  insert into public.comunicados(titulo, mensagem, idioma, criado_por)
  values (left(coalesce(trim(p_titulo), ''), 120), trim(p_mensagem), coalesce(nullif(p_idioma, ''), 'todos'), auth.uid())
  returning id into novo;
  perform public.auditar('comunicado', null, null, jsonb_build_object('id', novo, 'titulo', p_titulo, 'idioma', p_idioma), null);
  return novo;
end $$;

create or replace function public.admin_comunicado_ativo(p_id bigint, p_ativo boolean) returns void
  language plpgsql security definer set search_path = public as $$
begin
  perform public.exigir_admin();
  update public.comunicados set ativo = p_ativo where id = p_id;
  perform public.auditar('comunicado_ativo', null, null, jsonb_build_object('id', p_id, 'ativo', p_ativo), null);
end $$;

-- ---------- App (quem faz parte de alguma loja) ----------
-- comunicados ativos ainda não lidos por esta pessoa, no idioma do sistema dela (ou para todos)
create or replace function public.meus_comunicados(p_idioma text) returns jsonb
  language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'titulo', c.titulo, 'mensagem', c.mensagem, 'criado_em', c.criado_em) order by c.criado_em), '[]'::jsonb)
    from public.comunicados c
   where c.ativo and auth.uid() is not null
     and (c.idioma = 'todos' or c.idioma = coalesce(p_idioma, 'pt'))
     and exists (select 1 from public.membros m where m.user_id = auth.uid())
     and not exists (select 1 from public.comunicados_lidos l where l.comunicado_id = c.id and l.user_id = auth.uid())
$$;

create or replace function public.marcar_comunicado_lido(p_id bigint) returns void
  language sql security definer set search_path = public as $$
  insert into public.comunicados_lidos(comunicado_id, user_id)
  select p_id, auth.uid() where auth.uid() is not null and exists (select 1 from public.comunicados where id = p_id)
  on conflict do nothing
$$;

revoke all on function public.admin_comunicados(), public.admin_salvar_comunicado(text, text, text), public.admin_comunicado_ativo(bigint, boolean),
  public.meus_comunicados(text), public.marcar_comunicado_lido(bigint) from public, anon;
grant execute on function public.admin_comunicados(), public.admin_salvar_comunicado(text, text, text), public.admin_comunicado_ativo(bigint, boolean),
  public.meus_comunicados(text), public.marcar_comunicado_lido(bigint) to authenticated;
