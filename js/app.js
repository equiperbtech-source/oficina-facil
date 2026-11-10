/* Shell do app: login, menu lateral e roteamento */
const SESSION_KEY = 'oficina_session';

const APP_VERSAO = '1.3';
// código da publicação: o build troca pelo commit publicado (sem build, fica assim e o aviso de versão nova fica desligado)
const BUILD_ID = '__BUILD_ID__';
const NAV = [
  ['Gestão Operacional', [
    ['dashboard', 'Painel', 'dash'],
    ['patio', 'Pátio', 'car'],
    ['mecanico', 'Mecânico', 'wrench'],
    ['os', 'Ordens de serviço', 'file'],
    ['orcamentos', 'Orçamentos', 'card'],
    ['metas', 'Metas', 'star'],
    ['fornecedor', 'Fornecedores', 'truck'],
  ]],
  ['Clientes e vendas', [
    ['clientes', 'Clientes', 'users'],
    ['pecas', 'Peças e estoque', 'box'],
    ['vendas', 'Balcão', 'bag'],
    ['posvenda', 'Pós-venda', 'chat'],
    ['vitrine', 'Vitrine', 'tag'],
  ]],
  ['Administrativo', [
    ['servicos', 'Serviços', 'wrench'],
    ['financeiro', 'Financeiro', 'chart'],
    ['caixa', 'Caixa', 'bank'],
    ['relatorios', 'Relatórios', 'report'],
    ['plano', 'Meu plano', 'shieldCheck'],
    ['config', 'Configurações', 'settings'],
  ]],
];
// Telas que dependem de um recurso do plano (sem ele: tela de upgrade; os dados continuam guardados)
const ROTA_RECURSO = { metas: 'metas', posvenda: 'followup', vitrine: 'vitrine' };
// Módulos que a oficina pode desligar (plano Pro). Os essenciais (painel, OS, clientes, plano, configurações) ficam sempre.
const MODULOS = [['patio', 'Pátio'], ['orcamentos', 'Orçamentos'], ['fornecedor', 'Fornecedores'], ['pecas', 'Peças e estoque'], ['vendas', 'Balcão'],
  ['posvenda', 'Pós-venda'], ['vitrine', 'Vitrine'], ['metas', 'Metas'], ['servicos', 'Serviços'], ['financeiro', 'Financeiro'], ['caixa', 'Caixa'], ['relatorios', 'Relatórios']];
// Telas escondidas por papel (o banco também bloqueia os dados)
const ROTA_OCULTA = {
  tecnico: ['vendas', 'financeiro', 'caixa', 'relatorios', 'metas', 'vitrine', 'fornecedor'],
  atendente: ['financeiro', 'relatorios'],
};

