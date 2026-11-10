/* Importar estoque pelo XML da NF-e de compra (layout oficial da NF-e, versão 4.00).
   Prévia → ajuste/mapeamento → confirmação. Cada item vira um lote. A mesma chave não entra duas vezes na oficina. */
const NFe = {
  // Lê o XML e devolve { chave, numero, serie, data, fornecedor: {cnpj, nome}, total, itens: [...] }
  ler(texto) {
    const doc = new DOMParser().parseFromString(texto, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) throw new Error('Arquivo XML inválido');
    const um = (el, nome) => el && el.getElementsByTagNameNS('*', nome)[0];
    const txt = (el, nome) => (um(el, nome)?.textContent || '').trim();
    const inf = um(doc, 'infNFe');
    if (!inf) throw new Error('Este XML não é de uma NF-e (falta infNFe)');
    const chave = (txt(doc, 'chNFe') || (inf.getAttribute('Id') || '').replace(/^NFe/, '')).replace(/\D/g, '');
    if (chave.length !== 44) throw new Error('Chave de acesso da NF-e não encontrada');
    const ide = um(inf, 'ide'), emit = um(inf, 'emit');
    const num = v => Number(String(v || '0').replace(',', '.')) || 0;
    const itens = [...inf.getElementsByTagNameNS('*', 'det')].map(det => {
      const p = um(det, 'prod');
      const qtd = num(txt(p, 'qCom')), vUn = num(txt(p, 'vUnCom')), vProd = num(txt(p, 'vProd'));
      const desc = num(txt(p, 'vDesc')), frete = num(txt(p, 'vFrete')), outros = num(txt(p, 'vOutro'));
      return {
        nItem: det.getAttribute('nItem'), codigo: txt(p, 'cProd'), ean: /^\d{8,14}$/.test(txt(p, 'cEAN')) ? txt(p, 'cEAN') : '',
        nome: txt(p, 'xProd'), ncm: txt(p, 'NCM'), unidade: txt(p, 'uCom'), qtd,
        // custo unitário real: valor do item + frete/outros − desconto, dividido pela quantidade
        custo: qtd ? Math.round(((vProd || vUn * qtd) + frete + outros - desc) / qtd * 100) / 100 : vUn,
      };
    });
    if (!itens.length) throw new Error('A nota não tem itens');
    return {
      chave, numero: txt(ide, 'nNF'), serie: txt(ide, 'serie'), data: txt(ide, 'dhEmi') || txt(ide, 'dEmi'),
      fornecedor: { cnpj: txt(emit, 'CNPJ') || txt(emit, 'CPF'), nome: txt(emit, 'xFant') || txt(emit, 'xNome'), razao: txt(emit, 'xNome') },
      total: num(txt(um(inf, 'ICMSTot'), 'vNF')), itens,
    };
  },

  jaImportada(chave) { return Store.db.nfe_entradas.find(n => n.id === chave && !n.deleted); },

  // Confere também no servidor (outro dispositivo pode ter importado agora)
  async jaImportadaNaNuvem(chave) {
    if (!Cloud.enabled || !Cloud.loja || !Cloud.sb) return false;
    const { data, error } = await Cloud.sb.from('itens').select('id').eq('loja_id', Cloud.loja.id).eq('colecao', 'nfe_entradas').eq('id', chave);
    if (error) throw new Error('Sem conexão para conferir se a nota já foi importada. Tente de novo com internet.');
    return (data || []).length > 0;
  },

  // Sugestões de item do estoque para cada linha da nota (código, EAN ou nome parecido)
  sugestoes(it) {
    const todos = [...Store.db.produtos.filter(p => !p.deleted).map(p => ['produto', p]), ...Store.db.pecas.filter(p => !p.deleted).map(p => ['peca', p])];
    const palavras = norm(it.nome).split(/\s+/).filter(w => w.length > 2);
    return todos.map(([tipo, p]) => {
      let sc = 0;
      if (it.ean && (p.codigo === it.ean || p.ean === it.ean)) sc += 100;
      if (it.codigo && p.codigo && p.codigo === it.codigo) sc += 60;
      const n = norm(p.nome); sc += palavras.filter(w => n.includes(w)).length * 10;
      return { tipo, p, sc };
    }).filter(x => x.sc >= 20).sort((a, b) => b.sc - a.sc).slice(0, 8);
  },

  abrir() {
    if (!Cloud.temRecurso('importar_xml')) return App.go('plano');
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = '.xml,text/xml,application/xml';
    inp.onchange = () => {
      const f = inp.files[0]; if (!f) return;
      if (f.size > 2 * 1024 * 1024) return toast('Arquivo muito grande para uma NF-e', true);
      const rd = new FileReader();
      rd.onload = () => { try { this.previa(this.ler(rd.result)); } catch (e) { toast(e.message, true); } };
      rd.readAsText(f);
    };
    inp.click();
  },

  previa(n) {
    const dup = this.jaImportada(n.chave);
    if (dup) return toast(`Esta nota já foi importada em ${fmtDate(dup.importadoEm)}.`, true);
    const linhas = n.itens.map(it => {
      const sug = this.sugestoes(it);
      return { ...it, incluir: true, destino: sug[0]?.sc >= 60 ? `${sug[0].tipo}:${sug[0].p.id}` : 'novo:produto', sug, preco: 0 };
    });
    const m = openModal({
      title: `NF-e ${n.numero ? 'nº ' + esc(n.numero) : ''}`, icon: 'upload', wide: true,
      subtitle: `${esc(n.fornecedor.nome || 'Fornecedor')} · ${n.data ? fmtDate(n.data) : ''} · ${money(n.total)}`,
      body: `<div class="card mb" style="background:var(--bg-2)">
          <div class="kv"><span class="k">Fornecedor</span><span class="v">${esc(n.fornecedor.razao || n.fornecedor.nome)}${n.fornecedor.cnpj ? ` · ${esc(n.fornecedor.cnpj)}` : ''}</span></div>
          <div class="kv"><span class="k">Chave</span><span class="v xs" style="font-family:ui-monospace,monospace;word-break:break-all">${esc(n.chave)}</span></div>
          <div class="kv"><span class="k">Itens</span><span class="v">${n.itens.length} · total ${money(n.total)}</span></div></div>
        <p class="small muted" style="margin-top:0">Confira cada item: escolha se ele <b>soma num item que já existe</b> ou vira um <b>cadastro novo</b>. Quantidade e custo podem ser ajustados. Cada item vira um <b>lote</b>.</p>
        <div id="nf-itens"></div>
        <label class="check mt"><input type="checkbox" id="nf-desp" checked> Lançar ${money(n.total)} como compra de estoque no financeiro</label>`,
      foot: `<button class="btn" data-close>Cancelar</button><button class="btn primary" id="nf-ok" style="flex:2">${icon('check')} Importar para o estoque</button>`,
    });
    const el = m.el;
    const desenhar = () => {
      $('#nf-itens', el).innerHTML = linhas.map((l, i) => `<div class="card mb" style="padding:12px;${l.incluir ? '' : 'opacity:.45'}">
        <label class="check" style="padding:0 0 6px"><input type="checkbox" data-inc="${i}" ${l.incluir ? 'checked' : ''}> <b>${esc(l.nome)}</b></label>
        <div class="xs muted mb">${l.codigo ? 'Cód. ' + esc(l.codigo) : ''}${l.ean ? ' · EAN ' + esc(l.ean) : ''}${l.unidade ? ' · ' + esc(l.unidade) : ''}</div>
        <select class="input mb" data-dest="${i}">
          <option value="novo:produto" ${l.destino === 'novo:produto' ? 'selected' : ''}>➕ Cadastrar como produto novo</option>
          <option value="novo:peca" ${l.destino === 'novo:peca' ? 'selected' : ''}>➕ Cadastrar como peça nova</option>
          ${l.sug.map(s => `<option value="${s.tipo}:${s.p.id}" ${l.destino === `${s.tipo}:${s.p.id}` ? 'selected' : ''}>Somar em: ${esc(s.p.nome)} (${s.tipo === 'peca' ? 'peça' : 'produto'}, tem ${s.p.qtd})</option>`).join('')}
        </select>
        <div class="form-row">${field('Quantidade', `<input class="input" type="number" min="0" step="1" data-q="${i}" value="${l.qtd}">`)}${field('Custo un.', `<input class="input" inputmode="decimal" data-c="${i}" value="${moneyInput(l.custo)}">`)}</div>
        ${l.destino.startsWith('novo:') ? field('Preço de venda', `<input class="input" inputmode="decimal" data-p="${i}" placeholder="0,00" value="${l.preco ? moneyInput(l.preco) : ''}">`, { opt: true }) : ''}
      </div>`).join('');
      $$('[data-inc]', el).forEach(c => c.onchange = () => { linhas[c.dataset.inc].incluir = c.checked; desenhar(); });
      $$('[data-dest]', el).forEach(s => s.onchange = () => { linhas[s.dataset.dest].destino = s.value; desenhar(); });
      $$('[data-q]', el).forEach(x => x.oninput = () => { linhas[x.dataset.q].qtd = Math.max(0, parseInt(x.value) || 0); });
      $$('[data-c]', el).forEach(x => x.oninput = () => { linhas[x.dataset.c].custo = parseMoney(x.value); });
      $$('[data-p]', el).forEach(x => x.oninput = () => { linhas[x.dataset.p].preco = parseMoney(x.value); });
    };
    desenhar();
    $('#nf-ok', el).onclick = async () => {
      const ok = linhas.filter(l => l.incluir && l.qtd > 0);
      if (!ok.length) return toast('Nenhum item com quantidade para importar', true);
      const b = $('#nf-ok', el); b.disabled = true;
      try {
        if (this.jaImportada(n.chave) || await this.jaImportadaNaNuvem(n.chave)) { b.disabled = false; return toast('Esta nota já foi importada nesta oficina.', true); }
      } catch (e) { b.disabled = false; return toast(e.message, true); }
      this.confirmar(n, ok, $('#nf-desp', el).checked);
      m.close(); App.refresh();
      toast(`NF-e ${n.numero || ''} importada: ${ok.length} item(ns) no estoque`);
    };
  },

  confirmar(n, linhas, lancarDespesa) {
    // fornecedor: reaproveita pelo CNPJ ou nome
    let forn = Store.db.fornecedores.find(f => !f.deleted && ((n.fornecedor.cnpj && onlyDigits(f.cnpj) === onlyDigits(n.fornecedor.cnpj)) || norm(f.nome) === norm(n.fornecedor.nome)));
    if (!forn && n.fornecedor.nome) { forn = { id: uid(), nome: n.fornecedor.nome, cnpj: n.fornecedor.cnpj, telefone: '', obs: 'Criado pela importação de NF-e', criadoEm: nowISO() }; Store.db.fornecedores.push(forn); }
    const resumo = [];
    for (const l of linhas) {
      const [tipo, ref] = l.destino.split(':');
      let tipoItem, item;
      if (tipo === 'novo') {
        tipoItem = ref; // produto | peca
        item = { id: uid(), nome: l.nome, codigo: l.ean || l.codigo, custo: l.custo, preco: l.preco || 0, qtd: 0, minimo: 0, categoria: '', fornecedorId: forn?.id || '', criadoEm: nowISO(), entradaEm: nowISO() };
        if (tipoItem === 'produto') Object.assign(item, { garantiaDias: 90 });
        (tipoItem === 'peca' ? Store.db.pecas : Store.db.produtos).push(item);
      } else {
        tipoItem = tipo;
        item = tipo === 'peca' ? Store.peca(ref) : Store.produto(ref);
        if (!item) continue;
        item.custo = l.custo;
      }
      const lote = Store.criarLote({ tipoItem, item, qtd: l.qtd, custo: l.custo, fornecedor: forn?.nome || n.fornecedor.nome, numero: `NF${n.numero || ''}-${l.nItem || resumo.length + 1}`, nfeChave: n.chave, motivo: `NF-e ${n.numero || ''} (${n.fornecedor.nome || ''})` });
      resumo.push({ nome: item.nome, tipoItem, itemId: item.id, qtd: l.qtd, custo: l.custo, loteId: lote.id });
    }
    Store.db.nfe_entradas.push({ id: n.chave, chave: n.chave, numero: n.numero, serie: n.serie, data: n.data, fornecedor: n.fornecedor, fornecedorId: forn?.id || null,
      total: n.total, itens: resumo, importadoEm: nowISO(), importadoPor: Store.quem().nome || null });
    if (lancarDespesa && n.total > 0) Store.addDespesa({ desc: `NF-e ${n.numero || ''} · ${n.fornecedor.nome || 'Fornecedor'}`, valor: n.total, categoria: 'Compra de estoque', estoque: true });
    Store.log('NF-e importada', `${n.numero || n.chave} · ${resumo.length} item(ns)`);
    Store.save();
  },

  // Notas já importadas (histórico)
  historico() {
    const ns = Store.db.nfe_entradas.filter(n => !n.deleted).sort((a, b) => String(b.importadoEm).localeCompare(String(a.importadoEm)));
    openModal({
      title: 'Notas importadas', icon: 'file',
      body: ns.map(n => `<div class="cart-line"><div class="grow"><b>NF-e ${esc(n.numero || '')} · ${esc(n.fornecedor?.nome || '')}</b>
        <div class="xs muted">${fmtDate(n.data)} · ${n.itens.length} item(ns) · ${money(n.total)} · importada ${fmtDateTime(n.importadoEm)}</div></div></div>`).join('') || '<p class="muted">Nenhuma nota importada ainda.</p>',
    });
  },
};
