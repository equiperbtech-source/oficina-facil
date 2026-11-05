-- Reverte a etapa 12 (o código volta a dar acesso direto; NÃO recomendado)
drop function if exists public.meus_pedidos_pendentes();
drop function if exists public.pedidos_equipe(uuid);
drop function if exists public.entrar_na_loja(text);
create function public.entrar_na_loja(p_codigo text) returns public.lojas
  language plpgsql security definer set search_path = public as $$
declare l public.lojas;
begin
  if auth.uid() is null then raise exception 'não autenticado'; end if;
  select * into l from public.lojas where codigo_convite = upper(trim(p_codigo));
  if not found then raise exception 'Código de convite inválido'; end if;
  if not exists (select 1 from public.membros where loja_id = l.id and user_id = auth.uid()) then
    perform public.checar_vaga(l.id);
  end if;
  insert into public.membros(loja_id, user_id, email, papel) values (l.id, auth.uid(), auth.jwt() ->> 'email', 'atendente')
    on conflict (loja_id, user_id) do nothing;
  perform public.unir_loja_solo(auth.uid(), l.id);
  return l;
end $$;
revoke all on function public.entrar_na_loja(text) from public, anon;
grant execute on function public.entrar_na_loja(text) to authenticated;

create or replace function public.definir_membro_ativo(p_loja uuid, p_user uuid, p_ativo boolean) returns void
  language plpgsql security definer set search_path = public as $$
begin
  if not public.sou_dono(p_loja) then raise exception 'apenas o dono pode ativar ou desativar'; end if;
  if exists (select 1 from public.membros where loja_id = p_loja and user_id = p_user and papel in ('dono', 'suporte')) then raise exception 'não se aplica a este acesso'; end if;
  if p_ativo and not exists (select 1 from public.membros where loja_id = p_loja and user_id = p_user and ativo) then perform public.checar_vaga(p_loja); end if;
  update public.membros set ativo = p_ativo, desativado_em = case when p_ativo then null else now() end where loja_id = p_loja and user_id = p_user;
end $$;

create or replace function public.adicionar_funcionario(p_loja uuid, p_email text, p_nome text) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare u record; ja boolean;
begin
  if not public.sou_dono(p_loja) then raise exception 'apenas o dono pode adicionar funcionários'; end if;
  select id, email, email_confirmed_at into u from auth.users where lower(email) = lower(trim(p_email)) limit 1;
  if not found then raise exception 'Conta não encontrada para este e-mail'; end if;
  select exists(select 1 from public.membros where loja_id = p_loja and user_id = u.id and ativo) into ja;
  if not ja then perform public.checar_vaga(p_loja); end if;
  insert into public.membros(loja_id, user_id, email, nome, papel) values (p_loja, u.id, u.email, nullif(trim(p_nome), ''), 'atendente')
    on conflict (loja_id, user_id) do update set nome = coalesce(excluded.nome, public.membros.nome), ativo = true, desativado_em = null;
  perform public.unir_loja_solo(u.id, p_loja);
  return jsonb_build_object('user_id', u.id, 'confirmado', u.email_confirmed_at is not null);
end $$;

create or replace function public.novo_codigo_convite(p_loja uuid) returns text
  language plpgsql security definer set search_path = public as $$
declare c text;
begin
  if not public.sou_dono(p_loja) then raise exception 'apenas o dono pode fazer isso'; end if;
  c := upper(substr(md5(gen_random_uuid()::text), 1, 8));
  update public.lojas set codigo_convite = c where id = p_loja;
  return c;
end $$;

alter table public.lojas alter column codigo_convite set default upper(substr(md5(gen_random_uuid()::text), 1, 8));
-- (as colunas membros.pendente/pedido_em e a tabela convite_tentativas ficam; não atrapalham)
