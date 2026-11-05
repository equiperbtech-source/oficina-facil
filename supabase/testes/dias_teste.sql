-- Etapa 11: dias de teste pelo /admin (rode só no banco de TESTE; tudo é desfeito no final)
begin;
do $$
declare adm uuid := gen_random_uuid(); dono uuid := gen_random_uuid(); l uuid; ok boolean;
begin
  insert into auth.users(id, email) values (adm, 'adm-dias@exemplo.com'), (dono, 'dono-dias@exemplo.com');
  insert into public.super_admins(user_id) values (adm);
  perform set_config('request.jwt.claim.sub', dono::text, true);
  perform set_config('request.jwt.claims', '{"email":"dono-dias@exemplo.com"}', true);
  select id into l from public.criar_loja('Loja Dias');
  perform set_config('request.jwt.claim.sub', adm::text, true);
  -- cortesia = acesso completo (sai do teste)
  perform public.admin_cortesia(l, 10, 'teste');
  assert public.loja_situacao(l) = 'ativa', 'cortesia deixa a loja ativa';
  assert public.tem_recurso(l, 'vitrine'), 'cortesia libera a vitrine';
  -- dias de teste: volta para teste, tira a cortesia, bloqueia vitrine
  perform public.admin_definir_teste(l, 3, 'cliente pediu mais prazo');
  assert public.loja_situacao(l) = 'teste', 'dias de teste deixam a loja em teste';
  assert (select cortesia_ate is null from public.lojas where id = l), 'dias de teste tiram a cortesia';
  assert (select teste_ate between now() + interval '2 days 23 hours' and now() + interval '3 days 1 hour' from public.lojas where id = l), 'teste vai até daqui a 3 dias';
  assert not public.tem_recurso(l, 'vitrine'), 'em teste não tem vitrine';
  -- diminuir
  perform public.admin_definir_teste(l, 1, 'diminuir');
  assert (select teste_ate < now() + interval '1 day 1 hour' from public.lojas where id = l), 'diminuiu para 1 dia';
  -- 0 encerra o teste
  perform public.admin_definir_teste(l, 0, 'encerrar');
  assert public.loja_situacao(l) = 'expirada', '0 dias encerra o teste';
  assert not public.pode_escrever(l), 'teste encerrado fica somente leitura';
  assert (select count(*) from public.admin_auditoria where loja_id = l and acao = 'dias_teste') = 3, 'auditoria registra cada mudança';
  -- loja com assinatura paga não volta para teste
  update public.lojas set status_assinatura = 'ativa', assinatura_externa_id = 'sub-x', periodo_pago_ate = now() + interval '20 days' where id = l;
  ok := false; begin perform public.admin_definir_teste(l, 5, 'x'); exception when others then ok := sqlerrm like '%assinatura paga%'; end;
  assert ok, 'loja paga é recusada';
  -- quem não é admin não consegue
  perform set_config('request.jwt.claim.sub', dono::text, true);
  ok := false; begin perform public.admin_definir_teste(l, 5, 'x'); exception when others then ok := true; end;
  assert ok, 'dono da loja não usa a função de admin';
  raise notice 'TODOS OS TESTES DE DIAS DE TESTE PASSARAM';
end $$;
rollback;
