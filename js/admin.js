/* Painel super admin (/admin). Todos os dados vêm de /api/admin, que confere o login e o super admin;
   o banco confere de novo e grava auditoria. Nenhuma chave secreta aqui. */
const PLANOS_N = { essencial: 'Essencial', pro: 'Pro', pro_max: 'Pro Max' };
const SIT = { ativa: 'green', teste: 'gold', inadimplente: 'orange', somente_leitura: 'red', expirada: 'red', bloqueada: 'red' };
const EV_ST = { aplicado: 'green', ignorado: '', pendente_loja: 'gold', revisao: 'orange', erro: 'red', rejeitado: 'red', recebido: 'gold' };
const POR_PAG = 25;
// plataforma de pagamento de onde a oficina / o pagamento veio
const ORIGEM = { kiwify: ['Kiwify', 'green'], hotmart: ['Hotmart', 'orange'] };
const origemPill = p => p && ORIGEM[p] ? `<span class="pill xs ${ORIGEM[p][1]}">${ORIGEM[p][0]}</span>` : '';
const valorMoeda = (v, moeda) => { try { return new Intl.NumberFormat('es-CL', { style: 'currency', currency: moeda || 'CLP', currencyDisplay: 'code', maximumFractionDigits: 0 }).format(Number(v) || 0); } catch { return (moeda || '') + ' ' + v; } };

// Carrinho abandonado: WhatsApp e e-mail prontos para chamar a pessoa (português na Kiwify/Brasil, espanhol na Hotmart/fora do Brasil)
const Carrinhos = {
  espanhol(c) { return c.provedor === 'hotmart' || (c.pais && String(c.pais).toUpperCase() !== 'BR'); },
  // número só com dígitos e o código do país (wa.me)
  whats(c) {
    const s = String(c.telefone || '').trim(), d = s.replace(/\D/g, '');
    if (!d) return '';
    if (s.startsWith('+')) return d.length >= 10 ? d : '';
    if (!this.espanhol(c)) {   // Brasil (Kiwify): DDD + número; com 55 na frente já vem completo
      if (d.length === 10 || d.length === 11) return '55' + d;
      return /^55\d{10,11}$/.test(d) ? d : '';
    }
    if (d.length === 9) return '56' + d;   // celular do Chile sem o código do país
    return d.length >= 10 ? d : '';        // fora do Brasil: o número já vem com o código do país
  },
  link(c) { return c.provedor !== 'hotmart' && /^[A-Za-z0-9_-]{4,40}$/.test(c.checkout || '') ? 'https://pay.kiwify.com.br/' + c.checkout : ''; },
  mensagem(c) {
    const nome = String(c.nome || '').trim().split(/\s+/)[0] || '';
    const plano = c.plano || c.produto || '', link = this.link(c);
    if (this.espanhol(c)) return `Hola${nome ? ' ' + nome : ''}, ¿cómo estás? Te escribo de Oficina Simples. Vi que empezaste la suscripción${plano ? ' al ' + plano : ''} y no la terminaste. ¿Te quedó alguna duda o tuviste algún problema con el pago? ¡Te ayudo!${link ? '\n\nPuedes terminarla aquí: ' + link : ''}`;
    return `Oi${nome ? ' ' + nome : ''}, tudo bem? Aqui é da Oficina Simples. Vi que você começou a assinatura${plano ? ' do ' + plano : ''} e não finalizou. Ficou alguma dúvida ou teve algum problema no pagamento? Posso te ajudar!${link ? '\n\nSe quiser, é só finalizar por aqui: ' + link : ''}`;
  },
  assunto(c) { return this.espanhol(c) ? 'Tu suscripción a Oficina Simples quedó a medias' : 'Sua assinatura da Oficina Simples ficou pela metade'; },
};

