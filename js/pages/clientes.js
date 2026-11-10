/* Clientes e veículos */
const ClientesPage = {
  st: { tab: 'ativos', q: '', page: 1 },

  render(main) {
    const ativos = Store.clientesAtivos();
    const mesK = monthKey();
    const nVeic = ativos.reduce((s, c) => s + (c.veiculos || []).length, 0);
    main.innerHTML = `
      ${pageHead('users', 'Clientes', 'Clientes, veículos e histórico de cada placa.')}
      <div class="page-actions">
        <button class="btn primary" onclick="ClientesPage.editar()">${icon('userPlus')} Novo cliente</button>
        <button class="btn" onclick="ClientesPage.exportar()">${icon('download')} Exportar CSV</button>
        ${typeof ImportarCSV !== 'undefined' ? `<button class="btn" onclick="ImportarCSV.abrir()">${icon('upload')} Importar planilha</button>` : ''}
      </div>
      <div class="grid grid-3 mb">
        <div class="stat stat-icon"><div class="ic">${icon('users')}</div><div><div class="label">Clientes</div><div class="value">${ativos.length}</div></div></div>
        <div class="stat stat-icon"><div class="ic">${icon('car')}</div><div><div class="label">Veículos</div><div class="value">${nVeic}</div></div></div>
        <div class="stat stat-icon"><div class="ic">${icon('userPlus')}</div><div><div class="label">Novos no mês</div><div class="value gold">${ativos.filter(c => monthKey(c.criadoEm) === mesK).length}</div></div></div>
      </div>
      <div class="card mb" style="padding:12px">
        <div class="tabs" id="cl-tabs">${[['ativos', 'Clientes'], ['lixeira', 'Lixeira']].map(([k, l]) => `<button data-k="${k}" class="${this.st.tab === k ? 'on' : ''}">${k === 'lixeira' ? icon('trash', 'sm') : ''}${l}</button>`).join('')}</div>
        <div class="toolbar"><div class="input-icon">${icon('search')}<input class="input" id="cl-q" placeholder="Buscar nome, telefone, CPF ou placa..." value="${esc(this.st.q)}"></div></div>
      </div>
      <div class="card pad-0" id="cl-list"></div>`;
    $$('#cl-tabs button').forEach(b => b.onclick = () => { this.st.tab = b.dataset.k; this.st.page = 1; $$('#cl-tabs button').forEach(x => x.classList.toggle('on', x === b)); this.renderList(); });
    $('#cl-q').oninput = e => { this.st.q = e.target.value; this.st.page = 1; this.renderList(); };
    this.renderList();
  },

  // busca por nome, telefone, CPF (com ou sem pontos), e-mail, modelo e placa (com ou sem hífen)
  bate(c, q) {
    if (!q) return true;
    const dq = onlyDigits(q);
    return matches(q, c.nome, c.email, ...(c.veiculos || []).flatMap(v => [v.modelo, v.marca]))
      || (dq.length >= 3 && (onlyDigits(c.telefone).includes(dq) || onlyDigits(c.doc).includes(dq)))
      || (c.veiculos || []).some(v => Placa.bate(q, v.placa));
  },
  renderList() {
    const list = Store.db.clientes.filter(c => (this.st.tab === 'lixeira') === !!c.deleted)
      .filter(c => this.bate(c, this.st.q))
      .sort((a, b) => a.nome.localeCompare(b.nome));
    const p = paginate(list, this.st.page, 30);
    $('#cl-list').innerHTML = `<div class="list-head"><b>${p.total} cliente(s)</b></div>
      ${p.items.map(c => {
        const os = Store.db.os.filter(o => o.clienteId === c.id && !o.deleted);
        const vs = c.veiculos || [];
        return `<div class="item" onclick="ClientesPage.detalhe('${c.id}')"><div class="row"><div class="avatar">${esc(c.nome[0]?.toUpperCase() || '?')}</div>
          <div class="grow" style="min-width:0"><b class="ellipsis" style="display:block" data-no-i18n>${esc(c.nome)}</b><div class="small muted ellipsis">${esc(fmtPhone(c.telefone) || t('Sem telefone'))}</div>
          ${vs.length ? `<div class="row wrap" style="gap:6px;margin-top:6px">${vs.slice(0, 3).map(v => `<span class="veic-chip">${icon(Veiculo.icone(v), 'sm')}${v.placa ? `<b data-no-i18n>${esc(Placa.fmt(v.placa))}</b>` : ''}<span class="ellipsis" data-no-i18n>${esc(v.modelo || '')}</span></span>`).join('')}${vs.length > 3 ? `<span class="xs muted">+${vs.length - 3}</span>` : ''}</div>` : ''}</div>
          <div class="right"><span class="pill gold">${os.length} OS</span></div></div></div>`;
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
      <div class="field"><label>WhatsApp / Telefone <span class="opt">(opcional)</span></label><div class="form-row r-1-2">
        <select class="input" name="ddi" aria-label="País">${selectOpts(ddis, ddi)}</select>
        ${inputIcon('phone', `name="tel" type="tel" inputmode="tel" placeholder="(11) 99999-9999" value="${esc(fmtPhone(tel))}"`)}</div></div>
      <div class="field"><label>Documento do cliente <span class="opt">(opcional)</span></label><div class="form-row r-1-2">
        <select class="input" name="docTipo" aria-label="Tipo de documento">${selectOpts(['CPF', 'CNPJ', 'RG', 'Outro'], c.docTipo || 'CPF')}</select>
        ${inputIcon('card', `name="doc" inputmode="numeric" placeholder="000.000.000-00" value="${esc(c.doc || '')}"`)}</div>
        <div class="xs doc-aviso" aria-live="polite"></div></div>
      ${field('E-mail', inputIcon('mail', `name="email" type="email" placeholder="cliente@email.com" value="${esc(c.email || '')}"`), { opt: true })}
      <div class="field"><label class="row between"><span>Como conheceu a oficina <span class="opt">(opcional)</span></span><a href="#/config" class="xs" style="text-transform:none;letter-spacing:0">${icon('settings', 'sm')} Gerenciar</a></label>
        <select class="input" name="origem"><option value="">Não informado</option>${selectOpts(Store.s.origens, c.origem)}</select></div>
      ${field('Endereço', `<input class="input" name="endereco" placeholder="Rua, número, bairro" value="${esc(c.endereco || '')}">`, { opt: true })}
      ${field('Data de nascimento', `<input class="input" type="date" name="nascimento" value="${esc(c.nascimento || '')}">`, { opt: true })}
      ${field('Observações', `<textarea class="input" name="obs" placeholder="Ex: prefere contato à tarde">${esc(c.obs || '')}</textarea>`, { opt: true })}`;
  },
  bindForm(root) {
    const doc = $('[name=doc]', root), tipo = $('[name=docTipo]', root), tel = $('[name=tel]', root), aviso = $('.doc-aviso', root);
    // CPF inválido: avisa, mas deixa salvar
    const checar = () => {
      const d = onlyDigits(doc.value);
      const ruim = tipo.value === 'CPF' && d.length === 11 && !cpfValido(d) || (tipo.value === 'CPF' && d.length > 0 && d.length < 11 && document.activeElement !== doc);
      aviso.className = 'xs doc-aviso' + (ruim ? ' orange' : '');
      aviso.textContent = ruim ? t('CPF parece inválido. Confira os números (dá para salvar assim).') : '';
    };
    doc.oninput = () => { doc.value = maskDoc(doc.value, tipo.value); checar(); };
    doc.onblur = checar;
    tipo.onchange = () => { doc.placeholder = tipo.value === 'CNPJ' ? '00.000.000/0000-00' : tipo.value === 'CPF' ? '000.000.000-00' : ''; doc.value = maskDoc(doc.value, tipo.value); checar(); };
    tel.onblur = () => { if ($('[name=ddi]', root).value === '55') tel.value = fmtPhone(tel.value); };
    // readForm do assistente usa "telefone"
    const sync = () => { let h = $('[name=telefone]', root); if (!h) { h = document.createElement('input'); h.type = 'hidden'; h.name = 'telefone'; root.appendChild(h); } const d = onlyDigits(tel.value); const ddi = $('[name=ddi]', root).value; h.value = d ? (ddi === '55' ? d : `+${ddi} ${d}`) : ''; };
    tel.addEventListener('input', sync); $('[name=ddi]', root).addEventListener('change', sync); sync();
    checar();
  },
  lerForm(root) {
    const f = readForm(root);
    return { nome: f.nome, docTipo: f.docTipo, doc: f.doc, telefone: f.telefone, email: f.email, origem: f.origem, endereco: f.endereco, nascimento: f.nascimento, obs: f.obs };
  },

  veiculoLinhaHTML(v, extra = '') {
    return `<div class="cart-line veic-linha"><span class="veic-ic">${icon(Veiculo.icone(v))}</span><div class="grow" style="min-width:0">
      <div class="row wrap" style="gap:6px">${v.placa ? `<b class="placa-tag" data-no-i18n>${esc(Placa.fmt(v.placa))}</b>` : `<span class="xs muted">${t('Sem placa')}</span>`}<b class="ellipsis" data-no-i18n>${esc(Veiculo.completo(v) || v.modelo || '')}</b></div>
      <div class="xs muted ellipsis">${esc([Veiculo.rotuloTipo(v), v.cor, v.km ? fmtKm(v.km) : ''].filter(Boolean).join(' · '))}</div></div>${extra}</div>`;
  },

  editar(id, { aoSalvar } = {}) {
    const c = id ? JSON.parse(JSON.stringify(Store.cliente(id))) : { veiculos: [] };
    c.veiculos = c.veiculos || [];
    let editando = null;   // índice do veículo em edição
    const m = openModal({
      title: id ? 'Editar cliente' : 'Novo cliente', subtitle: 'Dados do cliente e veículos.', icon: 'userPlus',
      body: `<div class="card mb" id="cl-form"><h3 class="row"><span class="stat-icon"><span class="ic" style="width:36px;height:36px">${icon('user', 'sm')}</span></span> Dados pessoais</h3>${this.formFields(c)}</div>
        <div class="card"><h3 class="row"><span class="stat-icon"><span class="ic" style="width:36px;height:36px">${icon('car', 'sm')}</span></span> Veículos</h3>
        <div id="cl-veics"></div>
        <div class="card" style="background:var(--bg-2)"><div class="section-title" id="cl-vtit">Adicionar veículo</div><div id="cl-vnovo">${Veiculo.campos({})}</div>
        <button class="btn outline-gold block" id="cl-addv">${icon('plus')} Adicionar veículo</button></div></div>`,
      foot: `<button class="btn primary block" id="cl-save" style="flex-basis:100%">${icon('check')} Salvar cliente</button><button class="btn block" data-close style="flex-basis:100%">Cancelar</button>`,
      onMount: (el, mm) => {
        this.bindForm($('#cl-form', el));
        const novoForm = (v = {}) => { $('#cl-vnovo', el).innerHTML = Veiculo.campos(v); Veiculo.ligar($('#cl-vnovo', el)); $('#cl-vtit', el).textContent = t(editando === null ? 'Adicionar veículo' : 'Editar veículo'); $('#cl-addv', el).innerHTML = `${icon(editando === null ? 'plus' : 'check')} ${t(editando === null ? 'Adicionar veículo' : 'Salvar veículo')}`; };
        novoForm();
        const renderV = () => {
          $('#cl-veics', el).innerHTML = c.veiculos.length ? c.veiculos.map((v, i) => this.veiculoLinhaHTML(v,
            `<button class="icon-btn" data-ev="${i}" title="Editar veículo">${icon('edit', 'sm')}</button><button class="icon-btn" data-rv="${i}" title="Tirar veículo">${icon('trash', 'sm')}</button>`)).join('') + '<div class="mb"></div>' : `<p class="small muted">${t('Nenhum veículo cadastrado.')}</p>`;
          $$('[data-rv]', el).forEach(b => b.onclick = () => { c.veiculos.splice(+b.dataset.rv, 1); editando = null; novoForm(); renderV(); });
          $$('[data-ev]', el).forEach(b => b.onclick = () => { editando = +b.dataset.ev; novoForm(c.veiculos[editando]); $('#cl-vnovo', el).scrollIntoView({ behavior: 'smooth', block: 'center' }); });
        };
        renderV();
        // placa repetida dentro do próprio cadastro também conta
        const repetidaAqui = v => v.placa && c.veiculos.some((x, i) => i !== editando && Placa.mesma(x.placa, v.placa));
        const pegar = () => {
          const v = Veiculo.ler($('#cl-vnovo', el));
          if (!v.modelo && !v.placa) return null;
          if (!v.modelo) { toast(t('Informe o modelo do veículo'), true); return false; }
          if (repetidaAqui(v)) { toast(t('Este cliente já tem um veículo com essa placa'), true); return false; }
          return v;
        };
        $('#cl-addv', el).onclick = () => {
          const v = pegar(); if (v === null) return toast(t('Informe o modelo do veículo'), true); if (!v) return;
          if (editando === null) c.veiculos.push(v); else c.veiculos[editando] = v;
          editando = null; novoForm(); renderV(); toast(t('Veículo salvo na lista'));
        };
        $('#cl-save', el).onclick = () => {
          const f = this.lerForm($('#cl-form', el));
          if (!f.nome) return toast('Informe o nome do cliente', true);
          // veículo preenchido e não adicionado
          const pend = pegar(); if (pend === false) return; if (pend) { if (editando === null) c.veiculos.push(pend); else c.veiculos[editando] = pend; }
          Object.assign(c, f);
          const salvo = Store.saveCliente(c); mm.close(); App.refresh(); toast('Cliente salvo');
          if (aoSalvar) aoSalvar(salvo);
        };
      },
    });
    return m;
  },

  // total gasto (OS pagas + vendas) e última visita
  resumo(c) {
    const os = Store.db.os.filter(o => o.clienteId === c.id && !o.deleted);
    const vendas = Store.db.vendas.filter(v => v.clienteId === c.id && !v.cancelada && !v.deleted);
    const gasto = os.filter(o => o.status === 'pago').reduce((s, o) => s + Store.osTotal(o), 0) + vendas.reduce((s, v) => s + (Number(v.total) || 0), 0);
    const datas = [...os.map(o => o.criadoEm), ...vendas.map(v => v.data)].filter(Boolean).sort();
    return { os, vendas, gasto, ultima: datas[datas.length - 1] || null };
  },

  detalhe(id) {
    const c = Store.cliente(id); if (!c) return;
    const r = this.resumo(c);
    const zap = c.telefone ? waLink(c.telefone, t('Olá {nome}! Aqui é da {loja}.', { nome: c.nome.split(' ')[0], loja: Store.s.loja })) : '';
    const vs = c.veiculos || [];
    const semVeiculo = r.os.filter(o => !vs.some(v => o.veiculo && (o.veiculo.id === v.id || (v.placa && Placa.mesma(o.veiculo.placa, v.placa)))));
    openModal({
      title: c.nome, subtitle: `${t('Cliente desde')} ${fmtDate(c.criadoEm)}`, icon: 'user', wide: true,
      body: `
        ${c.telefone && !c.deleted ? `<div class="grid grid-2 mb">
          <a class="btn success btn-grande" target="_blank" rel="noopener" href="${zap}">${icon('whatsapp')} WhatsApp</a>
          <a class="btn btn-grande" href="tel:${esc(c.telefone.startsWith('+') ? '+' + onlyDigits(c.telefone) : onlyDigits(c.telefone))}">${icon('phone')} ${t('Ligar')}</a></div>` : ''}
        <div class="grid grid-3 mb">
          <div class="stat"><div class="label">OS</div><div class="value">${r.os.length}</div></div>
          <div class="stat"><div class="label">Total gasto</div><div class="value gold" style="font-size:20px">${money(r.gasto)}</div></div>
          <div class="stat"><div class="label">Última visita</div><div class="value" style="font-size:18px">${r.ultima ? fmtDate(r.ultima) : '—'}</div></div>
        </div>
        <div class="card mb">
          <div class="kv"><span class="k">Telefone</span><span class="v">${esc(fmtPhone(c.telefone) || '—')}</span></div>
          <div class="kv"><span class="k">${esc(t(c.docTipo || 'Documento'))}</span><span class="v">${esc(c.doc || '—')}${c.docTipo === 'CPF' && c.doc && !cpfValido(c.doc) ? ` <span class="pill orange xs">${t('CPF inválido')}</span>` : ''}</span></div>
          <div class="kv"><span class="k">E-mail</span><span class="v">${esc(c.email || '—')}</span></div>
          <div class="kv"><span class="k">Endereço</span><span class="v">${esc(c.endereco || '—')}</span></div>
          <div class="kv"><span class="k">Origem</span><span class="v">${esc(c.origem || '—')}</span></div>
          ${c.obs ? `<div class="kv"><span class="k">Observações</span><span class="v">${esc(c.obs)}</span></div>` : ''}
          ${typeof DocFotos !== 'undefined' ? DocFotos.cardHTML(c) : ''}
        </div>
        <h3 class="section-h">${icon('car', 'sm')} ${t('Veículos')}</h3>
        ${vs.map(v => {
          const hist = Veiculo.historico(v);
          return `<div class="card mb veic-card">${this.veiculoLinhaHTML(v, c.deleted ? '' : `<button class="btn sm outline-gold" onclick="closeAllModals();OSPage.novaOS({clienteId:'${c.id}', veiculoId:'${v.id}'})">${icon('plus', 'sm')} OS</button>`)}
            <details ${hist.length ? '' : 'hidden'}><summary class="small bold" style="cursor:pointer;padding:6px 0">${icon('history', 'sm')} ${t('Histórico')} (${hist.length})</summary>
            ${hist.map(o => this.histLinhaHTML(o)).join('')}</details>
            ${hist.length ? '' : `<div class="xs muted">${t('Nenhuma OS deste veículo ainda.')}</div>`}</div>`;
        }).join('') || `<p class="small muted">${t('Nenhum veículo cadastrado.')}</p>`}
        ${semVeiculo.length ? `<div class="card pad-0"><div class="list-head"><b>${t('Outras OS')}</b></div>${semVeiculo.map(o => Pages.dashboard.osMini(o)).join('')}</div>` : ''}`,
      foot: c.deleted
        ? `<button class="btn outline-gold" onclick="ClientesPage.restaurar('${c.id}')">${icon('undo')} Restaurar</button>`
        : `<button class="btn primary" onclick="closeAllModals();OSPage.novaOS({clienteId:'${c.id}'})">${icon('plus')} Nova OS</button>
           <button class="btn" onclick="closeAllModals();ClientesPage.editar('${c.id}')">${icon('edit')} Editar</button>
           <button class="btn danger" onclick="ClientesPage.excluir('${c.id}')" title="Mover para a lixeira">${icon('trash')}</button>`,
      onMount: el => { if (typeof DocFotos !== 'undefined') DocFotos.ligar(el, c); },
    });
  },
  // linha do histórico do veículo: data, km, serviços e peças trocadas
  histLinhaHTML(o) {
    const servs = (o.itensServico || []).map(i => i.nome).filter(Boolean);
    const pecas = (o.itensPeca || []).map(i => i.nome).filter(Boolean);
    const desc = servs.length ? servs.join(', ') : (o.servico || o.defeito || '');
    return `<div class="hist-os" onclick="closeAllModals();OSPage.detalhe('${o.id}')" role="button" tabindex="0">
      <div class="row between"><b>#${o.numero}</b><span class="xs muted">${fmtDate(o.criadoEm)}${o.kmEntrada ? ' · ' + fmtKm(o.kmEntrada) : ''}</span></div>
      <div class="small ellipsis" data-no-i18n>${esc(desc)}</div>
      ${pecas.length ? `<div class="xs muted ellipsis">${t('Peças')}: <span data-no-i18n>${esc(pecas.join(', '))}</span></div>` : ''}
      <div class="row between xs"><span style="color:${OS_STATUS[o.status]?.color || 'inherit'}">${esc(OS_STATUS[o.status]?.label || '')}</span><b>${money(Store.osTotal(o))}</b></div></div>`;
  },

  async excluir(id) {
    const c = Store.cliente(id);
    if (!(await confirmDialog(t('Mover {nome} para a lixeira? As OS do cliente são mantidas.', { nome: c.nome }), { danger: true, ok: 'Mover para lixeira' }))) return;
    c.deleted = true; Store.log('Cliente para lixeira', c.nome); Store.save(); closeAllModals(); App.refresh();
  },
  restaurar(id) { const c = Store.cliente(id); c.deleted = false; Store.save(); closeAllModals(); App.refresh(); toast('Cliente restaurado'); },

  exportar() {
    const rows = [['Nome', 'Telefone', 'CPF', 'E-mail', 'Origem', 'Endereço', 'Cadastro', 'Placa', 'Tipo', 'Marca', 'Modelo', 'Ano']];
    Store.clientesAtivos().forEach(c => {
      const vs = c.veiculos && c.veiculos.length ? c.veiculos : [{}];
      vs.forEach(v => rows.push([c.nome, c.telefone, c.docTipo === 'CPF' ? c.doc : '', c.email, c.origem, c.endereco, fmtDate(c.criadoEm), v.placa ? Placa.fmt(v.placa) : '', v.tipo || '', v.marca || '', v.modelo || '', v.anoModelo || v.anoFab || '']));
    });
    download(`clientes-${dayKey()}.csv`, toCSV(rows), 'text/csv;charset=utf-8');
  },
};
Pages.clientes = ClientesPage;
