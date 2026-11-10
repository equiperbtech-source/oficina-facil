/* Tela do mecânico (rápida, no celular): os veículos dele em cartões grandes, com a placa em destaque.
   - "Fotos": câmera traseira direto, várias seguidas; reduz no celular e entra numa FILA no IndexedDB.
     A fila sobe sozinha quando há internet ("enviando 2 de 5"); sem internet, nada se perde.
   - "+ Peça": usadas há pouco, busca por nome/código/aplicação e leitura de código de barras pela câmera.
   - Mover de etapa com um toque. O mecânico não vê custo, lucro nem financeiro. */
const FilaFotos = {
  BD: 'oficina_fotos', ST: 'fila', _db: null, rodando: false, total: 0, feitos: 0,
  abrir() {
    if (this._db) return Promise.resolve(this._db);
    return new Promise((ok, ko) => {
      const r = indexedDB.open(this.BD, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(this.ST, { keyPath: 'id' });
      r.onsuccess = () => { this._db = r.result; ok(this._db); };
      r.onerror = () => ko(r.error);
    });
  },
  async tx(modo, fn) { const db = await this.abrir(); return new Promise((ok, ko) => { const t = db.transaction(this.ST, modo); const st = t.objectStore(this.ST); const r = fn(st); t.oncomplete = () => ok(r && r.result); t.onerror = () => ko(t.error); }); },
  async adicionar(osId, blob, etiqueta) { const q = Store.quem(); await this.tx('readwrite', st => st.put({ id: uid(), osId, blob, etiqueta: etiqueta || null, em: nowISO(), por: q.id || null, lojaId: Cloud.loja?.id || null })); this.processar(); },
  async todos() { return (await this.tx('readonly', st => st.getAll())) || []; },
  async pendentes(osId) { return (await this.todos()).filter(x => !osId || x.osId === osId).length; },
  // sobe a fila: uma foto de cada vez; cada foto que sobe entra na OS
  async processar() {
    if (this.rodando || !navigator.onLine || !Fotos.pode()) return;
    this.rodando = true;
    try {
      let lista = (await this.todos()).filter(x => !x.lojaId || x.lojaId === Cloud.loja.id);
      this.total = lista.length; this.feitos = 0; this.avisar();
      for (const x of lista) {
        const o = Store.osById(x.osId);
        if (!o) { await this.tx('readwrite', st => st.delete(x.id)); continue; }
        const caminho = `${Cloud.loja.id}/veiculos/${uid()}.jpg`;
        const { error } = await Fotos.st().upload(caminho, await x.blob.arrayBuffer(), { contentType: 'image/jpeg', upsert: false });
        if (error) throw error;
        o.fotos = [...(o.fotos || []), { caminho, etiqueta: x.etiqueta, em: x.em, ...(x.por ? { por: x.por } : {}) }].slice(-Fotos.MAX);
        Store.saveOS(o);
        await this.tx('readwrite', st => st.delete(x.id));
        this.feitos++; this.avisar();
      }
    } catch (e) { console.warn('fila de fotos:', e?.message || e); }
    finally { this.rodando = false; this.total = 0; this.avisar(); }
  },
  avisar() {
    const txt = this.total ? t('Enviando {a} de {b}', { a: Math.min(this.feitos + 1, this.total), b: this.total }) : '';
    $$('[data-fila-fotos]').forEach(el => { el.textContent = txt; el.hidden = !txt; });
  },
  ligar() {
    if (this._ligado || typeof indexedDB === 'undefined') return; this._ligado = true;
    addEventListener('online', () => this.processar());
    setInterval(() => this.processar(), 20000);
    setTimeout(() => this.processar(), 3000);
  },
};

Pages.mecanico = {
  todos: false,
  render(main) {
    const eu = Cloud.user?.id, mec = Cloud.papel() === 'tecnico';
    let os = Store.db.os.filter(o => !o.deleted && OS_ATIVOS.includes(o.status));
    if (mec && !this.todos) os = os.filter(o => !o.mecanicoId || o.mecanicoId === eu);
    os.sort((a, b) => OS_ATIVOS.indexOf(a.status) - OS_ATIVOS.indexOf(b.status) || a.numero - b.numero);
    main.innerHTML = `
      ${pageHead('wrench', 'Mecânico', 'Seus veículos: fotos, peças e etapa com um toque.')}
      <div class="row between wrap mb" style="gap:8px">${mec ? `<div class="tabs" id="mc-f"><button data-k="0" class="${this.todos ? '' : 'on'}">${t('Meus')}</button><button data-k="1" class="${this.todos ? 'on' : ''}">${t('Todos')}</button></div>` : '<span></span>'}
        <span class="pill gold" data-fila-fotos hidden></span></div>
      <div class="mec-grid">${os.map(o => {
        const v = o.veiculo || {}, s = OS_STATUS[o.status];
        return `<div class="card mec-card" style="--bar:${s.color}">
          <div class="row between"><span class="placa-tag placa-grande" data-no-i18n>${esc(v.placa ? Placa.fmt(v.placa) : '#' + o.numero)}</span><span class="xs muted">OS #${o.numero}</span></div>
          <div class="bold mt" data-no-i18n>${icon(Veiculo.icone(v), 'sm')} ${esc(Veiculo.completo(v))}</div>
          <div class="small muted ellipsis" data-no-i18n>${esc(o.defeito || '')}</div>
          <div class="small" style="color:${s.color};font-weight:700;margin-top:6px">${esc(s.label)}</div>
          <div class="xs muted">${(o.fotos || []).length} ${t('foto(s)')} · ${(o.itensPeca || []).length} ${t('peça(s)')}</div>
          <div class="grid grid-3 mt mec-acoes">
            <label class="btn btn-grande">${icon('camera')}<span>${t('Fotos')}</span><input type="file" accept="image/*" capture="environment" multiple hidden data-mc-fotos="${o.id}"></label>
            <button class="btn btn-grande" data-mc-peca="${o.id}">${icon('plus')}<span>${t('Peça')}</span></button>
            <button class="btn btn-grande primary" data-mc-mover="${o.id}">${icon('arrowRight')}<span>${t('Etapa')}</span></button>
          </div>
          <button class="btn sm ghost block mt" onclick="OSPage.detalhe('${o.id}')">${t('Abrir OS')}</button></div>`;
      }).join('') || `<div class="empty">${icon('checkCircle')}<div>${t('Nenhum veículo com você agora.')}</div></div>`}</div>`;
    $$('#mc-f button').forEach(b => b.onclick = () => { this.todos = b.dataset.k === '1'; App.refresh(); });
    $$('[data-mc-fotos]', main).forEach(inp => inp.onchange = () => this.fotos(inp.dataset.mcFotos, [...inp.files]).then(() => { inp.value = ''; }));
    $$('[data-mc-peca]', main).forEach(b => b.onclick = () => this.peca(b.dataset.mcPeca));
    $$('[data-mc-mover]', main).forEach(b => b.onclick = e => { e.stopPropagation(); OSPage.statusMenu(b.dataset.mcMover, b); });
    FilaFotos.avisar();
  },
  // fotos: reduz no celular e põe na fila (sobe agora se houver internet; senão, quando voltar)
  async fotos(osId, arqs) {
    const o = Store.osById(osId); if (!o) return;
    const cabe = Fotos.MAX - (o.fotos || []).length - await FilaFotos.pendentes(osId);
    if (cabe <= 0) return toast(t('Até {n} fotos', { n: Fotos.MAX }), true);
    let n = 0;
    for (const f of arqs.slice(0, cabe)) { try { await FilaFotos.adicionar(osId, await Fotos.reduzir(f)); n++; } catch (e) { toast(e.message || 'Não foi possível abrir a foto', true); } }
    if (n) toast(navigator.onLine ? t('{n} foto(s) enviando', { n }) : t('{n} foto(s) guardadas: sobem quando a internet voltar', { n }));
  },
  // + Peça: recentes, busca e código de barras
  peca(osId) {
    const o = Store.osById(osId); if (!o) return;
    const verPreco = Cloud.papel() !== 'tecnico' || Store.s.mecanicoVePreco === true;
    const m = openModal({
      title: t('Lançar peça'), subtitle: `OS #${o.numero} · ${Veiculo.resumo(o.veiculo)}`, icon: 'box',
      body: `<div class="row" style="gap:8px"><div class="input-icon grow">${icon('search')}<input class="input" id="mp-q" placeholder="${t('Nome, código ou aplicação')}" autocomplete="off"></div>
          ${'BarcodeDetector' in window ? `<button class="btn" id="mp-cod" title="${t('Ler código de barras')}">${icon('scan')}</button>` : ''}</div>
        <video id="mp-video" playsinline muted hidden style="width:100%;border-radius:12px;margin-top:8px;background:#000"></video>
        <div id="mp-res" class="mt"></div>
        <div class="row mt" style="gap:8px"><input class="input grow" id="mp-av" placeholder="${t('Peça avulsa (fora do estoque)')}"><button class="btn outline-gold" id="mp-av-ok" title="Adicionar">${icon('plus')}</button></div>`,
      foot: `<button class="btn" data-close>${t('Fechar')}</button>`,
      onClose: () => this.pararCamera(),
    });
    const el = m.el;
    const lancar = p => { OSPage.lancarPeca(Store.osById(osId), p, 1); toast(t('Peça lançada: {p}', { p: p.nome })); listar($('#mp-q', el).value); };
    const listar = q => {
      const l = Pecas.buscar(q.trim()).slice(0, 8);
      $('#mp-res', el).innerHTML = (q ? '' : `<div class="lbl mb">${t('Usadas há pouco')}</div>`) + (l.map(p => `<button type="button" class="item mp-item" data-p="${p.id}"><div class="row between"><div class="grow" style="min-width:0;text-align:left"><b class="ellipsis" style="display:block">${esc(p.nome)}</b><div class="xs muted ellipsis">${esc([p.codigo, p.aplicacao].filter(Boolean).join(' · '))}</div></div><div class="right">${verPreco ? `<b class="gold">${money(p.preco)}</b>` : ''}<div class="xs ${p.qtd > 0 ? 'muted' : 'red'}">${t('Estoque')}: ${fmtQtd(p.qtd)}</div></div></div></button>`).join('') || `<div class="empty small">${q ? t('Nada encontrado') : t('Busque a peça acima.')}</div>`);
      $$('[data-p]', el).forEach(b => b.onclick = () => lancar(Store.peca(b.dataset.p)));
    };
    $('#mp-q', el).oninput = e => listar(e.target.value); listar('');
    $('#mp-av-ok', el).onclick = () => { const n = $('#mp-av', el).value.trim(); if (!n) return; OSPage.lancarPeca(Store.osById(osId), { nome: n, preco: 0, custo: 0 }, 1); $('#mp-av', el).value = ''; toast(t('Peça lançada: {p}', { p: n })); };
    const cod = $('#mp-cod', el);
    if (cod) cod.onclick = () => this.lerCodigo($('#mp-video', el), codigo => {
      const p = Store.db.pecas.find(x => !x.deleted && onlyDigits(x.codigo) && onlyDigits(x.codigo) === onlyDigits(codigo));
      if (p) lancar(p); else { $('#mp-q', el).value = codigo; listar(codigo); toast(t('Código {c} não cadastrado', { c: codigo }), true); }
    });
    setTimeout(() => $('#mp-q', el)?.focus(), 80);
  },
  async lerCodigo(video, achou) {
    try {
      const det = new BarcodeDetector({ formats: ['ean_13', 'ean_8', 'code_128', 'code_39', 'upc_a', 'upc_e'] });
      this._stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      video.srcObject = this._stream; video.hidden = false; await video.play();
      const loop = async () => {
        if (!this._stream) return;
        try { const r = await det.detect(video); if (r[0]?.rawValue) { this.pararCamera(); video.hidden = true; return achou(r[0].rawValue); } } catch {}
        requestAnimationFrame(loop);
      };
      loop();
    } catch { toast(t('Não foi possível abrir a câmera'), true); }
  },
  pararCamera() { if (this._stream) { this._stream.getTracks().forEach(x => x.stop()); this._stream = null; } },
};

/* Documento do cliente (foto opcional, ex.: CNH): bucket privado, link temporário, nunca sai em PDF */
const DocFotos = {
  cardHTML(c) {
    if (!Fotos.pode()) return '';
    const l = c.docFotos || [];
    return `<div class="kv"><span class="k">${t('Documento (foto)')}</span><span class="v"><span class="row wrap" style="gap:6px;justify-content:flex-end">
      ${l.map((p, i) => `<a href="#" class="btn sm" data-doc-ver="${esc(p)}">${icon('eye', 'sm')} ${i + 1}</a>`).join('')}
      <label class="btn sm outline-gold">${icon('camera', 'sm')} ${t('Adicionar')}<input type="file" accept="image/*" capture="environment" hidden data-doc-add></label></span></span></div>`;
  },
  ligar(el, c) {
    $$('[data-doc-ver]', el).forEach(a => a.onclick = async e => { e.preventDefault(); try { window.open(await Fotos.url(a.dataset.docVer), '_blank'); } catch (err) { toast(err.message, true); } });
    const inp = $('[data-doc-add]', el);
    if (inp) inp.onchange = async () => {
      const f = inp.files[0]; if (!f) return;
      try {
        const blob = await Fotos.reduzir(f), caminho = `${Cloud.loja.id}/documentos/${uid()}.jpg`;
        const { error } = await Fotos.st().upload(caminho, await blob.arrayBuffer(), { contentType: 'image/jpeg', upsert: false }); if (error) throw error;
        const cc = Store.cliente(c.id); cc.docFotos = [...(cc.docFotos || []), caminho].slice(-4); Store.saveCliente(cc);
        toast(t('Documento salvo')); closeAllModals(); ClientesPage.detalhe(c.id);
      } catch (e) { toast(e.message || 'Não foi possível enviar', true); }
    };
  },
};

/* Importar clientes e veículos de planilha (CSV): nome, telefone, CPF, placa, marca, modelo, ano (tipo opcional).
   Mesmo telefone/CPF = mesmo cliente; placa já cadastrada não duplica. */
const ImportarCSV = {
  COLS: { nome: /^nome|cliente/, telefone: /tel|fone|whats|celular/, cpf: /cpf|documento/, placa: /placa/, marca: /marca/, modelo: /modelo|ve[ií]culo/, ano: /^ano/, tipo: /tipo/ },
  ler(texto) {
    const linhas = String(texto).replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim());
    if (!linhas.length) return [];
    const sep = (linhas[0].match(/;/g) || []).length >= (linhas[0].match(/,/g) || []).length ? ';' : ',';
    const parte = l => { const out = []; let cur = '', q = false; for (const ch of l) { if (ch === '"') q = !q; else if (ch === sep && !q) { out.push(cur); cur = ''; } else cur += ch; } out.push(cur); return out.map(x => x.trim()); };
    const cab = parte(linhas[0]).map(h => norm(h));
    const idx = Object.fromEntries(Object.entries(this.COLS).map(([k, re]) => [k, cab.findIndex(h => re.test(h))]));
    if (idx.nome < 0) throw new Error(t('A planilha precisa de uma coluna "nome"'));
    return linhas.slice(1).map(parte).map(c => Object.fromEntries(Object.entries(idx).map(([k, i]) => [k, i >= 0 ? (c[i] || '').trim() : '']))).filter(r => r.nome);
  },
  importar(linhas) {
    let novos = 0, veics = 0, repetidas = 0;
    for (const r of linhas) {
      const tel = onlyDigits(r.telefone), cpf = onlyDigits(r.cpf);
      let c = Store.clientesAtivos().find(x => (tel.length >= 10 && onlyDigits(x.telefone) === tel) || (cpf.length === 11 && onlyDigits(x.doc) === cpf));
      if (!c) { c = Store.saveCliente({ nome: r.nome, telefone: tel, docTipo: 'CPF', doc: cpf ? maskDoc(cpf, 'CPF') : '', veiculos: [] }); novos++; }
      if (r.placa || r.modelo) {
        if (r.placa && Veiculo.porPlaca(r.placa)) { repetidas++; continue; }
        const tipo = /moto/i.test(r.tipo) ? 'moto' : 'carro';
        c.veiculos = [...(c.veiculos || []), { id: uid(), tipo, placa: Placa.norm(r.placa), marca: r.marca, modelo: r.modelo || '', anoModelo: onlyDigits(r.ano).slice(0, 4) }];
        Store.saveCliente(c); veics++;
      }
    }
    Store.log('Importação CSV', `${novos} clientes, ${veics} veículos`); Store.save();
    return { novos, veics, repetidas };
  },
  abrir() {
    openModal({
      title: 'Importar planilha', icon: 'upload',
      body: `<p class="small muted" style="margin-top:0">${t('Arquivo CSV (salve a planilha como CSV) com as colunas: nome, telefone, CPF, placa, marca, modelo, ano. Tipo (carro/moto) é opcional.')}</p>
        <label class="btn primary block">${icon('upload')} ${t('Escolher arquivo CSV')}<input type="file" accept=".csv,text/csv" hidden id="csv-arq"></label><div id="csv-res" class="mt"></div>`,
      foot: `<button class="btn" data-close>${t('Fechar')}</button>`,
      onMount: el => {
        $('#csv-arq', el).onchange = async e => {
          try {
            const linhas = this.ler(await e.target.files[0].text());
            const r = this.importar(linhas);
            $('#csv-res', el).innerHTML = `<div class="aviso-plano green" style="margin:0">${icon('checkCircle', 'sm')}<span>${t('{a} cliente(s) novo(s) e {b} veículo(s) importados.', { a: r.novos, b: r.veics })}${r.repetidas ? ' ' + t('{n} placa(s) já cadastrada(s) ficaram de fora.', { n: r.repetidas }) : ''}</span></div>`;
            App.refresh();
          } catch (err) { toast(err.message, true); }
        };
      },
    });
  },
};
