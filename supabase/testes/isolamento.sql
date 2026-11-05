-- TESTE DE ISOLAMENTO ENTRE LOJAS
-- Seguro: cria uma loja e um usuário fictícios e APAGA os dois no final. Se der erro no meio, nada fica gravado.
-- Use no Supabase de TESTE (SQL Editor → cole → Run). Resultado esperado: todas as linhas "PASSOU".
begin;

create temp table _res (ordem serial, teste text, resultado text);
grant all on _res to authenticated;
grant usage on sequence _res_ordem_seq to authenticated;

-- Loja 1 = a loja mais antiga (a loja atual). Precisa existir com um dono.
create temp table _ctx on commit drop as
  select l.id as loja1, (select m.user_id from public.membros m where m.loja_id = l.id and m.papel = 'dono' limit 1) as dono1,
         (select count(*) from public.itens i where i.loja_id = l.id) as itens1,
         gen_random_uuid() as user_novo, null::uuid as loja_nova
  from public.lojas l order by l.criado_em limit 1;
grant all on _ctx to authenticated;

-- Usuário fictício que vai criar a loja nova (apagado no rollback)
insert into auth.users (id, email) select user_novo, 'teste-isolamento-' || user_novo || '@exemplo.invalid' from _ctx;

-- Entra como o usuário novo
select set_config('request.jwt.claims', json_build_object('sub', user_novo, 'role', 'authenticated', 'email', 'novo@exemplo.invalid')::text, true),
       set_config('request.jwt.claim.sub', user_novo::text, true) from _ctx;
set local role authenticated;

-- Cria a loja nova pela mesma função que o app usa
update _ctx set loja_nova = (select id from public.criar_loja('Loja Teste Isolamento'));

insert into _res(teste, resultado) select 'Loja nova nasce vazia (0 registros)',
  case when (select count(*) from public.itens where loja_id = (select loja_nova from _ctx)) = 0 then 'PASSOU' else 'FALHOU' end;
insert into _res(teste, resultado) select 'Loja nova NÃO vê nenhum registro da loja 1',
  case when (select count(*) from public.itens where loja_id = (select loja1 from _ctx)) = 0 then 'PASSOU' else 'FALHOU' end;
insert into _res(teste, resultado) select 'Loja nova só enxerga a própria loja na tabela lojas',
  case when (select count(*) from public.lojas) = 1 and (select id from public.lojas limit 1) = (select loja_nova from _ctx) then 'PASSOU' else 'FALHOU' end;
insert into _res(teste, resultado) select 'Loja nova não vê a equipe da loja 1',
  case when (select count(*) from public.membros where loja_id = (select loja1 from _ctx)) = 0 then 'PASSOU' else 'FALHOU' end;

-- Tenta gravar na loja 1 (tem que ser bloqueado)
do $$ begin
  insert into public.itens(loja_id, colecao, id, dados) values ((select loja1 from _ctx), 'clientes', 'invasao-teste', '{"nome":"x"}');
  insert into _res(teste, resultado) values ('Loja nova NÃO consegue gravar na loja 1', 'FALHOU');
exception when others then
  insert into _res(teste, resultado) values ('Loja nova NÃO consegue gravar na loja 1', 'PASSOU');
end $$;
do $$ declare n int; begin
  update public.itens set dados = dados where loja_id = (select loja1 from _ctx);
  get diagnostics n = row_count;
  insert into _res(teste, resultado) values ('Loja nova NÃO consegue alterar registros da loja 1', case when n = 0 then 'PASSOU' else 'FALHOU' end);
end $$;
do $$ declare n int; begin
  delete from public.itens where loja_id = (select loja1 from _ctx);
  get diagnostics n = row_count;
  insert into _res(teste, resultado) values ('Loja nova NÃO consegue apagar registros da loja 1', case when n = 0 then 'PASSOU' else 'FALHOU' end);
end $$;
do $$ begin
  insert into public.membros(loja_id, user_id, email, papel) values ((select loja1 from _ctx), (select user_novo from _ctx), 'x', 'dono');
  insert into _res(teste, resultado) values ('Loja nova NÃO consegue se colocar na equipe da loja 1', 'FALHOU');
exception when others then
  insert into _res(teste, resultado) values ('Loja nova NÃO consegue se colocar na equipe da loja 1', 'PASSOU');
end $$;

-- Grava um registro na própria loja nova
insert into public.itens(loja_id, colecao, id, dados) select loja_nova, 'clientes', 'cliente-da-loja-nova', '{"nome":"Cliente Loja Nova"}' from _ctx;

-- Agora entra como o dono da loja 1 e confere o caminho inverso
reset role;
select set_config('request.jwt.claims', json_build_object('sub', dono1, 'role', 'authenticated')::text, true),
       set_config('request.jwt.claim.sub', dono1::text, true) from _ctx;
set local role authenticated;

insert into _res(teste, resultado) select 'Loja 1 NÃO vê nenhum registro da loja nova',
  case when (select count(*) from public.itens where loja_id = (select loja_nova from _ctx)) = 0 then 'PASSOU' else 'FALHOU' end;
insert into _res(teste, resultado) select 'Loja 1 continua vendo todos os próprios registros',
  case when (select count(*) from public.itens where loja_id = (select loja1 from _ctx)) = (select itens1 from _ctx) then 'PASSOU' else 'FALHOU' end;
insert into _res(teste, resultado) select 'Loja 1 não enxerga a loja nova na tabela lojas',
  case when not exists (select 1 from public.lojas where id = (select loja_nova from _ctx)) then 'PASSOU' else 'FALHOU' end;

reset role;
-- Limpeza: apaga a loja e o usuário fictícios (a loja 1 não é tocada)
delete from public.lojas where id = (select loja_nova from _ctx);
delete from auth.users where id = (select user_novo from _ctx);
insert into _res(teste, resultado) select 'Limpeza: loja 1 com o mesmo número de registros do início',
  case when (select count(*) from public.itens where loja_id = (select loja1 from _ctx)) = (select itens1 from _ctx) then 'PASSOU' else 'FALHOU' end;
commit;

select ordem, teste, resultado from _res order by ordem;
