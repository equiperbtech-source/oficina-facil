/* Metas do mês: quantidade vendida por produto (ligada a produtos do cadastro),
   celulares vendidos (qualquer novo ou seminovo) e lucro por aparelho vendido */
const Metas = {
  // Configuração guardada nas configurações da loja (sincroniza com a nuvem)
  cfg() {
    const s = Store.s;
    if (!s.metas) {
      s.metas = {
        lucroPorAparelho: 400,
        itens: [
          { id: uid(), tipo: 'celulares', nome: 'iPhones / celulares', alvo: 32 },
          { id: uid(), tipo: 'produtos', nome: 'Fone bluetooth', alvo: 20, produtoIds: [] },
          { id: uid(), tipo: 'produtos', nome: 'Capa premium', alvo: 10, produtoIds: [], autoBusca: 'case premium|capa premium' },
          { id: uid(), tipo: 'produtos', nome: 'Película hidrogel', alvo: 10, produtoIds: [], autoBusca: 'hidrogel' },
        ],
      };
      if (Cloud.podeEscrever()) Store.save(); // somente leitura: só usa na tela
    }
    // metas iniciais se ligam sozinhas quando o produto aparecer no cadastro (até você escolher manualmente)
    for (const it of s.metas.itens) {
      if (!it.autoBusca || (it.produtoIds || []).length) continue;
      const re = new RegExp(it.autoBusca, 'i');
      const ids = Store.db.produtos.filter(p => !p.deleted && !ehCelular(p) && re.test(p.nome)).map(p => p.id);
      if (ids.length) { it.produtoIds = ids; if (Cloud.podeEscrever()) Store.save(); }
    }
    return s.metas;
  },
  lucroMeta() { return Number(this.cfg().lucroPorAparelho) || 0; },

  // Itens vendidos no mês (com lucro de cada item, já descontando o desconto proporcional)
  vendidos(mes) {
    const out = []; out.mes = mes;
    for (const v of Store.db.vendas) {
      if (v.cancelada || monthKey(v.data) !== mes) continue;
      const sub = v.itens.reduce((s, i) => s + i.preco * i.qtd, 0) || 1;
      for (const i of v.itens) {
        const desc = (v.desconto || 0) * (i.preco * i.qtd) / sub;
        out.push({ ...i, venda: v, celular: !!(i.aparelho || i.seminovo), temCusto: (i.custo || 0) > 0, lucro: (i.preco - (i.custo || 0)) * i.qtd - desc });
      }
    }
    return out;
  },

  // Conta só vendas depois do "Zerar contagem" da meta (se houver)
  // (o zerar vale só para o mês em que foi feito; os meses anteriores continuam com os números completos)
  depois(i, desde) { return !desde || monthKey(i.venda.data) !== monthKey(desde) || String(i.venda.data) > desde; },
  progresso(meta, vendidos) {
    const its = (meta.tipo === 'celulares' ? vendidos.filter(i => i.celular) : vendidos.filter(i => (meta.produtoIds || []).includes(i.id))).filter(i => this.depois(i, meta.resetEm));
    // quantidade informada manualmente (vale no mês em que foi ajustada) + vendas feitas depois do ajuste
    const base = meta.resetEm && meta.base && vendidos.mes === monthKey(meta.resetEm) ? Number(meta.base) || 0 : 0;
    return { feito: base + its.reduce((s, i) => s + i.qtd, 0), itens: its, base };
  },
};

