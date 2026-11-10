/* Metas do mês da oficina e de cada mecânico.
   - OS concluídas contam para o MECÂNICO RESPONSÁVEL escolhido na OS. Sem mecânico escolhido (ou com um
     mecânico que não existe mais), contam para a OFICINA: nunca para um funcionário "fantasma".
   - OS que vai direto para "Pago" também conta (a data é a da conclusão ou a do pagamento) e guarda quem finalizou.
   - Mão de obra de cada serviço conta para o mecânico do serviço (ou o da OS). */
const META_TIPOS = {
  os: ['OS concluídas', n => String(n)],
  maoDeObra: ['Mão de obra (R$)', v => money(v)],
  pecas: ['Peças vendidas (R$)', v => money(v)],
  faturamento: ['Faturamento (R$)', v => money(v)],
  servico: ['Serviço do catálogo (quantidade)', n => fmtQtd(n)],
};
const Metas = {
  // Configuração guardada nas configurações da oficina (sincroniza com a nuvem)
  cfg() {
    const s = Store.s;
    if (!s.metas || !Array.isArray(s.metas.itens) || s.metas.itens.some(i => !META_TIPOS[i.tipo])) {
      s.metas = { itens: [
        { id: uid(), tipo: 'os', nome: 'OS concluídas', alvo: 60 },
        { id: uid(), tipo: 'maoDeObra', nome: 'Mão de obra', alvo: 25000 },
        { id: uid(), tipo: 'pecas', nome: 'Peças vendidas', alvo: 15000 },
        { id: uid(), tipo: 'servico', nome: 'Revisões', alvo: 20, servico: 'revis' },
      ] };
      if (Cloud.podeEscrever()) Store.save(); // somente leitura: só usa na tela
    }
    return s.metas;
  },
  // OS que fecharam no mês (pronta ou paga)
  osDoMes(mes) { return Store.db.os.filter(o => !o.deleted && (o.concluidoEm || o.pagoEm) && monthKey(o.concluidoEm || o.pagoEm) === mes); },
  // para quem conta a OS: o mecânico responsável, se ele existir; senão a oficina
  dono(o, ids) { const m = o.mecanicoId || o.tecnicoId; return m && ids.has(m) ? m : 'oficina'; },
  // números do mês: da oficina toda e por mecânico
  numeros(mes) {
    const mecs = Mecanicos.lista(), ids = new Set(mecs.map(m => m.id));
    const por = { oficina: { os: 0, maoDeObra: 0 } }; mecs.forEach(m => { por[m.id] = { os: 0, maoDeObra: 0 }; });
    const geral = { os: 0, maoDeObra: 0, pecas: 0, faturamento: 0, servicos: {} };
    for (const o of this.osDoMes(mes)) {
      const d = this.dono(o, ids); por[d].os++; geral.os++;
      const k = OSItens.totais(o), div = OSItens.divisao(o);
      if (OSItens.temItens(o)) {
        for (const i of o.itensServico || []) { const md = i.mecanicoId && ids.has(i.mecanicoId) ? i.mecanicoId : d; por[md].maoDeObra += (Number(i.valor) || 0) * (Number(i.qtd) || 0); geral.servicos[norm(i.nome)] = (geral.servicos[norm(i.nome)] || 0) + (Number(i.qtd) || 0); }
      } else { por[d].maoDeObra += k.total; geral.servicos[norm(o.servico || '')] = (geral.servicos[norm(o.servico || '')] || 0) + 1; }
      geral.maoDeObra += div.maoDeObra; geral.pecas += div.pecas; geral.faturamento += k.total;
    }
    for (const v of Store.db.vendas) if (!v.cancelada && monthKey(v.data) === mes) { geral.pecas += Number(v.total) || 0; geral.faturamento += Number(v.total) || 0; }
    return { geral, por, mecs };
  },
  progresso(meta, n) {
    if (meta.tipo === 'servico') { const q = norm(meta.servico || meta.nome); return Object.entries(n.geral.servicos).filter(([k]) => q && k.includes(q)).reduce((s, [, v]) => s + v, 0); }
    return n.geral[meta.tipo] || 0;
  },
};

