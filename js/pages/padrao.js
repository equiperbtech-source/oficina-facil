/* Desenho de desbloqueio (padrão do Android): a pessoa liga os pontos de uma grade 3x3 com o dedo.
   Fica na OS como a sequência dos pontos (1 a 9, da esquerda para a direita, de cima para baixo), ex.: [1, 5, 9, 6].
   Como no Android, passar por cima de um ponto do meio ainda não usado inclui esse ponto. */
const Padrao = {
  pos(i) { return { x: 50 + ((i - 1) % 3) * 100, y: 50 + Math.floor((i - 1) / 3) * 100 }; },
  valido(seq) { return Array.isArray(seq) && seq.length >= 2 && seq.every(n => Number.isInteger(n) && n >= 1 && n <= 9) && new Set(seq).size === seq.length; },
  texto(seq) { return this.valido(seq) ? seq.join('-') : ''; },
  // aparelho que provavelmente usa desenho (não é Apple)
  ehAndroid(ap) { const m = String(ap?.modelo || ''); return !!m && !/iphone|ipad|ipod|apple|\bios\b|macbook|watch/i.test(m) && (!ap.tipo || ap.tipo === 'celular' || ap.tipo === 'tablet'); },

  // Desenho em SVG (tela, impressão e etiqueta). print: cores para papel branco
  svg(seq, { size = 120, print = false } = {}) {
    const ok = this.valido(seq) ? seq : [];
    const cor = print ? '#111' : 'var(--gold, #d4af37)', ponto = print ? '#bbb' : 'rgba(255,255,255,.28)';
    const pts = ok.map(i => this.pos(i)).map(p => `${p.x},${p.y}`).join(' ');
    const dim = typeof size === 'number' ? `width="${size}" height="${size}" style="display:block;flex:none"` : 'style="display:block;width:100%;height:auto;aspect-ratio:1"';
    return `<svg viewBox="0 0 300 300" ${dim} role="img" aria-label="Desenho ${this.texto(ok)}">
      <rect x="2" y="2" width="296" height="296" rx="28" fill="${print ? '#fff' : 'rgba(255,255,255,.04)'}" stroke="${print ? '#999' : 'rgba(255,255,255,.12)'}" stroke-width="4"/>
      ${ok.length > 1 ? `<polyline points="${pts}" fill="none" stroke="${cor}" stroke-width="14" stroke-linecap="round" stroke-linejoin="round" opacity=".85"/>` : ''}
      ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(i => { const p = this.pos(i), k = ok.indexOf(i);
        return k < 0 ? `<circle cx="${p.x}" cy="${p.y}" r="13" fill="${ponto}"/>`
          : `<circle cx="${p.x}" cy="${p.y}" r="${k === 0 ? 30 : 24}" fill="${k === 0 ? (print ? '#fff' : '#111') : cor}" stroke="${cor}" stroke-width="${k === 0 ? 10 : 0}"/><text x="${p.x}" y="${p.y + 10}" text-anchor="middle" font-size="30" font-weight="800" font-family="Arial, sans-serif" fill="${k === 0 ? cor : (print ? '#fff' : '#111')}">${k + 1}</text>`; }).join('')}
    </svg>`;
  },

  // Desenho no PDF (jsPDF, em mm)
  pdf(doc, seq, x, y, t) {
    if (!this.valido(seq)) return;
    const k = t / 300, P = i => { const p = this.pos(i); return [x + p.x * k, y + p.y * k]; };
    doc.setDrawColor(150, 150, 150); doc.setLineWidth(0.3); doc.roundedRect(x, y, t, t, 2, 2, 'S');
    doc.setDrawColor(20, 20, 20); doc.setLineWidth(t / 300 * 12);
    for (let n = 1; n < seq.length; n++) { const [a, b] = P(seq[n - 1]), [c, d] = P(seq[n]); doc.line(a, b, c, d); }
    for (let i = 1; i <= 9; i++) {
      const [cx, cy] = P(i), o = seq.indexOf(i);
      if (o < 0) { doc.setFillColor(190, 190, 190); doc.circle(cx, cy, 13 * k, 'F'); continue; }
      if (o === 0) { doc.setFillColor(255, 255, 255); doc.setDrawColor(20, 20, 20); doc.setLineWidth(10 * k); doc.circle(cx, cy, 30 * k, 'FD'); doc.setTextColor(20, 20, 20); }
      else { doc.setFillColor(20, 20, 20); doc.circle(cx, cy, 24 * k, 'F'); doc.setTextColor(255, 255, 255); }
      doc.setFont('helvetica', 'bold'); doc.setFontSize(Math.max(5, t * 0.32)); doc.text(String(o + 1), cx, cy + t * 0.035, { align: 'center' });
    }
    doc.setTextColor(0, 0, 0);
  },

  /* ---------- Campo no formulário da OS ---------- */
  campoHTML(o = {}) {
    const tem = this.valido(o.padrao), abrir = tem || this.ehAndroid(o.aparelho);
    return `<div class="pd-campo" data-pd-campo>
      <button type="button" class="btn sm mt" data-pd-abrir style="${abrir ? 'display:none' : ''}">${icon('grid', 'sm')} Desenhar padrão de desbloqueio</button>
      <div data-pd-box class="mt" style="${abrir ? '' : 'display:none'}">
        <div class="small muted mb">Desenho de desbloqueio <span class="opt">(Android: ligue os pontos com o dedo, na ordem)</span></div>
        <div class="row" style="gap:14px;align-items:flex-start;flex-wrap:wrap">
          <div data-pd-area style="touch-action:none;user-select:none;-webkit-user-select:none;width:200px;max-width:70vw"></div>
          <div class="col" style="gap:8px;min-width:120px">
            <div class="small" data-pd-info></div>
            <button type="button" class="btn sm" data-pd-limpar>${icon('x', 'sm')} Limpar desenho</button>
          </div>
        </div>
      </div>
    </div>`;
  },
  ligar(root, o = {}) {
    const box = $('[data-pd-campo]', root); if (!box) return;
    box._seq = this.valido(o.padrao) ? [...o.padrao] : [];
    const area = $('[data-pd-area]', box), info = $('[data-pd-info]', box);
    let dedo = null, ativo = false;
    const desenhar = () => {
      area.innerHTML = this.svg(box._seq, { size: '100%' }).replace('<svg ', '<svg data-pd-svg ');
      if (ativo && dedo && box._seq.length) {
        const a = this.pos(box._seq.at(-1));
        area.querySelector('svg').insertAdjacentHTML('beforeend', `<line x1="${a.x}" y1="${a.y}" x2="${dedo.x}" y2="${dedo.y}" stroke="var(--gold, #d4af37)" stroke-width="10" stroke-linecap="round" opacity=".5"/>`);
      }
      info.innerHTML = box._seq.length >= 2 ? `<b class="gold">${box._seq.length} ${t('pontos')}</b><div class="xs muted">${t('Começa no ponto marcado com 1')}</div>`
        : `<span class="muted">${t('Ligue pelo menos 2 pontos')}</span>`;
    };
    const ponto = e => {
      const r = area.getBoundingClientRect(); if (!r.width) return null;
      const x = (e.clientX - r.left) / r.width * 300, y = (e.clientY - r.top) / r.height * 300;
      dedo = { x, y };
      for (let i = 1; i <= 9; i++) { const p = this.pos(i); if (Math.hypot(p.x - x, p.y - y) < 40) return i; }
      return null;
    };
    const somar = i => {
      if (!i || box._seq.includes(i)) return;
      const ult = box._seq.at(-1);
      if (ult) { // ponto do meio no caminho (ex.: 1 → 3 passa pelo 2)
        const a = this.pos(ult), b = this.pos(i), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        for (let m = 1; m <= 9; m++) { const p = this.pos(m); if (p.x === mx && p.y === my && !box._seq.includes(m)) box._seq.push(m); }
      }
      box._seq.push(i);
    };
    area.onpointerdown = e => { e.preventDefault(); try { area.setPointerCapture(e.pointerId); } catch {} ativo = true; box._seq = []; somar(ponto(e)); desenhar(); };
    area.onpointermove = e => { if (!ativo) return; e.preventDefault(); somar(ponto(e)); desenhar(); };
    area.onpointerup = area.onpointercancel = () => { ativo = false; dedo = null; if (box._seq.length < 2) box._seq = []; desenhar(); };
    $('[data-pd-limpar]', box).onclick = () => { box._seq = []; desenhar(); };
    $('[data-pd-abrir]', box).onclick = e => { e.currentTarget.style.display = 'none'; $('[data-pd-box]', box).style.display = ''; desenhar(); };
    desenhar();
  },
  ler(root) { const box = $('[data-pd-campo]', root); return { padrao: box && this.valido(box._seq) ? [...box._seq] : null }; },
};