Pages.metas = {
  mes: null, aba: 'loja',
  abas() { $$('#mt-abas button').forEach(b => b.onclick = () => { this.aba = b.dataset.k; App.refresh(); }); },
  render(main) {
    const cfg = Metas.cfg(), dono = Cloud.ehDono();
    const mes = this.mes || monthKey();
    const [ano, m] = mes.split('-').map(Number);
    const diasMes = new Date(ano, m, 0).getDate();
    const atual = mes === monthKey();
    const passados = atual ? new Date().getDate() : mes < monthKey() ? diasMes : 0;
    const restantes = Math.max(0, diasMes - passados + (atual ? 1 : 0));
    const vend = Metas.vendidos(mes);
    const nomeMes = (s => s.charAt(0).toUpperCase() + s.slice(1))(new Date(ano, m - 1, 1).toLocaleDateString(loc(), { month: 'long', year: 'numeric' }));

    const linhas = cfg.itens.map(meta => {
      const { feito } = Metas.progresso(meta, vend);
      const alvo = Number(meta.alvo) || 0;
      const pct = alvo ? Math.min(100, feito / alvo * 100) : 0;
      const falta = Math.max(0, alvo - feito);
      const proj = passados ? Math.round(feito / passados * diasMes) : 0;
      const semProduto = meta.tipo === 'produtos' && !(meta.produtoIds || []).length;
      return { meta, feito, alvo, pct, falta, proj, semProduto };
    });
    const geral = linhas.length ? linhas.reduce((s, l) => s + l.pct, 0) / linhas.length : 0;

    // lucro por aparelho
    const cels = vend.filter(i => i.celular && Metas.depois(i, cfg.lucroResetEm));
    const comCusto = cels.filter(i => i.temCusto);
    const meta = Metas.lucroMeta();
    const lucroTotal = comCusto.reduce((s, i) => s + i.lucro, 0);
    const unid = comCusto.reduce((s, i) => s + i.qtd, 0);
    const media = unid ? lucroTotal / unid : 0;
    const bateram = comCusto.filter(i => i.lucro / i.qtd >= meta).length;
    const metaCel = cfg.itens.find(i => i.tipo === 'celulares');
    const alvoLucro = (Number(metaCel?.alvo) || 0) * meta;

    const topo = `
      ${pageHead('star', 'Metas', 'Acompanhe as metas de vendas e de lucro do mês.')}
      <div class="row between mb">
        <button class="btn sm" onclick="Pages.metas.mudarMes(-1)">${icon('arrowLeft', 'sm')}</button>
        <b>${esc(nomeMes)}</b>
        <button class="btn sm" onclick="Pages.metas.mudarMes(1)" ${atual ? 'disabled' : ''}>${icon('arrowRight', 'sm')}</button>
      </div>
      ${Cloud.enabled && Cloud.loja ? `<div class="tabs mb" id="mt-abas">${[['loja', 'Loja'], ['equipe', 'Por funcionário']].map(([k, l]) => `<button data-k="${k}" class="${this.aba === k ? 'on' : ''}">${l}</button>`).join('')}</div>` : ''}`;
    if (this.aba === 'equipe' && Cloud.enabled && Cloud.loja) {
      main.innerHTML = topo + '<div id="mt-equipe"><p class="small muted">Carregando a equipe...</p></div>';
      this.abas(); MetasEquipe.render($('#mt-equipe'), mes);
      return;
    }
    main.innerHTML = `${topo}
      <div class="hero mb">
        <div class="row between"><div class="small muted bold" style="letter-spacing:.12em">PROGRESSO GERAL</div>
          ${dono ? `<button class="btn sm outline-gold" onclick="Pages.metas.editar()">${icon('edit', 'sm')} Editar metas</button>` : ''}</div>
        <div class="big gold">${Math.round(geral)}%</div>
        <div class="progress"><div style="width:${geral}%"></div></div>
        <div class="small muted">${atual ? `${restantes} dia(s) restante(s) no mês` : mes < monthKey() ? 'Mês encerrado' : ''}</div>
      </div>

      <div class="grid grid-auto mb">
        ${linhas.map(l => `<div class="card">
          <div class="row between" style="align-items:flex-start">
            <div class="grow"><b style="font-size:17px">${esc(l.meta.nome)}</b>
              <div class="xs muted">${l.meta.tipo === 'celulares' ? 'Qualquer celular vendido, novo ou seminovo' : l.semProduto ? '<span class="red">Escolha os produtos desta meta</span>' : `${l.meta.produtoIds.length} produto(s) ligado(s)`}</div></div>
            ${l.feito >= l.alvo && l.alvo ? '<span class="pill green">Batida! 🏆</span>' : ''}
          </div>
          <div class="row" style="align-items:baseline;gap:6px;margin-top:10px"><span class="gold" style="font-size:34px;font-weight:800">${l.feito}</span><span class="muted">/ ${l.alvo}</span></div>
          <div class="progress" style="margin:8px 0"><div style="width:${l.pct}%"></div></div>
          <div class="row between xs muted"><span>${l.falta ? `Faltam <b style="color:var(--text)">${l.falta}</b>` : 'Meta cumprida'}</span>
            <span>${atual && l.falta && restantes ? `~${(l.falta / restantes).toFixed(1).replace('.', ',')} por dia` : ''}${atual && passados ? ` · projeção ${l.proj}` : ''}</span></div>
          ${l.semProduto && dono ? `<button class="btn sm outline-gold block mt" onclick="Pages.metas.escolherProdutos('${l.meta.id}')">${icon('plus', 'sm')} Escolher produtos</button>` : ''}
          <div class="row wrap between mt" style="border-top:1px dashed var(--line);padding-top:10px;gap:8px">
            <span class="xs muted" style="flex:1 1 100%">${l.meta.resetEm ? `${icon('repeat', 'sm')} ${l.meta.base ? `Ajustado para ${l.meta.base} em ${fmtDateTime(l.meta.resetEm)} + vendas depois disso` : `Contando desde ${fmtDateTime(l.meta.resetEm)}`}` : 'Contando o mês inteiro'}</span>
            ${dono ? `<span class="row wrap" style="gap:6px;margin-left:auto;justify-content:flex-end">${l.meta.resetEm ? `<button class="btn sm ghost" onclick="Pages.metas.zerar('${l.meta.id}', true)">${icon('undo', 'sm')} Desfazer</button>` : ''}
              <button class="btn sm" onclick="Pages.metas.ajustar('${l.meta.id}')">${icon('edit', 'sm')} Editar qtd.</button>
              <button class="btn sm" onclick="Pages.metas.zerar('${l.meta.id}')">${icon('repeat', 'sm')} Zerar</button></span>` : ''}
          </div>
        </div>`).join('')}
      </div>

      <div class="card mb">
        <div class="row between"><h3 style="margin:0">${icon('trending', 'sm')} Lucro por <span class="gold">aparelho</span></h3><span class="pill gold">Meta ${money(meta)} cada</span></div>
        <div class="grid grid-2 mt">
          <div class="stat"><div class="label">Média por aparelho</div><div class="value ${media >= meta ? 'green' : unid ? 'red' : ''}" style="font-size:22px;white-space:nowrap">${unid ? money(media) : '—'}</div><div class="sub">${unid} aparelho(s) com custo informado</div></div>
          <div class="stat"><div class="label">Vendas que bateram</div><div class="value">${bateram}<span class="muted" style="font-size:16px"> / ${comCusto.length}</span></div><div class="sub">lucro de ${money(meta)} ou mais</div></div>
        </div>
        <div class="mt"><div class="row between small"><span>Lucro com aparelhos no mês</span><b>${money(lucroTotal)} <span class="muted">/ ${money(alvoLucro)}</span></b></div>
          <div class="progress"><div style="width:${alvoLucro ? Math.min(100, lucroTotal / alvoLucro * 100) : 0}%"></div></div>
          <div class="xs muted">Meta do mês = ${metaCel?.alvo || 0} aparelhos × ${money(meta)}</div></div>
        <div class="row wrap between mt" style="border-top:1px dashed var(--line);padding-top:10px;gap:8px">
          <span class="xs muted" style="flex:1 1 100%">${cfg.lucroResetEm ? `${icon('repeat', 'sm')} Contando desde ${fmtDateTime(cfg.lucroResetEm)}` : 'Contando o mês inteiro'}</span>
          ${dono ? `<span class="row wrap" style="gap:6px;margin-left:auto;justify-content:flex-end">${cfg.lucroResetEm ? `<button class="btn sm ghost" onclick="Pages.metas.zerar('lucro', true)">${icon('undo', 'sm')} Desfazer</button>` : ''}
            <button class="btn sm" onclick="Pages.metas.zerar('lucro')">${icon('repeat', 'sm')} Zerar contagem</button></span>` : ''}
        </div>
        ${cels.length - comCusto.length ? `<div class="info-box mt">${icon('info')}<span>${cels.length - comCusto.length} aparelho(s) vendido(s) sem custo cadastrado não entram no cálculo de lucro (ex.: vendas importadas do sistema antigo).</span></div>` : ''}
        ${comCusto.length ? `<div class="lbl mt mb">Aparelhos vendidos</div>${comCusto.slice().sort((a, b) => String(b.venda.data).localeCompare(String(a.venda.data))).map(i => {
          const lu = i.lucro / i.qtd; const ok = lu >= meta;
          return `<div class="cart-line" style="cursor:pointer" onclick="VendasPage.detalheVenda('${i.venda.id}')"><div class="grow" style="min-width:0"><b class="ellipsis" style="display:block">${esc(i.nome)}</b><div class="xs muted">Venda #${i.venda.numero} · ${fmtDate(i.venda.data)} · ${money(i.preco)}</div></div>
            <div class="right"><b class="${ok ? 'green' : 'red'}">${money(lu)}</b><div class="xs ${ok ? 'green' : 'red'}">${ok ? '✓ bateu' : `faltou ${money(meta - lu)}`}</div></div></div>`;
        }).join('')}` : ''}
      </div>`;
    this.abas();
  },

  // Zera a contagem de uma meta (ou do lucro por aparelho): passa a contar só as vendas de agora em diante
  async zerar(id, desfazer) {
    if (!Cloud.ehDono()) return toast('Somente o dono altera as metas', true);
    const cfg = Metas.cfg();
    const meta = id === 'lucro' ? null : cfg.itens.find(i => i.id === id);
    const nome = meta ? meta.nome : 'Lucro por aparelho';
    if (desfazer) {
      if (meta) { delete meta.resetEm; delete meta.base; } else delete cfg.lucroResetEm;
      Store.save(); App.refresh(); return toast(`${nome}: voltou a contar o mês inteiro`);
    }
    if (!(await confirmDialog(`Zerar a contagem de "${nome}"? A meta passa a contar só as vendas feitas a partir de agora. As vendas não são apagadas e dá para desfazer.`, { ok: 'Zerar contagem' }))) return;
    if (meta) { meta.resetEm = nowISO(); delete meta.base; } else cfg.lucroResetEm = nowISO();
    Store.log('Meta zerada', nome);
    Store.save(); App.refresh(); toast(`${nome}: contagem zerada`);
  },

  // Corrige à mão quantos já foram vendidos; as próximas vendas continuam somando
  ajustar(id) {
    if (!Cloud.ehDono()) return toast('Somente o dono altera as metas', true);
    const meta = Metas.cfg().itens.find(i => i.id === id);
    const atual = Metas.progresso(meta, Metas.vendidos(monthKey())).feito;
    openModal({
      title: 'Editar quantidade vendida', icon: 'edit', subtitle: meta.nome,
      body: `<p class="small muted" style="margin-top:0">Informe quanto já foi vendido neste mês. A partir de agora, cada venda nova soma em cima desse número.</p>
        ${field('Quantidade já vendida', `<input class="input" id="aj-n" type="number" min="0" value="${atual}" style="font-size:28px;font-weight:800;text-align:center">`)}
        <div class="row" style="justify-content:center;gap:10px">${[-1, 1, 5].map(d => `<button class="btn sm" data-d="${d}">${d > 0 ? '+' : ''}${d}</button>`).join('')}</div>
        <p class="xs muted center">Meta: ${meta.alvo}</p>`,
      foot: `<button class="btn" data-close>Cancelar</button><button class="btn primary" id="aj-ok">${icon('check')} Salvar</button>`,
      onMount: (el, m) => {
        const inp = $('#aj-n', el); inp.select();
        $$('[data-d]', el).forEach(b => b.onclick = () => { inp.value = Math.max(0, (+inp.value || 0) + +b.dataset.d); });
        $('#aj-ok', el).onclick = () => {
          const n = Math.max(0, parseInt(inp.value) || 0);
          meta.resetEm = nowISO(); meta.base = n;
          Store.log('Meta ajustada', `${meta.nome}: ${n}`);
          Store.save(); m.close(); App.refresh(); toast(`${meta.nome}: ${n} vendido(s)`);
        };
      },
    });
  },

  mudarMes(d) {
    const [a, m] = (this.mes || monthKey()).split('-').map(Number);
    const dt = new Date(a, m - 1 + d, 1);
    this.mes = monthKey(dt) > monthKey() ? monthKey() : monthKey(dt);
    App.refresh();
  },

  editar() {
    if (!Cloud.ehDono()) return toast('Somente o dono altera as metas', true);
    const cfg = JSON.parse(JSON.stringify(Metas.cfg()));
    const m = openModal({
      title: 'Editar metas', icon: 'star', wide: true,
      body: `${field('Lucro mínimo por aparelho vendido (R$)', `<input class="input" id="mt-lucro" inputmode="decimal" value="${moneyInput(cfg.lucroPorAparelho)}">`)}
        <div class="lbl mb">Metas de quantidade no mês</div><div id="mt-lista"></div>
        <button class="btn outline-gold block" id="mt-add">${icon('plus')} Nova meta de produto</button>`,
      foot: `<button class="btn" data-close>Cancelar</button><button class="btn primary" id="mt-ok">${icon('check')} Salvar metas</button>`,
    });
    const el = m.el;
    const lista = () => {
      $('#mt-lista', el).innerHTML = cfg.itens.map((it, k) => `<div class="card mb" style="padding:12px 14px">
        <div class="row"><input class="input grow" data-nome="${k}" value="${esc(it.nome)}" ${it.tipo === 'celulares' ? '' : ''}>
          <input class="input" data-alvo="${k}" type="number" min="0" value="${it.alvo}" style="width:84px;text-align:center">
          ${it.tipo === 'celulares' ? '' : `<button class="icon-btn" data-rm="${k}">${icon('trash', 'sm')}</button>`}</div>
        <div class="xs muted mt">${it.tipo === 'celulares' ? 'Conta automaticamente qualquer celular vendido (novo ou seminovo).'
          : `${(it.produtoIds || []).map(id => Store.produto(id)?.nome).filter(Boolean).map(esc).join(' · ') || '<span class="red">Nenhum produto ligado</span>'}
             <button class="btn sm ghost" data-prod="${k}" style="min-height:28px;padding:2px 8px">${icon('edit', 'sm')} Produtos</button>`}</div></div>`).join('');
      $$('[data-nome]', el).forEach(i => i.oninput = () => { cfg.itens[+i.dataset.nome].nome = i.value; });
      $$('[data-alvo]', el).forEach(i => i.oninput = () => { cfg.itens[+i.dataset.alvo].alvo = +i.value || 0; });
      $$('[data-rm]', el).forEach(b => b.onclick = () => { cfg.itens.splice(+b.dataset.rm, 1); lista(); });
      $$('[data-prod]', el).forEach(b => b.onclick = () => this.escolherProdutos(null, cfg.itens[+b.dataset.prod], lista));
    };
    lista();
    $('#mt-add', el).onclick = () => { const it = { id: uid(), tipo: 'produtos', nome: 'Nova meta', alvo: 10, produtoIds: [] }; cfg.itens.push(it); lista(); this.escolherProdutos(null, it, lista); };
    $('#mt-ok', el).onclick = () => {
      if (cfg.itens.some(i => i.tipo === 'produtos' && !(i.produtoIds || []).length) && !confirm('Há metas sem produto ligado (não vão contar vendas). Salvar mesmo assim?')) return;
      cfg.lucroPorAparelho = parseMoney($('#mt-lucro', el).value);
      Store.s.metas = cfg; Store.save(); m.close(); App.refresh(); toast('Metas salvas');
    };
  },

  // Liga uma meta a produtos do cadastro (pode escolher vários: ex. todos os fones bluetooth)
  escolherProdutos(metaId, metaObj, depois) {
    const meta = metaObj || Metas.cfg().itens.find(i => i.id === metaId);
    const sel = new Set(meta.produtoIds || []);
    const prods = Store.db.produtos.filter(p => !p.deleted && !ehCelular(p)).sort((a, b) => a.nome.localeCompare(b.nome));
    const palavras = norm(meta.nome).split(/\s+/).filter(w => w.length > 3);
    const sugere = p => palavras.some(w => norm(p.nome).includes(w.replace(/s$/, '')));
    const m = openModal({
      title: `Produtos da meta: ${meta.nome}`, icon: 'tag',
      body: `<p class="small muted" style="margin-top:0">Marque os produtos que contam para esta meta. Sugestões pelo nome da meta aparecem primeiro.</p>
        ${inputIcon('search', 'id="ep-q" placeholder="Buscar produto..."')}
        <div id="ep-list" class="card pad-0 mt" style="max-height:46vh;overflow:auto"></div>
        <div class="info-box mt">${icon('info')}<span>Não achou? <a href="#" id="ep-novo">Cadastrar o produto "${esc(meta.nome)}"</a> agora.</span></div>`,
      foot: `<button class="btn" data-close>Cancelar</button><button class="btn primary" id="ep-ok">${icon('check')} Usar <span id="ep-n">${sel.size}</span> produto(s)</button>`,
    });
    const el = m.el;
    const render = () => {
      const q = $('#ep-q', el).value;
      const l = prods.filter(p => matches(q, p.nome, p.categoria, p.codigo)).sort((a, b) => (sel.has(b.id) - sel.has(a.id)) || (sugere(b) - sugere(a)) || a.nome.localeCompare(b.nome));
      $('#ep-list', el).innerHTML = l.slice(0, 150).map(p => `<label class="check" style="padding:10px 14px;border-bottom:1px solid var(--line)"><input type="checkbox" data-p="${p.id}" ${sel.has(p.id) ? 'checked' : ''}>
        <span class="grow">${esc(p.nome)}${sugere(p) && !sel.has(p.id) ? ' <span class="pill gold xs">sugestão</span>' : ''}<br><span class="xs muted">estoque ${p.qtd} · ${money(p.preco)}</span></span></label>`).join('') || '<div class="empty small">Nenhum produto</div>';
      $$('[data-p]', el).forEach(c => c.onchange = () => { c.checked ? sel.add(c.dataset.p) : sel.delete(c.dataset.p); $('#ep-n', el).textContent = sel.size; });
    };
    $('#ep-q', el).oninput = render; render();
    $('#ep-novo', el).onclick = e => { e.preventDefault(); m.close(); EstoquePage.editar('produto', null, { tipoProduto: 'acessorio', nome: meta.nome }); };
    $('#ep-ok', el).onclick = () => {
      meta.produtoIds = [...sel]; delete meta.autoBusca;
      if (!metaObj) { Store.save(); App.refresh(); toast('Produtos da meta atualizados'); }
      m.close(); depois && depois();
    };
  },
};

