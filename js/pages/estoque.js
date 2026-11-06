/* Estoque de peças (e editor compartilhado com produtos) */
const EstoquePage = {
  st: { tab: 'pecas', q: '', baixo: false },

  render(main) {
    const pecas = Store.db.pecas.filter(p => !p.deleted);
    const baixo = pecas.filter(p => p.qtd <= (p.minimo || 0));
    const custo = pecas.reduce((s, p) => s + (p.custo || 0) * Math.max(0, p.qtd), 0);
    main.innerHTML = `
      ${pageHead('box', 'Gestão de Estoque', 'Gerencie peças de reparo e insumos técnicos.')}
      <div class="grid grid-2 mb">
        <button class="btn" onclick="EstoquePage.fornecedores()">${icon('truck')} Fornecedores</button>
        <button class="btn" onclick="EstoquePage.lote('peca')">${icon('layers')} Entrada em lote</button>
        <button class="btn outline-gold" onclick="NFe.abrir()">${icon('upload')} Importar XML (NF-e)</button>
        <button class="btn" onclick="NFe.historico()">${icon('file')} Notas importadas</button>
        <button class="btn" onclick="EstoquePage.exportar()">${icon('report')} Relatório</button>
        <button class="btn" onclick="Print.etiquetas(Store.db.pecas.filter(p=>!p.deleted))">${icon('printer')} Etiquetas</button>
      </div>
      <button class="btn primary block mb" onclick="EstoquePage.editar('peca')">${icon('plus')} Nova Peça</button>
      <div class="tabs mb" id="est-tabs" style="display:inline-flex">${[['pecas', 'Peças', 'box'], ['hist', 'Histórico', 'history']].map(([k, l, ic]) => `<button data-k="${k}" class="${this.st.tab === k ? 'on' : ''}">${icon(ic, 'sm')} ${l}</button>`).join('')}</div>
      <div class="grid grid-3 mb">
        <div class="stat stat-icon"><div class="ic">${icon('layers')}</div><div><div class="label">Total de peças</div><div class="value">${pecas.length} <span class="small muted">itens</span></div></div></div>
        <div class="stat stat-icon" style="cursor:pointer" onclick="EstoquePage.st.baixo=!EstoquePage.st.baixo;EstoquePage.list()"><div class="ic" style="color:var(--orange);background:rgba(217,119,6,.12)">${icon('alert')}</div><div><div class="label">Baixo estoque</div><div class="value">${baixo.length} <span class="small muted">itens</span></div></div></div>
        <div class="stat stat-icon" style="grid-column:1/-1;background:linear-gradient(135deg,var(--card),var(--bg-2));border-color:rgba(var(--gold-rgb), .35)"><div class="ic">${icon('dollar')}</div><div><div class="label">Custo do inventário</div><div class="value gold">${money(custo)}</div></div></div>
      </div>
      <div id="est-body"></div>`;
    $$('#est-tabs button').forEach(b => b.onclick = () => { this.st.tab = b.dataset.k; $$('#est-tabs button').forEach(x => x.classList.toggle('on', x === b)); this.body(); });
    this.body();
  },

  body() {
    const box = $('#est-body');
    if (this.st.tab === 'hist') {
      const mov = Store.db.movEstoque.filter(m => m.tipoItem === 'peca').slice(0, 300);
      box.innerHTML = `<div class="card pad-0"><div class="table-wrap"><table class="tbl"><tr><th>Data</th><th>Peça</th><th>Qtd</th><th>Saldo</th><th>Motivo</th></tr>
        ${mov.map(m => `<tr><td class="small">${fmtDateTime(m.data)}</td><td>${esc(m.nome)}</td><td class="${m.qtd > 0 ? 'green' : 'red'} bold">${m.qtd > 0 ? '+' : ''}${m.qtd}</td><td>${m.saldo}</td><td class="small muted">${esc(m.motivo)}</td></tr>`).join('') || '<tr><td colspan="5" class="center muted">Sem movimentações</td></tr>'}</table></div></div>`;
      return;
    }
    box.innerHTML = `<div class="card mb" style="padding:12px"><div class="row"><div class="input-icon grow">${icon('search')}<input class="input" id="est-q" placeholder="Buscar peça, código, categoria..." value="${esc(this.st.q)}"></div>
      <button class="btn ${this.st.baixo ? 'outline-gold' : ''}" onclick="EstoquePage.st.baixo=!EstoquePage.st.baixo;EstoquePage.body()">${icon('alert')}</button></div></div>
      <div class="card pad-0" id="est-list"></div>`;
    $('#est-q').oninput = e => { this.st.q = e.target.value; this.list(); };
    this.list();
  },

  list() {
    const el = $('#est-list'); if (!el) return;
    const list = Store.db.pecas.filter(p => !p.deleted && (!this.st.baixo || p.qtd <= (p.minimo || 0)) && matches(this.st.q, p.nome, p.codigo, p.categoria, p.compat))
      .sort((a, b) => a.nome.localeCompare(b.nome));
    el.innerHTML = `<div class="list-head"><b>${list.length} peça(s)${this.st.baixo ? ' · <span class="gold">estoque baixo</span>' : ''}</b></div>` + (list.map(p => this.itemHTML(p, 'peca')).join('') || `<div class="empty">${icon('box')}<div>Nenhuma peça.</div></div>`);
  },

  itemHTML(p, tipo) {
    const low = p.qtd <= (p.minimo || 0);
    const forn = Store.db.fornecedores.find(f => f.id === p.fornecedorId);
    return `<div class="item" onclick="EstoquePage.editar('${tipo}','${p.id}')"><div class="row">
      <div class="grow"><b>${esc(p.nome)}</b><div class="small muted ellipsis">${[p.codigo, p.categoria, p.compat, forn?.nome].filter(Boolean).map(esc).join(' · ') || '—'}</div>
        <div class="small" style="margin-top:4px">Custo ${money(p.custo)}${p.preco ? ` · <span class="gold">Venda ${money(p.preco)}</span>` : ''}</div></div>
      <div class="qty" onclick="event.stopPropagation()"><button onclick="EstoquePage.ajuste('${tipo}','${p.id}',-1)">−</button><span class="${low ? 'red' : ''}">${p.qtd}</span><button onclick="EstoquePage.ajuste('${tipo}','${p.id}',1)">+</button></div>
    </div></div>`;
  },

  col(tipo) { return tipo === 'peca' ? Store.db.pecas : Store.db.produtos; },

  ajuste(tipo, id, d) {
    const p = this.col(tipo).find(x => x.id === id);
    Store.movimentar(tipo, p, d, d > 0 ? 'Ajuste manual (+)' : 'Ajuste manual (−)');
    Store.save();
    if (tipo === 'peca') this.list(); else App.refresh();
    App.updateNav();
  },

  // pre: valores iniciais de um produto novo (ex.: { tipoProduto: 'seminovo' })
  editar(tipo, id, pre = {}) {
    const col = this.col(tipo);
    const p = id ? { ...col.find(x => x.id === id) } : { qtd: 0, minimo: 1, ...pre, ...(pre.tipoProduto === 'seminovo' ? { seminovo: true, minimo: 0, categoria: 'Celulares seminovos' } : pre.tipoProduto === 'novo' ? { minimo: 0, categoria: 'Celulares novos' } : {}) };
    const forns = Store.db.fornecedores.filter(f => !f.deleted);
    const cats = [...new Set(col.map(x => x.categoria).filter(Boolean))];
    const lbl = tipo === 'peca' ? 'Peça' : 'Produto';
    openModal({
      title: id ? `Editar ${lbl}` : `Nova ${tipo === 'peca' ? 'Peça' : 'Produto'}`, icon: tipo === 'peca' ? 'box' : 'bag',
      body: `
        ${field('Nome', `<input class="input" name="nome" placeholder="${tipo === 'peca' ? 'Ex: Tela iPhone 11 Incell' : 'Ex: Película 3D iPhone 13'}" value="${esc(p.nome || '')}">`, { req: true })}
        <div class="form-row">
          ${field('Código / SKU', `<input class="input" name="codigo" value="${esc(p.codigo || '')}">`, { opt: true })}
          ${field('Categoria', `<input class="input" name="categoria" list="dl-cat" value="${esc(p.categoria || '')}" placeholder="${tipo === 'peca' ? 'Tela, Bateria...' : 'Capinha, Cabo...'}"><datalist id="dl-cat">${cats.map(c => `<option value="${esc(c)}">`).join('')}</datalist>`, { opt: true })}
        </div>
        ${tipo === 'peca' ? field('Modelos compatíveis', `<input class="input" name="compat" placeholder="Ex: iPhone 11, XR" value="${esc(p.compat || '')}">`, { opt: true }) : ''}
        <div class="form-row">
          ${field('Custo (R$)', `<input class="input" name="custo" inputmode="decimal" value="${p.custo ? moneyInput(p.custo) : ''}" placeholder="0,00">`)}
          ${field('Preço de venda (R$)', `<input class="input" name="preco" inputmode="decimal" value="${p.preco ? moneyInput(p.preco) : ''}" placeholder="0,00">`, { opt: tipo === 'peca' })}
        </div>
        <div class="small gold mb" id="ed-margem"></div>
        <div class="form-row">
          ${field(id ? 'Quantidade atual' : 'Quantidade inicial', `<input class="input" type="number" name="qtd" value="${p.qtd ?? 0}">`)}
          ${field('Estoque mínimo', `<input class="input" type="number" name="minimo" value="${p.minimo ?? 1}">`)}
        </div>
        ${tipo === 'produto' ? `
          <div class="lbl mb">Tipo de produto</div>
          <input type="hidden" name="tipoProduto" value="${tipoProduto(p)}">
          <div class="grid grid-3 mb" id="ed-tipo">${[['seminovo', 'Celular seminovo', 'phone', 'Garantia 6 meses'], ['novo', 'Celular novo', 'phone', 'Lacrado / novo'], ['acessorio', 'Acessório', 'tag', 'Capa, cabo, película...']]
            .map(([k, l, ic, d]) => `<button type="button" class="chip-opt ${tipoProduto(p) === k ? 'on' : ''}" data-tp="${k}">${icon(ic)}<span>${l}</span><span class="xs muted" style="font-weight:500">${d}</span></button>`).join('')}</div>
          <div id="ed-semi" class="${ehCelular(p) ? '' : 'hidden'}">
            <div class="form-row">${field('IMEI / Serial', `<input class="input" name="imei" value="${esc(p.imei || '')}" style="font-family:ui-monospace,monospace">`, { opt: true })}${field('Cor', `<input class="input" name="cor" value="${esc(p.cor || '')}">`, { opt: true })}</div>
            <div class="form-row">${field('Armazenamento', `<input class="input" name="armazenamento" placeholder="Ex: 128 GB" value="${esc(p.armazenamento || '')}">`, { opt: true })}${field('Saúde da bateria', `<input class="input" name="bateria" placeholder="Ex: 89%" value="${esc(p.bateria || '')}">`, { opt: true })}</div>
            <div class="form-row">${field('Condição', `<select class="input" name="condicao"><option value="">—</option>${selectOpts(CONDICOES, p.condicao)}</select>`, { opt: true })}${field('Status', `<select class="input" name="statusAparelho">${selectOpts(Object.fromEntries(Object.entries(STATUS_AP).map(([k, [l]]) => [k, l])), p.statusAparelho || 'disponivel')}</select>`)}</div>
          </div>
          <div id="ed-gar" class="${p.seminovo ? 'hidden' : ''}">${field('Garantia (dias)', `<input class="input" type="number" name="garantiaDias" value="${p.garantiaDias ?? (tipoProduto(p) === 'novo' ? 365 : 90)}">`)}</div>` : ''}
        ${field('Fornecedor', `<select class="input" name="fornecedorId"><option value="">—</option>${selectOpts(forns.map(f => [f.id, f.nome]), p.fornecedorId)}</select>`, { opt: true })}
        ${id ? EstoquePage.lotesHTML(tipo, id) : ''}`,
      foot: `${id ? `<button class="btn danger" id="ed-del">${icon('trash')}</button>` : ''}<button class="btn" data-close>Cancelar</button><button class="btn primary" id="ed-ok">${icon('check')} Salvar</button>`,
      onMount: (el, m) => {
        const mg = () => { const f = readForm(el); const c = parseMoney(f.custo), v = parseMoney(f.preco); $('#ed-margem', el).textContent = c && v ? `Lucro por unidade: ${money(v - c)} (${Math.round((v - c) / v * 100)}%)` : ''; };
        $('[name=custo]', el).oninput = mg; $('[name=preco]', el).oninput = mg; mg();
        $$('[data-tp]', el).forEach(b => b.onclick = () => {
          const t = b.dataset.tp; $('[name=tipoProduto]', el).value = t;
          $$('[data-tp]', el).forEach(x => x.classList.toggle('on', x === b));
          $('#ed-semi', el).classList.toggle('hidden', t === 'acessorio');
          $('#ed-gar', el).classList.toggle('hidden', t === 'seminovo');
          const g = $('[name=garantiaDias]', el); if (g && !id) g.value = t === 'novo' ? 365 : 90;
          const cat = $('[name=categoria]', el);
          if (!cat.value || /^Celulares (novos|seminovos)$/.test(cat.value)) cat.value = t === 'seminovo' ? 'Celulares seminovos' : t === 'novo' ? 'Celulares novos' : cat.value.startsWith('Celulares') ? '' : cat.value;
        });
        $('#ed-ok', el).onclick = () => {
          const f = readForm(el);
          if (!f.nome) return toast('Informe o nome', true);
          const qtd = parseInt(f.qtd) || 0;
          Object.assign(p, { nome: f.nome, codigo: f.codigo, categoria: f.categoria, compat: f.compat, custo: parseMoney(f.custo), preco: parseMoney(f.preco), minimo: parseInt(f.minimo) || 0, fornecedorId: f.fornecedorId });
          if (tipo === 'produto') Object.assign(p, { tipoProduto: f.tipoProduto, seminovo: f.tipoProduto === 'seminovo', imei: f.imei, cor: f.cor, armazenamento: f.armazenamento, bateria: f.bateria, condicao: f.condicao, statusAparelho: f.statusAparelho || 'disponivel', garantiaDias: f.tipoProduto === 'seminovo' ? GARANTIA_SEMINOVO_DIAS : parseInt(f.garantiaDias) || 0 });
          if (!id) { p.id = uid(); p.criadoEm = p.entradaEm = nowISO(); p.qtd = 0; col.push(p); if (qtd) Store.movimentar(tipo, p, qtd, 'Estoque inicial'); }
          else { const i = col.findIndex(x => x.id === id); const diff = qtd - col[i].qtd; p.qtd = col[i].qtd; col[i] = p; if (diff) Store.movimentar(tipo, p, diff, 'Ajuste na edição'); }
          Store.save(); m.close(); App.refresh(); toast(`${lbl} salvo`);
        };
        const del = $('#ed-del', el);
        if (del) del.onclick = async () => { if (await confirmDialog(`Excluir "${p.nome}"?`, { danger: true, ok: 'Excluir' })) { col.find(x => x.id === id).deleted = true; Store.save(); m.close(); App.refresh(); } };
      },
    });
  },

  // Lotes do item: saldo de cada entrada (o mais antigo sai primeiro)
  lotesHTML(tipo, id) {
    const ls = Store.lotesDe(tipo, id); if (!ls.length) return '';
    const item = tipo === 'peca' ? Store.peca(id) : Store.produto(id);
    const emLotes = ls.reduce((s, l) => s + Math.max(0, l.saldo), 0), semLote = Math.max(0, (item?.qtd || 0) - emLotes);
    return `<div class="section-title mt">${icon('layers', 'sm')} Lotes</div>
      ${semLote ? `<div class="kv"><span class="k">Estoque anterior aos lotes</span><span class="v">${semLote}</span></div>` : ''}
      ${ls.map(l => `<div class="kv" style="${l.saldo > 0 ? '' : 'opacity:.45'}"><span class="k">${esc(l.numero)} · ${fmtDate(l.data)}${l.fornecedor ? ' · ' + esc(l.fornecedor) : ''}${l.validade ? ` · val. ${fmtDate(l.validade)}` : ''}</span>
        <span class="v">${l.saldo}/${l.qtdInicial} · ${money(l.custo)}</span></div>`).join('')}`;
  },

  lote(tipo) {
    const col = this.col(tipo).filter(p => !p.deleted);
    if (!col.length) return toast('Cadastre itens primeiro', true);
    openModal({
      title: 'Entrada em lote', icon: 'layers', subtitle: 'Registre a chegada de uma compra de uma vez.', wide: true,
      body: `${field('Fornecedor / nota', '<input class="input" id="lt-ref" placeholder="Ex: NF 1234 - Distribuidora X">', { opt: true })}
        ${field('Validade', '<input class="input" id="lt-val" type="date">', { opt: true })}
        <label class="check"><input type="checkbox" id="lt-desp" checked> Lançar o valor da compra como despesa no financeiro</label>
        <div class="table-wrap"><table class="tbl"><tr><th>Item</th><th>Atual</th><th style="width:90px">Entrada</th><th style="width:110px">Custo un.</th></tr>
        ${col.sort((a, b) => a.nome.localeCompare(b.nome)).map(p => `<tr><td>${esc(p.nome)}</td><td>${p.qtd}</td><td><input class="input" style="min-height:38px;padding:6px 8px" type="number" min="0" data-q="${p.id}" placeholder="0"></td><td><input class="input" style="min-height:38px;padding:6px 8px" inputmode="decimal" data-c="${p.id}" value="${moneyInput(p.custo)}"></td></tr>`).join('')}</table></div>`,
      foot: `<button class="btn" data-close>Cancelar</button><button class="btn primary" id="lt-ok">${icon('check')} Registrar entrada</button>`,
      onMount: (el, m) => {
        $('#lt-ok', el).onclick = () => {
          const ref = $('#lt-ref', el).value.trim(), validade = $('#lt-val', el).value || null; let total = 0, n = 0;
          $$('[data-q]', el).forEach(i => {
            const q = parseInt(i.value) || 0; if (q <= 0) return;
            const p = col.find(x => x.id === i.dataset.q); p.custo = parseMoney($(`[data-c="${p.id}"]`, el).value);
            Store.criarLote({ tipoItem: tipo, item: p, qtd: q, custo: p.custo, fornecedor: ref, validade, motivo: 'Entrada em lote' + (ref ? ' — ' + ref : '') }); total += q * p.custo; n++;
          });
          if (!n) return toast('Informe alguma quantidade', true);
          if ($('#lt-desp', el).checked && total > 0) Store.addDespesa({ desc: `Compra de ${tipo === 'peca' ? 'peças' : 'produtos'}${ref ? ' — ' + ref : ''}`, valor: total, categoria: 'Compra de estoque', estoque: true });
          Store.save(); m.close(); App.refresh(); toast(`${n} item(ns) atualizado(s)`);
        };
      },
    });
  },

  fornecedores() {
    const render = el => {
      const fs = Store.db.fornecedores.filter(f => !f.deleted);
      $('#fn-list', el).innerHTML = fs.map(f => `<div class="cart-line"><div class="grow"><b>${esc(f.nome)}</b><div class="xs muted">${esc(fmtPhone(f.telefone) || '')} ${esc(f.obs || '')}</div></div>
        ${f.telefone ? `<a class="icon-btn" target="_blank" href="${waLink(f.telefone, 'Olá! Gostaria de fazer um pedido.')}">${icon('whatsapp', 'sm')}</a>` : ''}<button class="icon-btn" data-del="${f.id}">${icon('trash', 'sm')}</button></div>`).join('') || '<p class="small muted">Nenhum fornecedor.</p>';
      $$('[data-del]', el).forEach(b => b.onclick = () => { Store.db.fornecedores.find(f => f.id === b.dataset.del).deleted = true; Store.save(); render(el); });
    };
    openModal({
      title: 'Fornecedores', icon: 'truck',
      body: `<div id="fn-list" class="mb"></div><div class="section-title">Novo fornecedor</div>
        <div class="form-row">${field('Nome', '<input class="input" id="fn-nome">', { req: true })}${field('Telefone', '<input class="input" id="fn-tel" type="tel">')}</div>
        ${field('Observação', '<input class="input" id="fn-obs" placeholder="Ex: entrega em 1 dia, boa qualidade de telas">', { opt: true })}
        <button class="btn outline-gold block" id="fn-add">${icon('plus')} Adicionar</button>`,
      onMount: el => {
        render(el);
        $('#fn-add', el).onclick = () => {
          const nome = $('#fn-nome', el).value.trim(); if (!nome) return toast('Informe o nome', true);
          Store.db.fornecedores.push({ id: uid(), nome, telefone: onlyDigits($('#fn-tel', el).value), obs: $('#fn-obs', el).value.trim() });
          Store.save(); ['#fn-nome', '#fn-tel', '#fn-obs'].forEach(s => $(s, el).value = ''); render(el);
        };
      },
    });
  },

  exportar() {
    const rows = [['Nome', 'Código', 'Categoria', 'Compatível', 'Qtd', 'Mínimo', 'Custo', 'Venda', 'Custo total']];
    Store.db.pecas.filter(p => !p.deleted).forEach(p => rows.push([p.nome, p.codigo, p.categoria, p.compat, p.qtd, p.minimo, moneyInput(p.custo), moneyInput(p.preco), moneyInput(p.custo * p.qtd)]));
    download(`estoque-pecas-${dayKey()}.csv`, toCSV(rows), 'text/csv;charset=utf-8');
  },
};
Pages.pecas = EstoquePage;
