/* Junta supabase/saas/0*_*.sql (sem os de reverter) num arquivo só, na ordem: supabase/saas/TUDO.sql
   Uso: node scripts/juntar-migracoes.cjs */
const fs = require('fs'), path = require('path');
const dir = path.join(__dirname, '..', 'supabase', 'saas');
const arqs = fs.readdirSync(dir).filter(f => /^\d\d_.*\.sql$/.test(f) && !f.includes('reverter')).sort();
const partes = arqs.map(f => `-- >>>>>>>>>>>>>>>>>>>> ${f} >>>>>>>>>>>>>>>>>>>>\n${fs.readFileSync(path.join(dir, f), 'utf8')}`);
const cab = `-- =====================================================================
-- BANCO COMPLETO DA OFICINA SIMPLES: BASE + MIGRAÇÕES, EM ORDEM (gerado por scripts/juntar-migracoes.cjs — não editar à mão)
-- Banco novo: rode só este arquivo (ele começa pelo 00_base.sql). Seguro rodar de novo (idempotente).
-- Arquivos: ${arqs.join(', ')}
-- =====================================================================\n\n`;
fs.writeFileSync(path.join(dir, 'TUDO.sql'), cab + partes.join('\n\n'));
console.log('TUDO.sql gerado com', arqs.length, 'arquivos');
