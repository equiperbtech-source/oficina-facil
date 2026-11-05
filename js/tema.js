/* Tema da loja (white-label): cores, fonte, logo e nome. Layout fixo; só a aparência muda.
   Usado no app e nas páginas públicas. O contraste segue a WCAG AA (texto normal ≥ 4,5:1). */
// Marca da plataforma (o app); cada loja coloca a própria marca ao lado
// Nome do sistema: Oficina Simples (o mesmo em português e espanhol)
const PLATAFORMA = {
  logo: '/assets/oficina-simples.svg', icone: '/assets/os-192.png',
  // domínio principal (cada oficina fica em <endereço curto>.<dominio>); vem do js/config.js,
  // gerado na publicação a partir da variável OFICINA_DOMINIO. Vazio = endereços por oficina desligados.
  get dominio() { return String((typeof window !== 'undefined' && window.OFICINA_CONFIG && window.OFICINA_CONFIG.dominio) || ''); },
  suporteWhats: '+55 48 99115-4821',   // WhatsApp do suporte (botão "Falar com o suporte" do menu)
  get es() { return typeof I18N !== 'undefined' && I18N.idioma === 'es'; },
  get nome() { return 'Oficina Simples'; },
  // nome com a segunda parte em dourado (nunca traduzido pelo tradutor de tela)
  marcaTexto() { return '<span data-no-i18n>Oficina <span class="gold">Simples</span></span>'; },
};
const FONTES = ['Inter', 'Roboto', 'Poppins', 'Montserrat', 'Open Sans', 'Lato'];
const TEMA_PADRAO = { cor_primaria: '#d4af37', cor_secundaria: '#b8860b', cor_fundo: '#000000', fonte: 'Inter' };

const Tema = {
  atual: null,
  rgb(h) { const m = /^#?([0-9a-f]{6})$/i.exec(h || ''); if (!m) return [0, 0, 0]; const n = parseInt(m[1], 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; },
  hex(r, g, b) { return '#' + [r, g, b].map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join(''); },
  // luminância relativa e contraste (WCAG 2.x)
  lum(h) { return this.rgb(h).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0); },
  contraste(a, b) { const [x, y] = [this.lum(a), this.lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); },
  misturar(a, b, t) { const p = this.rgb(a), q = this.rgb(b); return this.hex(...p.map((v, i) => v + (q[i] - v) * t)); },
  // texto preto ou branco, o que tiver mais contraste com o fundo dado
  textoSobre(h) { return this.contraste(h, '#000000') >= this.contraste(h, '#ffffff') ? '#000000' : '#ffffff'; },

  // Validação AA: texto no fundo, cor de destaque no fundo e texto do botão sobre a cor principal
  validar(t) {
    const c = { ...TEMA_PADRAO, ...t };
    const texto = this.textoSobre(c.cor_fundo);
    const m = {
      texto: this.contraste(texto, c.cor_fundo),
      destaque: this.contraste(c.cor_primaria, c.cor_fundo),
      botao: this.contraste(this.textoSobre(c.cor_primaria), c.cor_primaria),
    };
    const problemas = [];
    if (m.destaque < 4.5) problemas.push(`A cor principal tem pouco contraste com o fundo (${m.destaque.toFixed(1)}:1; mínimo 4,5:1). Textos em destaque ficariam difíceis de ler.`);
    if (m.botao < 4.5) problemas.push(`O texto dos botões fica pouco legível sobre a cor principal (${m.botao.toFixed(1)}:1).`);
    return { ok: !problemas.length, problemas, medidas: m };
  },

  aplicar(t, { favicon = true } = {}) {
    const c = { ...TEMA_PADRAO, ...(t || {}) };
    this.atual = t || null;
    const fundo = c.cor_fundo, texto = this.textoSobre(fundo), claro = texto === '#000000';
    const [r, g, b] = this.rgb(c.cor_primaria);
    const v = {
      '--gold': c.cor_primaria, '--gold-2': this.misturar(c.cor_primaria, '#ffffff', 0.35), '--gold-3': c.cor_secundaria,
      '--gold-rgb': `${r}, ${g}, ${b}`, '--gold-soft': `rgba(${r}, ${g}, ${b}, .12)`,
      '--gold-grad': `linear-gradient(135deg, ${this.misturar(c.cor_primaria, '#ffffff', 0.45)} 0%, ${c.cor_primaria} 45%, ${c.cor_secundaria} 100%)`,
      '--btn-texto': this.textoSobre(c.cor_primaria),
      '--bg': fundo, '--bg-2': this.misturar(fundo, texto, 0.04), '--card': this.misturar(fundo, texto, 0.07), '--card-2': this.misturar(fundo, texto, 0.1),
      '--line': this.misturar(fundo, texto, 0.15), '--line-2': this.misturar(fundo, texto, 0.2),
      '--text': texto, '--muted': this.misturar(texto, fundo, claro ? 0.4 : 0.36), '--muted-2': this.misturar(texto, fundo, 0.55),
    };
    const root = document.documentElement.style;
    for (const [k, val] of Object.entries(v)) root.setProperty(k, val);
    document.querySelector('meta[name=theme-color]')?.setAttribute('content', fundo);
    // fonte (lista fechada)
    const fonte = FONTES.includes(c.fonte) ? c.fonte : 'Inter';
    if (fonte !== 'Inter' && !document.getElementById('tema-fonte')) {
      const l = document.createElement('link'); l.id = 'tema-fonte'; l.rel = 'stylesheet';
      l.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(fonte)}:wght@400;500;600;700;800&display=swap`;
      document.head.appendChild(l);
    }
    root.setProperty('--fonte', `'${fonte}', Inter, system-ui, sans-serif`);
    document.body && (document.body.style.fontFamily = `'${fonte}', Inter, system-ui, sans-serif`);
    if (favicon && (c.favicon_url || c.logo_url)) document.querySelectorAll('link[rel=icon], link[rel=apple-touch-icon]').forEach(l => l.href = c.favicon_url || c.logo_url);
  },

  nome(fallback) { return this.atual?.nome_exibicao || fallback || ''; },
  logo() { return this.atual?.logo_url || null; },
  // logo ou, sem logo, as iniciais do nome num selo
  logoHTML(classe = '', estilo = '') {
    // sem tema carregado (modo local / antes da nuvem): identidade original do app
    if (!this.atual) return this.marcaHTML(classe, estilo);
    const u = this.logo();
    if (u) return `<img class="${classe}" src="${esc(u)}" alt="${esc(this.nome())}" style="${estilo}">`;
    const ini = (this.nome('Loja').split(/\s+/).map(p => p[0]).join('').slice(0, 2) || 'L').toUpperCase();
    return `<div class="${classe} tema-selo" style="${estilo}">${esc(ini)}</div>`;
  },
  // logo da Oficina Simples (telas sem loja: login, cadastro)
  marcaHTML(classe = '', estilo = '') { return `<img class="${classe}" src="${PLATAFORMA.logo}" alt="${PLATAFORMA.nome}" style="${estilo}">`; },
  // nome com a última palavra destacada (ex.: "Oficina do <gold>João</gold>")
  nomeHTML(fallback) {
    const n = this.nome(fallback).trim(); const i = n.lastIndexOf(' ');
    // data-no-i18n: o nome da loja nunca é traduzido (ex.: "Loja do João")
    return `<span data-no-i18n>${i > 0 ? `${esc(n.slice(0, i))} <span class="gold">${esc(n.slice(i + 1))}</span>` : `<span class="gold">${esc(n)}</span>`}</span>`;
  },
};
