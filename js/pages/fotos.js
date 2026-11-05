/* Fotos do aparelho (estado na entrada: riscos, trincas, marcas) na OS e no orçamento.
   - Ficam no bucket PRIVADO "lojas-privado" (pasta da loja): só a equipe da loja vê, por link temporário.
   - No registro (OS/orçamento) vai só o caminho de cada foto, nunca a imagem (o banco local é pequeno).
   - "fotosImprimir" (padrão: sim) decide se as fotos saem na impressão e no PDF, logo abaixo do checklist. */
const Fotos = {
  MAX: 8,
  BUCKET: 'lojas-privado',
  _urls: {},   // caminho -> { url, ate }

  pode() { return !!(Cloud.enabled && Cloud.sb?.storage && Cloud.loja); },
  st() { return Cloud.sb.storage.from(this.BUCKET); },

  // Reduz no aparelho (máx. 1280 px, JPEG): envio rápido mesmo no 4G e cabe no limite do bucket
  async reduzir(file) {
    const img = await new Promise((ok, ko) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => ko(new Error('Não foi possível abrir a foto')); i.src = URL.createObjectURL(file); });
    const k = Math.min(1, 1280 / Math.max(img.width, img.height));
    const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    URL.revokeObjectURL(img.src);
    return await new Promise(ok => c.toBlob(ok, 'image/jpeg', 0.8));
  },

  async enviar(file) {
    if (!this.pode()) throw new Error('As fotos precisam da nuvem ligada');
    if (!/^image\//.test(file.type)) throw new Error('Escolha uma foto');
    const blob = await this.reduzir(file);
    if (!blob || blob.size > 3 * 1024 * 1024) throw new Error('Foto muito grande mesmo depois de reduzir');
    const caminho = `${Cloud.loja.id}/aparelhos/${uid()}.jpg`;
    const { error } = await this.st().upload(caminho, blob, { contentType: 'image/jpeg', upsert: false });
    if (error) throw new Error(/bucket|not found/i.test(error.message) ? 'Rode a migração 25 (fotos do aparelho) no Supabase' : error.message);
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

  // As fotos que vão para a impressão (vazio se o lojista desmarcou ou se não há fotos)
  paraImprimir(reg) { return reg && reg.fotosImprimir !== false && this.pode() ? (reg.fotos || []).slice(0, this.MAX) : []; },
  async urlsParaImprimir(reg) { return (await Promise.all(this.paraImprimir(reg).map(p => this.url(p).catch(() => null)))).filter(Boolean); },
  async imagensParaImprimir(reg) { return (await Promise.all(this.paraImprimir(reg).map(p => this.imagem(p).catch(() => null)))).filter(Boolean); },

  /* ---------- Campo no formulário (OS e orçamento) ---------- */
  campoHTML(reg = {}) {
    return `<div class="mb ft-campo" data-ft-campo>
      <div class="lbl">${icon('camera', 'sm')} Fotos do aparelho <span class="opt muted">(estado na entrada: riscos, trincas, marcas)</span></div>
      <div class="ft-grid" data-ft-grid></div>
      <label class="check mt" style="padding:0"><input type="checkbox" data-ft-imp ${reg.fotosImprimir === false ? '' : 'checked'}> <span>Mostrar as fotos na impressão e no PDF</span></label>
    </div>`;
  },
  ligar(root, reg = {}) {
    const box = $('[data-ft-campo]', root); if (!box) return;
    box._lista = [...(reg.fotos || [])];
    box._antes = [...(reg.fotos || [])];
    const grid = $('[data-ft-grid]', box);
    let enviando = 0;
    const desenhar = () => {
      if (!this.pode()) { grid.innerHTML = `<div class="info-box" style="grid-column:1/-1">${icon('info')}<span>As fotos precisam da nuvem ligada.</span></div>`; return; }
      grid.innerHTML = box._lista.map((p, i) => `<div class="ft-th"><img data-ft-src="${esc(p)}" alt="Foto ${i + 1}"><button type="button" class="ft-rm" data-ft-rm="${i}" title="Remover foto">${icon('x', 'sm')}</button></div>`).join('')
        + Array.from({ length: enviando }, () => '<div class="ft-th ft-carregando"><span class="spinner"></span></div>').join('')
        + (box._lista.length + enviando < this.MAX ? `<label class="ft-add">${icon('camera')}<span>Adicionar foto</span><input type="file" accept="image/*" multiple hidden data-ft-file></label>` : '');
      this.preencher(grid);
      $$('[data-ft-rm]', grid).forEach(b => b.onclick = () => { box._lista.splice(+b.dataset.ftRm, 1); desenhar(); });
      const inp = $('[data-ft-file]', grid);
      if (inp) inp.onchange = async () => {
        const arqs = [...inp.files].slice(0, this.MAX - box._lista.length - enviando); inp.value = '';
        if (!arqs.length) return toast(`Até ${this.MAX} fotos`, true);
        enviando += arqs.length; desenhar();
        for (const f of arqs) {
          try { box._lista.push(await this.enviar(f)); }
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
    return { fotos: [...(box._lista || [])], fotosImprimir: !!$('[data-ft-imp]', box)?.checked };
  },
  // Depois de salvar: apaga do armazenamento as fotos tiradas do registro (se nenhum outro registro usa)
  async limpar(root) {
    const box = $('[data-ft-campo]', root); if (!box || !this.pode()) return;
    const usadas = new Set([...Store.db.os, ...Store.db.orcamentos].flatMap(r => r.fotos || []));
    const sobra = (box._antes || []).filter(p => !box._lista.includes(p) && !usadas.has(p));
    if (sobra.length) try { await this.st().remove(sobra); } catch {}
  },

  /* ---------- Galeria no detalhe ---------- */
  galeriaHTML(reg) {
    const fs = reg.fotos || []; if (!fs.length) return '';
    return `<div class="card mb"><h3>${icon('camera', 'sm')} Fotos do aparelho <span class="xs muted" style="font-weight:400">${fs.length} · <span>${reg.fotosImprimir === false ? 'não saem na impressão' : 'saem na impressão'}</span></span></h3>
      ${this.pode() ? `<div class="ft-grid">${fs.map((p, i) => `<a class="ft-th" data-ft-ver="${esc(p)}" href="#" title="Ampliar"><img data-ft-src="${esc(p)}" alt="Foto ${i + 1}"></a>`).join('')}</div>` : `<div class="small muted">${fs.length} foto(s). Ligue a nuvem para ver.</div>`}</div>`;
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