const Admin = {
  sb: null, aba: 'painel', f: { busca: '', plano: '', situacao: '', ordem: 'criado', pag: 0 }, ev: { status: '', pag: 0 }, aud: 0,

  async start() {
    try { sessionStorage.removeItem('os_admin_tentativa'); } catch {}
    const c = window.OFICINA_CONFIG || {};
    if (!c.supabaseUrl) return this.erro('Supabase não configurado.');
    this.sb = supabase.createClient(c.supabaseUrl, c.supabaseAnonKey);
    const { data } = await this.sb.auth.getSession();
    if (!data.session) { location.href = '/admin-entrar.html'; return; }
    this.cookie(data.session);
    this.sb.auth.onAuthStateChange((ev, s) => { if (s) this.cookie(s); });
    this.render();
  },
  cookie(s) { document.cookie = `os_admin=${encodeURIComponent(s.access_token)}; Path=/; Max-Age=3600; SameSite=Strict${location.protocol === 'https:' ? '; Secure' : ''}`; },
  erro(t) { $('#adm').innerHTML = `<div class="card empty red">${esc(t)}</div>`; },

  async api(acao, args = {}) {
    const { data } = await this.sb.auth.getSession();
    const r = await fetch('/api/admin', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (data.session?.access_token || '') }, body: JSON.stringify({ acao, args }) });
    const j = await r.json().catch(() => ({}));
    if (r.status === 401 || r.status === 403) { toast(j.erro || 'Acesso negado', true); setTimeout(() => location.href = '/admin-entrar.html', 1200); throw new Error(j.erro); }
    if (!r.ok) { toast(j.erro || 'Erro', true); throw new Error(j.erro); }
    return j.dados;
  },
  async sair() { await this.sb.auth.signOut(); document.cookie = 'os_admin=; Path=/; Max-Age=0'; location.href = '/admin-entrar.html'; },

  render() {
    const abas = [['painel', 'Painel'], ['lojas', 'Oficinas'], ['eventos', 'Pagamentos'], ['fila', 'Compras sem oficina'], ['carrinhos', 'Carrinhos abandonados'], ['produtos', 'Produtos e planos'], ['avisos', 'Avisos'], ['comunicados', 'Comunicados'], ['auditoria', 'Auditoria']];
    $('#adm').innerHTML = `<div class="adm-top"><img src="/assets/os-192.png" alt="" style="width:40px;height:40px;border-radius:10px"><h1 style="margin:0;font-size:22px">Oficina Simples <span class="gold">admin</span></h1><div class="spacer" style="flex:1"></div>
        <a class="btn sm" href="/">Abrir o app</a><button class="btn sm" onclick="Admin.sair()">${icon('logout', 'sm')} Sair</button></div>
      <div class="adm-tabs tabs">${abas.map(([k, l]) => `<button data-a="${k}" class="${this.aba === k ? 'on' : ''}">${l}</button>`).join('')}</div>
      <div id="adm-c"><div class="empty">Carregando...</div></div>`;
    $$('[data-a]').forEach(b => b.onclick = () => { this.aba = b.dataset.a; this.render(); });
    this[this.aba]().catch(e => { $('#adm-c').innerHTML = `<div class="card empty red">${esc(e.message || 'Erro')}</div>`; });
  },

  async painel() {
    const r = await this.api('resumo');
    const k = (l, v, cor = '') => `<div class="stat"><div class="label">${l}</div><div class="value ${cor}">${v}</div></div>`;
    $('#adm-c').innerHTML = `<div class="kpis mb">${k('Oficinas', r.lojas)}${k('MRR Kiwify', money(r.mrr), 'gold')}${'mrr_hotmart' in r ? k('MRR Hotmart', valorMoeda(r.mrr_hotmart, r.moeda_hotmart), 'gold') : ''}${k('Novas no mês', r.novas_mes)}${k('Notas no mês', r.notas_mes)}
        ${k('Pagamentos a revisar', r.eventos_pendentes, r.eventos_pendentes ? 'orange' : '')}${k('Avisos', r.avisos, r.avisos ? 'red' : '')}</div>
      <div class="grid grid-2"><div class="card"><h3>Por plano</h3>${Object.entries(r.por_plano).map(([p, n]) => `<div class="kv"><span class="k">${esc(PLANOS_N[p] || p)}</span><span class="v">${n}</span></div>`).join('')}</div>
      <div class="card"><h3>Por situação</h3>${Object.entries(r.por_situacao).map(([s, n]) => `<div class="kv"><span class="k"><span class="pill xs ${SIT[s] || ''}">${esc(s)}</span></span><span class="v">${n}</span></div>`).join('')}</div>
      ${r.por_origem ? `<div class="card"><h3>Pagantes por origem</h3>${['kiwify', 'hotmart'].map(o => `<div class="kv"><span class="k">${origemPill(o)}</span><span class="v">${r.por_origem[o] || 0}</span></div>`).join('')}
        ${r.por_origem.sem ? `<div class="kv"><span class="k xs muted">Sem origem (ativadas pelo admin ou antes da Hotmart)</span><span class="v">${r.por_origem.sem}</span></div>` : ''}</div>` : ''}</div>`;
  },

  async lojas() {
    const f = this.f;
    const r = await this.api('lojas', { p_busca: f.busca, p_plano: f.plano, p_situacao: f.situacao, p_ordem: f.ordem, p_limite: POR_PAG, p_offset: f.pag * POR_PAG });
    $('#adm-c').innerHTML = `<div class="row wrap mb" style="gap:8px">
        <input class="input" id="lj-q" placeholder="Buscar nome, e-mail, endereço, hotmart ou kiwify" value="${esc(f.busca)}" style="max-width:280px">
        <select class="input" id="lj-p" style="width:auto"><option value="">Todos os planos</option>${selectOpts(PLANOS_N, f.plano)}</select>
        <select class="input" id="lj-s" style="width:auto"><option value="">Todas as situações</option>${selectOpts(Object.fromEntries(Object.keys(SIT).map(s => [s, s])), f.situacao)}</select>
        <select class="input" id="lj-o" style="width:auto">${selectOpts({ criado: 'Mais recentes', nome: 'Nome', proxima_cobranca: 'Próxima cobrança', atividade: 'Última atividade' }, f.ordem)}</select></div>
      <div class="card pad-0 tbl-wrap"><table class="adm-t"><tr><th>Loja</th><th>Plano</th><th>Situação</th><th>Próx. cobrança</th><th>Equipe</th><th>Notas</th><th>Créditos</th><th>Atividade</th></tr>
        ${r.lojas.map(l => `<tr class="clic" data-l="${l.id}"><td><b>${esc(l.nome)}</b><div class="xs muted">${esc(l.dono_email || '')}${l.slug ? ' · ' + esc(l.slug) : ''}</div></td>
          <td>${esc(PLANOS_N[l.plano_id] || l.plano_id || '—')}${l.isenta ? ' <span class="pill xs green">isenta</span>' : ''} ${origemPill(l.provedor_pagamento)}</td><td><span class="pill xs ${SIT[l.situacao] || ''}">${esc(l.situacao)}</span></td>
          <td>${l.proxima_cobranca ? fmtDate(l.proxima_cobranca) : '—'}</td><td>${l.funcionarios}/${l.limite}</td><td>${l.notas_mes}/${l.franquia}</td><td>${l.creditos}</td>
          <td>${l.ultima_atividade ? fmtDate(l.ultima_atividade) : '—'}</td></tr>`).join('') || '<tr><td colspan="8" class="muted">Nenhuma oficina.</td></tr>'}</table></div>
      ${this.paginas(r.total, f.pag, 'f')}`;
    let t; $('#lj-q').oninput = e => { clearTimeout(t); t = setTimeout(() => { f.busca = e.target.value; f.pag = 0; this.lojas(); }, 350); };
    $('#lj-p').onchange = e => { f.plano = e.target.value; f.pag = 0; this.lojas(); };
    $('#lj-s').onchange = e => { f.situacao = e.target.value; f.pag = 0; this.lojas(); };
    $('#lj-o').onchange = e => { f.ordem = e.target.value; this.lojas(); };
    $$('[data-l]').forEach(tr => tr.onclick = () => this.detalhe(tr.dataset.l));
  },
  paginas(total, pag, alvo) {
    const n = Math.ceil(total / POR_PAG); if (n <= 1) return `<p class="xs muted mt">${total} registro(s)</p>`;
    return `<div class="row between mt"><span class="xs muted">${total} registro(s) · página ${pag + 1} de ${n}</span><div class="row" style="gap:6px">
      <button class="btn sm" ${pag ? '' : 'disabled'} onclick="Admin.${alvo}.pag--;Admin.recarregar()">Anterior</button>
      <button class="btn sm" ${pag + 1 < n ? '' : 'disabled'} onclick="Admin.${alvo}.pag++;Admin.recarregar()">Próxima</button></div></div>`;
  },
  recarregar() { this[this.aba](); },

  async detalhe(id) {
    const d = await this.api('loja', { p_loja: id });
    const l = d.loja;
    const m = openModal({
      title: l.nome, icon: 'bag', wide: true, subtitle: `${PLANOS_N[l.plano_id] || '—'} · ${l.situacao} · ${d.registros} registros`,
      body: `<div class="grid grid-2" style="gap:8px">
          <div class="card"><b>Assinatura</b>${[['Status', l.status_assinatura], ['Teste até', l.teste_ate && `${fmtDate(l.teste_ate)} (${Math.max(0, Math.ceil((new Date(l.teste_ate) - Date.now()) / 86400000))} dia(s))`], ['Próxima cobrança', l.proxima_cobranca && fmtDate(l.proxima_cobranca)],
            ['Pago até', l.periodo_pago_ate && fmtDate(l.periodo_pago_ate)], ['Cortesia até', l.cortesia_ate && fmtDate(l.cortesia_ate)], ['Bloqueio', l.bloqueio_motivo], ['E-mail da compra', l.comprador_email], ['Origem do pagamento', ORIGEM[l.provedor_pagamento]?.[0]]]
            .filter(x => x[1]).map(([k, v]) => `<div class="kv"><span class="k">${k}</span><span class="v">${esc(v)}</span></div>`).join('')}</div>
          <div class="card"><b>Equipe</b>${d.membros.map(x => `<div class="kv"><span class="k">${esc(x.nome || x.email)}</span><span class="v">${esc(x.papel)}${x.ativo === false ? ' · <span class="red">inativo</span>' : ''}</span></div>`).join('')}</div></div>
        <div class="card mt"><b>Ações</b><div class="grid grid-2 mt" style="gap:8px">
          <button class="btn outline-gold" data-ac="teste">${icon('clock', 'sm')} Dias de teste grátis</button><button class="btn" data-ac="cortesia">${icon('calendar', 'sm')} Cortesia (acesso completo)</button>
          <button class="btn" data-ac="plano">${icon('shieldCheck', 'sm')} Alterar plano</button>
          <button class="btn" data-ac="creditos">${icon('file', 'sm')} Créditos de notas</button>
          <button class="btn ${l.status_assinatura === 'bloqueada' ? 'outline-gold' : 'danger'}" data-ac="bloq">${l.status_assinatura === 'bloqueada' ? 'Reativar oficina' : 'Bloquear oficina'}</button>
          <button class="btn outline-gold" data-ac="entrar" style="grid-column:1/-1">${icon('eye', 'sm')} Entrar como a oficina (somente leitura, 2 h)</button></div></div>
        ${d.dominios.length ? `<div class="card mt"><b>Domínios</b>${d.dominios.map(x => `<div class="kv"><span class="k">${esc(x.dominio)}</span><span class="v"><button class="btn sm" data-dom="${esc(x.dominio)}" data-ok="${x.verificado ? 0 : 1}">${x.verificado ? 'Desativar' : 'Ativar'}</button></span></div>`).join('')}</div>` : ''}
        <details class="card mt"><summary class="bold">Pagamentos (${d.pagamentos.length})</summary>${d.pagamentos.map(e => `<div class="kv"><span class="k">${fmtDateTime(e.recebido_em)} · ${esc(e.tipo || '')}</span><span class="v"><span class="pill xs ${EV_ST[e.status] || ''}">${esc(e.status)}</span>${e.erro ? ` <span class="xs red">${esc(e.erro)}</span>` : ''}</span></div>`).join('') || '<p class="muted small">Nenhum.</p>'}</details>
        <details class="card mt"><summary class="bold">Notas (${d.notas.length})</summary>${d.notas.map(n => `<div class="kv"><span class="k">${fmtDateTime(n.criado_em)} · ${money(n.valor)}${n.ambiente === 'homologacao' ? ' · hom.' : ''}</span><span class="v">${esc(n.status)}${n.numero ? ' nº ' + esc(n.numero) : ''}${n.erro ? ` <span class="xs red">${esc(n.erro)}</span>` : ''}</span></div>`).join('') || '<p class="muted small">Nenhuma.</p>'}
          ${d.consumo.map(c => `<div class="xs muted">${esc(c.mes)}: ${c.usadas} usadas da franquia</div>`).join('')}</details>
        <details class="card mt"><summary class="bold">Créditos (${d.creditos.length})</summary>${d.creditos.map(c => `<div class="kv"><span class="k">${fmtDateTime(c.criado_em)} · ${esc(c.motivo)}</span><span class="v ${c.qtd > 0 ? 'green' : 'red'}">${c.qtd > 0 ? '+' : ''}${c.qtd}</span></div>`).join('') || '<p class="muted small">Nenhum.</p>'}</details>
        ${d.tema ? `<details class="card mt"><summary class="bold">Tema</summary><pre class="json">${esc(JSON.stringify(d.tema, null, 2))}</pre></details>` : ''}`,
    });
    const el = m.el;
    const perguntar = async (titulo, campos) => new Promise(ok => {
      const mm = openModal({ title: titulo, icon: 'edit', body: campos + field('Motivo (fica na auditoria)', '<input class="input" name="motivo" required>'),
        foot: `<button class="btn" data-close>Cancelar</button><button class="btn primary" id="pq-ok">Confirmar</button>`,
        onClose: () => ok(null),
        onMount: (e2) => { $('#pq-ok', e2).onclick = () => { const v = readForm(e2); if (!v.motivo) return toast('Informe o motivo', true); ok(v); mm.close(); }; } });
    });
    const feito = async (p) => { try { await p; toast('Feito'); m.close(); this.detalhe(id); } catch {} };
    $$('[data-ac]', el).forEach(b => b.onclick = async () => {
      const ac = b.dataset.ac;
      if (ac === 'plano') { const v = await perguntar('Alterar plano', field('Plano', `<select class="input" name="plano">${selectOpts(PLANOS_N, l.plano_id)}</select>`)); if (v) feito(this.api('alterar_plano', { p_loja: id, p_plano: v.plano, p_motivo: v.motivo })); }
      if (ac === 'teste') {
        const resta = l.teste_ate ? Math.max(0, Math.ceil((new Date(l.teste_ate) - Date.now()) / 86400000)) : 7;
        const v = await perguntar('Dias de teste grátis', `<p class="small" style="margin-top:0">A oficina continua <b>em teste</b>: vê o aviso no topo e fica <b>sem vitrine e sem notas fiscais</b>. Coloque quantos dias de teste ela ainda tem (pode aumentar ou diminuir; <b>0 encerra o teste agora</b>). Se houver cortesia, ela é retirada.</p>` + field('Dias de teste a partir de hoje', `<input class="input" name="dias" type="number" min="0" max="90" value="${resta}">`));
        if (v) feito(this.api('definir_teste', { p_loja: id, p_dias: parseInt(v.dias), p_motivo: v.motivo }));
      }
      if (ac === 'cortesia') { const v = await perguntar('Cortesia (acesso completo)', '<p class="small" style="margin-top:0">Cortesia libera <b>tudo do plano, como se a oficina tivesse pago</b>: sem aviso de teste e sem limites. Para dar mais dias de <b>teste</b>, use "Dias de teste grátis".</p>' + field('Dias', '<input class="input" name="dias" type="number" min="1" max="365" value="7">')); if (v) feito(this.api('cortesia', { p_loja: id, p_dias: parseInt(v.dias), p_motivo: v.motivo })); }
      if (ac === 'creditos') { const v = await perguntar('Créditos de notas', field('Quantidade (negativo para retirar)', '<input class="input" name="qtd" type="number" value="10">')); if (v) feito(this.api('creditar', { p_loja: id, p_qtd: parseInt(v.qtd), p_motivo: v.motivo })); }
      if (ac === 'bloq') { const bloq = l.status_assinatura !== 'bloqueada'; const v = await perguntar(bloq ? 'Bloquear oficina' : 'Reativar oficina', `<p>${bloq ? 'A oficina fica em somente leitura; nenhum dado é apagado.' : 'A oficina volta a funcionar.'}</p>`); if (v) feito(this.api('bloquear', { p_loja: id, p_bloquear: bloq, p_motivo: v.motivo })); }
      if (ac === 'entrar') {
        const v = await perguntar('Entrar como a oficina', '<p class="small">Você verá a oficina como ela vê, <b>sem poder alterar nada</b>, por 2 horas. A oficina vê o aviso de suporte e tudo fica registrado.</p>');
        if (!v) return;
        try { await this.api('entrar_como', { p_loja: id, p_motivo: v.motivo }); localStorage.setItem('oficina_loja_escolhida', id); window.open('/', '_blank'); toast('Abrindo a oficina em outra aba'); } catch {}
      }
    });
    $$('[data-dom]', el).forEach(b => b.onclick = () => feito(this.api('verificar_dominio', { p_dominio: b.dataset.dom, p_ok: b.dataset.ok === '1' })));
  },

  async eventos(status) {
    const st = status ?? this.ev.status;
    const r = await this.api('eventos', { p_status: st, p_limite: POR_PAG, p_offset: this.ev.pag * POR_PAG });
    const fila = this.aba === 'fila';
    $('#adm-c').innerHTML = `${fila ? '<p class="small muted" style="margin-top:0">Compras confirmadas cujo e-mail ainda não tem loja. Quando o dono se cadastrar com o mesmo e-mail, o plano entra sozinho. Se ele usou outro e-mail, vincule aqui.</p>' : `<div class="row mb"><select class="input" id="ev-s" style="width:auto"><option value="">Todos</option>${selectOpts(Object.fromEntries(Object.keys(EV_ST).map(s => [s, s])), st)}</select></div>`}
      <div class="card pad-0 tbl-wrap"><table class="adm-t"><tr><th>Recebido</th><th>Evento</th><th>Status</th><th>E-mail / loja</th><th></th></tr>
      ${r.eventos.map(e => `<tr><td>${fmtDateTime(e.recebido_em)}</td><td>${origemPill(e.provedor || 'kiwify')} ${esc(e.tipo || '—')}<div class="xs muted">${esc(e.tipo_original || '')} · ${esc(e.produto_id || '')}${e.oferta_id ? ' / ' + esc(e.oferta_id) : ''}</div></td>
        <td><span class="pill xs ${EV_ST[e.status] || ''}">${esc(e.status)}</span>${e.erro ? `<div class="xs red">${esc(e.erro)}</div>` : ''}</td>
        <td>${esc(e.email || '')}<div class="xs muted">${esc(e.loja || '')}</div></td>
        <td><div class="row" style="gap:6px">${e.valida && ['revisao', 'erro', 'pendente_loja'].includes(e.status) ? `<button class="btn sm" data-rp="${e.id}">Reprocessar</button>` : ''}
          ${e.valida && e.status === 'pendente_loja' ? `<button class="btn sm outline-gold" data-vc="${e.id}">Vincular</button>` : ''}
          <button class="btn sm ghost" data-pl="${e.id}">Ver</button></div></td></tr>`).join('') || '<tr><td colspan="5" class="muted">Nada aqui.</td></tr>'}</table></div>
      ${this.paginas(r.total, this.ev.pag, 'ev')}`;
    const sel = $('#ev-s'); if (sel) sel.onchange = e => { this.ev.status = e.target.value; this.ev.pag = 0; this.eventos(); };
    $$('[data-rp]').forEach(b => b.onclick = async () => { try { const s = await this.api('reprocessar', { p_evento: +b.dataset.rp }); toast('Resultado: ' + s); this.recarregar(); } catch {} });
    $$('[data-pl]').forEach(b => b.onclick = () => { const e = r.eventos.find(x => x.id === +b.dataset.pl); openModal({ title: 'Evento #' + e.id, icon: 'file', wide: true, body: `<pre class="json">${esc(JSON.stringify(e.payload, null, 2))}</pre>` }); });
    $$('[data-vc]').forEach(b => b.onclick = async () => {
      const lj = prompt('ID da oficina (copie da lista de lojas, no detalhe da oficina):'); if (!lj) return;
      const motivo = prompt('Motivo (fica na auditoria):'); if (!motivo) return;
      try { const s = await this.api('vincular', { p_evento: +b.dataset.vc, p_loja: lj.trim(), p_motivo: motivo }); toast('Resultado: ' + s); this.recarregar(); } catch {}
    });
  },
  async fila() { this.ev.pag = 0; return this.eventos('pendente_loja'); },

  /* ---------- Carrinhos abandonados: quem abriu o checkout e não pagou ---------- */
  async carrinhos() {
    const f = this.cr = this.cr || { filtro: 'abertos' };
    let lista;
    try { lista = await this.api('carrinhos', { p_filtro: f.filtro }); }
    catch (e) { $('#adm-c').innerHTML = `<div class="card empty">Rode a migração 27 (carrinhos abandonados) no Supabase.</div>`; return; }
    lista = lista || [];
    const FILTROS = { abertos: 'A recuperar', contatados: 'Já contatados', compraram: 'Compraram depois', descartados: 'Descartados', todos: 'Todos' };
    $('#adm-c').innerHTML = `<p class="small muted" style="margin-top:0">Pessoas que abriram o checkout da Kiwify ou da Hotmart e não terminaram o pagamento. Uma linha por e-mail (a tentativa mais recente). Quem compra depois sai sozinho da lista "A recuperar".</p>
      <div class="row wrap mb" style="gap:8px"><select class="input" id="cr-f" style="width:auto">${selectOpts(FILTROS, f.filtro)}</select><span class="small muted">${lista.length} pessoa(s)</span></div>
      <div class="card pad-0 tbl-wrap"><table class="adm-t"><tr><th>Quando</th><th>Pessoa</th><th>Plano</th><th>Situação</th><th>Contato</th></tr>
      ${lista.map((c, i) => {
        const tel = Carrinhos.whats(c);
        return `<tr><td>${fmtDateTime(c.recebido_em)}${c.tentativas > 1 ? `<div class="xs muted">${c.tentativas} tentativas</div>` : ''}</td>
          <td><b>${esc(c.nome || '—')}</b><div class="xs muted">${esc(c.email)}</div><div class="xs muted">${esc(c.telefone || 'sem telefone')}</div></td>
          <td>${origemPill(c.provedor)} ${esc(c.plano || c.produto || '—')}</td>
          <td>${c.comprou ? '<span class="pill xs green">Comprou</span>' : c.situacao === 'contatado' ? `<span class="pill xs gold">Contatado${c.canal ? ' · ' + (c.canal === 'whatsapp' ? 'WhatsApp' : 'e-mail') : ''}</span><div class="xs muted">${fmtDate(c.contato_em)}</div>` : c.situacao === 'descartado' ? '<span class="pill xs">Descartado</span>' : '<span class="pill xs orange">A recuperar</span>'}
            ${c.tem_conta && !c.comprou ? '<div class="xs muted">já tem conta (teste)</div>' : ''}</td>
          <td><div class="row wrap" style="gap:6px">
            ${tel ? `<a class="btn sm success" target="_blank" rel="noopener" data-cr-w="${i}" href="https://api.whatsapp.com/send?phone=${tel}&text=${encodeURIComponent(Carrinhos.mensagem(c))}">${icon('whatsapp', 'sm')} WhatsApp</a>` : ''}
            <a class="btn sm" data-cr-e="${i}" href="mailto:${encodeURIComponent(c.email)}?subject=${encodeURIComponent(Carrinhos.assunto(c))}&body=${encodeURIComponent(Carrinhos.mensagem(c))}">${icon('mail', 'sm')} E-mail</a>
            ${c.comprou ? '' : c.situacao ? `<button class="btn sm ghost" data-cr-r="${i}">Reabrir</button>` : `<button class="btn sm ghost" data-cr-c="${i}">Marcar contatado</button><button class="btn sm ghost" data-cr-d="${i}">Descartar</button>`}
          </div></td></tr>`; }).join('') || `<tr><td colspan="5" class="muted">${f.filtro === 'abertos' ? 'Nenhum carrinho abandonado para recuperar.' : 'Nada aqui.'}</td></tr>`}</table></div>`;
    $('#cr-f').onchange = e => { f.filtro = e.target.value; this.carrinhos(); };
    const marcar = async (c, situacao, canal, recarregar = true) => { try { await this.api('carrinho_marcar', { p_email: c.email, p_situacao: situacao, p_canal: canal || null }); if (recarregar) this.carrinhos(); } catch {} };
    // abrir o WhatsApp ou o e-mail já marca como contatado (o link abre normalmente)
    $$('[data-cr-w]').forEach(a => a.addEventListener('click', () => { const c = lista[+a.dataset.crW]; if (!c.situacao && !c.comprou) setTimeout(() => marcar(c, 'contatado', 'whatsapp'), 300); }));
    $$('[data-cr-e]').forEach(a => a.addEventListener('click', () => { const c = lista[+a.dataset.crE]; if (!c.situacao && !c.comprou) setTimeout(() => marcar(c, 'contatado', 'email'), 300); }));
    $$('[data-cr-c]').forEach(b => b.onclick = () => marcar(lista[+b.dataset.crC], 'contatado'));
    $$('[data-cr-d]').forEach(b => b.onclick = () => marcar(lista[+b.dataset.crD], 'descartado'));
    $$('[data-cr-r]').forEach(b => b.onclick = () => marcar(lista[+b.dataset.crR], 'reabrir'));
  },

  async produtos() {
    const r = await this.api('produtos');
    const cfg = r.config || {};
    $('#adm-c').innerHTML = `<div class="card mb"><div class="row between"><h3 style="margin:0">Produtos do pagamento</h3><button class="btn sm primary" id="pd-novo">${icon('plus', 'sm')} Novo</button></div>
        <p class="xs muted">Ligue cada produto/plano da Kiwify ou da Hotmart a um plano do sistema. O link de checkout é o que o botão "Assinar" abre: lojas que assinam pela Hotmart (ou em espanhol, antes de assinar) veem os links da Hotmart; as demais, os da Kiwify. Os IDs aparecem em Pagamentos → Ver, no primeiro evento recebido.</p>
        <div class="tbl-wrap"><table class="adm-t"><tr><th>Nome</th><th>Plataforma</th><th>Produto / oferta</th><th>Libera</th><th>Checkout</th><th></th></tr>
        ${r.produtos.map(p => `<tr><td>${esc(p.nome)}${p.ativo ? '' : ' <span class="pill xs">inativo</span>'}</td><td>${origemPill(p.provedor || 'kiwify')}</td><td class="xs">${esc(p.produto_id)}<br>${esc(p.oferta_id || '—')}</td>
          <td>${p.tipo === 'plano' ? esc(PLANOS_N[p.plano_id] || p.plano_id) : `${p.qtd_notas} notas`}</td><td class="xs">${p.checkout_url ? 'sim' : '<span class="red">falta</span>'}</td>
          <td><button class="btn sm" data-pe="${p.id}">Editar</button></td></tr>`).join('') || '<tr><td colspan="6" class="muted">Nenhum produto cadastrado.</td></tr>'}</table></div></div>
      <div class="card mb"><h3 style="margin-top:0">Planos</h3>${r.planos.map(p => `<form class="row wrap mb" data-pp="${p.id}" style="gap:8px;align-items:flex-end">
          <b style="min-width:90px">${esc(p.nome)}</b>
          <div class="field" style="margin:0"><label>Preço/mês</label><input class="input" name="preco" inputmode="decimal" value="${p.preco_mensal == null ? '' : moneyInput(p.preco_mensal)}" placeholder="a definir" style="width:110px"></div>
          <div class="field" style="margin:0"><label>Funcionários</label><input class="input" name="max" type="number" value="${p.max_funcionarios}" style="width:90px"></div>
          <div class="field" style="margin:0"><label>Notas/mês</label><input class="input" name="franquia" type="number" value="${p.franquia_notas_mes}" style="width:90px"></div>
          <button class="btn sm outline-gold">Salvar</button></form>`).join('')}</div>
      <div class="card mb"><h3 style="margin-top:0">Preços na Hotmart</h3>
        <p class="xs muted">Valores que o app mostra em "Meu plano" para as lojas da Hotmart. O valor cobrado é o do produto na Hotmart: mantenha iguais.</p>
        <form class="row wrap" id="ph-f" style="gap:8px;align-items:flex-end">
          <div class="field" style="margin:0"><label>Moeda</label><input class="input" name="moeda" value="${esc(cfg.precos_hotmart?.moeda || 'CLP')}" maxlength="3" style="width:80px;text-transform:uppercase"></div>
          ${['essencial', 'pro'].map(id => `<div class="field" style="margin:0"><label>${PLANOS_N[id]}/mês</label><input class="input" name="${id}" inputmode="decimal" value="${esc(cfg.precos_hotmart?.[id] ?? '')}" style="width:120px"></div>`).join('')}
          <button class="btn sm outline-gold">Salvar</button></form></div>
      <div class="card mb"><h3 style="margin-top:0">E-mail da plataforma (avisos de pedido)</h3>
        <p class="xs muted">Chave do Brevo usada por <b>todas as oficinas</b> que não colaram a própria: os avisos de pedido de orçamento e da vitrine saem por ela, com o nome da oficina como remetente. O Brevo grátis envia até 300 e-mails por dia no total.</p>
        <div id="ep-st" class="small muted mb">Carregando...</div>
        <form id="ep-f">
          <div class="form-row">${field('E-mail remetente (confirmado no Brevo)', '<input class="input" name="remetente" type="email" placeholder="contato@seudominio.com.br">')}
            ${field('Chave de API do Brevo', '<input class="input" name="chave" type="password" autocomplete="off" placeholder="xkeysib-...">')}</div>
          <label class="check" style="padding:4px 0 10px"><input type="checkbox" name="ativo" checked> Enviar avisos das lojas por esta conta</label>
          <div class="row" style="gap:8px"><button class="btn sm primary">${icon('check', 'sm')} Salvar</button><button type="button" class="btn sm" id="ep-teste">Enviar teste para mim</button></div>
        </form></div>
      <div class="card"><h3 style="margin-top:0">Configurações</h3>
        ${[['kiwify_area_cliente_url', 'Link da área do cliente na Kiwify (cartão/cancelamento)', 'text'], ['hotmart_area_cliente_url', 'Link da área do cliente na Hotmart (cartão/cancelamento)', 'text'], ['checkout_param_email', 'Parâmetro de e-mail no checkout (só se a Kiwify aceitar)', 'text'],
           ['dias_teste', 'Dias de teste grátis', 'number'], ['tolerancia_atraso_dias', 'Dias de tolerância no atraso', 'number'], ['dominios_base', 'Domínios da plataforma para subdomínios (separados por vírgula)', 'text']]
          .map(([k, l, t]) => `<form class="row mb" data-cf="${k}" data-t="${t}" style="gap:8px;align-items:flex-end"><div class="field grow" style="margin:0"><label>${l}</label><input class="input" name="v" value="${esc(Array.isArray(cfg[k]) ? cfg[k].join(', ') : (cfg[k] ?? ''))}"></div><button class="btn sm">Salvar</button></form>`).join('')}</div>`;
    this.emailPlataforma();
    $('#pd-novo').onclick = () => this.produto({ tipo: 'plano', ativo: true });
    $$('[data-pe]').forEach(b => b.onclick = () => this.produto(r.produtos.find(p => p.id === b.dataset.pe)));
    $$('[data-pp]').forEach(fm => fm.onsubmit = async e => { e.preventDefault(); const v = readForm(fm);
      try { await this.api('salvar_plano', { p_id: fm.dataset.pp, p_preco: v.preco ? parseMoney(v.preco) : null, p_max: parseInt(v.max), p_franquia: parseInt(v.franquia) }); toast('Plano salvo'); } catch {} });
    $('#ph-f').onsubmit = async e => { e.preventDefault(); const v = readForm(e.target); const valor = { moeda: (v.moeda || 'CLP').trim().toUpperCase() };
      for (const id of ['essencial', 'pro']) { const n = Number(String(v[id] || '').replace(/\./g, '').replace(',', '.')); if (n > 0) valor[id] = n; }
      try { await this.api('config', { p_chave: 'precos_hotmart', p_valor: valor }); toast('Preços salvos'); } catch {} };
    $$('[data-cf]').forEach(fm => fm.onsubmit = async e => { e.preventDefault(); const v = fm.v.value.trim(), k = fm.dataset.cf;
      const valor = k === 'dominios_base' ? v.split(',').map(x => x.trim().toLowerCase()).filter(Boolean) : fm.dataset.t === 'number' ? Number(v) : v;
      try { await this.api('config', { p_chave: k, p_valor: valor }); toast('Configuração salva'); } catch {} });
  },
  async emailPlataforma() {
    const st = $('#ep-st'), f = $('#ep-f');
    const mostrar = d => {
      st.innerHTML = !d?.configurado ? '<span class="pill red">Sem chave</span> As lojas sem chave própria não recebem avisos por e-mail.'
        : `${d.ativo ? '<span class="pill green">Ativo</span>' : '<span class="pill">Pausado</span>'} Enviando de <b>${esc(d.remetente || '')}</b> · chave ${esc(d.chave)} · ${d.lojas_proprias} loja(s) com chave própria${d.lojas_pausadas ? ` · ${d.lojas_pausadas} pausada(s)` : ''}`;
      if (d?.remetente) f.remetente.value = d.remetente;
      if (d?.configurado) { f.ativo.checked = !!d.ativo; f.chave.placeholder = `Salva (${d.chave}) · cole outra para trocar`; }
    };
    try { mostrar(await this.api('email_plataforma')); } catch { st.textContent = 'Rode a migração 19 (e-mail da plataforma) no Supabase.'; }
    f.onsubmit = async e => {
      e.preventDefault();
      const chave = f.chave.value.trim();
      if (chave && !/^xkeysib-/.test(chave)) return toast('A chave do Brevo começa com xkeysib-', true);
      try { mostrar(await this.api('salvar_email_plataforma', { p_api_key: chave, p_remetente: f.remetente.value.trim().toLowerCase(), p_ativo: f.ativo.checked })); f.chave.value = ''; toast('E-mail da plataforma salvo'); } catch {}
    };
    $('#ep-teste').onclick = async ev => {
      const b = ev.currentTarget; b.disabled = true;
      try {
        const { data } = await this.sb.auth.getSession();
        const id = await this.api('testar_email_plataforma', { p_para: data.session?.user?.email });
        toast('Enviando teste...');
        let r = null;
        for (let i = 0; i < 6 && !r?.status && !r?.erro; i++) { await new Promise(ok => setTimeout(ok, 1500)); r = await this.api('resultado_email', { p_id: id }); }
        if (r?.status >= 200 && r.status < 300) toast('Teste enviado para o seu e-mail. Confira a caixa de entrada (e o spam).');
        else if (r?.status) toast(`O Brevo recusou (${r.status}): ${/IP address|unrecogni[sz]ed IP|authori[sz]ed_ips/i.test(r.resposta || '') ? 'IP bloqueado (Brevo → Segurança → IPs autorizados)' : /sender/i.test(r.resposta || '') ? 'remetente não confirmado no Brevo' : /key|unauthori/i.test(r.resposta || '') ? 'chave inválida' : (r.resposta || '').slice(0, 120)}`, true);
        else toast('Teste enviado. Confira a caixa de entrada em instantes.');
      } catch {} finally { b.disabled = false; }
    };
  },
  produto(p) {
    const m = openModal({ title: p.id ? 'Editar produto' : 'Novo produto', icon: 'card',
      body: `<div class="form-row">${field('Nome', `<input class="input" name="nome" value="${esc(p.nome || '')}">`)}${field('Plataforma', `<select class="input" name="provedor">${selectOpts({ kiwify: 'Kiwify', hotmart: 'Hotmart' }, p.provedor || 'kiwify')}</select>`)}</div>
        <div class="form-row">${field('ID do produto', `<input class="input" name="produto_id" value="${esc(p.produto_id || '')}" required>`)}${field('Oferta / ID do plano (Hotmart: o código depois de "off=" no link)', `<input class="input" name="oferta_id" value="${esc(p.oferta_id || '')}">`)}</div>
        <div class="form-row">${field('Tipo', `<select class="input" name="tipo">${selectOpts({ plano: 'Assinatura de plano', notas: 'Pacote de notas (avulso)' }, p.tipo)}</select>`)}
          ${field('Plano', `<select class="input" name="plano_id"><option value="">—</option>${selectOpts(PLANOS_N, p.plano_id)}</select>`)}</div>
        ${field('Quantidade de notas (pacote)', `<input class="input" name="qtd_notas" type="number" value="${esc(p.qtd_notas || '')}">`)}
        ${field('Link do checkout', `<input class="input" name="checkout_url" value="${esc(p.checkout_url || '')}" placeholder="https://pay.kiwify.com.br/... ou https://pay.hotmart.com/...">`)}
        ${field('Ativo', `<select class="input" name="ativo">${selectOpts({ true: 'Sim', false: 'Não' }, String(p.ativo !== false))}</select>`)}`,
      foot: `<button class="btn" data-close>Cancelar</button><button class="btn primary" id="pd-ok">Salvar</button>`,
      onMount: el => { $('#pd-ok', el).onclick = async () => { const v = readForm(el); if (!v.produto_id) return toast('Informe o ID do produto', true);
        try { await this.api('salvar_produto', { p: { ...v, id: p.id || null, ativo: v.ativo === 'true' } }); m.close(); toast('Produto salvo'); this.produtos(); } catch {} }; } });
  },

  async notas() {
    const mes = this.mesNotas || new Date().toISOString().slice(0, 7);
    const r = await this.api('consumo', { p_mes: mes });
    $('#adm-c').innerHTML = `<div class="row mb" style="gap:8px"><input class="input" type="month" id="nt-m" value="${mes}" style="width:auto"><button class="btn sm" id="nt-csv">${icon('download', 'sm')} Exportar CSV</button></div>
      <div class="card pad-0 tbl-wrap"><table class="adm-t"><tr><th>Loja</th><th>Franquia</th><th>Créditos</th><th>Total autorizadas</th><th>Rejeitadas</th><th>Canceladas</th></tr>
      ${r.map(x => `<tr><td>${esc(x.loja)}</td><td>${x.franquia}</td><td>${x.creditos}</td><td><b>${x.franquia + x.creditos}</b></td><td>${x.rejeitadas}</td><td>${x.canceladas}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">Nenhuma nota neste mês.</td></tr>'}</table></div>
      <p class="xs muted">Use para conferir com a fatura do provedor fiscal. Canceladas continuam contando (já autorizadas).</p>`;
    $('#nt-m').onchange = e => { this.mesNotas = e.target.value; this.notas(); };
    $('#nt-csv').onclick = () => {
      const linhas = [['loja', 'loja_id', 'mes', 'franquia', 'creditos', 'total_autorizadas', 'rejeitadas', 'canceladas'], ...r.map(x => [x.loja, x.loja_id, x.mes, x.franquia, x.creditos, x.franquia + x.creditos, x.rejeitadas, x.canceladas])];
      const csv = linhas.map(l => l.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(';')).join('\n');
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' })); a.download = `notas-${mes}.csv`; a.click();
    };
  },

  async avisos() {
    const r = await this.api('avisos');
    $('#adm-c').innerHTML = `<div class="card pad-0">${r.map(a => `<div class="item" style="cursor:default;${a.lido ? 'opacity:.5' : ''}"><div class="row between"><div><b>${esc(a.texto)}</b>
      <div class="xs muted">${fmtDateTime(a.criado_em)} · ${esc(a.tipo)}${a.loja ? ' · ' + esc(a.loja) : ''}</div></div>${a.lido ? '' : `<button class="btn sm" data-al="${a.id}">Lido</button>`}</div></div>`).join('') || '<div class="empty">Nenhum aviso.</div>'}</div>`;
    $$('[data-al]').forEach(b => b.onclick = async () => { await this.api('aviso_lido', { p_id: +b.dataset.al }); this.avisos(); });
  },

  // Mensagem em pop-up para todas as pessoas de todas as oficinas (cada uma vê uma vez, ao abrir o sistema)
  async comunicados() {
    const r = await this.api('comunicados');
    const IDI = { todos: '', pt: 'só português', es: 'só espanhol' };
    const lado = (pref, cor, titulo, dica, exT, exM) => `<div class="card" style="border-color:var(--${cor})">
        <h3 style="margin-bottom:2px">${origemPill(pref ? 'hotmart' : 'kiwify')} ${titulo}</h3><p class="xs muted" style="margin:0 0 10px">${dica}</p>
        ${field('Título (opcional)', `<input class="input" name="titulo${pref}" maxlength="120" placeholder="${exT}">`)}
        ${field('Mensagem', `<textarea class="input" name="mensagem${pref}" rows="6" maxlength="4000" placeholder="${exM}"></textarea>`)}</div>`;
    $('#adm-c').innerHTML = `<form id="cm-form" class="card mb"><h3>Novo comunicado</h3>
        <p class="xs muted" style="margin-top:-4px">Um envio só: cada oficina recebe a versão de onde assina, em pop-up, na próxima vez que abrir o sistema (uma vez por pessoa).
          Lojas em teste ou sem assinatura recebem pelo idioma da oficina. Deixe um lado em branco para mandar só para o outro.</p>
        <div class="grid grid-2">
          ${lado('', 'green', 'Lojas Kiwify · português', 'Lojas do Brasil (e lojas sem assinatura em português).', 'Ex.: Novidade no sistema', 'Ex.: Lojistas, atualizem a página para ver a nova função.')}
          ${lado('_es', 'orange', 'Lojas Hotmart · espanhol', 'Lojas do Chile e demais em espanhol (e lojas sem assinatura em espanhol).', 'Ej.: Novedad en el sistema', 'Ej.: Tiendas, actualicen la página para ver la nueva función.')}
        </div>
        <button class="btn primary mt">${icon('bell', 'sm')} Enviar para as lojas</button></form>
      <div class="card pad-0">${r.map(c => {
        const v = (t, m, pill) => m ? `<div style="margin-top:6px">${origemPill(pill)} ${t ? `<b>${esc(t)}</b>` : ''}<div style="white-space:pre-wrap">${esc(m)}</div></div>` : '';
        return `<div class="item" style="cursor:default;${c.ativo ? '' : 'opacity:.55'}"><div class="row between" style="align-items:flex-start;gap:12px">
          <div style="min-width:0">${v(c.titulo, c.mensagem, c.idioma === 'es' ? 'hotmart' : 'kiwify')}${v(c.titulo_es, c.mensagem_es, 'hotmart')}
            <div class="xs muted" style="margin-top:6px">${fmtDateTime(c.criado_em)}${IDI[c.idioma] ? ' · ' + IDI[c.idioma] : ''} · visto por ${c.lidos} pessoa(s)
              ${c.ativo ? '<span class="pill xs green">no ar</span>' : '<span class="pill xs">desativado</span>'}</div></div>
          <button class="btn sm" data-cm="${c.id}" data-on="${c.ativo ? 0 : 1}">${c.ativo ? 'Desativar' : 'Reativar'}</button></div></div>`;
      }).join('') || '<div class="empty">Nenhum comunicado enviado.</div>'}</div>`;
    $('#cm-form').onsubmit = async e => {
      e.preventDefault();
      const f = readForm(e.target), pt = !!f.mensagem.trim(), es = !!f.mensagem_es.trim();
      if (!pt && !es) return toast('Escreva a mensagem de pelo menos um lado', true);
      const para = pt && es ? 'todas as oficinas (Kiwify em português e Hotmart em espanhol)' : pt ? 'só as lojas Kiwify / português' : 'só as lojas Hotmart / espanhol';
      if (!(await confirmDialog(`Enviar para ${para}? Cada pessoa verá o pop-up ao abrir o sistema.`, { ok: 'Enviar' }))) return;
      await this.api('salvar_comunicado2', { p_titulo: f.titulo, p_mensagem: f.mensagem, p_titulo_es: f.titulo_es, p_mensagem_es: f.mensagem_es });
      toast('Comunicado enviado'); this.comunicados();
    };
    $$('[data-cm]').forEach(b => b.onclick = async () => { await this.api('comunicado_ativo', { p_id: +b.dataset.cm, p_ativo: b.dataset.on === '1' }); this.comunicados(); });
  },

  async auditoria() {
    const r = await this.api('auditoria', { p_limite: POR_PAG, p_offset: this.aud * POR_PAG });
    this.audObj = this.audObj || { pag: 0 }; this.audObj.pag = this.aud;
    $('#adm-c').innerHTML = `<div class="card pad-0 tbl-wrap"><table class="adm-t"><tr><th>Data</th><th>Quem</th><th>Ação</th><th>Loja</th><th>Antes → depois</th></tr>
      ${r.itens.map(a => `<tr><td>${fmtDateTime(a.criado_em)}</td><td class="xs">${esc(a.ator || '')}</td><td>${esc(a.acao)}${a.motivo ? `<div class="xs muted">${esc(a.motivo)}</div>` : ''}</td><td>${esc(a.loja || '—')}</td>
        <td class="xs" style="max-width:360px">${esc(JSON.stringify(a.antes || {}))} → ${esc(JSON.stringify(a.depois || {}))}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">Nada registrado.</td></tr>'}</table></div>
      <div class="row between mt"><span class="xs muted">${r.total} registro(s)</span><div class="row" style="gap:6px"><button class="btn sm" ${this.aud ? '' : 'disabled'} onclick="Admin.aud--;Admin.auditoria()">Anterior</button>
        <button class="btn sm" ${(this.aud + 1) * POR_PAG < r.total ? '' : 'disabled'} onclick="Admin.aud++;Admin.auditoria()">Próxima</button></div></div>`;
  },
};
document.addEventListener('DOMContentLoaded', () => Admin.start());
