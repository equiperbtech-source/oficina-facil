/* Idiomas do sistema: português (padrão) e espanhol latino-americano.
   - O texto em português é a "chave". O dicionário de cada idioma fica em js/i18n-es.js.
   - Em português nada é traduzido (o tradutor fica desligado).
   - Em espanhol, o tradutor de tela troca os textos que aparecem (inclusive os que surgem depois:
     janelas, avisos, listas), além de placeholder, title e aria-label. O que não estiver no
     dicionário continua em português: nunca quebra a tela.
   - O que o lojista digita (nome de cliente, defeito...) não é traduzido.
   O idioma vem, nesta ordem: escolha da pessoa (salva no aparelho), idioma da loja, idioma do navegador. */
const I18N = {
  idiomas: { pt: 'Português', es: 'Español' },   // português é o principal (produto vendido no Brasil)
  chave: 'oficina_idioma',
  idioma: 'pt',
  dic: {},      // { es: { 'texto pt': 'texto es' } }
  regras: {},   // { es: [[/regex/, 'troca' | função], ...] }

  iniciar() {
    // link com ?idioma=pt ou ?idioma=es (ex.: landing do Brasil) já define a escolha
    const url = new URLSearchParams(location.search).get('idioma');
    // Páginas do cliente final (acompanhamento da OS, vitrine, pedido): seguem o idioma da LOJA, nunca o do
    // aparelho de quem abre. Até a loja responder (ou se ela não tiver idioma salvo), português.
    this.publica = /^\/(acompanhar|vitrine|pedido)(\/|\.html|$)/.test(location.pathname);
    if (this.publica) { this.urlFixa = !!this.idiomas[url]; this.idioma = this.urlFixa ? url : 'pt'; document.documentElement.lang = this.locale(); return; }
    if (this.idiomas[url]) try { localStorage.setItem(this.chave, url); } catch {}
    const esc = this.escolhido();
    // sem escolha: o idioma da última oficina usada neste aparelho (quem já usa o sistema não vê o login
    // trocar de idioma); senão português (principal), a não ser que a configuração do site diga outro
    let daLoja = null;
    try { daLoja = localStorage.getItem('oficina_idioma_loja') || JSON.parse(localStorage.getItem('oficina_loja') || 'null')?.tema?.idioma || null; } catch {}
    const padrao = (typeof window !== 'undefined' && window.OFICINA_CONFIG?.idiomaPadrao) || 'pt';
    this.idioma = [esc, daLoja, padrao, 'pt'].find(x => this.idiomas[x]);
    document.documentElement.lang = this.locale();
  },
  locale() { return this.idioma === 'es' ? 'es' : 'pt-BR'; },
  escolhido() { try { return localStorage.getItem(this.chave); } catch { return null; } },
  // a pessoa escolheu (botão ou cadastro): salva e recarrega se mudou
  trocar(id, recarregar = true) {
    if (!this.idiomas[id]) return;
    try { localStorage.setItem(this.chave, id); } catch {}
    const mudou = id !== this.idioma;
    this.idioma = id; document.documentElement.lang = this.locale();
    if (!mudou || !recarregar) return;
    // dono trocando o idioma do app: a loja (vitrine, links do cliente e e-mails) passa a usar o mesmo
    const dono = !this.publica && typeof Cloud !== 'undefined' && Cloud.loja && Cloud.papel?.() === 'dono' && Cloud.podeEscrever?.();
    (dono ? Cloud.definirIdioma(id).catch(() => {}) : Promise.resolve()).then(() => location.reload());
  },
  // idioma da loja (páginas públicas e quem ainda não escolheu): não salva como escolha da pessoa
  usarDaLoja(id) {
    if (this.publica) {
      // página do cliente: a loja decide (sem idioma salvo = português); só o ?idioma= do link vence
      id = this.idiomas[id] ? id : 'pt';
      if (this.urlFixa || id === this.idioma) return false;
      this.idioma = id; document.documentElement.lang = this.locale();
      this.ligar(); this.traduzirTudo();
      return true;
    }
    if (!this.idiomas[id]) return false;
    try { localStorage.setItem('oficina_idioma_loja', id); } catch {}
    if (this.escolhido() || id === this.idioma) return false;
    this.idioma = id; document.documentElement.lang = this.locale();
    this.ligar(); this.traduzirTudo();
    return true;
  },
  botaoHTML(extra = '') {
    return `<div class="idioma-btn ${extra}" role="group" aria-label="Idioma" data-no-i18n>${Object.keys(this.idiomas).map(id =>
      `<button type="button" class="${id === this.idioma ? 'on' : ''}" onclick="I18N.trocar('${id}')" title="${this.idiomas[id]}">${id.toUpperCase()}</button>`).join('')}</div>`;
  },

  // PDFs (jsPDF): o texto não passa pela tela, então traduz na hora de escrever.
  // Entende títulos em MAIÚSCULAS ("CLIENTE") e rótulos com dois-pontos ("Nome:", "Forma de pagamento: PIX").
  pdf(doc) {
    if (this.idioma === 'pt' || !doc) return doc;
    const tr = s => {
      if (typeof s !== 'string' || !/[A-Za-zÀ-ÿ]/.test(s)) return s;
      let r = this.traduzir(s); if (r !== s) return r;
      if (s === s.toUpperCase()) { r = this.traduzirMaiusculo(s); if (r) return r; }
      const m = s.match(/^([^:]{2,40}):(\s*)(.*)$/);
      if (m) { const k = this.traduzir(m[1]); const v = m[3] ? this.traduzir(m[3]) : ''; if (k !== m[1] || v !== m[3]) return k + ':' + m[2] + v; }
      return s;
    };
    const txt = doc.text.bind(doc), split = doc.splitTextToSize.bind(doc);
    doc.text = (t, ...r) => txt(Array.isArray(t) ? t.map(tr) : tr(t), ...r);
    doc.splitTextToSize = (t, ...r) => split(tr(t), ...r);
    return doc;
  },
  traduzirMaiusculo(s) {
    const d = this.dic[this.idioma] || {};
    if (!this._maiusc) { this._maiusc = {}; for (const k in d) this._maiusc[k.toUpperCase()] = d[k]; }
    const v = this._maiusc[s]; return v ? v.toUpperCase() : null;
  },

  // ---------- tradução ----------
  traduzir(s) {
    if (this.idioma === 'pt' || !s) return s;
    const d = this.dic[this.idioma] || {};
    if (Object.prototype.hasOwnProperty.call(d, s)) return d[s];
    for (const [re, troca] of this.regras[this.idioma] || []) {
      const m = s.match(re);
      if (m) return typeof troca === 'function' ? troca(...m) : s.replace(re, troca);
    }
    return s;
  },
  // texto de um nó, mantendo os espaços das pontas
  traduzirTextoNo(n) {
    const v = n.nodeValue; if (!v || !/[A-Za-zÀ-ÿ]/.test(v)) return;
    const s = v.trim(); const tr = this.traduzir(s);
    if (tr !== s) n.nodeValue = v.replace(s, tr);
  },
  ignorar(el) { return !el || !!el.closest('script,style,textarea,[contenteditable],[data-no-i18n]'); },
  // placeholder, title e aria-label (também em campos de texto), menos onde a tradução foi desligada
  traduzirAttrs(el) {
    if (el.closest('[data-no-i18n],[contenteditable]')) return;
    for (const a of ['placeholder', 'title', 'aria-label']) {
      const v = el.getAttribute(a); if (!v) continue;
      const tr = this.traduzir(v.trim()); if (tr !== v.trim()) el.setAttribute(a, tr);
    }
  },
  traduzirEl(raiz) {
    if (this.idioma === 'pt' || !raiz) return;
    if (raiz.nodeType === 3) { if (!this.ignorar(raiz.parentElement)) this.traduzirTextoNo(raiz); return; }
    if (raiz.nodeType !== 1) return;
    this.traduzirAttrs(raiz);
    raiz.querySelectorAll('[placeholder],[title],[aria-label]').forEach(el => this.traduzirAttrs(el));
    if (this.ignorar(raiz)) return;
    const w = document.createTreeWalker(raiz, NodeFilter.SHOW_TEXT);
    let n; while ((n = w.nextNode())) if (!this.ignorar(n.parentElement)) this.traduzirTextoNo(n);
  },
  traduzirTudo() {
    if (this.idioma === 'pt') return;
    if (document.body) this.traduzirEl(document.body);
    const tt = this.traduzir(document.title); if (tt !== document.title) document.title = tt;
  },
  ligar() {
    if (this.idioma === 'pt' || this.obs || typeof MutationObserver === 'undefined') return;
    this.obs = new MutationObserver(ms => {
      for (const m of ms) {
        if (m.type === 'childList') m.addedNodes.forEach(n => this.traduzirEl(n));
        else if (m.type === 'characterData') { if (!this.ignorar(m.target.parentElement)) this.traduzirTextoNo(m.target); }
        else if (m.type === 'attributes') this.traduzirAttrs(m.target);
      }
      const tt = this.traduzir(document.title); if (tt !== document.title) document.title = tt;
    });
    this.obs.observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['placeholder', 'title', 'aria-label'] });
  },
};

// t('texto') e t('Faltam {n} dias', { n: 3 }) para textos montados no código (ex.: mensagens do WhatsApp)
function t(texto, vars) {
  let s = I18N.traduzir(texto);
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] ?? m));
  return s;
}
// locale das datas (dia da semana, mês) no idioma atual
const idiomaLocale = () => I18N.locale();

I18N.iniciar();
document.addEventListener('DOMContentLoaded', () => { I18N.ligar(); I18N.traduzirTudo(); });
