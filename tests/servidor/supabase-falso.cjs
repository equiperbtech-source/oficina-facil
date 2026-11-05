/* Supabase de mentira, SÓ PARA OS TESTES. Usa o Postgres local de verdade, com as mesmas regras de
   segurança (RLS) do banco real: cada pedido roda com o papel e o login de quem pediu.
   Cobre o que o app usa: login (auth/v1), tabelas e funções (rest/v1), arquivos (storage/v1)
   e tempo real (realtime/v1, websocket). Não é um Supabase completo: só o necessário para testar o app.
   Também serve o app (porta própria), com o js/config.js apontando para cá. */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Pool, Client } = require('pg');
const { WebSocketServer } = require('ws');

const RAIZ = path.join(__dirname, '..', '..');
const SEGREDO = 'segredo-so-dos-testes-locais';   // assina os logins de teste; não serve para nada fora daqui
const b64 = s => Buffer.from(s).toString('base64url');
function assinar(claims) {
  const cab = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' })), corpo = b64(JSON.stringify(claims));
  return `${cab}.${corpo}.${crypto.createHmac('sha256', SEGREDO).update(`${cab}.${corpo}`).digest('base64url')}`;
}
function conferir(token) {
  const [c, b, s] = String(token || '').split('.');
  if (!s || crypto.createHmac('sha256', SEGREDO).update(`${c}.${b}`).digest('base64url') !== s) return null;
  try { const d = JSON.parse(Buffer.from(b, 'base64url')); return d.exp && d.exp < Date.now() / 1000 ? null : d; } catch { return null; }
}
const ANON_KEY = assinar({ role: 'anon', iss: 'teste', iat: 1700000000, exp: 4102444800 });
const SERVICE_KEY = assinar({ role: 'service_role', iss: 'teste', iat: 1700000000, exp: 4102444800 });

const ID = /^[a-z_][a-z0-9_]*$/;
const q = id => { if (!ID.test(id)) throw erroApi(400, 'PGRST100', `nome inválido: ${id}`); return `"${id}"`; };
function erroApi(status, code, message, details = null, hint = null) { const e = new Error(message); Object.assign(e, { status, code, details, hint, api: true }); return e; }

