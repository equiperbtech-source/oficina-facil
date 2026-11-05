/* Financeiro e Caixa */
const FinPage = {
  st: { periodo: 'mes', de: '', ate: '', tipo: '' },

  range() {
    const h = new Date(); const { periodo } = this.st;
    if (periodo === 'hoje') return [dayKey(h), dayKey(h)];
    if (periodo === '7d') return [dayKey(addDays(h, -6)), dayKey(h)];
    if (periodo === 'mes') return [monthKey(h) + '-01', dayKey(h)];
    if (periodo === 'mesant') { const d = new Date(h.getFullYear(), h.getMonth() - 1, 1); const e = new Date(h.getFullYear(), h.getMonth(), 0); return [dayKey(d), dayKey(e)]; }
    if (periodo === 'ano') return [h.getFullYear() + '-01-01', dayKey(h)];
    return [this.st.de || dayKey(h), this.st.ate || dayKey(h)];
  },

  render(main) {
    const [de, ate] = this.range();
    const inRange = l => { const k = dayKey(l.data); return k >= de && k <= ate; };
    const r = Store.resumo(inRange);
    const ls = Store.lancs().filter(l => inRange(l) && (!this.st.tipo || l.tipo === this.st.tipo)).sort((a, b) => b.data.localeCompare(a.data));
    const porForma = {};
    Store.lancs().filter(l => inRange(l) && l.tipo === 'receita' && l.forma !== 'troca').forEach(l => porForma[l.forma] = (porForma[l.forma] || 0) + l.valor);
    const porCat = {};
    Store.lancs().filter(l => inRange(l) && l.tipo === 'despesa').forEach(l => porCat[l.categoria] = (porCat[l.categoria] || 0) + l.valor);
    const aReceber = Store.db.os.filter(o => !o.deleted && OS_ATIVOS.includes(o.status)).reduce((s, o) => s + Store.osTotal(o), 0);

    main.innerHTML = `
      ${pageHead('chart', 'Financeiro', 'Receitas, despesas e lucro da assistência.')}
      <div class="page-actions">
        <button class="btn primary" onclick="FinPage.lancar('despesa')">${icon('minus')} Nova despesa</button>
        <button class="btn outline-gold" onclick="FinPage.lancar('receita')">${icon('plus')} Nova receita</button>
        <button class="btn" onclick="FinPage.exportar()">${icon('download')} CSV</button>
      </div>
      <div class="card mb" style="padding:12px">
        <div class="tabs" id="fin-per">${[['hoje', 'Hoje'], ['7d', '7 dias'], ['mes', 'Este mês'], ['mesant', 'Mês anterior'], ['ano', 'Ano'], ['custom', 'Personalizado']].map(([k, l]) => `<button data-k="${k}" class="${this.st.periodo === k ? 'on' : ''}">${l}</button>`).join('')}</div>
        ${this.st.periodo === 'custom' ? `<div class="form-row mt"><input class="input" type="date" id="fin-de" value="${de}"><input class="input" type="date" id="fin-ate" value="${ate}"></div>` : ''}
        <div class="small muted mt">${fmtDate(de + 'T12:00')} a ${fmtDate(ate + 'T12:00')}</div>
      </div>
      <div class="hero mb">
        <div class="small muted bold" style="letter-spacing:.12em">LUCRO LÍQUIDO</div>
        <div class="big ${r.lucro >= 0 ? 'green' : 'red'}">${money(r.lucro)}</div>
        <div class="row wrap mt"><span class="pill green">Margem ${r.margem.toFixed(1)}%</span><span class="pill gold">A receber em bancada ${money(aReceber)}</span></div>
      </div>
      <div class="grid grid-2 mb">
        <div class="stat"><div class="label">${icon('trending', 'sm')} Faturamento</div><div class="value gold">${money(r.receita)}</div><div class="sub">OS ${money(r.os)} · Vendas ${money(r.vendas)}</div></div>
        <div class="stat"><div class="label">${icon('box', 'sm')} Custo de peças/produtos</div><div class="value red">${money(r.custo)}</div></div>
        <div class="stat"><div class="label">${icon('card', 'sm')} Taxas de cartão</div><div class="value red">${money(r.taxa)}</div></div>
        <div class="stat"><div class="label">${icon('minus', 'sm')} Despesas</div><div class="value red">${money(r.despesa)}</div></div>
        ${r.compras ? `<div class="stat" style="grid-column:1/-1"><div class="label">${icon('box', 'sm')} Compras de estoque e aparelhos</div><div class="value">${money(r.compras)}</div><div class="sub">Saíram do caixa, mas não reduzem o lucro agora: o custo entra quando o item é vendido.</div></div>` : ''}
      </div>
      <div class="grid grid-auto mb">
        <div class="card"><h3>Recebido por <span class="gold">forma</span></h3>${Object.entries(porForma).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<div class="kv"><span class="k">${nomeForma(k)}</span><span class="v">${money(v)}</span></div>`).join('') || '<p class="small muted">Sem receitas no período.</p>'}</div>
        <div class="card"><h3>Despesas por <span class="gold">categoria</span></h3>${Object.entries(porCat).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<div class="kv"><span class="k">${esc(k)}</span><span class="v red">${money(v)}</span></div>`).join('') || '<p class="small muted">Sem despesas no período.</p>'}</div>
      </div>
      <div class="card pad-0">
        <div class="list-head"><b>Lançamentos (${ls.length})</b><select class="input" id="fin-tipo" style="width:auto;min-height:38px;padding:6px 40px 6px 12px">${selectOpts({ '': 'Todos', receita: 'Receitas', despesa: 'Despesas' }, this.st.tipo)}</select></div>
        ${ls.slice(0, 300).map(l => `<div class="item" style="cursor:default;padding:12px 18px"><div class="row">
          <div class="stat-icon"><div class="ic" style="width:38px;height:38px;${l.tipo === 'despesa' ? 'color:var(--red);background:rgba(248,113,113,.1)' : ''}">${icon(l.tipo === 'despesa' ? 'minus' : l.origem === 'venda' ? 'bag' : l.origem === 'os' ? 'wrench' : 'plus', 'sm')}</div></div>
          <div class="grow"><b class="ellipsis" style="display:block">${esc(l.desc)}</b><div class="xs muted">${fmtDateTime(l.data)} · ${nomeForma(l.forma)} · ${esc(l.categoria || '')}</div></div>
          <div class="right">${l.forma === 'troca' && l.tipo === 'receita' ? `<b class="muted">${money(l.valor)}</b><div class="xs muted">não soma no faturamento</div>` : `<b class="${l.tipo === 'despesa' ? 'red' : 'gold'}">${l.tipo === 'despesa' ? '-' : '+'}${money(l.valor)}</b>${l.custo || l.taxa ? `<div class="xs muted">custo ${money((l.custo || 0) + (l.taxa || 0))}</div>` : ''}`}</div>
          ${l.origem === 'manual' ? `<button class="icon-btn" onclick="FinPage.excluir('${l.id}')">${icon('trash', 'sm')}</button>` : ''}
        </div></div>`).join('') || `<div class="empty">${icon('chart')}<div>Nenhum lançamento no período.</div></div>`}
      </div>`;
    $$('#fin-per button').forEach(b => b.onclick = () => { this.st.periodo = b.dataset.k; App.refresh(); });
    $('#fin-tipo').onchange = e => { this.st.tipo = e.target.value; App.refresh(); };
    if ($('#fin-de')) { $('#fin-de').onchange = e => { this.st.de = e.target.value; App.refresh(); }; $('#fin-ate').onchange = e => { this.st.ate = e.target.value; App.refresh(); }; }
  },

  lancar(tipo) {
    const cats = tipo === 'despesa' ? ['Aluguel', 'Energia', 'Internet', 'Funcionários', 'Compra de estoque', 'Ferramentas', 'Marketing', 'Impostos', 'Retirada do dono', 'Despesas gerais'] : ['Outros', 'Serviços', 'Vendas'];
    openModal({
      title: tipo === 'despesa' ? 'Nova despesa' : 'Nova receita', icon: tipo === 'despesa' ? 'minus' : 'plus',
      body: `${field('Descrição', '<input class="input" id="lc-d" placeholder="Ex: Conta de luz">', { req: true })}
        <div class="form-row">${field('Valor (R$)', '<input class="input" id="lc-v" inputmode="decimal" placeholder="0,00">', { req: true })}${field('Data', `<input class="input" type="date" id="lc-dt" value="${dayKey()}">`)}</div>
        <div class="form-row">${field('Categoria', `<input class="input" id="lc-c" list="dl-lc" value="${cats[cats.length - 1]}"><datalist id="dl-lc">${cats.map(c => `<option value="${c}">`).join('')}</datalist>`)}${field('Forma', `<select class="input" id="lc-f">${selectOpts(FORMAS_PGTO, 'dinheiro')}</select>`)}</div>`,
      foot: `<button class="btn" data-close>Cancelar</button><button class="btn primary" id="lc-ok">${icon('check')} Salvar</button>`,
      onMount: (el, m) => $('#lc-ok', el).onclick = () => {
        const desc = $('#lc-d', el).value.trim(), valor = parseMoney($('#lc-v', el).value);
        if (!desc || valor <= 0) return toast('Informe descrição e valor', true);
        const dt = $('#lc-dt', el).value; const data = dt === dayKey() ? nowISO() : new Date(dt + 'T12:00:00').toISOString();
        const o = { desc, valor, data, categoria: $('#lc-c', el).value.trim(), forma: $('#lc-f', el).value };
        if (tipo === 'despesa') Store.addDespesa(o);
        else { const l = Store.addReceita({ ...o, origem: 'manual' }); l.origem = 'manual'; Store.log('Receita', `${desc} ${money(valor)}`); Store.save(); }
        m.close(); App.refresh(); toast('Lançamento salvo');
      },
    });
  },

  async excluir(id) {
    if (!(await confirmDialog('Excluir este lançamento?', { danger: true, ok: 'Excluir' }))) return;
    Store.db.lancamentos = Store.db.lancamentos.filter(l => l.id !== id); Store.save(); App.refresh();
  },

  exportar() {
    const [de, ate] = this.range();
    const rows = [['Data', 'Tipo', 'Descrição', 'Categoria', 'Forma', 'Valor', 'Custo', 'Taxa']];
    Store.lancs().filter(l => { const k = dayKey(l.data); return k >= de && k <= ate; }).sort((a, b) => a.data.localeCompare(b.data))
      .forEach(l => rows.push([fmtDateTime(l.data), l.tipo, l.desc, l.categoria, nomeForma(l.forma), moneyInput(l.valor), moneyInput(l.custo), moneyInput(l.taxa)]));
    download(`financeiro-${de}-a-${ate}.csv`, toCSV(rows), 'text/csv;charset=utf-8');
  },
};
Pages.financeiro = FinPage;

