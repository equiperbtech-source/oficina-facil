/* Acesso ao Supabase pelo servidor (funções /api da Vercel). Sem dependências: usa fetch.
   A chave secreta (SUPABASE_SERVICE_ROLE_KEY) só existe em variável de ambiente do servidor:
   nunca vai para o navegador, nunca para o código e nunca para logs. */
// Aceita o endereço colado de vários jeitos: sem https://, com /rest/v1 no final, com espaços ou aspas
export const normalizarUrl = u => {
  let x = String(u || '').trim().replace(/^['"]|['"]$/g, '').trim();
  if (!x) return '';
  if (!/^https?:\/\//i.test(x)) x = 'https://' + x;
  return x.replace(/\/(rest|auth|storage|realtime)\/v1.*$/i, '').replace(/\/+$/, '').toLowerCase();
};
const base = () => normalizarUrl(process.env.SUPABASE_URL || process.env.OFICINA_SUPABASE_URL);
const chave = () => (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

export const configurado = () => !!(base() && chave());

// O banco das variáveis é o mesmo do site (js/config.js)? Ajuda a explicar um login recusado.
export async function bancoDiferente(request) {
  try {
    const txt = await (await fetch(new URL('/js/config.js', request.url))).text();
    const site = normalizarUrl((txt.match(/supabaseUrl:\s*['"]([^'"]+)/) || [])[1]);
    return !!site && site !== base();
  } catch { return false; }
}

// Como usuário (token dele: o banco aplica as regras RLS) ou como servidor (sem token)
function cabecalhos(token) {
  const k = chave();
  const h = { apikey: k, 'Content-Type': 'application/json' };
  const auth = token || (k.startsWith('eyJ') ? k : null); // chave nova (sb_secret_) vai só no apikey
  if (auth) h.Authorization = 'Bearer ' + auth;
  return h;
}

export class ErroApi extends Error { constructor(status, msg) { super(msg); this.status = status; } }

export async function rpc(fn, args = {}, { token } = {}) {
  const r = await fetch(`${base()}/rest/v1/rpc/${fn}`, { method: 'POST', headers: cabecalhos(token), body: JSON.stringify(args) });
  const txt = await r.text();
  let data = null; try { data = txt ? JSON.parse(txt) : null; } catch { data = txt; }
  if (!r.ok) throw new ErroApi(r.status >= 500 ? 502 : 400, (data && data.message) || `erro ${r.status} em ${fn}`);
  return data;
}

// Usuário dono do token (ou null)
export async function usuario(token) {
  if (!token) return null;
  const r = await fetch(`${base()}/auth/v1/user`, { headers: { apikey: chave(), Authorization: 'Bearer ' + token } });
  if (!r.ok) return null;
  const u = await r.json().catch(() => null);
  return u && u.id ? u : null;
}

// Convite por e-mail (Supabase Auth). Devolve { jaExistia } quando o e-mail já tem conta.
export async function convidar(email, nome, redirectTo) {
  const q = redirectTo ? '?redirect_to=' + encodeURIComponent(redirectTo) : '';
  const r = await fetch(`${base()}/auth/v1/invite${q}`, { method: 'POST', headers: cabecalhos(null), body: JSON.stringify({ email, data: { nome } }) });
  if (r.ok) return { jaExistia: false };
  const j = await r.json().catch(() => ({}));
  if (r.status === 422 || /already|registered|exists/i.test(j.msg || j.message || j.error_code || '')) return { jaExistia: true };
  throw new ErroApi(502, 'Não foi possível enviar o convite: ' + (j.msg || j.message || r.status));
}

export const bearer = req => ((req.headers.get('authorization') || '').match(/^Bearer\s+(.+)$/i) || [])[1] || null;

export const json = (status, corpo) => new Response(JSON.stringify(corpo), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

export const ehUuid = v => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v || ''));

// Executa a rota tratando erros sem vazar detalhes internos
export async function rota(fn) {
  try { return await fn(); }
  catch (e) {
    if (e instanceof ErroApi) return json(e.status, { erro: e.message });
    console.error('[api] erro inesperado:', e && e.message);
    return json(500, { erro: 'Erro interno. Tente de novo.' });
  }
}
