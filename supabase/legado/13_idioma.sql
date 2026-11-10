-- =====================================================================
-- SaaS · Etapa 13: idioma da loja (português ou espanhol)
-- Usado pelas páginas do cliente final (acompanhamento do reparo, vitrine) e por quem da equipe
-- ainda não escolheu um idioma. Fica em lojas_tema, que essas páginas já leem (tema_publico).
-- ADITIVA. Reverter: 13_idioma_reverter.sql
-- =====================================================================

alter table public.lojas_tema add column if not exists idioma text not null default 'pt';
do $$ begin
  alter table public.lojas_tema add constraint lojas_tema_idioma_ok check (idioma in ('pt', 'es'));
exception when duplicate_object then null; end $$;

create or replace function public.definir_idioma(p_loja uuid, p_idioma text) returns void
  language plpgsql security definer set search_path = public as $$
begin
  if not public.sou_dono(p_loja) then raise exception 'apenas o dono altera o idioma da loja'; end if;
  if p_idioma not in ('pt', 'es') then raise exception 'idioma inválido'; end if;
  insert into public.lojas_tema(loja_id, idioma) values (p_loja, p_idioma)
    on conflict (loja_id) do update set idioma = excluded.idioma, atualizado_em = now();
end $$;
revoke all on function public.definir_idioma(uuid, text) from public, anon;
grant execute on function public.definir_idioma(uuid, text) to authenticated;
