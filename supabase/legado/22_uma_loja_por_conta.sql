-- =====================================================================
-- SaaS · Etapa 22: cada conta cria uma loja só.
-- Antes, tocar duas vezes em "Criar loja" (ou tentar de novo depois de um erro de internet) criava outra
-- loja para o mesmo e-mail. Agora, se a conta já é dona de uma loja, criar_loja devolve essa loja.
-- O bloqueio por conta evita duas criações ao mesmo tempo (toque duplo).
-- ADITIVA (só troca a função). Reverter: 22_uma_loja_por_conta_reverter.sql
-- =====================================================================

create or replace function public.criar_loja(p_nome text) returns public.lojas
  language plpgsql security definer set search_path = public as $$
declare l public.lojas;
begin
  if auth.uid() is null then raise exception 'não autenticado'; end if;
  perform pg_advisory_xact_lock(hashtext('criar_loja:' || auth.uid()::text));
  select lo.* into l from public.lojas lo join public.membros m on m.loja_id = lo.id
   where m.user_id = auth.uid() and m.papel = 'dono' order by lo.criado_em limit 1;
  if found then return l; end if;
  insert into public.lojas(nome) values (coalesce(nullif(trim(p_nome), ''), 'Minha Loja')) returning * into l;
  insert into public.membros(loja_id, user_id, email, papel) values (l.id, auth.uid(), auth.jwt() ->> 'email', 'dono');
  return l;
end $$;
revoke all on function public.criar_loja(text) from public, anon;
grant execute on function public.criar_loja(text) to authenticated;
