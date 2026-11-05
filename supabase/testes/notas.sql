-- TESTE DAS NOTAS FISCAIS (etapa 5): franquia, créditos, consumo só na autorização, ordem, devolução e alertas.
-- Seguro: loja fictícia, apagada no final. Use no Supabase de TESTE. Esperado: tudo "PASSOU".
create temp table if not exists _res (ordem serial, teste text, resultado text);
truncate _res;
grant all on _res to authenticated; grant usage on sequence _res_ordem_seq to authenticated;

do $$
declare dono uuid := gen_random_uuid(); tec uuid := gen_random_uuid(); loja uuid; r jsonb; v_ref text; refs text[] := '{}'; s jsonb; i int; ok boolean;
begin
  insert into auth.users(id, email) values (dono, 'nf-' || dono || '@exemplo.invalid'), (tec, 'tec-' || tec || '@exemplo.invalid');
  perform set_config('request.jwt.claims', json_build_object('sub', dono, 'role', 'authenticated', 'email', 'nf@exemplo.invalid')::text, true);
  perform set_config('request.jwt.claim.sub', dono::text, true);
  loja := (public.criar_loja('Loja Notas')).id;

  -- no teste do Pro: sem nota fiscal
  begin
    perform public.reservar_nota(loja, 'nfse', null, '{}', 'Serviço', 100);
    insert into _res(teste, resultado) values ('Sem Pro Max não emite', 'FALHOU');
  exception when others then insert into _res(teste, resultado) values ('Sem Pro Max não emite', case when sqlerrm like '%Pro Max%' then 'PASSOU' else 'FALHOU: ' || sqlerrm end);
  end;
  update public.lojas set plano_id = 'pro_max', status_assinatura = 'ativa' where id = loja;
  begin
    perform public.reservar_nota(loja, 'nfse', null, '{}', 'Serviço', 100);
    insert into _res(teste, resultado) values ('Sem cadastro fiscal não emite', 'FALHOU');
  exception when others then insert into _res(teste, resultado) values ('Sem cadastro fiscal não emite', 'PASSOU');
  end;
  perform public.salvar_cadastro_fiscal(loja, '{"cnpj":"12.345.678/0001-90","razao_social":"Loja Notas","regime":"simples","codigo_servico":"14.01"}');
  insert into _res(teste, resultado) values ('Cadastro fiscal salvo (CNPJ só números)', case when (select cnpj from public.lojas_fiscal where loja_id = loja) = '12345678000190' then 'PASSOU' else 'FALHOU' end);

  -- reserva não consome; rejeição devolve
  r := public.reservar_nota(loja, 'nfse', 'os1', '{"nome":"Cliente"}', 'Troca de tela', 250); v_ref := r #>> '{nota,ref}';
  s := public.saldo_notas(loja);
  insert into _res(teste, resultado) values ('Reserva não consome (usadas 0, reservadas 1)', case when (s ->> 'usadas')::int = 0 and (s ->> 'reservadas')::int = 1 then 'PASSOU' else 'FALHOU' end);
  perform public.liberar_nota(v_ref, 'rejeitada', 'CNPJ do tomador inválido');
  s := public.saldo_notas(loja);
  insert into _res(teste, resultado) values ('Rejeitada devolve a reserva (40 disponíveis)', case when (s ->> 'disponivel')::int = 40 and (s ->> 'usadas')::int = 0 then 'PASSOU' else 'FALHOU' end);

  -- 40 autorizadas consomem a franquia; alertas 80% (32ª) e 100% (40ª)
  for i in 1..40 loop
    r := public.reservar_nota(loja, 'nfse', 'os' || i, '{}', 'Serviço ' || i, 100);
    s := public.confirmar_nota(r #>> '{nota,ref}', i::text, null, null, 'simulado');
    if i = 32 then insert into _res(teste, resultado) values ('Alerta de 80% na 32ª nota', case when s ->> 'alerta' = '80' then 'PASSOU' else 'FALHOU: ' || coalesce(s ->> 'alerta', 'sem alerta') end); end if;
    if i = 40 then insert into _res(teste, resultado) values ('Alerta de 100% na 40ª nota', case when s ->> 'alerta' = '100' then 'PASSOU' else 'FALHOU' end); end if;
  end loop;
  s := public.saldo_notas(loja);
  insert into _res(teste, resultado) values ('40 autorizadas = franquia esgotada', case when (s ->> 'usadas')::int = 40 and (s ->> 'disponivel')::int = 0 then 'PASSOU' else 'FALHOU' end);
  insert into _res(teste, resultado) values ('Avisos no sistema criados (80% e 100%)', case when (select count(*) from public.avisos_loja where loja_id = loja) = 2 then 'PASSOU' else 'FALHOU' end);
  -- confirmar a mesma nota de novo não consome de novo
  s := public.confirmar_nota(r #>> '{nota,ref}', '40', null, null, 'simulado');
  insert into _res(teste, resultado) values ('Confirmação repetida não consome de novo', case when (s ->> 'repetido')::boolean and (public.saldo_notas(loja) ->> 'usadas')::int = 40 then 'PASSOU' else 'FALHOU' end);

  -- esgotado: bloqueia; com créditos comprados, usa créditos
  begin
    perform public.reservar_nota(loja, 'nfse', null, '{}', 'Mais uma', 50);
    insert into _res(teste, resultado) values ('Franquia esgotada sem créditos: bloqueia', 'FALHOU');
  exception when others then insert into _res(teste, resultado) values ('Franquia esgotada sem créditos: bloqueia', case when sqlerrm like 'SEM_SALDO%' then 'PASSOU' else 'FALHOU: ' || sqlerrm end);
  end;
  perform set_config('role', 'postgres', true);
  perform public.creditar_notas(loja, 3, 'compra', 'evento-1');
  perform public.creditar_notas(loja, 3, 'compra', 'evento-1');   -- repetido: não credita de novo
  insert into _res(teste, resultado) values ('Créditos comprados entram uma vez só (3)', case when (select saldo from public.creditos where loja_id = loja) = 3 then 'PASSOU' else 'FALHOU' end);
  perform set_config('role', 'authenticated', true);
  r := public.reservar_nota(loja, 'nfse', null, '{}', 'Com crédito', 80);
  insert into _res(teste, resultado) values ('Depois da franquia, usa crédito', case when r #>> '{nota,reserva_origem}' = 'credito' then 'PASSOU' else 'FALHOU' end);
  perform set_config('role', 'postgres', true);
  perform public.confirmar_nota(r #>> '{nota,ref}', '41', null, null, 'simulado');
  insert into _res(teste, resultado) values ('Crédito consumido só na autorização (sobram 2)', case when (select saldo from public.creditos where loja_id = loja) = 2 then 'PASSOU' else 'FALHOU' end);
  -- reembolso do pacote: tira só o não usado
  i := public.estornar_creditos(loja, 3, 'evento-1-reemb');
  insert into _res(teste, resultado) values ('Reembolso do pacote tira só os créditos não usados (2)', case when i = 2 and (select saldo from public.creditos where loja_id = loja) = 0 then 'PASSOU' else 'FALHOU' end);
  -- cancelamento de autorizada continua consumindo
  perform public.cancelar_nota_registro(r #>> '{nota,ref}');
  insert into _res(teste, resultado) values ('Nota cancelada continua consumindo', case when (select status from public.notas_fiscais where notas_fiscais.ref = r #>> '{nota,ref}') = 'cancelada' and (select count(*) from public.consumo_notas where loja_id = loja) = 41 then 'PASSOU' else 'FALHOU' end);
  -- o app não credita notas sozinho
  perform set_config('role', 'authenticated', true);
  begin
    perform public.creditar_notas(loja, 1, 'admin', null);
    insert into _res(teste, resultado) values ('App não credita notas sozinho', 'FALHOU');
  exception when insufficient_privilege then insert into _res(teste, resultado) values ('App não credita notas sozinho', 'PASSOU');
  end;
  perform set_config('role', 'postgres', true);
  -- técnico não emite
  insert into public.membros(loja_id, user_id, email, papel) values (loja, tec, 'tec', 'tecnico');
  perform set_config('request.jwt.claims', json_build_object('sub', tec, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', tec::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    perform public.reservar_nota(loja, 'nfse', null, '{}', 'x', 10);
    insert into _res(teste, resultado) values ('Técnico não emite nota', 'FALHOU');
  exception when others then insert into _res(teste, resultado) values ('Técnico não emite nota', 'PASSOU');
  end;
  insert into _res(teste, resultado) values ('Técnico não vê notas', case when (select count(*) from public.notas_fiscais where loja_id = loja) = 0 then 'PASSOU' else 'FALHOU' end);
  -- limpeza
  perform set_config('role', 'postgres', true);
  delete from public.lojas where id = loja;
  delete from auth.users where id in (dono, tec);
end $$;

select ordem, teste, resultado from _res order by ordem;
