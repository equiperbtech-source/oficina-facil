/* Balcão (PDV): venda de peças e acessórios no balcão, recibo e caixa.
   Os itens vêm do estoque: peças marcadas "vende no balcão" e os produtos da vitrine. */
const Balcao = {
  // item vendável: { tipoItem: 'peca' | 'produto', ...registro }
  itens() {
    const ps = Store.db.pecas.filter(p => !p.deleted && p.balcao).map(p => ({ ...p, tipoItem: 'peca' }));
    const pr = Store.db.produtos.filter(p => !p.deleted).map(p => ({ ...p, tipoItem: 'produto' }));
    return [...ps, ...pr];
  },
  registro(tipoItem, id) { return tipoItem === 'peca' ? Store.peca(id) : Store.produto(id); },
};

// Equipe da oficina (com o papel), guardada no dispositivo para funcionar sem internet
const Equipe = {
  lista: null,
  chave() { return 'oficina_equipe_' + (Cloud.loja?.id || ''); },
  local() { if (!this.lista) try { this.lista = JSON.parse(localStorage.getItem(this.chave())) || []; } catch { this.lista = []; } return this.lista; },
  async carregar() {
    if (!(Cloud.enabled && Cloud.loja)) return this.local();
    try {
      const ms = await Cloud.membros();
      this.lista = ms.filter(x => !['dono', 'suporte'].includes(x.papel) && x.ativo !== false && !x.pendente).map(x => ({ id: x.user_id, nome: x.nome || (x.email || '').split('@')[0], papel: x.papel }));
      try { localStorage.setItem(this.chave(), JSON.stringify(this.lista)); } catch {}
    } catch { this.local(); }
    return this.lista;
  },
};

