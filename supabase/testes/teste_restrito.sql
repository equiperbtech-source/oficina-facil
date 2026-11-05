-- Etapa 9: teste grátis sem vitrine e sem notas fiscais (rode só no banco de TESTE; tudo é desfeito no final)
begin;
do $$
declare u uuid := gen_random_uuid(); l uuid; a jsonb; v jsonb; ok boolean;
begin
  insert into auth.users(id, email) values (u, 'teste-restrito@exemplo.com');
  perform set_config('request.jwt.claim.sub', u::text, true);
  perform set_config('request.jwt.claims', '{"email":"teste-restrito@exemplo.com"}', true);
  select id into l from public.criar_loja('Loja Teste 09');
  insert into public.itens(loja_id, colecao, id, dados) values (l, 'produtos', 'p1', '{"nome":"Capa","preco":10,"qtd":5,"vitrine":true}');
  -- em teste
  assert public.loja_situacao(l) = 'teste', 'loja nova deveria estar em teste';
  assert not public.tem_recurso(l, 'vitrine'), 'teste NÃO pode ter vitrine';
  assert not public.tem_recurso(l, 'nota_fiscal'), 'teste NÃO pode ter nota fiscal';
  assert public.tem_recurso(l, 'followup') and public.tem_recurso(l, 'metas'), 'teste mantém os outros recursos do Pro';
  a := public.minha_assinatura(l);
  assert not (a->'recursos') ? 'vitrine', 'assinatura do teste não lista vitrine';
  assert (a->'recursos') ? 'followup', 'assinatura do teste lista followup';
  assert (a->'bloqueados_teste') ? 'vitrine' and (a->'bloqueados_teste') ? 'nota_fiscal', 'assinatura informa o que o teste bloqueia';
  v := public.vitrine_publica(l::text, null);
  assert (v->>'indisponivel')::boolean, 'vitrine pública indisponível no teste';
  ok := false;
  begin perform public.criar_pedido_vitrine(l::text, null, 'Fulano', '48999998888', (now() + interval '1 day')::text, '[{"id":"p1","qtd":1}]', ''); exception when others then ok := true; end;
  assert ok, 'pedido pela vitrine recusado no teste';
  -- assinou o Pro
  update public.lojas set status_assinatura = 'ativa', plano_id = 'pro', teste_ate = null where id = l;
  assert public.tem_recurso(l, 'vitrine'), 'Pro pago tem vitrine';
  assert not public.tem_recurso(l, 'nota_fiscal'), 'Pro pago continua sem nota fiscal';
  assert (public.minha_assinatura(l)->'recursos') ? 'vitrine', 'assinatura do Pro pago lista vitrine';
  assert jsonb_array_length(public.minha_assinatura(l)->'bloqueados_teste') = 0, 'pago não tem bloqueio de teste';
  assert not coalesce((public.vitrine_publica(l::text, null)->>'indisponivel')::boolean, false), 'vitrine pública volta no Pro pago';
  assert (public.criar_pedido_vitrine(l::text, null, 'Fulano', '48999998888', (now() + interval '1 day')::text, '[{"id":"p1","qtd":1}]', '')->>'numero') = '1', 'pedido aceito no Pro pago';
  -- Pro Max pago tem notas
  update public.lojas set plano_id = 'pro_max' where id = l;
  assert public.tem_recurso(l, 'nota_fiscal'), 'Pro Max pago tem nota fiscal';
  raise notice 'TODOS OS TESTES DA ETAPA 9 PASSARAM';
end $$;
rollback;
