/* Visão Geral */
Pages.dashboard = {
  render(main) {
    const db = Store.db;
    const hoje = Store.resumoDia();
    const meta = Store.metaDiaria();
    const pct = meta ? Math.min(100, (hoje.receita / meta) * 100) : 0;
    const falta = Math.max(0, meta - hoje.receita);
    const os = db.os.filter(o => !o.deleted);
    const cnt = st => os.filter(o => o.status === st).length;
    const mes = Store.resumoMes();
    const baixo = db.pecas.filter(p => !p.deleted && p.qtd <= (p.minimo || 0)).length + db.produtos.filter(p => !p.deleted && p.qtd <= (p.minimo || 0)).length;
    const atrasadas = os.filter(o => OS_ATIVOS.includes(o.status) && o.status !== 'concluido' && o.previsao && dayKey(o.previsao) < dayKey()).length;
    const prontas = os.filter(o => o.status === 'concluido');
    const recentes = os.slice().sort((a, b) => b.criadoEm.localeCompare(a.criadoEm)).slice(0, 5);

    // últimos 7 dias
    const dias = [...Array(7)].map((_, i) => { const d = addDays(new Date(), i - 6); return { d, r: Store.resumoDia(d).receita }; });
    const maxR = Math.max(1, ...dias.map(x => x.r));

    // o que cada papel vê: mecânico sem valores; lucro só para o dono
    const papel = Cloud.papel(), verFin = papel !== 'tecnico', verLucro = papel === 'dono';
    main.innerHTML = `
      ${pageHead('dash', 'Visão Geral', `Resumo operacional de ${esc(longToday())}.`)}
      <div class="page-actions">
        <button class="btn primary" onclick="OSPage.novaOS()">${icon('plus')} Nova OS</button>
        ${verFin ? `<button class="btn outline-gold" onclick="App.go('vendas')">${icon('bag')} Nova Venda</button>` : ''}
        <button class="btn" onclick="OrcPage.novo()">${icon('card')} Orçamento</button>
      </div>

      ${verFin ? `<div class="hero mb">
        <div class="row between" style="align-items:flex-start">
          <div>
            <div class="stat label" style="padding:0;border:0;background:none">Faturamento hoje</div>
            <div class="big">${money(hoje.receita)}</div>
            <button class="btn sm ghost" style="padding:4px 0;margin-top:2px" onclick="Pages.dashboard.detalheHoje()">${icon('eye', 'sm')} Ver o que entrou hoje</button>
          </div>
          <div class="right">
            <div class="small muted">Meta diária</div>
            <div class="bold gold" style="font-size:20px">${money(meta)}</div>
          </div>
        </div>
        <div class="progress"><div style="width:${pct}%"></div></div>
        <div class="small muted">${falta > 0 ? `Faltam <b class="gold">${money(falta)}</b> para a meta.` : `<b class="gold">Meta do dia batida! 🏆</b>`}</div>
        ${verLucro ? `<div class="divider"></div>
        <div class="row between">
          <div class="stat label" style="padding:0;border:0;background:none">Lucro líquido hoje ${icon('trending', 'sm')}</div>
          <span class="pill green">Margem ${hoje.margem.toFixed(1)}%</span>
        </div>
        <div class="big ${hoje.lucro >= 0 ? 'green' : 'red'}" style="font-size:30px;margin-top:4px">${money(hoje.lucro)}</div>
        <div class="row wrap small muted" style="margin-top:8px">Custos considerados <span class="pill red">-${money(hoje.custos)}</span></div>
        <div class="xs muted" style="margin-top:6px">Inclui peças usadas em OS, custo dos produtos vendidos, taxas de cartão e despesas do dia.</div>` : ''}
      </div>` : ''}

      <div class="grid grid-4 mb">
        ${OS_ATIVOS.map(st => [st, { analise: 'Em análise', aprovacao: 'Aguard. aprovação', peca: 'Aguard. peça', servico: 'Em serviço', concluido: 'Prontas' }[st] || OS_STATUS[st].label]).map(([st, l]) => `
          <div class="card status-tile" onclick="App.go('os',{status:'${st}'})">
            <div class="ic" style="color:${OS_STATUS[st].color}">${icon(OS_STATUS[st].icon)}</div>
            <div class="n">${cnt(st)}</div><div class="l">${esc(l)}</div>
          </div>`).join('')}
      </div>

      ${!(verFin && Cloud.temRecurso('metas') && App.rotaVisivel('metas')) ? '' : (() => { const cfg = Metas.cfg(), nm = Metas.numeros(monthKey());
        const ls = cfg.itens.map(mt => { const f = Metas.progresso(mt, nm), fmt = (META_TIPOS[mt.tipo] || META_TIPOS.os)[1]; return { n: mt.nome, f, a: Number(mt.alvo) || 0, fmt }; });
        return `<div class="card mb" style="cursor:pointer" onclick="App.go('metas')"><div class="row between"><b>${icon('star', 'sm')} Metas do mês</b>${icon('chevRight')}</div>
          <div class="grid grid-2 mt" style="gap:10px">${ls.map(l => `<div><div class="row between xs"><span class="ellipsis">${esc(l.n)}</span><b class="${l.a && l.f >= l.a ? 'green' : 'gold'}">${l.fmt(l.f)}/${l.fmt(l.a)}</b></div><div class="progress" style="height:7px;margin:4px 0 0"><div style="width:${l.a ? Math.min(100, l.f / l.a * 100) : 0}%"></div></div></div>`).join('')}</div></div>`; })()}
      ${(() => { const n = Pedidos.naoLidos().length; return n ? `<div class="card mb row" style="cursor:pointer;border-color:rgba(var(--gold-rgb), .6);background:rgba(var(--gold-rgb), .08)" onclick="App.go('os',{tab:'pedidos'})">
        <div class="stat-icon"><div class="ic">${icon('bell')}</div></div>
        <div class="grow"><b>${n} pedido${n > 1 ? 's' : ''} de orçamento não lido${n > 1 ? 's' : ''}</b><div class="small muted">Enviados pelos clientes pelo link</div></div>${icon('chevRight')}</div>` : ''; })()}
      ${!Cloud.temRecurso('followup') ? '' : (() => { const f = PosVenda.feedback().length, o = PosVenda.orcamentos().length, r = PosVenda.revisoes().filter(x => x.hoje).length; return f + o + r ? `<div class="card mb row" style="cursor:pointer;border-color:rgba(22,163,74,.35)" onclick="App.go('posvenda')">
        <div class="stat-icon"><div class="ic" style="color:var(--green);background:rgba(22,163,74,.12)">${icon('whatsapp')}</div></div>
        <div class="grow"><b>Pós-venda de hoje</b><div class="small muted">${[r ? `<b class="gold">${r}</b> ${t('revisão(ões)')}` : '', f ? `<b class="gold">${f}</b> ${t('para pedir retorno')}` : '', o ? `<b class="gold">${o}</b> ${t('orçamento(s) sem resposta')}` : ''].filter(Boolean).join(' · ')}</div></div>${icon('chevRight')}</div>` : ''; })()}
      <div class="grid grid-2 mb">
        ${verFin ? `<div class="stat"><div class="label">${icon('calendar', 'sm')} Faturamento do mês</div><div class="value gold">${money(mes.receita)}</div><div class="sub">Meta ${money(Store.s.metaMensal)} · ${Store.s.metaMensal ? Math.round(mes.receita / Store.s.metaMensal * 100) : 0}%</div></div>
        ${verLucro ? `<div class="stat"><div class="label">${icon('trending', 'sm')} Lucro do mês</div><div class="value ${mes.lucro >= 0 ? 'green' : 'red'}">${money(mes.lucro)}</div><div class="sub">OS ${money(mes.os)} · Vendas ${money(mes.vendas)}</div></div>` : ''}` : ''}
        <div class="stat" style="cursor:pointer" onclick="App.go('os',{status:'atrasadas'})"><div class="label">${icon('clock', 'sm')} OS atrasadas</div><div class="value ${atrasadas ? 'red' : ''}">${atrasadas}</div><div class="sub">Passaram da previsão de entrega</div></div>
        <div class="stat" style="cursor:pointer" onclick="App.go('pecas')"><div class="label">${icon('alert', 'sm')} Estoque baixo</div><div class="value ${baixo ? 'gold' : ''}">${baixo}</div><div class="sub">Peças e produtos no mínimo</div></div>
      </div>

      ${verFin ? `<div class="card mb">
        <h3>Faturamento <span class="gold">últimos 7 dias</span></h3>
        <div class="bar-chart">
          ${dias.map(x => `<div class="b" title="${fmtDate(x.d)}: ${money(x.r)}"><span class="gold">${x.r ? (x.r >= 1000 ? (x.r / 1000).toFixed(1) + 'k' : Math.round(x.r)) : ''}</span><div style="height:${(x.r / maxR) * 100}%"></div><span>${x.d.toLocaleDateString(loc(), { weekday: 'short' }).replace('.', '')}</span></div>`).join('')}
        </div>
      </div>` : ''}

      <div class="grid grid-auto">
        <div class="card pad-0">
          <div class="list-head"><b>Prontas para <span class="gold">retirada</span></b><span class="pill gold">${prontas.length}</span></div>
          ${prontas.length ? prontas.slice(0, 6).map(o => this.osMini(o)).join('') : `<div class="empty">Nenhuma OS aguardando retirada.</div>`}
        </div>
        <div class="card pad-0">
          <div class="list-head"><b>Últimas <span class="gold">OS</span></b><a href="#/os" class="small">Ver todas</a></div>
          ${recentes.length ? recentes.map(o => this.osMini(o)).join('') : `<div class="empty">${icon('file')}<div>Nenhuma OS ainda.</div><button class="btn primary mt" onclick="OSPage.novaOS()">${icon('plus')} Criar primeira OS</button></div>`}
        </div>
      </div>`;
  },
  // Lista os lançamentos que formam o faturamento e as saídas de hoje
  detalheHoje() {
    const k = dayKey(), ls = Store.lancs().filter(l => dayKey(l.data) === k).sort((a, b) => String(b.data).localeCompare(String(a.data)));
    const rec = ls.filter(l => l.tipo === 'receita' && l.forma !== 'troca'), tro = ls.filter(l => l.tipo === 'receita' && l.forma === 'troca'), des = ls.filter(l => l.tipo !== 'receita');
    const abrir = l => l.origem === 'venda' ? `VendasPage.abrirVenda('${l.refId}')` : l.origem === 'os' ? `OSPage.detalhe('${l.refId}')` : `App.go('financeiro')`;
    const extra = l => { if (l.origem === 'venda') { const v = Store.db.vendas.find(x => x.id === l.refId); return v ? (l.forma === 'troca' && v.troca ? `Recebido: ${v.troca.nome}` : v.itens.map(i => i.nome).join(', ')) : ''; } if (l.origem === 'os') { const o = Store.db.os.find(x => x.id === l.refId); return o ? `${Store.cliente(o.clienteId)?.nome || ''} · ${Veiculo.resumo(o.veiculo)}` : ''; } return ''; };
    const linha = l => `<div class="cart-line" style="cursor:pointer" onclick="closeAllModals();${abrir(l)}"><div class="grow" style="min-width:0"><b class="ellipsis" style="display:block">${esc(l.desc || l.categoria || '—')}</b>${extra(l) ? `<div class="small ellipsis">${esc(extra(l))}</div>` : ''}
      <div class="xs muted">${new Date(l.data).toLocaleTimeString(loc(), { hour: '2-digit', minute: '2-digit' })} · ${esc(nomeForma(l.forma))}${l.origem ? ' · ' + esc(l.origem === 'os' ? 'OS' : l.origem === 'venda' ? 'Venda' : 'Manual') : ''}</div></div>
      <b class="${l.forma === 'troca' ? 'muted' : l.tipo === 'receita' ? 'green' : 'red'}" style="white-space:nowrap">${l.tipo === 'receita' ? '' : '-'}${money(l.valor)}</b></div>`;
    openModal({
      title: 'Movimento de hoje', icon: 'dollar',
      body: `<div class="kv"><span class="k">Entradas (${rec.length})</span><span class="v green">${money(rec.reduce((s, l) => s + l.valor, 0))}</span></div>
        ${rec.map(linha).join('') || '<p class="small muted">Nada entrou hoje.</p>'}
        ${tro.length ? `<div class="kv mt"><span class="k">Outros (${tro.length}) · <b>não somam</b></span><span class="v muted">${money(tro.reduce((s, l) => s + l.valor, 0))}</span></div>${tro.map(linha).join('')}` : ''}
        ${des.length ? `<div class="kv mt"><span class="k">Saídas (${des.length})</span><span class="v red">-${money(des.reduce((s, l) => s + l.valor, 0))}</span></div>${des.map(linha).join('')}` : ''}
        <p class="xs muted mt">Para tirar uma venda do faturamento: Vendas → Histórico → abrir a venda → <b>Cancelar venda</b>. Lançamentos manuais se apagam no Financeiro.</p>`,
      foot: `<button class="btn primary block" onclick="closeAllModals();App.go('financeiro')">${icon('chart')} Abrir financeiro</button>`,
    });
  },
  osMini(o) {
    const c = Store.cliente(o.clienteId);
    return `<div class="item bar" style="--bar:${OS_STATUS[o.status].color};padding:12px 18px" onclick="OSPage.detalhe('${o.id}')">
      <div class="row between"><div class="grow"><div class="row"><span class="num">#${o.numero}</span><b class="ellipsis">${esc(c?.nome || '—')}</b></div>
      <div class="small muted ellipsis" style="margin-top:4px">${o.veiculo?.placa ? `<b data-no-i18n>${esc(Placa.fmt(o.veiculo.placa))}</b> · ` : ''}<span data-no-i18n>${esc(Veiculo.nome(o.veiculo) || '')} · ${esc(o.defeito || '')}</span></div></div>
      <div class="right"><div class="bold gold">${money(Store.osTotal(o))}</div>${statusPill(o.status)}</div></div></div>`;
  },
};
