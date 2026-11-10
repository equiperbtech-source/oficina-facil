/* Ordens de serviço + pátio */
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
      ${pageHead('file', 'Ordens de serviço', 'Entradas de veículos e histórico completo')}
      <div class="page-actions">
        <button class="btn" onclick="Pages.config.auditoria()">${icon('shield')} Auditoria</button>
        <button class="btn primary" onclick="OSPage.novaOS()">${icon('plus')} Nova OS</button>
      </div>
      <div class="grid grid-2 mb">
        <div class="stat"><div class="label">No pátio</div><div class="value">${ativos.length} <span class="pill gold" style="font-size:13px;vertical-align:middle">Ativos</span></div></div>
        <div class="stat"><div class="label row between">Valor estimado <button class="icon-btn mini" onclick="OSPage.st.showValor=!OSPage.st.showValor;App.refresh()">${icon(this.st.showValor ? 'eye' : 'eyeOff', 'sm')}</button></div><div class="value gold">${this.st.showValor ? money(ativos.reduce((s, o) => s + Store.osTotal(o), 0)) : 'R$ •••••'}</div></div>
        <div class="stat"><div class="label">${icon('xCircle', 'sm')} Total interrompido</div><div class="value">${os.filter(o => o.status === 'interrompido').length}</div></div>
        <div class="stat"><div class="label">${icon('clock', 'sm')} Tempo médio no pátio</div><div class="value">${finalizadas.length ? (media < 1 ? '< 1 dia' : media.toFixed(1).replace('.', ',') + ' dias') : '—'}</div></div>
      </div>
      <div class="card mb" style="padding:12px">
        <div class="tabs" id="os-tabs">
          ${(() => { const n = Pedidos.naoLidos().length; return `<button data-k="pedidos" class="${this.st.tab === 'pedidos' ? 'on' : ''}" style="${n ? 'color:var(--gold)' : ''}">${icon('chat', 'sm')}Pedidos${n ? ` <span class="pill gold xs" style="padding:1px 7px">${n} não lido${n > 1 ? 's' : ''}</span>` : ''}</button>`; })()}
          ${[['todas', 'Todas'], ['andamento', 'Em Andamento'], ['finalizadas', 'Finalizadas'], ['lixeira', 'Lixeira']].map(([k, l]) => `<button data-k="${k}" class="${this.st.tab === k ? 'on' : ''}">${k === 'lixeira' ? icon('trash', 'sm') : ''}${l}</button>`).join('')}
        </div>
        <div class="toolbar">
          <div class="input-icon">${icon('search')}<input class="input" id="os-q" placeholder="Buscar placa, cliente, OS..." value="${esc(this.st.q)}"></div>
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
    if (statusFilter === 'atrasadas') list = list.filter(o => Store.osAtrasada(o));
    else if (statusFilter) list = list.filter(o => o.status === statusFilter);
    if (q) list = list.filter(o => { const c = Store.cliente(o.clienteId); return Placa.bate(q, o.veiculo?.placa) || matches(q, '#' + o.numero, String(o.numero), c?.nome, c?.telefone, c?.doc, o.veiculo?.modelo, o.veiculo?.marca, o.defeito, o.servico); });
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
    const atrasada = Store.osAtrasada(o);
    const receber = o.status !== 'pago' && o.status !== 'interrompido' && Store.osTotal(o) > 0;
    return `<div class="item bar" style="--bar:${s.color}" onclick="OSPage.detalhe('${o.id}')">
      <div class="row between" style="align-items:flex-start">
        <div class="grow">
          <div class="meta"><span class="num">#${o.numero}</span><span>${icon('calendar', 'sm')} ${fmtDate(o.criadoEm)}</span>
            ${receber ? `<span class="pill orange">${icon('clock', 'sm')} A receber</span>` : ''}
            ${o.status === 'pago' ? `<span class="pill gold">${icon('dollar', 'sm')} Recebido</span>` : ''}
            ${atrasada ? `<span class="pill red">Atrasada</span>` : ''}</div>
          <div class="title" style="margin-top:8px" data-no-i18n>${esc(c?.nome || t('Cliente removido'))}</div>
          <div class="device">${icon(Veiculo.icone(o.veiculo), 'sm')} ${o.veiculo?.placa ? `<b class="placa-tag" data-no-i18n>${esc(Placa.fmt(o.veiculo.placa))}</b>` : ''} <span data-no-i18n>${esc(Veiculo.completo(o.veiculo) || '—')}</span></div>
        </div>
        <div class="price">${money(Store.osTotal(o))}</div>
      </div>
      ${o.defeito || o.servico ? `<div class="desc">${esc(o.servico || o.defeito)}</div>` : ''}
      <div class="row between" style="margin-top:12px">
        <span class="small muted">${o.previsao && Store.s.usarPrevisao !== false ? `${t('Previsão')} ${fmtDate(o.previsao)}` : ''}</span>
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
      return confirmDialog(t('A OS #{n} está paga. Mudar a etapa remove o recebimento do financeiro. Continuar?', { n: o.numero }), { danger: true, ok: 'Mudar etapa' })
        .then(ok => { if (ok) { Store.setOSStatus(o, k); App.refresh(); toast('Etapa atualizada'); } });
    }
    Store.setOSStatus(o, k);
    toast(`OS #${o.numero}: ${OS_STATUS[k].label}`);
    App.refresh();
    if (k === 'concluido') this.servicoConcluido(o);
  },

  /* ---------- Link de acompanhamento ---------- */
  // Só existe com a nuvem ligada (a página pública lê a OS no Supabase)
  link(o) { return Cloud.loja ? Store.linkOS(o) : null; },
  trechoLink(o) { const l = this.link(o); return l ? `\n\n🔎 ${t('Acompanhe em tempo real:')}\n${l}` : ''; },
  // variáveis das mensagens: {cliente}, {veiculo}, {placa}, {oficina}, {link}, {total}
  vars(o, c) {
    const v = o.veiculo || {};
    return { cliente: (c.nome || '').split(' ')[0], nome: (c.nome || '').split(' ')[0], veiculo: Veiculo.nome(v) || v.modelo || '', modelo: Veiculo.nome(v) || v.modelo || '',
      tipo: t(v.tipo === 'moto' ? 'moto' : 'carro'), placa: v.placa ? Placa.fmt(v.placa) : '', oficina: Store.s.loja, loja: Store.s.loja, link: this.link(o) || '', total: money(Store.osTotal(o)), n: o.numero };
  },
  msgEntrada(o, c) {
    const x = this.vars(o, c);
    return `${t('Olá {cliente}! Recebemos seu {tipo} *{veiculo}*{placaTxt} na {oficina}.', { ...x, placaTxt: x.placa ? ` ${t('placa')} *${x.placa}*` : '' })} 🔧\n\nOS: *#${o.numero}*\n${t('Reclamação')}: ${o.defeito}${Store.osTotal(o) ? `\n${t('Valor')}: ${money(Store.osTotal(o))}` : ''}${o.previsao && Store.s.usarPrevisao !== false ? `\n${t('Previsão')}: ${fmtDate(o.previsao)}` : ''}${this.trechoLink(o)}`;
  },
  // resumo curto da garantia para o WhatsApp (a oficina liga ou desliga)
  resumoGarantia(o) { return `${t('Garantia')}: *${textoGarantia(o)}*`; },
  msgPronto(o, c) {
    const x = this.vars(o, c);
    const pronto = t('Seu {tipo} *{veiculo}*{placaTxt} está *pronto para retirada*!', { ...x, placaTxt: x.placa ? ` ${t('placa')} *${x.placa}*` : '' });
    if (Store.s.whatsResumoGarantia === false) return `${t('Olá {cliente}! Aqui é da {oficina}.', x)}\n\n${pronto}\n\n${t('Aguardamos você!')}`;
    return `${t('Olá {cliente}! Aqui é da {oficina}.', x)} ✅\n\n${pronto}\n\n${t('Valor')}: *${money(Store.osTotal(o))}*\n${this.resumoGarantia(o)}${this.link(o) ? `\n\n📄 ${t('Acompanhe e baixe sua garantia em PDF:')}\n${this.link(o)}` : ''}\n\n${t('Aguardamos você!')}`;
  },
  msgStatus(o, c) {
    const x = this.vars(o, c);
    return `${t('Olá {cliente}! Aqui é da {oficina}.', x)}\n\n${t('Atualização da OS #{n} ({veiculo}):', x)}\n${t('Etapa')}: *${t(OS_STATUS[o.status].label)}*${o.previsao && Store.s.usarPrevisao !== false && !['concluido', 'pago'].includes(o.status) ? `\n${t('Previsão')}: ${fmtDate(o.previsao)}` : ''}\n${t('Valor')}: ${money(Store.osTotal(o))}${this.trechoLink(o)}`;
  },
  // ao concluir (pago): agradece por escolher a oficina
  msgObrigado(o, c) {
    const x = this.vars(o, c);
    return `${t('Olá {cliente}! Obrigado por escolher a {oficina}.', x)} 🙏\n\n${t('Seu serviço (OS #{n}) tem *garantia de {prazo}*, válida até {data}.', { n: o.numero, prazo: textoGarantia(o), data: fmtDate(Store.garantiaFim(o)) })}${this.link(o) ? `\n\n📄 ${t('Baixe sua garantia em PDF:')}\n${this.link(o)}` : ''}\n\n${t('Qualquer coisa, estamos à disposição!')}`;
  },
  async copiarLink(id) {
    const o = Store.osById(id); const l = this.link(o);
    if (!l) return toast('Ligue a nuvem (Supabase) para usar o link de acompanhamento', true);
    try { await navigator.clipboard.writeText(l); toast('Link copiado'); } catch { prompt('Copie o link:', l); }
  },
  abrirWhats(id, tipo) {
    const o = Store.osById(id), c = Store.cliente(o.clienteId);
    if (!c?.telefone) return toast('Cliente sem telefone cadastrado', true);
    const msg = tipo === 'entrada' ? this.msgEntrada(o, c) : tipo === 'pronto' ? this.msgPronto(o, c) : tipo === 'obrigado' ? this.msgObrigado(o, c) : this.msgStatus(o, c);
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

  // Ao concluir o serviço: garantia em PDF + aviso ao cliente
  servicoConcluido(o) {
    const c = Store.cliente(o.clienteId) || {};
    openModal({
      title: 'Serviço concluído!', icon: 'shieldCheck', subtitle: `OS #${o.numero} · ${c.nome || ''} · ${Veiculo.resumo(o.veiculo)}`,
      body: `<div class="card center mb" style="background:var(--gold-soft);border-color:rgba(var(--gold-rgb), .4)">
          <div class="small muted">Garantia do serviço</div><div class="gold bold" style="font-size:24px">${esc(textoGarantia(o))}</div>
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
    const comItens = OSItens.temItens(o);
    const r = JSON.parse(JSON.stringify(o));
    openModal({
      title: 'Receber pagamento', icon: 'dollar', subtitle: `OS #${o.numero} · ${Store.cliente(o.clienteId)?.nome || ''}`,
      body: `
        <div class="card center mb" style="background:var(--gold-soft);border-color:rgba(var(--gold-rgb), .4)"><div class="small muted">${t('Total a receber')}</div><div class="gold bold" style="font-size:32px" id="pg-total">${money(Store.osTotal(o))}</div>
          ${comItens ? `<div class="small" id="pg-div"></div>` : ''}</div>
        ${Store.s.exigirCaixa && !Store.caixaAberto() ? `<div class="info-box">${icon('alert')}<span>${t('O caixa está fechado.')} <a href="#/caixa">${t('Abrir caixa')}</a> ${t('antes de receber.')}</span></div>` : ''}
        ${field('Forma de pagamento', `<select class="input" name="forma">${selectOpts(FORMAS_PGTO, 'pix')}</select>`)}
        <div id="pg-parc"></div>
        <div class="form-row">
          ${comItens ? '' : field('Valor do serviço', `<input class="input" name="valor" inputmode="decimal" value="${moneyInput(o.valor)}">`)}
          ${field('Desconto', `<input class="input" name="desconto" inputmode="decimal" value="${moneyInput(o.desconto)}">`)}
        </div>
        ${field('Data do pagamento', `<input class="input" type="date" name="data" value="${dayKey()}">`)}`,
      foot: `<button class="btn" data-close>Cancelar</button><button class="btn primary" id="pg-ok">${icon('check')} Confirmar pagamento</button>`,
      onMount: (el, m) => {
        const upd = () => {
          const f = readForm(el);
          if (!comItens) r.valor = parseMoney(f.valor);
          r.desconto = parseMoney(f.desconto);
          const k = OSItens.totais(r);
          $('#pg-total', el).textContent = money(k.total);
          const dv = $('#pg-div', el); if (dv) dv.textContent = `${t('Mão de obra')} ${money(k.mo)} · ${t('Peças')} ${money(k.pe)}${k.desconto ? ` · ${t('Desconto')} -${money(k.desconto)}` : ''}`;
          Parcelas.campo($('#pg-parc', el), f.forma, k.total, 'os');
        };
        $$('input', el).forEach(i => i.oninput = upd); $('[name=forma]', el).onchange = upd; upd();
        $('#pg-ok', el).onclick = () => {
          if (Store.s.exigirCaixa && !Store.caixaAberto()) return toast('Abra o caixa primeiro', true);
          const f = readForm(el);
          if (!comItens) o.valor = parseMoney(f.valor);
          o.desconto = parseMoney(f.desconto);
          OSItens.gravarTotais(o);
          const d = f.data === dayKey() ? new Date() : new Date(f.data + 'T12:00:00');
          Store.setOSStatus(o, 'pago', { forma: f.forma, data: d.toISOString(), parcelas: f.forma === 'credito' ? parseInt(f.parcelas, 10) || 1 : 1 });
          closeAllModals(); App.refresh();
          this.garantiaModal(o);
        };
      },
    });
  },

  garantiaModal(o) {
    const s = Store.s;
    const mecs = s.tecnicos;
    let mecId = o.tecnicoId || (mecs.some(x => x.id === o.mecanicoId) ? o.mecanicoId : '') || mecs[0]?.id || '';
    const c = Store.cliente(o.clienteId);
    const m = openModal({
      title: 'Garantia do serviço', icon: 'printer',
      body: `<div class="center"><div style="width:80px;height:80px;border-radius:50%;margin:0 auto 12px;display:grid;place-items:center;background:var(--gold-soft);color:var(--gold)">${icon('shieldCheck', 'lg')}</div>
        <h2 style="margin:0 0 6px">${t('Pagamento')} <span class="gold">${t('confirmado!')}</span></h2>
        <p class="muted" style="margin:0 0 18px">${t('A OS #{n} foi marcada como paga. Como deseja emitir a garantia?', { n: o.numero })}</p></div>
        <div class="card" style="background:var(--bg-2)">
          <div class="row" style="align-items:flex-start"><div class="stat-icon"><div class="ic">${icon('pen')}</div></div>
          <div><b>${t('Responsável e assinatura')}</b><div class="small muted">${t('Identifica o mecânico que fez o serviço e preenche a assinatura nos documentos.')}</div></div></div>
          <div class="mt" id="gar-tec"></div>
        </div>
        <div class="card mt center"><div class="small muted">${t('Garantia do serviço')}</div><b class="gold" style="font-size:20px">${esc(textoGarantia(o))}</b><div class="small">${t('até')} ${fmtDate(Store.garantiaFim(o))}</div></div>`,
      foot: `<button class="btn primary block" id="gar-share" style="flex-basis:100%">${icon('upload')} ${t('Compartilhar PDF da garantia')}</button>
        <button class="btn" id="gar-pdf">${icon('download')} ${t('Baixar PDF')}</button>
        ${c?.telefone ? `<a class="btn success" target="_blank" rel="noopener" href="${waLink(c.telefone, this.msgObrigado(o, c))}">${icon('whatsapp')} WhatsApp</a>` : ''}
        <button class="btn" data-close>${t('Fechar')}</button>`,
      onMount: (el) => {
        const renderMec = () => {
          const mec = mecs.find(x => x.id === mecId);
          $('#gar-tec', el).innerHTML = mecs.length ? `
            ${field('Mecânico responsável', `<select class="input" id="gar-tsel">${selectOpts(mecs.map(x => [x.id, x.nome]), mecId)}</select>`)}
            ${mec && !mec.assinatura ? `<div class="info-box">${icon('pen')}<div><b>${esc(mec.nome)}</b> ${t('ainda não tem uma assinatura cadastrada.')} <span class="pill gold xs">${t('Opcional')}</span><div class="small muted">${t(s.assinaturaDono ? 'Sem ela, o PDF usa a assinatura do dono.' : 'Sem ela, o campo da assinatura sai em branco para assinar à mão.')}</div></div></div>
              <button class="btn primary block" id="gar-sign">${icon('pen')} ${t('Assinar agora')}</button>` : mec ? `<div class="row small gold">${icon('checkCircle', 'sm')} ${t('Assinatura cadastrada')}</div>` : ''}`
            : `<div class="small muted">${t('Nenhum mecânico cadastrado.')} <a href="#/config">${t('Cadastrar mecânicos')}</a> — ${t('a assinatura sai em branco para assinar à mão.')}</div>`;
          const sel = $('#gar-tsel', el); if (sel) sel.onchange = () => { mecId = sel.value; renderMec(); };
          const sg = $('#gar-sign', el); if (sg) sg.onclick = () => Pages.config.assinar(mecs.find(x => x.id === mecId), renderMec);
        };
        renderMec();
        const gerar = comp => { if (mecId) { o.tecnicoId = mecId; Store.saveOS(o); } this.pdfGarantia(o.id, comp); };
        $('#gar-share', el).onclick = () => gerar(true);
        $('#gar-pdf', el).onclick = () => gerar(false);
      },
    });
    return m;
  },

  /* ---------- Nova OS (assistente em 4 passos) ----------
     1. placa ou cliente · 2. veículo · 3. entrada (km, combustível, checklist, fotos, assinatura) · 4. serviços e peças */
  novaOS(pre = {}) {
    const cli0 = pre.clienteId ? Store.cliente(pre.clienteId) : null;
    const v0 = pre.veiculo || (cli0 && pre.veiculoId ? (cli0.veiculos || []).find(v => v.id === pre.veiculoId) : null);
    const w = { step: v0 && cli0 ? 3 : cli0 ? 2 : 1, clienteId: cli0?.id || null, veiculo: v0 ? { ...v0 } : null, q: pre.placa || '', fromOrc: pre.fromOrc, entrada: {} };
    const m = openModal({ title: 'Nova ordem de serviço', icon: 'file', body: '<div id="wz"></div>', foot: '<div id="wz-foot" class="row grow" style="gap:10px"></div>' });
    const el = m.el;
    const body = () => $('#wz', el), foot = () => $('#wz-foot', el);
    const steps = ['Placa ou cliente', 'Veículo', 'Entrada', 'Serviços'];
    const stepper = () => `<div class="wz-steps" aria-label="${t('Passo {n} de 4', { n: w.step })}">${steps.map((s, i) => `<div class="grow center"><div class="wz-barra ${i < w.step ? 'on' : ''}"></div><div class="xs ${i + 1 === w.step ? 'gold bold' : 'muted'}" style="margin-top:6px">${i + 1}. ${t(s)}</div></div>`).join('')}</div>`;
    const cab = (titulo, sub) => `<div class="row mb"><button class="icon-btn" id="wz-back" title="Voltar">${icon('arrowLeft')}</button><div style="min-width:0"><h3 style="margin:0">${titulo}</h3>${sub ? `<div class="small muted ellipsis" data-no-i18n>${esc(sub)}</div>` : ''}</div></div>`;
    const render = () => { [null, passoBusca, passoVeiculo, passoEntrada, passoServico][w.step](); body().scrollTop = 0; el.querySelector('.modal-body')?.scrollTo?.(0, 0); };
    const irPara = n => { w.step = n; render(); };
    // escolheu um veículo já cadastrado (pela placa): cliente e veículo prontos, vai para a entrada
    const usarCadastro = ({ cliente, veiculo }) => { w.clienteId = cliente.id; w.veiculo = { ...veiculo }; irPara(3); };

    // 1. placa ou cliente
    const passoBusca = () => {
      body().innerHTML = stepper() + `<h3 style="margin:0 0 4px">${t('Placa ou')} <span class="gold">${t('cliente')}</span></h3>
        <p class="muted small" style="margin:0 0 14px">${t('Digite a placa, o nome, o telefone ou o CPF.')}</p>
        ${inputIcon('search', `id="wz-q" autocomplete="off" autocapitalize="characters" placeholder="${t('Ex: ABC1D23 ou Maria')}" value="${esc(w.q)}"`)}
        <div id="wz-res" class="mt"></div>
        <button class="btn outline-gold block mt" id="wz-new">${icon('userPlus')} ${t('Novo cliente')}</button>`;
      foot().innerHTML = `<button class="btn grow" id="wz-cancel">${t('Cancelar')}</button>`;
      $('#wz-cancel', el).onclick = () => m.close();
      $('#wz-new', el).onclick = () => {
        const placa = Placa.valida(w.q) ? Placa.norm(w.q) : '';
        ClientesPage.editar(null, { aoSalvar: c => { w.clienteId = c.id; const v = (c.veiculos || [])[0]; if (v) { w.veiculo = { ...v }; irPara(3); } else irPara(2); } });
        if (placa) setTimeout(() => { const p = $('.modal:last-of-type [name=placa]') || $$('[name=placa]').pop(); if (p) { p.value = Placa.fmt(placa); p.dispatchEvent(new Event('input')); } }, 60);
      };
      const res = () => {
        const q = w.q.trim();
        const veics = q ? Veiculo.todos().filter(x => Placa.bate(q, x.veiculo.placa) || matches(q, x.veiculo.modelo)).slice(0, 6) : [];
        const clis = Store.clientesAtivos().filter(c => ClientesPage.bate(c, q)).slice(0, q ? 6 : 8);
        const placaNova = Placa.valida(q) && !Veiculo.porPlaca(q);
        $('#wz-res', el).innerHTML =
          (veics.length ? `<div class="lbl mb">${t('Veículos')}</div><div class="card pad-0 mb">${veics.map(x => `<div class="item" data-vei="${x.veiculo.id}" data-cli="${x.cliente.id}" style="padding:12px 16px"><div class="row"><span class="veic-ic">${icon(Veiculo.icone(x.veiculo))}</span><div class="grow" style="min-width:0">${x.veiculo.placa ? `<b class="placa-tag" data-no-i18n>${esc(Placa.fmt(x.veiculo.placa))}</b> ` : ''}<b data-no-i18n>${esc(Veiculo.completo(x.veiculo))}</b><div class="small muted ellipsis" data-no-i18n>${esc(x.cliente.nome)}</div></div>${icon('chevRight')}</div></div>`).join('')}</div>` : '')
          + (placaNova ? `<div class="info-box mb">${icon('plate')}<span>${t('Placa {p} ainda não cadastrada.', { p: `<b data-no-i18n>${esc(Placa.fmt(q))}</b>` })}</span></div>` : '')
          + (clis.length ? `<div class="lbl mb">${t('Clientes')}</div><div class="card pad-0">${clis.map(c => `<div class="item" data-id="${c.id}" style="padding:12px 16px"><div class="row"><div class="avatar">${esc(c.nome[0]?.toUpperCase())}</div><div class="grow" style="min-width:0"><b data-no-i18n>${esc(c.nome)}</b><div class="small muted ellipsis">${esc(fmtPhone(c.telefone) || t('Sem telefone'))} · ${t('{n} veículo(s)', { n: (c.veiculos || []).length })}</div></div>${icon('chevRight')}</div></div>`).join('')}</div>` : '')
          || `<div class="empty small">${q ? t('Nada encontrado.') : t('Nenhum cliente cadastrado ainda.')}</div>`;
        $$('[data-vei]', el).forEach(it => it.onclick = () => { const c = Store.cliente(it.dataset.cli); usarCadastro({ cliente: c, veiculo: c.veiculos.find(v => v.id === it.dataset.vei) }); });
        $$('#wz-res [data-id]', el).forEach(it => it.onclick = () => { w.clienteId = it.dataset.id; w.veiculo = null; irPara(2); });
      };
      $('#wz-q', el).oninput = e => { w.q = e.target.value; res(); };
      res();
      setTimeout(() => $('#wz-q', el)?.focus(), 50);
    };

    // 2. veículo do cliente (ou novo)
    const passoVeiculo = () => {
      const c = Store.cliente(w.clienteId);
      const vs = c.veiculos || [];
      const novo = w.veiculo && !vs.some(v => v.id === w.veiculo.id) ? w.veiculo : (Placa.valida(w.q) && !Veiculo.porPlaca(w.q) ? { placa: Placa.norm(w.q) } : {});
      body().innerHTML = stepper() + cab(`${t('Qual')} <span class="gold">${t('veículo')}</span>?`, c.nome)
        + (vs.length ? `<div class="lbl mb">${t('Veículos do cliente')}</div><div class="col mb">${vs.map(v => `<button class="chip-opt veic-opt ${w.veiculo && w.veiculo.id === v.id ? 'on' : ''}" data-v="${v.id}">${icon(Veiculo.icone(v))}<span class="grow">${v.placa ? `<b class="placa-tag" data-no-i18n>${esc(Placa.fmt(v.placa))}</b> ` : ''}<b style="color:var(--text)" data-no-i18n>${esc(Veiculo.completo(v))}</b><br><span class="xs">${esc([Veiculo.rotuloTipo(v), v.cor, v.km ? fmtKm(v.km) : ''].filter(Boolean).join(' · '))}</span></span></button>`).join('')}</div><div class="section-title">${t('Ou cadastrar outro')}</div>` : '')
        + `<div id="wz-vform">${Veiculo.campos(novo)}</div>`;
      Veiculo.ligar($('#wz-vform', el), { aoUsarCadastro: usarCadastro });
      $('#wz-back', el).onclick = () => { w.veiculo = null; irPara(1); };
      $$('[data-v]', el).forEach(b => b.onclick = () => { w.veiculo = { ...vs.find(v => v.id === b.dataset.v) }; irPara(3); });
      foot().innerHTML = `<button class="btn primary grow" id="wz-next">${t('Continuar')} ${icon('arrowRight')}</button>`;
      $('#wz-next', el).onclick = () => {
        const v = Veiculo.ler($('#wz-vform', el));
        if (!v.modelo) { if (w.veiculo && vs.some(x => x.id === w.veiculo.id)) return irPara(3); return toast(t('Informe o modelo do veículo'), true); }
        if (v.placa && vs.some(x => Placa.mesma(x.placa, v.placa))) return toast(t('Este cliente já tem um veículo com essa placa'), true);
        c.veiculos = [...vs, v]; Store.saveCliente(c);
        w.veiculo = { ...v }; irPara(3);
      };
    };

    // 3. entrada: km, combustível, checklist por tipo, fotos e assinatura
    const passoEntrada = () => {
      const c = Store.cliente(w.clienteId), v = w.veiculo, e = w.entrada, pr = w.fromOrc || {};
      const itens = e.checklistItens || Checklist.itens(v.tipo);
      body().innerHTML = stepper() + cab(`${t('Entrada do')} <span class="gold">${t(v.tipo === 'moto' ? 'moto' : 'carro')}</span>`, `${c.nome} · ${Veiculo.resumo(v)}`)
        + `<div class="form-row">
            ${field('Km na entrada', `<input class="input" name="kmEntrada" inputmode="numeric" placeholder="${v.km ? fmtKm(v.km, false) : 'Ex: 45.000'}" value="${e.kmEntrada ? fmtKm(e.kmEntrada, false) : ''}">${v.km ? `<div class="xs muted">${t('Último km anotado')}: ${fmtKm(v.km)}</div>` : ''}`)}
            <div class="field"><label>${t('Combustível')}</label>${Combustivel.campoHTML(e.nivelCombustivel)}</div>
          </div>
          <div class="lbl mb">${icon('checkCircle', 'sm')} ${t('Checklist de entrada')} <span class="opt muted">${t('(OK, com defeito ou não verificado)')}</span></div>
          ${Checklist.campoHTML(itens, e.checklist || pr.checklist || {})}
          <div class="mt">${Fotos.campoHTML({ fotos: e.fotos || pr.fotos, fotosImprimir: e.fotosImprimir ?? pr.fotosImprimir })}</div>
          ${field('Itens deixados no veículo', `<input class="input" name="acessorios" placeholder="${t('Ex: cadeirinha, som removível')}" value="${esc(e.acessorios || '')}">`, { opt: true })}
          <details class="mb" ${e.assinaturaCliente ? 'open' : ''}><summary class="lbl" style="cursor:pointer;padding:8px 0">${icon('pen', 'sm')} ${t('Assinatura do cliente')} <span class="opt muted">${t('(opcional)')}</span></summary>
            <canvas class="sig-pad" id="wz-sig"></canvas><button type="button" class="btn sm ghost" id="wz-sig-limpar">${t('Limpar')}</button></details>`;
      Combustivel.ligar(body()); Checklist.ligar(body()); Fotos.ligar(body(), { fotos: e.fotos || pr.fotos, fotosImprimir: e.fotosImprimir ?? pr.fotosImprimir });
      const km = $('[name=kmEntrada]', el); km.oninput = () => { const d = onlyDigits(km.value).slice(0, 7); km.value = d ? fmtKm(+d, false) : ''; };
      const sig = signaturePad($('#wz-sig', el));
      $('#wz-sig-limpar', el).onclick = () => sig.clear();
      const guardar = () => {
        const f = readForm(body());
        Object.assign(e, { kmEntrada: parseInt(onlyDigits(f.kmEntrada), 10) || null, nivelCombustivel: f.nivelCombustivel || null, checklist: Checklist.ler(body()), checklistItens: itens,
          acessorios: f.acessorios, ...Fotos.ler(body()) });
        if (!sig.isEmpty()) e.assinaturaCliente = sig.toDataURL();
      };
      $('#wz-back', el).onclick = () => { guardar(); irPara(2); };
      foot().innerHTML = `<button class="btn primary grow" id="wz-next">${t('Continuar')} ${icon('arrowRight')}</button>`;
      $('#wz-next', el).onclick = () => {
        if (Fotos.ocupado(body())) return toast('Aguarde as fotos terminarem de enviar', true);
        guardar();
        if (e.kmEntrada && v.km && e.kmEntrada < v.km && !confirm(t('O km digitado ({a}) é menor que o último anotado ({b}). Continuar?', { a: fmtKm(e.kmEntrada), b: fmtKm(v.km) }))) return;
        irPara(4);
      };
    };

    // 4. serviços e peças
    const passoServico = () => {
      const c = Store.cliente(w.clienteId), pr = w.fromOrc || {};
      // rascunho da OS: os itens (mão de obra e peças) vão sendo lançados nele
      const copia = l => JSON.parse(JSON.stringify(l || []));
      w.rasc = w.rasc || { itensServico: copia(pr.itensServico), itensPeca: copia(pr.itensPeca).map(i => ({ ...i, baixado: 0 })), desconto: Number(pr.desconto) || 0,
        defeito: pr.defeito || '', status: 'analise', previsao: Store.s.usarPrevisao === false ? '' : dayKey(addDays(new Date(), 2)), garantiaDias: pr.garantiaDias, garantiaKm: pr.garantiaKm };
      w.rasc.veiculo = w.veiculo;
      body().innerHTML = stepper() + cab(`${t('Serviços e')} <span class="gold">${t('peças')}</span>`, `${c.nome} · ${Veiculo.resumo(w.veiculo)}`)
        + this.servicoFields(w.rasc, { novo: true });
      this.bindServico(body(), w.rasc);
      $('#wz-back', el).onclick = () => { Object.assign(w.rasc, { defeito: readForm(body()).defeito }); irPara(3); };
      foot().innerHTML = `<button class="btn primary grow" id="wz-save">${icon('check')} ${t('Abrir OS')}</button>`;
      $('#wz-save', el).onclick = () => {
        const f = this.readServico(body(), w.rasc);
        if (!f.defeito) return toast(t('Escreva a reclamação do cliente'), true);
        const e = w.entrada;
        const o = Store.saveOS(Object.assign(f, e, { clienteId: w.clienteId, veiculo: { ...w.veiculo }, orcamentoId: pr.id || null }));
        OSItens.baixarEstoque(o); Store.saveOS(o);
        // o km da entrada atualiza o cadastro do veículo
        if (e.kmEntrada) { const cl = Store.cliente(w.clienteId); const vv = (cl.veiculos || []).find(x => x.id === w.veiculo.id); if (vv && (!vv.km || e.kmEntrada > vv.km)) { vv.km = e.kmEntrada; Store.saveCliente(cl); } }
        if (pr.id) { const orc = Store.db.orcamentos.find(x => x.id === pr.id); if (orc) { orc.status = 'aprovado'; orc.osId = o.id; Store.save(); } }
        m.close(); App.refresh();
        toast(t('OS #{n} aberta!', { n: o.numero }));
        this.posCriacao(o);
      };
    };
    render();
  },

  posCriacao(o) {
    const c = Store.cliente(o.clienteId);
    openModal({
      title: t('OS #{n} criada', { n: o.numero }), icon: 'checkCircle', subtitle: `${c.nome} · ${Veiculo.resumo(o.veiculo)}`,
      body: `<p class="muted" style="margin-top:0">O que deseja fazer agora?</p>
        <div class="col" id="pc-acoes">
          ${c.telefone ? `<button class="btn success" style="min-height:54px;font-size:16px" onclick="OSPage.abrirWhats('${o.id}','entrada')">${icon('whatsapp')} ${this.link(o) ? 'Enviar link pelo WhatsApp' : 'Enviar comprovante no WhatsApp'}</button>` : `<div class="info-box">${icon('info')}<span>Cliente sem telefone: cadastre o WhatsApp para enviar o link.</span></div>`}
          ${this.link(o) ? `<button class="btn outline-gold" onclick="OSPage.copiarLink('${o.id}')">${icon('repeat')} Copiar link de acompanhamento</button>` : `<div class="xs muted">Ligue a nuvem para enviar o link de acompanhamento em tempo real.</div>`}
          <div class="grid grid-2"><button class="btn" onclick="OSPage.pdfOS('${o.id}', true)">${icon('upload')} PDF da OS</button><button class="btn" onclick="OSPage.imprimirOS('${o.id}')">${icon('printer')} Imprimir OS</button></div>
          <button class="btn" onclick="Print.osEtiqueta(Store.osById('${o.id}'))">${icon('tag')} Imprimir etiqueta com a placa</button>
          ${o.assinaturaCliente ? '' : `<button class="btn" onclick="OSPage.assinaturaCliente('${o.id}')">${icon('pen')} Coletar assinatura do cliente</button>`}
        </div>`,
      foot: `<button class="btn" data-close>Concluir</button><button class="btn outline-gold" onclick="closeAllModals();OSPage.detalhe('${o.id}')">Ver OS</button>`,
    });
  },

  assinaturaCliente(id) {
    const o = Store.osById(id);
    openModal({
      title: 'Assinatura do cliente', icon: 'pen', subtitle: `OS #${o.numero}`,
      body: `<p class="small muted" style="margin-top:0">Peça ao cliente para assinar no quadro abaixo. Ela aparece no termo de entrada e na garantia.</p><canvas class="sig-pad" id="sig"></canvas>`,
      foot: `<button class="btn" id="sig-clear">Limpar</button><button class="btn primary" id="sig-ok">${icon('check')} Salvar</button>`,
      onMount: (el, m) => {
        const pad = signaturePad($('#sig', el));
        $('#sig-clear', el).onclick = () => pad.clear();
        $('#sig-ok', el).onclick = () => { if (pad.isEmpty()) return toast('Assinatura vazia', true); o.assinaturaCliente = pad.toDataURL(); Store.saveOS(o); m.close(); toast('Assinatura salva'); };
      },
    });
  },

  /* ---------- Campos de serviço (criação e edição) ----------
     o: o registro em edição (os itens de mão de obra e peças são alterados direto nele) */
  servicoFields(o, { novo = false } = {}) {
    const prev = Store.s.usarPrevisao !== false;
    return `
      ${field('Reclamação do cliente', `<textarea class="input" name="defeito" placeholder="${t('Ex: barulho ao frear, luz da injeção acesa...')}">${esc(o.defeito || '')}</textarea>`, { req: true })}
      ${OSItens.editorHTML(o, { modo: 'os' })}
      <div class="form-row">
        ${novo ? `<input type="hidden" name="status" value="${esc(o.status || 'analise')}">` : field('Etapa', `<select class="input" name="status">${selectOpts(Object.fromEntries(Etapas.opcoes(o.status).filter(([k]) => k !== 'pago').map(([k, s]) => [k, s.label])), o.status)}</select>`)}
        ${field('Mecânico responsável', `<select class="input" name="mecanicoId"><option value="">${t('— Oficina —')}</option>${selectOpts(Mecanicos.opcoes(), o.mecanicoId || o.tecnicoId)}</select>`)}
      </div>
      <div class="form-row">
        ${prev ? field('Previsão de entrega', `<input class="input" type="date" name="previsao" value="${o.previsao ? dayKey(o.previsao) : ''}">`, { opt: true }) : ''}
        ${novo ? `<label class="check" style="align-self:end;padding-bottom:16px"><input type="checkbox" name="pedirAprovacao"> ${t('Aguardar aprovação do cliente')}</label>` : ''}
      </div>
      <div class="form-row">
        ${field('Garantia (dias)', `<input class="input" type="number" name="garantiaDias" min="0" max="3650" step="1" inputmode="numeric" value="${Store.garantiaDiasOS(o)}" oninput="OSPage.prazoHint(this)"><div class="xs muted mt" id="gar-prazo">${prazoGarantia(Store.garantiaDiasOS(o))} · ${t('padrão da oficina')}: ${prazoGarantia(Store.garantiaDiasOS({}))}</div>`)}
        ${field('Garantia (km)', `<input class="input" name="garantiaKm" inputmode="numeric" placeholder="${t('Sem limite de km')}" value="${Store.garantiaKmOS(o) ? fmtKm(Store.garantiaKmOS(o), false) : ''}">`, { opt: true })}
      </div>
      ${typeof Revisao !== 'undefined' ? Revisao.campoHTML(o) : ''}
      ${novo ? '' : field('Itens deixados no veículo', `<input class="input" name="acessorios" value="${esc(o.acessorios || '')}">`, { opt: true })}
      ${field('Observações internas', `<textarea class="input" name="obs" placeholder="${t('Só a equipe vê')}">${esc(o.obs || '')}</textarea>`, { opt: true })}`;
  },
  bindServico(root, o = {}) {
    // garantia da OS acompanha o maior prazo dos serviços do catálogo lançados (dá para mudar à mão)
    const gd = $('[name=garantiaDias]', root), gk = $('[name=garantiaKm]', root);
    OSItens.ligar(root, o, { modo: 'os', onChange: r => {
      const dias = Math.max(-1, ...(r.itensServico || []).map(i => i.garantiaDias ?? -1)), km = Math.max(0, ...(r.itensServico || []).map(i => i.garantiaKm || 0));
      if (dias >= 0 && gd && !gd.dataset.mexeu) { gd.value = dias; this.prazoHint(gd); }
      if (km && gk && !gk.dataset.mexeu) gk.value = fmtKm(km, false);
    } });
    if (gd) gd.addEventListener('input', () => { gd.dataset.mexeu = 1; });
    if (gk) gk.oninput = () => { gk.dataset.mexeu = 1; const d = onlyDigits(gk.value).slice(0, 7); gk.value = d ? fmtKm(+d, false) : ''; };
    if (typeof Revisao !== 'undefined') Revisao.ligar(root, o);
  },
  // mostra o prazo por extenso enquanto digita os dias (ex.: 180 → 6 meses)
  prazoHint(el) {
    const h = el.parentElement.querySelector('#gar-prazo');
    if (h) h.textContent = `${prazoGarantia(parseInt(el.value, 10) || 0)} · ${t('padrão da oficina')}: ${prazoGarantia(Store.garantiaDiasOS({}))}`;
  },
  // campos do formulário (os itens já estão no registro em edição)
  readServico(root, o = {}) {
    const f = readForm(root);
    const gd = parseInt(f.garantiaDias, 10), gk = parseInt(onlyDigits(f.garantiaKm), 10) || 0;
    const r = { defeito: f.defeito, status: f.pedirAprovacao ? 'aprovacao' : f.status, mecanicoId: f.mecanicoId || null, obs: f.obs,
      garantiaDias: gd >= 0 && gd <= 3650 ? gd : Store.garantiaDiasOS({}), garantiaKm: gk,
      itensServico: (o.itensServico || []).filter(i => String(i.nome || '').trim()), itensPeca: (o.itensPeca || []).filter(i => String(i.nome || '').trim()), desconto: Number(o.desconto) || 0 };
    // "servico" (texto) = os serviços lançados, para listas e buscas
    r.servico = r.itensServico.map(i => i.nome).join(', ');
    if ('previsao' in f) r.previsao = f.previsao || null;
    if ('acessorios' in f) r.acessorios = f.acessorios;
    if (typeof Revisao !== 'undefined') Object.assign(r, Revisao.ler(root, o));
    return r;
  },

  /* ---------- Detalhe ---------- */
  detalhe(id) {
    const o = Store.osById(id); if (!o) return;
    const c = Store.cliente(o.clienteId) || {};
    const s = OS_STATUS[o.status];
    const mec = Mecanicos.nome(o.mecanicoId || o.tecnicoId);
    const verCusto = Cloud.papel() !== 'tecnico';
    const custo = Store.osCustoPecas(o);
    const v = o.veiculo || {};
    const m = openModal({
      title: `OS #${o.numero}`, subtitle: `${c.nome || ''} · ${Veiculo.resumo(v)}`, icon: 'file', wide: true,
      body: `
        <div class="row wrap mb">
          ${o.deleted ? '<span class="pill red">Na lixeira</span>' : `<button class="status-btn" id="d-status" style="color:${s.color};border-color:${s.color}55;background:${s.color}14">${icon(s.icon, 'sm')} ${esc(s.label)} ${icon('chevDown', 'sm')}</button>`}
          <span class="pill">${icon('calendar', 'sm')} ${t('Entrada')} ${fmtDate(o.criadoEm)}</span>
          ${o.previsao && Store.s.usarPrevisao !== false ? `<span class="pill">${icon('clock', 'sm')} ${t('Previsão')} ${fmtDate(o.previsao)}</span>` : ''}
          ${o.status === 'pago' ? `<span class="pill gold">${icon('dollar', 'sm')} ${t('Pago')} ${fmtDate(o.pagoEm)} · ${esc(nomeForma(o.pagamento?.forma))}</span>` : ''}
        </div>
        <div class="grid grid-2 stack-sm mb">
          <div class="card">
            <h3>${icon('user', 'sm')} Cliente</h3>
            <div class="kv"><span class="k">Nome</span><span class="v" data-no-i18n>${esc(c.nome || '—')}</span></div>
            <div class="kv"><span class="k">Telefone</span><span class="v">${esc(fmtPhone(c.telefone) || '—')}</span></div>
            ${c.doc ? `<div class="kv"><span class="k">${esc(t(c.docTipo || 'Documento'))}</span><span class="v">${esc(c.doc)}</span></div>` : ''}
          </div>
          <div class="card">
            <h3>${icon(Veiculo.icone(v), 'sm')} ${t('Veículo')}</h3>
            ${Veiculo.detalhesHTML(v)}
            <button class="btn sm mt" id="d-hist">${icon('history', 'sm')} ${t('Histórico desta placa')}</button>
          </div>
        </div>
        <div class="card mb">
          <h3>${icon('gauge', 'sm')} ${t('Entrada')}</h3>
          <div class="kv"><span class="k">${t('Km na entrada')}</span><span class="v">${o.kmEntrada ? fmtKm(o.kmEntrada) : '—'}</span></div>
          <div class="kv"><span class="k">${t('Combustível')}</span><span class="v">${esc(Combustivel.rotulo(o.nivelCombustivel) || '—')}</span></div>
          ${o.acessorios ? `<div class="kv"><span class="k">${t('Itens deixados')}</span><span class="v">${esc(o.acessorios)}</span></div>` : ''}
          ${Checklist.pilulasHTML(o)}
        </div>
        <div class="card mb">
          <h3>${icon('wrench', 'sm')} ${t('Serviço')}</h3>
          <div class="kv"><span class="k">${t('Reclamação')}</span><span class="v">${esc(o.defeito || '—')}</span></div>
          ${OSItens.temItens(o) ? '' : `<div class="kv"><span class="k">${t('Serviço')}</span><span class="v">${esc(o.servico || '—')}</span></div>`}
          <div class="kv"><span class="k">${t('Mecânico')}</span><span class="v">${esc(mec || t('Oficina'))}</span></div>
          <div class="kv"><span class="k">${t('Garantia')}</span><span class="v">${esc(textoGarantia(o))}${Store.garantiaFim(o) ? ` · ${t('até')} <span class="gold">${fmtDate(Store.garantiaFim(o))}</span>` : ` ${t('(conta a partir da conclusão)')}`}</span></div>
          ${o.obs ? `<div class="kv"><span class="k">${t('Obs.')}</span><span class="v">${esc(o.obs)}</span></div>` : ''}
        </div>
        ${Fotos.galeriaHTML(o)}
        <div class="card mb">
          <div class="row between wrap" style="gap:6px"><h3 style="margin:0">${icon('layers', 'sm')} ${t('Serviços e peças')}</h3>${o.deleted || o.status === 'pago' ? '' : `<span class="row" style="gap:6px"><button class="btn sm" id="d-pedir">${icon('truck', 'sm')} ${t('Cotar peça')}</button><button class="btn sm outline-gold" id="d-itens">${icon('edit', 'sm')} ${t('Itens')}</button></span>`}</div>
          <div class="mt">${OSItens.resumoHTML(o, { custo: verCusto })}</div>
        </div>
        ${this.link(o) && !o.deleted ? `<div class="card mb row between wrap"><div class="grow" style="min-width:0"><b>${icon('eye', 'sm')} ${t('Link de acompanhamento')}</b><div class="xs muted ellipsis">${esc(this.link(o))}</div></div>
          <div class="row"><button class="btn sm" onclick="OSPage.copiarLink('${o.id}')">${t('Copiar')}</button>${c.telefone ? `<button class="btn sm success" onclick="OSPage.abrirWhats('${o.id}','status')">${icon('whatsapp', 'sm')} ${t('Enviar')}</button>` : ''}</div></div>` : ''}
        ${['concluido', 'pago'].includes(o.status) ? `<div class="card mb row between wrap"><div><b>${icon('shieldCheck', 'sm')} ${t('Garantia em PDF')}</b><div class="xs muted">${esc(textoGarantia(o))} · ${t('até')} ${fmtDate(Store.garantiaFim(o))}</div></div>
          <div class="row"><button class="btn sm" onclick="OSPage.pdfGarantia('${o.id}')">${icon('download', 'sm')} ${t('Baixar')}</button><button class="btn sm primary" onclick="OSPage.pdfGarantia('${o.id}', true)">${icon('upload', 'sm')} ${t('Compartilhar')}</button></div></div>` : ''}
        <details class="card"><summary class="bold" style="cursor:pointer">${icon('history', 'sm')} ${t('Histórico da OS')}</summary><div class="timeline mt">${(o.historico || []).slice().reverse().map(h => `<div class="ev"><b>${esc(h.nome || OS_STATUS[h.status]?.label || h.status)}</b> <span class="muted">· ${fmtDateTime(h.data)}</span>${h.nota ? `<div class="xs muted">${esc(h.nota)}</div>` : ''}</div>`).join('')}</div></details>`,
      foot: o.deleted
        ? `<button class="btn outline-gold" onclick="OSPage.restaurar('${o.id}')">${icon('undo')} Restaurar</button><button class="btn danger" onclick="OSPage.excluirDef('${o.id}')">${icon('trash')} Excluir definitivamente</button>`
        : `${o.status !== 'pago' ? `<button class="btn primary" onclick="OSPage.pagamento(Store.osById('${o.id}'))">${icon('dollar')} Receber</button>` : `<button class="btn primary" onclick="OSPage.garantiaModal(Store.osById('${o.id}'))">${icon('shieldCheck')} Garantia</button>`}
          <button class="btn" onclick="OSPage.pdfOS('${o.id}', true)">${icon('file')} PDF da OS</button>
          <button class="btn" onclick="OSPage.imprimirOS('${o.id}')">${icon('printer')} Imprimir</button>
          ${c.telefone ? `<button class="btn success" onclick="OSPage.abrirWhats('${o.id}','${o.status === 'concluido' ? 'pronto' : 'status'}')">${icon('whatsapp')} WhatsApp</button>` : ''}
          <button class="btn" onclick="OSPage.editar('${o.id}')">${icon('edit')} Editar</button>
          <button class="btn" onclick="OSPage.assinaturaCliente('${o.id}')">${icon('pen')} Assinatura</button>
          <button class="btn danger" onclick="OSPage.excluir('${o.id}')" title="Mover para a lixeira">${icon('trash')}</button>`,
      onMount: (el, mm) => {
        Fotos.ligarGaleria(el);
        const ds = $('#d-status', el);
        if (ds) ds.onclick = e => { e.stopPropagation(); dropdown(ds, Etapas.opcoes(o.status).map(([k, s]) => ({ k, label: s.label, icon: s.icon, on: o.status === k })), it => { mm.close(); this.mudarStatus(o, it.k); }); };
        $('#d-hist', el).onclick = () => this.historicoPlaca(o.veiculo);
        const pd = $('#d-pedir', el); if (pd) pd.onclick = () => Cotacao.abrir('cotacao', { veiculo: o.veiculo, osNumero: o.numero });
        const it = $('#d-itens', el);
        if (it) it.onclick = () => this.editarItens(o, () => { mm.close(); this.detalhe(o.id); });
      },
    });
    return m;
  },

  // Histórico do veículo pela placa: todas as OS, datas, km, serviços e peças trocadas
  historicoPlaca(v) {
    const hist = Veiculo.historico(v);
    openModal({
      title: v?.placa ? Placa.fmt(v.placa) : t('Histórico do veículo'), subtitle: Veiculo.completo(v), icon: Veiculo.icone(v),
      body: hist.length ? `<div class="col" style="gap:8px">${hist.map(o => ClientesPage.histLinhaHTML(o)).join('')}</div>` : `<div class="empty small">${t('Nenhuma OS deste veículo.')}</div>`,
      foot: `<button class="btn" data-close>${t('Fechar')}</button>`,
    });
  },

  // Editar só os itens (mão de obra e peças) de uma OS aberta: o estoque acompanha
  editarItens(o, done) {
    const r = JSON.parse(JSON.stringify(o));
    openModal({
      title: t('Itens da OS #{n}', { n: o.numero }), icon: 'layers', wide: true,
      body: OSItens.editorHTML(r, { modo: 'os' }),
      foot: `<button class="btn" data-close>Cancelar</button><button class="btn primary" id="it-ok">${icon('check')} Salvar</button>`,
      onMount: (el, m) => {
        OSItens.ligar(el, r, { modo: 'os' });
        $('#it-ok', el).onclick = () => {
          const antes = o.itensPeca || [];
          o.itensServico = r.itensServico.filter(i => String(i.nome || '').trim());
          o.itensPeca = r.itensPeca.filter(i => String(i.nome || '').trim());
          o.desconto = r.desconto; o.servico = o.itensServico.map(i => i.nome).join(', ');
          OSItens.baixarEstoque(o, antes); Store.syncReceitaOS(o); Store.saveOS(o);
          m.close(); App.refresh(); toast('Itens salvos'); done && done();
        };
      },
    });
  },

  // Peça rápida (tela do mecânico): entra nos itens da OS e baixa do estoque na hora
  lancarPeca(o, p, qtd = 1) {
    const q = Store.quem();
    o.itensPeca = o.itensPeca || [];
    const ja = p ? o.itensPeca.find(x => x.pecaId === p.id) : null;
    if (ja) ja.qtd = (Number(ja.qtd) || 0) + qtd;
    else o.itensPeca.push({ id: uid(), pecaId: p?.id || null, nome: p?.nome || '', qtd, valor: Number(p?.preco) || 0, custo: Number(p?.custo) || 0, em: nowISO(), ...(q.id ? { por: q.id, porNome: q.nome } : {}) });
    OSItens.baixarEstoque(o); Store.syncReceitaOS(o); Store.saveOS(o);
    if (p) Pecas.usada(p.id);
  },

  editar(id) {
    const o = Store.osById(id);
    closeAllModals();
    const itens = Checklist.daOS(o);
    const r = JSON.parse(JSON.stringify(o));   // rascunho: só vale ao salvar
    openModal({
      title: t('Editar OS #{n}', { n: o.numero }), icon: 'edit', wide: true,
      body: `<div class="section-title">${t('Veículo')}</div><div id="ed-v">${Veiculo.campos(o.veiculo || {})}</div>
        <div class="section-title">${t('Entrada')}</div><div id="ed-ent">
          <div class="form-row">${field('Km na entrada', `<input class="input" name="kmEntrada" inputmode="numeric" value="${o.kmEntrada ? fmtKm(o.kmEntrada, false) : ''}">`)}
          <div class="field"><label>${t('Combustível')}</label>${Combustivel.campoHTML(o.nivelCombustivel)}</div></div>
          ${Checklist.campoHTML(itens, o.checklist || {})}
          <div class="mt">${Fotos.campoHTML(o)}</div></div>
        <div class="section-title">${t('Serviço')}</div><div id="ed-sv">${this.servicoFields(r)}</div>
        ${o.status === 'pago' ? `<div class="form-row">${field('Forma de pagamento', `<select class="input" id="ed-forma">${selectOpts(FORMAS_PGTO, o.pagamento?.forma)}</select>`)}<div></div></div>` : ''}`,
      foot: `<button class="btn" data-close>Cancelar</button><button class="btn primary" id="ed-ok">${icon('check')} Salvar</button>`,
      onMount: (el, m) => {
        Veiculo.ligar($('#ed-v', el)); Combustivel.ligar($('#ed-ent', el)); Checklist.ligar($('#ed-ent', el)); Fotos.ligar($('#ed-ent', el), o);
        this.bindServico($('#ed-sv', el), r);
        if (o.status === 'pago') { const st = $('[name=status]', el); st.innerHTML = `<option value="pago">${t('Pago')}</option>`; st.disabled = true; }
        $('#ed-ok', el).onclick = () => {
          if (Fotos.ocupado(el)) return toast('Aguarde as fotos terminarem de enviar', true);
          const v = Veiculo.ler($('#ed-v', el)); const f = this.readServico($('#ed-sv', el), r); const ent = readForm($('#ed-ent', el));
          if (!f.defeito) return toast(t('Escreva a reclamação do cliente'), true);
          if (!v.modelo) return toast(t('Informe o modelo do veículo'), true);
          const novoStatus = f.status; delete f.status;
          const antes = o.itensPeca || [];
          Object.assign(o, f, { kmEntrada: parseInt(onlyDigits(ent.kmEntrada), 10) || null, nivelCombustivel: ent.nivelCombustivel || null, checklist: Checklist.ler($('#ed-ent', el)), checklistItens: itens, ...Fotos.ler($('#ed-ent', el)) });
          o.veiculo = { ...o.veiculo, ...v, id: o.veiculo?.id || v.id };
          OSItens.baixarEstoque(o, antes); OSItens.gravarTotais(o);
          if (o.status === 'pago') { o.pagamento.forma = $('#ed-forma', el).value; Store.syncReceitaOS(o); }
          else if (novoStatus && novoStatus !== o.status) Store.setOSStatus(o, novoStatus);
          Store.saveOS(o); Store.log('OS editada', `#${o.numero}`); Fotos.limpar($('#ed-ent', el));
          m.close(); App.refresh(); this.detalhe(o.id); toast('OS atualizada');
        };
      },
    });
  },

  async excluir(id) {
    const o = Store.osById(id);
    if (!(await confirmDialog(t('Mover a OS #{n} para a lixeira?', { n: o.numero }), { danger: true, ok: 'Mover para lixeira' }))) return;
    o.deleted = true; o.deletedAt = nowISO(); Store.log('OS para lixeira', `#${o.numero}`); Store.save();
    closeAllModals(); App.refresh(); toast('OS movida para a lixeira');
  },
  restaurar(id) { const o = Store.osById(id); o.deleted = false; Store.log('OS restaurada', `#${o.numero}`); Store.save(); closeAllModals(); App.refresh(); toast('OS restaurada'); },
  async excluirDef(id) {
    const o = Store.osById(id);
    if (!(await confirmDialog(t('Excluir definitivamente a OS #{n}? Isso também remove o recebimento do financeiro.', { n: o.numero }), { danger: true, ok: 'Excluir' }))) return;
    Store.db.os = Store.db.os.filter(x => x.id !== id);
    Store.db.lancamentos = Store.db.lancamentos.filter(l => !(l.origem === 'os' && l.refId === id));
    Store.log('OS excluída', `#${o.numero}`); Store.save(); closeAllModals(); App.refresh();
  },
};
Pages.os = OSPage;

