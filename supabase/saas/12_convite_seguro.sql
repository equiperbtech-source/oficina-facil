-- =====================================================================
-- SaaS · Etapa 12: código de convite seguro
-- Antes: quem digitasse o código entrava NA HORA como funcionário (sem o dono aprovar) e, se tivesse
-- uma loja própria só com ele, essa loja era APAGADA e os dados copiados para a loja do código.
-- Agora:
--   * o código só envia um PEDIDO para entrar; a pessoa não vê nada até o dono aprovar em Equipe;
--   * nenhuma loja é apagada nem tem dados copiados ao entrar em outra equipe;
--   * no máximo 10 tentativas de código por hora para cada conta (impede adivinhar no chute);
--   * códigos novos mais longos (10 caracteres) e todos os códigos atuais são trocados agora.
-- ADITIVA. Reverter: 12_convite_seguro_reverter.sql
-- =====================================================================

alter table public.membros add column if not exists pendente boolean not null default false;
alter table public.membros add column if not exists pedido_em timestamptz;

create table if not exists public.convite_tentativas (
  id bigserial primary key,
  user_id uuid not null,
  em timestamptz not null default now(),
  acertou boolean not null default false
);
create index if not exists convite_tentativas_user_idx on public.convite_tentativas(user_id, em desc);
alter table public.convite_tentativas enable row level security;
revoke all on public.convite_tentativas from anon, authenticated;

-- código de 10 caracteres sem letras/números que se confundem (0/O, 1/I/L)
create or replace function public.gerar_codigo_convite() returns text
  language plpgsql volatile set search_path = public as $$
declare abc text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; c text; b bytea := uuid_send(gen_random_uuid()); i int;
begin
  loop
    c := '';
    for i in 0..9 loop c := c || substr(abc, 1 + (get_byte(b, i) % length(abc)), 1); end loop;
    exit when not exists (select 1 from public.lojas where codigo_convite = c);
    b := uuid_send(gen_random_uuid());
  end loop;
  return c;
end $$;
revoke all on function public.gerar_codigo_convite() from public, anon, authenticated;

-- Pedir para entrar na equipe com o código: fica PENDENTE até o dono aprovar
drop function if exists public.entrar_na_loja(text);
create function public.entrar_na_loja(p_codigo text) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare l public.lojas; m public.membros; uid uuid := auth.uid();
begin
  if uid is null then raise exception 'não autenticado'; end if;
  if (select count(*) from public.convite_tentativas where user_id = uid and em > now() - interval '1 hour') >= 10 then
    raise exception 'Muitas tentativas com código de convite. Aguarde 1 hora ou peça ao dono para adicionar você pelo e-mail.';
  end if;
  select * into l from public.lojas where codigo_convite = upper(regexp_replace(coalesce(p_codigo, ''), '\s', '', 'g'));
  insert into public.convite_tentativas(user_id, acertou) values (uid, found);
  -- código errado: responde sem erro, para a tentativa ficar registrada (um erro desfaria o registro)
  if l.id is null then return jsonb_build_object('situacao', 'invalido'); end if;

  select * into m from public.membros where loja_id = l.id and user_id = uid;
  if m.user_id is not null and m.ativo and (m.expira_em is null or m.expira_em > now()) then
    return jsonb_build_object('nome', l.nome, 'situacao', 'membro');
  end if;
  insert into public.membros(loja_id, user_id, email, papel, ativo, pendente, pedido_em)
  values (l.id, uid, auth.jwt() ->> 'email', 'atendente', false, true, now())
  on conflict (loja_id, user_id) do update set pendente = true, pedido_em = now()
    where public.membros.ativo = false and public.membros.papel in ('membro', 'atendente', 'tecnico');
  return jsonb_build_object('nome', l.nome, 'situacao', 'pendente');
end $$;
revoke all on function public.entrar_na_loja(text) from public, anon;
grant execute on function public.entrar_na_loja(text) to authenticated;

-- Pedidos que eu fiz e ainda aguardam aprovação (tela de quem ainda não tem loja)
create or replace function public.meus_pedidos_pendentes() returns jsonb
  language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('nome', l.nome, 'pedido_em', m.pedido_em) order by m.pedido_em desc), '[]'::jsonb)
    from public.membros m join public.lojas l on l.id = m.loja_id
   where m.user_id = auth.uid() and m.pendente and not m.ativo
$$;
revoke all on function public.meus_pedidos_pendentes() from public, anon;
grant execute on function public.meus_pedidos_pendentes() to authenticated;

-- Dono aprova (ativa) ou desativa: aprovar tira o "pendente"
create or replace function public.definir_membro_ativo(p_loja uuid, p_user uuid, p_ativo boolean) returns void
  language plpgsql security definer set search_path = public as $$
begin
  if not public.sou_dono(p_loja) then raise exception 'apenas o dono pode ativar ou desativar'; end if;
  if exists (select 1 from public.membros where loja_id = p_loja and user_id = p_user and papel in ('dono', 'suporte')) then raise exception 'não se aplica a este acesso'; end if;
  if p_ativo and not exists (select 1 from public.membros where loja_id = p_loja and user_id = p_user and ativo) then perform public.checar_vaga(p_loja); end if;
  update public.membros set ativo = p_ativo, pendente = false, desativado_em = case when p_ativo then null else now() end
   where loja_id = p_loja and user_id = p_user;
end $$;

-- Dono adiciona funcionário pelo e-mail: não apaga mais a loja própria da pessoa
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
    on conflict (loja_id, user_id) do update set nome = coalesce(excluded.nome, public.membros.nome), ativo = true, pendente = false, desativado_em = null;
  return jsonb_build_object('user_id', u.id, 'confirmado', u.email_confirmed_at is not null);
end $$;

-- Novo código (só o dono): 10 caracteres
create or replace function public.novo_codigo_convite(p_loja uuid) returns text
  language plpgsql security definer set search_path = public as $$
declare c text := public.gerar_codigo_convite();
begin
  if not public.sou_dono(p_loja) then raise exception 'apenas o dono pode fazer isso'; end if;
  update public.lojas set codigo_convite = c where id = p_loja;
  return c;
end $$;
revoke all on function public.novo_codigo_convite(uuid) from public, anon;
grant execute on function public.novo_codigo_convite(uuid) to authenticated;

-- lojas novas já nascem com o código longo
alter table public.lojas alter column codigo_convite set default public.gerar_codigo_convite();

-- troca TODOS os códigos atuais (os antigos podem ter vazado); só uma vez
do $$ declare r record; begin
  if not exists (select 1 from public.plataforma_config where chave = 'codigos_convite_trocados') then
    for r in select id from public.lojas loop
      update public.lojas set codigo_convite = public.gerar_codigo_convite() where id = r.id;
    end loop;
    insert into public.plataforma_config(chave, valor) values ('codigos_convite_trocados', to_jsonb(now()));
  end if;
end $$;

-- Dono: quantos pedidos de entrada esperam aprovação (aviso no topo do app)
create or replace function public.pedidos_equipe(p_loja uuid) returns int
  language sql stable security definer set search_path = public as $$
  select case when public.sou_dono(p_loja) then (select count(*)::int from public.membros where loja_id = p_loja and pendente and not ativo) else 0 end
$$;
revoke all on function public.pedidos_equipe(uuid) from public, anon;
grant execute on function public.pedidos_equipe(uuid) to authenticated;