Pages.metas = {
  mes: null, aba: 'oficina',
  render(main) {
    const cfg = Metas.cfg(), dono = Cloud.ehDono();
    const mes = this.mes || monthKey();
    const [ano, m] = mes.split('-').map(Number);
    const diasMes = new Date(ano, m, 0).getDate();
    const atual = mes === monthKey();
    const passados = atual ? new Date().getDate() : mes < monthKey() ? diasMes : 0;
    const n = Metas.numeros(mes);
    const nomeMes = (s => s.charAt(0).toUpperCase() + s.slice(1))(new Date(ano, m - 1, 1).toLocaleDateString(loc(), { month: 'long', year: 'numeric' }));
    const pro = true;   // a tela inteira já depende do recurso "metas" do plano
    main.innerHTML = `
      ${pageHead('star', 'Metas', 'Metas do mês da oficina e de cada mecânico.')}
      <div class="row between wrap mb" style="gap:8px">
        <div class="row" style="gap:6px"><button class="icon-btn" id="mt-ant" title="Mês anterior">${icon('arrowLeft')}</button><b style="min-width:150px;text-align:center">${esc(nomeMes)}</b><button class="icon-btn" id="mt-prox" title="Próximo mês" ${atual ? 'disabled' : ''}>${icon('arrowRight')}</button></div>
        ${dono && this.aba === 'oficina' ? `<button class="btn" id="mt-editar">${icon('edit')} ${t('Editar metas')}</button>` : ''}
      </div>
      <div class="tabs mb" id="mt-abas" style="display:inline-flex">${[['oficina', 'Oficina'], ['mecanicos', 'Mecânicos']].map(([k, l]) => `<button data-k="${k}" class="${this.aba === k ? 'on' : ''}">${t(l)}</button>`).join('')}</div>
      <div id="mt-corpo"></div>`;
    const corpo = $('#mt-corpo');
    if (this.aba === 'oficina') {
      corpo.innerHTML = cfg.itens.map(meta => {
        const feito = Metas.progresso(meta, n), alvo = Number(meta.alvo) || 0, pct = alvo ? Math.min(100, feito / alvo * 100) : 0;
        const proj = passados ? feito / passados * diasMes : 0, fmt = META_TIPOS[meta.tipo][1];
        return `<div class="card mb"><div class="row between"><b>${esc(meta.nome)}</b><span class="pill ${pct >= 100 ? 'green' : 'gold'}">${Math.round(pct)}%</span></div>
          <div class="row between mt small"><span>${fmt(feito)} <span class="muted">/ ${fmt(alvo)}</span></span>${atual && passados ? `<span class="muted">${t('Projeção')}: ${fmt(Math.round(proj))}</span>` : ''}</div>
          <div class="progress" style="height:9px;margin-top:6px"><div style="width:${pct}%"></div></div></div>`;
      }).join('') || `<div class="empty">${t('Nenhuma meta.')}</div>`;
    } else if (!pro) {
      corpo.innerHTML = `<div class="card">${t('Metas por mecânico fazem parte do plano')} <b class="gold">Pro</b>. <a href="#/plano">${t('Ver planos')}</a></div>`;
    } else {
      const linha = (id, nome, papel) => {
        const p = n.por[id] || { os: 0, maoDeObra: 0 }, mt = Store.db.metas_func.find(x => x.id === id && !x.deleted) || {};
        const barra = (feito, alvo, fmt) => `<div class="row between xs"><span>${fmt(feito)}${alvo ? ` <span class="muted">/ ${fmt(alvo)}</span>` : ''}</span><b class="${alvo && feito >= alvo ? 'green' : 'gold'}">${alvo ? Math.min(100, Math.round(feito / alvo * 100)) + '%' : t('sem meta')}</b></div>
          <div class="progress" style="height:7px;margin:4px 0 10px"><div style="width:${alvo ? Math.min(100, feito / alvo * 100) : 0}%"></div></div>`;
        return `<div class="card mb"><div class="row between"><div class="row"><div class="avatar">${esc((nome || '?')[0].toUpperCase())}</div><div><b data-no-i18n>${esc(nome)}</b><div class="xs muted">${esc(papel)}</div></div></div>
            ${dono && id !== 'oficina' ? `<button class="btn sm" data-mf="${esc(id)}">${icon('edit', 'sm')} ${t('Meta')}</button>` : ''}</div>
          <div class="mt"><div class="xs muted mb">${t('OS concluídas')}</div>${barra(p.os, Number(mt.alvoOS) || 0, x => String(x))}
          <div class="xs muted mb">${t('Mão de obra')}</div>${barra(p.maoDeObra, Number(mt.alvoMaoDeObra) || 0, money)}</div></div>`;
      };
      const meu = Cloud.papel() === 'tecnico' ? Cloud.user?.id : null;
      const lista = n.mecs.filter(x => !meu || x.id === meu);
      corpo.innerHTML = (lista.map(x => linha(x.id, x.nome, t('Mecânico'))).join('') || `<div class="card mb small muted">${t('Nenhum mecânico cadastrado. Cadastre em Configurações → Mecânicos ou adicione um funcionário com o papel Mecânico.')}</div>`)
        + (meu ? '' : linha('oficina', Store.s.loja || t('Oficina'), t('OS sem mecânico escolhido')))
        + `<p class="xs muted">${t('A OS conta para o mecânico responsável escolhido na OS. Sem mecânico, conta para a oficina.')}</p>`;
      $$('[data-mf]', corpo).forEach(b => b.onclick = () => this.editarMecanico(b.dataset.mf, n.mecs.find(x => x.id === b.dataset.mf)));
    }
    $$('#mt-abas button').forEach(b => b.onclick = () => { this.aba = b.dataset.k; App.refresh(); });
    const mover = d => { const dt = new Date(ano, m - 1 + d, 1); this.mes = monthKey(dt); App.refresh(); };
    $('#mt-ant').onclick = () => mover(-1); $('#mt-prox').onclick = () => { if (!atual) mover(1); };
    const ed = $('#mt-editar'); if (ed) ed.onclick = () => this.editar();
  },

  editar() {
    const cfg = JSON.parse(JSON.stringify(Metas.cfg()));
    const m = openModal({
      title: 'Metas da oficina', icon: 'star', wide: true, body: '<div id="mt-ed"></div>',
      foot: `<button class="btn" data-close>Cancelar</button><button class="btn primary" id="mt-ok">${icon('check')} Salvar</button>`,
    });
    const el = m.el;
    const desenhar = () => {
      $('#mt-ed', el).innerHTML = cfg.itens.map((it, k) => `<div class="card mb" style="background:var(--bg-2)"><div class="form-row">
          ${field('Nome', `<input class="input" data-k="${k}" data-f="nome" value="${esc(it.nome)}">`)}
          ${field('Tipo', `<select class="input" data-k="${k}" data-f="tipo">${selectOpts(Object.fromEntries(Object.entries(META_TIPOS).map(([x, [l]]) => [x, t(l)])), it.tipo)}</select>`)}</div>
          <div class="form-row">${field('Alvo do mês', `<input class="input" inputmode="decimal" data-k="${k}" data-f="alvo" value="${it.alvo || ''}">`)}
          ${it.tipo === 'servico' ? field('Nome do serviço (parte)', `<input class="input" data-k="${k}" data-f="servico" placeholder="${t('Ex: revisão')}" value="${esc(it.servico || '')}">`) : '<div></div>'}</div>
          <button class="btn sm ghost" data-rm="${k}">${icon('trash', 'sm')} ${t('Tirar meta')}</button></div>`).join('')
        + `<button class="btn outline-gold block" id="mt-add">${icon('plus')} ${t('Nova meta')}</button>`;
      $$('[data-f]', el).forEach(i => i.onchange = () => { const it = cfg.itens[+i.dataset.k]; it[i.dataset.f] = i.dataset.f === 'alvo' ? parseNum(i.value) : i.value; if (i.dataset.f === 'tipo') desenhar(); });
      $$('[data-rm]', el).forEach(b => b.onclick = () => { cfg.itens.splice(+b.dataset.rm, 1); desenhar(); });
      $('#mt-add', el).onclick = () => { cfg.itens.push({ id: uid(), tipo: 'os', nome: t('Nova meta'), alvo: 10 }); desenhar(); };
    };
    desenhar();
    $('#mt-ok', el).onclick = () => { $$('[data-f]', el).forEach(i => i.onchange()); Store.s.metas = cfg; Store.save(); m.close(); App.refresh(); toast('Metas salvas'); };
  },

  editarMecanico(id, mec) {
    const mt = { ...(Store.db.metas_func.find(x => x.id === id) || { id }) };
    openModal({
      title: t('Meta de {n}', { n: mec?.nome || t('mecânico') }), icon: 'star',
      body: `<div class="form-row">${field('OS concluídas no mês', `<input class="input" type="number" min="0" name="alvoOS" value="${mt.alvoOS || ''}">`)}${field('Mão de obra no mês (R$)', `<input class="input" inputmode="decimal" name="alvoMaoDeObra" value="${mt.alvoMaoDeObra ? moneyInput(mt.alvoMaoDeObra) : ''}">`)}</div>
        <p class="xs muted">${t('Vale para todos os meses até você mudar. Deixe em branco para não acompanhar.')}</p>`,
      foot: `<button class="btn" data-close>Cancelar</button><button class="btn primary" id="mf-ok">${icon('check')} Salvar</button>`,
      onMount: (el, md) => {
        $('#mf-ok', el).onclick = () => {
          const f = readForm(el);
          const reg = Store.db.metas_func.find(x => x.id === id);
          const novo = { id, nome: mec?.nome || '', alvoOS: parseInt(f.alvoOS, 10) || 0, alvoMaoDeObra: parseMoney(f.alvoMaoDeObra), atualizadoEm: nowISO() };
          if (reg) Object.assign(reg, novo, { deleted: false }); else Store.db.metas_func.push(novo);
          Store.save(); md.close(); App.refresh(); toast('Meta salva');
        };
      },
    });
  },
};
