/* Planos e assinatura: aviso no topo, tela de upgrade e "Meu plano".
   Quem decide o que a loja pode é o banco (tem_recurso / pode_escrever); aqui só mostramos. */
const RECURSOS = {
  acompanhamento_os: 'Acompanhamento de OS em tempo real para o cliente',
  importar_xml: 'Importar estoque por XML (NF-e de compra)',
  lotes: 'Controle de lotes no estoque',
  tema: 'Logo, cor do tema e dados da empresa',
  modulos_personalizaveis: 'Escolher os módulos que aparecem',
  followup: 'Follow-up e pós-venda de clientes',
  metas: 'Metas da loja e por funcionário',
  vitrine: 'Vitrine online da loja',
  dominio_proprio: 'Domínio próprio',
  nota_fiscal: 'Notas fiscais (NFS-e/NF)',
};
// nomes curtos para a faixa do teste grátis
const RECURSO_CURTO = { vitrine: 'Vitrine online', nota_fiscal: 'Notas fiscais' };
const juntarE = l => l.length > 1 ? l.slice(0, -1).join(', ') + ' e ' + l[l.length - 1] : (l[0] || '');
// Pro Max (notas fiscais) ainda não está à venda: tire daqui quando liberar
const PLANOS_EM_BREVE = ['pro_max'];
const SITUACAO = {
  ativa: ['Ativa', 'green'], teste: ['Teste grátis', 'gold'], inadimplente: ['Pagamento atrasado', 'orange'],
  somente_leitura: ['Somente leitura', 'red'], expirada: ['Sem plano ativo', 'red'], bloqueada: ['Bloqueada', 'red'],
};
// usado só se a tabela de planos não puder ser lida (offline)
const PLANOS_PADRAO = [
  { id: 'essencial', nome: 'Essencial', preco_mensal: 49.99, max_funcionarios: 4, franquia_notas_mes: 0, recursos: ['acompanhamento_os', 'importar_xml', 'lotes', 'tema'] },
  { id: 'pro', nome: 'Pro', preco_mensal: 89.99, max_funcionarios: 4, franquia_notas_mes: 0, recursos: ['acompanhamento_os', 'importar_xml', 'lotes', 'tema', 'modulos_personalizaveis', 'followup', 'metas', 'vitrine', 'dominio_proprio'] },
];

