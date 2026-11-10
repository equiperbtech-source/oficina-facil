/* Etapa 8: banco novo. Webhook idempotente (mesmo evento 2x = uma ativação), unir oficinas sem perder
   nem sobrescrever, nada de "oficina padrão", 1 oficina principal por dono. Banco próprio, montado do zero. */
const { test, expect } = require('@playwright/test');
const { preparar, psql } = require('../db/preparar.cjs');

test('banco: webhook idempotente, unir oficinas, sem oficina padrão', async ({}, info) => {
  test.skip(info.project.name !== 'celular', 'uma vez basta');
  const db = 'oficina_teste_etapa8';
  preparar(db);
  const q = sql => psql(['-tA', '-F', '|', '-c', sql], db).trim();

  // duas oficinas do mesmo dono (e-mail) e uma terceira de outro
  q(`insert into auth.users(id, email) values ('11111111-1111-1111-1111-111111111111', 'dono@x.com'), ('22222222-2222-2222-2222-222222222222', 'outro@x.com')`);
  q(`insert into public.lojas(id, nome) values ('aaaaaaaa-0000-0000-0000-00000000000a', 'Oficina A'), ('bbbbbbbb-0000-0000-0000-00000000000b', 'Oficina B'), ('cccccccc-0000-0000-0000-00000000000c', 'Oficina C')`);
  q(`insert into public.membros(loja_id, user_id, email, papel, principal) values ('aaaaaaaa-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'dono@x.com', 'dono', true),
       ('bbbbbbbb-0000-0000-0000-00000000000b', '11111111-1111-1111-1111-111111111111', 'dono@x.com', 'dono', false), ('cccccccc-0000-0000-0000-00000000000c', '22222222-2222-2222-2222-222222222222', 'outro@x.com', 'dono', true)`);
  // 1 oficina principal por dono: a segunda principal é recusada
  expect(() => q(`update public.membros set principal = true where loja_id = 'bbbbbbbb-0000-0000-0000-00000000000b'`)).toThrow(/membros_um_dono_principal/);

  // A tem mais cadastros; o mesmo cliente nas duas com dados diferentes; OS nº 1 nas duas
  q(`insert into public.itens(loja_id, colecao, id, dados) values
     ('aaaaaaaa-0000-0000-0000-00000000000a', 'clientes', 'c1', '{"nome":"Maria (A)"}'), ('aaaaaaaa-0000-0000-0000-00000000000a', 'clientes', 'c2', '{"nome":"José"}'),
     ('aaaaaaaa-0000-0000-0000-00000000000a', 'os', 'o1', '{"numero":1}'), ('aaaaaaaa-0000-0000-0000-00000000000a', 'meta', 'settings', '{"loja":"Oficina A","cnpj":"1"}'),
     ('bbbbbbbb-0000-0000-0000-00000000000b', 'clientes', 'c1', '{"nome":"Maria (B, mais nova)"}'), ('bbbbbbbb-0000-0000-0000-00000000000b', 'os', 'o9', '{"numero":1}'),
     ('bbbbbbbb-0000-0000-0000-00000000000b', 'meta', 'settings', '{"loja":"Oficina B","instagram":"@b"}')`);
  q(`update public.itens set atualizado_em = now() + interval '1 day' where loja_id = 'bbbbbbbb-0000-0000-0000-00000000000b'`);
  const r = JSON.parse(q(`select public.unir_oficinas('aaaaaaaa-0000-0000-0000-00000000000a', 'bbbbbbbb-0000-0000-0000-00000000000b')`));
  expect(r).toMatchObject({ registros_movidos: 1, ja_existiam: 1, numeros_trocados: 1 });
  // nada da que prevaleceu foi substituído; da outra só entrou o que faltava; a outra NÃO foi apagada
  expect(q(`select dados->>'nome' from public.itens where loja_id = 'aaaaaaaa-0000-0000-0000-00000000000a' and colecao = 'clientes' and id = 'c1'`)).toBe('Maria (A)');
  expect(q(`select string_agg(dados->>'numero', ',' order by id) from public.itens where loja_id = 'aaaaaaaa-0000-0000-0000-00000000000a' and colecao = 'os'`)).toBe('1,2');
  expect(JSON.parse(q(`select dados from public.itens where loja_id = 'aaaaaaaa-0000-0000-0000-00000000000a' and colecao = 'meta' and id = 'settings'`))).toEqual({ loja: 'Oficina A', cnpj: '1', instagram: '@b' });
  expect(q(`select count(*) from public.lojas`)).toBe('3');
  expect(q(`select unida_a from public.lojas where id = 'bbbbbbbb-0000-0000-0000-00000000000b'`)).toBe('aaaaaaaa-0000-0000-0000-00000000000a');
  expect(q(`select count(*) from public.itens where loja_id = 'bbbbbbbb-0000-0000-0000-00000000000b'`)).toBe('3');   // os dados da outra continuam lá
  // admin só une oficinas do mesmo dono (C é de outro e-mail): conferido em admin_unir_lojas

  // webhook: o mesmo evento 2 vezes = uma ativação
  q(`insert into public.kiwify_produtos(produto_id, nome, tipo, plano_id) values ('PROD-PRO', 'Pro', 'plano', 'pro')`);
  const norm = `'{"chave":"kiwify:pedido-77","tipo":"compra_aprovada","tipo_original":"order_approved","email":"outro@x.com","produto_id":"PROD-PRO","pedido_id":"77","assinatura_id":"ASS-77","confiavel":true,"provedor":"kiwify"}'::jsonb`;
  const e1 = JSON.parse(q(`select public.registrar_evento_pagamento(true, ${norm}, '{}'::jsonb)`));
  const e2 = JSON.parse(q(`select public.registrar_evento_pagamento(true, ${norm}, '{}'::jsonb)`));
  expect([e1.duplicado, e2.duplicado, e2.id]).toEqual([false, true, e1.id]);
  expect(q(`select public.aplicar_evento_pagamento(${e1.id})`)).toBe('aplicado');
  expect(q(`select public.aplicar_evento_pagamento(${e1.id})`)).toBe('aplicado');   // repetir não aplica de novo
  expect(q(`select count(*) from public.kiwify_eventos where chave_idempotencia = 'kiwify:pedido-77'`)).toBe('1');
  expect(q(`select plano_id || '|' || status_assinatura from public.lojas where id = 'cccccccc-0000-0000-0000-00000000000c'`)).toBe('pro|ativa');

  // sem "oficina padrão": página pública sem oficina no endereço não cai em nenhuma; nada de configuração antiga
  expect(q(`select coalesce(public.loja_publica('', 'qualquer.exemplo.com')::text, 'nenhuma')`)).toBe('nenhuma');
  expect(q(`select count(*) from public.plataforma_config where chave = 'loja_padrao'`)).toBe('0');
  expect(q(`select count(*) from pg_proc where proname in ('juntar_lojas', 'juntar_lojas_por_nome', 'unir_loja_solo')`)).toBe('0');
  psql(['-c', `drop database if exists ${db} with (force)`]);
});
