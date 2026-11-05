/* Ordens de Serviço + Bancada */
const OSPage = {
  st: { tab: 'andamento', q: '', page: 1, per: 50, showValor: true },

  render(main, params) {
    if (params.status) { this.st.tab = 'todas'; this.st.statusFilter = params.status; } else this.st.statusFilter = '';
    if (params.tab) this.st.tab = params.tab;
    if (params.q) this.st.q = params.q;
    const os = Store.db.os.filter(o => !o.deleted);
    const ativos = os.filter(o => OS_ATIVOS.includes(o.status));
    const finalizadas = os.filter(o => o.concluidoEm);
    const media = finalizadas.length ? finalizadas.reduce((s, o) => s + Math.max(0, daysBetween(o.criadoEm, o.concluidoEm)), 0) / finalizadas.length : 0;
    main.innerHTML = `
      ${pageHead('file', 'Ordens de Serviço', 'Histórico completo e registro de entradas')}
      <div class="page-actions">
        <button class="btn" onclick="Pages.config.auditoria()">${icon('shield')} Auditoria</button>
        <button class="btn primary" onclick="OSPage.novaOS()">${icon('plus')} Nova OS</button>
      </div>
      <div class="grid grid-2 mb">
        <div class="stat"><div class="label">Total em bancada</div><div class="value">${ativos.length} <span class="pill gold" style="font-size:13px;vertical-align:middle">Ativos</span></div></div>
        <div class="stat"><div class="label row between">Valor estimado <button class="icon-btn" style="width:28px;height:28px" onclick="OSPage.st.showValor=!OSPage.st.showValor;App.refresh()">${icon(this.st.showValor ? 'eye' : 'eyeOff', 'sm')}</button></div><div class="value gold">${this.st.showValor ? money(ativos.reduce((s, o) => s + Store.osTotal(o), 0)) : 'R$ •••••'}</div></div>
        <div class="stat"><div class="label">${icon('xCircle', 'sm')} Total interrompido</div><div class="value">${os.filter(o => o.status === 'interrompido').length}</div></div>
        <div class="stat"><div class="label">${icon('clock', 'sm')} Tempo médio em bancada</div><div class="value">${finalizadas.length ? (media < 1 ? '< 1 dia' : media.toFixed(1).replace('.', ',') + ' dias') : '—'}</div></div>
      </div>
      <div class="card mb" style="padding:12px">
        <div class="tabs" id="os-tabs">
          ${(() => { const n = Pedidos.naoLidos().length; return `<button data-k="pedidos" class="${this.st.tab === 'pedidos' ? 'on' : ''}" style="${n ? 'color:var(--gold)' : ''}">${icon('chat', 'sm')}Pedidos${n ? ` <span class="pill gold xs" style="padding:1px 7px">${n} não lido${n > 1 ? 's' : ''}</span>` : ''}</button>`; })()}
          ${[['todas', 'Todas'], ['andamento', 'Em Andamento'], ['finalizadas', 'Finalizadas'], ['lixeira', 'Lixeira']].map(([k, l]) => `<button data-k="${k}" class="${this.st.tab === k ? 'on' : ''}">${k === 'lixeira' ? icon('trash', 'sm') : ''}${l}</button>`).join('')}
        </div>
        <div class="toolbar">
          <div class="input-icon">${icon('search')}<input class="input" id="os-q" placeholder="Buscar cliente, IMEI, OS..." value="${esc(this.st.q)}"></div>
          <button class="btn" id="os-filter" title="Filtrar status">${icon('filter')}</button>
        </div>
        ${this.st.statusFilter ? `<div class="row mt"><span class="small muted">Filtro:</span><span class="pill gold">${this.st.statusFilter === 'atrasadas' ? 'Atrasadas' : OS_STATUS[this.st.statusFilter]?.label}</span><button class="btn sm ghost" onclick="App.go('os')">${icon('x', 'sm')} Limpar</button></div>` : ''}
      </div>
      <div class="card pad-0" id="os-list"></div>`;

    $$('#os-tabs button').forEach(b => b.onclick = () => { this.st.tab = b.dataset.k; this.st.page = 1; $$('#os-tabs button').forEach(x => x.classList.toggle('on', x === b)); this.renderList(); });
    $('#os-q').oninput = e => { this.st.q = e.target.value; this.st.page = 1; this.renderList(); };
    $('#os-filter').onclick = e => {
      e.stopPropagation();
      dropdown(e.currentTarget, [{ label: 'Todos os status', k: '', on: !this.st.statusFilter }, ...Etapas.opcoes().map(([k, s]) => ({ label: s.label, icon: s.icon, k, on: this.st.statusFilter === k })), { label: 'Atrasadas', icon: 'clock', k: 'atrasadas', on: this.st.statusFilter === 'atrasadas' }],
        it => it.k ? App.go('os', { status: it.k }) : App.go('os'));
    };
    this.renderList();
  },

  filtered() {
    const { tab, q, statusFilter } = this.st;
    let list = Store.db.os.filter(o => tab === 'lixeira' ? o.deleted : !o.deleted);
    if (tab === 'andamento') list = list.filter(o => OS_ATIVOS.includes(o.status));
    if (tab === 'finalizadas') list = list.filter(o => ['pago', 'interrompido'].includes(o.status));
    if (statusFilter === 'atrasadas') list = list.filter(o => OS_ATIVOS.includes(o.status) && o.status !== 'concluido' && o.previsao && dayKey(o.previsao) < dayKey());
    else if (statusFilter) list = list.filter(o => o.status === statusFilter);
    if (q) list = list.filter(o => { const c = Store.cliente(o.clienteId); return matches(q, '#' + o.numero, String(o.numero), c?.nome, c?.telefone, c?.doc, o.aparelho?.modelo, o.aparelho?.imei, o.defeito, o.servico); });
    return list.sort((a, b) => b.numero - a.numero);
  },

  renderList() {
    const box = $('#os-list'); if (!box) return;
    // aba de pedidos de orçamento enviados pelos clientes
    $('.toolbar', box.parentElement)?.classList.toggle('hidden', this.st.tab === 'pedidos');
    box.classList.toggle('pad-0', this.st.tab !== 'pedidos'); box.classList.toggle('card', this.st.tab !== 'pedidos');
    if (this.st.tab === 'pedidos') { box.innerHTML = Pedidos.lista(); return; }
    const p = paginate(this.filtered(), this.st.page, this.st.per);
    box.innerHTML = `
      <div class="list-head"><b>Mostrando ${p.from}–${p.to} de ${p.total}</b>
        <div class="row"><span class="small muted">Por página</span><select class="input" style="width:90px;min-height:38px;padding:6px 12px" id="os-per">${selectOpts([10, 25, 50, 100], this.st.per)}</select></div></div>
      ${p.items.length ? p.items.map(o => this.itemHTML(o)).join('') : `<div class="empty">${icon('file')}<div>Nenhuma ordem de serviço encontrada.</div></div>`}
      ${pagerHTML(p, 'OSPage.goPage')}`;
    $('#os-per').onchange = e => { this.st.per = +e.target.value; this.st.page = 1; this.renderList(); };
  },
  goPage(n) { this.st.page = n; this.renderList(); $('#os-list').scrollIntoView({ behavior: 'smooth' }); },

  itemHTML(o) {
    const c = Store.cliente(o.clienteId);
    const s = OS_STATUS[o.status];
    const atrasada = OS_ATIVOS.includes(o.status) && o.status !== 'concluido' && o.previsao && dayKey(o.previsao) < dayKey();
    const receber = o.status !== 'pago' && o.status !== 'interrompido' && Store.osTotal(o) > 0;
    return `<div class="item bar" style="--bar:${s.color}" onclick="OSPage.detalhe('${o.id}')">
      <div class="row between" style="align-items:flex-start">
        <div class="grow">
          <div class="meta"><span class="num">#${o.numero}</span><span>${icon('calendar', 'sm')} ${fmtDate(o.criadoEm)}</span>
            ${receber ? `<span class="pill orange">${icon('clock', 'sm')} A receber</span>` : ''}
            ${o.status === 'pago' ? `<span class="pill gold">${icon('dollar', 'sm')} Recebido</span>` : ''}
            ${atrasada ? `<span class="pill red">Atrasada</span>` : ''}</div>
          <div class="title" style="margin-top:8px">${esc(c?.nome || 'Cliente removido')}</div>
          <div class="device">${icon('phone', 'sm')} ${esc(o.aparelho?.modelo || '—')}</div>
        </div>
        <div class="price">${money(Store.osTotal(o))}</div>
      </div>
      ${o.defeito || o.servico ? `<div class="desc">${esc(o.servico || o.defeito)}</div>` : ''}
      <div class="row between" style="margin-top:12px">
        <span class="small muted">${o.previsao ? `Previsão ${fmtDate(o.previsao)}` : ''}</span>
        ${o.deleted ? `<button class="btn sm outline-gold" onclick="event.stopPropagation();OSPage.restaurar('${o.id}')">${icon('undo', 'sm')} Restaurar</button>`
          : `<button class="status-btn" style="color:${s.color};border-color:${s.color}55;background:${s.color}14" onclick="event.stopPropagation();OSPage.statusMenu('${o.id}',this)">${icon(s.icon, 'sm')} ${s.label} ${icon('chevDown', 'sm')}</button>`}
      </div>
    </div>`;
  },

  statusMenu(id, anchor) {
    const o = Store.osById(id);
    dropdown(anchor, Etapas.opcoes(o.status).map(([k, s]) => ({ k, label: s.label, icon: s.icon, on: o.status === k })), it => this.mudarStatus(o, it.k));
  },

  mudarStatus(o, k) {
    if (k === o.status) return;
    if (k === 'pago') return this.pagamento(o);
    if (o.status === 'pago') {
      return confirmDialog(`A OS #${o.numero} está paga. Mudar o status remove o recebimento do financeiro. Continuar?`, { danger: true, ok: 'Mudar status' })
        .then(ok => { if (ok) { Store.setOSStatus(o, k); App.refresh(); toast('Status atualizado'); } });
    }
    Store.setOSStatus(o, k);
    toast(`OS #${o.numero}: ${OS_STATUS[k].label}`);
    App.refresh();
    if (k === 'concluido') this.reparoFinalizado(o);
  },

  /* ---------- Link de acompanhamento ---------- */
  // Só existe com a nuvem ligada (a página pública lê a OS no Supabase)
  link(o) { return Cloud.loja ? Store.linkOS(o) : null; },
  trechoLink(o) { const l = this.link(o); return l ? `\n\n🔎 ${t('Acompanhe o status em tempo real:')}\n${l}` : ''; },
  msgEntrada(o, c) {
    return `${t('Olá {nome}! Recebemos seu aparelho *{modelo}* na {loja}.', { nome: c.nome.split(' ')[0], modelo: o.aparelho?.modelo || '', loja: Store.s.loja })} 📱\n\nOS: *#${o.numero}*\n${t('Defeito')}: ${o.defeito}${o.valor ? `\n${t('Valor')}: ${money(Store.osTotal(o))}` : ''}${o.previsao ? `\n${t('Previsão')}: ${fmtDate(o.previsao)}` : ''}${this.trechoLink(o)}`;
  },
  msgPronto(o, c) {
    return `${t('Olá {nome}! Aqui é da {loja}.', { nome: c.nome.split(' ')[0], loja: Store.s.loja })} 📱✅\n\n${t('Seu aparelho *{modelo}* (OS #{n}) está *pronto para retirada*!', { modelo: o.aparelho?.modelo || '', n: o.numero })}\n\n${t('Valor')}: *${money(Store.osTotal(o))}*\n${t('Garantia')}: *${prazoGarantia(Store.garantiaDiasOS(o))}* (${t('até')} ${fmtDate(Store.garantiaFim(o) || addDays(new Date(), Store.garantiaDiasOS(o)))})${this.link(o) ? `\n\n📄 ${t('Acompanhe e baixe sua garantia em PDF:')}\n${this.link(o)}` : ''}\n\n${t('Aguardamos você!')}`;
  },
  msgStatus(o, c) {
    return `${t('Olá {nome}! Aqui é da {loja}.', { nome: c.nome.split(' ')[0], loja: Store.s.loja })}\n\n${t('Atualização da sua OS #{n} ({modelo}):', { n: o.numero, modelo: o.aparelho?.modelo || '' })}\n${t('Status')}: *${t(OS_STATUS[o.status].label)}*${o.previsao ? `\n${t('Previsão')}: ${fmtDate(o.previsao)}` : ''}\n${t('Valor')}: ${money(Store.osTotal(o))}${this.trechoLink(o)}`;
  },
  async copiarLink(id) {
    const o = Store.osById(id); const l = this.link(o);
    if (!l) return toast('Ligue a nuvem (Supabase) para usar o link de acompanhamento', true);
    try { await navigator.clipboard.writeText(l); toast('Link copiado'); } catch { prompt('Copie o link:', l); }
  },
  abrirWhats(id, tipo) {
    const o = Store.osById(id), c = Store.cliente(o.clienteId);
    if (!c?.telefone) return toast('Cliente sem telefone cadastrado', true);
    const msg = tipo === 'entrada' ? this.msgEntrada(o, c) : tipo === 'pronto' ? this.msgPronto(o, c) : this.msgStatus(o, c);
    window.open(waLink(c.telefone, msg), '_blank');
  },

  /* ---------- PDF da OS (1 via) ---------- */
  async pdfOS(id, compartilhar) {
    if (!(await Pdf.escolherFormato('PDF da OS'))) return;
    const o = Store.osById(id);
    if (Cloud.loja) Store.tokenOS(o); // inclui o link de acompanhamento no PDF
    toast('Gerando PDF da OS...');
    const doc = await Pdf.ordem(o);
    const nome = `os-${o.numero}.pdf`;
    if (compartilhar) await Pdf.compartilhar(doc, nome, `OS #${o.numero} — ${Store.s.loja}`); else Pdf.baixar(doc, nome);
  },

  // Imprimir a OS: A4 pela impressão da tela; cupom 80/58 mm pelo PDF do cupom
  async imprimirOS(id) {
    const f = await Pdf.escolherFormato('Imprimir OS');
    if (!f) return;
    const o = Store.osById(id);
    if (f === 'a4') return Print.os(o);
    if (Cloud.loja) Store.tokenOS(o);
    Pdf.abrirParaImprimir(await Pdf.ordem(o), `os-${o.numero}.pdf`);
  },

  /* ---------- PDF de garantia ---------- */
  async pdfGarantia(id, compartilhar) {
    if (!(await Pdf.escolherFormato('PDF da garantia'))) return;
    const o = Store.osById(id);
    if (!o.concluidoEm && o.status !== 'pago') { o.concluidoEm = nowISO(); Store.saveOS(o); }
    toast('Gerando PDF da garantia...');
    const d = GarantiaDados.os(o);
    const doc = await Pdf.garantia(d);
    if (compartilhar) await Pdf.compartilhar(doc, Pdf.nome(d), `Garantia da OS #${o.numero} — ${Store.s.loja}`);
    else Pdf.baixar(doc, Pdf.nome(d));
  },

  // Ao concluir o reparo: garantia em PDF + aviso ao cliente
  reparoFinalizado(o) {
    const c = Store.cliente(o.clienteId) || {};
    openModal({
      title: 'Reparo finalizado!', icon: 'shieldCheck', subtitle: `OS #${o.numero} · ${c.nome || ''} · ${o.aparelho?.modelo || ''}`,
      body: `<div class="card center mb" style="background:var(--gold-soft);border-color:rgba(var(--gold-rgb), .4)">
          <div class="small muted">Garantia do reparo</div><div class="gold bold" style="font-size:26px">${prazoGarantia(Store.garantiaDiasOS(o))}</div>
          <div class="small">${fmtDate(Store.garantiaInicio(o))} até <b>${fmtDate(Store.garantiaFim(o))}</b></div></div>
        <div class="col">
          <button class="btn primary" onclick="OSPage.pdfGarantia('${o.id}', true)">${icon('upload')} Compartilhar PDF da garantia</button>
          <button class="btn" onclick="OSPage.pdfGarantia('${o.id}')">${icon('download')} Baixar PDF da garantia</button>
          ${c.telefone ? `<button class="btn success" onclick="OSPage.abrirWhats('${o.id}','pronto')">${icon('whatsapp')} Avisar que está pronto${this.link(o) ? ' + link da garantia' : ''}</button>` : ''}
        </div>
        <p class="xs muted" style="margin-bottom:0">No celular, "Compartilhar" abre o WhatsApp com o PDF anexado. ${this.link(o) ? 'O cliente também pode baixar a garantia pelo link de acompanhamento.' : ''}</p>`,
      foot: `<button class="btn" data-close>Fechar</button>`,
    });
  },

  /* ---------- Pagamento ---------- */
  pagamento(o) {
    if (Cloud.papel() === 'tecnico') return toast('O pagamento é registrado pelo atendente ou pelo dono.', true);
    const total = Store.osTotal(o);
    openModal({
      title: 'Receber pagamento', icon: 'dollar', subtitle: `OS #${o.numero} · ${Store.cliente(o.clienteId)?.nome || ''}`,
      body: `
        <div class="card center mb" style="background:var(--gold-soft);border-color:rgba(var(--gold-rgb), .4)"><div class="small muted">Total a receber</div><div class="gold bold" style="font-size:32px" id="pg-total">${money(total)}</div></div>
        ${Store.s.exigirCaixa && !Store.caixaAberto() ? `<div class="info-box">${icon('alert')}<span>O caixa está fechado. <a href="#/caixa">Abrir caixa</a> antes de receber.</span></div>` : ''}
        ${field('Forma de pagamento', `<select class="input" name="forma">${selectOpts(FORMAS_PGTO, 'pix')}</select>`)}
        <div class="form-row">
          ${field('Valor do serviço', `<input class="input" name="valor" inputmode="decimal" value="${moneyInput(o.valor)}">`)}
          ${field('Desconto', `<input class="input" name="desconto" inputmode="decimal" value="${moneyInput(o.desconto)}">`)}
        </div>
        ${field('Data do pagamento', `<input class="input" type="date" name="data" value="${dayKey()}">`)}`,
      foot: `<button class="btn" data-close>Cancelar</button><button class="btn primary" id="pg-ok">${icon('check')} Confirmar pagamento</button>`,
      onMount: (el, m) => {
        const upd = () => { const f = readForm(el); $('#pg-total', el).textContent = money(parseMoney(f.valor) - parseMoney(f.desconto)); };
        $$('input', el).forEach(i => i.oninput = upd);
        $('#pg-ok', el).onclick = () => {
          if (Store.s.exigirCaixa && !Store.caixaAberto()) return toast('Abra o caixa primeiro', true);
          const f = readForm(el);
          o.valor = parseMoney(f.valor); o.desconto = parseMoney(f.desconto);
          const d = f.data === dayKey() ? new Date() : new Date(f.data + 'T12:00:00');
          Store.setOSStatus(o, 'pago', { forma: f.forma, data: d.toISOString() });
          closeAllModals(); App.refresh();
          this.garantiaModal(o);
        };
      },
    });
  },

  garantiaModal(o) {
    const s = Store.s;
    const tecs = s.tecnicos;
    let tecId = o.tecnicoId || tecs[0]?.id || '';
    const m = openModal({
      title: 'Imprimir Garantia', icon: 'printer',
      body: `<div class="center"><div style="width:80px;height:80px;border-radius:50%;margin:0 auto 12px;display:grid;place-items:center;background:var(--gold-soft);color:var(--gold)">${icon('shieldCheck', 'lg')}</div>
        <h2 style="margin:0 0 6px">Pagamento <span class="gold">Confirmado!</span></h2>
        <p class="muted" style="margin:0 0 18px">A OS #${o.numero} foi marcada como paga. Como deseja emitir a garantia?</p></div>
        <div class="card" style="background:var(--bg-2)">
          <div class="row" style="align-items:flex-start"><div class="stat-icon"><div class="ic">${icon('pen')}</div></div>
          <div><b>Responsável e assinatura técnica</b><div class="small muted">Identifica quem acompanhou o serviço e preenche a assinatura do técnico nos documentos.</div></div></div>
          <div class="mt" id="gar-tec"></div>
        </div>
        <div class="card mt center"><div class="small muted">Garantia do reparo</div><b class="gold" style="font-size:20px">${prazoGarantia(Store.garantiaDiasOS(o))}</b><div class="small">até ${fmtDate(Store.garantiaFim(o))}</div></div>`,
      foot: `<button class="btn primary block" id="gar-share" style="flex-basis:100%">${icon('upload')} Compartilhar PDF da garantia</button>
        <button class="btn" id="gar-pdf">${icon('download')} Baixar PDF</button>
        ${Store.cliente(o.clienteId)?.telefone ? `<a class="btn success" target="_blank" href="${waLink(Store.cliente(o.clienteId).telefone, `${t('Olá! Obrigado por escolher a {loja}.', { loja: s.loja })} 🙏\n\n${t('Seu serviço (OS #{n}) tem *garantia de {prazo}*, válida até {data}.', { prazo: prazoGarantia(Store.garantiaDiasOS(o)), n: o.numero, data: fmtDate(Store.garantiaFim(o)) })}${this.link(o) ? `\n\n📄 ${t('Baixe sua garantia em PDF:')}\n${this.link(o)}` : ''}\n\n${t('Qualquer coisa, estamos à disposição!')}`)}">${icon('whatsapp')} WhatsApp</a>` : ''}
        <button class="btn" data-close>Fechar</button>`,
      onMount: (el) => {
        const renderTec = () => {
          const t = tecs.find(x => x.id === tecId);
          $('#gar-tec', el).innerHTML = tecs.length ? `
            ${field('Técnico responsável', `<select class="input" id="gar-tsel">${selectOpts(tecs.map(t => [t.id, t.nome]), tecId)}</select>`)}
            ${t && !t.assinatura ? `<div class="info-box">${icon('pen')}<div><b>${esc(t.nome)}</b> ainda não tem uma assinatura cadastrada. <span class="pill gold xs">Opcional</span><div class="small muted">Sem ela, o campo "Assinatura do técnico" ${s.assinaturaDono ? 'usará a assinatura do dono.' : 'sai em branco para assinar à mão.'}</div></div></div>
              <button class="btn primary block" id="gar-sign">${icon('pen')} Assinar agora</button>` : t ? `<div class="row small gold">${icon('checkCircle', 'sm')} Assinatura cadastrada</div>` : ''}`
            : `<div class="small muted">Nenhum técnico cadastrado. <a href="#/config">Cadastrar técnicos</a> — a assinatura sai em branco para assinar à mão.</div>`;
          const sel = $('#gar-tsel', el); if (sel) sel.onchange = () => { tecId = sel.value; renderTec(); };
          const sg = $('#gar-sign', el); if (sg) sg.onclick = () => Pages.config.assinar(tecs.find(x => x.id === tecId), renderTec);
        };
        renderTec();
        const gerar = comp => { if (tecId) { o.tecnicoId = tecId; Store.saveOS(o); } this.pdfGarantia(o.id, comp); };
        $('#gar-share', el).onclick = () => gerar(true);
        $('#gar-pdf', el).onclick = () => gerar(false);
      },
    });
    return m;
  },

  /* ---------- Nova OS (assistente) ---------- */
  novaOS(pre = {}) {
    const w = { step: pre.aparelho && pre.clienteId ? 3 : pre.clienteId ? 2 : 1, clienteId: pre.clienteId || null, novoCliente: false, aparelho: pre.aparelho || null, q: '', fromOrc: pre.fromOrc };
    const m = openModal({ title: 'Nova Ordem de Serviço', icon: 'file', body: '<div id="wz"></div>', foot: '<div id="wz-foot" class="row grow" style="gap:10px"></div>' });
    const el = m.el;
    const body = () => $('#wz', el), foot = () => $('#wz-foot', el);
    const steps = ['Cliente', 'Aparelho', 'Serviço'];
    const stepper = () => `<div class="row" style="gap:6px;margin-bottom:18px">${steps.map((s, i) => `<div class="grow center"><div style="height:4px;border-radius:4px;background:${i < w.step ? 'var(--gold)' : 'var(--line-2)'}"></div><div class="xs ${i + 1 === w.step ? 'gold bold' : 'muted'}" style="margin-top:6px">${i + 1}. ${s}</div></div>`).join('')}</div>`;

    const render = () => {
      if (w.step === 1) return renderCliente();
      if (w.step === 2) return renderAparelho();
      renderServico();
    };

    const renderCliente = () => {
      if (w.novoCliente) {
        body().innerHTML = stepper() + `<div class="row mb"><button class="icon-btn" id="wz-back">${icon('arrowLeft')}</button><h3 style="margin:0">Novo <span class="gold">Cliente</span></h3></div>
          <div class="section-title">Dados do cliente</div>
          <div class="info-box">${icon('user')}<span>Essas informações ficam salvas na aba Clientes. <b>Só o nome é obrigatório</b> — o resto dá para completar depois.</span></div>
          ${ClientesPage.formFields({})}`;
        ClientesPage.bindForm(body());
        $('#wz-back', el).onclick = () => { w.novoCliente = false; render(); };
        foot().innerHTML = `<button class="btn primary grow" id="wz-next">Continuar ${icon('arrowRight')}</button>`;
        $('#wz-next', el).onclick = () => {
          const f = readForm(body());
          if (!f.nome) return toast('Informe o nome do cliente', true);
          const c = Store.saveCliente({ nome: f.nome, docTipo: f.docTipo, doc: f.doc, telefone: f.telefone, email: f.email, origem: f.origem, aparelhos: [] });
          w.clienteId = c.id; w.step = 2; render();
        };
        setTimeout(() => $('[name=nome]', el)?.focus(), 50);
        return;
      }
      body().innerHTML = stepper() + `<h3 style="margin:0 0 4px">Quem é o <span class="gold">cliente</span>?</h3><p class="muted small" style="margin:0 0 14px">Busque um cliente cadastrado ou crie um novo.</p>
        <button class="btn primary block mb" id="wz-new">${icon('userPlus')} Novo cliente</button>
        ${inputIcon('search', `id="wz-q" placeholder="Buscar por nome, telefone ou CPF..." value="${esc(w.q)}"`)}
        <div id="wz-res" class="mt"></div>`;
      foot().innerHTML = `<button class="btn grow" data-close-w>Cancelar</button>`;
      $('[data-close-w]', el).onclick = () => m.close();
      $('#wz-new', el).onclick = () => { w.novoCliente = true; render(); };
      const res = () => {
        const list = Store.clientesAtivos().filter(c => matches(w.q, c.nome, c.telefone, c.doc)).slice(0, 8);
        $('#wz-res', el).innerHTML = list.length ? `<div class="card pad-0">${list.map(c => `<div class="item" data-id="${c.id}" style="padding:12px 16px"><div class="row"><div class="avatar">${esc(c.nome[0]?.toUpperCase())}</div><div class="grow"><b>${esc(c.nome)}</b><div class="small muted">${esc(fmtPhone(c.telefone) || 'Sem telefone')} · ${(c.aparelhos || []).length} aparelho(s)</div></div>${icon('chevRight')}</div></div>`).join('')}</div>`
          : `<div class="empty small">${w.q ? 'Nenhum cliente encontrado.' : 'Nenhum cliente cadastrado ainda.'}</div>`;
        $$('#wz-res .item', el).forEach(it => it.onclick = () => { w.clienteId = it.dataset.id; w.step = 2; render(); });
      };
      $('#wz-q', el).oninput = e => { w.q = e.target.value; res(); };
      res();
    };

    const renderAparelho = () => {
      const c = Store.cliente(w.clienteId);
      const aps = c.aparelhos || [];
      const sel = w.aparelho;
      body().innerHTML = stepper() + `<div class="row mb"><button class="icon-btn" id="wz-back">${icon('arrowLeft')}</button><div><h3 style="margin:0">Qual <span class="gold">aparelho</span>?</h3><div class="small muted">${esc(c.nome)}</div></div></div>
        ${aps.length ? `<div class="lbl mb">Aparelhos do cliente</div><div class="col mb">${aps.map(a => `<button class="chip-opt ${sel && sel.id === a.id ? 'on' : ''}" style="flex-direction:row;justify-content:flex-start;padding:12px 14px;text-align:left" data-ap="${a.id}">${icon((TIPOS_APARELHO.find(t => t[0] === a.tipo) || [])[2] || 'phone')}<span class="grow"><b style="color:var(--text)">${esc(a.modelo)}</b><br><span class="xs">${esc(a.imei || '')} ${esc(a.cor || '')}</span></span></button>`).join('')}</div><div class="section-title">Ou cadastrar novo</div>` : ''}
        ${ClientesPage.aparelhoFields(sel && !sel.id ? sel : {})}`;
      ClientesPage.bindAparelho(body());
      $('#wz-back', el).onclick = () => { w.step = 1; w.aparelho = null; render(); };
      $$('[data-ap]', el).forEach(b => b.onclick = () => { w.aparelho = aps.find(a => a.id === b.dataset.ap); w.step = 3; render(); });
      foot().innerHTML = `<button class="btn primary grow" id="wz-next">Continuar ${icon('arrowRight')}</button>`;
      $('#wz-next', el).onclick = () => {
        const f = readForm($('#ap-form', el));
        if (!f.modelo) { if (sel && sel.id) { w.step = 3; return render(); } return toast('Informe o modelo do aparelho', true); }
        const ap = { id: uid(), tipo: f.tipo, modelo: f.modelo, imei: f.imei, idTipo: f.idTipo, cor: f.cor };
        c.aparelhos = [...aps, ap]; Store.saveCliente(c);
        w.aparelho = ap; w.step = 3; render();
      };
    };

    const renderServico = () => {
      const c = Store.cliente(w.clienteId);
      const pr = w.fromOrc || {};
      body().innerHTML = stepper() + `<div class="row mb"><button class="icon-btn" id="wz-back">${icon('arrowLeft')}</button><div><h3 style="margin:0">Problema e <span class="gold">serviço</span></h3><div class="small muted">${esc(c.nome)} · ${esc(w.aparelho.modelo)}</div></div></div>
        ${this.servicoFields({ defeito: pr.defeito, servico: pr.servico, valor: pr.valor, status: 'analise', previsao: dayKey(addDays(new Date(), 2)), fotos: pr.fotos, fotosImprimir: pr.fotosImprimir, aparelho: w.aparelho })}`;
      this.bindServico(body(), { fotos: pr.fotos, fotosImprimir: pr.fotosImprimir });
      $('#wz-back', el).onclick = () => { w.step = 2; render(); };
      foot().innerHTML = `<button class="btn primary grow" id="wz-save">${icon('check')} Abrir OS</button>`;
      $('#wz-save', el).onclick = () => {
        if (Fotos.ocupado(body())) return toast('Aguarde as fotos terminarem de enviar', true);
        const f = this.readServico(body());
        if (!f.defeito) return toast('Descreva o defeito relatado', true);
        const o = Store.saveOS(Object.assign(f, { clienteId: w.clienteId, aparelho: { ...w.aparelho }, pecas: [], orcamentoId: pr.id || null }));
        if (pr.id) { const orc = Store.db.orcamentos.find(x => x.id === pr.id); if (orc) { orc.status = 'aprovado'; orc.osId = o.id; Store.save(); } }
        m.close(); App.refresh();
        toast(`OS #${o.numero} aberta!`);
        this.posCriacao(o);
      };
    };
    render();
  },

  posCriacao(o) {
    const c = Store.cliente(o.clienteId);
    openModal({
      title: `OS #${o.numero} criada`, icon: 'checkCircle', subtitle: `${c.nome} · ${o.aparelho.modelo}`,
      body: `<p class="muted" style="margin-top:0">O que deseja fazer agora?</p>
        <div class="col" id="pc-acoes">
          ${c.telefone ? `<button class="btn success" style="min-height:54px;font-size:16px" onclick="OSPage.abrirWhats('${o.id}','entrada')">${icon('whatsapp')} ${this.link(o) ? 'Enviar link pelo WhatsApp' : 'Enviar comprovante no WhatsApp'}</button>` : `<div class="info-box">${icon('info')}<span>Cliente sem telefone: cadastre o WhatsApp para enviar o link.</span></div>`}
          ${this.link(o) ? `<button class="btn outline-gold" onclick="OSPage.copiarLink('${o.id}')">${icon('repeat')} Copiar link de acompanhamento</button>` : `<div class="xs muted">Ligue a nuvem (Supabase) para enviar o link de acompanhamento em tempo real.</div>`}
          <div class="grid grid-2"><button class="btn" onclick="OSPage.pdfOS('${o.id}', true)">${icon('upload')} PDF da OS</button><button class="btn" onclick="OSPage.imprimirOS('${o.id}')">${icon('printer')} Imprimir OS</button></div>
          <button class="btn" onclick="Print.osEtiqueta(Store.osById('${o.id}'))">${icon('tag')} Imprimir etiqueta do aparelho</button>
          <button class="btn" onclick="OSPage.assinaturaCliente('${o.id}')">${icon('pen')} Coletar assinatura do cliente</button>
        </div>`,
      foot: `<button class="btn" data-close>Concluir</button><button class="btn outline-gold" onclick="closeAllModals();OSPage.detalhe('${o.id}')">Ver OS</button>`,
    });
  },

  assinaturaCliente(id) {
    const o = Store.osById(id);
    openModal({
      title: 'Assinatura do cliente', icon: 'pen', subtitle: `OS #${o.numero}`,
      body: `<p class="small muted" style="margin-top:0">Peça ao cliente para assinar no quadro abaixo. Ela aparece na OS e na garantia.</p><canvas class="sig-pad" id="sig"></canvas>`,
      foot: `<button class="btn" id="sig-clear">Limpar</button><button class="btn primary" id="sig-ok">${icon('check')} Salvar</button>`,
      onMount: (el, m) => {
        const pad = signaturePad($('#sig', el));
        $('#sig-clear', el).onclick = () => pad.clear();
        $('#sig-ok', el).onclick = () => { if (pad.isEmpty()) return toast('Assinatura vazia', true); o.assinaturaCliente = pad.toDataURL(); Store.saveOS(o); m.close(); toast('Assinatura salva'); };
      },
    });
  },

  /* ---------- Campos de serviço (usado na criação e edição) ---------- */
  servicoFields(o) {
    const servs = Store.db.servicos.filter(s => !s.deleted);
    const tecs = Store.s.tecnicos;
    const ck = o.checklist || {};
    return `
      ${field('Defeito relatado', `<textarea class="input" name="defeito" placeholder="Ex: Não carrega, tela quebrada...">${esc(o.defeito || '')}</textarea>`, { req: true })}
      ${servs.length ? field('Serviço do catálogo', `<select class="input" id="sv-cat"><option value="">— Selecionar para preencher —</option>${servs.map(s => `<option value="${s.id}">${esc(s.nome)} · ${money(s.preco)}</option>`).join('')}</select>`, { opt: true }) : ''}
      ${field('Serviço a executar', `<input class="input" name="servico" placeholder="Ex: Troca de conector de carga" value="${esc(o.servico || '')}">`, { opt: true })}
      <div class="form-row">
        ${field('Valor (R$)', `<input class="input" name="valor" inputmode="decimal" placeholder="0,00" value="${o.valor ? moneyInput(o.valor) : ''}">`)}
        ${field('Previsão', `<input class="input" type="date" name="previsao" value="${o.previsao ? dayKey(o.previsao) : ''}">`)}
      </div>
      <div class="form-row">
        ${field('Status', `<select class="input" name="status">${selectOpts(Object.fromEntries(Etapas.opcoes(o.status).filter(([k]) => k !== 'pago').map(([k, s]) => [k, s.label])), o.status)}</select>`)}
        ${field('Técnico', `<select class="input" name="tecnicoId"><option value="">—</option>${selectOpts(tecs.map(t => [t.id, t.nome]), o.tecnicoId)}</select>`)}
      </div>
      <div class="form-row">
        ${field('Senha / padrão', `<input class="input" name="senha" placeholder="Senha do aparelho" value="${esc(o.senha || '')}">${Padrao.campoHTML(o)}`, { opt: true })}
        ${field('Garantia (dias)', `<input class="input" type="number" name="garantiaDias" min="0" max="3650" step="1" inputmode="numeric" value="${Store.garantiaDiasOS(o)}" oninput="OSPage.prazoHint(this)"><div class="xs muted mt" id="gar-prazo">${prazoGarantia(Store.garantiaDiasOS(o))} · ${t('padrão da loja')}: ${prazoGarantia(Store.garantiaDiasOS({}))}</div>`)}
      </div>
      ${field('Acessórios deixados', `<input class="input" name="acessorios" placeholder="Ex: Capinha, carregador, chip" value="${esc(o.acessorios || '')}">`, { opt: true })}
      <details class="mb" ${Object.keys(ck).length ? 'open' : ''}><summary class="lbl" style="cursor:pointer;padding:8px 0">${icon('checkCircle', 'sm')} Checklist de entrada <span class="opt muted">(toque para marcar OK / com defeito)</span></summary>
        <div class="grid grid-2 mt" id="ck">${CHECKLIST_ITENS.map(i => `<button type="button" class="chip-opt ${ck[i] ? 'on' : ''}" data-ck="${esc(i)}" data-v="${ck[i] || ''}" style="flex-direction:row;justify-content:space-between;padding:10px 12px"><span>${esc(i)}</span><b>${ck[i] === 'ok' ? '✓' : ck[i] === 'nok' ? '✗' : '–'}</b></button>`).join('')}</div>
      </details>
      ${Fotos.campoHTML(o)}
      ${field('Observações internas', `<textarea class="input" name="obs" placeholder="Ex: aparelho com marcas de uso">${esc(o.obs || '')}</textarea>`, { opt: true })}`;
  },
  bindServico(root, o = {}) {
    Fotos.ligar(root, o);
    Padrao.ligar(root, o);
    const cat = $('#sv-cat', root);
    if (cat) cat.onchange = () => {
      const s = Store.db.servicos.find(x => x.id === cat.value); if (!s) return;
      $('[name=servico]', root).value = s.nome; $('[name=valor]', root).value = moneyInput(s.preco);
    };
    $$('[data-ck]', root).forEach(b => b.onclick = () => {
      const nx = { '': 'ok', ok: 'nok', nok: '' }[b.dataset.v];
      b.dataset.v = nx; b.classList.toggle('on', !!nx);
      b.querySelector('b').textContent = nx === 'ok' ? '✓' : nx === 'nok' ? '✗' : '–';
      b.style.color = nx === 'nok' ? 'var(--red)' : '';
    });
  },
  // mostra o prazo por extenso enquanto digita os dias (ex.: 180 → 6 meses)
  prazoHint(el) {
    const h = el.parentElement.querySelector('#gar-prazo');
    if (h) h.textContent = `${prazoGarantia(parseInt(el.value, 10) || 0)} · ${t('padrão da loja')}: ${prazoGarantia(Store.garantiaDiasOS({}))}`;
  },
  readServico(root) {
    const f = readForm(root);
    const checklist = {};
    $$('[data-ck]', root).forEach(b => { if (b.dataset.v) checklist[b.dataset.ck] = b.dataset.v; });
    const gd = parseInt(f.garantiaDias, 10);
    return { defeito: f.defeito, servico: f.servico, valor: parseMoney(f.valor), previsao: f.previsao || null, status: f.status, tecnicoId: f.tecnicoId, senha: f.senha, acessorios: f.acessorios, obs: f.obs, checklist, ...Fotos.ler(root), ...Padrao.ler(root),
      garantiaDias: gd >= 0 && gd <= 3650 ? gd : Store.garantiaDiasOS({}) };
  },

  /* ---------- Detalhe ---------- */
  detalhe(id) {
    const o = Store.osById(id); if (!o) return;
    const c = Store.cliente(o.clienteId) || {};
    const s = OS_STATUS[o.status];
    const tec = Store.s.tecnicos.find(t => t.id === o.tecnicoId);
    const custo = Store.osCustoPecas(o);
    const m = openModal({
      title: `OS #${o.numero}`, subtitle: `${c.nome || ''} · ${o.aparelho?.modelo || ''}`, icon: 'file', wide: true,
      body: `
        <div class="row wrap mb">
          ${o.deleted ? '<span class="pill red">Na lixeira</span>' : `<button class="status-btn" id="d-status" style="color:${s.color};border-color:${s.color}55;background:${s.color}14">${icon(s.icon, 'sm')} ${s.label} ${icon('chevDown', 'sm')}</button>`}
          <span class="pill">${icon('calendar', 'sm')} Entrada ${fmtDate(o.criadoEm)}</span>
          ${o.previsao ? `<span class="pill">${icon('clock', 'sm')} Previsão ${fmtDate(o.previsao)}</span>` : ''}
          ${o.status === 'pago' ? `<span class="pill gold">${icon('dollar', 'sm')} Pago ${fmtDate(o.pagoEm)} · ${FORMAS_PGTO[o.pagamento?.forma] || ''}</span>` : ''}
        </div>
        <div class="grid grid-2 stack-sm mb">
          <div class="card">
            <h3>${icon('user', 'sm')} Cliente</h3>
            <div class="kv"><span class="k">Nome</span><span class="v">${esc(c.nome || '—')}</span></div>
            <div class="kv"><span class="k">Telefone</span><span class="v">${esc(fmtPhone(c.telefone) || '—')}</span></div>
            <div class="kv"><span class="k">${esc(c.docTipo || 'Documento')}</span><span class="v">${esc(c.doc || '—')}</span></div>
          </div>
          <div class="card">
            <h3>${icon('phone', 'sm')} Aparelho</h3>
            <div class="kv"><span class="k">Modelo</span><span class="v gold">${esc(o.aparelho?.modelo || '—')}</span></div>
            <div class="kv"><span class="k">${o.aparelho?.idTipo === 'serial' ? 'Serial' : 'IMEI'}</span><span class="v">${esc(o.aparelho?.imei || '—')}</span></div>
            <div class="kv"><span class="k">Senha</span><span class="v">${esc(o.senha || '—')}</span></div>
            ${Padrao.valido(o.padrao) ? `<div class="kv" style="align-items:center"><span class="k">Desenho</span><span class="v">${Padrao.svg(o.padrao, { size: 96 })}</span></div>` : ''}
          </div>
        </div>
        <div class="card mb">
          <h3>${icon('wrench', 'sm')} Serviço</h3>
          <div class="kv"><span class="k">Defeito</span><span class="v">${esc(o.defeito || '—')}</span></div>
          <div class="kv"><span class="k">Serviço</span><span class="v">${esc(o.servico || '—')}</span></div>
          <div class="kv"><span class="k">Técnico</span><span class="v">${esc(tec?.nome || '—')}</span></div>
          <div class="kv"><span class="k">Acessórios</span><span class="v">${esc(o.acessorios || '—')}</span></div>
          <div class="kv"><span class="k">Garantia</span><span class="v">${prazoGarantia(Store.garantiaDiasOS(o))}${Store.garantiaFim(o) ? ` · ${t('até')} <span class="gold">${fmtDate(Store.garantiaFim(o))}</span>` : ' (conta a partir da conclusão)'}</span></div>
          ${o.obs ? `<div class="kv"><span class="k">Obs.</span><span class="v">${esc(o.obs)}</span></div>` : ''}
          ${o.checklist && Object.keys(o.checklist).length ? `<div class="row wrap mt">${Object.entries(o.checklist).map(([k, v]) => `<span class="pill ${v === 'ok' ? 'green' : 'red'} xs">${v === 'ok' ? '✓' : '✗'} ${esc(k)}</span>`).join('')}</div>` : ''}
        </div>
        ${Fotos.galeriaHTML(o)}
        <div class="card mb">
          <div class="row between"><h3 style="margin:0">${icon('box', 'sm')} Peças utilizadas</h3>${o.deleted ? '' : `<span class="row" style="gap:6px"><button class="btn sm" onclick="Cotacao.abrir('pedido', { aparelho: Store.osById('${o.id}')?.aparelho?.modelo, osNumero: Store.osById('${o.id}')?.numero })">${icon('truck', 'sm')} Pedir peça</button><button class="btn sm outline-gold" id="d-addpeca">${icon('plus', 'sm')} Peça</button></span>`}</div>
          ${(o.pecas || []).length ? `<div class="mt">${o.pecas.map((p, i) => `<div class="cart-line"><div class="grow"><b>${esc(p.nome)}</b><div class="xs muted">${p.qtd}x · custo ${money(p.custo)}</div></div><b>${money(p.custo * p.qtd)}</b>${o.deleted ? '' : `<button class="icon-btn" data-rmp="${i}" title="Remover e devolver ao estoque">${icon('trash', 'sm')}</button>`}</div>`).join('')}</div>` : '<p class="small muted">Nenhuma peça lançada.</p>'}
        </div>
        <div class="card mb">
          <div class="kv"><span class="k">Valor do serviço</span><span class="v">${money(o.valor)}</span></div>
          ${o.desconto ? `<div class="kv"><span class="k">Desconto</span><span class="v red">-${money(o.desconto)}</span></div>` : ''}
          <div class="kv"><span class="k">Custo de peças</span><span class="v red">-${money(custo)}</span></div>
          <div class="kv"><span class="k">Total do cliente</span><span class="v gold" style="font-size:20px">${money(Store.osTotal(o))}</span></div>
          <div class="kv"><span class="k">Lucro bruto</span><span class="v green">${money(Store.osTotal(o) - custo)}</span></div>
        </div>
        ${this.link(o) && !o.deleted ? `<div class="card mb row between wrap"><div class="grow"><b>${icon('eye', 'sm')} Link de acompanhamento</b><div class="xs muted ellipsis">${esc(this.link(o))}</div></div>
          <div class="row"><button class="btn sm" onclick="OSPage.copiarLink('${o.id}')">Copiar</button>${c.telefone ? `<button class="btn sm success" onclick="OSPage.abrirWhats('${o.id}','status')">${icon('whatsapp', 'sm')} Enviar</button>` : ''}</div></div>` : ''}
        ${['concluido', 'pago'].includes(o.status) ? `<div class="card mb row between wrap"><div><b>${icon('shieldCheck', 'sm')} Garantia em PDF</b><div class="xs muted">${prazoGarantia(Store.garantiaDiasOS(o))} · ${t('até')} ${fmtDate(Store.garantiaFim(o))}</div></div>
          <div class="row"><button class="btn sm" onclick="OSPage.pdfGarantia('${o.id}')">${icon('download', 'sm')} Baixar</button><button class="btn sm primary" onclick="OSPage.pdfGarantia('${o.id}', true)">${icon('upload', 'sm')} Compartilhar</button></div></div>` : ''}
        <details class="card"><summary class="bold" style="cursor:pointer">${icon('history', 'sm')} Histórico</summary><div class="timeline mt">${(o.historico || []).slice().reverse().map(h => `<div class="ev"><b>${OS_STATUS[h.status]?.label || h.status}</b> <span class="muted">· ${fmtDateTime(h.data)}</span>${h.nota ? `<div class="xs muted">${esc(h.nota)}</div>` : ''}</div>`).join('')}</div></details>`,
      foot: o.deleted
        ? `<button class="btn outline-gold" onclick="OSPage.restaurar('${o.id}')">${icon('undo')} Restaurar</button><button class="btn danger" onclick="OSPage.excluirDef('${o.id}')">${icon('trash')} Excluir definitivamente</button>`
        : `${o.status !== 'pago' ? `<button class="btn primary" onclick="OSPage.pagamento(Store.osById('${o.id}'))">${icon('dollar')} Receber</button>` : `<button class="btn primary" onclick="OSPage.garantiaModal(Store.osById('${o.id}'))">${icon('shieldCheck')} Garantia</button>`}
          <button class="btn" onclick="OSPage.pdfOS('${o.id}', true)">${icon('file')} PDF da OS</button>
          <button class="btn" onclick="OSPage.imprimirOS('${o.id}')">${icon('printer')} Imprimir</button>
          ${c.telefone ? `<button class="btn success" onclick="OSPage.abrirWhats('${o.id}','${o.status === 'concluido' ? 'pronto' : 'status'}')">${icon('whatsapp')} WhatsApp</button>` : ''}
          <button class="btn" onclick="OSPage.editar('${o.id}')">${icon('edit')} Editar</button>
          <button class="btn" onclick="OSPage.assinaturaCliente('${o.id}')">${icon('pen')} Assinatura</button>
          <button class="btn danger" onclick="OSPage.excluir('${o.id}')">${icon('trash')}</button>`,
      onMount: (el, mm) => {
        Fotos.ligarGaleria(el);
        const ds = $('#d-status', el);
        if (ds) ds.onclick = e => { e.stopPropagation(); dropdown(ds, Etapas.opcoes(o.status).map(([k, s]) => ({ k, label: s.label, icon: s.icon, on: o.status === k })), it => { mm.close(); this.mudarStatus(o, it.k); }); };
        const ap = $('#d-addpeca', el);
        if (ap) ap.onclick = () => this.addPeca(o, () => { mm.close(); this.detalhe(o.id); });
        $$('[data-rmp]', el).forEach(b => b.onclick = () => {
          const p = o.pecas[+b.dataset.rmp];
          const pc = Store.peca(p.pecaId); if (pc) Store.movimentar('peca', pc, p.qtd, `Devolvida da OS #${o.numero}`);
          o.pecas.splice(+b.dataset.rmp, 1); Store.syncReceitaOS(o); Store.saveOS(o);
          mm.close(); this.detalhe(o.id); App.refresh();
        });
      },
    });
    return m;
  },

  addPeca(o, done) {
    const pecas = Store.db.pecas.filter(p => !p.deleted);
    if (!pecas.length) return toast('Cadastre peças em Estoque primeiro', true);
    openModal({
      title: 'Adicionar peça', icon: 'box', subtitle: `OS #${o.numero}`,
      body: `${inputIcon('search', 'id="ap-q" placeholder="Buscar peça..."')}<div id="ap-res" class="mt"></div>
        <div class="form-row mt">${field('Quantidade', '<input class="input" type="number" min="1" value="1" id="ap-qtd">')}${field('Peça avulsa (sem estoque)', '<input class="input" id="ap-avulsa" placeholder="Nome">')}</div>
        ${field('Custo da peça avulsa', '<input class="input" id="ap-custo" inputmode="decimal" placeholder="0,00">')}`,
      foot: `<button class="btn" data-close>Cancelar</button><button class="btn primary" id="ap-ok">Adicionar avulsa</button>`,
      onMount: (el, m) => {
        const res = q => {
          $('#ap-res', el).innerHTML = `<div class="card pad-0">${pecas.filter(p => matches(q, p.nome, p.codigo, p.categoria)).slice(0, 8).map(p => `<div class="item" data-id="${p.id}" style="padding:12px 16px"><div class="row between"><div><b>${esc(p.nome)}</b><div class="xs muted">Estoque: ${p.qtd} · custo ${money(p.custo)}</div></div><span class="pill ${p.qtd > 0 ? 'gold' : 'red'}">${p.qtd}</span></div></div>`).join('') || '<div class="empty small">Nada encontrado</div>'}</div>`;
          $$('#ap-res .item', el).forEach(it => it.onclick = () => {
            const p = Store.peca(it.dataset.id); const q = Math.max(1, +$('#ap-qtd', el).value || 1);
            if (p.qtd < q && !confirm(`Estoque de "${p.nome}" é ${p.qtd}. Lançar mesmo assim?`)) return;
            Store.movimentar('peca', p, -q, `Usada na OS #${o.numero}`);
            o.pecas = o.pecas || []; o.pecas.push({ pecaId: p.id, nome: p.nome, qtd: q, custo: p.custo || 0 });
            Store.syncReceitaOS(o); Store.saveOS(o); m.close(); toast('Peça adicionada'); done && done();
          });
        };
        $('#ap-q', el).oninput = e => res(e.target.value); res('');
        $('#ap-ok', el).onclick = () => {
          const nome = $('#ap-avulsa', el).value.trim(); if (!nome) return toast('Informe o nome da peça avulsa', true);
          o.pecas = o.pecas || []; o.pecas.push({ pecaId: null, nome, qtd: Math.max(1, +$('#ap-qtd', el).value || 1), custo: parseMoney($('#ap-custo', el).value) });
          Store.syncReceitaOS(o); Store.saveOS(o); m.close(); done && done();
        };
      },
    });
  },

  editar(id) {
    const o = Store.osById(id);
    closeAllModals();
    openModal({
      title: `Editar OS #${o.numero}`, icon: 'edit', wide: true,
      body: `<div class="section-title">Aparelho</div><div id="ed-ap">${ClientesPage.aparelhoFields(o.aparelho || {})}</div>
        <div class="section-title">Serviço</div><div id="ed-sv">${this.servicoFields(o)}</div>
        ${o.status === 'pago' ? `<div class="form-row">${field('Desconto', `<input class="input" id="ed-desc" inputmode="decimal" value="${moneyInput(o.desconto)}">`)}${field('Forma de pagamento', `<select class="input" id="ed-forma">${selectOpts(FORMAS_PGTO, o.pagamento?.forma)}</select>`)}</div>` : ''}`,
      foot: `<button class="btn" data-close>Cancelar</button><button class="btn primary" id="ed-ok">${icon('check')} Salvar</button>`,
      onMount: (el, m) => {
        ClientesPage.bindAparelho($('#ed-ap', el)); this.bindServico($('#ed-sv', el), o);
        if (o.status === 'pago') { const st = $('[name=status]', el); st.innerHTML = `<option value="pago">Pago</option>`; st.disabled = true; }
        $('#ed-ok', el).onclick = () => {
          if (Fotos.ocupado(el)) return toast('Aguarde as fotos terminarem de enviar', true);
          const a = readForm($('#ap-form', el)); const f = this.readServico($('#ed-sv', el));
          if (!f.defeito) return toast('Descreva o defeito', true);
          const novoStatus = f.status; delete f.status;
          Object.assign(o, f); o.aparelho = { ...o.aparelho, ...a };
          if (o.status === 'pago') { o.desconto = parseMoney($('#ed-desc', el).value); o.pagamento.forma = $('#ed-forma', el).value; Store.syncReceitaOS(o); }
          else if (novoStatus !== o.status) Store.setOSStatus(o, novoStatus);
          Store.saveOS(o); Store.log('OS editada', `#${o.numero}`); Fotos.limpar($('#ed-sv', el));
          m.close(); App.refresh(); this.detalhe(o.id); toast('OS atualizada');
        };
      },
    });
  },

  async excluir(id) {
    const o = Store.osById(id);
    if (!(await confirmDialog(`Mover a OS #${o.numero} para a lixeira?`, { danger: true, ok: 'Mover para lixeira' }))) return;
    o.deleted = true; o.deletedAt = nowISO(); Store.log('OS para lixeira', `#${o.numero}`); Store.save();
    closeAllModals(); App.refresh(); toast('OS movida para a lixeira');
  },
  restaurar(id) { const o = Store.osById(id); o.deleted = false; Store.log('OS restaurada', `#${o.numero}`); Store.save(); closeAllModals(); App.refresh(); toast('OS restaurada'); },
  async excluirDef(id) {
    const o = Store.osById(id);
    if (!(await confirmDialog(`Excluir definitivamente a OS #${o.numero}? Isso também remove o recebimento do financeiro.`, { danger: true, ok: 'Excluir' }))) return;
    Store.db.os = Store.db.os.filter(x => x.id !== id);
    Store.db.lancamentos = Store.db.lancamentos.filter(l => !(l.origem === 'os' && l.refId === id));
    Store.log('OS excluída', `#${o.numero}`); Store.save(); closeAllModals(); App.refresh();
  },
};
Pages.os = OSPage;

