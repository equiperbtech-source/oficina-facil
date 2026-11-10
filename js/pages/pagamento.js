/* Assinatura pela plataforma de pagamento da oficina: Kiwify (reais). Hotmart (pesos) só se a oficina usar CLP.
   Quem decide é a MOEDA da oficina, nunca o idioma da tela.
   Abre o checkout do plano e a área do cliente. Quem ativa o plano é só o webhook do servidor, nunca esta tela. */
const Pagamento = {
  links: null,
  async carregar(recarregar = false) {
    if (!recarregar && this.links && this.links._loja === Cloud.loja?.id) return this.links;
    const es = Moeda.base() === 'CLP';
    try {
      // plataforma, preços e links: a moeda da oficina decide (reais → Kiwify; pesos → Hotmart)
      let r = Cloud.loja ? await Cloud.sb.rpc('checkout_da_loja', { p_loja: Cloud.loja.id, p_idioma: es ? 'es' : 'pt' }) : { error: true };
      // banco com a primeira versão da etapa 14 (sem o idioma da tela)
      if (r.error && Cloud.loja) { const v = await Cloud.sb.rpc('checkout_da_loja', { p_loja: Cloud.loja.id }); if (!v.error && (v.data?.provedor === 'hotmart') === es) r = v; }
      if (r.error && es) r = { data: { provedor: 'hotmart', moeda: 'CLP', precos: { essencial: 20000, pro: 34000 }, planos: [], notas: [] } }; // banco sem a etapa 14
      else if (r.error) r = await Cloud.sb.rpc('checkout_planos', {});
      if (!r.error && r.data) this.links = { ...r.data, _loja: Cloud.loja?.id };
    } catch {}
    return this.links;
  },
  // valor na moeda da plataforma (ex.: CLP 20.000; R$ 77,90)
  formatar(v, moeda) {
    if (!moeda || moeda === 'BRL') return BRL.format(Number(v) || 0); // preço da Kiwify é sempre em reais
    try { return new Intl.NumberFormat(moeda === 'CLP' ? 'es-CL' : idiomaLocale(), { style: 'currency', currency: moeda, currencyDisplay: 'code', maximumFractionDigits: moeda === 'CLP' ? 0 : 2 }).format(Number(v) || 0); }
    catch { return moeda + ' ' + v; }
  },
  // e-mail no link do checkout só se o parâmetro estiver configurado no admin (depende do provedor aceitar)
  comEmail(url, param) {
    if (!param || !Cloud.user?.email) return url;
    return url + (url.includes('?') ? '&' : '?') + encodeURIComponent(param) + '=' + encodeURIComponent(Cloud.user.email);
  },
  async checkout(planoId) {
    if (typeof Planos !== 'undefined' && Planos.emBreve?.(planoId)) return toast('O plano Pro Max chega em breve.');
    let l = await this.carregar();
    let p = (l?.planos || []).find(x => x.plano_id === planoId);
    // link cadastrado depois que a tela abriu: busca de novo antes de avisar
    if (!p?.url) { l = await this.carregar(true); p = (l?.planos || []).find(x => x.plano_id === planoId); }
    if (!p?.url) return toast('Assinatura online deste plano ainda não está disponível. Fale com o suporte.', true);
    openModal({
      title: 'Assinar', icon: 'card',
      body: `<p style="margin-top:0">Você vai para a página de pagamento segura.</p>
        <div class="info-box">${icon('info')}<span>Use o <b>mesmo e-mail</b> desta conta (<b>${esc(Cloud.user?.email || '')}</b>) no pagamento: é assim que o plano é ligado à sua oficina automaticamente.</span></div>`,
      foot: `<button class="btn" data-close>Cancelar</button><a class="btn primary" target="_blank" rel="noopener" href="${esc(this.comEmail(p.url, l.param_email))}" onclick="closeAllModals()">${icon('card')} Ir para o pagamento</a>`,
    });
  },
  async areaCliente() {
    const l = await this.carregar();
    if (!l?.area_cliente) return toast('Link da área do cliente ainda não configurado. Fale com o suporte.', true);
    window.open(l.area_cliente, '_blank', 'noopener');
  },
  async comprarNotas() {
    const l = await this.carregar();
    const ns = l?.notas || [];
    if (!ns.length) return toast('Compra de notas avulsas ainda não disponível.', true);
    openModal({
      title: 'Comprar notas', icon: 'file',
      body: `<p style="margin-top:0">Os créditos entram assim que o pagamento for confirmado e não expiram.</p>
        ${ns.map(n => `<a class="btn block mb" target="_blank" rel="noopener" href="${esc(this.comEmail(n.url, l.param_email))}">${esc(n.nome || n.qtd + ' notas')}</a>`).join('')}
        <p class="xs muted">Use o mesmo e-mail desta conta no pagamento.</p>`,
    });
  },
};
