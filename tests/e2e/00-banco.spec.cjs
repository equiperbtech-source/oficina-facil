/* Banco: monta do zero num banco separado (simulação do Supabase → schema → TUDO.sql duas vezes)
   e confere os planos da Oficina Simples. */
const { test, expect } = require('@playwright/test');
const { preparar, psql } = require('../db/preparar.cjs');
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');

test('TUDO.sql está em dia com as migrações', async ({}, info) => {
  test.skip(info.project.name !== 'celular', 'uma vez basta');
  const arq = path.join(__dirname, '..', '..', 'supabase', 'saas', 'TUDO.sql');
  const antes = fs.readFileSync(arq, 'utf8');
  execFileSync('node', [path.join(__dirname, '..', '..', 'scripts', 'juntar-migracoes.cjs')], { stdio: 'ignore' });
  expect(fs.readFileSync(arq, 'utf8') === antes, 'rode: node scripts/juntar-migracoes.cjs').toBe(true);
});

test('TUDO.sql roda duas vezes sem erro e os planos estão certos', async ({}, info) => {
  test.skip(info.project.name !== 'celular', 'uma vez basta');
  const banco = 'oficina_teste_banco';
  expect(() => preparar(banco)).not.toThrow();
  const planos = psql(['-tA', '-F', '|', '-c', "select id, preco_mensal, max_funcionarios, ativo from planos order by ordem"], banco).trim().split('\n');
  expect(planos).toEqual(['essencial|49.99|4|t', 'pro|89.99|4|t', 'pro_max||5|f']);
  const bloqueados = psql(['-tA', '-c', "select valor::text from plataforma_config where chave = 'recursos_bloqueados_teste'"], banco).trim();
  expect(bloqueados).toBe('["vitrine"]');
  // nenhuma tabela do schema public sem RLS
  const semRls = psql(['-tA', '-c', "select string_agg(relname, ',') from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity"], banco).trim();
  expect(semRls).toBe('');
  psql(['-c', `drop database if exists ${banco} with (force)`]);
});
