/* Cotação e pedido de peças pelo WhatsApp: até 3 fornecedores de uma vez.
   A mensagem já leva o veículo: "Olá! Qual o valor da pastilha de freio dianteira do Onix 1.0 2019?". */
const Cotacao = {
  MAX: 3,
  // busca de peça por palavras soltas, em qualquer ordem ("pastilha onix" acha "Pastilha de freio Onix 2019")
  achaPeca(q, p) { const txt = norm([p.nome, p.codigo, p.aplicacao, p.compat, p.categoria].filter(Boolean).join(' ')); return norm(q).split(/\s+/).filter(Boolean).every(w => txt.includes(w)); },
  fornecedores() { return (Store.s.fornecedoresPeca || []).filter(f => f && f.nome && onlyDigits(f.whats)); },
  // itens: [{ nome, qtd }]
  mensagem(tipo, itens) {
    if (tipo === 'pedido') return itens.length === 1 ? t('Olá, quero pedir {q}x {peca}.', { q: itens[0].qtd || 1, peca: itens[0].nome })
      : t('Olá, quero pedir:') + '\n' + itens.map(i => `• ${i.qtd || 1}x ${i.nome}`).join('\n');
    return itens.length === 1 ? t('Olá! Qual o valor da {peca}?', { peca: (itens[0].qtd > 1 ? itens[0].qtd + 'x ' : '') + itens[0].nome })
      : t('Olá, qual valor das peças:') + '\n' + itens.map(i => `• ${i.qtd > 1 ? i.qtd + 'x ' : ''}${i.nome}`).join('\n');
  },

  // tipo: 'preco' / 'cotacao' (perguntar o preço) | 'pedido'; ctx: { veiculo, osNumero }
  // Escreve só a peça ("tela sem aro"); as cadastradas aparecem como sugestão enquanto digita.
  abrir(tipo, ctx = {}) {
    const forn = this.fornecedores();
    if (!forn.length) {
      toast(t('Cadastre até 3 fornecedores em Configurações → Fornecedores de peças'), true);
      if (Cloud.ehDono()) { closeAllModals(); App.go('config'); setTimeout(() => Pages.config.abrirTopico?.('cf-forn'), 300); }
      return;
    }
    const pecas = Store.db.pecas.filter(p => !p.deleted).sort((a, b) => a.nome.localeCompare(b.nome));
    const pedido = tipo === 'pedido';
    const mod = ctx.veiculo ? Veiculo.nome(ctx.veiculo) : String(ctx.modelo || '').trim();
    const m = openModal({
      title: pedido ? 'Pedir peça ao fornecedor' : 'Cotar preço da peça', icon: 'truck',
      subtitle: [mod, ctx.osNumero ? `OS #${ctx.osNumero}` : ''].filter(Boolean).join(' · '),
      body: `${field('Peça', '<input class="input" id="ct-livre" autocomplete="off" placeholder="Ex: pastilha de freio dianteira">')}
        <div id="ct-list"></div>
        ${pedido ? field('Quantidade', '<input class="input" id="ct-qtd" type="number" min="1" value="1" style="max-width:120px">') : ''}
        <div class="lbl mt mb">${t('Mensagem')}</div>
        <div class="card" id="ct-msg" style="background:var(--bg-2);font-size:14px" data-no-i18n></div>
        <div class="section-title mt">${icon('whatsapp', 'sm')} ${pedido ? 'Pedir para' : 'Perguntar para'}</div>
        <div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px">${forn.map((f, i) => `<button type="button" class="btn success" data-ct="${i}">${icon('whatsapp', 'sm')} <span data-no-i18n>${esc(f.nome)}</span></button>`).join('')}</div>`,
      foot: `<button class="btn" data-close>Fechar</button>`,
    });
    const el = m.el, inp = $('#ct-livre', el);
    // nome final: a peça + o veículo, se o nome ainda não tiver o modelo ("pastilha de freio" → "pastilha de freio do Onix 1.0 2019")
    const nomeFinal = () => {
      const nome = inp.value.trim(); if (!nome) return '';
      const palavrasAp = norm(mod).split(/\s+/).filter(Boolean), chave = palavrasAp.filter(w => /\d/.test(w));
      return palavrasAp.length && !(chave.length ? chave : palavrasAp).every(w => norm(nome).split(/[^a-z0-9]+/).includes(w)) ? t('{peca} do {ap}', { peca: nome, ap: mod }) : nome;
    };
    const qtd = () => pedido ? Math.max(1, parseInt($('#ct-qtd', el).value) || 1) : 1;
    const previa = () => { const n = nomeFinal(); $('#ct-msg', el).textContent = n ? this.mensagem(pedido ? 'pedido' : 'preco', [{ nome: n, qtd: qtd() }]) : t('Escreva a peça acima.'); };
    const sugerir = () => {
      const v = inp.value.trim(), box = $('#ct-list', el);
      const r = v.length >= 2 ? pecas.filter(p => this.achaPeca(v, p) && norm(p.nome) !== norm(v)).slice(0, 4) : [];
      box.innerHTML = r.length ? `<div class="xs muted mb">${t('Cadastradas:')}</div><div class="row wrap" style="gap:6px">${r.map(p => `<button type="button" class="btn sm" data-sp="${p.id}">${esc(p.nome)}</button>`).join('')}</div>` : '';
      $$('[data-sp]', box).forEach(b => b.onclick = () => { inp.value = Store.peca(b.dataset.sp).nome; sugerir(); previa(); });
    };
    inp.oninput = () => { sugerir(); previa(); };
    const q = $('#ct-qtd', el); if (q) q.oninput = previa;
    previa(); setTimeout(() => inp.focus(), 50);
    $$('[data-ct]', el).forEach(b => b.onclick = () => {
      const nome = nomeFinal();
      if (!nome) { inp.focus(); return toast(t('Escreva a peça'), true); }
      const f = forn[+b.dataset.ct];
      window.open(waLink(f.whats, this.mensagem(pedido ? 'pedido' : 'preco', [{ nome, qtd: qtd() }])), '_blank');
      Store.log(pedido ? 'Pedido de peça' : 'Cotação de peça', `${nome} · ${f.nome}`); Store.save();
    });
  },

  // Configurações: até 3 fornecedores
  cardHTML() {
    const fs = Store.s.fornecedoresPeca || [];
    return `<div class="card mb" id="cf-forn">
      <h3>${icon('truck', 'sm')} Fornecedores de <span class="gold">peças</span></h3>
      <p class="small muted" style="margin-top:0">Até 3 fornecedores. No orçamento e na OS aparece "Cotar peça" (pergunta o preço pelo WhatsApp, já com o veículo).</p>
      <form id="cf-forn-f">${[0, 1, 2].map(i => `<div class="form-row">${field(`${t('Fornecedor')} ${i + 1}`, `<input class="input" name="nome${i}" placeholder="${t('Nome')}" value="${esc(fs[i]?.nome || '')}">`, { opt: i > 0 })}
        ${field('WhatsApp', `<input class="input" name="whats${i}" type="tel" placeholder="(48) 99999-9999" value="${esc(fs[i]?.whats || '')}">`, { opt: i > 0 })}</div>`).join('')}
        <button class="btn primary block">${icon('check')} Salvar fornecedores</button></form>
    </div>`;
  },
  cardInit() {
    const f = $('#cf-forn-f'); if (!f) return;
    f.onsubmit = e => {
      e.preventDefault();
      const v = readForm(f), out = [];
      for (let i = 0; i < this.MAX; i++) {
        const nome = (v['nome' + i] || '').trim(), whats = (v['whats' + i] || '').trim();
        if (!nome && !whats) continue;
        if (!nome || onlyDigits(whats).length < 8) return toast(t('Fornecedor {n}: preencha o nome e um WhatsApp válido', { n: i + 1 }), true);
        out.push({ nome, whats });
      }
      Store.s.fornecedoresPeca = out; Store.save(); toast(t('Fornecedores salvos'));
    };
  },
};