// Mecânicos para escolher na OS: os da equipe com login (papel mecânico) e os cadastrados só pelo nome
const Mecanicos = {
  lista() {
    const out = [];
    for (const f of (typeof Equipe !== 'undefined' && Equipe.local()) || []) if (f.papel === 'tecnico') out.push({ id: f.id, nome: f.nome });
    for (const x of Store.s.tecnicos || []) if (!out.some(o => o.id === x.id)) out.push({ id: x.id, nome: x.nome });
    return out;
  },
  opcoes() { return this.lista().map(m => [m.id, m.nome]); },
  nome(id) { if (!id) return ''; const m = this.lista().find(x => x.id === id); return m ? m.nome : ''; },
};

/* Pátio: quadro por etapa das OS ativas, com o card "Pago" fixo no fim.
   Barra de rolagem em cima, setas e arrastar com o dedo ou o mouse. */
Pages.patio = {
  render(main) {
    const os = Store.db.os.filter(o => !o.deleted && OS_ATIVOS.includes(o.status));
    const desde = addDays(new Date(), -7).toISOString();
    const pagas = Store.db.os.filter(o => !o.deleted && o.status === 'pago' && String(o.pagoEm || '') >= desde).sort((a, b) => String(b.pagoEm).localeCompare(String(a.pagoEm))).slice(0, 20);
    const cols = [...OS_ATIVOS, 'pago'];
    const card = (o, st) => {
      const c = Store.cliente(o.clienteId), v = o.veiculo || {};
      const late = st !== 'pago' && Store.osAtrasada(o);
      const dias = daysBetween(o.criadoEm, new Date());
      return `<div class="kcard" style="--bar:${OS_STATUS[st].color}" onclick="OSPage.detalhe('${o.id}')">
        <div class="row between"><span class="placa-tag" data-no-i18n>${esc(v.placa ? Placa.fmt(v.placa) : '#' + o.numero)}</span><span class="xs ${late ? 'red bold' : 'muted'}">${st === 'pago' ? fmtDate(o.pagoEm) : late ? t('Atrasada') : t('{n}d no pátio', { n: dias })}</span></div>
        <div class="bold ellipsis" style="margin-top:6px" data-no-i18n>${icon(Veiculo.icone(v), 'sm')} ${esc(Veiculo.nome(v) || '')}</div>
        <div class="small ellipsis muted" data-no-i18n>${esc(c?.nome || '—')} · #${o.numero}</div>
        <div class="xs muted ellipsis" style="margin-top:4px" data-no-i18n>${esc(o.servico || o.defeito || '')}</div>
        <div class="row between" style="margin-top:10px"><b class="small">${money(Store.osTotal(o))}</b>
        ${st === 'pago' ? '' : `<button class="btn sm" onclick="event.stopPropagation();OSPage.statusMenu('${o.id}',this)">${t('Mover')} ${icon('chevDown', 'sm')}</button>`}</div></div>`;
    };
    main.innerHTML = `
      ${pageHead('car', 'Pátio', 'Veículos na oficina, por etapa. Toque em Mover para mudar de etapa.')}
      <div class="page-actions"><button class="btn primary" onclick="OSPage.novaOS()">${icon('plus')} Nova OS</button>${Cloud.ehDono() ? `<button class="btn" id="bc-editar">${icon('edit')} Editar etapas</button>` : ''}</div>
      <div class="kanban-nav"><button class="icon-btn" id="kb-esq" title="Voltar etapas" aria-label="Voltar etapas">${icon('arrowLeft')}</button>
        <div class="kanban-topo" id="kb-topo" aria-hidden="true"><div id="kb-topo-in"></div></div>
        <button class="icon-btn" id="kb-dir" title="Avançar etapas" aria-label="Avançar etapas">${icon('arrowRight')}</button></div>
      <div class="kanban" id="kb">
        ${cols.map(st => {
          const list = st === 'pago' ? pagas : os.filter(o => o.status === st).sort((a, b) => (a.previsao || '9').localeCompare(b.previsao || '9'));
          return `<div class="kcol ${st === 'pago' ? 'kcol-pago' : ''}" data-col="${st}"><h4><span class="row" style="color:${OS_STATUS[st].color}">${icon(OS_STATUS[st].icon, 'sm')} ${esc(OS_STATUS[st].label)}</span><span class="pill">${list.length}</span></h4>
            ${st === 'pago' ? `<div class="xs muted" style="margin:-4px 0 8px">${t('Pagas nos últimos 7 dias')}</div>` : ''}
            ${list.map(o => card(o, st)).join('') || `<div class="xs muted center" style="padding:20px 0">${t('Vazio')}</div>`}
          </div>`;
        }).join('')}
      </div>`;
    const ed = $('#bc-editar', main); if (ed) ed.onclick = () => this.editarCards();
    this.ligarRolagem(main);
  },
  // barra de rolagem em cima (espelho), setas e arrastar com o mouse (no dedo, a rolagem é a do navegador)
  ligarRolagem(main) {
    const kb = $('#kb', main), topo = $('#kb-topo', main), inn = $('#kb-topo-in', main);
    const medir = () => { inn.style.width = kb.scrollWidth + 'px'; const sobra = kb.scrollWidth > kb.clientWidth + 2; topo.style.visibility = sobra ? '' : 'hidden'; $$('#kb-esq, #kb-dir', main).forEach(b => { b.disabled = !sobra; }); };
    medir(); new ResizeObserver(medir).observe(kb);
    let sync = false;
    topo.onscroll = () => { if (sync) { sync = false; return; } sync = true; kb.scrollLeft = topo.scrollLeft; };
    kb.onscroll = () => { if (sync) { sync = false; return; } sync = true; topo.scrollLeft = kb.scrollLeft; };
    const passo = () => Math.max(260, kb.clientWidth * 0.8);
    $('#kb-esq', main).onclick = () => kb.scrollBy({ left: -passo(), behavior: 'smooth' });
    $('#kb-dir', main).onclick = () => kb.scrollBy({ left: passo(), behavior: 'smooth' });
    // arrastar com o mouse: um só par de ouvintes na janela (o quadro é redesenhado a cada mudança)
    this._arr = null;
    kb.addEventListener('pointerdown', e => { if (e.pointerType !== 'mouse' || e.button !== 0 || e.target.closest('button, a, input, select')) return; this._arr = { kb, x: e.clientX, s: kb.scrollLeft, moveu: false }; });
    if (!this._ouvindo) {
      this._ouvindo = true;
      window.addEventListener('pointermove', e => { const a = this._arr; if (!a) return; const dx = e.clientX - a.x; if (Math.abs(dx) > 4) { a.moveu = true; a.kb.classList.add('arrastando'); } a.kb.scrollLeft = a.s - dx; });
      window.addEventListener('pointerup', () => {
        const a = this._arr; if (!a) return; this._arr = null; a.kb.classList.remove('arrastando');
        if (a.moveu) { const bloq = ev => { ev.stopPropagation(); ev.preventDefault(); }; a.kb.addEventListener('click', bloq, { capture: true, once: true }); setTimeout(() => a.kb.removeEventListener('click', bloq, { capture: true }), 50); }
      });
    }
  },
  // Adicionar, tirar, renomear e ordenar as etapas do pátio (só o dono)
  editarCards() {
    const qtd = k => Store.db.os.filter(o => !o.deleted && o.status === k).length;
    const m = openModal({
      title: 'Etapas do pátio', icon: 'edit',
      subtitle: 'Crie, renomeie e tire etapas. O card Pago fica sempre no fim.',
      body: '<div id="bc-corpo"></div>',
      foot: `<button class="btn primary" data-close>${icon('check')} Pronto</button>`,
      onClose: () => { if (App.route === 'patio' || App.route === 'bancada') App.refresh(); },
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
            <input class="input grow" data-bc-nome="${k}" value="${esc(s.label)}" maxlength="28" aria-label="${t('Nome da etapa')}" style="min-height:44px;padding:6px 10px;min-width:0">
            <span class="xs muted" style="white-space:nowrap">${n} OS</span>
            <button class="icon-btn" data-bc-sobe="${i}" ${i === 0 ? 'disabled' : ''} title="Subir" style="transform:rotate(180deg)">${icon('chevDown', 'sm')}</button>
            <button class="icon-btn" data-bc-desce="${i}" ${i === lista.length - 1 ? 'disabled' : ''} title="Descer">${icon('chevDown', 'sm')}</button>
            ${fixa ? `<span class="icon-btn" title="Esta etapa não pode sair" style="opacity:.35">${icon('lock', 'sm')}</span>` : `<button class="icon-btn" data-bc-tira="${k}" title="Tirar etapa">${icon('trash', 'sm')}</button>`}
          </div>`; }).join('')}</div>
        <div class="row bc-linha" style="gap:6px;padding:8px 10px;border:1px dashed var(--line-2);border-radius:12px;margin-top:8px"><span style="width:12px;height:12px;border-radius:50%;background:${OS_STATUS.pago.color};flex:none"></span><b class="grow">${esc(OS_STATUS.pago.label)}</b><span class="xs muted">${t('fixo no fim')}</span><span class="icon-btn" style="opacity:.35">${icon('lock', 'sm')}</span></div>
        ${escondidas.length ? `<div class="row wrap mt" style="gap:6px"><span class="small muted">Etapas tiradas:</span>${escondidas.map(k => `<button class="btn sm" data-bc-volta="${k}">${icon('plus', 'sm')} ${esc(OS_STATUS[k].label)}</button>`).join('')}</div>` : ''}
        <div class="section-title" style="margin-top:18px">Nova etapa</div>
        ${criadas < Etapas.MAX ? `<div class="row" style="gap:8px"><input class="input grow" id="bc-novo" maxlength="24" placeholder="Ex: Aguardando cliente"><button class="btn primary" id="bc-add">${icon('plus')} Adicionar</button></div>
        <div class="row mt" style="gap:10px">${Etapas.CORES.map(c => `<button type="button" data-bc-cor="${c}" style="width:44px;height:44px;border-radius:50%;background:${c};border:3px solid #fff;box-shadow:0 0 0 2px ${c === cor ? 'var(--text)' : 'var(--line-2)'};cursor:pointer" title="Cor"></button>`).join('')}</div>`
          : `<div class="small muted">${t('Até {n} etapas criadas pela oficina.', { n: Etapas.MAX })}</div>`}`;
      // ordem
      const mover = (i, d) => { const l = [...OS_ATIVOS]; const j = i + d; if (j < 0 || j >= l.length) return; [l[i], l[j]] = [l[j], l[i]]; Etapas.salvar(e => { e.ordem = l; }); desenhar(); };
      $$('[data-bc-sobe]', el).forEach(b => b.onclick = () => mover(+b.dataset.bcSobe, -1));
      $$('[data-bc-desce]', el).forEach(b => b.onclick = () => mover(+b.dataset.bcDesce, 1));
      // tirar / devolver
      $$('[data-bc-tira]', el).forEach(b => b.onclick = async () => {
        const k = b.dataset.bcTira, n = qtd(k);
        if (n) return toast(t('Mova as {n} OS desta etapa para outra antes de tirar', { n }), true);
        if (!(await confirmDialog(t('Tirar a etapa "{c}" do pátio?', { c: OS_STATUS[k].label }), { danger: true, ok: t('Tirar etapa') }))) return;
        Etapas.salvar(e => {
          if (k.startsWith('e_')) e.extras = e.extras.map(x => x.id === k ? { ...x, removida: true } : x);
          else if (!e.ocultas.includes(k)) e.ocultas = [...e.ocultas, k];
        });
        toast('Etapa tirada do pátio'); desenhar();
      });
      $$('[data-bc-volta]', el).forEach(b => b.onclick = () => { const k = b.dataset.bcVolta; Etapas.salvar(e => { e.ocultas = e.ocultas.filter(x => x !== k); }); toast('Etapa de volta no pátio'); desenhar(); });
      // renomear (as criadas e as padrão; vazio volta ao nome padrão)
      $$('[data-bc-nome]', el).forEach(inp => inp.onchange = () => {
        const k = inp.dataset.bcNome, v = inp.value.trim().slice(0, 28);
        if (k.startsWith('e_')) {
          if (!v) { inp.value = OS_STATUS[k].label; return; }
          Etapas.salvar(e => { e.extras = e.extras.map(x => x.id === k ? { ...x, label: v } : x); });
        } else Etapas.salvar(e => { const n = { ...e.nomes }; if (v && v !== OS_STATUS[k].padrao) n[k] = v; else delete n[k]; e.nomes = n; });
        inp.value = OS_STATUS[k].label;
        toast('Nome da etapa salvo');
      });
      // novo card
      $$('[data-bc-cor]', el).forEach(b => b.onclick = () => { const v = $('#bc-novo', el)?.value || ''; cor = b.dataset.bcCor; desenhar(); const n = $('#bc-novo', m.el); if (n) n.value = v; });
      const add = $('#bc-add', el), novo = $('#bc-novo', el);
      if (novo) novo.onkeydown = e => { if (e.key === 'Enter') add.click(); };
      if (add) add.onclick = () => {
        const v = novo.value.trim().slice(0, 24);
        if (!v) return toast('Escreva o nome da etapa', true);
        if (Object.values(OS_STATUS).some(s => !s.oculto && s.label.toLowerCase() === v.toLowerCase())) return toast('Já existe uma etapa com esse nome', true);
        Etapas.salvar(e => { e.extras = [...e.extras, { id: 'e_' + uid(), label: v, cor }]; });
        toast('Etapa criada'); desenhar(); $('#bc-novo', m.el)?.focus();
      };
    };
    desenhar();
  },
};
Pages.bancada = Pages.patio;   // endereço antigo (#/bancada) continua abrindo o pátio