/* Caixa */
Pages.caixa = {
  calc(cx) {
    const ls = Store.lancs().filter(l => l.caixaId === cx.id && l.forma !== 'troca');
    const din = ls.filter(l => l.forma === 'dinheiro');
    const r = {
      inicial: cx.valorInicial || 0,
      entradasDin: din.filter(l => l.tipo === 'receita').reduce((s, l) => s + l.valor, 0),
      saidasDin: din.filter(l => l.tipo === 'despesa').reduce((s, l) => s + l.valor, 0),
      suprimentos: (cx.movs || []).filter(m => m.tipo === 'suprimento').reduce((s, m) => s + m.valor, 0),
      sangrias: (cx.movs || []).filter(m => m.tipo === 'sangria').reduce((s, m) => s + m.valor, 0),
      porForma: {},
      total: 0,
    };
    ls.filter(l => l.tipo === 'receita').forEach(l => { r.porForma[l.forma] = (r.porForma[l.forma] || 0) + l.valor; r.total += l.valor; });
    r.esperado = r.inicial + r.entradasDin - r.saidasDin + r.suprimentos - r.sangrias;
    return r;
  },

  render(main) {
    const cx = Store.caixaAberto();
    const hist = Store.db.caixas.filter(c => c.fechadoEm).sort((a, b) => b.abertoEm.localeCompare(a.abertoEm)).slice(0, 30);
    let html = pageHead('bank', 'Caixa', 'Abertura, sangria, suprimento e fechamento com conferência.');
    if (!cx) {
      html += `<div class="card mb center" style="padding:30px 20px"><div class="page-icon" style="margin:0 auto 14px">${icon('lock')}</div><h2 style="margin:0">Caixa <span class="gold">fechado</span></h2><p class="muted">Abra o caixa para controlar o dinheiro em espécie do dia.</p>
        <div style="max-width:320px;margin:0 auto">${field('Troco inicial (R$)', '<input class="input" id="cx-ini" inputmode="decimal" placeholder="0,00">')}<button class="btn primary block" id="cx-abrir">${icon('check')} Abrir caixa</button></div></div>`;
    } else {
      const r = this.calc(cx);
      html += `
        <div class="hero mb"><div class="row between"><span class="pill green">● Aberto desde ${fmtDateTime(cx.abertoEm)}</span></div>
          <div class="small muted bold mt" style="letter-spacing:.12em">DINHEIRO ESPERADO NA GAVETA</div><div class="big gold">${money(r.esperado)}</div>
          <div class="small muted">Total recebido no caixa (todas as formas): <b>${money(r.total)}</b></div></div>
        <div class="grid grid-2 mb">
          <button class="btn" id="cx-sup">${icon('plus')} Suprimento</button>
          <button class="btn" id="cx-san">${icon('minus')} Sangria</button>
        </div>
        <div class="grid grid-auto mb">
          <div class="card"><h3>Dinheiro</h3>
            <div class="kv"><span class="k">Troco inicial</span><span class="v">${money(r.inicial)}</span></div>
            <div class="kv"><span class="k">Entradas em dinheiro</span><span class="v green">+${money(r.entradasDin)}</span></div>
            <div class="kv"><span class="k">Suprimentos</span><span class="v green">+${money(r.suprimentos)}</span></div>
            <div class="kv"><span class="k">Sangrias</span><span class="v red">-${money(r.sangrias)}</span></div>
            <div class="kv"><span class="k">Despesas pagas em dinheiro</span><span class="v red">-${money(r.saidasDin)}</span></div>
            <div class="kv"><span class="k bold">Esperado</span><span class="v gold">${money(r.esperado)}</span></div></div>
          <div class="card"><h3>Por forma de pagamento</h3>${Object.entries(r.porForma).map(([k, v]) => `<div class="kv"><span class="k">${nomeForma(k)}</span><span class="v">${money(v)}</span></div>`).join('') || '<p class="small muted">Nenhum recebimento ainda.</p>'}</div>
        </div>
        ${(cx.movs || []).length ? `<div class="card mb"><h3>Movimentações</h3>${cx.movs.map(m => `<div class="kv"><span class="k">${fmtDateTime(m.data)} · ${m.tipo === 'sangria' ? 'Sangria' : 'Suprimento'} ${m.desc ? '— ' + esc(m.desc) : ''}</span><span class="v ${m.tipo === 'sangria' ? 'red' : 'green'}">${money(m.valor)}</span></div>`).join('')}</div>` : ''}
        <button class="btn primary block mb" id="cx-fechar">${icon('lock')} Fechar caixa</button>`;
    }
    html += `<div class="card mb"><label class="check" style="padding:0"><input type="checkbox" id="cx-exig" ${Store.s.exigirCaixa ? 'checked' : ''} ${Cloud.ehDono() ? '' : 'disabled'}> <span><b>Exigir caixa aberto</b> para receber pagamentos e vender</span></label></div>
      <div class="card pad-0"><div class="list-head"><b>Caixas anteriores</b></div>${hist.map(c => {
        const d = (c.valorContado ?? c.esperado) - c.esperado;
        return `<div class="item" style="cursor:default"><div class="row between"><div><b>${fmtDate(c.abertoEm)}</b><div class="xs muted">${fmtDateTime(c.abertoEm)} → ${fmtDateTime(c.fechadoEm)}</div></div>
          <div class="right"><div class="bold">${money(c.valorContado)}</div><div class="xs ${Math.abs(d) < 0.01 ? 'green' : 'red'}">${Math.abs(d) < 0.01 ? 'Conferido' : (d > 0 ? 'Sobra ' : 'Falta ') + money(Math.abs(d))}</div></div></div></div>`;
      }).join('') || '<div class="empty small">Nenhum caixa fechado.</div>'}</div>`;
    main.innerHTML = html;

    $('#cx-exig').onchange = e => { Store.s.exigirCaixa = e.target.checked; Store.save(); toast('Configuração salva'); };
    if (!cx) {
      $('#cx-abrir').onclick = () => {
        Store.db.caixas.push({ id: uid(), abertoEm: nowISO(), valorInicial: parseMoney($('#cx-ini').value), movs: [] });
        Store.log('Caixa aberto', money(parseMoney($('#cx-ini').value))); Store.save(); App.refresh(); toast('Caixa aberto');
      };
      return;
    }
    const mov = tipo => openModal({
      title: tipo === 'sangria' ? 'Sangria' : 'Suprimento', icon: tipo === 'sangria' ? 'minus' : 'plus', subtitle: tipo === 'sangria' ? 'Retirada de dinheiro da gaveta' : 'Entrada de dinheiro na gaveta',
      body: `${field('Valor (R$)', '<input class="input" id="mv-v" inputmode="decimal" placeholder="0,00">', { req: true })}${field('Motivo', '<input class="input" id="mv-d" placeholder="Ex: depósito no banco">', { opt: true })}`,
      foot: `<button class="btn" data-close>Cancelar</button><button class="btn primary" id="mv-ok">Confirmar</button>`,
      onMount: (el, m) => $('#mv-ok', el).onclick = () => {
        const v = parseMoney($('#mv-v', el).value); if (v <= 0) return toast('Informe o valor', true);
        cx.movs = cx.movs || []; cx.movs.push({ tipo, valor: v, desc: $('#mv-d', el).value.trim(), data: nowISO() });
        Store.log(tipo === 'sangria' ? 'Sangria' : 'Suprimento', money(v)); Store.save(); m.close(); App.refresh();
      },
    });
    $('#cx-sup').onclick = () => mov('suprimento');
    $('#cx-san').onclick = () => mov('sangria');
    $('#cx-fechar').onclick = () => {
      const r = this.calc(cx);
      openModal({
        title: 'Fechar caixa', icon: 'lock',
        body: `<div class="card center mb"><div class="small muted">Esperado na gaveta</div><div class="gold bold" style="font-size:28px">${money(r.esperado)}</div></div>
          ${field('Valor contado na gaveta (R$)', `<input class="input" id="fc-v" inputmode="decimal" value="${moneyInput(r.esperado)}">`)}<div id="fc-dif" class="small bold"></div>
          ${field('Observação', '<input class="input" id="fc-o">', { opt: true })}`,
        foot: `<button class="btn" data-close>Cancelar</button><button class="btn primary" id="fc-ok">${icon('lock')} Fechar</button>`,
        onMount: (el, m) => {
          const dif = () => { const d = parseMoney($('#fc-v', el).value) - r.esperado; $('#fc-dif', el).innerHTML = Math.abs(d) < .01 ? '<span class="green">Caixa conferido ✓</span>' : `<span class="red">${d > 0 ? 'Sobra' : 'Falta'} de ${money(Math.abs(d))}</span>`; };
          $('#fc-v', el).oninput = dif; dif();
          $('#fc-ok', el).onclick = () => {
            Object.assign(cx, { fechadoEm: nowISO(), esperado: r.esperado, valorContado: parseMoney($('#fc-v', el).value), obs: $('#fc-o', el).value.trim(), totalRecebido: r.total });
            Store.log('Caixa fechado', `${money(cx.valorContado)} (esperado ${money(r.esperado)})`); Store.save(); m.close(); App.refresh(); toast('Caixa fechado');
          };
        },
      });
    };
  },
};
