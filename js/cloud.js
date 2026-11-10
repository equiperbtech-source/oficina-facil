/* Nuvem (Supabase): autenticação, loja e sincronização.
   Os dados continuam salvos no aparelho (funciona offline); cada registro alterado
   é enviado para a tabela "itens" e mudanças de outros aparelhos chegam em tempo real. */
const SYNC_COLS = ['clientes', 'os', 'orcamentos', 'pecas', 'fornecedores', 'movEstoque', 'produtos', 'vendas', 'servicos', 'lancamentos', 'caixas', 'auditoria', 'pedidos',
  'lotes', 'nfe_entradas', 'followups', 'metas_func', 'pedidos_vitrine'];
const META_KEYS = ['settings', 'seq'];
const SNAP_KEY = 'oficina_sync_snap';

// Junta três versões (base = última sincronizada, servidor, local): vale o que mudou neste aparelho,
// o resto vem do servidor. Entra nos objetos (ex.: metas → cada meta → quantidade ajustada) e nas listas
// com id (itens das metas), para uma mudança pequena aqui não desfazer outra feita em outro aparelho.
const copia = v => v === undefined ? undefined : JSON.parse(JSON.stringify(v)); // base nunca aponta para o objeto em uso
const ehObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const listaComId = v => Array.isArray(v) && v.length > 0 && v.every(x => ehObj(x) && x.id != null);
function mesclar(base, servidor, local) {
  const igual = (a, b) => stableStr(a) === stableStr(b);
  if (local === undefined) return base !== undefined && servidor !== undefined && !igual(base, servidor) ? servidor : base === undefined ? servidor : undefined;
  if (servidor === undefined) return base !== undefined && igual(local, base) ? undefined : local; // apagado no servidor / novo aqui
  if (igual(local, servidor) || (base !== undefined && igual(local, base))) return servidor;
  if (ehObj(local) && ehObj(servidor)) {
    const b = ehObj(base) ? base : undefined, out = {};
    for (const k of new Set([...Object.keys(servidor), ...Object.keys(local)])) {
      const v = b ? mesclar(b[k], servidor[k], local[k]) : local[k] === undefined || servidor[k] === undefined ? (servidor[k] ?? local[k]) : mesclar(undefined, servidor[k], local[k]);
      if (v !== undefined) out[k] = v;
    }
    return out;
  }
  if ((listaComId(local) || listaComId(servidor)) && Array.isArray(local) && Array.isArray(servidor)) {
    const mapa = a => new Map((Array.isArray(a) ? a : []).filter(ehObj).map(x => [String(x.id), x]));
    const mb = listaComId(base) ? mapa(base) : null, ms = mapa(servidor), ml = mapa(local), out = [];
    for (const id of new Set([...ml.keys(), ...ms.keys()])) {
      const v = mb ? mesclar(mb.get(id), ms.get(id), ml.get(id)) : ms.has(id) && ml.has(id) ? mesclar(undefined, ms.get(id), ml.get(id)) : ms.get(id) ?? ml.get(id);
      if (v !== undefined) out.push(v);
    }
    return out;
  }
  return base === undefined ? servidor : local; // valor simples mudado aqui (sem base: fica o do servidor)
}

