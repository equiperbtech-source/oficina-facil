/* Orçamentos */
const ORC_STATUS = { pendente: ['Pendente', 'orange'], aprovado: ['Aprovado', 'green'], recusado: ['Recusado', 'red'] };

const OrcPage = {
  st: { tab: 'pendente', q: '' },
  total: o => o.itens.reduce((s, i) => s + i.valor * (i.qtd || 1), 0),

  render(main) {
    const all = Store.db.orcamentos.filter(o => !o.deleted);
    const pend = all.filter(o => o.status === 'pendente');
    const aprov = all.filter(o => o.status === 'aprovado').length;
    main.innerHTML = `
      ${pageHead('card', 'Orçamentos', 'Crie, envie e converta orçamentos em ordens de serviço.')}
      <div class="page-actions"><button class="btn primary" onclick="OrcPage.novo()">${icon('plus')} Novo Orçamento</button></div>
      <div class="grid grid-3 mb">
        <div class="stat"><div class="label">Pendentes</div><div class="value">${pend.length}</div><div class="sub gold">${money(pend.reduce((s, o) => s + this.total(o), 0))}</div></div>
        <div class="stat"><div class="label">Aprovados</div><div class="value green">${aprov}</div></div>
        <div class="stat"><div class="label">Conversão</div><div class="value gold">${all.length ? Math.round(aprov / all.length * 100) : 0}%</div></div>
      </div>
      <div class="card mb" style="padding:12px">
        <div class="tabs" id="orc-tabs">${[['pendente', 'Pendentes'], ['aprovado', 'Aprovados'], ['recusado', 'Recusados'], ['todos', 'Todos'], ['lixeira', 'Lixeira']].map(([k, l]) => `<button data-k="${k}" class="${this.st.tab === k ? 'on' : ''}">${k === 'lixeira' ? icon('trash', 'sm') : ''}${l}</button>`).join('')}</div>
        <div class="toolbar"><div class="input-icon">${icon('search')}<input class="input" id="orc-q" placeholder="Buscar cliente, aparelho, nº..." value="${esc(this.st.q)}"></div></div>
      </div>
      <div class="card pad-0" id="orc-list"></div>`;
    $$('#orc-tabs button').forEach(b => b.onclick = () => { this.st.tab = b.dataset.k; $$('#orc-tabs button').forEach(x => x.classList.toggle('on', x === b)); this.list(); });
    $('#orc-q').oninput = e => { this.st.q = e.target.value; this.list(); };
    this.list();
  },

  list() {
    const t = this.st.tab;
    const list = Store.db.orcamentos.filter(o => t === 'lixeira' ? o.deleted : !o.deleted && (t === 'todos' || o.status === t))
      .filter(o => { const c = Store.cliente(o.clienteId); return matches(this.st.q, String(o.numero), c?.nome, o.aparelho?.modelo, o.defeito); })
      .sort((a, b) => b.numero - a.numero);
    $('#orc-list').innerHTML = `<div class="list-head"><b>${list.length} orçamento(s)</b></div>` + (list.map(o => {
      const c = Store.cliente(o.clienteId); const [l, cls] = ORC_STATUS[o.status];
      const vencido = o.status === 'pendente' && o.validade && dayKey(o.validade) < dayKey();
      return `<div class="item" onclick="OrcPage.detalhe('${o.id}')"><div class="row between" style="align-items:flex-start"><div class="grow">
        <div class="meta"><span class="num">ORC ${o.numero}</span><span>${fmtDate(o.criadoEm)}</span><span class="pill ${cls}">${l}</span>${vencido ? '<span class="pill red">Vencido</span>' : ''}</div>
        <div class="title" style="margin-top:8px">${esc(c?.nome || '—')}</div><div class="device">${icon('phone', 'sm')} ${esc(o.aparelho?.modelo || '—')}</div></div>
        <div class="price">${money(this.total(o))}</div></div></div>`;
    }).join('') || `<div class="empty">${icon('card')}<div>Nenhum orçamento.</div></div>`);
  },

  // pre: dados vindos de um pedido do cliente (pedidoId, clienteId, nome, telefone, aparelho, defeito)
  novo(id, pre = {}) {
    const orc = id ? JSON.parse(JSON.stringify(Store.db.orcamentos.find(o => o.id === id))) : { itens: [{ desc: '', qtd: 1, valor: 0 }], validade: dayKey(addDays(new Date(), 7)), aparelho: { modelo: pre.aparelho || '' }, defeito: pre.defeito || '', clienteId: pre.clienteId || null, pedidoId: pre.pedidoId || null };
    const clientes = Store.clientesAtivos();
    openModal({
      title: id ? `Editar orçamento ${orc.numero}` : 'Novo Orçamento', icon: 'card', wide: true,
      subtitle: pre.pedidoId ? `A partir do pedido de ${pre.nome}` : '',
      body: `
        <div class="section-title">Cliente</div>
        <div class="form-row r-1-2 collapse">
          ${field('Cliente cadastrado', `<input type="hidden" id="orc-cli" value="${esc(orc.clienteId || '')}"><div id="orc-cli-box"></div>`)}
          <div id="orc-newcli" class="${orc.clienteId ? 'hidden' : ''}"><div class="form-row">${field('Nome', `<input class="input" id="orc-nome" placeholder="Nome do cliente" value="${esc(pre.nome || '')}">`, { req: true })}${field('Telefone', `<input class="input" id="orc-tel" type="tel" placeholder="(11) 99999-9999" value="${esc(fmtPhone(pre.telefone || ''))}">`)}</div></div>
        </div>
        <div class="section-title">Aparelho e problema</div>
        <div class="form-row">${field('Aparelho', `<input class="input" id="orc-ap" placeholder="Ex: iPhone 11" value="${esc(orc.aparelho?.modelo || '')}">`, { req: true })}${field('IMEI', `<input class="input" id="orc-imei" value="${esc(orc.aparelho?.imei || '')}">`, { opt: true })}</div>
        ${field('Defeito', `<textarea class="input" id="orc-def" style="min-height:60px">${esc(orc.defeito || '')}</textarea>`)}
        ${Fotos.campoHTML(orc)}
        <div class="section-title">Itens</div>
        <div id="orc-itens"></div>
        <div class="row wrap mb"><button class="btn sm outline-gold" id="orc-add">${icon('plus', 'sm')} Item</button>
          <button type="button" class="btn sm" onclick="Cotacao.abrir('preco', { aparelho: document.getElementById('orc-ap')?.value })">${icon('truck', 'sm')} Cotar peça</button>
          ${Store.db.servicos.length ? `<select class="input" id="orc-sv" style="width:auto;min-height:36px;padding:6px 40px 6px 12px"><option value="">+ Do catálogo</option>${Store.db.servicos.filter(s => !s.deleted).map(s => `<option value="${s.id}">${esc(s.nome)} · ${money(s.preco)}</option>`).join('')}</select>` : ''}
          <span class="grow right bold">Total: <span class="gold" id="orc-total" style="font-size:20px"></span></span></div>
        <div class="form-row">${field('Validade', `<input class="input" type="date" id="orc-val" value="${esc(orc.validade || '')}">`)}${field('Prazo de execução', `<input class="input" id="orc-prazo" placeholder="Ex: 2 dias úteis" value="${esc(orc.prazo || '')}">`)}</div>
        ${field('Observações', `<textarea class="input" id="orc-obs" style="min-height:60px">${esc(orc.obs || '')}</textarea>`, { opt: true })}`,
      foot: `<button class="btn" data-close>Cancelar</button><button class="btn primary" id="orc-save">${icon('check')} Salvar</button>`,
      onMount: (el, m) => {
        const cli = $('#orc-cli', el);
        this.buscaCliente(el, clientes, cli);
        Fotos.ligar(el, orc);
        const renderItens = () => {
          $('#orc-itens', el).innerHTML = orc.itens.map((it, i) => `<div class="row mb" style="align-items:flex-end">
            <div class="grow"><input class="input" data-f="desc" data-i="${i}" placeholder="Descrição (peça/serviço)" value="${esc(it.desc)}"></div>
            <input class="input" style="width:64px" type="number" min="1" data-f="qtd" data-i="${i}" value="${it.qtd || 1}">
            <input class="input" style="width:110px" inputmode="decimal" data-f="valor" data-i="${i}" placeholder="0,00" value="${it.valor ? moneyInput(it.valor) : ''}">
            <button class="icon-btn" data-rm="${i}">${icon('trash', 'sm')}</button></div>`).join('');
          $$('[data-f]', el).forEach(inp => inp.oninput = () => { const it = orc.itens[+inp.dataset.i]; it[inp.dataset.f] = inp.dataset.f === 'valor' ? parseMoney(inp.value) : inp.dataset.f === 'qtd' ? +inp.value || 1 : inp.value; tot(); });
          $$('[data-rm]', el).forEach(b => b.onclick = () => { orc.itens.splice(+b.dataset.rm, 1); renderItens(); });
          tot();
        };
        const tot = () => $('#orc-total', el).textContent = money(this.total(orc));
        renderItens();
        $('#orc-add', el).onclick = () => { orc.itens.push({ desc: '', qtd: 1, valor: 0 }); renderItens(); };
        const sv = $('#orc-sv', el); if (sv) sv.onchange = () => { const s = Store.db.servicos.find(x => x.id === sv.value); if (s) { orc.itens = orc.itens.filter(i => i.desc || i.valor); orc.itens.push({ desc: s.nome, qtd: 1, valor: s.preco }); renderItens(); } sv.value = ''; };
        $('#orc-save', el).onclick = () => {
          if (Fotos.ocupado(el)) return toast('Aguarde as fotos terminarem de enviar', true);
          let clienteId = cli.value;
          if (!clienteId) {
            const nome = $('#orc-nome', el).value.trim(); if (!nome) return toast('Informe o cliente', true);
            clienteId = Store.saveCliente({ nome, telefone: onlyDigits($('#orc-tel', el).value), docTipo: 'CPF', aparelhos: [] }).id;
          }
          const modelo = $('#orc-ap', el).value.trim(); if (!modelo) return toast('Informe o aparelho', true);
          orc.itens = orc.itens.filter(i => i.desc || i.valor);
          if (!orc.itens.length) return toast('Adicione pelo menos um item', true);
          Object.assign(orc, { clienteId, aparelho: { ...orc.aparelho, modelo, imei: $('#orc-imei', el).value.trim(), tipo: orc.aparelho?.tipo || 'celular' }, defeito: $('#orc-def', el).value.trim(), validade: $('#orc-val', el).value, prazo: $('#orc-prazo', el).value.trim(), obs: $('#orc-obs', el).value.trim(), ...Fotos.ler(el) });
          if (!orc.id) { orc.id = uid(); orc.numero = Store.next('orc'); orc.criadoEm = nowISO(); orc.status = 'pendente'; Store.db.orcamentos.push(orc); Store.log('Orçamento criado', `#${orc.numero}`); }
          else { const i = Store.db.orcamentos.findIndex(x => x.id === orc.id); Store.db.orcamentos[i] = orc; }
          if (orc.pedidoId) { const p = Pedidos.get(orc.pedidoId); if (p) { p.status = 'orcado'; p.orcamentoId = orc.id; p.lido = true; } }
          Store.save(); Fotos.limpar(el); m.close();
          if (App.route === 'orcamentos' || App.route === 'os') App.refresh();
          toast('Orçamento salvo'); this.detalhe(orc.id);
        };
      },
    });
  },

  // Cliente cadastrado: busca com lupa por nome, telefone, CPF, e-mail ou aparelho (dos cadastros, OS e orçamentos)
  buscaCliente(el, clientes, cli) {
    const ap = cid => [...(Store.cliente(cid)?.aparelhos || []).map(a => a?.modelo || a), ...Store.db.os.filter(o => o.clienteId === cid && !o.deleted).map(o => o.aparelho?.modelo),
      ...Store.db.orcamentos.filter(o => o.clienteId === cid && !o.deleted).map(o => o.aparelho?.modelo)].filter(Boolean);
    const indice = clientes.map(c => { const aps = [...new Set(ap(c.id))]; return { c, aps, txt: norm([c.nome, c.doc, c.email, ...aps, ...(c.aparelhos || []).map(a => a?.imei)].filter(Boolean).join(' ')), dig: onlyDigits(c.telefone) + ' ' + onlyDigits(c.doc) }; });
    const box = $('#orc-cli-box', el), novo = $('#orc-newcli', el);
    const escolher = (id, modelo) => {
      cli.value = id || ''; novo.classList.toggle('hidden', !!id);
      const apEl = $('#orc-ap', el); if (id && modelo && apEl && !apEl.value.trim()) apEl.value = modelo;
      desenhar();
    };
    const desenhar = () => {
      const c = cli.value && Store.cliente(cli.value);
      if (c) {
        box.innerHTML = `<div class="cart-line"><div class="avatar">${esc((c.nome || '?')[0].toUpperCase())}</div><div class="grow" style="min-width:0"><b data-no-i18n>${esc(c.nome)}</b>
          <div class="xs muted">${esc(fmtPhone(c.telefone) || '')}${ap(c.id).length ? ' · ' + esc([...new Set(ap(c.id))].slice(0, 2).join(', ')) : ''}</div></div><button type="button" class="btn sm" id="orc-cli-x">${t('Trocar')}</button></div>`;
        $('#orc-cli-x', el).onclick = () => { escolher(''); $('#orc-cli-q', el)?.focus(); };
        return;
      }
      box.innerHTML = `${inputIcon('search', `id="orc-cli-q" autocomplete="off" placeholder="${esc(t('Nome, telefone, CPF ou aparelho'))}"`)}<div id="orc-cli-res" class="mt"></div>`;
      const q = $('#orc-cli-q', el);
      q.oninput = () => {
        const v = q.value.trim(), palavras = norm(v).split(/\s+/).filter(Boolean), dig = onlyDigits(v);
        const res = $('#orc-cli-res', el);
        if (!v) { res.innerHTML = ''; return; }
        const achados = indice.filter(i => palavras.every(w => i.txt.includes(w) || (dig.length >= 3 && i.dig.includes(dig)))).slice(0, 6);
        res.innerHTML = achados.length ? `<div class="card pad-0">${achados.map(i => { const apAchado = i.aps.find(a => palavras.some(w => norm(a).includes(w))) || '';
          return `<div class="item" data-oc="${i.c.id}" data-ap="${esc(apAchado)}" style="padding:10px 14px"><b data-no-i18n>${esc(i.c.nome)}</b> <span class="xs muted">${esc(fmtPhone(i.c.telefone) || '')}</span>
            ${i.aps.length ? `<div class="xs muted">${icon('phone', 'sm')} ${esc(i.aps.slice(0, 3).join(', '))}</div>` : ''}</div>`; }).join('')}</div>`
          : `<div class="small muted">${t('Nenhum cliente encontrado. Preencha ao lado para cadastrar.')}</div>`;
        $$('[data-oc]', res).forEach(d => d.onclick = () => escolher(d.dataset.oc, d.dataset.ap));
        // nada encontrado: aproveita o que foi digitado no cadastro de cliente novo (só troca o que a própria busca preencheu)
        const nomeEl = $('#orc-nome', el), telEl = $('#orc-tel', el);
        const auto = (inp, val) => { if (!inp.value || inp.value === inp.dataset.auto) { inp.value = val; inp.dataset.auto = val; } };
        const soTel = dig.length >= 8 && dig.length === v.replace(/[\s()+-]/g, '').length;
        auto(nomeEl, !achados.length && !dig ? v : ''); auto(telEl, !achados.length && soTel ? fmtPhone(dig) : '');
      };
    };
    desenhar();
  },

  detalhe(id) {
    const o = Store.db.orcamentos.find(x => x.id === id);
    const c = Store.cliente(o.clienteId) || {};
    const [l, cls] = ORC_STATUS[o.status];
    const msg = `${t('Olá {nome}! Segue o orçamento da {loja}:', { nome: (c.nome || '').split(' ')[0], loja: Store.s.loja })}\n\n📱 *${o.aparelho?.modelo || ''}*\n${o.defeito ? `${t('Defeito')}: ${o.defeito}\n` : ''}\n${o.itens.map(i => `• ${i.desc}${i.qtd > 1 ? ` (x${i.qtd})` : ''}: ${money(i.valor * (i.qtd || 1))}`).join('\n')}\n\n*${t('Total')}: ${money(this.total(o))}*\n${o.prazo ? `${t('Prazo')}: ${o.prazo}\n` : ''}${t('Válido até {data}.', { data: fmtDate(o.validade) })}\n\n${t('Podemos seguir com o serviço?')}`;
    openModal({
      title: `Orçamento ${o.numero}`, subtitle: `${c.nome || ''} · ${o.aparelho?.modelo || ''}`, icon: 'card',
      body: `<div class="row wrap mb"><span class="pill ${cls}">${l}</span><span class="pill">Criado ${fmtDate(o.criadoEm)}</span><span class="pill">Válido até ${fmtDate(o.validade)}</span></div>
        ${o.defeito ? `<div class="card mb"><div class="lbl">Defeito</div>${esc(o.defeito)}</div>` : ''}
        <div class="card mb">${o.itens.map(i => `<div class="kv"><span class="k">${esc(i.desc)}${i.qtd > 1 ? ` x${i.qtd}` : ''}</span><span class="v">${money(i.valor * (i.qtd || 1))}</span></div>`).join('')}
        <div class="kv"><span class="k bold">Total</span><span class="v gold" style="font-size:20px">${money(this.total(o))}</span></div></div>
        ${o.obs ? `<p class="small muted">${esc(o.obs)}</p>` : ''}
        ${Fotos.galeriaHTML(o)}
        ${o.osId ? `<button class="btn outline-gold block" onclick="closeAllModals();OSPage.detalhe('${o.osId}')">Ver OS gerada</button>` : ''}`,
      foot: o.deleted ? `<button class="btn outline-gold" onclick="OrcPage.set('${o.id}','deleted',false)">${icon('undo')} Restaurar</button>` : `
        ${o.status === 'pendente' ? `<button class="btn primary" onclick="OrcPage.aprovar('${o.id}')">${icon('check')} Aprovar → OS</button><button class="btn" onclick="OrcPage.set('${o.id}','status','recusado')">${icon('xCircle')} Recusado</button>` : ''}
        ${o.status === 'recusado' ? `<button class="btn" onclick="OrcPage.set('${o.id}','status','pendente')">Reabrir</button>` : ''}
        ${c.telefone ? `<a class="btn success" target="_blank" href="${waLink(c.telefone, msg)}">${icon('whatsapp')} Enviar</a>` : ''}
        <button class="btn" onclick="Cotacao.abrir('preco', { aparelho: Store.db.orcamentos.find(x=>x.id==='${o.id}')?.aparelho?.modelo })">${icon('truck')} Cotar peça</button>
        <button class="btn" onclick="Print.orcamento(Store.db.orcamentos.find(x=>x.id==='${o.id}'))">${icon('printer')} Imprimir</button>
        ${o.status === 'pendente' ? `<button class="btn" onclick="closeAllModals();OrcPage.novo('${o.id}')">${icon('edit')}</button>` : ''}
        <button class="btn danger" onclick="OrcPage.set('${o.id}','deleted',true)">${icon('trash')}</button>`,
      onMount: el => Fotos.ligarGaleria(el),
    });
  },

  set(id, k, v) {
    const o = Store.db.orcamentos.find(x => x.id === id); o[k] = v; Store.save(); closeAllModals();
    if (App.route === 'orcamentos') App.refresh();
    toast('Orçamento atualizado');
  },

  aprovar(id) {
    const o = Store.db.orcamentos.find(x => x.id === id);
    const c = Store.cliente(o.clienteId);
    // garante que o aparelho exista no cadastro do cliente
    let ap = (c.aparelhos || []).find(a => a.modelo === o.aparelho.modelo && (a.imei || '') === (o.aparelho.imei || ''));
    if (!ap) { ap = { id: uid(), tipo: 'celular', idTipo: 'imei', ...o.aparelho }; c.aparelhos = [...(c.aparelhos || []), ap]; Store.saveCliente(c); }
    closeAllModals();
    OSPage.novaOS({ clienteId: c.id, aparelho: ap, fromOrc: { id: o.id, defeito: o.defeito, servico: o.itens.map(i => i.desc).join(' + '), valor: this.total(o), fotos: o.fotos || [], fotosImprimir: o.fotosImprimir } });
  },
};
Pages.orcamentos = OrcPage;
