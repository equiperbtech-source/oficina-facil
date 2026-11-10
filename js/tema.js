/* Tema da oficina (white-label): cores, fonte, logo e nome. Layout fixo; só a aparência muda.
   Usado no app e nas páginas públicas. O contraste segue a WCAG AA (texto normal ≥ 4,5:1). */
// Marca da plataforma (o app); cada oficina coloca a própria marca ao lado
// Nome do sistema: Oficina Simples (o mesmo em português e espanhol)
const PLATAFORMA = {
  logo: '/assets/oficina-simples.svg', icone: '/assets/os-192.png',
  // domínio principal (cada oficina fica em <endereço curto>.<dominio>); vem do js/config.js,
  // gerado na publicação a partir da variável OFICINA_DOMINIO. Vazio = endereços por oficina desligados.
  get dominio() { return String((typeof window !== 'undefined' && window.OFICINA_CONFIG && window.OFICINA_CONFIG.dominio) || ''); },
  suporteWhats: '+55 48 99115-4821',   // WhatsApp do suporte (botão "Falar com o suporte" do menu)
  get es() { return typeof I18N !== 'undefined' && I18N.idioma === 'es'; },
  get nome() { return 'Oficina Simples'; },
  // nome com a segunda parte em azul (nunca traduzido pelo tradutor de tela)
  marcaTexto() { return '<span data-no-i18n>Oficina <span class="gold">Simples</span></span>'; },
};
const FONTES = ['Inter', 'Roboto', 'Poppins', 'Montserrat', 'Open Sans', 'Lato'];
const TEMA_PADRAO = { cor_primaria: '#1E3A8A', cor_secundaria: '#172554', cor_fundo: '#FFFFFF', fonte: 'Inter' };
// variáveis que o tema da oficina pode trocar (sem tema: valem as do css/style.css)
const TEMA_VARS = ['--gold', '--gold-2', '--gold-3', '--gold-rgb', '--gold-soft', '--gold-soft-2', '--gold-grad', '--btn-texto',
  '--bg', '--bg-2', '--card', '--card-2', '--line', '--line-2', '--line-input', '--text', '--muted', '--muted-2', '--sombra-rgb',
  '--green', '--red', '--blue', '--orange', '--purple', '--glass-hi'];

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
    const root = document.documentElement.style;
    TEMA_VARS.forEach(k => root.removeProperty(k));
    const fundo = c.cor_fundo, texto = this.textoSobre(fundo), claro = texto === '#000000';
    const padrao = String(c.cor_primaria).toLowerCase() === TEMA_PADRAO.cor_primaria.toLowerCase() && String(fundo).toLowerCase() === '#ffffff';
    const [r, g, b] = this.rgb(c.cor_primaria);
    // tema padrão: só os tokens do CSS. Cor própria da oficina: troca o destaque e, se o fundo não for
    // branco, calcula os cinzas a partir do fundo (fundo escuro ganha as cores de status claras).
    const v = padrao ? {} : {
      '--gold': c.cor_primaria, '--gold-2': c.cor_primaria, '--gold-3': c.cor_secundaria,
      '--gold-rgb': `${r}, ${g}, ${b}`, '--gold-soft': this.misturar(fundo, c.cor_primaria, claro ? 0.08 : 0.16), '--gold-soft-2': this.misturar(fundo, c.cor_primaria, claro ? 0.16 : 0.26),
      '--gold-grad': `linear-gradient(180deg, ${this.misturar(c.cor_primaria, '#ffffff', 0.12)} 0%, ${c.cor_primaria} 100%)`,
      '--btn-texto': this.textoSobre(c.cor_primaria),
    };
    if (!padrao && String(fundo).toLowerCase() !== '#ffffff') Object.assign(v, {
      '--bg': fundo, '--bg-2': this.misturar(fundo, texto, 0.04), '--card': claro ? fundo : this.misturar(fundo, texto, 0.07), '--card-2': this.misturar(fundo, texto, claro ? 0.04 : 0.1),
      '--line': this.misturar(fundo, texto, 0.12), '--line-2': this.misturar(fundo, texto, 0.2), '--line-input': this.misturar(fundo, texto, 0.42),
      '--text': claro ? '#0F172A' : '#FFFFFF', '--muted': this.misturar(texto, fundo, 0.36), '--muted-2': this.misturar(texto, fundo, 0.42),
      ...(claro ? {} : { '--sombra-rgb': '0, 0, 0', '--glass-hi': 'rgba(255, 255, 255, .14)', '--green': '#4ade80', '--red': '#f87171', '--blue': '#60a5fa', '--orange': '#fb923c', '--purple': '#c084fc' }),
    });
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
  // logo da Oficina Simples (telas sem oficina: login, cadastro)
  marcaHTML(classe = '', estilo = '') { return `<img class="${classe}" src="${PLATAFORMA.logo}" alt="${PLATAFORMA.nome}" style="${estilo}">`; },
  // nome com a última palavra destacada (ex.: "Oficina do <gold>João</gold>")
  nomeHTML(fallback) {
    const n = this.nome(fallback).trim(); const i = n.lastIndexOf(' ');
    // data-no-i18n: o nome da oficina nunca é traduzido (ex.: "Loja do João")
    return `<span data-no-i18n>${i > 0 ? `${esc(n.slice(0, i))} <span class="gold">${esc(n.slice(i + 1))}</span>` : `<span class="gold">${esc(n)}</span>`}</span>`;
  },
};
