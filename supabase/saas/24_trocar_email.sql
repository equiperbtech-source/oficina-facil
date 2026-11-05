-- =====================================================================
-- SaaS · Etapa 24: trocar o e-mail de login sem perder a loja.
-- A loja fica ligada à conta (user_id), não ao e-mail. Depois que a pessoa confirma o e-mail novo, o app chama
-- sincronizar_meu_email() para atualizar o e-mail guardado na equipe (membros.email), que é o usado para achar
-- a loja numa compra nova. email_da_compra() mostra o e-mail usado na compra (Kiwify/Hotmart) para o aviso.
-- ADITIVA (funções novas). Reverter: 24_trocar_email_reverter.sql
-- =====================================================================

create or replace function public.sincronizar_meu_email() returns text
  language plpgsql security definer set search_path = public as $$
declare e text;
begin
  if auth.uid() is null then return null; end if;
  select lower(email) into e from auth.users where id = auth.uid();
  if coalesce(e, '') = '' then return null; end if;
  update public.membros set email = e where user_id = auth.uid() and lower(coalesce(email, '')) <> e;
  return e;
end $$;

-- e-mail usado na compra (só para o dono da loja)
create or replace function public.email_da_compra(p_loja uuid) returns text
  language sql stable security definer set search_path = public as $$
  select l.comprador_email from public.lojas l where l.id = p_loja and public.sou_dono(p_loja)
$$;

revoke all on function public.sincronizar_meu_email(), public.email_da_compra(uuid) from public, anon;
grant execute on function public.sincronizar_meu_email(), public.email_da_compra(uuid) to authenticated;