/* Aba "Pedido fornecedor": monta uma lista de peças e manda para cotar ou pedir pelo WhatsApp.
   A lista fica guardada neste dispositivo até ser enviada ou limpa. */
Pages.fornecedor = {
  tipo: 'preco',
  chave() { return 'oficina_pedido_forn_' + (Cloud.loja?.id || 'local'); },
  lista() { try { return JSON.parse(localStorage.getItem(this.chave()) || '[]'); } catch { return []; } },
  guardar(l) { try { localStorage.setItem(this.chave(), JSON.stringify(l)); } catch {} },
  add(item) {
    const l = this.lista(), ex = l.find(i => (item.pecaId && i.pecaId === item.pecaId) || (!item.pecaId && norm(i.nome) === norm(item.nome)));
    if (ex) ex.qtd = (ex.qtd || 1) + (item.qtd || 1); else l.push({ pecaId: item.pecaId || null, nome: item.nome, qtd: item.qtd || 1 });
    this.guardar(l); App.refresh();
  },
  render(main) {
    const forn = Cotacao.fornecedores(), l = this.lista(), pedido = this.tipo === 'pedido';
    const baixo = Store.db.pecas.filter(p => !p.deleted && (p.minimo || 0) > 0 && (p.qtd || 0) <= p.minimo);
    main.innerHTML = `${pageHead('truck', 'Pedido fornecedor', 'Monte a lista de peças e mande para cotar ou pedir pelo WhatsApp.')}
      ${forn.length ? '' : `<div class="aviso-plano orange mb">${icon('alert', 'sm')}<span class="grow">${t('Cadastre até 3 fornecedores (nome e WhatsApp) para enviar.')}</span>
        ${Cloud.ehDono() ? `<button class="btn sm" id="pf-cfg">${t('Cadastrar')}</button>` : ''}</div>`}
      <div class="card mb">
        <div class="section-title" style="margin-top:0">${icon('plus', 'sm')} Adicionar peça</div>
        ${inputIcon('search', 'id="pf-q" autocomplete="off" placeholder="Buscar peça cadastrada..."')}
        <div id="pf-res" class="mt"></div>
        <div class="row mt" style="gap:8px"><input class="input grow" id="pf-livre" placeholder="${esc(t('Ou escreva a peça'))}"><input class="input" id="pf-qtd" type="number" min="1" value="1" style="width:76px;text-align:center">
          <button class="btn outline-gold" id="pf-add">${icon('plus')}</button></div>
        ${baixo.length ? `<button class="btn sm block mt" id="pf-baixo">${icon('alert', 'sm')} ${t('Adicionar peças com estoque baixo ({n})', { n: baixo.length })}</button>` : ''}
      </div>
      <div class="card mb">
        <div class="row between"><div class="section-title" style="margin:0">${icon('box', 'sm')} Lista <span class="muted">(${l.length})</span></div>
          ${l.length ? `<button class="btn sm ghost" id="pf-limpar">${icon('trash', 'sm')} Limpar</button>` : ''}</div>
        <div class="mt">${l.map((i, k) => `<div class="cart-line"><div class="grow" style="min-width:0"><b data-no-i18n>${esc(i.nome)}</b></div>
          <div class="qty"><button data-d="-1" data-k="${k}">−</button><span>${i.qtd || 1}</span><button data-d="1" data-k="${k}">+</button></div>
          <button class="icon-btn" data-rm="${k}" title="Remover">${icon('trash', 'sm')}</button></div>`).join('') || `<p class="small muted" style="margin:0">${t('Nenhuma peça na lista ainda.')}</p>`}</div>
      </div>
      ${l.length ? `<div class="card mb">
        <div class="tabs mb">${[['preco', 'Cotar preço'], ['pedido', 'Pedir envio']].map(([k, n]) => `<button data-tp="${k}" class="${this.tipo === k ? 'on' : ''}" style="flex:1">${n}</button>`).join('')}</div>
        <div class="lbl mb">${t('Mensagem')}</div>
        <div class="card" style="background:var(--bg-2);white-space:pre-wrap;font-size:14px" data-no-i18n>${esc(Cotacao.mensagem(this.tipo, l))}</div>
        <div class="section-title mt">${icon('whatsapp', 'sm')} ${pedido ? 'Pedir para' : 'Perguntar para'}</div>
        <div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:8px">${forn.map((f, i) => `<button class="btn success" data-pf="${i}">${icon('whatsapp', 'sm')} <span data-no-i18n>${esc(f.nome)}</span></button>`).join('') || `<span class="small muted">${t('Nenhum fornecedor cadastrado.')}</span>`}</div>
      </div>` : ''}`;
    const pecas = Store.db.pecas.filter(p => !p.deleted).sort((a, b) => a.nome.localeCompare(b.nome));
    const q = $('#pf-q'), res = $('#pf-res');
    q.oninput = () => {
      const v = q.value.trim(); if (!v) { res.innerHTML = ''; return; }
      const r = pecas.filter(p => Cotacao.achaPeca(v, p)).slice(0, 8);
      res.innerHTML = r.length ? `<div class="card pad-0">${r.map(p => `<div class="item" data-pp="${p.id}" style="padding:10px 14px"><b>${esc(p.nome)}</b>${p.codigo ? ` <span class="xs muted">${esc(p.codigo)}</span>` : ''}
        <div class="xs muted">${p.compat ? esc(p.compat) + ' · ' : ''}${t('estoque')} ${p.qtd || 0}</div></div>`).join('')}</div>` : `<div class="small muted">${t('Nenhuma peça encontrada')}</div>`;
      $$('[data-pp]', res).forEach(d => d.onclick = () => { const p = Store.peca(d.dataset.pp); this.add({ pecaId: p.id, nome: p.nome + (p.codigo ? ` (${p.codigo})` : ''), qtd: Math.max(1, parseInt($('#pf-qtd').value) || 1) }); });
    };
    $('#pf-add').onclick = () => { const n = $('#pf-livre').value.trim(); if (!n) return toast(t('Escolha a peça ou escreva o nome dela'), true); this.add({ nome: n, qtd: Math.max(1, parseInt($('#pf-qtd').value) || 1) }); };
    $('#pf-livre').onkeydown = e => { if (e.key === 'Enter') $('#pf-add').click(); };
    const bx = $('#pf-baixo'); if (bx) bx.onclick = () => { const l2 = this.lista();
      for (const p of baixo) if (!l2.some(i => i.pecaId === p.id)) l2.push({ pecaId: p.id, nome: p.nome + (p.codigo ? ` (${p.codigo})` : ''), qtd: Math.max(1, p.minimo * 2 - (p.qtd || 0)) });
      this.guardar(l2); App.refresh(); };
    const cfg = $('#pf-cfg'); if (cfg) cfg.onclick = () => { App.go('config'); setTimeout(() => Pages.config.abrirTopico('cf-forn'), 300); };
    const lp = $('#pf-limpar'); if (lp) lp.onclick = () => { this.guardar([]); App.refresh(); };
    $$('[data-d]').forEach(b => b.onclick = () => { const l2 = this.lista(), i = l2[+b.dataset.k]; i.qtd = Math.max(1, (i.qtd || 1) + +b.dataset.d); this.guardar(l2); App.refresh(); });
    $$('[data-rm]').forEach(b => b.onclick = () => { const l2 = this.lista(); l2.splice(+b.dataset.rm, 1); this.guardar(l2); App.refresh(); });
    $$('[data-tp]').forEach(b => b.onclick = () => { this.tipo = b.dataset.tp; App.refresh(); });
    $$('[data-pf]').forEach(b => b.onclick = async () => {
      const f = forn[+b.dataset.pf], itens = this.lista();
      window.open(waLink(f.whats, Cotacao.mensagem(this.tipo, itens)), '_blank');
      Store.log(this.tipo === 'pedido' ? 'Pedido de peças' : 'Cotação de peças', `${itens.length} item(ns) · ${f.nome}`); Store.save();
      if (this.tipo === 'pedido' && await confirmDialog(t('Pedido enviado para {f}. Limpar a lista?', { f: f.nome }), { ok: t('Limpar') })) { this.guardar([]); App.refresh(); }
    });
  },
};