const TEMA_HOST_KEY = 'oficina_tema_host';
const App = {
  route: 'dashboard',
  params: {},

  async start() {
    document.title = PLATAFORMA.nome;
    addEventListener('hashchange', () => this.render());
    // site de preview/teste: faixa fixa para não confundir com o site real
    const amb = window.OFICINA_CONFIG?.ambiente;
    if (amb && amb !== 'production') document.body.insertAdjacentHTML('beforeend', `<div style="position:fixed;left:0;right:0;bottom:0;z-index:9999;background:#f59e0b;color:#000;font:700 12px/1.6 Inter,sans-serif;text-align:center;pointer-events:none">AMBIENTE DE TESTE · ${window.OFICINA_CONFIG.supabaseUrl ? 'banco de teste' : 'modo local, sem banco'}</div>`);
    if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
      // versão nova publicada: avisa na tela em vez de recarregar sozinho (não perde o que está sendo digitado)
      const tinha = !!navigator.serviceWorker.controller;
      navigator.serviceWorker.addEventListener('controllerchange', () => { if (tinha) this.avisoVersao(); });
      navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(r => { r.update().catch(() => {}); setInterval(() => r.update().catch(() => {}), 30 * 60000); }).catch(() => {});
    }
    this.vigiarVersao();
    if (Cloud.enabled) {
      // aparência guardada da última oficina (evita piscar a identidade errada)
      try { const l = JSON.parse(localStorage.getItem('oficina_loja')); if (l?.tema) Tema.aplicar(l.tema, { favicon: false }); } catch {}
      $('#app').innerHTML = `<div class="login">${Tema.logoHTML('login-logo', 'width:160px')}</div>`;
      try { await Cloud.init(); } catch (e) { console.warn(e); }
      // endereço de oficina que não existe: avisa (logado ou não). Logado ganha o botão para a própria oficina
      if (await Cloud.hostDesconhecido()) return this.lojaNaoEncontrada();
      if (Cloud.user && await this.bootCloud() === 'outra-loja') return;
    }
    this.render();
    this.verComunicados();
    // também confere de tempos em tempos e ao voltar para a aba (comunicado enviado com o sistema aberto)
    setInterval(() => this.verComunicados(), 2 * 60000);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') this.verComunicados(); });
  },

  // Comunicados da plataforma (escritos no /admin): pop-up uma vez para cada pessoa
  async verComunicados() {
    if (!Cloud.enabled || !Cloud.user || !Cloud.loja || this._vendoCom || Date.now() - (this._comEm || 0) < 60000) return;
    this._comEm = Date.now();
    // "só lojas em português/espanhol" = idioma da oficina (o da tela só quando a oficina não tem)
    const idioma = Cloud.loja.tema?.idioma || I18N.idioma;
    // versão Kiwify (português) ou Hotmart (espanhol) conforme a oficina; banco sem a etapa 17: versão única
    let r; try {
      r = await Cloud.sb.rpc('meus_comunicados', { p_idioma: idioma, p_loja: Cloud.loja.id });
      if (r.error) r = await Cloud.sb.rpc('meus_comunicados', { p_idioma: idioma });
    } catch { return; }
    if (r.error || !r.data?.length) return;
    this._vendoCom = true;
    for (const c of r.data) await new Promise(fim => {
      const texto = esc(c.mensagem).replace(/https?:\/\/[^\s<]+/g, u => `<a href="${u}" target="_blank" rel="noopener">${u}</a>`);
      openModal({
        title: c.titulo || t('Comunicado'), subtitle: PLATAFORMA.nome, icon: 'bell',
        body: `<div data-no-i18n style="white-space:pre-wrap;font-size:16px;line-height:1.5">${texto}</div>`,
        foot: `<button class="btn primary" data-close>${t('Entendi')}</button>`,
        onClose: () => { Cloud.sb.rpc('marcar_comunicado_lido', { p_id: c.id }).then(() => {}, () => {}); fim(); },
      });
    });
    this._vendoCom = false;
  },

  async lojaNaoEncontrada() {
    Tema.aplicar(null);
    // sem idioma escolhido neste endereço: segue o idioma do aparelho (português, a não ser que seja espanhol)
    if (!I18N.escolhido()) { I18N.idioma = /^es/i.test(navigator.language || '') ? 'es' : 'pt'; document.documentElement.lang = I18N.locale(); }
    document.title = t('Oficina não encontrada');
    const principal = 'https://app.' + PLATAFORMA.dominio;
    // logado: o botão leva para a oficina dele (endereço próprio, se tiver)
    let minha = null;
    if (Cloud.user) try {
      await Cloud.carregarLoja();
      const id = Cloud.lojas?.[0]?.id;
      if (id) { const r = await Cloud.sb.from('lojas').select('slug').eq('id', id).maybeSingle(); minha = r.data?.slug ? `https://${r.data.slug}.${PLATAFORMA.dominio}` : principal; }
    } catch {}
    $('#app').innerHTML = `<div class="login"><div class="login-box" style="text-align:center">
      ${Tema.logoHTML('login-logo', 'width:140px')}
      <h2 style="margin:16px 0 8px">${t('Oficina não encontrada')}</h2>
      <p class="muted">${t('O endereço {h} não pertence a nenhuma oficina. Confira se digitou certo.', { h: `<b>${esc(location.hostname)}</b>` })}</p>
      ${minha ? `<a class="btn primary block" style="margin-top:18px" href="${esc(minha)}">${t('Ir para a minha oficina')} ${icon('arrowRight')}</a>`
        : `<a class="btn primary block" style="margin-top:18px" href="${principal}">${t('Entrar na Oficina Simples')} ${icon('arrowRight')}</a>`}
    </div></div>`;
  },

  // Entrou com uma conta que não é da oficina deste endereço: sai e mostra o endereço certo
  async contaDeOutraLoja() {
    let destino = 'https://app.' + PLATAFORMA.dominio;
    try { const r = await Cloud.sb.from('lojas').select('slug').eq('id', Cloud.lojas[0].id).maybeSingle(); if (r.data?.slug) destino = `https://${r.data.slug}.${PLATAFORMA.dominio}`; } catch {}
    const email = Cloud.user?.email || '', nomeHost = this._temaHost?.nome_exibicao || location.hostname;
    await Cloud.signOut();
    this._temaLogin = false;
    $('#app').innerHTML = `<div class="login"><div class="login-box" style="text-align:center">
      ${Tema.logoHTML('login-logo', 'width:120px')}
      <h2 style="margin:16px 0 8px">${t('Esta conta é de outra oficina')}</h2>
      <p class="muted">${t('O login {e} não faz parte da oficina deste endereço ({h}). Entre pelo endereço da sua oficina.', { e: `<b>${esc(email)}</b>`, h: `<b>${esc(nomeHost)}</b>` })}</p>
      <a class="btn primary block" style="margin-top:18px" href="${esc(destino)}">${t('Ir para a minha oficina')} ${icon('arrowRight')}</a>
      <button class="btn block mt" id="ol-outra">${t('Entrar com outra conta')}</button>
    </div></div>`;
    $('#ol-outra').onclick = () => { $('#app').innerHTML = ''; this.render(); };
    return 'outra-loja';
  },

  // Depois do login: descobre a oficina do usuário e liga a sincronização
  async bootCloud(enviarLocais = false) {
    try {
      await Cloud.carregarLoja();
      Cloud.sincronizarEmail(); // se o e-mail de login mudou, atualiza o da equipe (não espera)
      // endereço de uma oficina (<nome>.<dominio>) só abre para quem é dessa oficina
      const h = Cloud.lojas?.length ? await Cloud.lojaDoHost() : null;
      if (h && h !== 'erro' && !Cloud.lojas.some(l => l.id === h.id)) return this.contaDeOutraLoja();
      if (Cloud.loja) { await Cloud.carregarAssinatura(); await Cloud.carregarTema(); Tema.aplicar(Cloud.loja.tema, { favicon: false }); }
      this.cacheLoja();
      // confere a assinatura de tempos em tempos (pagamento, fim do teste...)
      clearInterval(this._assTimer);
      this._assTimer = setInterval(async () => { const antes = JSON.stringify(Cloud.assinatura()); await Cloud.carregarAssinatura(); if (JSON.stringify(Cloud.assinatura()) !== antes) { this.cacheLoja(); if ($('.shell')) { $('.shell')?.remove(); this.render(); } } }, 10 * 60000);
    }
    catch (e) {
      // offline: usa a oficina guardada no aparelho
      try { const l = JSON.parse(localStorage.getItem('oficina_loja')); if (l && l.id === Store.db.lojaId && l.user?.id === Cloud.user.id) { Cloud.loja = l; Tema.aplicar(l.tema, { favicon: false }); } } catch {}
    }
    if (Cloud.loja) Cloud.start(enviarLocais).then(() => this.garantirMoeda()).catch(e => console.warn(e));
  },

  // moeda em que a oficina guarda os valores: decidida uma vez, depois de baixar as configurações.
  // Oficina nova: reais (o produto é vendido no Brasil). Nunca pelo idioma da tela. Dá para mudar em Configurações.
  async garantirMoeda(lojaNova = false) {
    if (Store.s.moedaBase || !Cloud.ehDono() || !Cloud.podeEscrever()) return;
    let m = 'BRL';
    if (!lojaNova) try { const r = await Cloud.sb.rpc('moeda_da_loja', { p_loja: Cloud.loja.id }); if (!r.error && r.data === 'CLP') m = 'CLP'; } catch {}
    if (Store.s.moedaBase) return;
    Store.s.moedaBase = m; Store.save();
    if (m !== 'BRL') App.refresh();
  },

  // depois de criar a oficina ou entrar numa equipe: assinatura (aviso do teste, recursos do plano) e tema antes de desenhar
  async prepararLoja() {
    await Cloud.carregarAssinatura(); await Cloud.carregarTema(); Tema.aplicar(Cloud.loja.tema, { favicon: false });
    this.cacheLoja();
    await Cloud.start(false); // loja nova nasce vazia: nada do que estiver guardado neste aparelho vai para ela
    await this.garantirMoeda(true); // loja nova: moeda pelo idioma do cadastro (espanhol = pesos)
  },

  // oficina nova: nome, tipos de veículo atendidos e o catálogo de serviços desses tipos
  prepararOficinaNova(nome, tipos) {
    const ts = (tipos || []).filter(x => TIPOS_VEICULO[x]);
    Store.s.loja = nome; Store.s.tiposVeiculo = ts.length ? ts : ['carro'];
    semearCatalogo(Store.s.tiposVeiculo);
    Store.save();
  },

  cacheLoja() { localStorage.setItem('oficina_loja', JSON.stringify({ ...Cloud.loja, user: { id: Cloud.user.id, email: Cloud.user.email } })); },

  logged() {
    if (Cloud.enabled) return !!(Cloud.user && Cloud.loja);
    return Store.db.auth && localStorage.getItem(SESSION_KEY) === Store.db.auth.email;
  },
  userEmail() { return Cloud.enabled ? (Cloud.user?.email || '') : (Store.db.auth?.email || ''); },

  go(route, params) {
    const q = params ? '?' + new URLSearchParams(params) : '';
    if (location.hash === `#/${route}${q}`) this.render(); else location.hash = `#/${route}${q}`;
  },

  parseHash() {
    let h = location.hash.replace(/^#\/?/, '');
    if (/access_token=|error_description=/.test(h)) h = '';
    const [r, q] = h.split('?');
    this.route = r || 'dashboard';
    this.params = Object.fromEntries(new URLSearchParams(q || ''));
  },

  /* ---------- Pedidos de orçamento feitos pelo cliente ---------- */
  // Pedido novo chegou em tempo real: som + pop-up
  novoPedido(p) {
    if (!this.logged() || p.lido) return;
    this._avisouPedidos = true;
    Pedidos.alerta();
    this.updateNav();
    if (this.route === 'os' && OSPage.st.tab === 'pedidos') this.refresh();
    Pedidos.popup([p]);
  },
  // Ao abrir o app (ou após sincronizar): avisa uma vez dos pedidos não lidos
  avisarPedidos() {
    if (!this._avisouVitrine && this.logged() && $('#main') && Cloud.temRecurso('vitrine')) {
      const nv = Store.db.pedidos_vitrine.filter(p => !p.deleted && p.status === 'novo' && !p.lido);
      if (nv.length) { this._avisouVitrine = true; setTimeout(() => VitrineAdmin.avisar(nv, false), 900); }
    }
    if (this._avisouPedidos || !this.logged() || !$('#main')) return;
    const n = Pedidos.naoLidos(); if (!n.length) return;
    this._avisouPedidos = true;
    setTimeout(() => Pedidos.popup(n), 600);
  },

  checkRecovery() { if (Cloud.recovery) { Cloud.recovery = false; Pages.config.senha(true); } },

  render() {
    closeAllModals(); closeDropdown();
    setTimeout(() => this.checkRecovery(), 0);
    if (!this.logged()) {
      if (Cloud.enabled) return Cloud.user ? this.renderOnboarding() : this.renderCloudLogin();
      return this.renderLogin();
    }
    this.parseHash();
    if (this.route === 'bancada') this.route = 'patio';   // endereço antigo
    if (Cloud.papel() === 'tecnico' && (!location.hash || /^#\/?(dashboard)?$/.test(location.hash))) this.route = 'mecanico';   // mecânico abre direto na tela dele
    FilaFotos.ligar();
    Etapas.aplicar();
    if (!Pages[this.route] || !this.rotaVisivel(this.route)) this.route = 'dashboard';
    if (!$('.shell')) this.renderShell();
    this.updateNav();
    this.updateAviso();
    this.closeMenu();
    const main = $('#main');
    main.innerHTML = '';
    document.body.classList.remove('com-carrinho');
    this.pagina().render(main, this.params);
    scrollTo(0, 0);
    this.avisarPedidos();
  },

  refresh() { Etapas.aplicar(); const y = scrollY; const main = $('#main'); this.pagina().render(main, this.params); this.updateNav(); this.updateAviso(); scrollTo(0, y); },

  /* ---------- Acesso por papel e por plano ---------- */
  rotaVisivel(r) {
    if ((ROTA_OCULTA[Cloud.papel()] || []).includes(r)) return false;
    // módulo desligado pela oficina (só vale com o recurso do plano)
    if (Store.s.modulos?.[r] === false && Cloud.temRecurso('modulos_personalizaveis')) return false;
    return true;
  },
  rotaBloqueada(r) { const rec = ROTA_RECURSO[r]; return rec && !Cloud.temRecurso(rec) ? rec : null; },
  // página a mostrar: a da rota ou a tela de upgrade do recurso que falta
  pagina() {
    const rec = this.rotaBloqueada(this.route);
    return rec ? { render: main => Pages.bloqueado.render(main, rec) } : Pages[this.route];
  },
  // faixa no topo: teste, atraso, somente leitura, bloqueio
  updateAviso() {
    const el = $('#aviso-plano'); if (!el) return;
    const a = Cloud.assinatura();
    // acesso de suporte da plataforma (painel admin): sempre visível e somente leitura
    const sup = Cloud.papel() === 'suporte' ? `<div class="aviso-plano red">${icon('shield', 'sm')}<span class="grow"><b>Modo suporte</b> (somente leitura) na oficina ${esc(Cloud.loja?.nome || '')}. O acesso fica registrado.</span><button class="btn sm" onclick="App.sairSuporte()">Sair</button></div>` : '';
    const ped = Cloud.pedidosEquipe ? `<div class="aviso-plano orange">${icon('userPlus', 'sm')}<span class="grow"><b>${Cloud.pedidosEquipe} pedido(s)</b> para entrar na equipe aguardando sua aprovação.</span><a class="btn sm" href="#/config" onclick="setTimeout(() => Pages.config.abrirTopico('cf-membros'), 400)">Ver</a></div>` : '';
    const html = sup + ped + (a ? Planos.aviso(a) : '');
    el.innerHTML = html; el.classList.toggle('hidden', !html);
    const selo = $('#selo-teste'); if (selo) selo.innerHTML = Cloud.enabled ? Planos.selo(a) : '';
  },
  async sairSuporte() {
    try { await Cloud.sb.rpc('admin_sair_da_loja', { p_loja: Cloud.loja.id }); } catch {}
    try { localStorage.removeItem('oficina_loja_escolhida'); } catch {}
    location.href = '/admin';
  },
  avisoSomenteLeitura() {
    if (Cloud.papel() === 'suporte') { if (!this._avisoRO || Date.now() - this._avisoRO > 4000) { this._avisoRO = Date.now(); toast('Modo suporte: somente leitura', true); } return; }
    if (this._avisoRO && Date.now() - this._avisoRO < 4000) return;
    this._avisoRO = Date.now();
    toast(Planos.textoSomenteLeitura(Cloud.assinatura()), true);
  },

  // Atualização vinda da nuvem: não atrapalha quem está digitando numa busca
  remoteRefresh() {
    this.updateNav(); this.updateBrand(); this.avisarPedidos();
    if (window._dd) return setTimeout(() => this.remoteRefresh(), 800); // menu aberto: espera fechar
    const a = document.activeElement;
    if (a && $('#main')?.contains(a) && /INPUT|TEXTAREA|SELECT/.test(a.tagName)) {
      a.addEventListener('blur', () => setTimeout(() => this.remoteRefresh(), 50), { once: true });
      return;
    }
    this.refresh();
  },
  // ---------- Versão nova do sistema ----------
  // Cada publicação gera /versao.json com o seu código. Quem está com o sistema aberto confere de tempos em
  // tempos (e ao voltar para a aba); se mudou, aparece o aviso para atualizar.
  vigiarVersao() {
    if (BUILD_ID.startsWith('__') || !location.protocol.startsWith('http')) return;
    const conferir = async () => {
      if (this._versaoNova) return this.avisoVersao();
      try {
        const r = await fetch('/versao.json?t=' + Date.now(), { cache: 'no-store' });
        const v = r.ok ? (await r.json()).build : null;
        if (v && v !== BUILD_ID) { this._versaoNova = v; this.avisoVersao(); }
      } catch {}
    };
    setTimeout(conferir, 20000);
    setInterval(conferir, 3 * 60000);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') conferir(); });
  },
  avisoVersao() {
    if ($('#aviso-versao') || Date.now() < (this._adiarVersao || 0)) return;
    const el = document.createElement('div'); el.id = 'aviso-versao';
    el.innerHTML = `<div class="av-card" role="alertdialog" aria-labelledby="av-t">
        <div class="av-ic">${icon('refresh')}</div>
        <h2 id="av-t">Nova versão do sistema</h2>
        <p>Fizemos melhorias no sistema. Atualize para receber as mudanças: leva só alguns segundos.</p>
        <button class="btn primary block" id="av-ok">${icon('refresh')} Atualizar agora</button>
        <button class="btn ghost block" id="av-depois">Depois</button>
      </div>`;
    document.body.appendChild(el);
    $('#av-ok', el).onclick = () => this.atualizarPagina();
    // "Depois": o aviso volta em 10 minutos
    $('#av-depois', el).onclick = () => { this._adiarVersao = Date.now() + 10 * 60000; el.remove(); };
  },
  // recarrega pegando os arquivos novos do servidor (o service worker busca na rede primeiro)
  async atualizarPagina() {
    try { const r = await navigator.serviceWorker?.getRegistration(); await r?.update(); } catch {}
    location.reload();
  },

  // WhatsApp do suporte da plataforma, já com a oficina e o e-mail de quem está pedindo ajuda
  linkSuporte() {
    return waLink(PLATAFORMA.suporteWhats, t('Olá! Preciso de ajuda com o sistema. Oficina: {loja} ({email}).', { loja: Store.s.loja || '', email: this.userEmail() || '' }));
  },
  updateBrand() {
    const s = Store.s; const ini = esc((s.responsavel || s.loja || 'R')[0].toUpperCase());
    $$('.js-ini').forEach(e => e.textContent = ini);
    const n = $('#sb-loja'); if (n) n.textContent = s.loja;
  },

  renderShell() {
    const s = Store.s;
    $('#app').innerHTML = `
      <aside class="sidebar" id="sidebar">
        <div class="sidebar-head">
          ${Tema.atual ? Tema.logoHTML('', 'width:38px;height:38px;border-radius:10px;object-fit:cover') : Tema.marcaHTML('', 'width:38px;height:38px;border-radius:10px')}
          <div style="min-width:0"><div class="t ellipsis" data-no-i18n>${Tema.atual ? Tema.nomeHTML(s.loja) : esc(s.loja || '')}</div><div class="xs muted ellipsis">${Tema.atual?.slogan ? esc(Tema.atual.slogan) + ' · ' : ''}por ${PLATAFORMA.nome}</div></div>
        </div>
        <nav class="nav" id="nav">
          ${NAV.map(([g, items]) => { const vis = items.filter(([r]) => this.rotaVisivel(r)); return vis.length ? `<div class="nav-title">${g}</div>` + vis.map(([r, l, ic]) => `<a href="#/${r}" data-r="${r}">${icon(ic)}<span>${l}</span>${this.rotaBloqueada(r) ? `<span class="nav-lock" title="${(Cloud.assinatura()?.bloqueados_teste || []).includes(this.rotaBloqueada(r)) ? 'Liberado quando você assinar' : 'Disponível em outro plano'}">${icon('lock', 'sm')}</span>` : ''}<span class="count hidden"></span></a>`).join('') : ''; }).join('')}
          <div class="nav-title">Ajuda</div>
          <a href="${this.linkSuporte()}" target="_blank" rel="noopener" class="nav-suporte">${icon('whatsapp')}<span>Falar com o suporte</span></a>
          <a href="#" class="so-celular" onclick="event.preventDefault();App.atualizarPagina()">${icon('refresh')}<span>Atualizar o sistema</span></a>
        </nav>
        <div class="sidebar-foot">
          <div class="avatar js-ini">${esc((s.responsavel || s.loja || 'R')[0].toUpperCase())}</div>
          <div class="grow"><div class="bold ellipsis" id="sb-loja" data-no-i18n>${esc(s.loja)}</div><div class="xs muted ellipsis">${esc(this.userEmail())}</div></div>
          <button class="icon-btn" title="Sair" onclick="App.logout()">${icon('logout')}</button>
        </div>
      </aside>
      <div class="sidebar-backdrop hidden" id="sb-backdrop" onclick="App.closeMenu()"></div>
      <div class="shell">
        <header class="topbar">
          <button class="icon-btn menu-btn" onclick="App.openMenu()" aria-label="Menu">${icon('menu')}</button>
          <a class="brand" href="#/dashboard"><img src="${PLATAFORMA.logo}" alt=""><span style="min-width:0;line-height:1.15"><span style="display:block;white-space:nowrap;font-size:16px">${PLATAFORMA.marcaTexto()}</span><span class="xs muted ellipsis brand-oficina" style="display:block;font-weight:600" data-no-i18n>${esc(Tema.nome(s.loja) || '')}</span></span></a>
          <div class="spacer"></div>
          <span id="selo-teste"></span>
          ${Cloud.enabled ? I18N.botaoHTML('idioma-topo') : ''}
          ${Cloud.enabled ? `<button class="icon-btn" id="sync-ind" onclick="App.syncAgora()"></button>` : ''}
          <button class="icon-btn so-largo" title="Atualizar o sistema" aria-label="Atualizar o sistema" onclick="App.atualizarPagina()">${icon('refresh')}</button>
          <button class="icon-btn" title="Nova OS" onclick="OSPage.novaOS()">${icon('plus')}</button>
          <a class="avatar js-ini" href="#/config" title="Configurações">${esc((s.responsavel || s.loja || 'R')[0].toUpperCase())}</a>
        </header>
        <div id="aviso-plano" class="hidden"></div>
        <main class="main" id="main"></main>
      </div>`;
    if (Cloud.enabled) Cloud.setStatus(Cloud.status);
  },

  async syncAgora() {
    toast({ ok: 'Tudo sincronizado com a nuvem', sync: 'Sincronizando...', offline: 'Sem internet: os dados estão salvos neste dispositivo e serão enviados quando a conexão voltar', erro: 'Tentando sincronizar novamente...' }[Cloud.status] || 'Sincronizando...', Cloud.status === 'erro');
    try { await Cloud.push(); await Cloud.pull(); } catch {}
  },

  updateNav() {
    $$('#nav a').forEach(a => a.classList.toggle('active', a.dataset.r === this.route));
    const counts = {
      patio: Store.db.os.filter(o => !o.deleted && OS_ATIVOS.includes(o.status)).length,
      orcamentos: Store.db.orcamentos.filter(o => !o.deleted && o.status === 'pendente').length,
      pecas: Store.db.pecas.filter(p => !p.deleted && p.qtd <= (p.minimo || 0)).length,
      posvenda: Cloud.temRecurso('followup') ? PosVenda.pendentes() + Followup.paraHoje().length : 0,
      vitrine: Cloud.temRecurso('vitrine') ? Store.db.pedidos_vitrine.filter(p => !p.deleted && p.status === 'novo').length : 0,
      os: Pedidos.naoLidos().length,
    };
    // aba: Oficina Simples | nome da empresa
    const empresa = Tema.nome(Store.s.loja);
    document.title = (counts.os ? `(${counts.os}) ` : '') + PLATAFORMA.nome + (empresa ? ' | ' + empresa : '');
    for (const [r, n] of Object.entries(counts)) {
      const el = $(`#nav a[data-r="${r}"] .count`);
      if (el) { el.textContent = n; el.classList.toggle('hidden', !n); }
    }
  },

  openMenu() { $('#sidebar').classList.add('open'); $('#sb-backdrop').classList.remove('hidden'); },
  closeMenu() { $('#sidebar')?.classList.remove('open'); $('#sb-backdrop')?.classList.add('hidden'); },

  async logout() {
    if (Cloud.enabled) {
      if (['erro', 'offline', 'sync'].includes(Cloud.status) && !(await confirmDialog('Há alterações que ainda não foram enviadas para a nuvem e serão perdidas se sair agora. Sair mesmo assim?', { danger: true, ok: 'Sair' }))) return;
      await Cloud.signOut();
      this._temaLogin = false; this._temaHost = null; // busca de novo a aparência da oficina do endereço
    } else localStorage.removeItem(SESSION_KEY);
    location.hash = ''; $('#app').innerHTML = ''; this.render();
  },

  /* ---------- Login na nuvem ---------- */
  renderCloudLogin(modo) {
    // link do e-mail de boas-vindas da assinatura: ?cadastro=1&email=... abre "Criar conta" já preenchido
    const qs = new URLSearchParams(location.search);
    if (!modo) modo = qs.get('cadastro') ? 'criar' : 'entrar';
    const criar = modo === 'criar';
    // tela de entrada com a cara da oficina do endereço (guardada no aparelho para abrir já certa)
    if (!this._temaHost && !Cloud.user) try { const c = JSON.parse(localStorage.getItem(TEMA_HOST_KEY)); if (c?.host === location.host && c.tema) { this._temaHost = c.tema; Tema.aplicar(c.tema); } } catch {}
    this.marcaDaPlataforma();
    if (!Cloud.user) document.title = this._temaHost ? Tema.nome(PLATAFORMA.nome) : PLATAFORMA.nome;
    $('#app').innerHTML = `
      <div class="login">
        <form class="login-box" id="login-form" autocomplete="on">
          <div class="login-idioma">${I18N.botaoHTML()}</div>
          ${Tema.logoHTML('login-logo')}
          ${Tema.atual ? '' : `<div class="center bold" style="font-size:26px;margin:-6px 0 10px">${PLATAFORMA.marcaTexto()}</div>`}
          <h1>${criar ? 'Criar <span class="gold">conta</span>' : 'Bem-vindo de <span class="gold">volta</span>'}</h1>
          <p class="muted" style="margin:0 0 20px">${criar ? 'Crie sua conta para usar o sistema no celular e no computador.' : 'Acesse sua conta para gerenciar sua oficina.'}</p>
          <div class="tabs mb"><button type="button" data-m="entrar" class="${criar ? '' : 'on'}" style="flex:1">Entrar</button><button type="button" data-m="criar" class="${criar ? 'on' : ''}" style="flex:1">Criar conta</button></div>
          ${criar ? field('Idioma do sistema', `<div class="idioma-escolha" data-no-i18n>${Object.entries({ pt: '🇧🇷 Português', es: '🌎 Español' }).map(([id, nome]) => `<button type="button" class="btn ${I18N.idioma === id ? 'outline-gold on' : ''}" data-idioma="${id}">${nome}</button>`).join('')}</div>`) : ''}
          ${field('E-mail', inputIcon('mail', 'name="email" type="email" required placeholder="seu@email.com" autocomplete="username"'))}
          ${field('Senha', `<div class="input-icon">${icon('lock')}<input class="input" name="senha" type="password" required minlength="6" placeholder="••••••••" autocomplete="${criar ? 'new-password' : 'current-password'}"><button type="button" class="icon-btn" style="position:absolute;right:4px;top:3px" onclick="const i=this.previousElementSibling;i.type=i.type==='password'?'text':'password'">${icon('eye')}</button></div>`)}
          ${criar ? field('Confirmar senha', inputIcon('lock', 'name="senha2" type="password" required minlength="6" placeholder="••••••••" autocomplete="new-password"')) : ''}
          <button class="btn primary block" id="lg-btn" style="margin-top:8px;min-height:54px;font-size:17px">${criar ? 'Criar conta' : 'Acessar Painel'} ${icon('arrowRight')}</button>
          ${criar ? '' : `<p class="center small" style="margin-top:18px"><a href="#" id="forgot">Esqueceu a senha?</a></p>
          <p class="center xs muted">Funcionário: entre com o e-mail e a senha que o dono criou para você.</p>`}
          <div class="foot">${Tema.atual?.rodape ? esc(Tema.atual.rodape) : `© ${new Date().getFullYear()} <span class="gold">${esc(Tema.atual ? Tema.nome() : PLATAFORMA.nome)}</span>. Todos os direitos reservados.`}</div>
        </form>
      </div>`;
    if (!this._temaLogin && !Cloud.loja) {
      this._temaLogin = true;
      Cloud.temaPublico().then(t => {
        if (t === undefined || Cloud.user) return; // sem internet: fica com o que estava guardado
        try { t ? localStorage.setItem(TEMA_HOST_KEY, JSON.stringify({ host: location.host, tema: t })) : localStorage.removeItem(TEMA_HOST_KEY); } catch {}
        if (JSON.stringify(t || null) === JSON.stringify(this._temaHost || null)) return;
        this._temaHost = t || null; Tema.aplicar(this._temaHost); this.renderCloudLogin(modo);
      });
    }
    $$('[data-m]').forEach(b => b.onclick = () => this.renderCloudLogin(b.dataset.m));
    // idioma: no login troca na hora (sem recarregar, para não perder o que foi digitado)
    const trocaIdioma = id => {
      const v = readForm($('#login-form'));
      I18N.trocar(id, false); I18N.ligar(); this.renderCloudLogin(modo);
      ['email', 'senha', 'senha2'].forEach(k => { const el = $(`#login-form [name=${k}]`); if (el && v[k]) el.value = v[k]; });
    };
    $$('.login-idioma [onclick]').forEach(b => { const id = b.textContent.trim().toLowerCase(); b.removeAttribute('onclick'); b.onclick = () => trocaIdioma(id); });
    $$('[data-idioma]').forEach(b => b.onclick = () => trocaIdioma(b.dataset.idioma));
    if (qs.get('email') && /^[^\s@]+@[^\s@]+$/.test(qs.get('email'))) $('[name=email]').value = qs.get('email');
    $('#login-form').onsubmit = async e => {
      e.preventDefault();
      const f = readForm(e.target); const btn = $('#lg-btn'); btn.disabled = true;
      try {
        if (criar) {
          if (f.senha !== f.senha2) throw new Error('As senhas não conferem');
          const logado = await Cloud.signUp(f.email.toLowerCase(), f.senha);
          if (!logado) {
            openModal({ title: 'Confirme seu e-mail', icon: 'mail', body: `<p style="margin-top:0">Enviamos um link de confirmação para <b class="gold">${esc(f.email)}</b>. Abra o e-mail, toque no link e depois entre com sua senha.</p>`, foot: '<button class="btn primary" data-close>Entendi</button>' });
            return this.renderCloudLogin('entrar');
          }
        } else await Cloud.signIn(f.email.toLowerCase(), f.senha);
        if (await this.bootCloud() === 'outra-loja') return;
        this.render();
      } catch (err) { toast(/fetch|network|load failed/i.test(err.message) ? 'Sem conexão com o servidor. Verifique a internet e tente de novo.' : err.message, true); } finally { btn.disabled = false; }
    };
    const fg = $('#forgot');
    if (fg) fg.onclick = async e => {
      e.preventDefault();
      const email = $('[name=email]').value.trim();
      if (!email) return toast('Digite seu e-mail no campo acima', true);
      try { await Cloud.resetSenha(email); toast('Enviamos um link para redefinir a senha no seu e-mail'); } catch (err) { toast(err.message, true); }
    };
  },

  // Login, cadastro e criação da oficina mostram a marca da plataforma: nunca a da última oficina usada
  // neste aparelho (ex.: depois de sair da oficina). Só o endereço próprio de uma oficina mostra a marca dela.
  marcaDaPlataforma() {
    if (Tema.atual && Tema.atual !== this._temaHost) Tema.aplicar(null, { favicon: false });
  },

  // Usuário logado mas ainda sem oficina: cria uma nova ou entra com código de convite
  renderOnboarding() {
    this.marcaDaPlataforma();
    $('#app').innerHTML = `
      <div class="login"><div class="login-box">
        ${Tema.logoHTML('login-logo', 'width:150px')}
        <h1>Quase <span class="gold">lá!</span></h1>
        <p class="muted" style="margin:0 0 20px">Logado como <b>${esc(Cloud.user.email)}</b>. Crie sua oficina ou entre na equipe de uma oficina.</p>
        <div class="card mb" style="border-color:rgba(var(--gold-rgb), .5);background:var(--gold-soft)">
          <div id="ob-pendentes"></div>
          <b>${icon('users', 'sm')} É funcionário?</b>
          <p class="small" style="margin:6px 0 10px">Não crie uma oficina. Peça ao dono para adicionar o e-mail <b>${esc(Cloud.user.email)}</b> em <b>Configurações → Equipe</b> e toque abaixo.</p>
          <button class="btn primary block" id="ob-retry">${icon('repeat')} Já fui adicionado, entrar</button>
        </div>
        <form class="card mb" id="ob-criar">
          <h3>${icon('wrench', 'sm')} Sou o dono: criar <span class="gold">oficina</span></h3>
          ${field('Nome da oficina', `<input class="input" name="nome" value="" placeholder="Ex: Oficina do João" required>`)}
          <div class="field"><label>Que veículos você atende?</label>
            <div class="grid grid-3 ob-tipos" role="radiogroup" aria-label="Que veículos você atende?">
              <label class="chip-opt ob-tipo"><input type="radio" name="tipos" value="carro" checked>${icon('car')}<span>Carro</span></label>
              <label class="chip-opt ob-tipo"><input type="radio" name="tipos" value="moto">${icon('moto')}<span>Moto</span></label>
              <label class="chip-opt ob-tipo"><input type="radio" name="tipos" value="carro,moto">${icon('car')}<span>Os dois</span></label>
            </div><div class="xs muted">Dá para mudar depois em Configurações.</div></div>
          <button class="btn primary block">${icon('check')} Criar oficina</button>
        </form>
        <form class="card mb" id="ob-entrar">
          <h3>${icon('users', 'sm')} Entrar com <span class="gold">código de convite</span></h3>
          <p class="small muted" style="margin-top:0">Peça o código ao dono da oficina (Configurações → Equipe).</p>
          ${field('Código', '<input class="input" name="codigo" placeholder="Ex: A1B2C3D4" required style="text-transform:uppercase;letter-spacing:.15em">')}
          <button class="btn outline-gold block">${icon('arrowRight')} Entrar na equipe</button>
        </form>
        <button class="btn ghost block" onclick="App.logout()">${icon('logout')} Sair</button>
      </div></div>`;
    // pedidos de entrada (código de convite) aguardando o dono aprovar
    Cloud.meusPedidosPendentes().then(ps => { const el = $('#ob-pendentes'); if (el && ps.length) el.innerHTML = ps.map(p => `<div class="aviso-plano gold" style="margin:0 0 12px">${icon('clock', 'sm')}<span class="grow">Seu pedido para entrar em <b>${esc(p.nome)}</b> está aguardando a aprovação do dono.</span></div>`).join(''); });
    $('#ob-retry').onclick = async () => {
      try { if (await Cloud.carregarLoja()) { await this.prepararLoja(); toast(`Você entrou na equipe de ${Cloud.loja.nome}`); this.render(); } else toast('Ainda não foi adicionado. Peça ao dono.', true); }
      catch (err) { toast(err.message, true); }
    };
    $('#ob-criar').onsubmit = async e => {
      e.preventDefault(); const f = readForm(e.target);
      const bt = e.target.querySelector('button.primary'); if (bt?.disabled) return; // toque duplo não cria duas oficinas
      if (bt) bt.disabled = true;
      try {
        await Cloud.criarLoja(f.nome);
        await this.prepararLoja();
        App.prepararOficinaNova(f.nome, String(f.tipos || 'carro').split(','));
        if (I18N.idioma !== 'pt') Store.aplicarPadroesIdioma(I18N.idioma);
        toast('Oficina criada!'); this.render();
      } catch (err) { toast(err.message, true); } finally { if (bt) bt.disabled = false; }
    };
    $('#ob-entrar').onsubmit = async e => {
      e.preventDefault(); const f = readForm(e.target);
      try {
        const locais = !Store.db.lojaId && (Store.db.os.length || Store.db.clientes.length || Store.db.vendas.length);
        if (locais && await confirmDialog('Este dispositivo tem dados que não estão na nuvem. Baixar um backup deles antes de entrar na equipe?', { ok: 'Baixar backup' })) Pages.config.backup();
        const r = await Cloud.entrarNaLoja(f.codigo);
        if (r.situacao === 'membro' && await Cloud.carregarLoja()) { await this.prepararLoja(); toast(`Você entrou na equipe de ${Cloud.loja.nome}`); return this.render(); }
        this.renderOnboarding();
        toast(t('Pedido enviado para {n}. Aguarde o dono aprovar.', { n: r.nome || t('a oficina') }));
      } catch (err) { toast(err.message, true); }
    };
  },

  renderLogin() {
    const first = !Store.db.auth;
    $('#app').innerHTML = `
      <div class="login">
        <form class="login-box" id="login-form" autocomplete="on">
          ${Tema.marcaHTML('login-logo')}
          <h1>${first ? 'Criar <span class="gold">acesso</span>' : 'Bem-vindo de <span class="gold">volta</span>'}</h1>
          <p class="muted" style="margin:0 0 24px">${first ? 'Primeiro acesso: defina o e-mail e a senha do painel.' : 'Acesse sua conta para gerenciar sua oficina.'}</p>
          ${field('E-mail', inputIcon('mail', `name="email" type="email" required placeholder="seu@email.com" autocomplete="username" value="${esc(Store.db.auth?.email || '')}"`))}
          ${field('Senha', `<div class="input-icon">${icon('lock')}<input class="input" name="senha" type="password" required minlength="4" placeholder="••••••••" autocomplete="${first ? 'new-password' : 'current-password'}"><button type="button" class="icon-btn" style="position:absolute;right:4px;top:3px" onclick="const i=this.previousElementSibling;i.type=i.type==='password'?'text':'password'">${icon('eye')}</button></div>`)}
          ${first ? field('Confirmar senha', inputIcon('lock', 'name="senha2" type="password" required minlength="4" placeholder="••••••••" autocomplete="new-password"')) : ''}
          ${first ? field('Nome da oficina', '<input class="input" name="nomeOficina" placeholder="Ex: Oficina do João">') + `<div class="field"><label>Que veículos você atende?</label>
            <div class="grid grid-3 ob-tipos" role="radiogroup" aria-label="Que veículos você atende?">
              <label class="chip-opt ob-tipo"><input type="radio" name="tipos" value="carro" checked>${icon('car')}<span>Carro</span></label>
              <label class="chip-opt ob-tipo"><input type="radio" name="tipos" value="moto">${icon('moto')}<span>Moto</span></label>
              <label class="chip-opt ob-tipo"><input type="radio" name="tipos" value="carro,moto">${icon('car')}<span>Os dois</span></label></div></div>` : ''}
          <button class="btn primary block" style="margin-top:8px;min-height:54px;font-size:17px">${first ? 'Criar e acessar' : 'Acessar Painel'} ${icon('arrowRight')}</button>
          ${first ? '' : `<p class="center small" style="margin-top:18px"><a href="#" id="forgot">Esqueceu a senha?</a></p>`}
          <div class="foot">© ${new Date().getFullYear()} <span class="gold">${PLATAFORMA.nome}</span>. Todos os direitos reservados.</div>
        </form>
      </div>`;
    $('#login-form').onsubmit = async e => {
      e.preventDefault();
      const f = readForm(e.target);
      if (first) {
        if (f.senha !== f.senha2) return toast('As senhas não conferem', true);
        Store.db.auth = { email: f.email.toLowerCase(), hash: await sha256(f.senha) };
        this.prepararOficinaNova(f.nomeOficina || 'Minha oficina', String(f.tipos || 'carro').split(','));
      } else {
        const ok = f.email.toLowerCase() === Store.db.auth.email && (await sha256(f.senha)) === Store.db.auth.hash;
        if (!ok) return toast('E-mail ou senha incorretos', true);
      }
      localStorage.setItem(SESSION_KEY, Store.db.auth.email);
      this.render();
    };
    const fg = $('#forgot');
    if (fg) fg.onclick = e => {
      e.preventDefault();
      openModal({
        title: 'Recuperar acesso', icon: 'lock',
        body: `<p class="muted" style="margin-top:0">Os dados ficam salvos apenas neste dispositivo. Para redefinir a senha, é preciso apagar o acesso atual — <b class="gold">seus dados (OS, clientes, estoque) são mantidos</b>.</p>`,
        foot: `<button class="btn" data-close>Cancelar</button><button class="btn primary" id="rst">Redefinir senha</button>`,
        onMount: (el, m) => { $('#rst', el).onclick = () => { Store.db.auth = null; Store.save(); m.close(); this.render(); }; },
      });
    };
  },
};

document.addEventListener('DOMContentLoaded', () => App.start());
