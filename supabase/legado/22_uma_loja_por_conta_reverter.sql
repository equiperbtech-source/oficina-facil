-- Reverte a etapa 22: criar_loja volta a criar sempre uma loja nova.
create or replace function public.criar_loja(p_nome text) returns public.lojas
  language plpgsql security definer set search_path = public as $$
declare l public.lojas;
begin
  if auth.uid() is null then raise exception 'não autenticado'; end if;
  insert into public.lojas(nome) values (coalesce(nullif(trim(p_nome), ''), 'Minha Loja')) returning * into l;
  insert into public.membros(loja_id, user_id, email, papel) values (l.id, auth.uid(), auth.jwt() ->> 'email', 'dono');
  return l;
end $$;
