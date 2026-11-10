/* Itens da OS e do orçamento: mão de obra (serviços) e peças, separados.
   - Serviço: { id, nome, qtd, valor, mecanicoId, garantiaDias, garantiaKm, servicoId }
   - Peça:    { id, pecaId?, nome, qtd, valor, custo, por, porNome, em, baixado }
     (pecaId = peça do estoque; sem pecaId = peça avulsa. "baixado" = quanto já saiu do estoque)
   - Total = mão de obra + peças − desconto. A OS continua gravando "valor" (o total), para os relatórios.
   - A peça do estoque baixa quando é lançada na OS e volta ao estoque se sair da OS (só na OS, nunca no orçamento). */
const OSItens = {
  soma(l) { return (l || []).reduce((s, i) => s + (Number(i.valor) || 0) * (Number(i.qtd) || 0), 0); },
  temItens(r) { return !!((r?.itensServico || []).length || (r?.itensPeca || []).length); },
  totais(r) {
    if (!this.temItens(r)) {
      const v = Number(r?.valor) || 0, d = Number(r?.desconto) || 0;
      return { mo: v, pe: 0, desconto: d, total: v - d, custo: (r?.pecas || []).reduce((s, p) => s + (p.custo || 0) * (p.qtd || 1), 0) };
    }
    const mo = this.soma(r.itensServico), pe = this.soma(r.itensPeca), desconto = Math.min(Number(r.desconto) || 0, mo + pe);
    const custo = (r.itensPeca || []).reduce((s, i) => s + (Number(i.custo) || 0) * (Number(i.qtd) || 0), 0) + (r.pecas || []).reduce((s, p) => s + (p.custo || 0) * (p.qtd || 1), 0);
    return { mo, pe, desconto, total: Math.round((mo + pe - desconto) * 100) / 100, custo };
  },
  // grava os totais no registro (o banco e o link do cliente leem daqui)
  gravarTotais(r) {
    if (!this.temItens(r)) return r;
    const k = this.totais(r);
    r.maoDeObra = k.mo; r.totalPecas = k.pe; r.total = k.total; r.valor = k.total;
    return r;
  },
  // desconto dividido proporcionalmente entre mão de obra e peças (para o financeiro)
  divisao(r) {
    const k = this.totais(r); const bruto = k.mo + k.pe;
    if (!bruto) return { maoDeObra: k.total, pecas: 0 };
    const mo = Math.round((k.mo - k.desconto * (k.mo / bruto)) * 100) / 100;
    return { maoDeObra: mo, pecas: Math.round((k.total - mo) * 100) / 100 };
  },

  /* Estoque: acerta a diferença entre o que já saiu (baixado) e o que está na OS agora.
     antes = itensPeca da versão anterior (para devolver o que saiu da OS). */
  baixarEstoque(o, antes = []) {
    const agora = o.itensPeca || [];
    for (const i of agora) {
      if (!i.pecaId) continue;
      const p = Store.peca(i.pecaId); if (!p) continue;
      const dif = Math.round(((Number(i.qtd) || 0) - (Number(i.baixado) || 0)) * 1000) / 1000;
      if (dif) Store.movimentar('peca', p, -dif, dif > 0 ? `Usada na OS #${o.numero}` : `Devolvida da OS #${o.numero}`);
      i.baixado = Number(i.qtd) || 0;
    }
    for (const a of antes || []) {
      if (!a.pecaId || !a.baixado || agora.some(x => x.id === a.id)) continue;
      const p = Store.peca(a.pecaId); if (p) Store.movimentar('peca', p, Number(a.baixado), `Devolvida da OS #${o.numero}`);
    }
  },

  /* ---------- editor (OS e orçamento) ---------- */
  // r: registro em edição (é alterado direto); modo: 'os' | 'orc'
  editorHTML(r, { modo = 'os' } = {}) {
    return `<div class="itens-ed" data-modo="${modo}">
      <div class="itens-sec"><div class="row between"><b>${icon('wrench', 'sm')} ${t('Mão de obra')}</b><span class="xs muted" data-it-sub="mo"></span></div>
        <div data-it-lista="servico"></div>
        <div class="row it-add" style="gap:8px"><select class="input grow" data-it-cat aria-label="${t('Serviço do catálogo')}"><option value="">${t('+ Serviço do catálogo')}</option></select><button type="button" class="btn outline-gold" data-it-novo="servico" title="${t('Serviço sem catálogo')}">${icon('plus')}</button></div></div>
      <div class="itens-sec"><div class="row between"><b>${icon('box', 'sm')} ${t('Peças')}</b><span class="xs muted" data-it-sub="pe"></span></div>
        <div data-it-lista="peca"></div>
        <div class="it-busca"><div class="row" style="gap:8px"><div class="input-icon grow">${icon('search')}<input class="input" data-it-q placeholder="${t('Buscar peça no estoque (nome, código, aplicação)')}" autocomplete="off"></div><button type="button" class="btn outline-gold" data-it-novo="peca" title="${t('Peça avulsa (fora do estoque)')}">${icon('plus')}</button></div><div data-it-res></div></div></div>
      <div class="form-row">${field('Desconto (R$)', `<input class="input" data-it-desc inputmode="decimal" placeholder="0,00" value="${r.desconto ? moneyInput(r.desconto) : ''}">`, { opt: true })}<div></div></div>
      <div class="card it-tot" data-it-tot></div></div>`;
  },
  ligar(root, r, { modo = 'os', onChange } = {}) {
    const ed = $('.itens-ed', root); if (!ed) return;
    r.itensServico = r.itensServico || []; r.itensPeca = r.itensPeca || [];
    const verCusto = Cloud.papel() !== 'tecnico';
    const tipo = r.veiculo?.tipo;
    const cat = $('[data-it-cat]', ed);
    const servs = Store.db.servicos.filter(s => !s.deleted && (!s.tipo || !tipo || s.tipo === tipo)).sort((a, b) => a.nome.localeCompare(b.nome));
    cat.insertAdjacentHTML('beforeend', servs.map(s => `<option value="${s.id}">${esc(s.nome)}${s.preco ? ' · ' + money(s.preco) : ''}</option>`).join(''));
    const mecs = Mecanicos.opcoes();
    const num = v => parseNum(v);
    const mudou = () => { this.gravarTotais(r); totais(); onChange && onChange(r); };
    const totais = () => {
      const k = this.totais(r);
      $('[data-it-sub=mo]', ed).textContent = money(k.mo); $('[data-it-sub=pe]', ed).textContent = money(k.pe);
      $('[data-it-tot]', ed).innerHTML = `<div class="kv"><span class="k">${t('Mão de obra')}</span><span class="v">${money(k.mo)}</span></div><div class="kv"><span class="k">${t('Peças')}</span><span class="v">${money(k.pe)}</span></div>
        ${k.desconto ? `<div class="kv"><span class="k">${t('Desconto')}</span><span class="v red">-${money(k.desconto)}</span></div>` : ''}
        <div class="kv"><span class="k bold">${t('Total')}</span><span class="v gold" data-it-total style="font-size:20px">${money(k.total)}</span></div>
        ${verCusto && k.custo ? `<div class="kv"><span class="k xs muted">${t('Custo das peças')}</span><span class="v xs muted">${money(k.custo)}</span></div>` : ''}`;
    };
    const linhaServ = (i, n) => `<div class="it-linha" data-i="${n}">
      <div class="row" style="gap:6px"><input class="input grow" data-f="nome" value="${esc(i.nome)}" placeholder="${t('Serviço')}" aria-label="${t('Serviço')}"><button type="button" class="icon-btn" data-rm="servico" data-i="${n}" title="${t('Tirar')}">${icon('trash', 'sm')}</button></div>
      <div class="it-grade"><label><span>${t('Qtd')}</span><input class="input" data-f="qtd" inputmode="decimal" value="${fmtQtd(i.qtd)}"></label>
        <label><span>${t('Valor')}</span><input class="input" data-f="valor" inputmode="decimal" value="${moneyInput(i.valor)}"></label>
        <label><span>${t('Mecânico')}</span><select class="input" data-f="mecanicoId"><option value="">${t('Oficina')}</option>${selectOpts(mecs, i.mecanicoId)}</select></label>
        <label><span>${t('Garantia (dias)')}</span><input class="input" data-f="garantiaDias" inputmode="numeric" value="${i.garantiaDias ?? ''}"></label>
        <label><span>${t('Garantia (km)')}</span><input class="input" data-f="garantiaKm" inputmode="numeric" value="${i.garantiaKm ? fmtKm(i.garantiaKm, false) : ''}"></label></div></div>`;
    const linhaPeca = (i, n) => `<div class="it-linha" data-i="${n}">
      <div class="row" style="gap:6px"><input class="input grow" data-f="nome" value="${esc(i.nome)}" placeholder="${t('Peça')}" aria-label="${t('Peça')}" ${i.pecaId ? 'readonly' : ''}><button type="button" class="icon-btn" data-rm="peca" data-i="${n}" title="${t(modo === 'os' && i.pecaId ? 'Tirar e devolver ao estoque' : 'Tirar')}">${icon('trash', 'sm')}</button></div>
      <div class="it-grade"><label><span>${t('Qtd')}</span><input class="input" data-f="qtd" inputmode="decimal" value="${fmtQtd(i.qtd)}"></label>
        <label><span>${t('Valor')}</span><input class="input" data-f="valor" inputmode="decimal" value="${moneyInput(i.valor)}"></label>
        ${verCusto ? `<label><span>${t('Custo')}</span><input class="input" data-f="custo" inputmode="decimal" value="${moneyInput(i.custo)}"></label>` : ''}</div>
      <div class="xs muted">${i.pecaId ? `${icon('box', 'sm')} ${t('Do estoque')}` : t('Avulsa (fora do estoque)')}${i.porNome ? ` · ${t('lançada por')} <span data-no-i18n>${esc(i.porNome)}</span>` : ''}${i.em ? ` · ${fmtDateTime(i.em)}` : ''}</div></div>`;
    const desenhar = () => {
      $('[data-it-lista=servico]', ed).innerHTML = r.itensServico.map(linhaServ).join('') || `<div class="xs muted it-vazio">${t('Nenhum serviço ainda.')}</div>`;
      $('[data-it-lista=peca]', ed).innerHTML = r.itensPeca.map(linhaPeca).join('') || `<div class="xs muted it-vazio">${t('Nenhuma peça ainda.')}</div>`;
      $$('[data-it-lista] [data-f]', ed).forEach(inp => {
        const lista = inp.closest('[data-it-lista]').dataset.itLista === 'servico' ? r.itensServico : r.itensPeca;
        const it = lista[+inp.closest('.it-linha').dataset.i], f = inp.dataset.f;
        const ler = () => {
          if (f === 'nome') it.nome = inp.value;
          else if (f === 'qtd') it.qtd = Math.max(0, num(inp.value));
          else if (f === 'valor' || f === 'custo') it[f] = parseMoney(inp.value);
          else if (f === 'garantiaDias') it.garantiaDias = inp.value === '' ? null : parseInt(inp.value, 10) || 0;
          else if (f === 'garantiaKm') { const d = onlyDigits(inp.value); it.garantiaKm = parseInt(d, 10) || 0; }
          else it[f] = inp.value || null;
          mudou();
        };
        inp.oninput = ler; inp.onchange = ler;
      });
      $$('[data-rm]', ed).forEach(b => b.onclick = () => { (b.dataset.rm === 'servico' ? r.itensServico : r.itensPeca).splice(+b.dataset.i, 1); desenhar(); mudou(); });
      totais();
    };
    const quem = () => { const q = Store.quem(); return q.id ? { por: q.id, porNome: q.nome } : {}; };
    cat.onchange = () => {
      const s = Store.db.servicos.find(x => x.id === cat.value); cat.value = ''; if (!s) return;
      r.itensServico.push({ id: uid(), servicoId: s.id, nome: s.nome, qtd: 1, valor: Number(s.preco) || 0, mecanicoId: r.mecanicoId || null, garantiaDias: s.garantiaDias ?? null, garantiaKm: s.garantiaKm || 0 });
      desenhar(); mudou();
    };
    $$('[data-it-novo]', ed).forEach(b => b.onclick = () => {
      if (b.dataset.itNovo === 'servico') r.itensServico.push({ id: uid(), nome: '', qtd: 1, valor: 0, mecanicoId: r.mecanicoId || null, garantiaDias: null, garantiaKm: 0 });
      else r.itensPeca.push({ id: uid(), pecaId: null, nome: '', qtd: 1, valor: 0, custo: 0, em: nowISO(), ...quem() });
      desenhar(); mudou();
      const ls = $(`[data-it-lista=${b.dataset.itNovo}] .it-linha:last-child [data-f=nome]`, ed); ls?.focus();
    });
    const q = $('[data-it-q]', ed), res = $('[data-it-res]', ed);
    q.oninput = () => {
      const v = q.value.trim(); if (!v) { res.innerHTML = ''; return; }
      const l = Pecas.buscar(v).slice(0, 6);
      res.innerHTML = `<div class="card pad-0 mt">${l.map(p => `<div class="item" data-pc="${p.id}" style="padding:10px 14px"><div class="row between"><div class="grow" style="min-width:0"><b class="ellipsis" style="display:block">${esc(p.nome)}</b><div class="xs muted ellipsis">${esc([p.codigo, p.aplicacao].filter(Boolean).join(' · '))}</div></div><div class="right"><b class="gold">${money(p.preco)}</b><div class="xs ${p.qtd > 0 ? 'muted' : 'red'}">${t('Estoque')}: ${fmtQtd(p.qtd)}</div></div></div></div>`).join('') || `<div class="empty small">${t('Nada no estoque. Use + para peça avulsa.')}</div>`}</div>`;
      $$('[data-pc]', res).forEach(it => it.onclick = () => {
        const p = Store.peca(it.dataset.pc);
        const ja = r.itensPeca.find(x => x.pecaId === p.id);
        if (ja) ja.qtd = (Number(ja.qtd) || 0) + 1;
        else r.itensPeca.push({ id: uid(), pecaId: p.id, nome: p.nome, qtd: 1, valor: Number(p.preco) || 0, custo: Number(p.custo) || 0, em: nowISO(), ...quem() });
        if (p.qtd < 1) toast(t('Atenção: "{p}" está sem estoque', { p: p.nome }), true);
        Pecas.usada(p.id);
        q.value = ''; res.innerHTML = ''; desenhar(); mudou();
      });
    };
    $('[data-it-desc]', ed).oninput = e => { r.desconto = parseMoney(e.target.value); mudou(); };
    desenhar();
  },

  // lista para mostrar (detalhe da OS, orçamento)
  resumoHTML(r, { custo = false } = {}) {
    const k = this.totais(r);
    const ln = (i, peca) => `<div class="kv"><span class="k"><span data-no-i18n>${Number(i.qtd) !== 1 ? fmtQtd(i.qtd) + 'x ' : ''}${esc(i.nome)}</span>${!peca && i.mecanicoId ? ` <span class="xs muted" data-no-i18n>· ${esc(Mecanicos.nome(i.mecanicoId))}</span>` : ''}${peca && custo && i.custo ? ` <span class="xs muted">· ${t('custo')} ${money(i.custo * i.qtd)}</span>` : ''}</span><span class="v">${money((Number(i.valor) || 0) * (Number(i.qtd) || 0))}</span></div>`;
    if (!this.temItens(r)) return `<div class="kv"><span class="k">${t('Valor')}</span><span class="v">${money(Number(r.valor) || 0)}</span></div>${r.desconto ? `<div class="kv"><span class="k">${t('Desconto')}</span><span class="v red">-${money(r.desconto)}</span></div>` : ''}<div class="kv"><span class="k bold">${t('Total')}</span><span class="v gold" style="font-size:20px">${money(k.total)}</span></div>`;
    return `${(r.itensServico || []).length ? `<div class="lbl">${t('Mão de obra')}</div>${r.itensServico.map(i => ln(i, false)).join('')}` : ''}
      ${(r.itensPeca || []).length ? `<div class="lbl mt">${t('Peças')}</div>${r.itensPeca.map(i => ln(i, true)).join('')}` : ''}
      <div class="kv mt"><span class="k">${t('Mão de obra')}</span><span class="v">${money(k.mo)}</span></div><div class="kv"><span class="k">${t('Peças')}</span><span class="v">${money(k.pe)}</span></div>
      ${k.desconto ? `<div class="kv"><span class="k">${t('Desconto')}</span><span class="v red">-${money(k.desconto)}</span></div>` : ''}
      <div class="kv"><span class="k bold">${t('Total')}</span><span class="v gold" style="font-size:20px">${money(k.total)}</span></div>
      ${custo ? `<div class="kv"><span class="k">${t('Custo das peças')}</span><span class="v red">-${money(k.custo)}</span></div><div class="kv"><span class="k">${t('Lucro bruto')}</span><span class="v green">${money(k.total - k.custo)}</span></div>` : ''}`;
  },
  // texto para WhatsApp
  textoWhats(r) {
    const k = this.totais(r);
    const l = [...(r.itensServico || []).map(i => `• ${i.nome}${Number(i.qtd) !== 1 ? ` (x${fmtQtd(i.qtd)})` : ''}: ${money(i.valor * i.qtd)}`),
      ...(r.itensPeca || []).map(i => `• ${i.nome}${Number(i.qtd) !== 1 ? ` (x${fmtQtd(i.qtd)})` : ''}: ${money(i.valor * i.qtd)}`)];
    return `${l.join('\n')}\n\n${t('Mão de obra')}: ${money(k.mo)}\n${t('Peças')}: ${money(k.pe)}${k.desconto ? `\n${t('Desconto')}: -${money(k.desconto)}` : ''}\n*${t('Total')}: ${money(k.total)}*`;
  },
};

