/* Página pública da vitrine (sem login). Os dados vêm da função vitrine_publica,
   que só devolve os itens que a loja marcou e só campos públicos (nunca custo, IMEI ou fornecedor).
   O cliente monta um carrinho e finaliza com nome, WhatsApp e horário de retirada (criar_pedido_vitrine). */
const COND = { seminovo: 'Seminovo', novo: 'Novo', acessorio: 'Acessório' };
const Vitrine = {
  sb: null, ref: '', dados: null, filtro: 'todos', carrinho: {},

  async start() {
    const m = location.pathname.match(/\/vitrine\/([A-Za-z0-9-]{2,40})/);
    this.ref = m ? m[1] : new URLSearchParams(location.search).get('l') || '';
    const c = window.OFICINA_CONFIG || {};
    if (!c.supabaseUrl || !window.supabase) return this.msg('Vitrine indisponível', 'A loja ainda não ativou a vitrine online.');
    this.sb = supabase.createClient(c.supabaseUrl, c.supabaseAnonKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
    try { this.carrinho = JSON.parse(localStorage.getItem(this.chave()) || '{}') || {}; } catch { this.carrinho = {}; }
    try {
      try { const l = await this.sb.rpc('loja_publica', { p_ref: this.ref, p_host: location.host }); if (l.data) { const [t, idi, md] = await Promise.all([this.sb.rpc('tema_publico', { p_loja: l.data }), this.sb.rpc('idioma_da_loja', { p_loja: l.data }), this.sb.rpc('moeda_da_loja', { p_loja: l.data })]); if (!t.error && t.data) Tema.aplicar(t.data); const ii = (!idi.error && idi.data) || t.data?.idioma; if (typeof I18N !== 'undefined') I18N.usarDaLoja(ii); Moeda.fixa = (!md.error && md.data) || 'BRL'; } } catch {}
      await this.carregar();
    } catch (e) { this.msg('Não foi possível carregar', 'Verifique sua internet e tente de novo.' + (e?.message ? ' (' + e.message + ')' : '')); }
  },
  async carregar() {
    const { data, error } = await this.sb.rpc('vitrine_publica', { p_ref: this.ref, p_host: location.host });
    if (error) throw error;
    if (!data) return this.msg('Loja não encontrada', 'Confira se o link está completo.');
    if (data.indisponivel) return this.msg('Vitrine indisponível', 'Esta loja não está com a vitrine ativa no momento.');
    this.dados = data;
    // tira do carrinho o que saiu da vitrine ou esgotou
    for (const id of Object.keys(this.carrinho)) { const i = this.item(id); if (!i || !i.disponivel) delete this.carrinho[id]; }
    this.salvar(); this.render();
  },
  chave() { return 'vitrine_carrinho_' + (this.ref || location.host); },
  salvar() { try { localStorage.setItem(this.chave(), JSON.stringify(this.carrinho)); } catch {} },
  item(id) { return (this.dados?.itens || []).find(i => i.id === id); },
  qtdTotal() { return Object.values(this.carrinho).reduce((s, q) => s + q, 0); },
  total() { return Object.entries(this.carrinho).reduce((s, [id, q]) => s + (Number(this.item(id)?.preco) || 0) * q, 0); },
  mudar(id, d) {
    const q = Math.max(0, Math.min(10, (this.carrinho[id] || 0) + d));
    if (q) this.carrinho[id] = q; else delete this.carrinho[id];
    this.salvar(); this.render();
  },

  msg(t, d) { $('#vt').innerHTML = `<div class="card empty" style="margin-top:40px">${icon('alertCircle')}<h2 style="margin:6px 0">${esc(t)}</h2><p class="muted" style="margin:0">${esc(d)}</p></div>`; },
  render() {
    const { loja: L, itens } = this.dados;
    document.title = `Vitrine · ${L.nome || ''}`;
    const tipos = [['todos', 'Tudo'], ...['seminovo', 'novo', 'acessorio'].filter(k => itens.some(i => i.condicao === k)).map(k => [k, COND[k] + 's'])];
    const lista = itens.filter(i => this.filtro === 'todos' || i.condicao === this.filtro);
    const zap = foneWhats(L.whatsapp || '');
    const n = this.qtdTotal();
    $('#vt').classList.toggle('com-cart', n > 0);
    $('#vt').innerHTML = `
      <div class="vt-head">${Tema.atual ? Tema.logoHTML('', 'width:72px;height:72px;margin:0 auto 8px;border-radius:18px;object-fit:cover;font-size:26px') : ''}<h1>${Tema.atual ? Tema.nomeHTML(L.nome) : esc(L.nome || 'Vitrine')}</h1>
        ${Tema.atual?.slogan ? `<div class="small gold">${esc(Tema.atual.slogan)}</div>` : ''}
        <div class="small muted">${[L.endereco, L.instagram].filter(Boolean).map(esc).join(' · ')}</div>
        <div class="small muted mt">Escolha, reserve e retire na loja.</div></div>
      ${tipos.length > 2 ? `<div class="vt-filtros tabs">${tipos.map(([k, l]) => `<button data-f="${k}" class="${this.filtro === k ? 'on' : ''}">${l}</button>`).join('')}</div>` : ''}
      <div class="vt-grid">${lista.map(i => { const q = this.carrinho[i.id] || 0; return `<div class="vt-card ${i.disponivel ? '' : 'vendido'}">
        <div class="vt-foto" style="${i.fotos?.[0] ? `background-image:url('${encodeURI(i.fotos[0])}')` : ''}">${i.fotos?.[0] ? '' : icon('phone')}</div>
        <div class="vt-body"><span class="pill xs" style="align-self:flex-start">${i.disponivel ? esc(COND[i.condicao] || '') : 'Vendido'}</span>
          <b>${esc(i.nome)}</b>
          <div class="xs muted">${[i.armazenamento, i.cor, i.bateria ? 'Bateria ' + i.bateria : ''].filter(Boolean).map(esc).join(' · ')}</div>
          ${i.descricao ? `<div class="xs muted">${esc(i.descricao)}</div>` : ''}
          <div class="vt-preco">${i.preco ? money(Number(i.preco)) : 'Consulte'}</div>
          ${!i.disponivel ? '' : !i.preco ? (zap ? `<a class="btn sm success block" target="_blank" rel="noopener" href="https://wa.me/${zap}?text=${encodeURIComponent(t('Olá! Qual o preço do {produto}?', { produto: i.nome }))}">${icon('whatsapp', 'sm')} Perguntar</a>` : '')
            : q ? `<div class="vt-qtd"><button class="btn sm" data-menos="${esc(i.id)}">−</button><b>${q}</b><button class="btn sm" data-mais="${esc(i.id)}">+</button></div>`
            : `<button class="btn sm primary block" data-add="${esc(i.id)}">${icon('cart', 'sm')} Adicionar</button>`}
        </div></div>`; }).join('') || '<div class="card empty">Nenhum item na vitrine agora.</div>'}</div>
      ${n ? `<button class="vt-cart" id="vt-cart">${icon('cart')} <span class="grow" style="text-align:left">${n} item(ns) · ${money(this.total())}</span> Finalizar ${icon('arrowRight', 'sm')}</button>` : ''}`;
    $$('[data-f]').forEach(b => b.onclick = () => { this.filtro = b.dataset.f; this.render(); });
    $$('[data-add]').forEach(b => b.onclick = () => { this.mudar(b.dataset.add, 1); toast('Adicionado ao carrinho'); });
    $$('[data-mais]').forEach(b => b.onclick = () => this.mudar(b.dataset.mais, 1));
    $$('[data-menos]').forEach(b => b.onclick = () => this.mudar(b.dataset.menos, -1));
    const cb = $('#vt-cart'); if (cb) cb.onclick = () => this.finalizar();
  },

  // horários de retirada: hoje (a partir da próxima meia hora) e os próximos 6 dias, das 9h às 19h
  dias() {
    const out = [], hoje = new Date();
    for (let i = 0; i < 7; i++) { const d = new Date(hoje); d.setDate(d.getDate() + i); const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; out.push([k, i === 0 ? 'Hoje' : i === 1 ? 'Amanhã' : d.toLocaleDateString(loc(), { weekday: 'short', day: '2-digit', month: '2-digit' })]); }
    return out;
  },
  horas(dia) {
    const out = [], agora = new Date();
    for (let h = 9; h <= 19; h++) for (const m of [0, 30]) {
      if (h === 19 && m === 30) continue;
      const t = new Date(`${dia}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`);
      if (t > new Date(agora.getTime() + 20 * 60000)) out.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
    }
    return out;
  },

  finalizar() {
    const linhas = Object.entries(this.carrinho).map(([id, q]) => ({ i: this.item(id), q })).filter(x => x.i);
    const salvo = (() => { try { return JSON.parse(localStorage.getItem('oficina_pedido_cliente')) || {}; } catch { return {}; } })();
    let dias = this.dias(); if (!this.horas(dias[0][0]).length) dias = dias.slice(1);
    const m = openModal({
      title: 'Seu pedido', icon: 'cart',
      body: `${linhas.map(({ i, q }) => `<div class="kv"><span class="k">${q}× ${esc(i.nome)}</span><span class="v">${money(Number(i.preco) * q)}</span></div>`).join('')}
        <div class="kv"><span class="k bold">Total</span><span class="v gold bold">${money(this.total())}</span></div>
        <p class="xs muted">O pagamento é feito na loja, na retirada.</p>
        <div class="section-title mt">Retirada na loja</div>
        <div class="form-row">${field('Dia', `<select class="input" name="dia">${dias.map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join('')}</select>`)}${field('Horário', `<select class="input" name="hora"></select>`)}</div>
        <div class="section-title mt">Seus dados</div>
        ${field('Nome', `<input class="input" name="nome" autocomplete="name" value="${esc(salvo.nome || '')}" required>`)}
        ${field('WhatsApp', `<input class="input" name="telefone" type="tel" inputmode="tel" autocomplete="tel" placeholder="(48) 99999-9999" value="${esc(salvo.telefone || '')}" required>`)}
        ${field('Observação', `<input class="input" name="obs" maxlength="300" placeholder="Ex: quero a capa na cor preta">`)}`,
      foot: `<button class="btn" data-close>Voltar</button><button class="btn primary" id="vt-ok" style="flex:2">${icon('check')} Confirmar pedido</button>`,
    });
    const el = m.el;
    const preencherHoras = () => { const hs = this.horas($('[name=dia]', el).value); $('[name=hora]', el).innerHTML = hs.map(h => `<option>${h}</option>`).join(''); };
    $('[name=dia]', el).onchange = preencherHoras; preencherHoras();
    $('#vt-ok', el).onclick = async () => {
      const f = readForm(el), b = $('#vt-ok', el);
      if (f.nome.length < 3) return toast('Informe seu nome', true);
      if (onlyDigits(f.telefone).length < 10) return toast('Informe seu WhatsApp com DDD', true);
      if (!f.hora) return toast('Escolha o horário', true);
      b.disabled = true; b.innerHTML = 'Enviando...';
      const retirada = new Date(`${f.dia}T${f.hora}:00`).toISOString();
      const { data, error } = await this.sb.rpc('criar_pedido_vitrine', { p_ref: this.ref, p_host: location.host, p_nome: f.nome, p_telefone: f.telefone, p_retirada: retirada,
        p_itens: linhas.map(({ i, q }) => ({ id: i.id, qtd: q })), p_obs: f.obs });
      if (error) { b.disabled = false; b.innerHTML = `${icon('check')} Confirmar pedido`; toast(error.message.replace(/^.*?ERROR:\s*/, ''), true); if (/estoque|vitrine/i.test(error.message)) this.carregar(); return; }
      try { localStorage.setItem('oficina_pedido_cliente', JSON.stringify({ nome: f.nome, telefone: f.telefone })); } catch {}
      this.carrinho = {}; this.salvar(); m.close();
      this.sucesso(data, retirada);
    };
  },

  sucesso(r, retirada) {
    const d = new Date(retirada), L = this.dados.loja, zap = foneWhats(L.whatsapp || '');
    $('#vt').classList.remove('com-cart');
    $('#vt').innerHTML = `<div class="card center" style="margin-top:40px;padding:32px 20px">
      <div class="stat-icon" style="justify-content:center;margin-bottom:10px"><div class="ic" style="color:var(--green);background:rgba(22,163,74,.12)">${icon('checkCircle')}</div></div>
      <h2 style="margin:0 0 6px">Pedido #${r.numero} enviado!</h2>
      <p class="muted" style="margin:0 0 6px">${esc(t('A {loja} já recebeu e vai separar seus itens.', { loja: L.nome || t('loja') }))}</p>
      <p style="margin:0 0 18px">Retirada: <b class="gold">${d.toLocaleDateString(loc(), { weekday: 'long', day: '2-digit', month: '2-digit' })} às ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}</b><br>Total: <b>${money(r.total)}</b> (pago na loja)</p>
      ${zap ? `<a class="btn success" target="_blank" rel="noopener" href="https://wa.me/${zap}?text=${encodeURIComponent(t('Olá! Fiz o pedido #{n} pela vitrine.', { n: r.numero }))}">${icon('whatsapp')} Falar com a loja</a>` : ''}
      <div class="mt"><a href="#" onclick="Vitrine.carregar();return false" class="small">Voltar para a vitrine</a></div></div>`;
  },
};
document.addEventListener('DOMContentLoaded', () => Vitrine.start());
