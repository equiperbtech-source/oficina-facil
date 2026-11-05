-- TESTE DAS REGRAS DE PLANO, SITUAÇÃO, PAPÉIS E LIMITES (etapa 2)
-- Seguro: cria lojas e usuários fictícios e apaga tudo no final. Não toca na loja 1.
-- Use no Supabase de TESTE. Resultado esperado: todas as linhas "PASSOU".
create temp table if not exists _res (ordem serial, teste text, resultado text);
truncate _res;
grant all on _res to authenticated; grant usage on sequence _res_ordem_seq to authenticated;

do $$
declare
  dono uuid := gen_random_uuid(); f1 uuid := gen_random_uuid(); f2 uuid := gen_random_uuid(); f3 uuid := gen_random_uuid(); tec uuid := gen_random_uuid();
  loja uuid; n int; ok boolean; itens1 bigint;
  procedure_dummy int;
begin
  select count(*) into itens1 from public.itens where loja_id = (select id from public.lojas order by criado_em limit 1);
  insert into auth.users(id, email) values (dono, 'dono-' || dono || '@exemplo.invalid'), (f1, 'f1-' || f1 || '@exemplo.invalid'),
    (f2, 'f2-' || f2 || '@exemplo.invalid'), (f3, 'f3-' || f3 || '@exemplo.invalid'), (tec, 'tec-' || tec || '@exemplo.invalid');

  -- ===== loja nova nasce no teste do Pro =====
  perform set_config('request.jwt.claims', json_build_object('sub', dono, 'role', 'authenticated', 'email', 'dono@exemplo.invalid')::text, true);
  perform set_config('request.jwt.claim.sub', dono::text, true);
  perform set_config('role', 'authenticated', true);
  loja := (public.criar_loja('Loja Teste Planos')).id;
  insert into _res(teste, resultado) values ('Loja nova nasce no teste do Pro',
    case when (public.minha_assinatura(loja) ->> 'situacao') = 'teste' and (public.minha_assinatura(loja) ->> 'plano') = 'pro' then 'PASSOU' else 'FALHOU' end);
  insert into _res(teste, resultado) values ('Loja nova nasce vazia', case when (select count(*) from public.itens where loja_id = loja) = 0 then 'PASSOU' else 'FALHOU' end);
  insert into _res(teste, resultado) values ('Teste do Pro libera follow-up e metas',
    case when public.tem_recurso(loja, 'followup') and public.tem_recurso(loja, 'metas') then 'PASSOU' else 'FALHOU' end);
  insert into _res(teste, resultado) values ('Teste do Pro NÃO libera a vitrine (etapa 9)', case when not public.tem_recurso(loja, 'vitrine') then 'PASSOU' else 'FALHOU' end);
  insert into _res(teste, resultado) values ('Teste do Pro NÃO libera nota fiscal', case when not public.tem_recurso(loja, 'nota_fiscal') then 'PASSOU' else 'FALHOU' end);
  insert into public.itens(loja_id, colecao, id, dados) values (loja, 'clientes', 'c1', '{"nome":"Cliente"}');
  insert into _res(teste, resultado) values ('No teste a loja grava normalmente', 'PASSOU');
  begin
    update public.lojas set plano_id = 'pro_max', status_assinatura = 'ativa', isenta = true where id = loja;
    get diagnostics n = row_count;
    insert into _res(teste, resultado) values ('Dono NÃO consegue mudar o próprio plano pelo app', case when n = 0 then 'PASSOU' else 'FALHOU' end);
  exception when others then insert into _res(teste, resultado) values ('Dono NÃO consegue mudar o próprio plano pelo app', 'PASSOU');
  end;

  -- ===== Essencial: limite de 2 funcionários (o dono não conta) =====
  perform set_config('role', 'postgres', true);
  update public.lojas set plano_id = 'essencial', status_assinatura = 'ativa', teste_ate = null where id = loja;
  perform set_config('role', 'authenticated', true);
  perform public.adicionar_funcionario(loja, 'f1-' || f1 || '@exemplo.invalid', 'F1');
  perform public.adicionar_funcionario(loja, 'f2-' || f2 || '@exemplo.invalid', 'F2');
  insert into _res(teste, resultado) values ('Essencial aceita dono + 2 funcionários', case when public.funcionarios_ativos(loja) = 2 then 'PASSOU' else 'FALHOU' end);
  begin
    perform public.adicionar_funcionario(loja, 'f3-' || f3 || '@exemplo.invalid', 'F3');
    insert into _res(teste, resultado) values ('Essencial bloqueia o 3º funcionário', 'FALHOU');
  exception when others then insert into _res(teste, resultado) values ('Essencial bloqueia o 3º funcionário', 'PASSOU');
  end;
  perform public.definir_membro_ativo(loja, f2, false);
  perform public.adicionar_funcionario(loja, 'f3-' || f3 || '@exemplo.invalid', 'F3');
  insert into _res(teste, resultado) values ('Desativar alguém libera a vaga (sem apagar)',
    case when public.funcionarios_ativos(loja) = 2 and exists (select 1 from public.membros where loja_id = loja and user_id = f2 and not ativo) then 'PASSOU' else 'FALHOU' end);
  begin
    perform public.definir_membro_ativo(loja, f2, true);
    insert into _res(teste, resultado) values ('Reativar acima do limite é bloqueado', 'FALHOU');
  exception when others then insert into _res(teste, resultado) values ('Reativar acima do limite é bloqueado', 'PASSOU');
  end;

  -- funcionário desativado perde o acesso
  perform set_config('request.jwt.claims', json_build_object('sub', f2, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', f2::text, true);
  insert into _res(teste, resultado) values ('Funcionário desativado não vê mais a loja',
    case when (select count(*) from public.itens where loja_id = loja) = 0 then 'PASSOU' else 'FALHOU' end);

  -- ===== Papéis =====
  perform set_config('request.jwt.claims', json_build_object('sub', dono, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', dono::text, true);
  insert into public.itens(loja_id, colecao, id, dados) values (loja, 'lancamentos', 'l1', '{"valor":10}'), (loja, 'vendas', 'v1', '{"total":10}');
  perform public.definir_papel(loja, f3, 'tecnico');
  perform set_config('request.jwt.claims', json_build_object('sub', f3, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', f3::text, true);
  insert into _res(teste, resultado) values ('Técnico vê clientes', case when (select count(*) from public.itens where loja_id = loja and colecao = 'clientes') = 1 then 'PASSOU' else 'FALHOU' end);
  insert into _res(teste, resultado) values ('Técnico NÃO vê o financeiro', case when (select count(*) from public.itens where loja_id = loja and colecao = 'lancamentos') = 0 then 'PASSOU' else 'FALHOU' end);
  begin
    insert into public.itens(loja_id, colecao, id, dados) values (loja, 'vendas', 'v-tec', '{}');
    insert into _res(teste, resultado) values ('Técnico NÃO registra venda', 'FALHOU');
  exception when others then insert into _res(teste, resultado) values ('Técnico NÃO registra venda', 'PASSOU');
  end;
  insert into public.itens(loja_id, colecao, id, dados) values (loja, 'os', 'os-tec', '{"status":"analise"}');
  insert into _res(teste, resultado) values ('Técnico grava OS', 'PASSOU');
  delete from public.itens where loja_id = loja and colecao = 'clientes';
  get diagnostics n = row_count;
  insert into _res(teste, resultado) values ('Técnico NÃO apaga registros', case when n = 0 then 'PASSOU' else 'FALHOU' end);
  begin
    insert into public.itens(loja_id, colecao, id, dados) values (loja, 'meta', 'settings', '{"loja":"hack"}');
    insert into _res(teste, resultado) values ('Funcionário NÃO altera configurações', 'FALHOU');
  exception when others then insert into _res(teste, resultado) values ('Funcionário NÃO altera configurações', 'PASSOU');
  end;
  -- atendente (F1) vê financeiro e vende
  perform set_config('request.jwt.claims', json_build_object('sub', f1, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', f1::text, true);
  insert into public.itens(loja_id, colecao, id, dados) values (loja, 'vendas', 'v-at', '{"total":5}');
  insert into _res(teste, resultado) values ('Atendente registra venda', 'PASSOU');

  -- ===== Recursos por plano: Essencial não grava follow-up/metas por funcionário =====
  begin
    insert into public.itens(loja_id, colecao, id, dados) values (loja, 'followups', 'fu1', '{}');
    insert into _res(teste, resultado) values ('Essencial NÃO grava follow-up (só Pro)', 'FALHOU');
  exception when others then insert into _res(teste, resultado) values ('Essencial NÃO grava follow-up (só Pro)', 'PASSOU');
  end;
  insert into public.itens(loja_id, colecao, id, dados) values (loja, 'lotes', 'lote1', '{}');
  insert into _res(teste, resultado) values ('Essencial grava lotes', 'PASSOU');

  -- ===== Situação: inadimplente com tolerância, depois somente leitura =====
  perform set_config('role', 'postgres', true);
  update public.lojas set status_assinatura = 'inadimplente', inadimplente_desde = now() - interval '2 days' where id = loja;
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', dono, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', dono::text, true);
  insert into public.itens(loja_id, colecao, id, dados) values (loja, 'clientes', 'c2', '{}');
  insert into _res(teste, resultado) values ('Inadimplente dentro da tolerância ainda grava', 'PASSOU');
  perform set_config('role', 'postgres', true);
  update public.lojas set inadimplente_desde = now() - interval '6 days' where id = loja;
  perform set_config('role', 'authenticated', true);
  insert into _res(teste, resultado) values ('Depois da tolerância vira somente leitura', case when public.loja_situacao(loja) = 'somente_leitura' then 'PASSOU' else 'FALHOU' end);
  begin
    insert into public.itens(loja_id, colecao, id, dados) values (loja, 'clientes', 'c3', '{}');
    insert into _res(teste, resultado) values ('Somente leitura bloqueia gravação', 'FALHOU');
  exception when others then insert into _res(teste, resultado) values ('Somente leitura bloqueia gravação', 'PASSOU');
  end;
  insert into _res(teste, resultado) values ('Somente leitura continua mostrando os dados',
    case when (select count(*) from public.itens where loja_id = loja and colecao = 'clientes') = 2 then 'PASSOU' else 'FALHOU' end);

  -- ===== Teste expirado e cancelada =====
  perform set_config('role', 'postgres', true);
  update public.lojas set status_assinatura = 'teste', plano_id = 'pro', teste_ate = now() - interval '1 day' where id = loja;
  insert into _res(teste, resultado) values ('Teste vencido: sem plano, dados preservados, sem recursos pagos',
    case when public.loja_situacao(loja) = 'expirada' and not public.tem_recurso(loja, 'followup') and not public.pode_escrever(loja)
         and (select count(*) from public.itens where loja_id = loja) > 0 then 'PASSOU' else 'FALHOU' end);
  update public.lojas set status_assinatura = 'cancelada', plano_id = 'pro', periodo_pago_ate = now() + interval '10 days' where id = loja;
  insert into _res(teste, resultado) values ('Cancelada mantém acesso até o fim do período pago',
    case when public.pode_escrever(loja) and public.tem_recurso(loja, 'followup') then 'PASSOU' else 'FALHOU' end);
  update public.lojas set periodo_pago_ate = now() - interval '1 day' where id = loja;
  insert into _res(teste, resultado) values ('Cancelada após o período: sem plano e só leitura',
    case when not public.pode_escrever(loja) and public.loja_plano(loja) is null then 'PASSOU' else 'FALHOU' end);
  update public.lojas set status_assinatura = 'bloqueada' where id = loja;
  insert into _res(teste, resultado) values ('Bloqueada não grava', case when not public.pode_escrever(loja) then 'PASSOU' else 'FALHOU' end);

  -- ===== Downgrade com excesso de funcionários =====
  update public.lojas set status_assinatura = 'ativa', plano_id = 'pro' where id = loja;
  update public.membros set ativo = true where loja_id = loja; -- 3 ativos no Pro
  update public.lojas set plano_id = 'essencial' where id = loja;
  n := public.ajustar_ao_plano(loja);
  insert into _res(teste, resultado) values ('Downgrade: desativa o excedente sem apagar (ficam os mais antigos)',
    case when n = 1 and public.funcionarios_ativos(loja) = 2 and (select count(*) from public.membros where loja_id = loja) = 4 then 'PASSOU' else 'FALHOU' end);

  -- ===== Loja 1 intacta =====
  insert into _res(teste, resultado) values ('Loja 1 continua isenta e no Pro Max',
    case when public.loja_situacao((select id from public.lojas order by criado_em limit 1)) = 'ativa'
          and public.tem_recurso((select id from public.lojas order by criado_em limit 1), 'nota_fiscal') then 'PASSOU' else 'FALHOU' end);

  -- limpeza
  delete from public.lojas where id = loja;
  delete from auth.users where id in (dono, f1, f2, f3, tec);
  insert into _res(teste, resultado) values ('Limpeza: loja 1 com o mesmo número de registros',
    case when (select count(*) from public.itens where loja_id = (select id from public.lojas order by criado_em limit 1)) = itens1 then 'PASSOU' else 'FALHOU' end);
end $$;

select ordem, teste, resultado from _res order by ordem;
