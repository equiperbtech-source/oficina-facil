/* Middleware da Vercel (roda antes das páginas): protege o painel /admin.
   Só deixa abrir para quem tem sessão de super admin (conferida no Supabase). Os demais veem a tela de login.
   As rotas /api/admin conferem tudo de novo. */
export const config = { matcher: ['/admin', '/admin/:path*', '/admin.html'] };

const continuar = () => new Response(null, { headers: { 'x-middleware-next': '1' } });
const reescrever = (destino, req) => new Response(null, { headers: { 'x-middleware-rewrite': new URL(destino, req.url).toString() } });

// Endereço e chave pública do Supabase: os mesmos do site (js/config.js) ou, se faltarem, das variáveis de ambiente
// (a chave pública já é pública; com o token do usuário o banco aplica as regras dele)
let publico = null;
async function configPublica(req) {
  if (publico) return publico;
  // 1º: o js/config.js do próprio site (é exatamente o banco onde o navegador fez login)
  let url = '', chave = '';
  try {
    const txt = await (await fetch(new URL('/js/config.js', req.url))).text();
    url = (txt.match(/supabaseUrl:\s*['"]([^'"]+)/) || [])[1] || '';
    chave = (txt.match(/supabaseAnonKey:\s*['"]([^'"]+)/) || [])[1] || '';
  } catch {}
  // 2º: variáveis de ambiente (endereço e chave juntos, do mesmo banco)
  if (!url || !chave) { url = process.env.OFICINA_SUPABASE_URL || ''; chave = process.env.OFICINA_SUPABASE_ANON_KEY || ''; }
  if (url && chave) publico = { url: url.trim().replace(/\/+$/, ''), chave: chave.trim() };
  return publico || { url: '', chave: '' };
}

async function ehAdmin(token, req) {
  if (!token) return false;
  const { url, chave } = await configPublica(req);
  if (!url || !chave) return false;
  try {
    const r = await fetch(`${url}/rest/v1/rpc/sou_super_admin`, { method: 'POST', headers: { apikey: chave, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: '{}' });
    return r.ok && (await r.json()) === true;
  } catch { return false; }
}

export default async function middleware(request) {
  const cookie = request.headers.get('cookie') || '';
  const token = decodeURIComponent((cookie.match(/(?:^|;\s*)os_admin=([^;]+)/) || [])[1] || '');
  if (await ehAdmin(token, request)) return continuar();
  return reescrever('/admin-entrar.html', request);
}