const Planos = {
  lista: null,
  async carregar() {
    if (this.lista) return this.lista;
    try { const { data, error } = await Cloud.sb.from('planos').select('*').eq('ativo', true).order('ordem'); if (!error && data?.length) this.lista = data; } catch {}
    return this.lista || PLANOS_PADRAO;
  },
  todos() { return this.lista || PLANOS_PADRAO; },
  // primeiro plano (do mais barato) que libera o recurso
  queLibera(rec) { return this.todos().find(p => (p.recursos || []).includes(rec)); },
  // planos que ainda não estão à venda (aparecem, mas sem botão de compra)
  emBreve(id) { return PLANOS_EM_BREVE.includes(id); },
  // preço da plataforma em que a loja assina (Hotmart: pesos chilenos; Kiwify: reais)
  preco(p) {
    if (this.emBreve(p.id)) return 'Em breve';
    const l = typeof Pagamento !== 'undefined' ? Pagamento.links : null;
    const v = l?.precos && l.precos[p.id] != null ? Pagamento.formatar(l.precos[p.id], l.moeda) : p.preco_mensal == null ? null : money(p.preco_mensal);
    return v == null ? 'Consulte' : t('{v}/mês', { v });
  },
  diasAte(d) { return d ? Math.max(0, Math.ceil((new Date(d) - Date.now()) / 86400000)) : 0; },
  limiteAtraso(a) { return a.inadimplente_desde ? addDays(a.inadimplente_desde, a.tolerancia_dias || 5) : null; },

  textoSomenteLeitura(a) {
    const s = a?.situacao;
    if (s === 'bloqueada') return 'Loja bloqueada: as alterações não são salvas. Fale com o suporte.';
    if (s === 'expirada') return 'Seu plano terminou: os dados estão guardados, mas para editar é preciso assinar um plano (Meu plano).';
    return 'Loja em modo somente leitura por falta de pagamento. Regularize em Meu plano para voltar a editar.';
  },

  // selo sempre visível na barra do topo enquanto a loja está no teste grátis
  selo(a) {
    if (!a || a.isenta || a.situacao !== 'teste') return '';
    const d = this.diasAte(a.teste_ate);
    return `<a class="selo-teste" href="#/plano" title="Ver planos e assinar">${icon('clock', 'sm')}<span>Teste grátis</span><b>${d <= 1 ? 'último dia' : d + ' dias'}</b></a>`;
  },

  aviso(a) {
    if (!a || a.isenta) return '';
    const bar = (cor, txt, botao) => `<div class="aviso-plano ${cor}">${icon(cor === 'red' ? 'alert' : 'info', 'sm')}<span class="grow">${txt}</span>${botao ? `<a class="btn sm" href="#/plano">${botao}</a>` : ''}</div>`;
    switch (a.situacao) {
      case 'teste': {
        const d = this.diasAte(a.teste_ate), bl = (a.bloqueados_teste || []).map(r => RECURSO_CURTO[r] || r);
        return bar('gold', `<b>Você está no teste grátis</b> do ${esc(a.plano_nome || 'Pro')}: ${d <= 1 ? 'termina hoje' : `faltam <b>${d} dias</b>`}.${bl.length ? ` ${esc(juntarE(bl))} ${bl.length > 1 ? 'são liberadas' : 'é liberada'} quando você assinar.` : ''}`, 'Assinar');
      }
      case 'inadimplente': return bar('orange', `Pagamento atrasado. Regularize até <b>${fmtDate(this.limiteAtraso(a))}</b> para a loja não entrar em somente leitura.`, 'Regularizar');
      case 'somente_leitura': return bar('red', 'Loja em <b>somente leitura</b> por falta de pagamento. Seus dados estão guardados.', 'Regularizar');
      case 'expirada': return bar('red', 'Seu plano terminou. Os dados estão guardados; para voltar a editar, assine um plano.', 'Assinar');
      case 'bloqueada': return bar('red', 'Loja <b>bloqueada</b>. Fale com o suporte.', '');
      case 'ativa': return a.status === 'cancelada' && a.periodo_pago_ate ? bar('orange', `Assinatura cancelada: acesso até <b>${fmtDate(a.periodo_pago_ate)}</b>.`, 'Reativar') : '';
    }
    return '';
  },

  // Assinar / trocar de plano: abre o checkout do provedor de pagamento (etapa 4)
  async assinar(planoId) {
    if (this.emBreve(planoId)) return toast('O plano Pro Max chega em breve. Avisaremos quando estiver disponível.');
    if (typeof Pagamento !== 'undefined' && Pagamento.checkout) return Pagamento.checkout(planoId);
    toast('O pagamento online ainda está sendo configurado. Fale com o suporte para assinar.', true);
  },
};

