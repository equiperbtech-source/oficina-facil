/* Vitrine da oficina (plano Pro): escolher o que aparece na página pública, fotos e descrição. */
const PV_STATUS = { novo: ['Novo', 'gold'], separado: ['Separado', 'blue'], retirado: ['Retirado', 'green'], cancelado: ['Cancelado', ''] };
const VitrineAdmin = {
  filtro: 'todos', q: '', aba: 'produtos', filtroPed: 'abertos',
  link() { return Cloud.loja ? `${location.origin}/vitrine/${Cloud.loja.slug || Cloud.loja.id}` : null; },

  // Reduz a foto no celular (máx. 1200 px, JPEG) antes de enviar: carrega rápido e cabe no limite de 2 MB
  async reduzir(file) {
    const img = await new Promise((ok, ko) => { const i = new Image(); i.onload = () => ok(i); i.onerror = ko; i.src = URL.createObjectURL(file); });
    const esc = Math.min(1, 1200 / Math.max(img.width, img.height));
    const c = document.createElement('canvas'); c.width = Math.round(img.width * esc); c.height = Math.round(img.height * esc);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    URL.revokeObjectURL(img.src);
    return await new Promise(ok => c.toBlob(ok, 'image/jpeg', 0.85));
  },

  async enviarFoto(prod, file) {
    if (!Cloud.enabled || !Cloud.sb?.storage) throw new Error('Fotos só funcionam com a nuvem ligada');
    if (!/^image\/(png|jpe?g|webp)$/.test(file.type)) throw new Error('Use foto PNG, JPG ou WEBP');
    const blob = await this.reduzir(file);
    if (blob.size > 2 * 1024 * 1024) throw new Error('Foto muito grande mesmo depois de reduzir');
    const caminho = `${Cloud.loja.id}/vitrine/${prod.id}-${Date.now()}.jpg`;
    const st = Cloud.sb.storage.from('lojas-publico');
    const { error } = await st.upload(caminho, blob, { contentType: 'image/jpeg', upsert: false });
    if (error) throw new Error(/bucket|not found/i.test(error.message) ? 'Rode a migração da etapa 3 no Supabase (fotos)' : error.message);
    return st.getPublicUrl(caminho).data.publicUrl;
  },

  render(main) {
    const novos = Store.db.pedidos_vitrine.filter(p => !p.deleted && p.status === 'novo').length;
    const abas = `<div class="tabs mb" id="va-abas">${[['produtos', 'Produtos na vitrine'], ['pedidos', `Pedidos${novos ? ` <span class="pill gold xs" style="padding:1px 7px">${novos}</span>` : ''}`]].map(([k, l]) => `<button data-k="${k}" class="${this.aba === k ? 'on' : ''}">${l}</button>`).join('')}</div>`;
    if (this.aba === 'pedidos') {
      main.innerHTML = `${pageHead('tag', 'Vitrine', 'Pedidos que os clientes fizeram pelo carrinho da vitrine.')}${abas}${this.pedidosHTML()}`;
      this.ligarPedidos(); return;
    }
    const prods = Store.db.produtos.filter(p => !p.deleted);
    const lista = prods.filter(p => (this.filtro !== 'na' || p.vitrine) && matches(this.q, p.nome, p.codigo, p.categoria))
      .sort((a, b) => (b.vitrine ? 1 : 0) - (a.vitrine ? 1 : 0) || a.nome.localeCompare(b.nome));
    const na = prods.filter(p => p.vitrine).length;
    const link = this.link();
    main.innerHTML = `
      ${pageHead('tag', 'Vitrine', 'Escolha as peças e os acessórios que aparecem na página pública da oficina.')}
      ${abas}
      ${link ? `<div class="card mb"><div class="small muted mb">Link da vitrine (divulgue no Instagram e no WhatsApp):</div>
        <div class="input" style="display:flex;align-items:center;font-size:13px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis">${esc(link)}</div>
        <div class="grid grid-3 mt"><button class="btn sm" onclick="navigator.clipboard?.writeText('${esc(link)}');toast('Link copiado')">${icon('repeat', 'sm')} Copiar</button>
          <a class="btn sm" target="_blank" href="${esc(link)}">${icon('eye', 'sm')} Abrir</a>
          <a class="btn sm success" target="_blank" href="https://api.whatsapp.com/send?text=${encodeURIComponent(t('Confira as peças e acessórios disponíveis:') + ' ' + link)}">${icon('whatsapp', 'sm')}</a></div></div>`
        : `<div class="info-box">${icon('info')}<span>A vitrine online precisa da nuvem ligada.</span></div>`}
      <div class="row wrap between mb"><div class="tabs" id="va-f">${[['todos', 'Todos'], ['na', `Na vitrine (${na})`]].map(([k, l]) => `<button data-k="${k}" class="${this.filtro === k ? 'on' : ''}">${l}</button>`).join('')}</div></div>
      <div class="input-icon mb">${icon('search')}<input class="input" id="va-q" placeholder="Buscar..." value="${esc(this.q)}"></div>
      <div class="card pad-0">${lista.slice(0, 200).map(p => `<div class="cart-line" style="padding:12px 16px">
        <div style="width:52px;height:52px;border-radius:10px;background:var(--bg-2) center/cover no-repeat;${p.fotos?.[0] ? `background-image:url('${encodeURI(p.fotos[0])}')` : ''};display:flex;align-items:center;justify-content:center;flex-shrink:0">${p.fotos?.[0] ? '' : icon('phone', 'sm')}</div>
        <div class="grow" style="min-width:0"><b class="ellipsis" style="display:block">${esc(p.nome)}</b><div class="xs muted">${money(p.preco)} · ${p.qtd > 0 ? `${p.qtd} em estoque` : '<span class="red">sem estoque (aparece como vendido)</span>'}${(p.fotos || []).length ? ` · ${p.fotos.length} foto(s)` : ''}</div></div>
        <button class="btn sm" data-ed="${p.id}">${icon('edit', 'sm')}</button>
        <label class="check" style="padding:0;flex-shrink:0" title="Mostrar na vitrine"><input type="checkbox" data-vt="${p.id}" ${p.vitrine ? 'checked' : ''}></label></div>`).join('') || `<div class="empty">${icon('tag')}<div>Nada aqui.</div></div>`}</div>`;
    $$('#va-abas button').forEach(b => b.onclick = () => { this.aba = b.dataset.k; App.refresh(); });
    $$('#va-f button').forEach(b => b.onclick = () => { this.filtro = b.dataset.k; App.refresh(); });
    $('#va-q').oninput = e => { this.q = e.target.value; clearTimeout(this._t); this._t = setTimeout(() => { App.refresh(); const i = $('#va-q'); i?.focus(); i?.setSelectionRange(i.value.length, i.value.length); }, 300); };
    $$('[data-vt]').forEach(c => c.onchange = () => { const p = Store.produto(c.dataset.vt); p.vitrine = c.checked; Store.save(); toast(c.checked ? 'Aparece na vitrine' : 'Saiu da vitrine'); App.refresh(); });
    $$('[data-ed]').forEach(b => b.onclick = () => this.editar(b.dataset.ed));
  },

  editar(id) {
    const p = Store.produto(id); if (!p) return;
    p.fotos = p.fotos || [];
    const m = openModal({
      title: p.nome, icon: 'tag',
      body: `<label class="check mb"><input type="checkbox" id="ve-on" ${p.vitrine ? 'checked' : ''}> Mostrar na vitrine</label>
        ${field('Preço na vitrine', `<input class="input" inputmode="decimal" id="ve-preco" value="${moneyInput(p.preco)}">`)}
        ${field('Descrição', `<textarea class="input" id="ve-desc" maxlength="300" placeholder="Ex: Jogo de tapetes em borracha, encaixe perfeito. Garantia de 3 meses.">${esc(p.descricao || '')}</textarea>`, { opt: true })}
        <div class="lbl mb">Fotos (até 4)</div>
        <div id="ve-fotos" class="row wrap" style="gap:8px"></div>
        <p class="xs muted">As fotos ficam públicas na vitrine. A primeira é a capa.</p>`,
      foot: `<button class="btn" data-close>Cancelar</button><button class="btn primary" id="ve-ok">${icon('check')} Salvar</button>`,
    });
    const el = m.el;
    const fotos = [...p.fotos];
    const desenhar = () => {
      $('#ve-fotos', el).innerHTML = fotos.map((u, i) => `<div style="position:relative;width:76px;height:76px;border-radius:10px;background:var(--bg-2) center/cover no-repeat;background-image:url('${encodeURI(u)}')">
        <button class="icon-btn mini" data-rf="${i}" style="position:absolute;top:4px;right:4px;background:rgba(15,23,42,.7);color:#fff">${icon('x', 'sm')}</button></div>`).join('')
        + (fotos.length < 4 ? `<label class="btn" style="width:76px;height:76px;padding:0;justify-content:center">${icon('plus')}<input type="file" accept="image/png,image/jpeg,image/webp" id="ve-add" hidden></label>` : '');
      $$('[data-rf]', el).forEach(b => b.onclick = () => { fotos.splice(+b.dataset.rf, 1); desenhar(); });
      const add = $('#ve-add', el);
      if (add) add.onchange = async () => {
        const f = add.files[0]; if (!f) return;
        toast('Enviando foto...');
        try { fotos.push(await this.enviarFoto(p, f)); desenhar(); toast('Foto enviada'); } catch (e) { toast(e.message, true); }
      };
    };
    desenhar();
    $('#ve-ok', el).onclick = () => {
      Object.assign(p, { vitrine: $('#ve-on', el).checked, preco: parseMoney($('#ve-preco', el).value), descricao: $('#ve-desc', el).value.trim(), fotos });
      Store.save(); m.close(); App.refresh(); toast('Vitrine atualizada');
    };
  },
};

