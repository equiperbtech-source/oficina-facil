/* Página pública: o cliente acompanha a OS pelo link (sem login).
   Os dados vêm da função acompanhar_os do Supabase, que só devolve a OS daquele link. */
const GARANTIA_REPARO_DIAS = 90;
const FORMAS = { dinheiro: 'Dinheiro', pix: 'PIX', debito: 'Cartão de Débito', credito: 'Cartão de Crédito', transferencia: 'Transferência', outro: 'Outro' };
const ST = {
  analise:      { label: 'Em análise',          icon: 'search',      color: '#1D4ED8', desc: 'Nosso técnico está avaliando o aparelho.' },
  peca:         { label: 'Aguardando peça',     icon: 'box',         color: '#C2410C', desc: 'Estamos aguardando a chegada da peça para o reparo.' },
  servico:      { label: 'Em reparo',           icon: 'wrench',      color: '#7C3AED', desc: 'Seu aparelho está na bancada sendo reparado.' },
  concluido:    { label: 'Pronto para retirada', icon: 'checkCircle', color: '#137333', desc: 'Reparo finalizado! Pode vir buscar seu aparelho.' },
  pago:         { label: 'Entregue',            icon: 'shieldCheck', color: '#0F766E', desc: 'Aparelho entregue. Sua garantia está ativa.' },
  interrompido: { label: 'Serviço interrompido', icon: 'xCircle',    color: '#B91C1C', desc: 'O serviço foi interrompido. Fale com a loja para mais detalhes.' },
};
const PASSOS = [['analise', 'Recebido'], ['servico', 'Em reparo'], ['concluido', 'Pronto'], ['pago', 'Entregue']];
const ORDEM = { analise: 0, peca: 0, servico: 1, concluido: 2, pago: 3 };