const VendasPage = {
  st: { tab: 'vender', q: '' },
  cart: [],
  get equipe() { return Equipe.local(); },

  render(main) {
    const cx = Store.caixaAberto();
    const cxAntigo = cx && dayKey(cx.abertoEm) !== dayKey();
    main.innerHTML = `
      ${pageHead('bag', 'Balcão', 'Venda de peças e acessórios no balcão, com recibo.')}
      <div class="row wrap mb">
        ${cx ? `<span class="pill ${cxAntigo ? 'orange' : 'green'}">● ${t('Caixa aberto desde')} ${fmtDate(cx.abertoEm).slice(0, 5)}</span>${cxAntigo ? `<a class="small" href="#/caixa">${t('Fechar e abrir o de hoje')}</a>` : ''}` : `<span class="pill red">● ${t('Caixa fechado')}</span><a class="small" href="#/caixa">${t('Abrir caixa')}</a>`}
      </div>
      <div class="tabs mb" id="vd-tabs" style="display:inline-flex">${[['vender', 'Vender', 'cart'], ['hist', 'Histórico', 'history']].map(([k, l, ic]) => `<button data-k="${k}" class="${this.st.tab === k ? 'on' : ''}">${icon(ic, 'sm')} ${l}</button>`).join('')}</div>
      <div id="vd-body"></div>
      <div class="cart-bar hidden" id="vd-cartbar"></div>`;
    $$('#vd-tabs button').forEach(b => b.onclick = () => { this.st.tab = b.dataset.k; $$('#vd-tabs button').forEach(x => x.classList.toggle('on', x === b)); this.body(); });
    this.updateCart();
    this.body();
  },

  body() {
    const box = $('#vd-body'); if (!box) return;
    if (this.st.tab === 'hist') return this.historico(box);
    box.innerHTML = `
      <div class="row mb"><div class="input-icon grow">${icon('search')}<input class="input" id="vd-q" placeholder="Buscar peça ou acessório, código..." value="${esc(this.st.q)}"></div>
        <button class="btn" onclick="App.go('pecas')" title="Cadastrar no estoque">${icon('plus')}</button></div>
      <p class="xs muted" style="margin-top:-6px">${t('Aparecem aqui as peças marcadas "vende no balcão" em Peças e estoque.')}</p>
      <div class="grid prod-grid" id="vd-list"></div>
      <button class="btn outline-gold block mt" onclick="VendasPage.novaVenda()">${icon('plus')} ${t('Venda sem cadastro')}</button>`;
    $('#vd-q').oninput = e => { this.st.q = e.target.value; this.renderProdutos(); };
    this.renderProdutos();
  },

  renderProdutos() {
    const box = $('#vd-list'); if (!box) { this.updateCart(); return; }
    const q = this.st.q;
    const list = Balcao.itens().filter(p => matches(q, p.nome, p.codigo, p.categoria, p.aplicacao, p.marca))
      .sort((a, b) => (b.qtd > 0) - (a.qtd > 0) || a.nome.localeCompare(b.nome)).slice(0, 120);
    box.innerHTML = list.map(p => {
      const inCart = this.cart.find(c => c.id === p.id)?.qtd || 0;
      return `<div class="card prod-card ${inCart ? 'on' : ''}" onclick="VendasPage.add('${p.tipoItem}','${p.id}')" role="button" tabindex="0">
        <b class="ellipsis" style="display:block">${esc(p.nome)}</b>
        <div class="xs muted ellipsis">${esc([p.codigo, p.categoria].filter(Boolean).join(' · ') || '—')}</div>
        <div class="row between" style="margin-top:8px"><b class="gold">${money(p.preco)}</b><span class="pill ${p.qtd > 0 ? '' : 'red'} xs">${t('Estoque')}: ${fmtQtd(p.qtd)}</span></div>
        <div class="btn sm ${inCart ? 'primary' : 'outline-gold'}" style="pointer-events:none;margin-top:8px">${inCart ? `${icon('check', 'sm')} ${t('No carrinho')} (${fmtQtd(inCart)})` : `${icon('cart', 'sm')} ${t('Adicionar')}`}</div>
      </div>`;
    }).join('') || `<div class="empty" style="grid-column:1/-1">${icon(q ? 'search' : 'box')}<div>${q ? t('Nada encontrado.') : t('Nenhuma peça à venda no balcão ainda.')}</div></div>`;
    this.updateCart();
  },

  // Barra do carrinho (fica embaixo da tela enquanto houver itens)
  updateCart() {
    const bar = $('#vd-cartbar'); if (!bar) return;
    const n = this.cart.length;
    const total = this.cart.reduce((s, c) => s + c.preco * c.qtd, 0);
    bar.classList.toggle('hidden', !n);
    document.body.classList.toggle('com-carrinho', !!n);
    if (!n) return;
    bar.innerHTML = `<div class="grow" style="min-width:0" onclick="VendasPage.verCarrinho()"><div class="bold">${icon('cart', 'sm')} ${n} ${n > 1 ? t('itens') : t('item')} · <span class="gold">${money(total)}</span></div>
        <div class="xs muted ellipsis">${this.cart.map(c => esc(c.nome)).join(', ')}</div></div>
      <button class="btn sm ghost" onclick="VendasPage.limparCarrinho()">${t('Limpar')}</button>
      <button class="btn primary" onclick="VendasPage.novaVenda()">${t('Finalizar')} ${icon('arrowRight', 'sm')}</button>`;
  },
  limparCarrinho() { this.cart = []; this.renderProdutos(); },
  verCarrinho() {
    openModal({
      title: 'Carrinho', icon: 'cart',
      body: this.cart.map((c, i) => `<div class="cart-line"><div class="grow"><b>${esc(c.nome)}</b><div class="xs muted">${fmtQtd(c.qtd)}x ${money(c.preco)}</div></div><b>${money(c.preco * c.qtd)}</b><button class="icon-btn" title="Tirar" onclick="VendasPage.cart.splice(${i},1);closeAllModals();VendasPage.renderProdutos()">${icon('trash', 'sm')}</button></div>`).join(''),
      foot: `<button class="btn" data-close>Continuar escolhendo</button><button class="btn primary" onclick="closeAllModals();VendasPage.novaVenda()">Finalizar venda</button>`,
    });
  },
  add(tipoItem, id) {
    const p = Balcao.registro(tipoItem, id); if (!p) return;
    const it = this.cart.find(c => c.id === id);
    if ((it?.qtd || 0) + 1 > p.qtd) toast(t('Atenção: estoque de "{p}" é {n}', { p: p.nome, n: fmtQtd(p.qtd) }), true);
    if (it) it.qtd++; else this.cart.push(this.itemDe(p, tipoItem));
    this.renderProdutos();
  },
  // Item do carrinho a partir de um cadastro do estoque
  itemDe(p, tipoItem = 'produto') {
    return { id: p.id, tipoItem, nome: p.nome, preco: p.preco || 0, custo: p.custo || 0, qtd: 1, garantiaDias: p.garantiaDias ?? 90 };
  },

  /* ---------- Registrar venda ----------
     itens: [{ id, tipoItem, nome, preco, custo, qtd, garantiaDias, avulso }]
     vendedor: undefined = quem está registrando; 'loja' = venda da oficina (não conta para ninguém); { id, nome } = funcionário */
  registrar({ itens, clienteId = null, clienteNome = '', desconto = 0, forma = 'pix', vendedor, parcelas = 1 }) {
    const subtotal = itens.reduce((s, i) => s + i.preco * i.qtd, 0);
    const custo = itens.reduce((s, i) => s + (i.custo || 0) * i.qtd, 0);
    const total = subtotal - desconto;
    const q = vendedor === 'loja' ? {} : vendedor?.id ? vendedor : Store.quem();
    const v = { id: uid(), numero: Store.next('venda'), data: nowISO(), itens: itens.map(i => ({ ...i })), subtotal, desconto, total, custo, forma, parcelas, clienteId, clienteNome,
      ...(q.id ? { vendedorId: q.id, vendedorNome: q.nome } : {}), ...(vendedor === 'loja' ? { vendidoPor: 'loja' } : {}) };
    for (const i of v.itens) {
      const p = !i.avulso && Balcao.registro(i.tipoItem || 'produto', i.id);
      if (p) Store.movimentar(i.tipoItem || 'produto', p, -i.qtd, `Venda #${v.numero}`);
    }
    Store.db.vendas.push(v);
    if (total > 0) Store.addReceita({ origem: 'venda', refId: v.id, desc: `Venda #${v.numero}`, valor: total, custo, forma, data: v.data, parcelas });
    Store.log('Venda', `#${v.numero} ${money(v.total)}`);
    Store.save();
    return v;
  },

  /* ---------- Nova venda: itens, cliente e pagamento ---------- */
  novaVenda(pre = {}) {
    const sale = { itens: this.cart.map(c => ({ ...c })), clienteId: pre.clienteId || null };
    const m = openModal({
      title: 'Nova venda', icon: 'cart', wide: true,
      body: `<div class="section-title">${t('Itens')}</div>
        <div class="input-icon">${icon('search')}<input class="input" id="nv-q" placeholder="Buscar peça ou acessório para adicionar..."></div>
        <div id="nv-res" class="mt"></div>
        <div class="row mt" style="gap:8px"><input class="input grow" id="nv-av-nome" placeholder="${t('Item sem cadastro (nome)')}"><input class="input" id="nv-av-preco" inputmode="decimal" placeholder="0,00" style="max-width:110px" aria-label="${t('Preço')}"><button class="btn outline-gold" id="nv-av-add" title="Adicionar">${icon('plus')}</button></div>
        <div id="nv-itens" class="mt"></div>
        <div class="section-title mt">${t('Cliente')} <span class="opt">(${t('opcional')})</span></div><div id="nv-cli"></div>
        <div class="section-title mt">${t('Pagamento')}</div>
        <div class="form-row">${field('Forma de pagamento', `<select class="input" id="nv-forma">${selectOpts(FORMAS_PGTO, 'pix')}</select>`)}${field('Desconto', '<input class="input" id="nv-desc" inputmode="decimal" placeholder="0,00">')}</div>
        <div id="nv-parc"></div>
        <div class="card mt" id="nv-tot"></div>`,
      foot: `<button class="btn" data-close>Cancelar</button><button class="btn primary" id="nv-ok">${icon('check')} Concluir venda</button>`,
    });
    const el = m.el;
    const calc = () => {
      const sub = sale.itens.reduce((s, i) => s + i.preco * i.qtd, 0);
      const desc = Math.min(sub, parseMoney($('#nv-desc', el).value));
      $('#nv-tot', el).innerHTML = `<div class="kv"><span class="k">${t('Subtotal')}</span><span class="v">${money(sub)}</span></div>${desc ? `<div class="kv"><span class="k">${t('Desconto')}</span><span class="v red">-${money(desc)}</span></div>` : ''}<div class="kv"><span class="k bold">${t('Total')}</span><span class="v gold" style="font-size:22px">${money(sub - desc)}</span></div>`;
      if (typeof Parcelas !== 'undefined') Parcelas.campo($('#nv-parc', el), $('#nv-forma', el).value, sub - desc, 'balcao');
      return { sub, desc };
    };
    const itens = () => {
      $('#nv-itens', el).innerHTML = sale.itens.map((i, k) => `<div class="cart-line"><div class="grow" style="min-width:0"><b class="ellipsis" style="display:block">${esc(i.nome)}</b><div class="xs muted">${money(i.preco)}${i.avulso ? ' · ' + t('sem cadastro') : ''}</div></div>
        <div class="qty"><button data-d="-1" data-k="${k}" aria-label="${t('Menos')}">−</button><span>${fmtQtd(i.qtd)}</span><button data-d="1" data-k="${k}" aria-label="${t('Mais')}">+</button></div><b style="min-width:80px;text-align:right">${money(i.preco * i.qtd)}</b></div>`).join('') || `<p class="small muted">${t('Nenhum item ainda.')}</p>`;
      $$('[data-d]', el).forEach(b => b.onclick = () => { const it = sale.itens[+b.dataset.k]; it.qtd += +b.dataset.d; if (it.qtd <= 0) sale.itens.splice(+b.dataset.k, 1); itens(); });
      calc();
    };
    const busca = () => {
      const q = $('#nv-q', el).value.trim();
      if (!q) { $('#nv-res', el).innerHTML = ''; return; }
      const r = Balcao.itens().filter(p => matches(q, p.nome, p.codigo, p.categoria, p.aplicacao)).slice(0, 6);
      $('#nv-res', el).innerHTML = `<div class="card pad-0">${r.map(p => `<div class="item" data-add="${p.id}" data-tp="${p.tipoItem}" style="padding:10px 14px"><div class="row between"><div class="grow" style="min-width:0"><b class="ellipsis" style="display:block">${esc(p.nome)}</b><div class="xs muted">${t('Estoque')}: ${fmtQtd(p.qtd)}</div></div><b class="gold">${money(p.preco)}</b></div></div>`).join('') || `<div class="empty small">${t('Nada encontrado')}</div>`}</div>`;
      $$('[data-add]', el).forEach(it => it.onclick = () => {
        const p = Balcao.registro(it.dataset.tp, it.dataset.add); const ja = sale.itens.find(i => i.id === p.id);
        if (ja) ja.qtd++; else sale.itens.push(this.itemDe(p, it.dataset.tp));
        $('#nv-q', el).value = ''; busca(); itens();
      });
    };
    const cliente = () => {
      const box = $('#nv-cli', el);
      const c = sale.clienteId && Store.cliente(sale.clienteId);
      if (c) {
        box.innerHTML = `<div class="cart-line"><div class="avatar">${esc(c.nome[0].toUpperCase())}</div><div class="grow"><b data-no-i18n>${esc(c.nome)}</b><div class="xs muted">${esc(fmtPhone(c.telefone) || t('sem telefone'))}</div></div><button class="btn sm ghost" id="nc-trocar">${t('Trocar')}</button></div>`;
        $('#nc-trocar', el).onclick = () => { sale.clienteId = null; cliente(); };
        return;
      }
      box.innerHTML = `<div class="input-icon">${icon('search')}<input class="input" id="nc-q" placeholder="${t('Buscar cliente por nome, telefone ou placa')}"></div><div id="nc-res" class="mt"></div>`;
      $('#nc-q', el).oninput = e => {
        const q = e.target.value.trim();
        const r = q ? Store.clientesAtivos().filter(x => ClientesPage.bate(x, q)).slice(0, 5) : [];
        $('#nc-res', el).innerHTML = r.map(x => `<div class="cart-line" data-cli="${x.id}" style="cursor:pointer"><div class="avatar">${esc(x.nome[0].toUpperCase())}</div><div class="grow"><b data-no-i18n>${esc(x.nome)}</b></div>${icon('chevRight')}</div>`).join('');
        $$('[data-cli]', el).forEach(b => b.onclick = () => { sale.clienteId = b.dataset.cli; cliente(); });
      };
    };
    $('#nv-q', el).oninput = busca;
    $('#nv-av-add', el).onclick = () => {
      const nome = $('#nv-av-nome', el).value.trim(), preco = parseMoney($('#nv-av-preco', el).value);
      if (!nome) return toast(t('Escreva o nome do item'), true);
      sale.itens.push({ id: uid(), avulso: true, nome, preco, custo: 0, qtd: 1, garantiaDias: 90 });
      $('#nv-av-nome', el).value = ''; $('#nv-av-preco', el).value = ''; itens();
    };
    $('#nv-desc', el).oninput = calc; $('#nv-forma', el).onchange = calc;
    itens(); cliente();
    $('#nv-ok', el).onclick = () => {
      if (!sale.itens.length) return toast(t('Adicione pelo menos um item'), true);
      if (Store.s.exigirCaixa && !Store.caixaAberto()) return toast('Abra o caixa primeiro', true);
      const { desc } = calc();
      const forma = $('#nv-forma', el).value;
      const parcelas = forma === 'credito' ? (parseInt($('#nv-parc select', el)?.value, 10) || 1) : 1;
      const v = this.registrar({ itens: sale.itens, clienteId: sale.clienteId, desconto: desc, forma, parcelas });
      this.cart = []; m.close(); App.refresh(); this.recibo(v);
    };
  },

  recibo(v) {
    const c = v.clienteId && Store.cliente(v.clienteId);
    openModal({
      title: 'Venda concluída!', icon: 'checkCircle', subtitle: `${t('Venda')} #${v.numero} · ${money(v.total)}`,
      body: `<div class="center"><div class="gold bold" style="font-size:34px">${money(v.total)}</div><p class="muted">${esc(nomeForma(v.forma))}${v.parcelas > 1 ? ` · ${v.parcelas}x` : ''} · ${t('{n} item(ns)', { n: v.itens.length })}</p></div>`,
      foot: `<button class="btn primary" onclick="VendasPage.reciboPdf('${v.id}', true)">${icon('upload')} ${t('Recibo (PDF)')}</button><button class="btn" onclick="VendasPage.reciboPdf('${v.id}')" title="Baixar">${icon('download')}</button><button class="btn" onclick="VendasPage.imprimir('${v.id}')">${icon('printer')} ${t('Imprimir')}</button>
        ${c?.telefone ? `<a class="btn success" target="_blank" rel="noopener" href="${waLink(c.telefone, `${t('Olá {cliente}! Obrigado pela compra na {oficina}!', { cliente: c.nome.split(' ')[0], oficina: Store.s.loja })} 🛠️\n\n${v.itens.map(i => `• ${i.nome} x${fmtQtd(i.qtd)}: ${money(i.preco * i.qtd)}`).join('\n')}\n\n*${t('Total')}: ${money(v.total)}*`)}">${icon('whatsapp')} WhatsApp</a>` : ''}
        <button class="btn" data-close>${t('Fechar')}</button>`,
    });
  },

  // Imprimir o recibo: A4 pela impressão da tela; cupom 80/58 mm pelo PDF do cupom
  async imprimir(id) {
    const f = await Pdf.escolherFormato('Imprimir recibo');
    if (!f) return;
    const v = Store.db.vendas.find(x => x.id === id);
    if (f === 'a4') return Print.venda(v);
    Pdf.abrirParaImprimir(await Pdf.recibo(v), `recibo-venda-${v.numero}.pdf`);
  },
  // Recibo em PDF (com termos de garantia); no celular abre o compartilhar (WhatsApp)
  async reciboPdf(id, compartilhar) {
    if (!(await Pdf.escolherFormato('Recibo da venda'))) return;
    const v = Store.db.vendas.find(x => x.id === id);
    toast('Gerando recibo...');
    const doc = await Pdf.recibo(v);
    const nome = `recibo-venda-${v.numero}.pdf`;
    if (compartilhar) await Pdf.compartilhar(doc, nome, `${t('Recibo da venda')} #${v.numero} — ${Store.s.loja}`); else Pdf.baixar(doc, nome);
  },

  historico(box) {
    const vendas = Store.db.vendas.slice().sort((a, b) => b.data.localeCompare(a.data));
    const hoje = vendas.filter(v => !v.cancelada && dayKey(v.data) === dayKey());
    box.innerHTML = `
      <div class="grid grid-2 mb">
        <div class="stat"><div class="label">Vendas hoje</div><div class="value">${hoje.length}</div></div>
        <div class="stat"><div class="label">Total hoje</div><div class="value gold">${money(hoje.reduce((s, v) => s + v.total, 0))}</div></div>
      </div>
      <div class="card pad-0">${vendas.slice(0, 200).map(v => `<div class="item" onclick="VendasPage.detalheVenda('${v.id}')"><div class="row between"><div class="grow" style="min-width:0">
        <div class="meta"><span class="num">#${v.numero}</span><span>${fmtDateTime(v.data)}</span><span class="pill">${esc(nomeForma(v.forma))}</span>${v.cancelada ? `<span class="pill red">${t('Cancelada')}</span>` : ''}${v.vendedorNome ? `<span class="pill" data-no-i18n>${icon('user', 'sm')} ${esc(v.vendedorNome)}</span>` : ''}</div>
        <div class="small muted ellipsis" style="margin-top:6px">${v.itens.map(i => `${fmtQtd(i.qtd)}x ${esc(i.nome)}`).join(', ')}</div></div>
        <div class="price" style="${v.cancelada ? 'text-decoration:line-through;opacity:.5' : ''}">${money(v.total)}</div></div></div>`).join('') || `<div class="empty">${icon('history')}<div>${t('Nenhuma venda ainda.')}</div></div>`}</div>`;
  },

  abrirVenda(id) { if (Store.db.vendas.some(x => x.id === id)) this.detalheVenda(id); else App.go('financeiro'); },
  detalheVenda(id) {
    const v = Store.db.vendas.find(x => x.id === id);
    const c = v.clienteId && Store.cliente(v.clienteId);
    openModal({
      title: `${t('Venda')} #${v.numero}`, subtitle: fmtDateTime(v.data), icon: 'bag',
      body: `${c ? `<p>${t('Cliente')}: <b data-no-i18n>${esc(c.nome)}</b></p>` : v.clienteNome ? `<p>${t('Comprador')}: <b data-no-i18n>${esc(v.clienteNome)}</b></p>` : ''}${v.vendedorNome ? `<p>${t('Vendedor')}: <b data-no-i18n>${esc(v.vendedorNome)}</b></p>` : ''}
        <div class="card">${v.itens.map(i => `<div class="kv"><span class="k">${fmtQtd(i.qtd)}x ${esc(i.nome)}</span><span class="v">${money(i.preco * i.qtd)}</span></div>`).join('')}
        ${v.desconto ? `<div class="kv"><span class="k">${t('Desconto')}</span><span class="v red">-${money(v.desconto)}</span></div>` : ''}
        <div class="kv"><span class="k bold">${t('Total')} · ${esc(nomeForma(v.forma))}${v.parcelas > 1 ? ` ${v.parcelas}x` : ''}</span><span class="v gold" style="font-size:20px">${money(v.total)}</span></div></div>`,
      foot: `<button class="btn primary" onclick="VendasPage.reciboPdf('${v.id}', true)">${icon('upload')} ${t('Recibo (PDF)')}</button><button class="btn" onclick="VendasPage.reciboPdf('${v.id}')" title="Baixar">${icon('download')}</button><button class="btn" onclick="VendasPage.imprimir('${v.id}')">${icon('printer')} ${t('Imprimir')}</button>
        ${v.cancelada ? '' : `<button class="btn danger" onclick="VendasPage.cancelar('${v.id}')">${icon('xCircle')} ${t('Cancelar venda')}</button>`}`,
    });
  },

  async cancelar(id) {
    const v = Store.db.vendas.find(x => x.id === id);
    if (!(await confirmDialog(t('Cancelar a venda #{n}? Os itens voltam ao estoque e o valor sai do financeiro.', { n: v.numero }), { danger: true, ok: 'Cancelar venda' }))) return;
    v.cancelada = true;
    v.itens.forEach(i => { const p = !i.avulso && Balcao.registro(i.tipoItem || 'produto', i.id); if (p) Store.movimentar(i.tipoItem || 'produto', p, i.qtd, `Cancelamento venda #${v.numero}`); });
    Store.db.lancamentos = Store.db.lancamentos.filter(l => !(l.origem === 'venda' && l.refId === v.id));
    Store.log('Venda cancelada', `#${v.numero}`); Store.save(); closeAllModals(); App.refresh(); toast('Venda cancelada');
  },
};
Pages.vendas = VendasPage;