/* ---------- Pedidos da vitrine (carrinho do cliente, retirada na oficina) ---------- */
Object.assign(VitrineAdmin, {
  quando(d) { const x = new Date(d); return `${dayKey(x) === dayKey() ? 'Hoje' : dayKey(x) === dayKey(addDays(new Date(), 1)) ? 'Amanhã' : fmtDate(x)} às ${pad(x.getHours())}:${pad(x.getMinutes())}`; },
  pedidosHTML() {
    const todos = Store.db.pedidos_vitrine.filter(p => !p.deleted);
    const abertos = todos.filter(p => ['novo', 'separado'].includes(p.status)).sort((a, b) => String(a.retirada).localeCompare(String(b.retirada)));
    const fechados = todos.filter(p => !['novo', 'separado'].includes(p.status)).sort((a, b) => String(b.criadoEm).localeCompare(String(a.criadoEm))).slice(0, 60);
    const lista = this.filtroPed === 'abertos' ? abertos : fechados;
    return `<div class="tabs mb" id="vp-f">${[['abertos', `Para separar (${abertos.length})`], ['fechados', 'Retirados / cancelados']].map(([k, l]) => `<button data-k="${k}" class="${this.filtroPed === k ? 'on' : ''}">${l}</button>`).join('')}</div>
      <div class="card pad-0">${lista.map(p => { const [st, cor] = PV_STATUS[p.status] || [p.status, ''];
        const atrasado = ['novo', 'separado'].includes(p.status) && new Date(p.retirada) < new Date();
        return `<div class="item" style="cursor:default"><div class="row between" style="align-items:flex-start">
          <div class="grow" style="min-width:0"><b>#${p.numero} · ${esc(p.nome)}</b>
            <div class="small ${atrasado ? 'red' : 'gold'}">${icon('clock', 'sm')} Retirada: ${esc(this.quando(p.retirada))}${atrasado ? ' · passou do horário' : ''}</div>
            ${(p.itens || []).map(i => `<div class="small">${i.qtd}× ${esc(i.nome)} <span class="muted">· ${money(i.preco * i.qtd)}</span></div>`).join('')}
            ${p.obs ? `<div class="xs muted">“${esc(p.obs)}”</div>` : ''}
            <div class="bold mt" style="margin-top:4px">${money(p.total)}</div></div>
          <div class="col" style="gap:6px;align-items:flex-end"><span class="pill ${cor}">${st}</span>
            <a class="btn sm success" target="_blank" rel="noopener" href="${esc(waLink(p.telefone, `Olá ${p.nome.split(' ')[0]}! Aqui é da ${Store.s.loja}. Seu pedido #${p.numero} ${p.status === 'separado' ? 'já está separado e te esperando' : 'foi recebido'} para retirada ${this.quando(p.retirada).toLowerCase()}.`))}">${icon('whatsapp', 'sm')}</a>
            ${p.status === 'novo' ? `<button class="btn sm primary" data-pv="${p.id}" data-st="separado">Separado</button>` : ''}
            ${['novo', 'separado'].includes(p.status) ? `<button class="btn sm outline-gold" data-pv-ret="${p.id}">Retirado</button><button class="btn sm ghost" data-pv="${p.id}" data-st="cancelado">Cancelar</button>` : ''}
          </div></div></div>`; }).join('') || `<div class="empty">${icon('tag')}<div>${this.filtroPed === 'abertos' ? 'Nenhum pedido para separar.' : 'Nada aqui.'}</div></div>`}</div>`;
  },
  ligarPedidos() {
    $$('#va-abas button').forEach(b => b.onclick = () => { this.aba = b.dataset.k; App.refresh(); });
    $$('#vp-f button').forEach(b => b.onclick = () => { this.filtroPed = b.dataset.k; App.refresh(); });
    // abrir a aba de pedidos marca os novos como vistos (para não avisar de novo)
    let vistos = 0; Store.db.pedidos_vitrine.forEach(p => { if (!p.lido) { p.lido = true; vistos++; } }); if (vistos) Store.save();
    $$('[data-pv]').forEach(b => b.onclick = () => {
      const p = Store.db.pedidos_vitrine.find(x => x.id === b.dataset.pv); if (!p) return;
      p.status = b.dataset.st; p.atualizadoEm = nowISO(); Store.save(); App.refresh();
      toast(b.dataset.st === 'separado' ? `Pedido #${p.numero} separado` : `Pedido #${p.numero} cancelado`);
    });
    $$('[data-pv-ret]').forEach(b => b.onclick = () => this.retirar(b.dataset.pvRet));
  },
  // Retirada: registra a venda (baixa o estoque e entra no financeiro) e fecha o pedido
  retirar(id) {
    const p = Store.db.pedidos_vitrine.find(x => x.id === id); if (!p) return;
    openModal({
      title: `Retirada do pedido #${p.numero}`, icon: 'bag',
      body: `<p style="margin-top:0"><b>${esc(p.nome)}</b> · ${money(p.total)}</p>
        ${field('Forma de pagamento', `<select class="input" id="pr-forma">${selectOpts(FORMAS_PGTO, 'pix')}</select>`)}
        <label class="check"><input type="checkbox" id="pr-venda" checked> Registrar a venda (baixa o estoque e lança no financeiro)</label>`,
      foot: `<button class="btn" data-close>Cancelar</button><button class="btn primary" id="pr-ok">${icon('check')} Confirmar retirada</button>`,
      onMount: (el, m) => {
        $('#pr-ok', el).onclick = () => {
          if ($('#pr-venda', el).checked) {
            const itens = (p.itens || []).map(i => { const prod = Store.produto(i.id); return prod ? { ...VendasPage.itemDe(prod), preco: i.preco, qtd: i.qtd } : { avulso: true, id: uid(), nome: i.nome, preco: i.preco, custo: 0, qtd: i.qtd }; });
            const v = VendasPage.registrar({ itens, clienteNome: p.nome, forma: $('#pr-forma', el).value });
            p.vendaId = v?.id || null;
          }
          p.status = 'retirado'; p.retiradoEm = nowISO(); Store.save(); m.close(); App.refresh(); toast(`Pedido #${p.numero} retirado`);
        };
      },
    });
  },
  // Aviso no canto inferior direito: "(nome) fez um pedido"
  avisar(lista, som = true) {
    if (!App.logged() || !Cloud.temRecurso('vitrine') || !App.rotaVisivel('vitrine')) return;
    // cada pedido avisa uma vez só (chega pelo tempo real e também pela lista de não lidos)
    this.avisados = this.avisados || new Set();
    lista = (lista || []).filter(p => p?.id && !this.avisados.has(p.id)); if (!lista.length) return;
    lista.forEach(p => this.avisados.add(p.id));
    if (som && typeof Pedidos !== 'undefined') Pedidos.alerta();
    App.updateNav();
    if (App.route === 'vitrine' && this.aba === 'pedidos') App.refresh();
    let box = $('#pv-pops'); if (!box) { box = document.createElement('div'); box.id = 'pv-pops'; document.body.appendChild(box); }
    for (const p of lista.slice(-3)) {
      const el = document.createElement('div'); el.className = 'pv-pop';
      el.innerHTML = `<div class="row" style="align-items:flex-start;gap:10px"><div class="stat-icon"><div class="ic">${icon('bag')}</div></div>
        <div class="grow" style="min-width:0"><b style="display:block;line-height:1.3">${esc(p.nome)} fez um pedido</b>
          <div class="small muted">${(p.itens || []).reduce((s, i) => s + i.qtd, 0)} item(ns) · ${money(p.total)}</div>
          <div class="small gold">Retirada: ${esc(this.quando(p.retirada))}</div></div>
        <button class="icon-btn" data-x>${icon('x', 'sm')}</button></div>
        <button class="btn sm primary block mt" data-ver>Separar o pedido</button>`;
      el.querySelector('[data-x]').onclick = () => el.remove();
      el.querySelector('[data-ver]').onclick = () => { el.remove(); this.aba = 'pedidos'; this.filtroPed = 'abertos'; App.go('vitrine'); };
      box.appendChild(el);
    }
  },
});
Pages.vitrine = VitrineAdmin;
