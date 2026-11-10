/* Página pública: o cliente acompanha a OS pelo link (sem login).
   Os dados vêm da função acompanhar_os do Supabase, que só devolve a OS daquele link e uma lista
   fechada de campos (placa mascarada, primeiro nome; nunca CPF, telefone, assinaturas ou fotos de entrada).
   ?pdf=garantia ou ?pdf=comprovante: abre o documento direto (o cliente que perdeu baixa de novo). */
const GARANTIA_REPARO_DIAS = 90;
const FORMAS = { dinheiro: 'Dinheiro', pix: 'PIX', debito: 'Cartão de débito', credito: 'Cartão de crédito', transferencia: 'Transferência', outro: 'Outro' };
const ST = {
  analise:      { label: 'Em análise',            icon: 'search',      color: '#1D4ED8', desc: 'Nosso mecânico está avaliando o veículo.' },
  aprovacao:    { label: 'Aguardando aprovação',  icon: 'clock',       color: '#A16207', desc: 'O orçamento está pronto e aguarda a sua aprovação.' },
  peca:         { label: 'Aguardando peça',       icon: 'box',         color: '#C2410C', desc: 'Estamos aguardando a chegada da peça.' },
  servico:      { label: 'Em serviço',            icon: 'wrench',      color: '#7C3AED', desc: 'O serviço está sendo feito no seu veículo.' },
  concluido:    { label: 'Pronto para retirada',  icon: 'checkCircle', color: '#137333', desc: 'Serviço concluído! Pode vir buscar o seu veículo.' },
  pago:         { label: 'Entregue',              icon: 'shieldCheck', color: '#0F766E', desc: 'Veículo entregue. Sua garantia está ativa.' },
  interrompido: { label: 'Serviço interrompido',  icon: 'xCircle',     color: '#B91C1C', desc: 'O serviço foi interrompido. Fale com a oficina para mais detalhes.' },
};
const PASSOS = [['analise', 'Recebido'], ['servico', 'Em serviço'], ['concluido', 'Pronto'], ['pago', 'Entregue']];
const ORDEM = { analise: 0, aprovacao: 0, peca: 1, servico: 1, concluido: 2, pago: 3 };

