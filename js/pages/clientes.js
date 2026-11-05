/* Clientes e Aparelhos */
const ClientesPage = {
  st: { tab: 'ativos', q: '', page: 1 },

  render(main) {
    const ativos = Store.clientesAtivos();
    const mesK = monthKey();
    main.innerHTML = `
      ${pageHead('users', 'Clientes', 'Cadastro de clientes, aparelhos e histórico de atendimentos.')}
      <div class="page-actions">
        <button class="btn primary" onclick="ClientesPage.editar()">${icon('userPlus')} Novo Cliente</button>
        <button class="btn" onclick="ClientesPage.exportar()">${icon('download')} Exportar CSV</button>
      </div>
      <div class="grid grid-2 mb">
        <div class="stat stat-icon"><div class="ic">${icon('users')}</div><div><div class="label">Total de clientes</div><div class="value">${ativos.length}</div></div></div>
        <div class="stat stat-icon"><div class="ic">${icon('userPlus')}</div><div><div class="label">Novos no mês</div><div class="value gold">${ativos.filter(c => monthKey(c.criadoEm) === mesK).length}</div></div></div>
      </div>
      <div class="card mb" style="padding:12px">
        <div class="tabs" id="cl-tabs">${[['ativos', 'Clientes'], ['lixeira', 'Lixeira']].map(([k, l]) => `<button data-k="${k}" class="${this.st.tab === k ? 'on' : ''}">${k === 'lixeira' ? icon('trash', 'sm') : ''}${l}</button>`).join('')}</div>
        <div class="toolbar"><div class="input-icon">${icon('search')}<input class="input" id="cl-q" placeholder="Buscar nome, telefone, CPF, IMEI..." value="${esc(this.st.q)}"></div></div>
      </div>
      <div class="card pad-0" id="cl-list"></div>`;
    $$('#cl-tabs button').forEach(b => b.onclick = () => { this.st.tab = b.dataset.k; this.st.page = 1; $$('#cl-tabs button').forEach(x => x.classList.toggle('on', x === b)); this.renderList(); });
    $('#cl-q').oninput = e => { this.st.q = e.target.value; this.st.page = 1; this.renderList(); };
    this.renderList();
  },

  renderList() {
    const list = Store.db.clientes.filter(c => (this.st.tab === 'lixeira') === !!c.deleted)
      .filter(c => matches(this.st.q, c.nome, c.telefone, c.doc, c.email, ...(c.aparelhos || []).flatMap(a => [a.modelo, a.imei])))
      .sort((a, b) => a.nome.localeCompare(b.nome));
    const p = paginate(list, this.st.page, 30);
    $('#cl-list').innerHTML = `<div class="list-head"><b>${p.total} cliente(s)</b></div>
      ${p.items.map(c => {
        const os = Store.db.os.filter(o => o.clienteId === c.id && !o.deleted);
        return `<div class="item" onclick="ClientesPage.detalhe('${c.id}')"><div class="row"><div class="avatar">${esc(c.nome[0]?.toUpperCase() || '?')}</div>
          <div class="grow"><b class="ellipsis" style="display:block">${esc(c.nome)}</b><div class="small muted ellipsis">${esc(fmtPhone(c.telefone) || 'Sem telefone')}${c.origem ? ' · ' + esc(c.origem) : ''}</div></div>
          <div class="right"><span class="pill gold">${os.length} OS</span><div class="xs muted" style="margin-top:4px">${(c.aparelhos || []).length} aparelho(s)</div></div></div></div>`;
      }).join('') || `<div class="empty">${icon('users')}<div>Nenhum cliente encontrado.</div></div>`}
      ${pagerHTML(p, 'ClientesPage.goPage')}`;
  },
  goPage(n) { this.st.page = n; this.renderList(); },

  formFields(c) {
    const ddis = [['55', '🇧🇷 +55'], ['1', '🇺🇸 +1'], ['351', '🇵🇹 +351'], ['54', '🇦🇷 +54'], ['595', '🇵🇾 +595'], ['598', '🇺🇾 +598']];
    let ddi = '55', tel = c.telefone || '';
    const mt = tel.match(/^\+(\d{1,3})\s?(.*)$/);
    if (mt) { ddi = mt[1]; tel = mt[2]; }
    return `
      ${field('Nome completo', inputIcon('user', `name="nome" placeholder="Ex: João da Silva" value="${esc(c.nome || '')}"`), { req: true })}
      <div class="field"><label>Documento do cliente <span class="opt">(opcional)</span></label><div class="form-row r-1-2">
        <select class="input" name="docTipo">${selectOpts(['CPF', 'CNPJ', 'RG', 'Outro'], c.docTipo || 'CPF')}</select>
        ${inputIcon('card', `name="doc" inputmode="numeric" placeholder="000.000.000-00" value="${esc(c.doc || '')}"`)}</div></div>
      <div class="field"><label>WhatsApp / Telefone <span class="opt">(opcional)</span></label><div class="form-row r-1-2">
        <select class="input" name="ddi">${selectOpts(ddis, ddi)}</select>
        ${inputIcon('phone', `name="tel" type="tel" inputmode="tel" placeholder="(11) 99999-9999" value="${esc(fmtPhone(tel))}"`)}</div></div>
      ${field('E-mail', inputIcon('mail', `name="email" type="email" placeholder="cliente@email.com" value="${esc(c.email || '')}"`), { opt: true })}
      <div class="field"><label class="row between"><span>Como conheceu a loja <span class="opt">(opcional)</span></span><a href="#/config" class="xs" style="text-transform:none;letter-spacing:0">${icon('settings', 'sm')} Gerenciar</a></label>
        <select class="input" name="origem"><option value="">Não informado</option>${selectOpts(Store.s.origens, c.origem)}</select></div>
      ${field('Endereço', `<input class="input" name="endereco" placeholder="Rua, número, bairro" value="${esc(c.endereco || '')}">`, { opt: true })}
      ${field('Data de nascimento', `<input class="input" type="date" name="nascimento" value="${esc(c.nascimento || '')}">`, { opt: true })}`;
  },
  bindForm(root) {
    const doc = $('[name=doc]', root), tipo = $('[name=docTipo]', root), tel = $('[name=tel]', root);
    doc.oninput = () => { doc.value = maskDoc(doc.value, tipo.value); };
    tipo.onchange = () => { doc.placeholder = tipo.value === 'CNPJ' ? '00.000.000/0000-00' : tipo.value === 'CPF' ? '000.000.000-00' : ''; doc.value = maskDoc(doc.value, tipo.value); };
    tel.onblur = () => { if ($('[name=ddi]', root).value === '55') tel.value = fmtPhone(tel.value); };
    // readForm do assistente usa "telefone"
    const sync = () => { let h = $('[name=telefone]', root); if (!h) { h = document.createElement('input'); h.type = 'hidden'; h.name = 'telefone'; root.appendChild(h); } const d = onlyDigits(tel.value); const ddi = $('[name=ddi]', root).value; h.value = d ? (ddi === '55' ? d : `+${ddi} ${d}`) : ''; };
    tel.addEventListener('input', sync); $('[name=ddi]', root).addEventListener('change', sync); sync();
  },

  aparelhoFields(a) {
    return `<div id="ap-form">
      <div class="lbl mb">Tipo de aparelho</div>
      <input type="hidden" name="tipo" value="${esc(a.tipo || 'celular')}">
      <div class="chips mb" id="ap-tipos">${TIPOS_APARELHO.map(([k, l, ic]) => `<button type="button" class="chip-opt ${(a.tipo || 'celular') === k ? 'on' : ''}" data-t="${k}">${icon(ic)}${l}</button>`).join('')}</div>
      ${field('Marca / Modelo', `<input class="input" name="modelo" placeholder="Ex: iPhone 13 Pro Max" value="${esc(a.modelo || '')}" list="dl-modelos">`, { req: true })}
      <datalist id="dl-modelos">${[...new Set(Store.db.clientes.flatMap(c => (c.aparelhos || []).map(x => x.modelo)).filter(Boolean))].slice(0, 200).map(m => `<option value="${esc(m)}">`).join('')}</datalist>
      <div class="field"><label class="row between"><span id="ap-idl">${a.idTipo === 'serial' ? 'Serial' : 'IMEI'} <span class="opt">(opcional)</span></span>
        <span class="seg"><button type="button" data-id="imei" class="${a.idTipo !== 'serial' ? 'on' : ''}">IMEI</button><button type="button" data-id="serial" class="${a.idTipo === 'serial' ? 'on' : ''}">SERIAL</button></span></label>
        <input type="hidden" name="idTipo" value="${a.idTipo || 'imei'}">
        <input class="input" name="imei" style="font-family:ui-monospace,monospace" placeholder="${a.idTipo === 'serial' ? 'Número de série' : '0000 0000 0000 000'}" value="${esc(a.imei || '')}"></div>
      ${field('Cor', `<input class="input" name="cor" placeholder="Ex: Azul, Preto, Prata..." value="${esc(a.cor || '')}">`, { opt: true })}
    </div>`;
  },
  bindAparelho(root) {
    $$('#ap-tipos [data-t]', root).forEach(b => b.onclick = () => { $('[name=tipo]', root).value = b.dataset.t; $$('#ap-tipos [data-t]', root).forEach(x => x.classList.toggle('on', x === b)); });
    $$('.seg [data-id]', root).forEach(b => b.onclick = () => {
      $('[name=idTipo]', root).value = b.dataset.id;
      $$('.seg [data-id]', root).forEach(x => x.classList.toggle('on', x === b));
      $('[name=imei]', root).placeholder = b.dataset.id === 'serial' ? 'Número de série' : '0000 0000 0000 000';
      $('#ap-idl', root).firstChild.textContent = b.dataset.id === 'serial' ? 'Serial ' : 'IMEI ';
    });
  },

  editar(id) {
    const c = id ? JSON.parse(JSON.stringify(Store.cliente(id))) : { aparelhos: [] };
    const m = openModal({
      title: id ? 'Editar Cliente' : 'Novo Cliente', subtitle: 'Preencha os dados do cliente e dispositivos associados.', icon: 'userPlus',
      body: `<div class="card mb" id="cl-form"><h3 class="row"><span class="stat-icon"><span class="ic" style="width:36px;height:36px">${icon('user', 'sm')}</span></span> Dados Pessoais</h3>${this.formFields(c)}</div>
        <div class="card"><h3 class="row"><span class="stat-icon"><span class="ic" style="width:36px;height:36px">${icon('phone', 'sm')}</span></span> Aparelhos</h3>
        <div id="cl-aps"></div>
        <div class="card" style="background:var(--bg-2)"><div class="section-title">Adicionar novo</div><div id="cl-apnew">${this.aparelhoFields({})}</div>
        <button class="btn outline-gold block" id="cl-addap">${icon('plus')} Adicionar Dispositivo</button></div></div>`,
      foot: `<button class="btn primary block" id="cl-save" style="flex-basis:100%">${icon('check')} Salvar Cliente</button><button class="btn block" data-close style="flex-basis:100%">Cancelar</button>`,
      onMount: (el, mm) => {
        this.bindForm($('#cl-form', el));
        this.bindAparelho($('#cl-apnew', el));
        const renderAps = () => {
          $('#cl-aps', el).innerHTML = c.aparelhos.length ? c.aparelhos.map((a, i) => `<div class="cart-line">${icon((TIPOS_APARELHO.find(t => t[0] === a.tipo) || [])[2] || 'phone')}<div class="grow"><b>${esc(a.modelo)}</b><div class="xs muted">${esc(a.imei || '')} ${esc(a.cor || '')}</div></div><button class="icon-btn" data-rm="${i}">${icon('trash', 'sm')}</button></div>`).join('') + '<div class="mb"></div>' : '<p class="small muted">Nenhum aparelho cadastrado.</p>';
          $$('[data-rm]', el).forEach(b => b.onclick = () => { c.aparelhos.splice(+b.dataset.rm, 1); renderAps(); });
        };
        renderAps();
        $('#cl-addap', el).onclick = () => {
          const a = readForm($('#ap-form', el)); if (!a.modelo) return toast('Informe o modelo', true);
          c.aparelhos.push({ id: uid(), ...a }); $('#cl-apnew', el).innerHTML = this.aparelhoFields({}); this.bindAparelho($('#cl-apnew', el)); renderAps(); toast('Aparelho adicionado');
        };
        $('#cl-save', el).onclick = () => {
          const f = readForm($('#cl-form', el));
          if (!f.nome) return toast('Informe o nome do cliente', true);
          // aparelho preenchido e não adicionado
          const pend = readForm($('#ap-form', el)); if (pend.modelo) c.aparelhos.push({ id: uid(), ...pend });
          Object.assign(c, { nome: f.nome, docTipo: f.docTipo, doc: f.doc, telefone: f.telefone, email: f.email, origem: f.origem, endereco: f.endereco, nascimento: f.nascimento });
          Store.saveCliente(c); mm.close(); App.refresh(); toast('Cliente salvo');
        };
      },
    });
    return m;
  },

  detalhe(id) {
    const c = Store.cliente(id);
    const os = Store.db.os.filter(o => o.clienteId === id && !o.deleted).sort((a, b) => b.numero - a.numero);
    const vendas = Store.db.vendas.filter(v => v.clienteId === id && !v.cancelada);
    const gasto = os.filter(o => o.status === 'pago').reduce((s, o) => s + Store.osTotal(o), 0) + vendas.filter(v => !v.importado).reduce((s, v) => s + v.total, 0) + (Number(c.sistemaAntigo?.totalGasto) || 0);
    openModal({
      title: c.nome, subtitle: `Cliente desde ${fmtDate(c.criadoEm)}`, icon: 'user', wide: true,
      body: `
        <div class="grid grid-3 mb">
          <div class="stat"><div class="label">OS</div><div class="value">${os.length}</div></div>
          <div class="stat"><div class="label">Total gasto</div><div class="value gold" style="font-size:20px">${money(gasto)}</div></div>
          <div class="stat"><div class="label">Aparelhos</div><div class="value">${(c.aparelhos || []).length}</div></div>
        </div>
        <div class="card mb">
          <div class="kv"><span class="k">Telefone</span><span class="v">${esc(fmtPhone(c.telefone) || '—')}</span></div>
          <div class="kv"><span class="k">${esc(c.docTipo || 'Documento')}</span><span class="v">${esc(c.doc || '—')}</span></div>
          <div class="kv"><span class="k">E-mail</span><span class="v">${esc(c.email || '—')}</span></div>
          <div class="kv"><span class="k">Endereço</span><span class="v">${esc(c.endereco || '—')}</span></div>
          <div class="kv"><span class="k">Origem</span><span class="v">${esc(c.origem || '—')}</span></div>
          ${c.sistemaAntigo ? `<div class="kv"><span class="k">No sistema antigo</span><span class="v">${money(c.sistemaAntigo.totalGasto)} gastos · última visita ${fmtDate(c.sistemaAntigo.ultimaVisita)}</span></div>` : ''}
        </div>
        <div class="card mb"><h3>Aparelhos</h3>${(c.aparelhos || []).map(a => `<div class="cart-line">${icon('phone')}<div class="grow"><b>${esc(a.modelo)}</b><div class="xs muted">${esc(a.imei || '')} ${esc(a.cor || '')}</div></div><button class="btn sm outline-gold" onclick="closeAllModals();OSPage.novaOS({clienteId:'${c.id}'})">Nova OS</button></div>`).join('') || '<p class="small muted">Nenhum aparelho.</p>'}</div>
        <div class="card pad-0"><div class="list-head"><b>Histórico de OS</b></div>${os.map(o => Pages.dashboard.osMini(o)).join('') || '<div class="empty small">Nenhuma OS.</div>'}</div>`,
      foot: c.deleted
        ? `<button class="btn outline-gold" onclick="ClientesPage.restaurar('${c.id}')">${icon('undo')} Restaurar</button>`
        : `<button class="btn primary" onclick="closeAllModals();OSPage.novaOS({clienteId:'${c.id}'})">${icon('plus')} Nova OS</button>
           ${c.telefone ? `<a class="btn success" target="_blank" href="${waLink(c.telefone, t('Olá {nome}! Aqui é da {loja}.', { nome: c.nome.split(' ')[0], loja: Store.s.loja }))}">${icon('whatsapp')} WhatsApp</a>` : ''}
           <button class="btn" onclick="closeAllModals();ClientesPage.editar('${c.id}')">${icon('edit')} Editar</button>
           <button class="btn danger" onclick="ClientesPage.excluir('${c.id}')">${icon('trash')}</button>`,
    });
  },

  async excluir(id) {
    const c = Store.cliente(id);
    if (!(await confirmDialog(`Mover ${c.nome} para a lixeira? As OS do cliente são mantidas.`, { danger: true, ok: 'Mover para lixeira' }))) return;
    c.deleted = true; Store.log('Cliente para lixeira', c.nome); Store.save(); closeAllModals(); App.refresh();
  },
  restaurar(id) { const c = Store.cliente(id); c.deleted = false; Store.save(); closeAllModals(); App.refresh(); toast('Cliente restaurado'); },

  exportar() {
    const rows = [['Nome', 'Documento', 'Telefone', 'E-mail', 'Origem', 'Endereço', 'Cadastro', 'Aparelhos']];
    Store.clientesAtivos().forEach(c => rows.push([c.nome, c.doc, c.telefone, c.email, c.origem, c.endereco, fmtDate(c.criadoEm), (c.aparelhos || []).map(a => a.modelo).join(', ')]));
    download(`clientes-${dayKey()}.csv`, toCSV(rows), 'text/csv;charset=utf-8');
  },
};
Pages.clientes = ClientesPage;