/* Metas por funcionário (plano Pro): valor vendido e OS concluídas no mês, por pessoa da equipe.
   Conta vendas/OS registradas a partir desta versão (que guardam quem fez); o histórico antigo não muda. */
const MetasEquipe = {
  progresso(uid, mes) {
    const vs = Store.db.vendas.filter(v => !v.cancelada && v.vendedorId === uid && monthKey(v.data) === mes);
    return {
      vendas: vs.reduce((s, v) => s + (Number(v.total) || 0), 0),
      celulares: vs.flatMap(v => v.itens || []).filter(i => i.aparelho || i.seminovo).reduce((s, i) => s + (i.qtd || 1), 0),
      // OS de quem finalizou; OS antigas que foram direto para "Pago" (sem quem finalizou) contam para quem abriu
      os: Store.db.os.filter(o => !o.deleted && (o.concluidoPor || o.criadoPor) === uid && o.concluidoEm && monthKey(o.concluidoEm) === mes).length,
    };
  },
  meta(uid) { return Store.db.metas_func.find(m => m.id === uid && !m.deleted) || { id: uid, alvoVendas: 0, alvoOS: 0, alvoCelulares: 0 }; },
  async render(box, mes) {
    let ms = [];
    try { ms = (await Cloud.membros()).filter(m => m.ativo !== false && m.papel !== 'suporte'); } catch { box.innerHTML = '<p class="small red">Sem conexão para carregar a equipe.</p>'; return; }
    const dono = Cloud.papel() === 'dono';
    if (!dono) ms = ms.filter(m => m.user_id === Cloud.user.id);
    const barra = (feito, alvo, fmt) => `<div class="row between xs"><span>${fmt(feito)}${alvo ? ` <span class="muted">/ ${fmt(alvo)}</span>` : ''}</span><b class="${alvo && feito >= alvo ? 'green' : 'gold'}">${alvo ? Math.min(100, Math.round(feito / alvo * 100)) + '%' : 'sem meta'}</b></div>
      <div class="progress" style="height:7px;margin:4px 0 10px"><div style="width:${alvo ? Math.min(100, feito / alvo * 100) : 0}%"></div></div>`;
    box.innerHTML = ms.map(m => {
      const p = this.progresso(m.user_id, mes), mt = this.meta(m.user_id);
      return `<div class="card mb"><div class="row between"><div class="row"><div class="avatar">${esc((m.nome || m.email || '?')[0].toUpperCase())}</div>
          <div><b>${esc(m.nome || m.email)}</b><div class="xs muted">${esc(PAPEIS[m.papel] || m.papel)}</div></div></div>
          ${dono ? `<button class="btn sm" data-mf="${m.user_id}">${icon('edit', 'sm')} Meta</button>` : ''}</div>
        <div class="mt"><div class="xs muted mb">Valor vendido</div>${barra(p.vendas, Number(mt.alvoVendas) || 0, money)}
        <div class="xs muted mb">Celulares vendidos</div>${barra(p.celulares, Number(mt.alvoCelulares) || 0, n => n)}
        <div class="xs muted mb">OS concluídas</div>${barra(p.os, Number(mt.alvoOS) || 0, n => n)}</div></div>`;
    }).join('') + `<p class="xs muted">Conta as vendas e OS concluídas registradas por cada pessoa (a partir desta versão). As metas da loja continuam na aba "Loja".</p>`;
    $$('[data-mf]', box).forEach(b => b.onclick = () => this.editar(b.dataset.mf, ms.find(m => m.user_id === b.dataset.mf)));
  },
  editar(uid, m) {
    const mt = { ...this.meta(uid) };
    openModal({
      title: 'Meta de ' + (m?.nome || m?.email || 'funcionário'), icon: 'star',
      body: `${field('Valor vendido no mês (R$)', `<input class="input" inputmode="decimal" name="alvoVendas" value="${mt.alvoVendas ? moneyInput(mt.alvoVendas) : ''}">`)}
        <div class="form-row">${field('Celulares vendidos', `<input class="input" type="number" min="0" name="alvoCelulares" value="${mt.alvoCelulares || ''}">`)}${field('OS concluídas', `<input class="input" type="number" min="0" name="alvoOS" value="${mt.alvoOS || ''}">`)}</div>
        <p class="xs muted">Vale para todos os meses até você mudar. Deixe em branco para não acompanhar.</p>`,
      foot: `<button class="btn" data-close>Cancelar</button><button class="btn primary" id="mf-ok">${icon('check')} Salvar</button>`,
      onMount: (el, md) => {
        $('#mf-ok', el).onclick = () => {
          const f = readForm(el);
          const reg = Store.db.metas_func.find(x => x.id === uid);
          const novo = { id: uid, nome: m?.nome || m?.email || '', alvoVendas: parseMoney(f.alvoVendas), alvoCelulares: parseInt(f.alvoCelulares) || 0, alvoOS: parseInt(f.alvoOS) || 0, atualizadoEm: nowISO() };
          if (reg) Object.assign(reg, novo, { deleted: false }); else Store.db.metas_func.push(novo);
          Store.save(); md.close(); App.refresh(); toast('Meta salva');
        };
      },
    });
  },
};