const Track = {
  token: '', sb: null, dados: null, ultimo: null, timer: null, pdfPedido: null,

  async start() {
    const m = location.pathname.match(/\/acompanhar\/([A-Za-z0-9]+)/);
    const q = new URLSearchParams(location.search);
    this.token = m ? m[1] : q.get('t') || '';
    this.pdfPedido = ['garantia', 'comprovante'].includes(q.get('pdf')) ? q.get('pdf') : null;
    const c = window.OFICINA_CONFIG || {};
    if (!this.token) return this.erro('Link inválido', 'Confira se o link foi copiado por completo.');
    if (!c.supabaseUrl || !window.supabase) return this.erro('Acompanhamento indisponível', 'A oficina ainda não ativou o acompanhamento online.');
    this.sb = supabase.createClient(c.supabaseUrl, c.supabaseAnonKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
    try {
      const [tm, idi, md] = await Promise.all([this.sb.rpc('tema_por_os', { p_token: this.token }), this.sb.rpc('idioma_por_os', { p_token: this.token }), this.sb.rpc('moeda_por_os', { p_token: this.token })]);
      if (!tm.error && tm.data) Tema.aplicar(tm.data);
      const ii = (!idi.error && idi.data) || tm.data?.idioma;
      if (typeof I18N !== 'undefined') I18N.usarDaLoja(ii);
      Moeda.fixa = (!md.error && md.data) || 'BRL'; // valores na moeda da oficina
    } catch {}
    await this.carregar();
    // tempo real: a oficina avisa o canal só deste link quando a OS muda (sem dados na mensagem);
    // a cada 15 s também confere, caso o aviso não chegue
    try { this.sb.channel('os-' + this.token).on('broadcast', { event: 'mudou' }, () => this.carregar()).subscribe(); } catch {}
    this.timer = setInterval(() => this.carregar(), 15000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) this.carregar(); });
  },

  async carregar() {
    try {
      const { data, error } = await this.sb.rpc('acompanhar_os', { p_token: this.token });
      if (error) throw error;
      if (!data || !data.os) { clearInterval(this.timer); return this.erro('Ordem de serviço não encontrada', 'O link pode estar incorreto ou a OS foi removida. Fale com a oficina.'); }
      const mudou = !this.dados || JSON.stringify(data) !== JSON.stringify(this.dados);
      this.dados = data; this.ultimo = new Date();
      if (mudou) this.render(); else this.tick();
      if (this.pdfPedido) { const p = this.pdfPedido; this.pdfPedido = null; this.baixar(p, true); }
    } catch (e) {
      if (!this.dados) this.erro('Não foi possível carregar', 'Verifique sua internet e tente novamente.');
    }
  },

  erro(titulo, d) {
    $('#track').innerHTML = $('#track .track-head').outerHTML + `<div class="card empty" style="margin-top:20px">${icon('alertCircle')}<h2 style="margin:6px 0">${esc(t(titulo))}</h2><p class="muted" style="margin:0">${esc(t(d))}</p></div>`;
  },

  tick() { const el = $('#t-upd'); if (el) el.textContent = t('Atualizado às') + ' ' + this.ultimo.toLocaleTimeString(loc(), { hour: '2-digit', minute: '2-digit' }); },

  // valores da OS: itens de mão de obra e peças (OS da oficina) ou o valor único (OS simples)
  contas(o) {
    const sv = o.itensServico || [], pc = o.itensPeca || [];
    const soma = l => l.reduce((s, i) => s + (Number(i.valor) || 0) * (Number(i.qtd) || 1), 0);
    const desconto = Number(o.desconto) || 0;
    if (sv.length || pc.length) { const mo = soma(sv), pe = soma(pc); return { mo, pe, desconto, total: Math.max(0, mo + pe - desconto), itens: true }; }
    return { mo: Number(o.valor) || 0, pe: 0, desconto, total: Math.max(0, (Number(o.valor) || 0) - desconto), itens: false };
  },
  garantia(o, L) {
    const dias = [o.garantiaDias, L.garantiaDias].map(v => parseInt(v, 10)).find(v => v >= 0) ?? GARANTIA_REPARO_DIAS;
    const km = [o.garantiaKm, L.garantiaKm].map(v => parseInt(v, 10)).find(v => v >= 0) || 0;
    const inicio = o.concluidoEm || o.pagoEm || o.entregueEm;
    return { dias, km, inicio, fim: inicio ? addDays(inicio, dias) : null, texto: km ? t('{prazo} ou {km}, o que vier primeiro', { prazo: prazoGarantia(dias), km: fmtKm(km) }) : prazoGarantia(dias) };
  },

  render() {
    const { os: o, loja: L = {}, cliente: c = {} } = this.dados;
    const s = ST[o.status] || (o.statusNome ? { label: String(o.statusNome), icon: 'clock', color: /^#[0-9a-f]{6}$/i.test(o.statusCor || '') ? o.statusCor : '#64748B', desc: 'Esta é a etapa atual do serviço.' } : ST.analise);
    const ordem = ORDEM[o.status] ?? (o.statusNome ? 1 : 0);
    const k = this.contas(o), g = this.garantia(o, L);
    const temGarantia = ['concluido', 'pago'].includes(o.status) && g.inicio;
    const v = o.veiculo || {};
    const veic = [v.marca, v.modelo, v.versao, v.ano].filter(Boolean).join(' ');
    const tel = onlyDigits(L.telefone);
    document.title = `OS #${o.numero} · ${t(String(s.label))} · ${L.nome || Tema.nome('')}`;

    $('#track').innerHTML = `
      <div class="track-head">${Tema.atual ? Tema.logoHTML('', 'width:44px;height:44px;border-radius:12px;object-fit:cover') : `<img src="${PLATAFORMA.icone}" alt="">`}<div class="grow" style="min-width:0"><div class="bold ellipsis" style="font-size:18px" data-no-i18n>${esc(L.nome || Tema.nome(''))}</div><div class="small muted">${t('Acompanhamento do serviço')}</div></div><span class="num" style="font-size:13px;font-weight:800;padding:4px 10px;border-radius:8px;background:var(--card-2);color:var(--gold);border:1px solid rgba(var(--gold-rgb), .3)">OS #${esc(o.numero)}</span></div>
      <p style="margin:0 0 14px">${t('Olá')}${c.nome ? `, <b data-no-i18n>${esc(c.nome)}</b>` : ''}! ${t(v.tipo === 'moto' ? 'Veja como está a sua moto:' : 'Veja como está o seu carro:')}</p>

      <div class="hero status-big mb">
        <div class="ic" style="background:${s.color}22;color:${s.color}">${icon(s.icon)}</div>
        <h2 style="color:${s.color}">${esc(t(s.label))}</h2>
        <p class="muted" style="margin:0">${esc(t(s.desc))}</p>
        ${o.status !== 'interrompido' ? `<div class="steps"><div class="fill" style="width:calc(${ordem / 3 * 100}% - ${ordem === 3 ? 24 : 0}px)"></div>
          ${PASSOS.map(([kk, l], i) => `<div class="step ${i <= ordem ? 'on' : ''} ${i === ordem ? 'cur' : ''}"><div class="dot">${i <= ordem ? icon('check', 'sm') : ''}</div><span>${t(l)}</span></div>`).join('')}</div>` : ''}
        ${o.previsao ? `<div class="pill gold mt">${icon('calendar', 'sm')} ${t('Previsão')}: ${fmtDate(o.previsao)}</div>` : ''}
        <div class="mt"><span class="live" id="t-upd">${t('Atualizado às')} ${this.ultimo.toLocaleTimeString(loc(), { hour: '2-digit', minute: '2-digit' })}</span></div>
      </div>

      ${o.podeAprovar ? `<div class="card mb aprovar-card">
        <b style="font-size:17px">${icon('checkCircle', 'sm')} ${t('Orçamento pronto')}</b>
        <p class="small" style="margin:6px 0 12px">${t('Confira os itens abaixo. Ao aprovar, a oficina começa o serviço.')}</p>
        <div class="kv"><span class="k">${t('Total')}</span><span class="v gold" style="font-size:20px">${money(k.total)}</span></div>
        <button class="btn primary block mt btn-grande" id="t-aprovar">${icon('check')} ${t('Aprovar orçamento')}</button></div>` : ''}
      ${o.aprovadoEm && !o.podeAprovar ? `<div class="aviso-plano green mb">${icon('checkCircle', 'sm')}<span class="grow">${t('Orçamento aprovado em {d}.', { d: fmtDateTime(o.aprovadoEm) })}</span></div>` : ''}

      ${temGarantia ? `<div class="card mb" style="border-color:rgba(var(--gold-rgb), .5);background:linear-gradient(135deg,var(--gold-soft),var(--bg-2))">
        <div class="row"><div class="stat-icon"><div class="ic">${icon('shieldCheck')}</div></div><div class="grow"><b style="font-size:17px">${t('Garantia')}: <span class="gold">${esc(g.texto)}</span></b><div class="small muted">${t('Válida até')} <b class="gold">${fmtDate(g.fim)}</b>${g.km && o.kmEntrada ? ` ${t('ou')} <b class="gold">${fmtKm(Number(o.kmEntrada) + g.km)}</b>` : ''}</div></div></div>
        <button class="btn primary block mt" id="t-pdf">${icon('download')} ${t('Baixar termo de garantia (PDF)')}</button>
        ${o.status === 'pago' ? `<button class="btn block mt" id="t-comp">${icon('file')} ${t('Baixar comprovante de pagamento')}</button>` : ''}</div>` : ''}

      <div class="card mb">
        <h3>${icon(v.tipo === 'moto' ? 'moto' : 'car', 'sm')} ${t(v.tipo === 'moto' ? 'Sua moto' : 'Seu carro')}</h3>
        ${v.placa ? `<div class="kv"><span class="k">${t('Placa')}</span><span class="v"><b class="placa-tag" data-no-i18n>${esc(v.placa)}</b></span></div>` : ''}
        <div class="kv"><span class="k">${t('Veículo')}</span><span class="v gold" data-no-i18n>${esc(veic || '—')}</span></div>
        ${o.kmEntrada ? `<div class="kv"><span class="k">${t('Km na entrada')}</span><span class="v">${fmtKm(o.kmEntrada)}</span></div>` : ''}
        ${o.defeito ? `<div class="kv"><span class="k">${t('Reclamação')}</span><span class="v" data-no-i18n>${esc(o.defeito)}</span></div>` : ''}
        <div class="kv"><span class="k">${t('Entrada')}</span><span class="v">${fmtDateTime(o.criadoEm)}</span></div>
      </div>

      ${k.itens || k.total > 0 ? `<div class="card mb"><h3>${icon('wrench', 'sm')} ${t('Serviços e peças')}</h3>
        ${(o.itensServico || []).map(i => `<div class="kv"><span class="k" data-no-i18n>${Number(i.qtd) > 1 ? fmtQtd(i.qtd) + 'x ' : ''}${esc(i.nome)}</span><span class="v">${money((Number(i.valor) || 0) * (Number(i.qtd) || 1))}</span></div>`).join('')}
        ${(o.itensPeca || []).map(i => `<div class="kv"><span class="k" data-no-i18n>${Number(i.qtd) !== 1 ? fmtQtd(i.qtd) + 'x ' : ''}${esc(i.nome)}</span><span class="v">${money((Number(i.valor) || 0) * (Number(i.qtd) || 1))}</span></div>`).join('')}
        ${!k.itens && o.servico ? `<div class="kv"><span class="k" data-no-i18n>${esc(o.servico)}</span><span class="v">${money(k.mo)}</span></div>` : ''}
        ${k.itens ? `<div class="kv mt"><span class="k">${t('Mão de obra')}</span><span class="v">${money(k.mo)}</span></div><div class="kv"><span class="k">${t('Peças')}</span><span class="v">${money(k.pe)}</span></div>` : ''}
        ${k.desconto ? `<div class="kv"><span class="k">${t('Desconto')}</span><span class="v red">-${money(k.desconto)}</span></div>` : ''}
        <div class="kv"><span class="k bold">${t('Total')}</span><span class="v gold" style="font-size:18px">${money(k.total)}</span></div></div>` : ''}

      ${(o.historico || []).length ? `<div class="card mb"><h3>${icon('history', 'sm')} ${t('Histórico')}</h3><div class="timeline">
        ${o.historico.slice().reverse().map(h => `<div class="ev"><b>${esc(t((ST[h.status] || {}).label || h.nome || (/^e_/.test(h.status || '') ? 'Etapa do serviço' : h.status || '')))}</b><div class="xs muted">${fmtDateTime(h.data)}</div></div>`).join('')}</div></div>` : ''}

      ${tel ? `<a class="btn success block mb" target="_blank" rel="noopener" href="${waLink(L.telefone, t('Olá! Gostaria de saber sobre a minha OS #{n} ({veiculo}).', { n: o.numero, veiculo: veic }))}">${icon('whatsapp')} ${t('Falar com a oficina no WhatsApp')}</a>` : ''}
      <div class="center xs muted" style="margin-top:20px" data-no-i18n>${[L.endereco, L.instagram].filter(Boolean).map(esc).join(' · ')}</div>
      <div class="center xs muted" style="margin-top:6px">${t('Esta página se atualiza sozinha.')}</div>`;

    const b = $('#t-pdf'); if (b) b.onclick = () => this.baixar('garantia');
    const cp = $('#t-comp'); if (cp) cp.onclick = () => this.baixar('comprovante');
    const ap = $('#t-aprovar');
    if (ap) ap.onclick = async () => {
      ap.disabled = true;
      try {
        const { data, error } = await this.sb.rpc('aprovar_os_link', { p_token: this.token });
        if (error) throw error;
        if (!data) alert(t('Não foi possível aprovar agora. Fale com a oficina.'));
        await this.carregar();
      } catch { alert(t('Não foi possível aprovar agora. Verifique sua internet.')); ap.disabled = false; }
    };
  },

  // termo de garantia ou comprovante de pagamento (sem assinaturas: o link é público)
  async baixar(qual, automatico) {
    const { os: o, loja: L = {}, cliente: c = {} } = this.dados;
    const k = this.contas(o), g = this.garantia(o, L), v = o.veiculo || {};
    if (!['concluido', 'pago'].includes(o.status) || (qual === 'comprovante' && o.status !== 'pago')) {
      if (automatico) alert(t(qual === 'comprovante' ? 'O comprovante fica disponível depois do pagamento.' : 'A garantia fica disponível quando o serviço for concluído.'));
      return;
    }
    const itens = [...(o.itensServico || []).map(i => ({ desc: i.nome, qtd: Number(i.qtd) || 1, valor: (Number(i.valor) || 0) * (Number(i.qtd) || 1) })),
      ...(o.itensPeca || []).map(i => ({ desc: t('Peça') + ': ' + i.nome, qtd: Number(i.qtd) || 1, valor: (Number(i.valor) || 0) * (Number(i.qtd) || 1) }))];
    if (!itens.length) itens.push({ desc: o.servico || o.defeito || t('Serviço'), valor: k.mo });
    const d = {
      tipo: 'reparo', numero: o.numero, loja: L, cliente: { nome: c.nome },
      veiculo: { tipo: v.tipo, placa: v.placa, marca: v.marca, modelo: [v.modelo, v.versao].filter(Boolean).join(' '), ano: v.ano, km: o.kmEntrada },
      defeito: o.defeito, itens, desconto: k.desconto, total: k.total, forma: t(FORMAS[o.formaPagamento] || ''), inicio: g.inicio, dias: g.dias, km: g.km,
      termos: L.termosGarantia, tecnico: L.mecanico, rodape: L.rodapePdf, pagoEm: o.pagoEm,
    };
    const doc = qual === 'comprovante' ? await Pdf.comprovante(d) : await Pdf.garantia(d);
    doc.save(`${qual}-os-${o.numero}.pdf`);
  },
};
document.addEventListener('DOMContentLoaded', () => Track.start());
