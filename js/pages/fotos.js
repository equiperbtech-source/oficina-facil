/* Fotos do veículo na OS e no orçamento (até 12): estado na entrada, avarias, peça trocada, peça velha, painel/km.
   - Ficam no bucket PRIVADO "lojas-privado" (pasta da oficina): só a equipe vê, por link temporário.
   - No registro vai só a lista: fotos[{ caminho, etiqueta, noPdf, por, em }] (nunca a imagem; nunca no localStorage).
     Registro antigo com só o caminho (texto) continua valendo.
   - "fotosImprimir" (padrão: sim) liga as fotos na impressão e no PDF; cada foto pode ficar fora (noPdf). */
const Fotos = {
  MAX: 12,
  ETIQUETAS: ['Entrada', 'Avaria', 'Peça trocada', 'Peça velha', 'Painel/km'],
  caminho(f) { return typeof f === 'string' ? f : f?.caminho || ''; },
  obj(f) { return typeof f === 'string' ? { caminho: f } : { ...f }; },
  BUCKET: 'lojas-privado',
  _urls: {},   // caminho -> { url, ate }

  pode() { return !!(Cloud.enabled && Cloud.sb?.storage && Cloud.loja); },
  st() { return Cloud.sb.storage.from(this.BUCKET); },

  // Reduz no celular (máx. ~1600 px, JPEG 0,75): envio rápido mesmo no 4G e cabe no limite do bucket
  async reduzir(file) {
    const img = await new Promise((ok, ko) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => ko(new Error('Não foi possível abrir a foto')); i.src = URL.createObjectURL(file); });
    const k = Math.min(1, 1600 / Math.max(img.width, img.height));
    const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    URL.revokeObjectURL(img.src);
    return await new Promise(ok => c.toBlob(ok, 'image/jpeg', 0.75));
  },

  async enviar(file) {
    if (!this.pode()) throw new Error('As fotos precisam da nuvem ligada');
    if (!/^image\//.test(file.type)) throw new Error('Escolha uma foto');
    const blob = await this.reduzir(file);
    if (!blob || blob.size > 3 * 1024 * 1024) throw new Error('Foto muito grande mesmo depois de reduzir');
    const caminho = `${Cloud.loja.id}/veiculos/${uid()}.jpg`;
    const { error } = await this.st().upload(caminho, await blob.arrayBuffer(), { contentType: 'image/jpeg', upsert: false });
    if (error) throw new Error(/bucket|not found/i.test(error.message) ? 'As fotos ainda não estão ativas no banco (migração 25)' : error.message);
    return caminho;
  },

  // Link temporário (1 h) para mostrar a foto; reaproveita enquanto vale
  async url(caminho) {
    const c = this._urls[caminho];
    if (c && c.ate > Date.now()) return c.url;
    const { data, error } = await this.st().createSignedUrl(caminho, 3600);
    if (error || !data?.signedUrl) throw new Error(error?.message || 'Foto indisponível');
    this._urls[caminho] = { url: data.signedUrl, ate: Date.now() + 50 * 60 * 1000 };
    return data.signedUrl;
  },

  // Foto como dataURL (para o PDF), com largura/altura para manter a proporção
  async imagem(caminho) {
    const r = await fetch(await this.url(caminho));
    if (!r.ok) throw new Error('Foto indisponível');
    const src = await new Promise((ok, ko) => { const fr = new FileReader(); fr.onload = () => ok(fr.result); fr.onerror = ko; r.blob().then(b => fr.readAsDataURL(b), ko); });
    const dim = await new Promise(ok => { const i = new Image(); i.onload = () => ok({ w: i.naturalWidth, h: i.naturalHeight }); i.onerror = () => ok({ w: 4, h: 3 }); i.src = src; });
    return { src, ...dim };
  },

  // As fotos que vão para a impressão (vazio se a oficina desligou ou se não há fotos)
  paraImprimir(reg) { return reg && reg.fotosImprimir !== false && this.pode() ? (reg.fotos || []).filter(f => !this.obj(f).noPdf).map(f => this.caminho(f)).slice(0, this.MAX) : []; },
  async urlsParaImprimir(reg) { return (await Promise.all(this.paraImprimir(reg).map(p => this.url(p).catch(() => null)))).filter(Boolean); },
  async imagensParaImprimir(reg) { return (await Promise.all(this.paraImprimir(reg).map(p => this.imagem(p).catch(() => null)))).filter(Boolean); },

  /* ---------- Campo no formulário (OS e orçamento) ---------- */
  campoHTML(reg = {}) {
    return `<div class="mb ft-campo" data-ft-campo>
      <div class="lbl">${icon('camera', 'sm')} ${t('Fotos do veículo')} <span class="opt muted">${t('(até 12: riscos, amassados, painel, peças)')}</span></div>
      <div class="ft-grid" data-ft-grid></div>
      <label class="check mt" style="padding:0"><input type="checkbox" data-ft-imp ${reg.fotosImprimir === false ? '' : 'checked'}> <span>${t('Mostrar as fotos na impressão e no PDF')}</span></label>
    </div>`;
  },
  ligar(root, reg = {}) {
    const box = $('[data-ft-campo]', root); if (!box) return;
    box._lista = (reg.fotos || []).map(f => this.obj(f));
    box._antes = (reg.fotos || []).map(f => this.caminho(f));
    const grid = $('[data-ft-grid]', box);
    let enviando = 0;
    const desenhar = () => {
      if (!this.pode()) { grid.innerHTML = `<div class="info-box" style="grid-column:1/-1">${icon('info')}<span>${t('As fotos precisam da nuvem ligada.')}</span></div>`; return; }
      grid.innerHTML = box._lista.map((f, i) => `<div class="ft-th ${f.noPdf ? 'ft-fora' : ''}"><img data-ft-src="${esc(f.caminho)}" alt="${t('Foto')} ${i + 1}">
          <button type="button" class="ft-rm" data-ft-rm="${i}" title="${t('Remover foto')}">${icon('x', 'sm')}</button>
          <button type="button" class="ft-tag" data-ft-tag="${i}" title="${t('Etiqueta')}">${esc(t(f.etiqueta || 'Etiqueta'))}</button>
          <button type="button" class="ft-pdf" data-ft-pdf="${i}" title="${t(f.noPdf ? 'Não sai no PDF' : 'Sai no PDF')}" aria-pressed="${!f.noPdf}">PDF</button></div>`).join('')
        + Array.from({ length: enviando }, () => '<div class="ft-th ft-carregando"><span class="spinner"></span></div>').join('')
        + (box._lista.length + enviando < this.MAX ? `<label class="ft-add">${icon('camera')}<span>${t('Adicionar foto')}</span><input type="file" accept="image/*" capture="environment" multiple hidden data-ft-file></label>` : '');
      this.preencher(grid);
      $$('[data-ft-rm]', grid).forEach(b => b.onclick = () => { box._lista.splice(+b.dataset.ftRm, 1); desenhar(); });
      $$('[data-ft-pdf]', grid).forEach(b => b.onclick = () => { const f = box._lista[+b.dataset.ftPdf]; f.noPdf = !f.noPdf; desenhar(); });
      $$('[data-ft-tag]', grid).forEach(b => b.onclick = e => {
        e.stopPropagation(); const f = box._lista[+b.dataset.ftTag];
        dropdown(b, [{ k: '', label: t('Sem etiqueta'), on: !f.etiqueta }, ...this.ETIQUETAS.map(x => ({ k: x, label: t(x), on: f.etiqueta === x }))], it => { f.etiqueta = it.k || null; desenhar(); });
      });
      const inp = $('[data-ft-file]', grid);
      if (inp) inp.onchange = async () => {
        const arqs = [...inp.files].slice(0, this.MAX - box._lista.length - enviando); inp.value = '';
        if (!arqs.length) return toast(t('Até {n} fotos', { n: this.MAX }), true);
        enviando += arqs.length; desenhar();
        const q = Store.quem();
        for (const f of arqs) {
          try { box._lista.push({ caminho: await this.enviar(f), em: nowISO(), ...(q.id ? { por: q.id } : {}) }); }
          catch (e) { toast(e.message || 'Não foi possível enviar a foto', true); }
          enviando--; desenhar();
        }
      };
    };
    desenhar();
  },
  ocupado(root) { return !!$('.ft-carregando', root); },
  ler(root) {
    const box = $('[data-ft-campo]', root); if (!box) return {};
    return { fotos: (box._lista || []).map(f => ({ ...f })), fotosImprimir: !!$('[data-ft-imp]', box)?.checked };
  },
  // Depois de salvar: apaga do armazenamento as fotos tiradas do registro (se nenhum outro registro usa)
  async limpar(root) {
    const box = $('[data-ft-campo]', root); if (!box || !this.pode()) return;
    const usadas = new Set([...Store.db.os, ...Store.db.orcamentos].flatMap(r => (r.fotos || []).map(f => this.caminho(f))));
    const agora = new Set((box._lista || []).map(f => f.caminho));
    const sobra = (box._antes || []).filter(p => !agora.has(p) && !usadas.has(p));
    if (sobra.length) try { await this.st().remove(sobra); } catch {}
  },

  /* ---------- Galeria no detalhe ---------- */
  galeriaHTML(reg) {
    const fs = (reg.fotos || []).map(f => this.obj(f)); if (!fs.length) return '';
    return `<div class="card mb"><h3>${icon('camera', 'sm')} ${t('Fotos do veículo')} <span class="xs muted" style="font-weight:400">${fs.length} · <span>${t(reg.fotosImprimir === false ? 'não saem na impressão' : 'saem na impressão')}</span></span></h3>
      ${this.pode() ? `<div class="ft-grid">${fs.map((f, i) => `<a class="ft-th ${f.noPdf ? 'ft-fora' : ''}" data-ft-ver="${esc(f.caminho)}" href="#" title="${t('Ampliar')}"><img data-ft-src="${esc(f.caminho)}" alt="${t('Foto')} ${i + 1}">${f.etiqueta ? `<span class="ft-tag">${esc(t(f.etiqueta))}</span>` : ''}</a>`).join('')}</div>` : `<div class="small muted">${t('{n} foto(s). Ligue a nuvem para ver.', { n: fs.length })}</div>`}</div>`;
  },
  ligarGaleria(root) {
    this.preencher(root);
    $$('[data-ft-ver]', root).forEach(a => a.onclick = async e => { e.preventDefault(); try { window.open(await this.url(a.dataset.ftVer), '_blank'); } catch (err) { toast(err.message, true); } });
  },
  async preencher(root) {
    for (const img of $$('img[data-ft-src]', root)) {
      if (img.src) continue;
      try { img.src = await this.url(img.dataset.ftSrc); } catch { img.alt = 'Foto indisponível'; img.closest('.ft-th')?.classList.add('ft-erro'); }
    }
  },
};
