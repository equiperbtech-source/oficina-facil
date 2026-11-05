-- =====================================================================
-- SaaS · Etapa 17: comunicado com duas versões — lojas Kiwify (português) e lojas Hotmart (espanhol).
-- Um envio só; cada loja recebe a versão de onde assina. Loja que ainda não assinou (teste, cortesia)
-- recebe pelo idioma da loja. Deixar uma das versões em branco = só aquele grupo recebe.
-- ADITIVA (duas colunas novas e funções novas; as da etapa 16 continuam funcionando).
-- Reverter: 17_comunicados_provedor_reverter.sql
-- =====================================================================

alter table public.comunicados add column if not exists titulo_es text not null default '';
alter table public.comunicados add column if not exists mensagem_es text not null default '';
alter table public.comunicados drop constraint if exists comunicados_mensagem_check;
alter table public.comunicados drop constraint if exists comunicados_texto_ok;
alter table public.comunicados add constraint comunicados_texto_ok check (
  (length(trim(mensagem)) > 0 or length(trim(mensagem_es)) > 0) and length(mensagem) <= 4000 and length(mensagem_es) <= 4000);

-- versão que a loja recebe: 'pt' (Kiwify) ou 'es' (Hotmart); sem assinatura, o idioma da loja
create or replace function public.versao_comunicado(p_loja uuid, p_idioma text) returns text
  language sql stable security definer set search_path = public as $$
  select case l.provedor_pagamento when 'hotmart' then 'es' when 'kiwify' then 'pt'
           else case when coalesce(t.idioma, p_idioma) = 'es' then 'es' else 'pt' end end
    from (select 1) x
    left join public.lojas l on l.id = p_loja and exists (select 1 from public.membros m where m.loja_id = l.id and m.user_id = auth.uid())
    left join public.lojas_tema t on t.loja_id = l.id
$$;

create or replace function public.meus_comunicados(p_idioma text, p_loja uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
declare v text := public.versao_comunicado(p_loja, p_idioma);
begin
  if auth.uid() is null or not exists (select 1 from public.membros m where m.user_id = auth.uid()) then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', c.id,
      'titulo', case when v = 'es' then c.titulo_es else c.titulo end,
      'mensagem', case when v = 'es' then c.mensagem_es else c.mensagem end, 'criado_em', c.criado_em) order by c.criado_em)
    from public.comunicados c
   where c.ativo and c.idioma in ('todos', v)
     and length(trim(case when v = 'es' then c.mensagem_es else c.mensagem end)) > 0
     and not exists (select 1 from public.comunicados_lidos l where l.comunicado_id = c.id and l.user_id = auth.uid())), '[]'::jsonb);
end $$;

-- versão antiga (app ainda não atualizado): só a mensagem em português
create or replace function public.meus_comunicados(p_idioma text) returns jsonb
  language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'titulo', c.titulo, 'mensagem', c.mensagem, 'criado_em', c.criado_em) order by c.criado_em), '[]'::jsonb)
    from public.comunicados c
   where c.ativo and auth.uid() is not null and length(trim(c.mensagem)) > 0
     and (c.idioma = 'todos' or c.idioma = coalesce(p_idioma, 'pt'))
     and exists (select 1 from public.membros m where m.user_id = auth.uid())
     and not exists (select 1 from public.comunicados_lidos l where l.comunicado_id = c.id and l.user_id = auth.uid())
$$;

create or replace function public.admin_salvar_comunicado2(p_titulo text, p_mensagem text, p_titulo_es text, p_mensagem_es text) returns bigint
  language plpgsql security definer set search_path = public as $$
declare novo bigint;
begin
  perform public.exigir_admin();
  if coalesce(trim(p_mensagem), '') = '' and coalesce(trim(p_mensagem_es), '') = '' then raise exception 'escreva a mensagem'; end if;
  insert into public.comunicados(titulo, mensagem, titulo_es, mensagem_es, idioma, criado_por)
  values (left(coalesce(trim(p_titulo), ''), 120), coalesce(trim(p_mensagem), ''), left(coalesce(trim(p_titulo_es), ''), 120), coalesce(trim(p_mensagem_es), ''), 'todos', auth.uid())
  returning id into novo;
  perform public.auditar('comunicado', null, null, jsonb_build_object('id', novo, 'titulo', p_titulo, 'titulo_es', p_titulo_es), null);
  return novo;
end $$;

create or replace function public.admin_comunicados() returns jsonb
  language plpgsql stable security definer set search_path = public as $$
begin
  perform public.exigir_admin();
  return coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'titulo', c.titulo, 'mensagem', c.mensagem, 'titulo_es', c.titulo_es, 'mensagem_es', c.mensagem_es,
      'idioma', c.idioma, 'ativo', c.ativo, 'criado_em', c.criado_em, 'lidos', (select count(*) from public.comunicados_lidos l where l.comunicado_id = c.id))
    order by c.criado_em desc) from public.comunicados c), '[]'::jsonb);
end $$;

revoke all on function public.versao_comunicado(uuid, text), public.meus_comunicados(text, uuid), public.meus_comunicados(text),
  public.admin_salvar_comunicado2(text, text, text, text), public.admin_comunicados() from public, anon;
grant execute on function public.versao_comunicado(uuid, text), public.meus_comunicados(text, uuid), public.meus_comunicados(text),
  public.admin_salvar_comunicado2(text, text, text, text), public.admin_comunicados() to authenticated;