function criar({ porta = 54321, portaApp = 4173, banco = 'oficina_teste', pgPorta = 54329, dominio = '' } = {}) {
  const pool = new Pool({ host: '127.0.0.1', port: pgPorta, user: 'postgres', database: banco, max: 12 });
  const refresh = new Map();   // refresh_token -> user id
  const arquivos = path.join(RAIZ, '.pgtest', 'storage-' + banco);
  fs.mkdirSync(arquivos, { recursive: true });
  const URL_BASE = `http://127.0.0.1:${porta}`;

  /* ---------- quem está pedindo ---------- */
  function claimsDe(req) {
    const auth = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const c = conferir(auth) || conferir(req.headers.apikey);
    if (!c) throw erroApi(401, 'PGRST301', 'JWT inválido');
    return c;
  }
  async function comoQuem(claims, fn) {
    const cli = await pool.connect();
    try {
      await cli.query('begin');
      const papel = ['anon', 'authenticated', 'service_role'].includes(claims.role) ? claims.role : 'anon';
      await cli.query(`set local role ${papel}`);
      await cli.query("select set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true), set_config('request.jwt.claim.role', $3, true)", [JSON.stringify(claims), claims.sub || '', papel]);
      const r = await fn(cli);
      await cli.query('commit');
      return r;
    } catch (e) { await cli.query('rollback').catch(() => {}); throw e; }
    finally { cli.release(); }
  }

  /* ---------- auth ---------- */
  function usuarioJson(u) {
    return { id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email, phone: '',
      email_confirmed_at: u.email_confirmed_at, confirmed_at: u.email_confirmed_at, last_sign_in_at: new Date().toISOString(),
      app_metadata: u.raw_app_meta_data || {}, user_metadata: u.raw_user_meta_data || {},
      identities: [{ id: u.id, user_id: u.id, identity_id: u.id, provider: 'email', identity_data: { sub: u.id, email: u.email } }],
      created_at: u.created_at, updated_at: u.updated_at, is_anonymous: false };
  }
  function sessao(u) {
    const agora = Math.floor(Date.now() / 1000), exp = agora + 3600;
    const access_token = assinar({ sub: u.id, email: u.email, role: 'authenticated', aud: 'authenticated', iat: agora, exp,
      app_metadata: u.raw_app_meta_data || {}, user_metadata: u.raw_user_meta_data || {}, session_id: crypto.randomUUID() });
    const refresh_token = crypto.randomBytes(16).toString('hex'); refresh.set(refresh_token, u.id);
    return { access_token, token_type: 'bearer', expires_in: 3600, expires_at: exp, refresh_token, user: usuarioJson(u) };
  }
  const erroAuth = (status, error_code, msg) => erroApi(status, error_code, msg);
  async function usuarioPorId(id) { return (await pool.query('select * from auth.users where id = $1', [id])).rows[0]; }
  async function auth(req, res, rota, corpo, url) {
    if (rota === 'signup' && req.method === 'POST') {
      const email = String(corpo.email || '').trim().toLowerCase();
      if (!email || String(corpo.password || '').length < 6) throw erroAuth(422, 'weak_password', 'Password should be at least 6 characters.');
      const ja = (await pool.query('select 1 from auth.users where email = $1', [email])).rowCount;
      if (ja) throw erroAuth(422, 'user_already_exists', 'User already registered');
      const u = (await pool.query("insert into auth.users(email, encrypted_password, raw_user_meta_data) values ($1, crypt($2, gen_salt('bf', 4)), $3) returning *", [email, corpo.password, corpo.data || {}])).rows[0];
      return enviar(res, 200, sessao(u));
    }
    if (rota === 'token' && req.method === 'POST') {
      const tipo = url.searchParams.get('grant_type');
      if (tipo === 'password') {
        const u = (await pool.query('select * from auth.users where email = $1 and encrypted_password = crypt($2, encrypted_password)', [String(corpo.email || '').trim().toLowerCase(), String(corpo.password || '')])).rows[0];
        if (!u) throw Object.assign(erroAuth(400, 'invalid_credentials', 'Invalid login credentials'), { oauth: true });
        return enviar(res, 200, sessao(u));
      }
      if (tipo === 'refresh_token') {
        const id = refresh.get(corpo.refresh_token); const u = id && await usuarioPorId(id);
        if (!u) throw erroAuth(400, 'refresh_token_not_found', 'Invalid Refresh Token: Refresh Token Not Found');
        refresh.delete(corpo.refresh_token);
        return enviar(res, 200, sessao(u));
      }
    }
    const c = claimsDe(req);
    if (rota === 'user' && req.method === 'GET') {
      const u = c.sub && await usuarioPorId(c.sub); if (!u) throw erroAuth(401, 'user_not_found', 'User not found');
      return enviar(res, 200, usuarioJson(u));
    }
    if (rota === 'user' && req.method === 'PUT') {
      if (!c.sub) throw erroAuth(401, 'no_authorization', 'Sem login');
      if (corpo.email) await pool.query('update auth.users set email = $2, updated_at = now() where id = $1', [c.sub, String(corpo.email).toLowerCase()]);
      if (corpo.password) await pool.query("update auth.users set encrypted_password = crypt($2, gen_salt('bf', 4)), updated_at = now() where id = $1", [c.sub, corpo.password]);
      if (corpo.data) await pool.query('update auth.users set raw_user_meta_data = raw_user_meta_data || $2, updated_at = now() where id = $1', [c.sub, corpo.data]);
      return enviar(res, 200, usuarioJson(await usuarioPorId(c.sub)));
    }
    if (rota === 'logout') return enviar(res, 204);
    if (rota === 'recover' || rota === 'otp') return enviar(res, 200, {});
    if (rota === 'invite' && req.method === 'POST') {
      if (c.role !== 'service_role') throw erroAuth(403, 'not_admin', 'Somente o servidor');
      const email = String(corpo.email || '').toLowerCase();
      const u = (await pool.query('insert into auth.users(email, raw_user_meta_data) values ($1, $2) on conflict (email) do update set updated_at = now() returning *', [email, corpo.data || {}])).rows[0];
      return enviar(res, 200, usuarioJson(u));
    }
    throw erroAuth(404, 'not_found', 'rota de login não simulada: ' + rota);
  }

  /* ---------- rest: tabelas ---------- */
  const fkCache = new Map();
  async function relacao(tabela, alvo) {
    const k = tabela + '>' + alvo; if (fkCache.has(k)) return fkCache.get(k);
    const sql = `select c.conrelid::regclass::text de, c.confrelid::regclass::text para,
        (select array_agg(a.attname::text order by x.n) from unnest(c.conkey) with ordinality x(k, n) join pg_attribute a on a.attrelid = c.conrelid and a.attnum = x.k) de_cols,
        (select array_agg(a.attname::text order by x.n) from unnest(c.confkey) with ordinality x(k, n) join pg_attribute a on a.attrelid = c.confrelid and a.attnum = x.k) para_cols
      from pg_constraint c where c.contype = 'f' and ((c.conrelid = $1::regclass and c.confrelid = $2::regclass) or (c.conrelid = $2::regclass and c.confrelid = $1::regclass))`;
    const r = (await pool.query(sql, ['public.' + tabela, 'public.' + alvo])).rows[0];
    let rel = null;
    if (r) rel = r.de.replace(/^public\./, '') === tabela ? { umParaUm: true, locais: r.de_cols, remotos: r.para_cols } : { umParaUm: false, locais: r.para_cols, remotos: r.de_cols };
    fkCache.set(k, rel); return rel;
  }
  function partes(s) { // separa por vírgula fora de parênteses
    const out = []; let n = 0, cur = '';
    for (const ch of s) { if (ch === '(') n++; if (ch === ')') n--; if (ch === ',' && !n) { out.push(cur.trim()); cur = ''; } else cur += ch; }
    if (cur.trim()) out.push(cur.trim()); return out;
  }
  async function colunasSelect(tabela, alias, sel) {
    const cols = [];
    for (const p of partes(sel || '*')) {
      const m = p.match(/^(?:([a-z_][a-z0-9_]*):)?([a-z_][a-z0-9_]*)(?:![a-z0-9_]+)?\((.*)\)$/s);
      if (m) {
        const [, apelido, alvo, sub] = m; const rel = await relacao(tabela, alvo);
        if (!rel) throw erroApi(400, 'PGRST200', `sem relação entre ${tabela} e ${alvo}`);
        const t2 = alias + '_' + alvo, cond = rel.locais.map((c, i) => `${t2}.${q(rel.remotos[i])} = ${alias}.${q(c)}`).join(' and ');
        const inner = await colunasSelect(alvo, t2, sub);
        const sqlSub = rel.umParaUm
          ? `(select jsonb_build_object(${inner.map(([n, e]) => `'${n}', ${e}`).join(', ')}) from public.${q(alvo)} ${t2} where ${cond} limit 1)`
          : `coalesce((select jsonb_agg(jsonb_build_object(${inner.map(([n, e]) => `'${n}', ${e}`).join(', ')})) from public.${q(alvo)} ${t2} where ${cond}), '[]'::jsonb)`;
        cols.push([apelido || alvo, sqlSub]);
      } else if (p === '*') {
        const r = await pool.query("select attname from pg_attribute where attrelid = $1::regclass and attnum > 0 and not attisdropped order by attnum", ['public.' + tabela]);
        r.rows.forEach(x => cols.push([x.attname, `${alias}.${q(x.attname)}`]));
      } else {
        const m2 = p.match(/^(?:([a-z_][a-z0-9_]*):)?([a-z_][a-z0-9_]*)(?:::[a-z]+)?$/);
        if (!m2) throw erroApi(400, 'PGRST100', 'select não entendido: ' + p);
        cols.push([m2[1] || m2[2], `${alias}.${q(m2[2])}`]);
      }
    }
    return cols;
  }
  const RESERVADOS = new Set(['select', 'order', 'limit', 'offset', 'on_conflict', 'columns']);
  function filtros(url, params, alias = 't') {
    const ws = [];
    const um = (col, expr) => {
      let neg = false; if (expr.startsWith('not.')) { neg = true; expr = expr.slice(4); }
      const i = expr.indexOf('.'); const op = expr.slice(0, i), v = expr.slice(i + 1);
      const c = `${alias}.${q(col)}`; let s;
      const p = x => { params.push(x); return `$${params.length}`; };
      if (op === 'eq') s = `${c} = ${p(v)}`; else if (op === 'neq') s = `${c} <> ${p(v)}`;
      else if (op === 'gt') s = `${c} > ${p(v)}`; else if (op === 'gte') s = `${c} >= ${p(v)}`;
      else if (op === 'lt') s = `${c} < ${p(v)}`; else if (op === 'lte') s = `${c} <= ${p(v)}`;
      else if (op === 'like') s = `${c}::text like ${p(v.replace(/\*/g, '%'))}`; else if (op === 'ilike') s = `${c}::text ilike ${p(v.replace(/\*/g, '%'))}`;
      else if (op === 'is') s = `${c} is ${v === 'null' ? 'null' : v === 'true' ? 'true' : v === 'false' ? 'false' : 'unknown'}`;
      else if (op === 'in') { const vals = partes(v.replace(/^\(|\)$/g, '')).map(x => x.replace(/^"|"$/g, '')); s = vals.length ? `${c}::text in (${vals.map(p).join(', ')})` : 'false'; }
      else throw erroApi(400, 'PGRST100', 'filtro não simulado: ' + op);
      return neg ? `not (${s})` : s;
    };
    for (const [k, v] of url.searchParams) if (!RESERVADOS.has(k)) ws.push(um(k, v));
    return ws.length ? ' where ' + ws.join(' and ') : '';
  }
  function ordem(url, alias = 't') {
    const o = url.searchParams.get('order'); if (!o) return '';
    return ' order by ' + o.split(',').map(x => { const [c, ...m] = x.split('.'); return `${alias}.${q(c)}${m.includes('desc') ? ' desc' : ' asc'}${m.includes('nullsfirst') ? ' nulls first' : m.includes('nullslast') ? ' nulls last' : ''}`; }).join(', ');
  }
  async function tabela(req, res, nome, corpo, url, claims) {
    q(nome);
    const prefer = String(req.headers.prefer || '');
    const objeto = /vnd\.pgrst\.object/.test(req.headers.accept || '');
    const retorna = /return=representation/.test(prefer);
    const cols = await colunasSelect(nome, 't', url.searchParams.get('select') || '*');
    const proj = cols.map(([n, e]) => `${e} as ${q(n)}`).join(', ');
    return comoQuem(claims, async cli => {
      const params = []; let linhas, total = null;
      if (req.method === 'GET' || req.method === 'HEAD') {
        const w = filtros(url, params);
        let sql = `select ${proj} from public.${q(nome)} t${w}${ordem(url)}`;
        const lim = url.searchParams.get('limit'), off = url.searchParams.get('offset');
        if (lim) sql += ` limit ${parseInt(lim, 10)}`; if (off) sql += ` offset ${parseInt(off, 10)}`;
        linhas = (await cli.query(sql, params)).rows;
        if (/count=exact/.test(prefer)) total = Number((await cli.query(`select count(*) n from public.${q(nome)} t${w}`, params)).rows[0].n);
      } else if (req.method === 'POST') {
        const lista = Array.isArray(corpo) ? corpo : [corpo];
        const chaves = [...new Set(lista.flatMap(o => Object.keys(o || {})))]; chaves.forEach(q);
        params.push(JSON.stringify(lista));
        let sql = `insert into public.${q(nome)} as t (${chaves.map(q).join(', ')}) select ${chaves.map(q).join(', ')} from jsonb_populate_recordset(null::public.${q(nome)}, $1::jsonb)`;
        const conflito = url.searchParams.get('on_conflict');
        if (/resolution=(merge|ignore)-duplicates/.test(prefer)) {
          const alvo = conflito ? conflito.split(',').map(s => q(s.trim())).join(', ') : null;
          if (!alvo) throw erroApi(400, 'PGRST100', 'upsert sem on_conflict não simulado');
          sql += /ignore-duplicates/.test(prefer) ? ` on conflict (${alvo}) do nothing` : ` on conflict (${alvo}) do update set ${chaves.map(c => `${q(c)} = excluded.${q(c)}`).join(', ')}`;
        }
        linhas = (await cli.query(`with t as (${sql} returning *) select ${proj} from t`, params)).rows;
      } else if (req.method === 'PATCH') {
        const chaves = Object.keys(corpo || {}); chaves.forEach(q);
        params.push(JSON.stringify(corpo || {}));
        const w = filtros(url, params);
        linhas = (await cli.query(`with t as (update public.${q(nome)} t set (${chaves.map(q).join(', ')}) = (select ${chaves.map(q).join(', ')} from jsonb_populate_record(null::public.${q(nome)}, $1::jsonb))${w} returning t.*) select ${proj} from t`, params)).rows;
      } else if (req.method === 'DELETE') {
        const w = filtros(url, params);
        linhas = (await cli.query(`with t as (delete from public.${q(nome)} t${w} returning t.*) select ${proj} from t`, params)).rows;
      } else throw erroApi(405, 'PGRST000', 'método não simulado');
      const extra = total != null ? { 'Content-Range': `0-${Math.max(0, linhas.length - 1)}/${total}` } : {};
      if (req.method !== 'GET' && !retorna) return enviar(res, req.method === 'POST' ? 201 : 204, undefined, extra);
      if (objeto) {
        if (linhas.length !== 1) throw erroApi(406, 'PGRST116', 'JSON object requested, multiple (or no) rows returned', `The result contains ${linhas.length} rows`);
        return enviar(res, 200, linhas[0], extra);
      }
      return enviar(res, 200, linhas, extra);
    });
  }

  /* ---------- rest: funções (rpc) ---------- */
  async function funcao(nome, chaves) {
    const r = await pool.query(`select p.oid, p.proname, p.proretset, p.pronargs, p.pronargdefaults, coalesce(p.proargnames, '{}') nomes, p.proargmodes modos,
        (select array_agg(format_type(t, null) order by i) from unnest(p.proargtypes) with ordinality u(t, i)) tipos,
        format_type(p.prorettype, null) ret, (select typtype from pg_type where oid = p.prorettype) rettipo
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = $1`, [nome]);
    for (const f of r.rows) {
      const entrada = f.modos ? f.nomes.filter((_, i) => ['i', 'b', 'v'].includes(f.modos[i])) : f.nomes.slice(0, f.pronargs);
      const obrig = entrada.slice(0, f.pronargs - f.pronargdefaults);
      if (chaves.every(k => entrada.includes(k)) && obrig.every(k => chaves.includes(k))) return { ...f, entrada };
    }
    throw erroApi(404, 'PGRST202', `Could not find the function public.${nome}(${chaves.join(', ')}) in the schema cache`);
  }
  async function rpc(req, res, nome, corpo, url, claims) {
    q(nome);
    const args = req.method === 'GET' ? Object.fromEntries(url.searchParams) : (corpo || {});
    const f = await funcao(nome, Object.keys(args));
    const params = [], lista = Object.keys(args).map(k => {
      const tipo = f.tipos[f.entrada.indexOf(k)]; let v = args[k];
      if (v !== null && typeof v === 'object' && !Array.isArray(v)) v = JSON.stringify(v);
      else if (Array.isArray(v) && /json/.test(tipo)) v = JSON.stringify(v);
      params.push(v); return `${q(k)} => $${params.length}::${tipo}`;
    });
    const chamada = `public.${q(nome)}(${lista.join(', ')})`;
    return comoQuem(claims, async cli => {
      if (f.proretset || f.rettipo === 'c' || (f.ret === 'record')) {
        const linhas = (await cli.query(`select * from ${chamada}`, params)).rows;
        const escalar = f.rettipo !== 'c' && f.ret !== 'record';
        const dados = escalar ? linhas.map(l => Object.values(l)[0]) : linhas;
        return enviar(res, 200, f.proretset ? dados : (dados[0] ?? null));
      }
      const v = (await cli.query(`select ${chamada} as v`, params)).rows[0].v;
      if (f.ret === 'void') return enviar(res, 204);
      return enviar(res, 200, v === undefined ? null : v);
    });
  }

  /* ---------- storage ---------- */
  async function storage(req, res, resto, corpoBruto, url, claims) {
    const ler = async (bucket, nome) => {
      const ok = await comoQuem(claims, cli => cli.query('select 1 from storage.objects where bucket_id = $1 and name = $2', [bucket, nome])).then(r => r.rowCount);
      const pub = (await pool.query('select public from storage.buckets where id = $1', [bucket])).rows[0]?.public;
      if (!ok && !pub) throw erroApi(400, 'not_found', 'Object not found');
      const arq = path.join(arquivos, bucket, nome);
      if (!fs.existsSync(arq)) throw erroApi(404, 'not_found', 'Object not found');
      const meta = (await pool.query('select metadata from storage.objects where bucket_id = $1 and name = $2', [bucket, nome])).rows[0]?.metadata || {};
      res.writeHead(200, { 'Content-Type': meta.mimetype || 'application/octet-stream', 'Access-Control-Allow-Origin': '*' }); res.end(fs.readFileSync(arq));
    };
    let m;
    if ((m = resto.match(/^object\/sign\/([^/]+)\/(.+)$/)) && req.method === 'GET') {
      const t = conferir(url.searchParams.get('token')); const nome = decodeURIComponent(m[2]);
      if (!t || t.url !== `${m[1]}/${nome}`) throw erroApi(400, 'InvalidSignature', 'token inválido');
      const arq = path.join(arquivos, m[1], nome); if (!fs.existsSync(arq)) throw erroApi(404, 'not_found', 'Object not found');
      res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Access-Control-Allow-Origin': '*' }); return res.end(fs.readFileSync(arq));
    }
    if ((m = resto.match(/^object\/sign\/([^/]+)\/(.+)$/)) && req.method === 'POST') {
      const corpo = JSON.parse(corpoBruto.toString() || '{}'), nome = decodeURIComponent(m[2]);
      const ok = (await comoQuem(claims, cli => cli.query('select 1 from storage.objects where bucket_id = $1 and name = $2', [m[1], nome]))).rowCount;
      if (!ok) throw erroApi(400, 'not_found', 'Object not found');
      const token = assinar({ url: `${m[1]}/${nome}`, exp: Math.floor(Date.now() / 1000) + Number(corpo.expiresIn || 60) });
      return enviar(res, 200, { signedURL: `/object/sign/${m[1]}/${encodeURI(nome)}?token=${token}` });
    }
    if ((m = resto.match(/^object\/sign\/([^/]+)$/)) && req.method === 'POST') {
      const corpo = JSON.parse(corpoBruto.toString() || '{}'); const out = [];
      for (const nome of corpo.paths || []) {
        const ok = (await comoQuem(claims, cli => cli.query('select 1 from storage.objects where bucket_id = $1 and name = $2', [m[1], nome]))).rowCount;
        out.push(ok ? { path: nome, error: null, signedURL: `/object/sign/${m[1]}/${encodeURI(nome)}?token=${assinar({ url: `${m[1]}/${nome}`, exp: Math.floor(Date.now() / 1000) + Number(corpo.expiresIn || 60) })}` } : { path: nome, error: 'Object not found', signedURL: null });
      }
      return enviar(res, 200, out);
    }
    if ((m = resto.match(/^object\/list\/([^/]+)$/)) && req.method === 'POST') {
      const corpo = JSON.parse(corpoBruto.toString() || '{}'); const pre = (corpo.prefix || '').replace(/\/?$/, corpo.prefix ? '/' : '');
      const r = await comoQuem(claims, cli => cli.query("select name, id, created_at, updated_at, metadata from storage.objects where bucket_id = $1 and name like $2 || '%' order by name limit $3", [m[1], pre, corpo.limit || 100]));
      return enviar(res, 200, r.rows.map(x => ({ ...x, name: x.name.slice(pre.length) })));
    }
    if ((m = resto.match(/^object\/(?:authenticated\/|public\/)?([^/]+)\/(.+)$/)) && req.method === 'GET') return ler(m[1], decodeURIComponent(m[2]));
    if ((m = resto.match(/^object\/([^/]+)\/(.+)$/)) && ['POST', 'PUT'].includes(req.method)) {
      const bucket = m[1], nome = decodeURIComponent(m[2]);
      const b = (await pool.query('select * from storage.buckets where id = $1', [bucket])).rows[0];
      if (!b) throw erroApi(404, 'Bucket not found', 'Bucket not found');
      const tipo = String(req.headers['content-type'] || 'application/octet-stream').split(';')[0];
      if (b.file_size_limit && corpoBruto.length > b.file_size_limit) throw erroApi(413, 'Payload too large', 'The object exceeded the maximum allowed size');
      if (b.allowed_mime_types?.length && !b.allowed_mime_types.includes(tipo)) throw erroApi(415, 'invalid_mime_type', `mime type ${tipo} is not supported`);
      const upsert = req.method === 'PUT' || String(req.headers['x-upsert']) === 'true';
      await comoQuem(claims, cli => cli.query(`insert into storage.objects(bucket_id, name, owner, metadata) values ($1, $2, $3, $4)${upsert ? ' on conflict (bucket_id, name) do update set updated_at = now(), metadata = excluded.metadata' : ''}`,
        [bucket, nome, claims.sub || null, { mimetype: tipo, size: corpoBruto.length }]))
        .catch(e => { if (e.code === '23505') throw erroApi(409, 'Duplicate', 'The resource already exists'); if (e.code === '42501') throw erroApi(403, 'Unauthorized', 'new row violates row-level security policy'); throw e; });
      const arq = path.join(arquivos, bucket, nome); fs.mkdirSync(path.dirname(arq), { recursive: true }); fs.writeFileSync(arq, corpoBruto);
      return enviar(res, 200, { Key: `${bucket}/${nome}`, Id: crypto.randomUUID(), path: nome });
    }
    if ((m = resto.match(/^object\/([^/]+)$/)) && req.method === 'DELETE') {
      const corpo = JSON.parse(corpoBruto.toString() || '{}');
      const r = await comoQuem(claims, cli => cli.query('delete from storage.objects where bucket_id = $1 and name = any($2) returning name, id', [m[1], corpo.prefixes || []]));
      r.rows.forEach(x => { try { fs.unlinkSync(path.join(arquivos, m[1], x.name)); } catch {} });
      return enviar(res, 200, r.rows);
    }
    throw erroApi(404, 'not_found', 'rota de arquivos não simulada: ' + resto);
  }

  /* ---------- http ---------- */
  const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS,HEAD', 'Access-Control-Expose-Headers': 'Content-Range, X-Total-Count' };
  function enviar(res, status, corpo, extra = {}) {
    if (corpo === undefined) { res.writeHead(status, { ...CORS, ...extra }); return res.end(); }
    res.writeHead(status, { ...CORS, 'Content-Type': 'application/json; charset=utf-8', ...extra }); res.end(JSON.stringify(corpo));
  }
  const servidor = http.createServer(async (req, res) => {
    if (req.method === 'OPTIONS') return enviar(res, 204);
    const url = new URL(req.url, URL_BASE);
    const pedacos = []; for await (const p of req) pedacos.push(p);
    const bruto = Buffer.concat(pedacos);
    try {
      let m;
      if ((m = url.pathname.match(/^\/auth\/v1\/([a-z]+)/))) {
        const corpo = bruto.length ? JSON.parse(bruto.toString()) : {};
        return await auth(req, res, m[1], corpo, url);
      }
      if ((m = url.pathname.match(/^\/storage\/v1\/(.+)$/))) {
        const claims = m[1].startsWith('object/sign/') && req.method === 'GET' ? {} : claimsDe(req);
        return await storage(req, res, m[1], bruto, url, claims);
      }
      const claims = claimsDe(req);
      const corpo = bruto.length ? JSON.parse(bruto.toString()) : {};
      if ((m = url.pathname.match(/^\/rest\/v1\/rpc\/([a-z0-9_]+)$/))) return await rpc(req, res, m[1], corpo, url, claims);
      if ((m = url.pathname.match(/^\/rest\/v1\/([a-z0-9_]+)$/))) return await tabela(req, res, m[1], corpo, url, claims);
      throw erroApi(404, 'PGRST000', 'rota não simulada: ' + url.pathname);
    } catch (e) {
      if (e.oauth) return enviar(res, e.status, { error: 'invalid_grant', error_description: e.message, error_code: e.code });
      if (url.pathname.startsWith('/auth/')) return enviar(res, e.status || 500, { code: e.status || 500, error_code: e.code || 'unexpected_failure', msg: e.message });
      if (url.pathname.startsWith('/storage/')) return enviar(res, e.status || 400, { statusCode: String(e.status || 400), error: e.code || 'Error', message: e.message });
      const status = e.api ? e.status : e.code === '42501' ? (conferir((req.headers.authorization || '').slice(7))?.role === 'anon' ? 401 : 403) : e.code === '23505' ? 409 : e.code === 'P0002' ? 404 : 400;
      return enviar(res, status, { code: e.code || 'PGRST000', message: e.message, details: e.details || e.detail || null, hint: e.hint || null });
    }
  });

  /* ---------- tempo real (websocket no formato do Supabase Realtime) ---------- */
  const wss = new WebSocketServer({ noServer: true });
  const inscricoes = new Set();   // { ws, topic, joinRef, bindings: [{id, event, table, filter}], claims, vsn }
  let idBinding = 1;
  function mandar(ws, vsn, joinRef, ref, topic, event, payload) {
    if (ws.readyState !== 1) return;
    ws.send(vsn === '1.0.0' ? JSON.stringify({ join_ref: joinRef, ref, topic, event, payload }) : JSON.stringify([joinRef, ref, topic, event, payload]));
  }
  servidor.on('upgrade', (req, sock, head) => {
    const url = new URL(req.url, URL_BASE);
    if (!url.pathname.startsWith('/realtime/v1/websocket')) return sock.destroy();
    wss.handleUpgrade(req, sock, head, ws => {
      const vsn = url.searchParams.get('vsn') || '1.0.0';
      const padrao = conferir(url.searchParams.get('apikey')) || { role: 'anon' };
      ws.on('message', dado => {
        let msg; try { const j = JSON.parse(dado.toString()); msg = Array.isArray(j) ? { join_ref: j[0], ref: j[1], topic: j[2], event: j[3], payload: j[4] } : j; } catch { return; }
        const { topic, event, payload = {}, ref } = msg, joinRef = msg.join_ref;
        if (topic === 'phoenix' && event === 'heartbeat') return mandar(ws, vsn, null, ref, 'phoenix', 'phx_reply', { status: 'ok', response: {} });
        if (event === 'phx_join') {
          const claims = conferir(payload.access_token) || padrao;
          const bindings = (payload.config?.postgres_changes || []).map(b => ({ ...b, id: idBinding++ }));
          inscricoes.add({ ws, topic, joinRef, bindings, claims, vsn });
          return mandar(ws, vsn, joinRef, ref, topic, 'phx_reply', { status: 'ok', response: { postgres_changes: bindings } });
        }
        if (event === 'access_token') { for (const i of inscricoes) if (i.ws === ws && i.topic === topic) i.claims = conferir(payload.access_token) || i.claims; return; }
        if (event === 'phx_leave') {
          for (const i of [...inscricoes]) if (i.ws === ws && i.topic === topic) inscricoes.delete(i);
          return mandar(ws, vsn, joinRef, ref, topic, 'phx_reply', { status: 'ok', response: {} });
        }
        if (ref) mandar(ws, vsn, joinRef, ref, topic, 'phx_reply', { status: 'ok', response: {} });
      });
      ws.on('close', () => { for (const i of [...inscricoes]) if (i.ws === ws) inscricoes.delete(i); });
    });
  });
  let ouvinte = null;
  async function ouvir() {
    ouvinte = new Client({ host: '127.0.0.1', port: pgPorta, user: 'postgres', database: banco });
    await ouvinte.connect();
    await ouvinte.query('listen teste_itens'); await ouvinte.query('listen teste_broadcast');
    ouvinte.on('notification', async n => {
      let d; try { d = JSON.parse(n.payload); } catch { return; }
      if (n.channel === 'teste_broadcast') {
        for (const i of inscricoes) if (i.topic === 'realtime:' + d.topic) mandar(i.ws, i.vsn, i.joinRef, null, i.topic, 'broadcast', { type: 'broadcast', event: d.event, payload: d.payload });
        return;
      }
      const tipo = d.type;
      for (const i of inscricoes) {
        const ids = i.bindings.filter(b => b.table === 'itens' && (b.event === '*' || b.event === tipo) && (!b.filter || b.filter === `loja_id=eq.${d.loja_id}`)).map(b => b.id);
        if (!ids.length) continue;
        try {
          let record = null;
          if (tipo === 'DELETE') {
            const pode = await comoQuem(i.claims, cli => cli.query('select $1::uuid in (select public.minhas_lojas()) ok', [d.loja_id])).then(r => r.rows[0]?.ok);
            if (!pode) continue;
          } else {
            record = await comoQuem(i.claims, cli => cli.query('select to_jsonb(t) r from public.itens t where loja_id = $1 and colecao = $2 and id = $3', [d.loja_id, d.colecao, d.id])).then(r => r.rows[0]?.r);
            if (!record) continue;   // quem não pode ver a linha não recebe o aviso (como no Supabase)
          }
          mandar(i.ws, i.vsn, i.joinRef, null, i.topic, 'postgres_changes', { ids, data: { schema: 'public', table: 'itens', commit_timestamp: new Date().toISOString(), type: tipo, columns: [], record: record || {}, old_record: tipo === 'INSERT' ? {} : { loja_id: d.loja_id, colecao: d.colecao, id: d.id }, errors: null } });
        } catch {}
      }
    });
  }

  /* ---------- o app (arquivos estáticos + as mesmas reescritas do vercel.json) ---------- */
  const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };
  const PUBLICAS = [[/^\/acompanhar\/[^/]+$/, '/acompanhar.html'], [/^\/pedido(\/[^/]+)?$/, '/pedido.html'], [/^\/vitrine(\/[^/]+)?$/, '/vitrine.html'], [/^\/admin$/, '/admin.html']];
  const app = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p === '/js/config.js') {
      res.writeHead(200, { 'Content-Type': TIPOS['.js'], 'Cache-Control': 'no-store' });
      return res.end(`window.OFICINA_CONFIG = ${JSON.stringify({ supabaseUrl: URL_BASE, supabaseAnonKey: ANON_KEY, ambiente: 'production', dominio })};\n`);
    }
    for (const [re, alvo] of PUBLICAS) if (re.test(p)) p = alvo;
    if (p === '/') p = '/index.html';
    const arq = path.join(RAIZ, path.normalize(p).replace(/^(\.\.[/\\])+/, ''));
    if (!arq.startsWith(RAIZ) || /[/\\](\.git|\.pgtest|node_modules|tests|supabase|api)([/\\]|$)/.test(arq.slice(RAIZ.length)) || !fs.existsSync(arq) || fs.statSync(arq).isDirectory()) { res.writeHead(404); return res.end('não encontrado'); }
    res.writeHead(200, { 'Content-Type': TIPOS[path.extname(arq)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(fs.readFileSync(arq));
  });

  return {
    ANON_KEY, SERVICE_KEY, URL_BASE, URL_APP: `http://127.0.0.1:${portaApp}`, pool,
    async ligar() { await ouvir(); await new Promise(r => servidor.listen(porta, '127.0.0.1', r)); await new Promise(r => app.listen(portaApp, '127.0.0.1', r)); return this; },
    async desligar() { for (const c of wss.clients) c.terminate(); await new Promise(r => servidor.close(r)); await new Promise(r => app.close(r)); await ouvinte?.end(); await pool.end(); },
  };
}
module.exports = { criar, assinar, conferir, ANON_KEY, SERVICE_KEY };

if (require.main === module) {
  const { preparar } = require('../db/preparar.cjs');
  const banco = process.env.PGTEST_DB || 'oficina_teste';
  if (!process.env.SEM_PREPARAR) preparar(banco);
  criar({ banco, dominio: process.env.OFICINA_DOMINIO || 'oficina.test' }).ligar().then(s => console.log(`Supabase de teste em ${s.URL_BASE} · app em ${s.URL_APP}`));
}
