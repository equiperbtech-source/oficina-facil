-- TESTE DAS REGRAS DE PAGAMENTO (etapa 4). Seguro: cria tudo fictício e apaga no final.
-- Use no Supabase de TESTE. Esperado: todas as linhas "PASSOU".
create temp table if not exists _res (ordem serial, teste text, resultado text);
truncate _res;
grant all on _res to authenticated; grant usage on sequence _res_ordem_seq to authenticated;

do $$
declare
  t text := replace(gen_random_uuid()::text, '-', '');   -- sufixo único deste teste
  em text := 'comprador-' || t || '@exemplo.invalid';
  dono uuid := gen_random_uuid(); f1 uuid := gen_random_uuid(); f2 uuid := gen_random_uuid(); f3 uuid := gen_random_uuid();
  loja uuid; r jsonb; s text; n int; itens1 bigint; loja1 uuid;
  norm jsonb;
begin
  select id into loja1 from public.lojas order by criado_em limit 1;
  select count(*) into itens1 from public.itens where loja_id = loja1;
  insert into public.kiwify_produtos(produto_id, nome, tipo, plano_id) values ('P-ESS-' || t, 'Essencial', 'plano', 'essencial'), ('P-PRO-' || t, 'Pro', 'plano', 'pro');
  insert into public.kiwify_produtos(produto_id, nome, tipo, qtd_notas) values ('P-NOTAS-' || t, '10 notas', 'notas', 10);

  -- 1) assinatura inválida: registra como rejeitado e não aplica
  r := public.registrar_evento_pagamento(false, jsonb_build_object('tipo_original', 'compra_aprovada'), '{"x":1}');
  insert into _res(teste, resultado) values ('Assinatura inválida é rejeitada e não aplica', case when r ->> 'status' = 'rejeitado' and public.aplicar_evento_pagamento((r ->> 'id')::bigint) = 'rejeitado' then 'PASSOU' else 'FALHOU' end);

  -- 2) compra sem loja vai para a fila
  norm := jsonb_build_object('chave', 'k1-' || t, 'tipo', 'compra_aprovada', 'tipo_original', 'compra_aprovada', 'email', upper(em), 'produto_id', 'P-ESS-' || t,
                             'pedido_id', 'o1', 'assinatura_id', 'sub-' || t, 'proxima_cobranca', (now() + interval '30 days')::text, 'confiavel', true);
  r := public.registrar_evento_pagamento(true, norm, '{}');
  s := public.aplicar_evento_pagamento((r ->> 'id')::bigint);
  insert into _res(teste, resultado) values ('Compra sem loja vai para a fila "compras sem loja"', case when s = 'pendente_loja' then 'PASSOU' else 'FALHOU: ' || s end);

  -- 3) evento repetido não entra de novo
  r := public.registrar_evento_pagamento(true, norm, '{}');
  insert into _res(teste, resultado) values ('Evento repetido é reconhecido (idempotente)', case when (r ->> 'duplicado')::boolean then 'PASSOU' else 'FALHOU' end);

  -- 4) dono se cadastra com o mesmo e-mail → plano aplicado sozinho
  insert into auth.users(id, email) values (dono, em), (f1, 'f1-' || t || '@exemplo.invalid'), (f2, 'f2-' || t || '@exemplo.invalid'), (f3, 'f3-' || t || '@exemplo.invalid');
  perform set_config('request.jwt.claims', json_build_object('sub', dono, 'role', 'authenticated', 'email', em)::text, true);
  perform set_config('request.jwt.claim.sub', dono::text, true);
  loja := (public.criar_loja('Loja Pagamento')).id;
  insert into _res(teste, resultado) values ('Ao cadastrar a loja com o e-mail, a compra da fila é aplicada',
    case when (select plano_id = 'essencial' and status_assinatura = 'ativa' and assinatura_externa_id = 'sub-' || t from public.lojas where id = loja) then 'PASSOU' else 'FALHOU' end);
  insert into _res(teste, resultado) values ('Evento da fila marcado como aplicado (sem duplicar)',
    case when (select count(*) from public.kiwify_eventos where chave_idempotencia = 'k1-' || t and status = 'aplicado') = 1 then 'PASSOU' else 'FALHOU' end);

  -- 5) renovação atualiza a próxima cobrança
  r := public.registrar_evento_pagamento(true, norm || jsonb_build_object('chave', 'k2-' || t, 'tipo', 'renovacao', 'pedido_id', 'o2', 'proxima_cobranca', (now() + interval '60 days')::text), '{}');
  s := public.aplicar_evento_pagamento((r ->> 'id')::bigint);
  insert into _res(teste, resultado) values ('Renovação mantém ativa e atualiza a próxima cobrança',
    case when s = 'aplicado' and (select proxima_cobranca > now() + interval '59 days' from public.lojas where id = loja) then 'PASSOU' else 'FALHOU: ' || s end);
  insert into _res(teste, resultado) values ('Aplicar o mesmo evento de novo não muda nada', case when public.aplicar_evento_pagamento((r ->> 'id')::bigint) = 'aplicado' then 'PASSOU' else 'FALHOU' end);

  -- 6) upgrade para o Pro + 3 funcionários; depois downgrade para o Essencial (limite 2)
  r := public.registrar_evento_pagamento(true, norm || jsonb_build_object('chave', 'k3-' || t, 'produto_id', 'P-PRO-' || t, 'pedido_id', 'o3'), '{}');
  perform public.aplicar_evento_pagamento((r ->> 'id')::bigint);
  insert into public.membros(loja_id, user_id, email, papel) values (loja, f1, 'f1', 'atendente'), (loja, f2, 'f2', 'atendente'), (loja, f3, 'f3', 'tecnico');
  insert into _res(teste, resultado) values ('Upgrade para o Pro pela compra', case when (select plano_id from public.lojas where id = loja) = 'pro' then 'PASSOU' else 'FALHOU' end);
  r := public.registrar_evento_pagamento(true, norm || jsonb_build_object('chave', 'k4-' || t, 'pedido_id', 'o4'), '{}');
  perform public.aplicar_evento_pagamento((r ->> 'id')::bigint);
  insert into _res(teste, resultado) values ('Downgrade: excedente desativado, ninguém apagado',
    case when (select plano_id from public.lojas where id = loja) = 'essencial' and public.funcionarios_ativos(loja) = 2
          and (select count(*) from public.membros where loja_id = loja) = 4 then 'PASSOU' else 'FALHOU' end);

  -- 7) atraso → inadimplente
  r := public.registrar_evento_pagamento(true, norm || jsonb_build_object('chave', 'k5-' || t, 'tipo', 'atrasada', 'pedido_id', 'o5'), '{}');
  perform public.aplicar_evento_pagamento((r ->> 'id')::bigint);
  insert into _res(teste, resultado) values ('Atraso deixa a loja inadimplente (ainda pode usar na tolerância)',
    case when public.loja_situacao(loja) = 'inadimplente' and public.pode_escrever(loja) then 'PASSOU' else 'FALHOU' end);

  -- 8) renovação paga depois do atraso → volta a ativa
  r := public.registrar_evento_pagamento(true, norm || jsonb_build_object('chave', 'k6-' || t, 'tipo', 'renovacao', 'pedido_id', 'o6'), '{}');
  perform public.aplicar_evento_pagamento((r ->> 'id')::bigint);
  insert into _res(teste, resultado) values ('Pagamento depois do atraso volta a ativa', case when public.loja_situacao(loja) = 'ativa' then 'PASSOU' else 'FALHOU' end);

  -- 9) cancelada: acesso até o fim do período pago
  r := public.registrar_evento_pagamento(true, norm || jsonb_build_object('chave', 'k7-' || t, 'tipo', 'cancelada', 'pedido_id', 'o7'), '{}');
  perform public.aplicar_evento_pagamento((r ->> 'id')::bigint);
  insert into _res(teste, resultado) values ('Cancelada mantém acesso até o fim do período pago',
    case when (select status_assinatura from public.lojas where id = loja) = 'cancelada' and public.pode_escrever(loja) then 'PASSOU' else 'FALHOU' end);

  -- 10) compra de notas sem Pro Max → revisão (não credita)
  r := public.registrar_evento_pagamento(true, norm || jsonb_build_object('chave', 'k8-' || t, 'tipo', 'compra_aprovada', 'produto_id', 'P-NOTAS-' || t, 'pedido_id', 'o8'), '{}');
  insert into _res(teste, resultado) values ('Notas avulsas sem Pro Max vão para revisão', case when public.aplicar_evento_pagamento((r ->> 'id')::bigint) = 'revisao' then 'PASSOU' else 'FALHOU' end);

  -- 11) produto sem mapeamento → revisão
  r := public.registrar_evento_pagamento(true, norm || jsonb_build_object('chave', 'k9-' || t, 'produto_id', 'DESCONHECIDO', 'pedido_id', 'o9'), '{}');
  insert into _res(teste, resultado) values ('Produto sem mapeamento vai para revisão', case when public.aplicar_evento_pagamento((r ->> 'id')::bigint) = 'revisao' then 'PASSOU' else 'FALHOU' end);

  -- 12) evento sem os campos obrigatórios → revisão (não aplica)
  r := public.registrar_evento_pagamento(true, jsonb_build_object('chave', 'k10-' || t, 'tipo', 'compra_aprovada', 'confiavel', false), '{}');
  insert into _res(teste, resultado) values ('Evento incompleto fica em revisão', case when r ->> 'status' = 'revisao' and public.aplicar_evento_pagamento((r ->> 'id')::bigint) = 'revisao' then 'PASSOU' else 'FALHOU' end);

  -- 13) reembolso → bloqueia e avisa
  r := public.registrar_evento_pagamento(true, norm || jsonb_build_object('chave', 'k11-' || t, 'tipo', 'reembolso', 'pedido_id', 'o11'), '{}');
  perform public.aplicar_evento_pagamento((r ->> 'id')::bigint);
  insert into _res(teste, resultado) values ('Reembolso bloqueia a loja e gera aviso no admin',
    case when public.loja_situacao(loja) = 'bloqueada' and exists (select 1 from public.plataforma_avisos where loja_id = loja and tipo = 'reembolso') then 'PASSOU' else 'FALHOU' end);
  insert into _res(teste, resultado) values ('Loja bloqueada: dados preservados', case when (select count(*) from public.membros where loja_id = loja) = 4 then 'PASSOU' else 'FALHOU' end);

  -- 14) e-mail dono de duas lojas → revisão (nunca adivinha a loja)
  perform public.criar_loja('Segunda loja');
  r := public.registrar_evento_pagamento(true, norm || jsonb_build_object('chave', 'k12-' || t, 'assinatura_id', 'outra-' || t, 'pedido_id', 'o12'), '{}');
  insert into _res(teste, resultado) values ('E-mail com duas lojas: vai para revisão', case when public.aplicar_evento_pagamento((r ->> 'id')::bigint) = 'revisao' then 'PASSOU' else 'FALHOU' end);

  -- 15) usuário do app não chama as funções de pagamento
  perform set_config('role', 'authenticated', true);
  begin
    perform public.aplicar_evento_pagamento((r ->> 'id')::bigint);
    insert into _res(teste, resultado) values ('App não consegue aplicar eventos de pagamento', 'FALHOU');
  exception when insufficient_privilege then insert into _res(teste, resultado) values ('App não consegue aplicar eventos de pagamento', 'PASSOU');
  end;
  begin
    perform public.registrar_evento_pagamento(true, norm, '{}');
    insert into _res(teste, resultado) values ('App não consegue registrar eventos de pagamento', 'FALHOU');
  exception when insufficient_privilege then insert into _res(teste, resultado) values ('App não consegue registrar eventos de pagamento', 'PASSOU');
  end;
  perform set_config('role', 'postgres', true);

  -- loja 1 intacta + limpeza
  insert into _res(teste, resultado) values ('Loja 1 intacta', case when (select count(*) from public.itens where loja_id = loja1) = itens1 and public.loja_situacao(loja1) = 'ativa' then 'PASSOU' else 'FALHOU' end);
  delete from public.plataforma_avisos where loja_id in (select loja_id from public.membros where user_id = dono);
  delete from public.lojas where id in (select loja_id from public.membros where user_id = dono);
  delete from auth.users where id in (dono, f1, f2, f3);
  delete from public.kiwify_eventos where chave_idempotencia like '%' || t or (assinatura_valida = false and payload = '{"x":1}'::jsonb);
  delete from public.kiwify_produtos where produto_id like '%' || t;
end $$;

select ordem, teste, resultado from _res order by ordem;
