/* Aparelhos: estoque de celulares à venda (seminovos e novos),
   com edição rápida, venda com troca e compra de aparelho de cliente */
const STATUS_AP = { disponivel: ['Disponível', 'green'], reservado: ['Reservado', 'orange'], revisao: ['Em revisão', 'blue'] };
const CONDICOES = ['Excelente', 'Muito bom', 'Bom', 'Com marcas de uso'];

const AparelhosPage = {
  st: { filtro: 'estoque', q: '' },

  celulares() { return Store.db.produtos.filter(p => !p.deleted && ehCelular(p)); },
  diasParado(p) { return daysBetween(p.entradaEm || p.criadoEm || nowISO(), new Date()); },

  render(main) {
    const est = this.celulares().filter(p => p.qtd > 0);
    const un = est.reduce((s, p) => s + p.qtd, 0);
    const custo = est.reduce((s, p) => s + (p.custo || 0) * p.qtd, 0);
    const venda = est.reduce((s, p) => s + (p.preco || 0) * p.qtd, 0);
    const parados = est.filter(p => this.diasParado(p) >= 30).length;
    const mes = monthKey();
    const vendidosMes = Store.db.vendas.filter(v => !v.cancelada && monthKey(v.data) === mes).flatMap(v => v.itens.filter(i => i.aparelho || i.seminovo)).reduce((s, i) => s + i.qtd, 0);
    main.innerHTML = `
      ${pageHead('devices', 'Aparelhos', 'Celulares seminovos e novos em estoque: preços, status, venda com troca e compra de aparelhos.')}
      <div class="grid grid-2 mb">
        <button class="btn primary" onclick="AparelhosPage.vender()">${icon('dollar')} Vender / troca</button>
        <button class="btn outline-gold" onclick="AparelhosPage.comprar()">${icon('download')} Comprar aparelho</button>
        <button class="btn" style="grid-column:1/-1" onclick="EstoquePage.editar('produto', null, { tipoProduto: 'seminovo' })">${icon('plus')} Cadastrar aparelho no estoque</button>
      </div>
      <div class="grid grid-2 mb">
        <div class="stat"><div class="label">Em estoque</div><div class="value">${un}</div><div class="sub">${est.filter(p => (p.statusAparelho || 'disponivel') === 'disponivel').length} disponíveis · ${vendidosMes} vendido(s) no mês</div></div>
        <div class="stat"><div class="label">Parados 30+ dias</div><div class="value ${parados ? 'orange' : ''}">${parados}</div><div class="sub">considere baixar o preço</div></div>
      </div>
      <div class="hero mb" style="padding:18px">
        <div class="row between wrap">
          <div><div class="small muted bold" style="letter-spacing:.12em">INVESTIDO</div><div style="font-size:20px;font-weight:800">${money(custo)}</div></div>
          <div><div class="small muted bold" style="letter-spacing:.12em">VALE SE VENDER TUDO</div><div class="gold" style="font-size:20px;font-weight:800">${money(venda)}</div></div>
          <div><div class="small muted bold" style="letter-spacing:.12em">LUCRO PROJETADO</div><div class="green" style="font-size:20px;font-weight:800">${money(venda - custo)}</div></div>
        </div>
      </div>
      <div class="card mb" style="padding:12px">
        <div class="tabs" id="ap-f">${[['estoque', 'Em estoque'], ['disponivel', 'Disponíveis'], ['reservado', 'Reservados'], ['revisao', 'Em revisão'], ['seminovo', 'Seminovos'], ['novo', 'Novos'], ['vendidos', 'Vendidos']].map(([k, l]) => `<button data-k="${k}" class="${this.st.filtro === k ? 'on' : ''}">${l}</button>`).join('')}</div>
        <div class="toolbar"><div class="input-icon">${icon('search')}<input class="input" id="ap-q" placeholder="Buscar modelo, IMEI, cor..." value="${esc(this.st.q)}"></div></div>
      </div>
      <div id="ap-list"></div>`;
    $$('#ap-f button').forEach(b => b.onclick = () => { this.st.filtro = b.dataset.k; $$('#ap-f button').forEach(x => x.classList.toggle('on', x === b)); this.lista(); });
    $('#ap-q').oninput = e => { this.st.q = e.target.value; this.lista(); };
    this.lista();
  },

  lista() {
    const f = this.st.filtro;
    let l = this.celulares();
    if (f === 'vendidos') l = l.filter(p => p.qtd <= 0);
    else {
      l = l.filter(p => p.qtd > 0);
      if (STATUS_AP[f]) l = l.filter(p => (p.statusAparelho || 'disponivel') === f);
      if (f === 'seminovo' || f === 'novo') l = l.filter(p => tipoProduto(p) === f);
    }
    l = l.filter(p => matches(this.st.q, p.nome, p.imei, p.cor, p.armazenamento, p.condicao))
      .sort((a, b) => f === 'vendidos' ? String(b.vendidoEm || '').localeCompare(String(a.vendidoEm || '')) : this.diasParado(b) - this.diasParado(a));
    $('#ap-list').innerHTML = l.map(p => this.card(p)).join('') || `<div class="card empty">${icon('phone')}<div>${f === 'vendidos' ? 'Nenhum aparelho vendido.' : 'Nenhum aparelho aqui.'}</div>
      ${f !== 'vendidos' ? `<button class="btn primary mt" onclick="EstoquePage.editar('produto', null, { tipoProduto: 'seminovo' })">${icon('plus')} Cadastrar aparelho</button>` : ''}</div>`;
  },

  card(p) {
    const st = p.statusAparelho || 'disponivel';
    const [sl, sc] = STATUS_AP[st];
    const dias = this.diasParado(p);
    const lucro = (p.preco || 0) - (p.custo || 0);
    const vendido = p.qtd <= 0;
    return `<div class="card mb" style="padding:14px 16px;${vendido ? 'opacity:.65' : ''}">
      <div class="row between" style="align-items:flex-start">
        <div class="grow" style="min-width:0">
          <div class="row wrap" style="gap:6px;margin-bottom:6px">${p.seminovo ? '<span class="pill gold xs">Seminovo</span>' : '<span class="pill green xs">Novo</span>'}
            ${vendido ? '<span class="pill xs">Vendido</span>' : `<button class="pill ${sc} xs" style="cursor:pointer" onclick="AparelhosPage.menuStatus('${p.id}', this, event)">${sl} ${icon('chevDown', 'sm')}</button>`}
            ${p.origem === 'troca' ? '<span class="pill purple xs">Veio na troca</span>' : ''}
            ${!vendido && dias >= 30 ? `<span class="pill orange xs">${dias} dias parado</span>` : ''}</div>
          <b style="font-size:17px">${esc(p.nome)}</b>
          <div class="small muted" style="margin-top:2px">${[p.armazenamento, p.cor, p.bateria && '🔋 ' + p.bateria, p.condicao].filter(Boolean).map(esc).join(' · ') || '—'}</div>
          ${p.imei ? `<div class="xs muted" style="font-family:ui-monospace,monospace">IMEI ${esc(p.imei)}</div>` : ''}
        </div>
        <div class="right" style="cursor:pointer" onclick="AparelhosPage.preco('${p.id}')" title="Alterar preço">
          <div class="gold bold" style="font-size:20px">${money(p.preco)}</div>
          <div class="xs muted">custo ${money(p.custo)}</div>
          <div class="xs ${lucro >= 0 ? 'green' : 'red'}">lucro ${money(lucro)}</div>
        </div>
      </div>
      <div class="row wrap mt" style="gap:8px">
        ${vendido ? '' : `<button class="btn sm primary" onclick="AparelhosPage.vender('${p.id}')">${icon('dollar', 'sm')} Vender</button>`}
        <button class="btn sm" onclick="AparelhosPage.preco('${p.id}')">${icon('tag', 'sm')} Preço</button>
        <button class="btn sm" onclick="EstoquePage.editar('produto','${p.id}')">${icon('edit', 'sm')} Editar</button>
        ${!vendido && p.preco ? `<a class="btn sm success" target="_blank" href="https://wa.me/?text=${encodeURIComponent(this.anuncio(p))}">${icon('whatsapp', 'sm')} Anunciar</a>` : ''}
      </div>
    </div>`;
  },

  anuncio(p) {
    return `📱 *${p.nome}*${p.seminovo ? ' (seminovo)' : ' (novo)'}\n${[p.armazenamento, p.cor, p.bateria && 'bateria ' + p.bateria, p.condicao].filter(Boolean).join(' · ')}\n\n💰 *${money(p.preco)}*\n🛡️ Garantia de ${p.seminovo ? '6 meses' : (p.garantiaDias >= 365 ? Math.round(p.garantiaDias / 365) + ' ano' : p.garantiaDias + ' dias')}\n\n${Store.s.loja}${Store.s.telefone ? ' · ' + Store.s.telefone : ''}`;
  },

  menuStatus(id, el, ev) {
    ev && ev.stopPropagation();
    const p = Store.produto(id);
    dropdown(el, Object.entries(STATUS_AP).map(([k, [l]]) => ({ k, label: l, on: (p.statusAparelho || 'disponivel') === k })), it => {
      p.statusAparelho = it.k; Store.save(); this.lista(); toast(`${p.nome}: ${STATUS_AP[it.k][0]}`);
    });
  },

  preco(id) {
    const p = Store.produto(id);
    openModal({
      title: 'Preço e custo', icon: 'tag', subtitle: p.nome,
      body: `<div class="form-row">${field('Preço de venda', `<input class="input" id="pr-v" inputmode="decimal" value="${moneyInput(p.preco)}">`)}${field('Custo', `<input class="input" id="pr-c" inputmode="decimal" value="${moneyInput(p.custo)}">`)}</div>
        <div class="gold small bold" id="pr-l"></div>`,
      foot: `<button class="btn" data-close>Cancelar</button><button class="btn primary" id="pr-ok">${icon('check')} Salvar</button>`,
      onMount: (el, m) => {
        const upd = () => { const v = parseMoney($('#pr-v', el).value), c = parseMoney($('#pr-c', el).value); $('#pr-l', el).textContent = `Lucro: ${money(v - c)}${v ? ` (${Math.round((v - c) / v * 100)}%)` : ''}`; };
        $('#pr-v', el).oninput = upd; $('#pr-c', el).oninput = upd; upd(); $('#pr-v', el).select();
        $('#pr-ok', el).onclick = () => { p.preco = parseMoney($('#pr-v', el).value); p.custo = parseMoney($('#pr-c', el).value); Store.save(); m.close(); App.refresh(); toast('Preço atualizado'); };
      },
    });
  },

  // Campos do aparelho do cliente (troca ou compra)
  camposAparelho(prefixo) {
    return `
      <div class="form-row">${field('Modelo', `<input class="input" id="${prefixo}-mod" placeholder="Ex: iPhone 11 64GB">`, { req: true })}${field('IMEI', `<input class="input" id="${prefixo}-imei" style="font-family:ui-monospace,monospace">`, { opt: true })}</div>
      <div class="form-row">${field('Armazenamento', `<input class="input" id="${prefixo}-arm" placeholder="64 GB">`, { opt: true })}${field('Cor', `<input class="input" id="${prefixo}-cor">`, { opt: true })}</div>
      <div class="form-row">${field('Saúde da bateria', `<input class="input" id="${prefixo}-bat" placeholder="Ex: 85%">`, { opt: true })}${field('Condição', `<select class="input" id="${prefixo}-cond">${selectOpts(CONDICOES, 'Bom')}</select>`)}</div>`;
  },
  lerAparelho(el, prefixo) {
    const v = s => $(`#${prefixo}-${s}`, el)?.value.trim() || '';
    return { nome: v('mod'), imei: v('imei'), armazenamento: v('arm'), cor: v('cor'), bateria: v('bat'), condicao: v('cond') };
  },
  // Coloca no estoque o aparelho recebido (troca ou compra), em revisão
  entrarNoEstoque(a, custo, origem, ref) {
    const p = { id: uid(), nome: a.nome, imei: a.imei, armazenamento: a.armazenamento, cor: a.cor, bateria: a.bateria, condicao: a.condicao,
      tipoProduto: 'seminovo', seminovo: true, categoria: 'Celulares seminovos', custo, preco: a.preco || 0, qtd: 0, minimo: 0,
      garantiaDias: GARANTIA_SEMINOVO_DIAS, statusAparelho: 'revisao', origem, origemRef: ref, criadoEm: nowISO(), entradaEm: nowISO() };
    Store.db.produtos.push(p);
    Store.movimentar('produto', p, 1, origem === 'troca' ? `Recebido na troca (${ref})` : 'Compra de aparelho');
    return p;
  },
  clienteCampos(pre) {
    return `${field('Cliente', `<select class="input" id="vx-cli"><option value="">— Novo cliente —</option>${Store.clientesAtivos().map(c => `<option value="${c.id}" ${c.id === pre ? 'selected' : ''}>${esc(c.nome)}${c.telefone ? ' · ' + esc(fmtPhone(c.telefone)) : ''}</option>`).join('')}</select>`)}
      <div class="form-row" id="vx-novo">${field('Nome', '<input class="input" id="vx-nome" placeholder="Nome completo">', { req: true })}${field('WhatsApp', '<input class="input" id="vx-tel" type="tel" placeholder="(48) 99999-9999">')}</div>`;
  },
  lerCliente(el) {
    const id = $('#vx-cli', el).value; if (id) return id;
    const nome = $('#vx-nome', el).value.trim(); if (!nome) return null;
    const tel = onlyDigits($('#vx-tel', el).value);
    const ex = tel && Store.clientesAtivos().find(c => onlyDigits(c.telefone) === tel);
    return ex ? ex.id : Store.saveCliente({ nome, telefone: tel, docTipo: 'CPF', aparelhos: [] }).id;
  },

  /* ---------- Venda (com ou sem troca) ---------- */
  vender(id) {
    const disp = this.celulares().filter(p => p.qtd > 0);
    if (!disp.length) return toast('Nenhum aparelho em estoque', true);
    let p = id ? Store.produto(id) : disp[0];
    openModal({
      title: 'Vender aparelho', icon: 'dollar', wide: true,
      body: `
        <div class="section-title">Aparelho vendido</div>
        ${field('Aparelho', `<select class="input" id="vx-ap">${disp.map(x => `<option value="${x.id}" ${x.id === p.id ? 'selected' : ''}>${esc(x.nome)}${x.imei ? ' · ' + esc(x.imei.slice(-5)) : ''} · ${money(x.preco)}</option>`).join('')}</select>`)}
        <div class="form-row">${field('Preço de venda', `<input class="input" id="vx-preco" inputmode="decimal">`)}${field('Desconto', '<input class="input" id="vx-desc" inputmode="decimal" placeholder="0,00">')}</div>
        ${field('IMEI do aparelho vendido', `<input class="input" id="vx-imei" style="font-family:ui-monospace,monospace">`, { opt: true })}
        <div class="section-title">Cliente</div>
        ${this.clienteCampos()}
        <label class="check card mb" style="padding:12px 14px"><input type="checkbox" id="vx-tem-troca"> <span><b>Cliente vai dar um aparelho na troca</b><br><span class="xs muted">O valor da troca abate do preço e o aparelho entra no estoque (em revisão).</span></span></label>
        <div id="vx-troca" class="hidden card mb" style="background:var(--bg-2)">
          <div class="section-title">Aparelho recebido na troca</div>
          ${this.camposAparelho('tr')}
          <div class="form-row">${field('Valor da troca', '<input class="input" id="tr-valor" inputmode="decimal" placeholder="0,00">', { req: true })}${field('Preço p/ revenda', '<input class="input" id="tr-preco" inputmode="decimal" placeholder="opcional">', { opt: true })}</div>
        </div>
        ${field('Forma de pagamento (valor restante)', `<select class="input" id="vx-forma">${selectOpts(FORMAS_PGTO, 'pix')}</select>`)}
        <div class="card" style="background:var(--gold-soft);border-color:rgba(var(--gold-rgb), .4)" id="vx-resumo"></div>`,
      foot: `<button class="btn" data-close>Cancelar</button><button class="btn primary" id="vx-ok">${icon('check')} Confirmar venda</button>`,
      onMount: (el, m) => {
        const setAp = () => { p = Store.produto($('#vx-ap', el).value); $('#vx-preco', el).value = moneyInput(p.preco); $('#vx-imei', el).value = p.imei || ''; calc(); };
        const calc = () => {
          const preco = parseMoney($('#vx-preco', el).value), desc = parseMoney($('#vx-desc', el).value);
          const troca = $('#vx-tem-troca', el).checked ? parseMoney($('#tr-valor', el).value) : 0;
          const pagar = preco - desc - troca;
          $('#vx-resumo', el).innerHTML = `<div class="kv"><span class="k">Preço</span><span class="v">${money(preco)}</span></div>
            ${desc ? `<div class="kv"><span class="k">Desconto</span><span class="v red">-${money(desc)}</span></div>` : ''}
            ${troca ? `<div class="kv"><span class="k">Aparelho na troca</span><span class="v red">-${money(troca)}</span></div>` : ''}
            <div class="kv"><span class="k bold">${pagar >= 0 ? 'Cliente paga' : 'Loja devolve ao cliente'}</span><span class="v gold" style="font-size:22px">${money(Math.abs(pagar))}</span></div>
            <div class="xs muted">Lucro desta venda: ${money(preco - desc - (p.custo || 0))}</div>
            ${p.custo ? (() => { const lu = preco - desc - p.custo, mt = Metas.lucroMeta(); return `<div class="xs ${lu >= mt ? 'green' : 'red'}">${lu >= mt ? '✓ Bate a meta de lucro' : `Abaixo da meta de lucro (${money(mt)}): faltam ${money(mt - lu)}`}</div>`; })() : ''}`;
          return { preco, desc, troca, pagar };
        };
        $('#vx-ap', el).onchange = setAp;
        $('#vx-cli', el).onchange = () => $('#vx-novo', el).classList.toggle('hidden', !!$('#vx-cli', el).value);
        $('#vx-tem-troca', el).onchange = e => { $('#vx-troca', el).classList.toggle('hidden', !e.target.checked); calc(); };
        $$('#vx-preco, #vx-desc, #tr-valor', el).forEach(i => i.oninput = calc);
        setAp();
        $('#vx-ok', el).onclick = () => {
          if (Store.s.exigirCaixa && !Store.caixaAberto()) return toast('Abra o caixa antes de vender', true);
          const { preco, desc, troca, pagar } = calc();
          if (!preco) return toast('Informe o preço de venda', true);
          const temTroca = $('#vx-tem-troca', el).checked;
          const tr = temTroca ? { ...this.lerAparelho(el, 'tr'), preco: parseMoney($('#tr-preco', el).value) } : null;
          if (temTroca && (!tr.nome || !troca)) return toast('Informe o modelo e o valor do aparelho da troca', true);
          const clienteId = this.lerCliente(el);
          if (!clienteId) return toast('Informe o cliente', true);
          const forma = $('#vx-forma', el).value;
          const item = { id: p.id, nome: p.nome, preco, custo: p.custo || 0, qtd: 1, seminovo: !!p.seminovo, aparelho: true, imei: $('#vx-imei', el).value.trim(), cor: p.cor || '', garantiaDias: p.seminovo ? GARANTIA_SEMINOVO_DIAS : (p.garantiaDias ?? 365) };
          const v = VendasPage.registrar({ itens: [item], clienteId, desconto: desc, forma, troca: temTroca ? { ...tr, valor: troca } : null });
          m.close(); App.refresh();
          VendasPage.recibo(v);
        };
      },
    });
  },

  /* ---------- Compra de aparelho de cliente (sem venda) ---------- */
  comprar() {
    openModal({
      title: 'Comprar aparelho', icon: 'download', subtitle: 'Aparelho comprado de cliente entra no estoque em revisão',
      body: `${this.camposAparelho('cp')}
        <div class="form-row">${field('Valor pago', '<input class="input" id="cp-valor" inputmode="decimal" placeholder="0,00">', { req: true })}${field('Preço p/ revenda', '<input class="input" id="cp-preco" inputmode="decimal" placeholder="opcional">', { opt: true })}</div>
        <div class="section-title">Vendedor (cliente)</div>
        ${this.clienteCampos()}
        ${field('Forma de pagamento', `<select class="input" id="cp-forma">${selectOpts(FORMAS_PGTO, 'pix')}</select>`)}
        <label class="check"><input type="checkbox" id="cp-desp" checked> Lançar a compra como saída no financeiro</label>`,
      foot: `<button class="btn" data-close>Cancelar</button><button class="btn primary" id="cp-ok">${icon('check')} Registrar compra</button>`,
      onMount: (el, m) => {
        $('#vx-cli', el).onchange = () => $('#vx-novo', el).classList.toggle('hidden', !!$('#vx-cli', el).value);
        $('#cp-ok', el).onclick = () => {
          const a = { ...this.lerAparelho(el, 'cp'), preco: parseMoney($('#cp-preco', el).value) };
          const valor = parseMoney($('#cp-valor', el).value);
          if (!a.nome || !valor) return toast('Informe o modelo e o valor pago', true);
          const clienteId = this.lerCliente(el);
          const c = clienteId && Store.cliente(clienteId);
          const p = this.entrarNoEstoque(a, valor, 'compra', c ? c.nome : '');
          if ($('#cp-desp', el).checked) Store.addDespesa({ desc: `Compra de aparelho: ${a.nome}${c ? ' (' + c.nome + ')' : ''}`, valor, forma: $('#cp-forma', el).value, categoria: 'Compra de aparelhos', estoque: true });
          Store.log('Compra de aparelho', `${a.nome} ${money(valor)}`);
          Store.save(); m.close(); App.refresh(); toast(`${p.nome} entrou no estoque (em revisão)`);
        };
      },
    });
  },
};
Pages.aparelhos = AparelhosPage;