// Busca de peças do estoque: palavras soltas em qualquer ordem, por nome, código ou aplicação; as usadas há pouco primeiro
const Pecas = {
  chave: 'oficina_pecas_recentes',
  recentes() { try { return JSON.parse(localStorage.getItem(this.chave) || '[]'); } catch { return []; } },
  usada(id) { try { const l = [id, ...this.recentes().filter(x => x !== id)].slice(0, 20); localStorage.setItem(this.chave, JSON.stringify(l)); } catch {} },
  buscar(q) {
    const ps = Store.db.pecas.filter(p => !p.deleted);
    const rec = this.recentes();
    const ordem = p => { const i = rec.indexOf(p.id); return i < 0 ? 999 : i; };
    if (!q) return ps.filter(p => rec.includes(p.id)).sort((a, b) => ordem(a) - ordem(b));
    const cod = onlyDigits(q);
    const palavras = norm(q).split(/\s+/).filter(Boolean);
    return ps.filter(p => {
      const txt = norm([p.nome, p.codigo, p.aplicacao, p.compat, p.marca, p.categoria].join(' '));
      return palavras.every(w => txt.includes(w)) || (cod.length >= 6 && onlyDigits(p.codigo) === cod);
    }).sort((a, b) => ordem(a) - ordem(b) || a.nome.localeCompare(b.nome));
  },
};