// JSON com chaves ordenadas: o jsonb do Postgres reordena chaves, então comparamos sempre nesta forma
function stableStr(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return '[' + v.map(x => x === undefined ? 'null' : stableStr(x)).join(',') + ']';
  return '{' + Object.keys(v).filter(k => v[k] !== undefined && typeof v[k] !== 'function').sort().map(k => JSON.stringify(k) + ':' + stableStr(v[k])).join(',') + '}';
}
function hash(s) { // cyrb53
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

const Cloud = {
  sb: null,
  user: null,
  loja: null,      // { id, nome, codigo_convite, papel }
  status: 'off',   // off | ok | sync | offline | erro
  snap: {},        // "colecao:id" -> hash do que está no servidor
  timer: null,
  pushing: false,
  again: false,
  channel: null,
  refreshTimer: null,

  get enabled() { const c = window.OFICINA_CONFIG || {}; return !!(c.supabaseUrl && c.supabaseAnonKey && window.supabase); },

  async init() {
    if (!this.enabled) return;
    const c = window.OFICINA_CONFIG;
    // veio pelo link do convite por e-mail: depois de entrar, pede para criar a senha
    if (/type=invite/.test(location.hash)) this.recovery = true;
    this.sb = supabase.createClient(c.supabaseUrl, c.supabaseAnonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
    const { data, error } = await this.sb.auth.getSession();
    this.user = data.session?.user || null;
    if (!this.user && error) {
      // sem internet e o login precisa ser renovado: continua com o último usuário (renova quando a conexão voltar)
      try { const c = JSON.parse(localStorage.getItem('oficina_loja')); if (c?.user) this.user = c.user; } catch {}
    }
    this.sb.auth.onAuthStateChange((ev, session) => {
      if (ev === 'SIGNED_OUT' || session) this.user = session?.user || null;
      if (ev === 'USER_UPDATED' && this.loja) this.sincronizarEmail(); // e-mail novo confirmado
      if (ev === 'PASSWORD_RECOVERY') { this.recovery = true; if ($('#app').children.length) setTimeout(() => App.checkRecovery(), 0); }
    });
    addEventListener('online', () => this.schedule(0));
    // ao sair do app (ex.: abrir o WhatsApp) envia na hora o que ficou pendente; ao voltar, atualiza
    document.addEventListener('visibilitychange', () => { if (!this.loja) return; if (document.hidden) this.push().catch(() => {}); else this.pull().catch(() => {}); });
    addEventListener('offline', () => this.setStatus('offline'));
  },

  /* ---------- Autenticação ---------- */
  async signIn(email, senha) {
    const { data, error } = await this.sb.auth.signInWithPassword({ email, password: senha });
    if (error) throw new Error(error.message.includes('Invalid login') ? 'E-mail ou senha incorretos' : error.message.includes('not confirmed') ? 'Confirme seu e-mail antes de entrar (veja sua caixa de entrada).' : error.message);
    this.user = data.user;
  },
  async signUp(email, senha) {
    const { data, error } = await this.sb.auth.signUp({ email, password: senha, options: { emailRedirectTo: location.origin + location.pathname } });
    if (error) throw new Error(error.message.includes('already') ? 'Este e-mail já tem conta. Use "Entrar".' : error.message);
    this.user = data.session ? data.user : null;
    return !!data.session; // false = precisa confirmar e-mail
  },
  async resetSenha(email) {
    const { error } = await this.sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
    if (error) throw new Error(error.message);
  },
  // Troca o e-mail de login: o Supabase manda um link de confirmação; a oficina continua ligada à mesma conta
  async alterarEmail(email) {
    const { error } = await this.sb.auth.updateUser({ email }, { emailRedirectTo: location.origin });
    if (error) throw new Error(/already|registered|exists/i.test(error.message) ? 'Este e-mail já tem uma conta na Oficina Simples' : /rate|seconds/i.test(error.message) ? 'Aguarde um minuto e tente de novo' : error.message);
  },
  // depois de confirmar o e-mail novo: atualiza o e-mail guardado na equipe (usado para achar a oficina numa compra)
  async sincronizarEmail() { try { await this.sb.rpc('sincronizar_meu_email'); } catch {} },
  async emailDaCompra() { try { const r = await this.sb.rpc('email_da_compra', { p_loja: this.loja.id }); return r.error ? null : r.data; } catch { return null; } },
  async novaSenha(senha) {
    const { error } = await this.sb.auth.updateUser({ password: senha });
    if (error) throw new Error(error.message);
  },
  async signOut() {
    this.stop();
    await this.sb.auth.signOut().catch(() => {});
    this.user = null; this.loja = null;
    localStorage.removeItem(DB_KEY); localStorage.removeItem(SNAP_KEY); localStorage.removeItem('oficina_loja');
    Store.load();
  },

  /* ---------- Loja ---------- */
  async carregarLoja() {
    const { data, error } = await this.sb.from('membros').select('papel, lojas(id, nome, codigo_convite)').eq('user_id', this.user.id).order('criado_em');
    if (error) throw error;
    const ls = (data || []).filter(m => m.lojas);
    this.lojas = ls.map(m => ({ ...m.lojas, papel: m.papel }));
    // ordem de escolha: a oficina que a pessoa escolheu por último, a oficina do endereço acessado,
    // a oficina da equipe em que foi adicionada como funcionário e, por fim, a primeira
    let id = null;
    try { id = localStorage.getItem('oficina_loja_escolhida'); } catch {}
    if (!this.lojas.some(l => l.id === id)) id = null;
    if (!id && this.lojas.length > 1) {
      try { const r = await this.sb.rpc('loja_por_host', { p_host: location.host }); if (r.data?.id && this.lojas.some(l => l.id === r.data.id)) id = r.data.id; } catch {}
    }
    const m = this.lojas.find(l => l.id === id) || this.lojas.find(l => l.papel !== 'dono' && l.papel !== 'suporte') || this.lojas[0];
    this.loja = m || null;
    if (this.loja) await this.carregarSlug();
    return this.loja;
  },
  // endereço curto da oficina (coluna criada na etapa 1 do SaaS; sem ela, segue sem slug)
  async carregarSlug() {
    try { const r = await this.sb.from('lojas').select('slug').eq('id', this.loja.id).maybeSingle(); if (!r.error) this.loja.slug = r.data?.slug || null; } catch {}
  },
  // troca de loja (quem participa de mais de uma): lembra a escolha e recarrega o app
  trocarLoja(id) {
    try { localStorage.setItem('oficina_loja_escolhida', id); } catch {}
    location.reload();
  },
  async definirSlug(slug) {
    const { data, error } = await this.sb.rpc('definir_slug', { p_loja: this.loja.id, p_slug: slug });
    if (error) throw new Error(/does not exist|Could not find/i.test(error.message) ? 'Rode a migração da etapa 1 no Supabase' : /formato|check/i.test(error.message) ? 'Use só letras minúsculas, números e hífen (3 a 40)' : error.message);
    this.loja.slug = data;
    return data;
  },
  async criarLoja(nome) {
    const { data, error } = await this.sb.rpc('criar_loja', { p_nome: nome });
    if (error) throw new Error(error.message);
    this.loja = { ...data, papel: 'dono' };
    // a oficina nasce no idioma escolhido no cadastro (banco sem a etapa 13: segue em português)
    if (typeof I18N !== 'undefined' && I18N.idioma !== 'pt') await this.definirIdioma(I18N.idioma).catch(() => {});
  },
  // Código de convite: só envia um pedido; o dono aprova em Equipe. Devolve { nome, situacao }.
  async entrarNaLoja(codigo) {
    const { data, error } = await this.sb.rpc('entrar_na_loja', { p_codigo: codigo });
    if (error) throw new Error(error.message);
    if (data?.situacao === 'invalido') throw new Error('Código de convite inválido');
    return data || {};
  },
  async meusPedidosPendentes() {
    const { data, error } = await this.sb.rpc('meus_pedidos_pendentes', {});
    return error ? [] : data || [];
  },
  aprovarMembro(uid) { return this.definirAtivo(uid, true); },
  async membros() {
    let r = await this.sb.from('membros').select('user_id, email, nome, papel, criado_em, notificar_pedidos, ativo, pendente, pedido_em').eq('loja_id', this.loja.id).order('criado_em');
    if (r.error && /pendente|pedido_em/.test(r.error.message)) r = await this.sb.from('membros').select('user_id, email, nome, papel, criado_em, notificar_pedidos, ativo').eq('loja_id', this.loja.id).order('criado_em');
    // banco sem a etapa 2 (coluna ativo) ou sem a coluna de aviso por e-mail
    if (r.error && /ativo/.test(r.error.message)) r = await this.sb.from('membros').select('user_id, email, nome, papel, criado_em, notificar_pedidos').eq('loja_id', this.loja.id).order('criado_em');
    if (r.error && /notificar_pedidos/.test(r.error.message)) r = await this.sb.from('membros').select('user_id, email, nome, papel, criado_em').eq('loja_id', this.loja.id).order('criado_em');
    if (r.error) throw r.error;
    return r.data;
  },
  // Aviso de pedidos por e-mail (envio feito pelo banco via Brevo)
  async rpcEmail(fn, args = {}) {
    const { data, error } = await this.sb.rpc(fn, { p_loja: this.loja.id, ...args });
    if (error) throw new Error(/does not exist|Could not find/i.test(error.message) ? 'Rode o schema.sql atualizado no Supabase para ativar os avisos por e-mail' : error.message);
    return data;
  },
  statusEmail() { return this.rpcEmail('status_email'); },
  configurarEmail(apiKey, remetente, ativo) { return this.rpcEmail('configurar_email', { p_api_key: apiKey || '', p_remetente: remetente, p_site: location.origin, p_ativo: ativo }); },
  testarEmail() { return this.rpcEmail('testar_email'); },
  async resultadoEmail(id) { const { data } = await this.sb.rpc('resultado_email', { p_id: id }); return data; },
  avisoEmail(uid, ativo) { return this.rpcEmail('definir_aviso_email', { p_user: uid, p_ativo: ativo }); },
  // Dono cria login e senha do funcionário. Usa um cliente separado para não trocar a sessão do dono.
  async criarFuncionario(nome, email, senha) {
    const c = window.OFICINA_CONFIG;
    const tmp = supabase.createClient(c.supabaseUrl, c.supabaseAnonKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'oficina-novo-func' } });
    const { data, error } = await tmp.auth.signUp({ email, password: senha, options: { data: { nome } } });
    let jaExistia = false;
    if (error) { if (/already|registered|exists/i.test(error.message)) jaExistia = true; else throw new Error(error.message.includes('Password') ? 'Senha fraca: use pelo menos 6 caracteres' : error.message); }
    else if (data.user && Array.isArray(data.user.identities) && !data.user.identities.length) jaExistia = true;
    await tmp.auth.signOut().catch(() => {});
    const r = await this.sb.rpc('adicionar_funcionario', { p_loja: this.loja.id, p_email: email, p_nome: nome });
    if (r.error) throw new Error(r.error.message);
    return { jaExistia, confirmado: !!r.data?.confirmado, userId: r.data?.user_id };
  },
  async definirPapel(uid, papel) {
    const { error } = await this.sb.rpc('definir_papel', { p_loja: this.loja.id, p_user: uid, p_papel: papel });
    if (error) throw new Error(error.message);
  },
  async definirAtivo(uid, ativo) {
    const { error } = await this.sb.rpc('definir_membro_ativo', { p_loja: this.loja.id, p_user: uid, p_ativo: ativo });
    if (error) throw new Error(error.message);
  },
  // Rotas do servidor (/api) recebem o token do usuário; elas conferem tudo de novo no banco
  async api(caminho, corpo) {
    const { data } = await this.sb.auth.getSession();
    const token = data?.session?.access_token;
    const r = await fetch('/api/' + caminho, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(corpo || {}) });
    let j = {}; try { j = await r.json(); } catch {}
    if (!r.ok) throw new Error(j.erro || (r.status === 404 ? 'Função do servidor ainda não publicada' : 'Erro no servidor (' + r.status + ')'));
    return j;
  },
  // Convite por e-mail: a pessoa recebe um link para criar a senha e já entra na equipe
  convidar(email, nome, papel) { return this.api('equipe/convidar', { loja_id: this.loja.id, email, nome, papel, site: location.origin }); },
  async removerMembro(uid) {
    const { error } = await this.sb.from('membros').delete().eq('loja_id', this.loja.id).eq('user_id', uid);
    if (error) throw new Error(error.message);
  },
  async novoCodigo() {
    const { data, error } = await this.sb.rpc('novo_codigo_convite', { p_loja: this.loja.id });
    if (error) throw new Error(error.message);
    this.loja.codigo_convite = data;
    return data;
  },

  // Só o dono altera as informações da oficina (configurações). Sem nuvem, quem usa é o dono.
  ehDono() { return !this.enabled || !this.loja || this.loja.papel === 'dono'; },

  /* ---------- Plano, recursos e papel (o banco valida tudo; aqui só adapta a tela e a sincronização) ---------- */
  // Situação da assinatura vinda do banco (etapa 2 do SaaS). Sem ela (banco antigo), nada é restringido.
  async carregarAssinatura() {
    if (!this.loja) return null;
    try {
      const { data, error } = await this.sb.rpc('minha_assinatura', { p_loja: this.loja.id });
      if (!error && data) { this.loja.assinatura = data; if (data.papel) this.loja.papel = data.papel === 'atendente' && this.loja.papel === 'membro' ? 'membro' : data.papel; }
      // dono: quantos pedidos de entrada na equipe esperam aprovação (código de convite)
      if (this.loja.papel === 'dono') {
        const p = await this.sb.rpc('pedidos_equipe', { p_loja: this.loja.id });
        this.pedidosEquipe = p.error ? 0 : p.data || 0;
      }
    } catch {}
    return this.loja.assinatura || null;
  },
  assinatura() { return this.enabled && this.loja ? this.loja.assinatura || null : null; },
  // Aparência da oficina (etapa 6). Sem a tabela (banco antigo), segue a identidade original.
  async carregarTema() {
    if (!this.loja) return null;
    try { const { data, error } = await this.sb.from('lojas_tema').select('*').eq('loja_id', this.loja.id).limit(1); if (!error && data?.[0]) this.loja.tema = data[0]; } catch {}
    // quem ainda não escolheu um idioma usa o da oficina
    if (this.loja.tema?.idioma && typeof I18N !== 'undefined') I18N.usarDaLoja(this.loja.tema.idioma);
    return this.loja.tema || null;
  },
  // idioma da oficina: páginas do cliente final (acompanhamento, vitrine) e quem ainda não escolheu
  async definirIdioma(idioma) {
    const { error } = await this.sb.rpc('definir_idioma', { p_loja: this.loja.id, p_idioma: idioma });
    if (error) throw new Error(error.message);
    if (this.loja.tema) this.loja.tema.idioma = idioma;
  },
  // Tema público pelo endereço acessado (tela de login no domínio da oficina)
  async temaPublico() {
    // só no endereço da própria oficina (subdomínio ou domínio dela); no endereço principal fica a marca Oficina Simples.
    // undefined = não deu para conferir (sem internet); null = endereço sem oficina
    const l = await this.lojaDoHost();
    if (l === 'erro') return undefined;
    if (!l) return null;
    try {
      const t = await this.sb.rpc('tema_publico', { p_loja: l.id });
      if (t.error) return undefined;
      // loja que ainda não personalizou a aparência: pelo menos o nome dela
      return t.data || (l.nome ? { nome_exibicao: l.nome } : null);
    } catch { return undefined; }
  },
  // Loja do endereço acessado: domínio próprio, <nome>.<dominio> (mesmo sem "dominios_base" no admin).
  // { id, nome } | null (nenhuma oficina) | 'erro' (não deu para conferir)
  async lojaDoHost() {
    if (this._lojaHost !== undefined) return this._lojaHost;
    if (!this.sb) return 'erro';
    const base = String(PLATAFORMA.dominio || '').toLowerCase(), h = location.hostname.toLowerCase();
    try {
      const a = await this.sb.rpc('loja_por_host', { p_host: location.host });
      if (a.error) return 'erro';
      let l = a.data?.id ? { id: a.data.id, nome: a.data.nome || '' } : null;
      const sub = base && h.endsWith('.' + base) ? h.slice(0, -base.length - 1) : '';
      if (!l && sub && !sub.includes('.') && !['app', 'www', 'admin'].includes(sub)) {
        const s = await this.sb.rpc('loja_por_slug', { p_slug: sub });
        if (s.error) return 'erro';
        if (s.data) l = { id: s.data, nome: '' };
      }
      return (this._lojaHost = l);
    } catch { return 'erro'; }
  },
  // <nome>.<dominio> sem oficina com esse endereço: não abre o sistema (o domínio aceita qualquer nome)
  async hostDesconhecido() {
    const base = String(PLATAFORMA.dominio || '').toLowerCase(), h = location.hostname.toLowerCase();
    if (!this.sb || !base || !h.endsWith('.' + base)) return false;
    const sub = h.slice(0, -base.length - 1);
    if (['app', 'www', 'admin'].includes(sub)) return false;
    return (await this.lojaDoHost()) === null; // sem internet ou erro: na dúvida, abre normalmente
  },
  // papel normalizado: dono | atendente | tecnico | suporte
  papel() { if (!this.enabled || !this.loja) return 'dono'; const p = this.loja.papel; return p === 'membro' ? 'atendente' : p || 'atendente'; },
  temRecurso(r) { const a = this.assinatura(); return !a || (a.recursos || []).includes(r); },
  podeEscrever() { if (this.papel() === 'suporte') return false; const a = this.assinatura(); return !a || a.pode_escrever !== false; },
  // mesmas regras do banco (pode_gravar_colecao): o que não pode gravar nem tenta enviar
  podeGravar(col, id) {
    if (!this.podeEscrever()) return false;
    const papel = this.papel();
    if (col === 'meta' && id === 'settings') return papel === 'dono';
    if (papel === 'tecnico' && ['vendas', 'lancamentos', 'caixas'].includes(col)) return false;
    if (col === 'followups') return this.temRecurso('followup');
    if (col === 'metas_func') return this.temRecurso('metas');
    return true;
  },

  /* ---------- Sincronização ---------- */
  // Liga a sincronização para a oficina atual. enviarLocais = sobe os dados que já estão no aparelho.
  async start(enviarLocais = false) {
    const lojaId = this.loja.id;
    let fresh = false; // aparelho novo nesta oficina: a nuvem manda, nada local é pendência
    if (Store.db.lojaId !== lojaId) {
      const enviar = enviarLocais && !Store.db.lojaId;
      if (!enviar) { const auth = Store.db.auth; Store.db = defaultDB(); Store.db.auth = auth; fresh = true; }
      Store.db.lojaId = lojaId;
      this.snap = {}; this.base = {};
      Store.save(true);
    } else {
      try { const s = JSON.parse(localStorage.getItem(SNAP_KEY)); this.snap = s && s.lojaId === lojaId ? s.map : {}; this.base = (s && s.lojaId === lojaId && s.base) || {}; } catch { this.snap = {}; this.base = {}; }
    }
    // primeiro envia o que ficou pendente offline, depois baixa tudo. As configurações (meta) não vão antes
    // de baixar: um aparelho com cópia antiga não pode sobrescrever o que foi salvo em outro (ver pull)
    this.metaPronta = false; // configurações só sobem depois do primeiro download (ver push)
    if (!fresh) await this.push({ semMeta: true }).catch(() => {});
    await this.pull(fresh);
    this.subscribe();
  },
  stop() {
    clearTimeout(this.timer);
    if (this.channel) { this.sb.removeChannel(this.channel); this.channel = null; }
    this.setStatus('off');
  },

  setStatus(s) {
    this.status = s;
    const el = $('#sync-ind'); if (!el) return;
    const map = { ok: ['checkCircle', 'Sincronizado', 'var(--green)'], sync: ['repeat', 'Sincronizando...', 'var(--gold)'], offline: ['alert', 'Sem internet — salvo no aparelho', 'var(--orange)'], erro: ['alert', 'Erro ao sincronizar — toque para tentar de novo', 'var(--red)'], off: ['info', 'Modo local', 'var(--muted)'] };
    const [ic, t, c] = map[s] || map.off;
    el.innerHTML = icon(ic, 'sm'); el.title = t; el.style.color = c;
  },

  saveSnap() { try { localStorage.setItem(SNAP_KEY, JSON.stringify({ lojaId: this.loja?.id, map: this.snap, base: this.base || {} })); } catch {} },
  // Configurações da oficina: mescla campo a campo. Vale o que mudou NESTE aparelho desde a última sincronização
  // (comparado com a base); todo o resto vem do servidor. Sem base (aparelho antigo), só completa o que falta.
  mesclarMeta(id, servidor, local) {
    if (id === 'seq') { // contadores (próximo nº de OS, venda...): sempre o maior, para nunca repetir número
      const out = { ...servidor };
      for (const [k, v] of Object.entries(local || {})) out[k] = typeof v === 'number' && typeof servidor[k] === 'number' ? Math.max(v, servidor[k]) : k in servidor ? servidor[k] : v;
      return out;
    }
    return mesclar(this.base?.[id], servidor, local) ?? {};
  },

  // Mapa "colecao:id" -> {col, id, obj, str} do estado local atual
  localMap() {
    const m = new Map();
    for (const col of SYNC_COLS) for (const o of Store.db[col] || []) if (o && o.id) { const s = stableStr(o); m.set(col + ':' + o.id, { col, id: String(o.id), obj: o, str: s }); }
    for (const k of META_KEYS) { const s = stableStr(Store.db[k]); m.set('meta:' + k, { col: 'meta', id: k, obj: Store.db[k], str: s }); }
    return m;
  },

  schedule(ms = 700) {
    if (!this.loja || !this.sb) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.push().catch(() => {}), ms);
  },

  async push({ semMeta = false } = {}) {
    if (!this.loja) return;
    if (this.pushing) { this.again = true; return; }
    if (!this.metaPronta) semMeta = true; // ainda baixando: uma cópia antiga das configurações não pode subir antes
    if (!navigator.onLine) { this.setStatus('offline'); return; }
    this.pushing = true;
    try {
      const local = this.localMap();
      const up = [], del = [];
      const todos = new Set(local.keys());
      // não envia o que o papel/plano não permite gravar (o banco recusaria e travaria a sincronização)
      for (const [k, v] of [...local]) if (!this.podeGravar(v.col, v.id) || (semMeta && v.col === 'meta')) local.delete(k);
      for (const [k, v] of local) { const h = hash(v.str); if (this.snap[k] !== h) up.push({ k, h, row: { loja_id: this.loja.id, colecao: v.col, id: v.id, dados: JSON.parse(v.str) } }); }
      // apagados neste aparelho (técnico não apaga; o que não pode gravar também não apaga)
      for (const k of Object.keys(this.snap)) if (!todos.has(k)) { const i = k.indexOf(':'); if (this.papel() !== 'tecnico' && this.podeGravar(k.slice(0, i), k.slice(i + 1))) del.push(k); }
      if (!up.length && !del.length) { this.setStatus('ok'); return; }
      this.setStatus('sync');
      // configurações: antes de enviar, junta com a versão atual do servidor (só sobe o que mudou neste aparelho)
      for (const p of up) {
        if (p.row.colecao !== 'meta') continue;
        const { data, error } = await this.sb.from('itens').select('dados').eq('loja_id', this.loja.id).eq('colecao', 'meta').eq('id', p.row.id).maybeSingle();
        if (error) throw error;
        if (!data?.dados) continue;
        const junto = this.mesclarMeta(p.row.id, data.dados, p.row.dados);
        p.row.dados = junto; p.h = hash(stableStr(junto));
        this.applyRow('meta', p.row.id, junto);
      }
      for (let i = 0; i < up.length; i += 400) {
        const part = up.slice(i, i + 400);
        const { error } = await this.sb.from('itens').upsert(part.map(p => p.row), { onConflict: 'loja_id,colecao,id' });
        if (error) throw error;
        part.forEach(p => { this.snap[p.k] = p.h; if (p.row.colecao === 'meta') (this.base ||= {})[p.row.id] = copia(p.row.dados); });
        this.saveSnap();
      }
      const byCol = {};
      del.forEach(k => { const i = k.indexOf(':'); (byCol[k.slice(0, i)] ||= []).push(k.slice(i + 1)); });
      for (const [col, ids] of Object.entries(byCol)) {
        for (let i = 0; i < ids.length; i += 200) {
          const part = ids.slice(i, i + 200);
          const { error } = await this.sb.from('itens').delete().eq('loja_id', this.loja.id).eq('colecao', col).in('id', part);
          if (error) throw error;
          part.forEach(id => delete this.snap[col + ':' + id]);
          this.saveSnap();
        }
      }
      this.setStatus('ok');
    } catch (e) {
      console.warn('sync push', e);
      this.setStatus(navigator.onLine ? 'erro' : 'offline');
      clearTimeout(this.timer); this.timer = setTimeout(() => this.push().catch(() => {}), 15000);
      throw e;
    } finally {
      this.pushing = false;
      if (this.again) { this.again = false; this.schedule(200); }
    }
  },

  async pull(fresh = false) {
    if (!navigator.onLine) { this.setStatus('offline'); return; }
    this.setStatus('sync');
    const rows = [];
    try {
      for (let from = 0; ; from += 1000) {
        const { data, error } = await this.sb.from('itens').select('colecao, id, dados').eq('loja_id', this.loja.id).order('colecao').order('id').range(from, from + 999);
        if (error) throw error;
        rows.push(...data);
        if (data.length < 1000) break;
      }
    } catch (e) { console.warn('sync pull', e); this.setStatus('erro'); return; }
    // pendências locais (feitas durante o download) têm prioridade
    const local = this.localMap();
    const pend = fresh ? new Set() : new Set([...local].filter(([k, v]) => this.snap[k] !== hash(v.str)).map(([k]) => k));
    for (const k of [...pend]) { const v = local.get(k); if (v && !this.podeGravar(v.col, v.id)) pend.delete(k); } // o que não pode gravar sempre vem do servidor
    // apagados neste aparelho que ainda não subiram: não podem voltar com o download
    // (quem não pode apagar recebe de volta o que apagou sem querer)
    if (!fresh) for (const k of Object.keys(this.snap)) if (!local.has(k) && !k.startsWith('meta:')) { const i = k.indexOf(':'); if (this.papel() !== 'tecnico' && this.podeGravar(k.slice(0, i), k.slice(i + 1))) pend.add(k); }
    const seen = new Set();
    let mudou = 0;
    for (const r of rows) {
      const k = r.colecao + ':' + r.id; seen.add(k);
      const h = hash(stableStr(r.dados));
      this.snap[k] = h;
      if (r.colecao === 'meta' && pend.has(k)) {
        // configurações com mudança local: junta com a versão do servidor (sem apagar o que foi salvo em outro aparelho)
        const l = local.get(k), junto = this.mesclarMeta(r.id, r.dados, l ? JSON.parse(l.str) : {});
        (this.base ||= {})[r.id] = copia(r.dados);
        if (stableStr(junto) === stableStr(r.dados)) pend.delete(k);
        this.applyRow(r.colecao, r.id, junto); mudou++;
        continue;
      }
      if (r.colecao === 'meta') (this.base ||= {})[r.id] = copia(r.dados);
      if (pend.has(k)) continue;
      const l = local.get(k);
      if (!l || hash(l.str) !== h) { this.applyRow(r.colecao, r.id, r.dados); mudou++; }
    }
    // registros que sumiram do servidor (apagados em outro aparelho)
    for (const [k, v] of local) if (!seen.has(k) && v.col !== 'meta' && !pend.has(k) && k in this.snap) { this.removeLocal(v.col, v.id); mudou++; }
    for (const k of Object.keys(this.snap)) if (!seen.has(k) && !pend.has(k)) delete this.snap[k];
    if (mudou) this.afterRemote();
    this.metaPronta = true;
    this.saveSnap();
    if (pend.size) this.schedule(0); else this.setStatus('ok');
  },

  // Atualiza o objeto no lugar (mantém referências usadas pelas telas abertas)
  applyRow(col, id, dados) {
    if (col === 'meta') {
      if (!META_KEYS.includes(id)) return;
      const cur = Store.db[id];
      for (const k of Object.keys(cur)) if (!(k in dados)) delete cur[k];
      Object.assign(cur, dados);
      return;
    }
    if (!SYNC_COLS.includes(col)) return;
    const arr = Store.db[col];
    const cur = arr.find(o => String(o.id) === String(id));
    if (cur) { for (const k of Object.keys(cur)) if (!(k in dados)) delete cur[k]; Object.assign(cur, dados); }
    else arr.push(dados);
  },
  removeLocal(col, id) {
    if (!SYNC_COLS.includes(col)) return;
    const arr = Store.db[col]; const i = arr.findIndex(o => String(o.id) === String(id));
    if (i >= 0) arr.splice(i, 1);
  },
  afterRemote() {
    const byDate = (a, b) => String(b.data).localeCompare(String(a.data));
    Store.db.auditoria.sort(byDate); Store.db.movEstoque.sort(byDate);
    for (const k in defaultDB().settings) if (Store.db.settings[k] === undefined) Store.db.settings[k] = defaultDB().settings[k];
    Store.save(true);
    clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => { if (App.logged() && $('#main')) App.remoteRefresh(); }, 250);
  },

  subscribe() {
    if (this.channel) this.sb.removeChannel(this.channel);
    const lojaId = this.loja.id;
    this.channel = this.sb.channel('itens-' + lojaId)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'itens', filter: `loja_id=eq.${lojaId}` }, p => this.onChange(p))
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'itens' }, p => this.onChange(p))
      .subscribe(st => { if (st === 'SUBSCRIBED') this.pull(); /* reconectou: atualiza o que perdeu */ });
  },
  onChange(p) {
    if (p.eventType === 'DELETE') {
      const o = p.old || {}; if (o.loja_id && o.loja_id !== this.loja?.id) return;
      if (!o.colecao) return;
      const k = o.colecao + ':' + o.id;
      if (!(k in this.snap)) return;
      delete this.snap[k]; this.removeLocal(o.colecao, o.id);
    } else {
      const r = p.new; if (!r || r.loja_id !== this.loja?.id) return;
      const k = r.colecao + ':' + r.id, h = hash(stableStr(r.dados));
      if (this.snap[k] === h) return; // eco do que este aparelho enviou
      const novoPedido = r.colecao === 'pedidos' && p.eventType === 'INSERT' && !Store.db.pedidos.some(x => x.id === r.id);
      const novoVitrine = r.colecao === 'pedidos_vitrine' && p.eventType === 'INSERT' && !Store.db.pedidos_vitrine.some(x => x.id === r.id);
      let dados = r.dados;
      if (r.colecao === 'meta') { // configurações: não perde o que ainda não subiu deste aparelho
        const pendente = this.snap[k] !== hash(stableStr(Store.db[r.id]));
        if (pendente) dados = this.mesclarMeta(r.id, r.dados, Store.db[r.id] || {});
        (this.base ||= {})[r.id] = copia(r.dados);
        if (pendente) this.schedule();
      }
      this.snap[k] = h; this.applyRow(r.colecao, r.id, dados);
      if (novoPedido) setTimeout(() => App.novoPedido(r.dados), 300); // pop-up de pedido feito pelo cliente
      if (novoVitrine) setTimeout(() => VitrineAdmin.avisar([r.dados]), 300); // pedido do carrinho da vitrine
    }
    this.saveSnap(); this.afterRemote();
  },
};
