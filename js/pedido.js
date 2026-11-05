/* Página pública: o cliente pede um orçamento (sem login).
   O pedido entra na loja pela função criar_pedido do Supabase e aparece na hora no app. */
const MARCAS = ['Apple (iPhone)', 'Samsung', 'Motorola', 'Xiaomi / Redmi / Poco', 'Realme', 'LG', 'Asus', 'Nokia', 'Outra'];
const URGENCIAS = [['baixa', 'Baixa', 'Sem pressa'], ['media', 'Média', 'Em alguns dias'], ['alta', 'Urgente', 'Preciso logo']];

const Pedido = {
  sb: null, loja: null, info: {},

  async start() {
    // loja: id ou endereço curto no link (/pedido/<loja>), ?l=, ou o domínio acessado
    const m = location.pathname.match(/\/pedido\/([A-Za-z0-9-]{2,40})/);
    const ref = m ? m[1] : new URLSearchParams(location.search).get('l');
    const c = window.OFICINA_CONFIG || {};
    if (!c.supabaseUrl || !window.supabase) return this.msg('Indisponível', 'A loja ainda não ativou os pedidos online.');
    this.sb = supabase.createClient(c.supabaseUrl, c.supabaseAnonKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
    try {
      const r = await this.sb.rpc('loja_publica', { p_ref: ref || '', p_host: location.host });
      if (!r.error) { this.loja = r.data; if (!this.loja) return this.msg('Loja não encontrada', 'Confira se o link está completo.'); }
      else this.loja = /^[0-9a-f-]{36}$/i.test(ref || '') ? ref : null; // banco ainda sem a etapa 1
    } catch {}
    try {
      const { data } = await this.sb.rpc('info_loja', { p_loja: this.loja || null });
      this.info = data || {};
      if (this.loja) { const [t, idi, md] = await Promise.all([this.sb.rpc('tema_publico', { p_loja: this.loja }), this.sb.rpc('idioma_da_loja', { p_loja: this.loja }), this.sb.rpc('moeda_da_loja', { p_loja: this.loja })]); if (!t.error && t.data) Tema.aplicar(t.data); const ii = (!idi.error && idi.data) || t.data?.idioma; if (typeof I18N !== 'undefined') I18N.usarDaLoja(ii); Moeda.fixa = (!md.error && md.data) || 'BRL'; }
    } catch {}
    this.form();
  },

  topo() { return Tema.atual && !Tema.logo() ? `<div class="center" style="margin:10px 0 6px">${Tema.logoHTML('', 'width:84px;margin:0 auto;font-size:30px;border-radius:22px')}<div class="bold mt" style="font-size:20px">${Tema.nomeHTML(this.info.nome)}</div></div>` : Tema.logoHTML('logo'); },

  msg(t, d) { $('#pd').innerHTML = this.topo() + `<div class="card empty">${icon('alertCircle')}<h2 style="margin:6px 0">${esc(t)}</h2><p class="muted" style="margin:0">${esc(d)}</p></div>`; },

  form() {
    const salvo = (() => { try { return JSON.parse(localStorage.getItem('oficina_pedido_cliente')) || {}; } catch { return {}; } })();
    $('#pd').innerHTML = this.topo() + `
      <h1 style="text-align:center;margin:8px 0 4px;font-size:26px">Pedir <span class="gold">orçamento</span></h1>
      <p class="center muted" style="margin:0 0 18px">Conte o que aconteceu com seu aparelho. Respondemos pelo <b class="gold">WhatsApp</b> com o orçamento.</p>
      <form class="card" id="pd-form" novalidate>
        <div class="section-title">Seus dados</div>
        ${field('Nome completo', inputIcon('user', `name="nome" required autocomplete="name" placeholder="Ex: João da Silva" value="${esc(salvo.nome || '')}"`), { req: true })}
        ${field('WhatsApp para contato', inputIcon('phone', `name="telefone" type="tel" inputmode="tel" required autocomplete="tel" placeholder="(48) 99999-9999" value="${esc(salvo.telefone || '')}"`), { req: true })}
        <div class="section-title" style="margin-top:8px">Seu aparelho</div>
        ${field('Marca', `<select class="input" name="marca" required><option value="">Selecione</option>${MARCAS.map(m => `<option>${m}</option>`).join('')}</select>`, { req: true })}
        ${field('Modelo', `<input class="input" name="modelo" required placeholder="Ex: iPhone 13, Galaxy A54, Moto G84">`, { req: true })}
        ${field('Defeito apresentado', `<textarea class="input" name="defeito" required placeholder="Ex: caiu e a tela quebrou, não carrega, bateria acaba rápido..."></textarea>`, { req: true })}
        <div class="field"><label>Nível de urgência <span class="req">*</span></label>
          <input type="hidden" name="urgencia" value="media">
          <div class="urg">${URGENCIAS.map(([k, l, d]) => `<button type="button" class="chip-opt ${k === 'media' ? 'on' : ''}" data-u="${k}"><b>${l}</b><small>${d}</small></button>`).join('')}</div></div>
        <button class="btn primary block" id="pd-ok" style="min-height:54px;font-size:17px;margin-top:6px">${icon('whatsapp')} Enviar pedido</button>
        <p class="xs muted center" style="margin-bottom:0">Seus dados são usados só para responder este pedido.</p>
      </form>
      ${this.rodape()}`;
    const f = $('#pd-form');
    const tel = $('[name=telefone]', f);
    tel.addEventListener('blur', () => { tel.value = fmtPhone(tel.value); });
    $$('[data-u]', f).forEach(b => b.onclick = () => { $('[name=urgencia]', f).value = b.dataset.u; $$('[data-u]', f).forEach(x => x.classList.toggle('on', x === b)); });
    f.onsubmit = async e => {
      e.preventDefault();
      const d = readForm(f);
      const falta = !d.nome || d.nome.length < 3 ? 'Informe seu nome completo' : onlyDigits(d.telefone).length < 10 ? 'Informe seu WhatsApp com DDD' : !d.marca ? 'Selecione a marca' : !d.modelo ? 'Informe o modelo do aparelho' : !d.defeito ? 'Descreva o defeito' : '';
      if (falta) return this.erro(falta);
      const btn = $('#pd-ok'); btn.disabled = true; btn.innerHTML = 'Enviando...';
      try {
        const { data, error } = await this.sb.rpc('criar_pedido', { p_loja: this.loja || null, p_nome: d.nome, p_telefone: d.telefone, p_marca: d.marca, p_modelo: d.modelo, p_defeito: d.defeito, p_urgencia: d.urgencia });
        if (error) throw new Error(error.message);
        try { localStorage.setItem('oficina_pedido_cliente', JSON.stringify({ nome: d.nome, telefone: d.telefone })); } catch {}
        this.sucesso(data?.numero, d);
      } catch (err) {
        this.erro(/fetch|network/i.test(err.message) ? 'Sem conexão. Verifique a internet e tente de novo.' : err.message);
        btn.disabled = false; btn.innerHTML = icon('whatsapp') + ' Enviar pedido';
      }
    };
  },

  erro(t) {
    const r = $('#toast-root'); const el = document.createElement('div');
    el.className = 'toast err'; el.innerHTML = icon('alert') + `<span>${esc(t)}</span>`; r.appendChild(el); setTimeout(() => el.remove(), 3500);
  },

  sucesso(numero, d) {
    const tel = this.info.telefone;
    $('#pd').innerHTML = this.topo() + `
      <div class="hero center" style="padding:30px 20px">
        <div style="width:80px;height:80px;border-radius:50%;margin:0 auto 14px;display:grid;place-items:center;background:rgba(74,222,128,.12);color:var(--green)">${icon('checkCircle', 'lg')}</div>
        <h2 style="margin:0 0 6px">Pedido <span class="gold">enviado!</span></h2>
        ${numero ? `<div class="pill gold" style="font-size:15px;margin:6px 0 12px">Pedido nº ${numero}</div>` : ''}
        <p class="muted" style="margin:0">Recebemos o pedido do seu <b style="color:var(--text)">${esc(d.modelo)}</b>. Em breve enviamos o orçamento no WhatsApp <b class="gold">${esc(fmtPhone(d.telefone))}</b>.</p>
      </div>
      ${tel ? `<a class="btn success block mt" target="_blank" href="${waLink(tel, `Olá! Acabei de enviar o pedido de orçamento${numero ? ' nº ' + numero : ''} pelo site (${d.marca} ${d.modelo}).`)}">${icon('whatsapp')} Falar com a loja agora</a>` : ''}
      <button class="btn block mt" onclick="Pedido.form()">Fazer outro pedido</button>
      ${this.rodape()}`;
    scrollTo(0, 0);
  },

  rodape() { return `<div class="center xs muted" style="margin-top:20px">${[this.info.endereco, this.info.instagram].filter(Boolean).map(esc).join(' · ')}</div>`; },
};

// helpers de formulário usados pela página (mesmos do app)
function field(label, inner, { req = false } = {}) { return `<div class="field"><label>${esc(label)}${req ? ' <span class="req">*</span>' : ''}</label>${inner}</div>`; }
function inputIcon(ic, attrs) { return `<div class="input-icon">${icon(ic)}<input class="input" ${attrs}></div>`; }
function readForm(root) { const o = {}; root.querySelectorAll('[name]').forEach(el => o[el.name] = el.value.trim()); return o; }
document.addEventListener('DOMContentLoaded', () => Pedido.start());