const Track = {
  token: '', sb: null, dados: null, ultimo: null, timer: null,

  async start() {
    const m = location.pathname.match(/\/acompanhar\/([A-Za-z0-9]+)/);
    this.token = m ? m[1] : new URLSearchParams(location.search).get('t') || '';
    const c = window.OFICINA_CONFIG || {};
    if (!this.token) return this.erro('Link inválido', 'Confira se o link foi copiado por completo.');
    if (!c.supabaseUrl || !window.supabase) return this.erro('Acompanhamento indisponível', 'A loja ainda não ativou o acompanhamento online.');
    this.sb = supabase.createClient(c.supabaseUrl, c.supabaseAnonKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
    try {
      const [t, idi, md] = await Promise.all([this.sb.rpc('tema_por_os', { p_token: this.token }), this.sb.rpc('idioma_por_os', { p_token: this.token }), this.sb.rpc('moeda_por_os', { p_token: this.token })]);
      if (!t.error && t.data) Tema.aplicar(t.data);
      const ii = (!idi.error && idi.data) || t.data?.idioma;
      if (typeof I18N !== 'undefined') I18N.usarDaLoja(ii); // loja da Hotmart = espanhol
      Moeda.fixa = (!md.error && md.data) || 'BRL'; // valores na moeda da loja
    } catch {}
    await this.carregar();
    // tempo real: a loja avisa o canal só deste link quando a OS muda (sem dados na mensagem);
    // a cada 15 s também confere, caso o aviso não chegue
    try { this.sb.channel('os-' + this.token).on('broadcast', { event: 'mudou' }, () => this.carregar()).subscribe(); } catch {}
    this.timer = setInterval(() => this.carregar(), 15000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) this.carregar(); });
  },

  async carregar() {
    try {
      const { data, error } = await this.sb.rpc('acompanhar_os', { p_token: this.token });
      if (error) throw error;
      if (!data) { clearInterval(this.timer); return this.erro('Ordem de serviço não encontrada', 'O link pode estar incorreto ou a OS foi removida. Fale com a loja.'); }
      const mudou = !this.dados || JSON.stringify(data) !== JSON.stringify(this.dados);
      this.dados = data; this.ultimo = new Date();
      if (mudou) this.render(); else this.tick();
    } catch (e) {
      if (!this.dados) this.erro('Não foi possível carregar', 'Verifique sua internet e tente novamente.');
    }
  },

  erro(t, d) {
    $('#track').innerHTML = $('#track .track-head').outerHTML + `<div class="card empty" style="margin-top:20px">${icon('alertCircle')}<h2 style="margin:6px 0">${esc(t)}</h2><p class="muted" style="margin:0">${esc(d)}</p></div>`;
  },

  tick() { const el = $('#t-upd'); if (el) el.textContent = 'Atualizado às ' + this.ultimo.toLocaleTimeString(loc(), { hour: '2-digit', minute: '2-digit' }); },

  render() {
    const { os: o, loja: L = {}, cliente: c = {} } = this.dados;
    // card criado pela loja (ex.: "Aguardando cliente"): nome e cor vêm junto da OS
    const s = ST[o.status] || (o.statusNome ? { label: String(o.statusNome), icon: 'clock', color: /^#[0-9a-f]{6}$/i.test(o.statusCor || '') ? o.statusCor : '#64748B', desc: 'Esta é a etapa atual do seu reparo.' } : ST.analise);
    const ordem = ORDEM[o.status] ?? (o.statusNome ? 1 : 0);
    const total = (Number(o.valor) || 0) - (Number(o.desconto) || 0);
    const inicioGar = o.concluidoEm || o.pagoEm || o.entregueEm;
    // prazo da garantia: o da OS; sem ele, o padrão da loja; sem nenhum, 3 meses
    const diasGar = [o.garantiaDias, L.garantiaDias].map(v => parseInt(v, 10)).find(v => v >= 0) ?? GARANTIA_REPARO_DIAS;
    const fimGar = inicioGar ? addDays(inicioGar, diasGar) : null;
    const garantia = ['concluido', 'pago'].includes(o.status) && inicioGar;
    const tel = onlyDigits(L.telefone);
    document.title = `OS #${o.numero} · ${String(s.label)} · ${L.nome || Tema.nome('')}`;

    $('#track').innerHTML = `
      <div class="track-head">${Tema.atual ? Tema.logoHTML('', 'width:44px;height:44px;border-radius:12px;object-fit:cover') : `<img src="${PLATAFORMA.icone}" alt="">`}<div class="grow"><div class="bold" style="font-size:18px">${esc(L.nome || Tema.nome(''))}</div><div class="small muted">Acompanhamento do reparo</div></div><span class="num" style="font-size:13px;font-weight:800;padding:4px 10px;border-radius:8px;background:var(--card-2);color:var(--gold);border:1px solid rgba(var(--gold-rgb), .3)">OS #${esc(o.numero)}</span></div>
      <p style="margin:0 0 14px">Olá${c.nome ? `, <b>${esc(String(c.nome).split(' ')[0])}</b>` : ''}! Veja como está o seu aparelho:</p>

      <div class="hero status-big mb">
        <div class="ic" style="background:${s.color}22;color:${s.color}">${icon(s.icon)}</div>
        <h2 style="color:${s.color}">${esc(s.label)}</h2>
        <p class="muted" style="margin:0">${s.desc}</p>
        ${o.status !== 'interrompido' ? `<div class="steps"><div class="fill" style="width:calc(${ordem / 3 * 100}% - ${ordem === 3 ? 24 : 0}px)"></div>
          ${PASSOS.map(([k, l], i) => `<div class="step ${i <= ordem ? 'on' : ''} ${i === ordem ? 'cur' : ''}"><div class="dot">${i <= ordem ? icon('check', 'sm') : ''}</div><span>${l}</span></div>`).join('')}</div>` : ''}
        ${o.previsao && ordem < 2 && o.status !== 'interrompido' ? `<div class="pill gold mt">${icon('calendar', 'sm')} Previsão: ${fmtDate(o.previsao)}</div>` : ''}
        <div class="mt"><span class="live" id="t-upd">Atualizado às ${this.ultimo.toLocaleTimeString(loc(), { hour: '2-digit', minute: '2-digit' })}</span></div>
      </div>

      ${garantia ? `<div class="card mb" style="border-color:rgba(var(--gold-rgb), .5);background:linear-gradient(135deg,var(--gold-soft),var(--bg-2))">
        <div class="row"><div class="stat-icon"><div class="ic">${icon('shieldCheck')}</div></div><div class="grow"><b style="font-size:17px">Garantia de <span class="gold">${prazoGarantia(diasGar)}</span></b><div class="small muted">Válida até <b class="gold">${fmtDate(fimGar)}</b></div></div></div>
        <button class="btn primary block mt" id="t-pdf">${icon('download')} Baixar termo de garantia (PDF)</button></div>` : ''}

      <div class="card mb">
        <h3>${icon('phone', 'sm')} Seu aparelho</h3>
        <div class="kv"><span class="k">Aparelho</span><span class="v gold">${esc(o.aparelho?.modelo || '—')}</span></div>
        ${o.defeito ? `<div class="kv"><span class="k">Defeito relatado</span><span class="v">${esc(o.defeito)}</span></div>` : ''}
        ${o.servico ? `<div class="kv"><span class="k">Serviço</span><span class="v">${esc(o.servico)}</span></div>` : ''}
        <div class="kv"><span class="k">Entrada</span><span class="v">${fmtDateTime(o.criadoEm)}</span></div>
        ${total > 0 ? `<div class="kv"><span class="k">Valor</span><span class="v gold" style="font-size:18px">${money(total)}</span></div>` : ''}
      </div>

      ${(o.historico || []).length ? `<div class="card mb"><h3>${icon('history', 'sm')} Histórico</h3><div class="timeline">
        ${o.historico.slice().reverse().map(h => `<div class="ev"><b>${esc((ST[h.status] || {}).label || h.nome || (/^e_/.test(h.status || '') ? 'Etapa do reparo' : h.status))}</b><div class="xs muted">${fmtDateTime(h.data)}</div></div>`).join('')}</div></div>` : ''}

      ${tel ? `<a class="btn success block mb" target="_blank" href="${waLink(L.telefone, t('Olá! Gostaria de saber sobre a minha OS #{n} ({modelo}).', { n: o.numero, modelo: o.aparelho?.modelo || '' }))}">${icon('whatsapp')} Falar com a loja no WhatsApp</a>` : ''}
      <div class="center xs muted" style="margin-top:20px">${[L.endereco, L.instagram].filter(Boolean).map(esc).join(' · ')}</div>
      <div class="center xs muted" style="margin-top:6px">Esta página se atualiza sozinha.</div>`;

    const b = $('#t-pdf');
    if (b) b.onclick = async () => {
      b.disabled = true;
      try {
        const doc = await Pdf.garantia({
          tipo: 'reparo', numero: o.numero, loja: L, cliente: { nome: c.nome }, aparelho: o.aparelho || {}, defeito: o.defeito,
          itens: [{ desc: o.servico || o.defeito || 'Serviço', valor: Number(o.valor) || 0 }, ...(o.pecas || []).map(p => ({ desc: 'Peça: ' + p.nome, qtd: p.qtd, valor: null }))],
          desconto: Number(o.desconto) || 0, total, forma: FORMAS[o.formaPagamento] || '', inicio: inicioGar, dias: diasGar,
          termos: L.termosGarantia, tecnico: L.tecnico, assinaturaTecnico: L.assinaturaTecnico, assinaturaCliente: o.assinaturaCliente,
        });
        doc.save(`garantia-os-${o.numero}.pdf`);
      } finally { b.disabled = false; }
    };
  },
};
document.addEventListener('DOMContentLoaded', () => Track.start());