/* Tela mostrada no lugar de um módulo que o plano não libera */
Pages.bloqueado = {
  render(main, rec) {
    const p = Planos.queLibera(rec);
    const a = Cloud.assinatura();
    if (p && Planos.emBreve(p.id)) return this.emBreve(main, rec, p);
    if ((a?.bloqueados_teste || []).includes(rec)) return this.teste(main, rec, a);
    main.innerHTML = `
      ${pageHead('lock', RECURSOS[rec] || 'Recurso', 'Disponível em outro plano.')}
      <div class="card center" style="padding:32px 20px">
        <div class="stat-icon" style="justify-content:center;margin-bottom:12px"><div class="ic">${icon('lock')}</div></div>
        <h2 style="margin:0 0 6px">${esc(RECURSOS[rec] || 'Este recurso')}</h2>
        <p class="muted" style="margin:0 0 18px">${a?.situacao === 'expirada' || a?.situacao === 'bloqueada' ? 'Sua loja está sem plano ativo. Os dados continuam guardados.' : `Seu plano atual (${esc(a?.plano_nome || '—')}) não inclui este módulo.`}
          ${p ? `Ele faz parte do plano <b class="gold">${esc(p.nome)}</b>.` : ''} Tudo o que já foi cadastrado aqui continua guardado.</p>
        ${Cloud.papel() === 'dono' ? `<button class="btn primary" onclick="${p ? `Planos.assinar('${p.id}')` : `App.go('plano')`}">${icon('trending')} Fazer upgrade${p ? ' para ' + esc(p.nome) : ''}</button>
          <div class="mt"><a href="#/plano" class="small">Comparar planos</a></div>` : '<p class="small muted">Peça ao dono da loja para fazer o upgrade.</p>'}
      </div>`;
  },
  // módulo de um plano que ainda não está à venda (ex.: notas fiscais do Pro Max)
  emBreve(main, rec, p) {
    main.innerHTML = `
      ${pageHead('clock', RECURSOS[rec] || 'Recurso', 'Em breve.')}
      <div class="card center" style="padding:32px 20px">
        <div class="stat-icon" style="justify-content:center;margin-bottom:12px"><div class="ic">${icon('clock')}</div></div>
        <h2 style="margin:0 0 6px">${esc(RECURSOS[rec] || 'Este recurso')}</h2>
        <p class="muted" style="margin:0">Este recurso chega em breve com o plano <b class="gold">${esc(p.nome)}</b>. Avisaremos quando estiver disponível.</p>
      </div>`;
  },
  // módulo do plano que fica fechado só durante o teste grátis (vitrine, notas fiscais)
  teste(main, rec, a) {
    const p = (Planos.lista || []).find(x => x.id === a.plano) || null;
    main.innerHTML = `
      ${pageHead('lock', RECURSOS[rec] || 'Recurso', 'Liberado quando você assinar.')}
      <div class="card center" style="padding:32px 20px">
        <div class="stat-icon" style="justify-content:center;margin-bottom:12px"><div class="ic">${icon('lock')}</div></div>
        <h2 style="margin:0 0 6px">${esc(RECURSOS[rec] || 'Este recurso')}</h2>
        <p class="muted" style="margin:0 0 18px">Durante o teste grátis este módulo fica fechado. Ele é liberado assim que você assinar${rec === 'nota_fiscal' ? ' o plano <b class="gold">Pro Max</b>' : ` o plano <b class="gold">${esc(p?.nome || a.plano_nome || 'Pro')}</b>`}.</p>
        ${Cloud.papel() === 'dono' ? `<button class="btn primary" onclick="${rec === 'nota_fiscal' ? "Planos.assinar('pro_max')" : `Planos.assinar('${esc(a.plano || 'pro')}')`}">${icon('trending')} Assinar agora</button>
          <div class="mt"><a href="#/plano" class="small">Comparar planos</a></div>` : '<p class="small muted">Peça ao dono da loja para assinar.</p>'}
      </div>`;
  },
};

