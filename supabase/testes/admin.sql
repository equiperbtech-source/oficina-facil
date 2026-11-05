-- TESTE DO PAINEL ADMIN (etapa 7). Seguro: usuários e loja fictícios, apagados no final.
-- Use no Supabase de TESTE. Esperado: tudo "PASSOU".
create temp table if not exists _res (ordem serial, teste text, resultado text);
truncate _res;
grant all on _res to authenticated; grant usage on sequence _res_ordem_seq to authenticated;

do $$
declare adm uuid := gen_random_uuid(); dono uuid := gen_random_uuid(); intruso uuid := gen_random_uuid(); loja uuid; r jsonb; n int; aud0 bigint;
begin
  insert into auth.users(id, email) values (adm, 'adm-' || adm || '@exemplo.invalid'), (dono, 'dono-' || dono || '@exemplo.invalid'), (intruso, 'x-' || intruso || '@exemplo.invalid');
  select count(*) into aud0 from public.admin_auditoria;
  perform set_config('request.jwt.claims', json_build_object('sub', dono, 'role', 'authenticated', 'email', 'dono@exemplo.invalid')::text, true);
  perform set_config('request.jwt.claim.sub', dono::text, true);
  loja := (public.criar_loja('Loja Admin Teste')).id;
  insert into public.itens(loja_id, colecao, id, dados) values (loja, 'clientes', 'c1', '{"nome":"Cliente"}');

  -- quem não é admin não acessa nada
  perform set_config('request.jwt.claim.sub', intruso::text, true);
  perform set_config('role', 'authenticated', true);
  begin perform public.admin_resumo(); insert into _res(teste, resultado) values ('Não-admin não vê o painel', 'FALHOU');
  exception when insufficient_privilege then insert into _res(teste, resultado) values ('Não-admin não vê o painel', 'PASSOU'); end;
  begin perform public.admin_alterar_plano(loja, 'pro_max', 'x'); insert into _res(teste, resultado) values ('Não-admin não altera plano', 'FALHOU');
  exception when insufficient_privilege then insert into _res(teste, resultado) values ('Não-admin não altera plano', 'PASSOU'); end;
  insert into _res(teste, resultado) values ('sou_super_admin() = falso para não-admin', case when not public.sou_super_admin() then 'PASSOU' else 'FALHOU' end);

  -- admin
  perform set_config('role', 'postgres', true);
  insert into public.super_admins(user_id) values (adm);
  perform set_config('request.jwt.claim.sub', adm::text, true);
  perform set_config('role', 'authenticated', true);
  r := public.admin_resumo();
  insert into _res(teste, resultado) values ('Admin vê o resumo (lojas, MRR, notas)', case when (r ->> 'lojas')::int >= 2 and r ? 'mrr' then 'PASSOU' else 'FALHOU' end);
  r := public.admin_lojas('Admin Teste', null, null, 'nome', 10, 0);
  insert into _res(teste, resultado) values ('Busca de lojas encontra a loja', case when (r ->> 'total')::int = 1 and r #>> '{lojas,0,dono_email}' like 'dono%' then 'PASSOU' else 'FALHOU' end);
  perform public.admin_alterar_plano(loja, 'essencial', 'teste');
  perform public.admin_cortesia(loja, 10, 'cortesia de teste');
  r := public.admin_loja(loja);
  insert into _res(teste, resultado) values ('Alterar plano e dar cortesia', case when r #>> '{loja,plano_id}' = 'essencial' and (r #>> '{loja,cortesia_ate}')::timestamptz > now() + interval '9 days' then 'PASSOU' else 'FALHOU' end);
  perform public.admin_bloquear(loja, true, 'teste');
  insert into _res(teste, resultado) values ('Bloquear', case when public.loja_situacao(loja) = 'bloqueada' then 'PASSOU' else 'FALHOU' end);
  perform public.admin_bloquear(loja, false, 'teste');
  insert into _res(teste, resultado) values ('Reativar', case when public.loja_situacao(loja) = 'ativa' then 'PASSOU' else 'FALHOU' end);
  n := public.admin_creditar(loja, 5, 'bônus');
  insert into _res(teste, resultado) values ('Adicionar créditos de notas', case when n = 5 then 'PASSOU' else 'FALHOU' end);
  -- entrar como a loja: lê, mas não grava
  perform public.admin_entrar_como(loja, 'ajudar o cliente');
  insert into _res(teste, resultado) values ('Suporte vê os dados da loja', case when (select count(*) from public.itens where loja_id = loja and colecao = 'clientes') = 1 then 'PASSOU' else 'FALHOU' end);
  begin
    insert into public.itens(loja_id, colecao, id, dados) values (loja, 'clientes', 'c-suporte', '{}');
    insert into _res(teste, resultado) values ('Suporte NÃO grava (somente leitura)', 'FALHOU');
  exception when others then insert into _res(teste, resultado) values ('Suporte NÃO grava (somente leitura)', 'PASSOU');
  end;
  insert into _res(teste, resultado) values ('Suporte não conta como funcionário', case when public.funcionarios_ativos(loja) = 0 then 'PASSOU' else 'FALHOU' end);
  perform set_config('role', 'postgres', true);
  update public.membros set expira_em = now() - interval '1 minute' where loja_id = loja and user_id = adm;
  perform set_config('role', 'authenticated', true);
  insert into _res(teste, resultado) values ('Acesso de suporte expira sozinho', case when (select count(*) from public.itens where loja_id = loja) = 0 then 'PASSOU' else 'FALHOU' end);
  r := public.admin_auditoria_lista(50, 0);
  perform set_config('role', 'postgres', true);
  insert into _res(teste, resultado) values ('Toda ação ficou na auditoria (6 registros)', case when (select count(*) from public.admin_auditoria) - aud0 = 6 then 'PASSOU' else 'FALHOU: ' || ((select count(*) from public.admin_auditoria) - aud0) end);
  insert into _res(teste, resultado) values ('Auditoria guarda antes e depois', case when exists (select 1 from public.admin_auditoria where loja_id = loja and acao = 'alterar_plano' and antes ->> 'plano' = 'pro' and depois ->> 'plano' = 'essencial') then 'PASSOU' else 'FALHOU' end);

  -- limpeza
  delete from public.admin_auditoria where ator = adm;
  delete from public.lojas where id = loja;
  delete from public.super_admins where user_id = adm;
  delete from auth.users where id in (adm, dono, intruso);
end $$;

select ordem, teste, resultado from _res order by ordem;