/* Bancada: quadro por status das OS ativas */
Pages.bancada = {
  render(main) {
    const os = Store.db.os.filter(o => !o.deleted && OS_ATIVOS.includes(o.status));
    main.innerHTML = `
      ${pageHead('phone', 'Bancada', 'Aparelhos em reparo, organizados por etapa. Toque no status para mover.')}
      <div class="page-actions"><button class="btn primary" onclick="OSPage.novaOS()">${icon('plus')} Nova OS</button>${Cloud.ehDono() ? `<button class="btn" id="bc-editar">${icon('edit')} Editar cards</button>` : ''}</div>
      <div class="kanban">
        ${OS_ATIVOS.map(st => {
          const list = os.filter(o => o.status === st).sort((a, b) => (a.previsao || '9').localeCompare(b.previsao || '9'));
          return `<div class="kcol"><h4><span class="row" style="color:${OS_STATUS[st].color}">${icon(OS_STATUS[st].icon, 'sm')} ${OS_STATUS[st].label}</span><span class="pill">${list.length}</span></h4>
            ${list.map(o => {
              const c = Store.cliente(o.clienteId);
              const late = o.previsao && dayKey(o.previsao) < dayKey() && st !== 'concluido';
              const dias = daysBetween(o.criadoEm, new Date());
              return `<div class="kcard" style="--bar:${OS_STATUS[st].color}" onclick="OSPage.detalhe('${o.id}')">
                <div class="row between"><span class="num" style="font-size:12px;font-weight:800;color:var(--gold)">#${o.numero}</span><span class="xs ${late ? 'red bold' : 'muted'}">${late ? 'Atrasada' : dias + 'd na bancada'}</span></div>
                <div class="bold ellipsis" style="margin-top:6px">${esc(c?.nome || '—')}</div>
                <div class="small gold ellipsis">${esc(o.aparelho?.modelo || '')}</div>
                <div class="xs muted ellipsis" style="margin-top:4px">${esc(o.servico || o.defeito || '')}</div>
                <div class="row between" style="margin-top:10px"><b class="small">${money(Store.osTotal(o))}</b>
                <button class="btn sm" onclick="event.stopPropagation();OSPage.statusMenu('${o.id}',this)">Mover ${icon('chevDown', 'sm')}</button></div></div>`;
            }).join('') || '<div class="xs muted center" style="padding:20px 0">Vazio</div>'}
          </div>`;
        }).join('')}
      </div>`;
    const ed = $('#bc-editar', main); if (ed) ed.onclick = () => this.editarCards();
  },

  // Adicionar, tirar, renomear e ordenar os cards da bancada (só o dono)
  editarCards() {
    const qtd = k => Store.db.os.filter(o => !o.deleted && o.status === k).length;
    const m = openModal({
      title: 'Cards da bancada', icon: 'edit',
      subtitle: 'Crie cards para as etapas da sua loja e tire os que não usa.',
      body: '<div id="bc-corpo"></div>',
      foot: `<button class="btn primary" data-close>${icon('check')} Pronto</button>`,
      onClose: () => { if (App.route === 'bancada') App.refresh(); },
    });
    let cor = Etapas.CORES[0];
    const desenhar = () => {
      const el = $('#bc-corpo', m.el); if (!el) return;
      const lista = [...OS_ATIVOS];
      const escondidas = ETAPAS_BASE.filter(k => OS_STATUS[k] && OS_STATUS[k].oculto);
      const criadas = Etapas.cfg().extras.filter(x => !x.removida).length;
      el.innerHTML = `<div class="col" style="gap:8px">${lista.map((k, i) => {
          const s = OS_STATUS[k], fixa = ETAPAS_FIXAS.includes(k), n = qtd(k);
          return `<div class="row bc-linha" style="gap:6px;padding:8px 10px;border:1px solid var(--line);border-radius:12px;background:var(--bg-2)">
            <span style="width:12px;height:12px;border-radius:50%;background:${s.color};flex:none"></span>
            ${s.extra ? `<input class="input grow" data-bc-nome="${k}" value="${esc(s.label)}" maxlength="24" style="min-height:36px;padding:6px 10px;min-width:0">` : `<b class="grow">${esc(s.label)}</b>`}
            <span class="xs muted" style="white-space:nowrap">${n} OS</span>
            <button class="icon-btn" data-bc-sobe="${i}" ${i === 0 ? 'disabled' : ''} title="Subir" style="transform:rotate(180deg)">${icon('chevDown', 'sm')}</button>
            <button class="icon-btn" data-bc-desce="${i}" ${i === lista.length - 1 ? 'disabled' : ''} title="Descer">${icon('chevDown', 'sm')}</button>
            ${fixa ? `<span class="icon-btn" title="Este card não pode sair" style="opacity:.35">${icon('lock', 'sm')}</span>` : `<button class="icon-btn" data-bc-tira="${k}" title="Tirar card">${icon('trash', 'sm')}</button>`}
          </div>`; }).join('')}</div>
        ${escondidas.length ? `<div class="row wrap mt" style="gap:6px"><span class="small muted">Cards tirados:</span>${escondidas.map(k => `<button class="btn sm" data-bc-volta="${k}">${icon('plus', 'sm')} ${esc(OS_STATUS[k].label)}</button>`).join('')}</div>` : ''}
        <div class="section-title" style="margin-top:18px">Novo card</div>
        ${criadas < Etapas.MAX ? `<div class="row" style="gap:8px"><input class="input grow" id="bc-novo" maxlength="24" placeholder="Ex: Aguardando cliente"><button class="btn primary" id="bc-add">${icon('plus')} Adicionar</button></div>
        <div class="row mt" style="gap:10px">${Etapas.CORES.map(c => `<button type="button" data-bc-cor="${c}" style="width:30px;height:30px;border-radius:50%;background:${c};border:3px solid ${c === cor ? '#fff' : 'transparent'};cursor:pointer" title="Cor"></button>`).join('')}</div>`
          : `<div class="small muted">Até ${Etapas.MAX} cards criados pela loja.</div>`}`;
      // ordem
      const mover = (i, d) => { const l = [...OS_ATIVOS]; const j = i + d; if (j < 0 || j >= l.length) return; [l[i], l[j]] = [l[j], l[i]]; Etapas.salvar(e => { e.ordem = l; }); desenhar(); };
      $$('[data-bc-sobe]', el).forEach(b => b.onclick = () => mover(+b.dataset.bcSobe, -1));
      $$('[data-bc-desce]', el).forEach(b => b.onclick = () => mover(+b.dataset.bcDesce, 1));
      // tirar / devolver
      $$('[data-bc-tira]', el).forEach(b => b.onclick = async () => {
        const k = b.dataset.bcTira, n = qtd(k);
        if (n) return toast(t('Mova as {n} OS deste card para outro antes de tirar', { n }), true);
        if (!(await confirmDialog(t('Tirar o card "{c}" da bancada?', { c: OS_STATUS[k].label }), { danger: true, ok: t('Tirar card') }))) return;
        Etapas.salvar(e => {
          if (k.startsWith('e_')) e.extras = e.extras.map(x => x.id === k ? { ...x, removida: true } : x);
          else if (!e.ocultas.includes(k)) e.ocultas = [...e.ocultas, k];
        });
        toast('Card tirado da bancada'); desenhar();
      });
      $$('[data-bc-volta]', el).forEach(b => b.onclick = () => { const k = b.dataset.bcVolta; Etapas.salvar(e => { e.ocultas = e.ocultas.filter(x => x !== k); }); toast('Card de volta na bancada'); desenhar(); });
      // renomear card criado
      $$('[data-bc-nome]', el).forEach(inp => inp.onchange = () => {
        const k = inp.dataset.bcNome, v = inp.value.trim().slice(0, 24);
        if (!v) { inp.value = OS_STATUS[k].label; return; }
        Etapas.salvar(e => { e.extras = e.extras.map(x => x.id === k ? { ...x, label: v } : x); });
        toast('Nome do card salvo');
      });
      // novo card
      $$('[data-bc-cor]', el).forEach(b => b.onclick = () => { const v = $('#bc-novo', el)?.value || ''; cor = b.dataset.bcCor; desenhar(); const n = $('#bc-novo', m.el); if (n) n.value = v; });
      const add = $('#bc-add', el), novo = $('#bc-novo', el);
      if (novo) novo.onkeydown = e => { if (e.key === 'Enter') add.click(); };
      if (add) add.onclick = () => {
        const v = novo.value.trim().slice(0, 24);
        if (!v) return toast('Escreva o nome do card', true);
        if (Object.values(OS_STATUS).some(s => !s.oculto && s.label.toLowerCase() === v.toLowerCase())) return toast('Já existe um card com esse nome', true);
        Etapas.salvar(e => { e.extras = [...e.extras, { id: 'e_' + uid(), label: v, cor }]; });
        toast('Card criado'); desenhar(); $('#bc-novo', m.el)?.focus();
      };
    };
    desenhar();
  },
};