/* Meu plano */
Pages.plano = {
  async render(main) {
    const a = Cloud.assinatura();
    const desenhar = () => {
      const planos = Planos.todos();
      const dono = Cloud.papel() === 'dono';
      if (!Cloud.enabled || !a) {
        main.innerHTML = `${pageHead('shieldCheck', 'Meu plano', 'Assinatura da loja.')}
          <div class="card empty">${icon('info')}<div>${Cloud.enabled ? 'As assinaturas ainda não foram ativadas nesta loja.' : 'Modo local: sem assinatura.'}</div></div>`;
        return;
      }
      const [st, cor] = SITUACAO[a.situacao] || [a.situacao, ''];
      const datas = [
        a.isenta ? ['Cobrança', '<span class="green">Isenta</span>'] : null,
        a.situacao === 'teste' ? ['Teste grátis até', fmtDate(a.teste_ate)] : null,
        a.proxima_cobranca && !a.isenta ? ['Próxima cobrança', fmtDate(a.proxima_cobranca)] : null,
        a.status === 'cancelada' && a.periodo_pago_ate ? ['Acesso até', fmtDate(a.periodo_pago_ate)] : null,
        a.inadimplente_desde ? ['Em atraso desde', fmtDate(a.inadimplente_desde)] : null,
        a.cortesia_ate && new Date(a.cortesia_ate) > new Date() ? ['Cortesia até', fmtDate(a.cortesia_ate)] : null,
      ].filter(Boolean);
      main.innerHTML = `
        ${pageHead('shieldCheck', 'Meu plano', 'Plano, situação da assinatura e upgrade.')}
        <div class="hero mb">
          <div class="row between"><div><div class="small muted">Plano atual</div><div class="big gold" style="font-size:32px">${esc(a.plano_nome || '—')}</div></div>
            <span class="pill ${cor}">${esc(st)}</span></div>
          ${datas.map(([k, v]) => `<div class="kv"><span class="k">${k}</span><span class="v">${v}</span></div>`).join('')}
          <div class="kv"><span class="k">Funcionários</span><span class="v">${a.funcionarios_ativos} de ${a.limite_funcionarios} <span class="muted xs">(o dono não conta)</span></span></div>
          ${a.situacao !== 'ativa' && a.situacao !== 'teste' ? `<div class="info-box mt">${icon('info')}<span>${esc(Planos.textoSomenteLeitura(a))}</span></div>` : ''}
          ${dono && !a.isenta ? `<div class="mt" style="display:grid;gap:8px"><button class="btn primary block" onclick="Planos.assinar('${esc(a.plano || 'pro')}')">${icon('card')} ${a.situacao === 'ativa' ? 'Pagar / renovar' : 'Assinar agora'}</button>
            <button class="btn block" onclick="window.Pagamento?.areaCliente ? Pagamento.areaCliente() : toast('Em breve', true)">${icon('settings')} Cartão e cancelamento</button></div>` : ''}
        </div>
        <div class="grid grid-auto">${planos.map(p => {
          const atual = p.id === a.plano;
          return `<div class="card" style="${atual ? 'border-color:rgba(var(--gold-rgb), .7)' : ''}">
            <div class="row between"><h3 style="margin:0">${esc(p.nome)}</h3>${atual ? '<span class="pill gold">Seu plano</span>' : ''}</div>
            <div class="big" style="font-size:24px;margin:6px 0">${Planos.preco(p)}</div>
            <div class="small muted mb">Dono + ${p.max_funcionarios} funcionários${p.franquia_notas_mes ? ` · ${p.franquia_notas_mes} notas/mês` : ''}</div>
            ${Object.keys(RECURSOS).map(r => `<div class="small" style="padding:3px 0;${(p.recursos || []).includes(r) ? '' : 'opacity:.35;text-decoration:line-through'}">${(p.recursos || []).includes(r) ? '✓' : '·'} ${esc(RECURSOS[r])}</div>`).join('')}
            ${dono && !a.isenta && (!atual || a.situacao !== 'ativa') ? (Planos.emBreve(p.id) ? `<button class="btn block mt" disabled style="opacity:.6;cursor:default">${icon('clock', 'sm')} Em breve</button>`
              : `<button class="btn ${p.id === 'pro' ? 'primary' : 'outline-gold'} block mt" onclick="Planos.assinar('${p.id}')">Assinar ${esc(p.nome)}</button>`) : ''}
          </div>`;
        }).join('')}</div>`;
    };
    desenhar();
    // planos e preços/links da plataforma da loja (Kiwify ou Hotmart)
    if (Cloud.enabled && (!Planos.lista || (typeof Pagamento !== 'undefined' && !Pagamento.links))) {
      await Promise.all([Planos.carregar(), typeof Pagamento !== 'undefined' ? Pagamento.carregar() : null]);
      if (App.route === 'plano') desenhar();
    }
  },
};
