/* Peças e estoque: peças e produtos num cadastro só. A peça marcada "vende no balcão" aparece no Balcão.
   Quantidade aceita decimal (óleo em litro, fluido em ml). */
const UNIDADES = { un: 'un', L: 'litro', ml: 'ml', kg: 'kg', m: 'metro', jogo: 'jogo', par: 'par' };
const EstoquePage = {
  st: { tab: 'pecas', q: '', baixo: false },

  render(main) {
    const pecas = Store.db.pecas.filter(p => !p.deleted);
    const baixo = pecas.filter(p => p.qtd <= (p.minimo || 0));
    const custo = pecas.reduce((s, p) => s + (p.custo || 0) * Math.max(0, p.qtd), 0);
    const verCusto = Cloud.papel() !== 'tecnico';
    main.innerHTML = `
      ${pageHead('box', 'Peças e estoque', 'Peças, óleos, filtros e acessórios. Marque "vende no balcão" para vender sem OS.')}
      <button class="btn primary block mb" onclick="EstoquePage.editar('peca')">${icon('plus')} ${t('Nova peça')}</button>
      ${verCusto ? `<div class="grid grid-2 mb">
        <button class="btn" onclick="EstoquePage.lote('peca')">${icon('layers')} ${t('Entrada em lote')}</button>
        <button class="btn outline-gold" onclick="NFe.abrir()">${icon('upload')} ${t('Importar XML (NF-e)')}</button>
        <button class="btn" onclick="NFe.historico()">${icon('file')} ${t('Notas importadas')}</button>
        <button class="btn" onclick="EstoquePage.exportar()">${icon('report')} ${t('Relatório')}</button>
        <button class="btn" onclick="EstoquePage.comprar()">${icon('cart')} ${t('Lista "comprar"')}</button>
        <button class="btn" onclick="Print.etiquetas(Store.db.pecas.filter(p=>!p.deleted))">${icon('printer')} ${t('Etiquetas')}</button>
      </div>` : ''}
      <div class="tabs mb" id="est-tabs" style="display:inline-flex">${[['pecas', 'Peças', 'box'], ['hist', 'Histórico', 'history']].map(([k, l, ic]) => `<button data-k="${k}" class="${this.st.tab === k ? 'on' : ''}">${icon(ic, 'sm')} ${t(l)}</button>`).join('')}</div>
      <div class="grid grid-3 mb">
        <div class="stat stat-icon"><div class="ic">${icon('layers')}</div><div><div class="label">${t('Itens cadastrados')}</div><div class="value">${pecas.length}</div></div></div>
        <div class="stat stat-icon" style="cursor:pointer" onclick="EstoquePage.st.baixo=!EstoquePage.st.baixo;EstoquePage.list()"><div class="ic" style="color:var(--orange);background:rgba(217,119,6,.12)">${icon('alert')}</div><div><div class="label">${t('Estoque baixo')}</div><div class="value">${baixo.length}</div></div></div>
        ${verCusto ? `<div class="stat stat-icon" style="grid-column:1/-1;background:linear-gradient(135deg,var(--card),var(--bg-2));border-color:rgba(var(--gold-rgb), .35)"><div class="ic">${icon('dollar')}</div><div><div class="label">${t('Custo do estoque')}</div><div class="value gold">${money(custo)}</div></div></div>` : ''}
      </div>
      <div id="est-body"></div>`;
    $$('#est-tabs button').forEach(b => b.onclick = () => { this.st.tab = b.dataset.k; $$('#est-tabs button').forEach(x => x.classList.toggle('on', x === b)); this.body(); });
    this.body();
  },

  body() {
    const box = $('#est-body');
    if (this.st.tab === 'hist') {
      const mov = Store.db.movEstoque.filter(m => m.tipoItem === 'peca').slice(0, 300);
      box.innerHTML = `<div class="card pad-0"><div class="table-wrap"><table class="tbl"><tr><th>${t('Data')}</th><th>${t('Peça')}</th><th>${t('Qtd')}</th><th>${t('Saldo')}</th><th>${t('Motivo')}</th></tr>
        ${mov.map(m => `<tr><td class="small">${fmtDateTime(m.data)}</td><td>${esc(m.nome)}</td><td class="${m.qtd > 0 ? 'green' : 'red'} bold">${m.qtd > 0 ? '+' : ''}${fmtQtd(m.qtd)}</td><td>${fmtQtd(m.saldo)}</td><td class="small muted">${esc(m.motivo)}</td></tr>`).join('') || `<tr><td colspan="5" class="center muted">${t('Sem movimentações')}</td></tr>`}</table></div></div>`;
      return;
    }
    box.innerHTML = `<div class="card mb" style="padding:12px"><div class="row"><div class="input-icon grow">${icon('search')}<input class="input" id="est-q" placeholder="Buscar peça, código, aplicação..." value="${esc(this.st.q)}"></div>
      <button class="btn ${this.st.baixo ? 'outline-gold' : ''}" title="Só estoque baixo" onclick="EstoquePage.st.baixo=!EstoquePage.st.baixo;EstoquePage.body()">${icon('alert')}</button></div></div>
      <div class="card pad-0" id="est-list"></div>`;
    $('#est-q').oninput = e => { this.st.q = e.target.value; this.list(); };
    this.list();
  },

  list() {
    const el = $('#est-list'); if (!el) return;
    const list = Store.db.pecas.filter(p => !p.deleted && (!this.st.baixo || p.qtd <= (p.minimo || 0)) && matches(this.st.q, p.nome, p.codigo, p.categoria, p.aplicacao, p.compat, p.marca))
      .sort((a, b) => a.nome.localeCompare(b.nome));
    el.innerHTML = `<div class="list-head"><b>${t('{n} item(ns)', { n: list.length })}${this.st.baixo ? ` · <span class="gold">${t('estoque baixo')}</span>` : ''}</b></div>` + (list.map(p => this.itemHTML(p, 'peca')).join('') || `<div class="empty">${icon('box')}<div>${t('Nenhuma peça.')}</div></div>`);
  },

  itemHTML(p, tipo) {
    const low = p.qtd <= (p.minimo || 0);
    const forn = Store.db.fornecedores.find(f => f.id === p.fornecedorId);
    const verCusto = Cloud.papel() !== 'tecnico';
    const passo = p.unidade && p.unidade !== 'un' ? 0.5 : 1;
    return `<div class="item" onclick="EstoquePage.editar('${tipo}','${p.id}')"><div class="row">
      <div class="grow" style="min-width:0"><b>${esc(p.nome)}</b>${p.balcao ? ` <span class="pill gold xs">${t('Balcão')}</span>` : ''}<div class="small muted ellipsis">${[p.codigo, p.marca, p.aplicacao || p.compat, forn?.nome].filter(Boolean).map(esc).join(' · ') || '—'}</div>
        <div class="small" style="margin-top:4px">${verCusto ? `${t('Custo')} ${money(p.custo)}` : ''}${p.preco ? `${verCusto ? ' · ' : ''}<span class="gold">${t('Venda')} ${money(p.preco)}</span>` : ''}</div></div>
      <div class="qty" onclick="event.stopPropagation()"><button onclick="EstoquePage.ajuste('${tipo}','${p.id}',-${passo})" aria-label="${t('Menos')}">−</button><span class="${low ? 'red' : ''}">${fmtQtd(p.qtd)}${p.unidade && p.unidade !== 'un' ? ' ' + esc(p.unidade) : ''}</span><button onclick="EstoquePage.ajuste('${tipo}','${p.id}',${passo})" aria-label="${t('Mais')}">+</button></div>
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

  // lista "comprar": tudo que está no mínimo ou abaixo, com a quantidade sugerida e o fornecedor
  comprar() {
    const l = Store.db.pecas.filter(p => !p.deleted && p.qtd <= (p.minimo || 0)).sort((a, b) => a.nome.localeCompare(b.nome));
    const texto = l.map(p => `• ${p.nome}${p.codigo ? ` (${p.codigo})` : ''}: ${fmtQtd(Math.max(1, (p.minimo || 0) * 2 - p.qtd))} ${p.unidade || 'un'}`).join('\n');
    openModal({
      title: 'Lista "comprar"', icon: 'cart', subtitle: t('{n} item(ns) no mínimo ou abaixo', { n: l.length }),
      body: l.length ? l.map(p => { const f = Store.db.fornecedores.find(x => x.id === p.fornecedorId); return `<div class="cart-line"><div class="grow"><b>${esc(p.nome)}</b><div class="xs muted">${t('Tem')} ${fmtQtd(p.qtd)} · ${t('mínimo')} ${fmtQtd(p.minimo || 0)}${f ? ' · ' + esc(f.nome) : ''}</div></div><b>${fmtQtd(Math.max(1, (p.minimo || 0) * 2 - p.qtd))}</b></div>`; }).join('') : `<div class="empty small">${t('Nada para comprar agora.')}</div>`,
      foot: `<button class="btn" data-close>${t('Fechar')}</button>${l.length ? `<button class="btn" onclick="navigator.clipboard?.writeText(${esc(JSON.stringify(texto))});toast('Lista copiada')">${icon('repeat')} ${t('Copiar lista')}</button>` : ''}`,
    });
  },

  // pre: valores iniciais de um item novo
  editar(tipo, id, pre = {}) {
    const col = this.col(tipo);
    const p = id ? { ...col.find(x => x.id === id) } : { qtd: 0, minimo: 1, unidade: 'un', ...pre };
    const forns = Store.db.fornecedores.filter(f => !f.deleted);
    const cats = [...new Set([...col.map(x => x.categoria), ...(Store.s.categoriasPecas || CATEGORIAS_PECAS)].filter(Boolean))];
    const verCusto = Cloud.papel() !== 'tecnico';
    openModal({
      title: id ? t('Editar peça') : t('Nova peça'), icon: 'box',
      body: `
        ${field('Nome', `<input class="input" name="nome" placeholder="${t('Ex: Pastilha de freio dianteira')}" value="${esc(p.nome || '')}">`, { req: true })}
        <div class="form-row">
          ${field('Código / referência', `<input class="input" name="codigo" value="${esc(p.codigo || '')}" placeholder="${t('Código do fabricante ou de barras')}">`, { opt: true })}
          ${field('Marca', `<input class="input" name="marca" value="${esc(p.marca || '')}" placeholder="${t('Ex: Bosch')}">`, { opt: true })}
        </div>
        <div class="form-row">
          ${field('Categoria', `<input class="input" name="categoria" list="dl-cat" value="${esc(p.categoria || '')}" placeholder="${t('Freios, Filtros, Óleos...')}"><datalist id="dl-cat">${cats.map(c => `<option value="${esc(c)}">`).join('')}</datalist>`, { opt: true })}
          ${field('Unidade', `<select class="input" name="unidade">${selectOpts(UNIDADES, p.unidade || 'un')}</select>`)}
        </div>
        ${field('Aplicação (veículos)', `<input class="input" name="aplicacao" placeholder="${t('Ex: Onix 2017-2020, Prisma')}" value="${esc(p.aplicacao || p.compat || '')}">`, { opt: true })}
        <div class="form-row">
          ${verCusto ? field('Custo (R$)', `<input class="input" name="custo" inputmode="decimal" value="${p.custo ? moneyInput(p.custo) : ''}" placeholder="0,00">`) : ''}
          ${field('Preço de venda (R$)', `<input class="input" name="preco" inputmode="decimal" value="${p.preco ? moneyInput(p.preco) : ''}" placeholder="0,00">`, { opt: true })}
        </div>
        <div class="small gold mb" id="ed-margem"></div>
        <div class="form-row">
          ${field(id ? 'Quantidade atual' : 'Quantidade inicial', `<input class="input" inputmode="decimal" name="qtd" value="${fmtQtd(p.qtd ?? 0)}">`)}
          ${field('Estoque mínimo', `<input class="input" inputmode="decimal" name="minimo" value="${fmtQtd(p.minimo ?? 1)}">`)}
        </div>
        <label class="check card mb" style="padding:12px 14px"><input type="checkbox" name="balcao" ${p.balcao ? 'checked' : ''}> <span><b>${t('Vende no balcão')}</b><br><span class="xs muted">${t('Aparece no Balcão para vender sem OS (acessórios, óleo, palhetas...).')}</span></span></label>
        ${field('Garantia na venda (dias)', `<input class="input" type="number" min="0" name="garantiaDias" value="${p.garantiaDias ?? 90}">`, { opt: true })}
        ${field('Fornecedor', `<select class="input" name="fornecedorId"><option value="">—</option>${selectOpts(forns.map(f => [f.id, f.nome]), p.fornecedorId)}</select>`, { opt: true })}
        ${id && verCusto ? EstoquePage.lotesHTML(tipo, id) : ''}`,
      foot: `${id ? `<button class="btn danger" id="ed-del" title="Excluir">${icon('trash')}</button>` : ''}<button class="btn" data-close>Cancelar</button><button class="btn primary" id="ed-ok">${icon('check')} Salvar</button>`,
      onMount: (el, m) => {
        const mg = () => { const f = readForm(el); const c = parseMoney(f.custo || p.custo), v = parseMoney(f.preco); $('#ed-margem', el).textContent = verCusto && c && v ? t('Lucro por unidade: {v} ({p}%)', { v: money(v - c), p: Math.round((v - c) / v * 100) }) : ''; };
        $$('[name=custo], [name=preco]', el).forEach(i => i.oninput = mg); mg();
        $('#ed-ok', el).onclick = () => {
          const f = readForm(el);
          if (!f.nome) return toast('Informe o nome', true);
          const qtd = parseNum(f.qtd);
          Object.assign(p, { nome: f.nome, codigo: f.codigo, marca: f.marca, categoria: f.categoria, unidade: f.unidade, aplicacao: f.aplicacao, preco: parseMoney(f.preco), minimo: parseNum(f.minimo),
            balcao: !!f.balcao, garantiaDias: parseInt(f.garantiaDias, 10) || 0, fornecedorId: f.fornecedorId });
          if (verCusto) p.custo = parseMoney(f.custo);
          delete p.compat;
          if (!id) { p.id = uid(); p.criadoEm = p.entradaEm = nowISO(); p.qtd = 0; col.push(p); if (qtd) Store.movimentar(tipo, p, qtd, 'Estoque inicial'); }
          else { const i = col.findIndex(x => x.id === id); const diff = Math.round((qtd - col[i].qtd) * 1000) / 1000; p.qtd = col[i].qtd; col[i] = p; if (diff) Store.movimentar(tipo, p, diff, 'Ajuste na edição'); }
          Store.save(); m.close(); App.refresh(); toast(t('Peça salva'));
        };
        const del = $('#ed-del', el);
        if (del) del.onclick = async () => { if (await confirmDialog(t('Excluir "{p}"?', { p: p.nome }), { danger: true, ok: 'Excluir' })) { col.find(x => x.id === id).deleted = true; Store.save(); m.close(); App.refresh(); } };
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
