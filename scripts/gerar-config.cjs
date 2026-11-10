/* Gera js/config.js no build da Vercel, conforme o ambiente.
   - Produção: exige OFICINA_SUPABASE_URL, OFICINA_SUPABASE_ANON_KEY e OFICINA_CONFIRMO_BANCO_PRODUCAO
     (igual à URL). Sem elas a publicação PARA com erro: nunca publica o app sem nuvem por engano.
   - Preview/branches: usa as variáveis (Supabase de TESTE); sem elas, modo local (nunca o banco real).
   - OFICINA_DOMINIO (opcional): domínio principal; cada oficina fica em <endereço>.<domínio>. */
const fs = require('fs');
const path = require('path');

const ambiente = process.env.VERCEL_ENV || 'local';
// Aceita a "Project URL" (https://xxxx.supabase.co) e também formatos comuns colados por engano:
// endereço do painel (supabase.com/dashboard/project/xxxx), com /rest/v1 no final, sem https, com aspas ou maiúsculas.
function normalizarUrl(v) {
  let u = String(v || '').trim().replace(/^['"]|['"]$/g, '').trim();
  if (!u) return '';
  const painel = u.match(/supabase\.com\/dashboard\/project\/([a-z0-9]+)/i);
  if (painel) return `https://${painel[1].toLowerCase()}.supabase.co`;
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  const m = u.match(/^https?:\/\/([a-z0-9-]+)\.supabase\.co(\/.*)?$/i);
  return m ? `https://${m[1].toLowerCase()}.supabase.co` : null;
}
const url = normalizarUrl(process.env.OFICINA_SUPABASE_URL);
const chave = (process.env.OFICINA_SUPABASE_ANON_KEY || '').trim();
const destino = path.join(__dirname, '..', 'js', 'config.js');

const dominio = String(process.env.OFICINA_DOMINIO || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^(app|www)\./, '').replace(/\/.*$/, '');
if (ambiente === 'production' && !url) {
  console.error('[config] ERRO: produção sem OFICINA_SUPABASE_URL. Cadastre as variáveis na Vercel (veja .env.example).');
  process.exit(1);
}
// Trava contra engano: em produção, só usa o banco se houver confirmação explícita.
// (Ex.: variáveis do Supabase de TESTE marcadas sem querer também em "Production".)
// (as duas são comparadas já normalizadas: barra no fim, https://, maiúsculas ou /rest/v1 não atrapalham)
const confirmo = normalizarUrl(process.env.OFICINA_CONFIRMO_BANCO_PRODUCAO);
if (ambiente === 'production' && confirmo !== url) {
  const id = u => (u ? u.replace(/^https:\/\/([^.]+).*/, '$1') : '(vazia)');
  console.error('[config] ERRO: OFICINA_CONFIRMO_BANCO_PRODUCAO tem que ser a mesma Project URL de OFICINA_SUPABASE_URL.');
  console.error(`[config] OFICINA_SUPABASE_URL → projeto ${id(url)} · OFICINA_CONFIRMO_BANCO_PRODUCAO → ${confirmo === null ? 'não parece uma URL do Supabase' : id(confirmo)}`);
  console.error('[config] Confira se a variável está marcada em "Production" e faça Redeploy.');
  process.exit(1);
}
if (ambiente === 'local' && !url) {
  console.log('[config] fora da Vercel e sem variáveis: nada alterado');
  process.exit(0);
}
if (url === null) {
  console.error('[config] ERRO: OFICINA_SUPABASE_URL não é um endereço do Supabase.');
  console.error('[config] Use a "Project URL" do projeto de TESTE: Supabase → Project Settings → Data API → https://xxxx.supabase.co');
  process.exit(1);
}
if (url && !chave) {
  console.error('[config] ERRO: falta OFICINA_SUPABASE_ANON_KEY (Supabase → Project Settings → API Keys → Publishable key).');
  process.exit(1);
}
if (url && !/^(sb_publishable_[A-Za-z0-9_-]+|eyJ[A-Za-z0-9._-]+)$/.test(chave)) {
  console.error('[config] ERRO: OFICINA_SUPABASE_ANON_KEY não parece a chave pública (começa com sb_publishable_ ou eyJ). Nunca use a secret/service_role.');
  process.exit(1);
}
const conteudo = `/* Gerado no build (${ambiente}). Não editar: veja scripts/gerar-config.cjs */
window.OFICINA_CONFIG = {
  supabaseUrl: ${JSON.stringify(url)},
  supabaseAnonKey: ${JSON.stringify(url ? chave : '')},
  ambiente: ${JSON.stringify(ambiente)},
  dominio: ${JSON.stringify(dominio)},
};
`;
fs.writeFileSync(destino, conteudo);
console.log(`[config] ${ambiente}: ${url ? 'Supabase ' + url.replace(/^https:\/\/([^.]+).*/, '$1') : 'modo local (sem banco)'}`);
