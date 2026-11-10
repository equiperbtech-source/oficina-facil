/* Orçamentos: mesmos itens da OS (mão de obra + peças). Ao aprovar (no app), os itens vão para a OS. */
const ORC_STATUS = { pendente: ['Pendente', 'orange'], aprovado: ['Aprovado', 'green'], recusado: ['Recusado', 'red'] };

const OrcPage = {
  st: { tab: 'pendente', q: '' },
  // orçamento antigo (itens soltos { desc, qtd, valor }) vira mão de obra
  normalizar(o) {
    if (Array.isArray(o.itens) && !o.itensServico && !o.itensPeca) {
      o.itensServico = o.itens.filter(i => i.desc || i.valor).map(i => ({ id: uid(), nome: i.desc, qtd: i.qtd || 1, valor: i.valor || 0 }));
      o.itensPeca = [];
    }
    o.itensServico = o.itensServico || []; o.itensPeca = o.itensPeca || [];
    return o;
  },
  total(o) { return OSItens.totais(this.normalizar(o)).total; },

  render(main) {
    const all = Store.db.orcamentos.filter(o => !o.deleted);
    const pend = all.filter(o => o.status === 'pendente');
    const aprov = all.filter(o => o.status === 'aprovado').length;
    main.innerHTML = `
      ${pageHead('card', 'Orçamentos', 'Monte, envie pelo WhatsApp e transforme em OS.')}
      <div class="page-actions"><button class="btn primary" onclick="OrcPage.novo()">${icon('plus')} ${t('Novo orçamento')}</button></div>
      <div class="grid grid-3 mb">
        <div class="stat"><div class="label">Pendentes</div><div class="value">${pend.length}</div><div class="sub gold">${money(pend.reduce((s, o) => s + this.total(o), 0))}</div></div>
        <div class="stat"><div class="label">Aprovados</div><div class="value green">${aprov}</div></div>
        <div class="stat"><div class="label">Conversão</div><div class="value gold">${all.length ? Math.round(aprov / all.length * 100) : 0}%</div></div>
      </div>
      <div class="card mb" style="padding:12px">
        <div class="tabs" id="orc-tabs">${[['pendente', 'Pendentes'], ['aprovado', 'Aprovados'], ['recusado', 'Recusados'], ['todos', 'Todos'], ['lixeira', 'Lixeira']].map(([k, l]) => `<button data-k="${k}" class="${this.st.tab === k ? 'on' : ''}">${k === 'lixeira' ? icon('trash', 'sm') : ''}${l}</button>`).join('')}</div>
        <div class="toolbar"><div class="input-icon">${icon('search')}<input class="input" id="orc-q" placeholder="Buscar cliente, placa, veículo, nº..." value="${esc(this.st.q)}"></div></div>
      </div>
      <div class="card pad-0" id="orc-list"></div>`;
    $$('#orc-tabs button').forEach(b => b.onclick = () => { this.st.tab = b.dataset.k; $$('#orc-tabs button').forEach(x => x.classList.toggle('on', x === b)); this.list(); });
    $('#orc-q').oninput = e => { this.st.q = e.target.value; this.list(); };
    this.list();
  },

  list() {
    const aba = this.st.tab;
    const list = Store.db.orcamentos.filter(o => aba === 'lixeira' ? o.deleted : !o.deleted && (aba === 'todos' || o.status === aba))
      .filter(o => { const c = Store.cliente(o.clienteId); return Placa.bate(this.st.q, o.veiculo?.placa) || matches(this.st.q, String(o.numero), c?.nome, o.veiculo?.modelo, o.veiculo?.marca, o.defeito); })
      .sort((a, b) => b.numero - a.numero);
    $('#orc-list').innerHTML = `<div class="list-head"><b>${t('{n} orçamento(s)', { n: list.length })}</b></div>` + (list.map(o => {
      const c = Store.cliente(o.clienteId); const [l, cls] = ORC_STATUS[o.status];
      const vencido = o.status === 'pendente' && o.validade && dayKey(o.validade) < dayKey();
      return `<div class="item" onclick="OrcPage.detalhe('${o.id}')"><div class="row between" style="align-items:flex-start"><div class="grow" style="min-width:0">
        <div class="meta"><span class="num">ORC ${o.numero}</span><span>${fmtDate(o.criadoEm)}</span><span class="pill ${cls}">${t(l)}</span>${vencido ? `<span class="pill red">${t('Vencido')}</span>` : ''}</div>
        <div class="title" style="margin-top:8px" data-no-i18n>${esc(c?.nome || '—')}</div><div class="device">${icon(Veiculo.icone(o.veiculo), 'sm')} ${o.veiculo?.placa ? `<b class="placa-tag" data-no-i18n>${esc(Placa.fmt(o.veiculo.placa))}</b> ` : ''}<span data-no-i18n>${esc(Veiculo.completo(o.veiculo) || '—')}</span></div></div>
        <div class="price">${money(this.total(o))}</div></div></div>`;
    }).join('') || `<div class="empty">${icon('card')}<div>${t('Nenhum orçamento.')}</div></div>`);
  },

  // pre: dados vindos de um pedido do cliente (pedidoId, clienteId, nome, telefone, veiculo, defeito)
  novo(id, pre = {}) {
    const orc = id ? this.normalizar(JSON.parse(JSON.stringify(Store.db.orcamentos.find(o => o.id === id))))
      : { itensServico: [], itensPeca: [], desconto: 0, validade: dayKey(addDays(new Date(), 7)), veiculo: pre.veiculo || null, defeito: pre.defeito || '', clienteId: pre.clienteId || null, pedidoId: pre.pedidoId || null };
    openModal({
      title: id ? t('Editar orçamento {n}', { n: orc.numero }) : t('Novo orçamento'), icon: 'card', wide: true,
      subtitle: pre.pedidoId ? t('A partir do pedido de {n}', { n: pre.nome }) : '',
      body: `
        <div class="section-title">${t('Cliente')}</div>
        <input type="hidden" id="orc-cli" value="${esc(orc.clienteId || '')}"><div id="orc-cli-box"></div>
        <div id="orc-newcli" class="${orc.clienteId ? 'hidden' : ''}"><div class="form-row">${field('Nome', `<input class="input" id="orc-nome" placeholder="${t('Nome do cliente')}" value="${esc(pre.nome || '')}">`, { req: true })}${field('Telefone', `<input class="input" id="orc-tel" type="tel" placeholder="(11) 99999-9999" value="${esc(fmtPhone(pre.telefone || ''))}">`)}</div></div>
        <div class="section-title">${t('Veículo')}</div>
        <div id="orc-veics"></div>
        <div id="orc-vform">${Veiculo.campos(orc.veiculo || {}, { prefixo: 'orc' })}</div>
        ${field('Reclamação do cliente', `<textarea class="input" id="orc-def" style="min-height:60px">${esc(orc.defeito || '')}</textarea>`)}
        ${Fotos.campoHTML(orc)}
        <div class="section-title">${t('Serviços e peças')} <button type="button" class="btn sm" style="margin-left:8px" id="orc-cotar">${icon('truck', 'sm')} ${t('Cotar peça')}</button></div>
        ${OSItens.editorHTML(orc, { modo: 'orc' })}
        <div class="form-row">${field('Validade', `<input class="input" type="date" id="orc-val" value="${esc(orc.validade || '')}">`)}${field('Prazo de execução', `<input class="input" id="orc-prazo" placeholder="${t('Ex: 2 dias úteis')}" value="${esc(orc.prazo || '')}">`)}</div>
        ${field('Observações', `<textarea class="input" id="orc-obs" style="min-height:60px">${esc(orc.obs || '')}</textarea>`, { opt: true })}`,
      foot: `<button class="btn" data-close>Cancelar</button><button class="btn primary" id="orc-save">${icon('check')} Salvar</button>`,
      onMount: (el, m) => {
        const cli = $('#orc-cli', el);
        // veículos do cliente escolhido: um toque preenche o formulário do veículo
        const veics = () => {
          const c = cli.value && Store.cliente(cli.value), box = $('#orc-veics', el);
          const vs = c?.veiculos || [];
          box.innerHTML = vs.length ? `<div class="row wrap mb" style="gap:6px">${vs.map(v => `<button type="button" class="btn sm ${orc.veiculo?.id === v.id ? 'outline-gold' : ''}" data-ov="${v.id}">${icon(Veiculo.icone(v), 'sm')} <span data-no-i18n>${esc(v.placa ? Placa.fmt(v.placa) : v.modelo)}</span></button>`).join('')}</div>` : '';
          $$('[data-ov]', box).forEach(b => b.onclick = () => { orc.veiculo = { ...vs.find(v => v.id === b.dataset.ov) }; $('#orc-vform', el).innerHTML = Veiculo.campos(orc.veiculo, { prefixo: 'orc' }); Veiculo.ligar($('#orc-vform', el)); veics(); });
        };
        this.buscaCliente(el, cli, () => { const c = cli.value && Store.cliente(cli.value); if (c && (c.veiculos || []).length === 1 && !Veiculo.ler($('#orc-vform', el)).modelo) { orc.veiculo = { ...c.veiculos[0] }; $('#orc-vform', el).innerHTML = Veiculo.campos(orc.veiculo, { prefixo: 'orc' }); Veiculo.ligar($('#orc-vform', el)); } veics(); });
        veics();
        Veiculo.ligar($('#orc-vform', el), { aoUsarCadastro: ({ cliente, veiculo }) => { cli.value = cliente.id; orc.veiculo = { ...veiculo }; $('#orc-vform', el).innerHTML = Veiculo.campos(orc.veiculo, { prefixo: 'orc' }); Veiculo.ligar($('#orc-vform', el)); this.buscaCliente(el, cli, veics); veics(); } });
        Fotos.ligar(el, orc);
        OSItens.ligar(el, orc, { modo: 'orc' });
        $('#orc-cotar', el).onclick = () => Cotacao.abrir('cotacao', { veiculo: Veiculo.ler($('#orc-vform', el)) });
        $('#orc-save', el).onclick = () => {
          if (Fotos.ocupado(el)) return toast('Aguarde as fotos terminarem de enviar', true);
          const v = Veiculo.ler($('#orc-vform', el));
          if (!v.modelo) return toast(t('Informe o modelo do veículo'), true);
          let clienteId = cli.value;
          if (!clienteId) {
            const nome = $('#orc-nome', el).value.trim(); if (!nome) return toast('Informe o cliente', true);
            clienteId = Store.saveCliente({ nome, telefone: onlyDigits($('#orc-tel', el).value), docTipo: 'CPF', veiculos: [] }).id;
          }
          orc.itensServico = orc.itensServico.filter(i => String(i.nome || '').trim());
          orc.itensPeca = orc.itensPeca.filter(i => String(i.nome || '').trim());
          if (!orc.itensServico.length && !orc.itensPeca.length) return toast(t('Adicione pelo menos um serviço ou peça'), true);
          // o veículo fica no cadastro do cliente (sem repetir a placa)
          const c = Store.cliente(clienteId);
          const ja = (c.veiculos || []).find(x => x.id === v.id || (v.placa && Placa.mesma(x.placa, v.placa)));
          if (ja) Object.assign(ja, v, { id: ja.id }); else c.veiculos = [...(c.veiculos || []), v];
          Store.saveCliente(c);
          delete orc.itens;
          Object.assign(orc, { clienteId, veiculo: { ...(ja || v) }, defeito: $('#orc-def', el).value.trim(), validade: $('#orc-val', el).value, prazo: $('#orc-prazo', el).value.trim(), obs: $('#orc-obs', el).value.trim(), ...Fotos.ler(el) });
          OSItens.gravarTotais(orc);
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

  // Cliente cadastrado: busca por nome, telefone, CPF ou placa
  buscaCliente(el, cli, aoEscolher) {
    const box = $('#orc-cli-box', el), novo = $('#orc-newcli', el);
    const escolher = id => { cli.value = id || ''; novo.classList.toggle('hidden', !!id); desenhar(); aoEscolher && aoEscolher(); };
    const desenhar = () => {
      const c = cli.value && Store.cliente(cli.value);
      if (c) {
        box.innerHTML = `<div class="cart-line"><div class="avatar">${esc((c.nome || '?')[0].toUpperCase())}</div><div class="grow" style="min-width:0"><b data-no-i18n>${esc(c.nome)}</b>
          <div class="xs muted">${esc(fmtPhone(c.telefone) || '')}</div></div><button type="button" class="btn sm" id="orc-cli-x">${t('Trocar')}</button></div>`;
        $('#orc-cli-x', el).onclick = () => { escolher(''); $('#orc-cli-q', el)?.focus(); };
        return;
      }
      box.innerHTML = `${inputIcon('search', `id="orc-cli-q" autocomplete="off" placeholder="${esc(t('Nome, telefone, CPF ou placa'))}"`)}<div id="orc-cli-res" class="mt"></div>`;
      const q = $('#orc-cli-q', el);
      q.oninput = () => {
        const v = q.value.trim(), res = $('#orc-cli-res', el);
        if (!v) { res.innerHTML = ''; return; }
        const achados = Store.clientesAtivos().filter(c => ClientesPage.bate(c, v)).slice(0, 6);
        res.innerHTML = achados.length ? `<div class="card pad-0">${achados.map(c => `<div class="item" data-oc="${c.id}" style="padding:10px 14px"><b data-no-i18n>${esc(c.nome)}</b> <span class="xs muted">${esc(fmtPhone(c.telefone) || '')}</span>
            ${(c.veiculos || []).length ? `<div class="xs muted" data-no-i18n>${esc(c.veiculos.slice(0, 3).map(x => [x.placa ? Placa.fmt(x.placa) : '', x.modelo].filter(Boolean).join(' ')).join(', '))}</div>` : ''}</div>`).join('')}</div>`
          : `<div class="small muted">${t('Nenhum cliente encontrado. Preencha abaixo para cadastrar.')}</div>`;
        $$('[data-oc]', res).forEach(d => d.onclick = () => escolher(d.dataset.oc));
        const nomeEl = $('#orc-nome', el), telEl = $('#orc-tel', el), dig = onlyDigits(v);
        const auto = (inp, val) => { if (!inp.value || inp.value === inp.dataset.auto) { inp.value = val; inp.dataset.auto = val; } };
        const soTel = dig.length >= 8 && dig.length === v.replace(/[\s()+-]/g, '').length;
        auto(nomeEl, !achados.length && !dig ? v : ''); auto(telEl, !achados.length && soTel ? fmtPhone(dig) : '');
      };
    };
    desenhar();
  },

  detalhe(id) {
    const o = this.normalizar(Store.db.orcamentos.find(x => x.id === id));
    const c = Store.cliente(o.clienteId) || {};
    const [l, cls] = ORC_STATUS[o.status];
    const msg = `${t('Olá {cliente}! Segue o orçamento da {oficina}:', { cliente: (c.nome || '').split(' ')[0], oficina: Store.s.loja })}\n\n🔧 *${Veiculo.resumo(o.veiculo)}*\n${o.defeito ? `${t('Reclamação')}: ${o.defeito}\n` : ''}\n${OSItens.textoWhats(o)}\n${o.prazo ? `${t('Prazo')}: ${o.prazo}\n` : ''}${t('Válido até {data}.', { data: fmtDate(o.validade) })}\n\n${t('Podemos seguir com o serviço?')}`;
    openModal({
      title: `${t('Orçamento')} ${o.numero}`, subtitle: `${c.nome || ''} · ${Veiculo.resumo(o.veiculo)}`, icon: 'card',
      body: `<div class="row wrap mb"><span class="pill ${cls}">${t(l)}</span><span class="pill">${t('Criado')} ${fmtDate(o.criadoEm)}</span><span class="pill">${t('Válido até')} ${fmtDate(o.validade)}</span></div>
        ${o.defeito ? `<div class="card mb"><div class="lbl">${t('Reclamação')}</div>${esc(o.defeito)}</div>` : ''}
        <div class="card mb">${OSItens.resumoHTML(o, { custo: Cloud.papel() !== 'tecnico' })}</div>
        ${o.obs ? `<p class="small muted">${esc(o.obs)}</p>` : ''}
        ${Fotos.galeriaHTML(o)}
        ${o.osId ? `<button class="btn outline-gold block" onclick="closeAllModals();OSPage.detalhe('${o.osId}')">${t('Ver OS gerada')}</button>` : ''}`,
      foot: o.deleted ? `<button class="btn outline-gold" onclick="OrcPage.set('${o.id}','deleted',false)">${icon('undo')} Restaurar</button>` : `
        ${o.status === 'pendente' ? `<button class="btn primary" onclick="OrcPage.aprovar('${o.id}')">${icon('check')} ${t('Aprovar → OS')}</button><button class="btn" onclick="OrcPage.set('${o.id}','status','recusado')">${icon('xCircle')} ${t('Recusado')}</button>` : ''}
        ${o.status === 'recusado' ? `<button class="btn" onclick="OrcPage.set('${o.id}','status','pendente')">${t('Reabrir')}</button>` : ''}
        ${c.telefone ? `<a class="btn success" target="_blank" rel="noopener" href="${waLink(c.telefone, msg)}">${icon('whatsapp')} ${t('Enviar')}</a>` : ''}
        <button class="btn" onclick="OrcPage.pdf('${o.id}')">${icon('file')} PDF</button>
        <button class="btn" onclick="Print.orcamento(Store.db.orcamentos.find(x=>x.id==='${o.id}'))">${icon('printer')} ${t('Imprimir')}</button>
        ${o.status === 'pendente' ? `<button class="btn" title="Editar" onclick="closeAllModals();OrcPage.novo('${o.id}')">${icon('edit')}</button>` : ''}
        <button class="btn danger" title="Mover para a lixeira" onclick="OrcPage.set('${o.id}','deleted',true)">${icon('trash')}</button>`,
      onMount: el => Fotos.ligarGaleria(el),
    });
  },

  async pdf(id) {
    const o = this.normalizar(Store.db.orcamentos.find(x => x.id === id));
    const doc = await Pdf.orcamento(o);
    await Pdf.compartilhar(doc, `orcamento-${o.numero}.pdf`, `${t('Orçamento')} ${o.numero} — ${Store.s.loja}`);
  },

  set(id, k, v) {
    const o = Store.db.orcamentos.find(x => x.id === id); o[k] = v; Store.save(); closeAllModals();
    if (App.route === 'orcamentos') App.refresh();
    toast('Orçamento atualizado');
  },

  // Aprovar: abre a OS já com o cliente, o veículo e os itens (mão de obra e peças) do orçamento
  aprovar(id) {
    const o = this.normalizar(Store.db.orcamentos.find(x => x.id === id));
    const c = Store.cliente(o.clienteId);
    let v = (c.veiculos || []).find(x => x.id === o.veiculo?.id || (o.veiculo?.placa && Placa.mesma(x.placa, o.veiculo.placa)));
    if (!v && o.veiculo) { v = { ...o.veiculo, id: o.veiculo.id || uid() }; c.veiculos = [...(c.veiculos || []), v]; Store.saveCliente(c); }
    closeAllModals();
    OSPage.novaOS({ clienteId: c.id, veiculo: v, fromOrc: { id: o.id, defeito: o.defeito, itensServico: o.itensServico, itensPeca: o.itensPeca, desconto: o.desconto, fotos: o.fotos || [], fotosImprimir: o.fotosImprimir } });
  },
};
Pages.orcamentos = OrcPage;
