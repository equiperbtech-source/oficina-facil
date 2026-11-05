-- Etapa 12: código de convite seguro (rode só no banco de TESTE; tudo é desfeito no final)
begin;
do $$
declare dono uuid := gen_random_uuid(); intruso uuid := gen_random_uuid(); l uuid; solo uuid; cod text; r jsonb; ok boolean; i int;
begin
  insert into auth.users(id, email) values (dono, 'dono-conv@exemplo.com'), (intruso, 'intruso@exemplo.com');
  perform set_config('request.jwt.claim.sub', dono::text, true);
  perform set_config('request.jwt.claims', '{"email":"dono-conv@exemplo.com"}', true);
  select id into l from public.criar_loja('Loja Protegida');
  insert into public.itens(loja_id, colecao, id, dados) values (l, 'clientes', 'c1', '{"nome":"Cliente sigiloso"}');
  select codigo_convite into cod from public.lojas where id = l;
  assert length(cod) = 10, 'código novo tem 10 caracteres';
  -- intruso tem a própria loja (só ele) e usa o código
  perform set_config('request.jwt.claim.sub', intruso::text, true);
  perform set_config('request.jwt.claims', '{"email":"intruso@exemplo.com"}', true);
  select id into solo from public.criar_loja('Loja do Intruso');
  insert into public.itens(loja_id, colecao, id, dados) values (solo, 'clientes', 'x1', '{"nome":"Dado do intruso"}');
  r := public.entrar_na_loja(lower(cod));
  assert r ->> 'situacao' = 'pendente', 'com o código só vira pedido pendente';
  assert not (l in (select public.minhas_lojas())), 'pendente NÃO tem acesso à loja';
  assert public.meu_papel(l) is null, 'pendente não tem papel';
  perform set_config('role', 'authenticated', true);
  select count(*) into i from public.itens where loja_id = l;
  perform set_config('role', 'postgres', true);
  assert i = 0, 'pendente não lê nenhum dado da loja (RLS)';
  assert (public.meus_pedidos_pendentes() -> 0 ->> 'nome') = 'Loja Protegida', 'pessoa vê que o pedido está aguardando';
  assert exists (select 1 from public.lojas where id = solo), 'loja própria do intruso NÃO é apagada';
  assert not exists (select 1 from public.itens where loja_id = l and id = 'x1'), 'dados do intruso NÃO entram na loja';
  -- dono aprova
  perform set_config('request.jwt.claim.sub', dono::text, true);
  assert (select pendente from public.membros where loja_id = l and user_id = intruso), 'dono vê o pedido pendente';
  perform public.definir_membro_ativo(l, intruso, true);
  perform set_config('request.jwt.claim.sub', intruso::text, true);
  assert l in (select public.minhas_lojas()), 'depois de aprovado tem acesso';
  -- dono desativa; usar o código de novo não reativa sozinho
  perform set_config('request.jwt.claim.sub', dono::text, true);
  perform public.definir_membro_ativo(l, intruso, false);
  perform set_config('request.jwt.claim.sub', intruso::text, true);
  r := public.entrar_na_loja(cod);
  assert r ->> 'situacao' = 'pendente' and not (l in (select public.minhas_lojas())), 'desativado que usa o código volta a ser só pedido';
  -- limite de tentativas
  ok := false;
  r := public.entrar_na_loja('ERRADO');
  assert r ->> 'situacao' = 'invalido', 'código errado responde inválido';
  begin for i in 1..12 loop begin perform public.entrar_na_loja('ERRADO' || i); exception when others then if sqlerrm like 'Muitas tentativas%' then ok := true; exit; end if; end; end loop; end;
  assert ok, 'bloqueia depois de 10 tentativas por hora';
  raise notice 'TODOS OS TESTES DO CONVITE SEGURO PASSARAM';
end $$;
rollback;
