/* Monta do zero o banco dos testes: simulação do Supabase → TUDO.sql (00_base + migrações) (DUAS vezes, para provar
   que roda repetido sem erro) → avisos do tempo real. Uso: node tests/db/preparar.cjs [nome_do_banco] */
const { execFileSync } = require('child_process');
const path = require('path');
const RAIZ = path.join(__dirname, '..', '..');
const PORTA = process.env.PGTEST_PORT || '54329';
const BANCO = process.argv[2] || process.env.PGTEST_DB || 'oficina_teste';
const psql = (args, banco = 'postgres') => execFileSync('psql', ['-h', '127.0.0.1', '-p', PORTA, '-U', 'postgres', '-d', banco, '-v', 'ON_ERROR_STOP=1', '-q', ...args], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, PGOPTIONS: '-c client_min_messages=warning' } }).toString();
const arquivo = (f, banco) => psql(['-f', path.join(RAIZ, f)], banco);

function preparar(banco = BANCO) {
  execFileSync(path.join(__dirname, 'pg.sh'), ['start'], { stdio: 'ignore' });
  psql(['-c', `drop database if exists ${banco} with (force)`]);
  psql(['-c', `create database ${banco}`]);
  arquivo('tests/db/supabase-falso.sql', banco);
  arquivo('supabase/saas/TUDO.sql', banco);
  arquivo('supabase/saas/TUDO.sql', banco); // segunda vez: tem que rodar sem erro
  arquivo('tests/db/depois.sql', banco);
  return banco;
}
module.exports = { preparar, psql, PORTA, BANCO };
if (require.main === module) {
  try { console.log('Banco de teste pronto:', preparar()); }
  catch (e) { console.error(String(e.stderr || e.message)); process.exit(1); }
}
