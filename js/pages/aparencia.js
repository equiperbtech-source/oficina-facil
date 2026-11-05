/* Aparência da loja (Configurações): logo, cores, fonte, nome, slogan, rodapé, dados da empresa e domínio próprio.
   Pré-visualização ao vivo no próprio app; só salva se o contraste passar na WCAG AA. */
const Aparencia = {
  dominios: [],
  cardHTML() {
    if (!Cloud.enabled || !Cloud.loja || !Cloud.loja.tema) return '';
    const t = Cloud.loja.tema;
    return `<div class="card mb" id="cf-tema">
      <h3>${icon('star', 'sm')} Aparência <span class="gold">da loja</span></h3>
      <p class="small muted" style="margin-top:0">Logo, cores e dados que aparecem no app, nos PDFs e nas páginas dos clientes. Mexa e veja na hora; só vale depois de salvar.</p>
      <div class="row" style="gap:12px;align-items:center" id="tm-logo-box"></div>
      <div class="grid grid-3 mt" style="gap:10px">
        ${[['cor_primaria', 'Cor principal'], ['cor_secundaria', 'Cor secundária'], ['cor_fundo', 'Fundo']].map(([k, l]) => `<div class="field"><label>${l}</label><input type="color" class="input" name="${k}" value="${esc(t[k])}" style="padding:4px;min-height:44px"></div>`).join('')}
      </div>
      <div id="tm-contraste" class="small mb"></div>
      ${field('Fonte', `<select class="input" name="fonte">${FONTES.map(f => `<option ${t.fonte === f ? 'selected' : ''}>${f}</option>`).join('')}</select>`)}
      ${field('Nome exibido', `<input class="input" name="nome_exibicao" maxlength="60" value="${esc(t.nome_exibicao || '')}">`)}
      ${field('Slogan', `<input class="input" name="slogan" maxlength="120" value="${esc(t.slogan || '')}">`, { opt: true })}
      ${field('Rodapé', `<input class="input" name="rodape" maxlength="200" value="${esc(t.rodape || '')}" placeholder="Ex: © Sua Loja · Sua cidade">`, { opt: true })}
      <div class="form-row">${field('CNPJ', `<input class="input" name="cnpj" value="${esc(t.cnpj || '')}">`, { opt: true })}${field('WhatsApp', `<input class="input" name="whatsapp" inputmode="tel" value="${esc(t.whatsapp || '')}">`, { opt: true })}</div>
      <div class="form-row">${field('Telefone', `<input class="input" name="telefone" inputmode="tel" value="${esc(t.telefone || '')}">`, { opt: true })}${field('Endereço', `<input class="input" name="endereco" value="${esc(t.endereco || '')}">`, { opt: true })}</div>
      <div class="grid grid-2"><button class="btn" id="tm-desfazer">${icon('undo')} Desfazer</button><button class="btn primary" id="tm-salvar">${icon('check')} Salvar aparência</button></div>
      <div class="section-title mt">${icon('chat', 'sm')} Endereço da loja</div>
      <div id="tm-endereco" class="small"></div>
      <div id="tm-dominio" class="small mt"></div>
    </div>`;
  },

  form() { const el = $('#cf-tema'); const o = {}; $$('[name]', el).forEach(i => o[i.name] = i.value.trim()); o.logo_url = this.logo ?? Cloud.loja.tema.logo_url; o.favicon_url = this.favicon ?? Cloud.loja.tema.favicon_url; return o; },

  ligar() {
    const el = $('#cf-tema'); if (!el) return;
    this.logo = undefined; this.favicon = undefined;
    const prever = () => {
      const t = { ...Cloud.loja.tema, ...this.form() };
      Tema.aplicar(t);
      const v = Tema.validar(t), m = v.medidas;
      const selo = (n, ok) => `<span class="pill xs ${ok ? 'green' : 'red'}">${n.toFixed(1)}:1 ${ok ? '✓' : '✗'}</span>`;
      $('#tm-contraste').innerHTML = `Contraste: texto ${selo(m.texto, m.texto >= 4.5)} · destaque ${selo(m.destaque, m.destaque >= 4.5)} · botões ${selo(m.botao, m.botao >= 4.5)}
        ${v.ok ? '' : `<div class="red xs mt">${v.problemas.map(esc).join('<br>')}</div>`}`;
      this.desenharLogo(t);
    };
    $$('#cf-tema [name]').forEach(i => i.oninput = prever);
    prever();
    $('#tm-desfazer').onclick = () => { Tema.aplicar(Cloud.loja.tema); $('.shell')?.remove(); App.render(); };
    $('#tm-salvar').onclick = async () => {
      const t = this.form(), v = Tema.validar(t);
      if (!v.ok) return toast('Ajuste as cores: o contraste não passa na WCAG AA', true);
      const { error } = await Cloud.sb.rpc('salvar_tema', { p_loja: Cloud.loja.id, t });
      if (error) return toast(error.message, true);
      await Cloud.carregarTema(); App.cacheLoja(); Tema.aplicar(Cloud.loja.tema);
      // nome e dados da empresa também valem para os PDFs
      if (t.nome_exibicao) Store.s.loja = t.nome_exibicao;
      ['cnpj', 'telefone', 'endereco'].forEach(k => { if (t[k]) Store.s[k] = t[k]; }); Store.save();
      toast('Aparência salva'); $('.shell')?.remove(); App.render();
    };
    this.dominio();
  },

  desenharLogo(t) {
    $('#tm-logo-box').innerHTML = `<div style="width:72px;height:72px;flex-shrink:0">${t.logo_url ? `<img src="${esc(t.logo_url)}" style="width:72px;height:72px;object-fit:contain;border-radius:14px;background:var(--card-2)">` : `<div class="tema-selo" style="width:72px;font-size:24px;border-radius:18px">${esc((t.nome_exibicao || 'L').split(/\s+/).map(p => p[0]).join('').slice(0, 2).toUpperCase())}</div>`}</div>
      <div class="grow"><label class="btn sm">${icon('upload', 'sm')} Enviar logo<input type="file" id="tm-logo" accept="image/png,image/jpeg,image/webp,image/svg+xml" hidden></label>
      ${t.logo_url ? `<button class="btn sm ghost" id="tm-sem-logo">Remover</button>` : ''}<div class="xs muted mt">PNG, JPG, WEBP ou SVG · até 512 KB · de preferência quadrada</div></div>`;
    $('#tm-logo').onchange = async e => {
      const f = e.target.files[0]; if (!f) return;
      try { const u = await this.enviar(f); this.logo = u; this.favicon = u; $$('#cf-tema [name]')[0].dispatchEvent(new Event('input')); toast('Logo enviada: confira e salve'); }
      catch (err) { toast(err.message, true); }
    };
    const rm = $('#tm-sem-logo'); if (rm) rm.onclick = () => { this.logo = ''; this.favicon = ''; $$('#cf-tema [name]')[0].dispatchEvent(new Event('input')); };
  },

  async enviar(file) {
    if (!/^image\/(png|jpeg|webp|svg\+xml)$/.test(file.type)) throw new Error('Use PNG, JPG, WEBP ou SVG');
    if (file.size > 512 * 1024) throw new Error('Logo muito grande (máximo 512 KB)');
    if (file.type === 'image/svg+xml') {
      const txt = await file.text();
      if (/<script|on\w+\s*=|javascript:|<foreignObject/i.test(txt)) throw new Error('SVG com conteúdo não permitido');
    }
    const ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/svg+xml': 'svg' }[file.type];
    const caminho = `${Cloud.loja.id}/marca/logo-${Date.now()}.${ext}`;
    const st = Cloud.sb.storage.from('lojas-publico');
    const { error } = await st.upload(caminho, file, { contentType: file.type, upsert: false });
    if (error) throw new Error(/bucket|not found/i.test(error.message) ? 'Rode a migração da etapa 3 no Supabase (Storage)' : error.message);
    return st.getPublicUrl(caminho).data.publicUrl;
  },

  // Endereço curto: digita só "oficinadojoao" e a loja fica em oficinadojoao.<dominio> (aceita colar o endereço completo)
  limparEndereco(v) {
    let s = String(v || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/[/?#].*$/, '');
    if (s.endsWith('.' + PLATAFORMA.dominio)) s = s.slice(0, -PLATAFORMA.dominio.length - 1);
    if (s.includes('.')) s = s.split('.')[0];
    return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[\s_]+/g, '-').replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
  },
  endereco() {
    const box = $('#tm-endereco'); if (!box) return;
    const dono = Cloud.loja.papel === 'dono', atual = Cloud.loja.slug || '';
    const prev = s => s ? `https://<b>${esc(s)}</b>.${PLATAFORMA.dominio}` : `https://<b>sualoja</b>.${PLATAFORMA.dominio}`;
    box.innerHTML = `<p class="xs muted" style="margin:0 0 8px">Digite só o nome da loja, sem espaços. O sistema da sua loja fica no endereço abaixo, já com a sua logo e as suas cores.</p>
      <div class="row" style="gap:8px;align-items:stretch">
        <div class="input" style="display:flex;align-items:center;gap:2px;padding-top:0;padding-bottom:0;flex:1;min-width:0">
          <input id="tm-slug" placeholder="sualoja" value="${esc(atual)}" maxlength="60" autocomplete="off" autocapitalize="none" spellcheck="false" ${dono ? '' : 'disabled'}
            style="border:0;background:transparent;color:inherit;font:inherit;outline:none;flex:1;min-width:50px;padding:10px 0">
          <span class="muted" style="white-space:nowrap" data-no-i18n>.${PLATAFORMA.dominio}</span></div>
        ${dono ? `<button class="btn outline-gold" id="tm-slug-ok">Salvar</button>` : ''}</div>
      <div class="xs mt" id="tm-slug-prev" data-no-i18n>${prev(atual)}</div>
      ${dono ? '' : '<p class="xs muted">Só o dono da loja altera o endereço.</p>'}`;
    if (!dono) return;
    const inp = $('#tm-slug', box), pv = $('#tm-slug-prev', box);
    inp.oninput = () => { pv.innerHTML = prev(this.limparEndereco(inp.value)); };
    $('#tm-slug-ok', box).onclick = async () => {
      const s = this.limparEndereco(inp.value);
      if (s.length < 3) return toast('Use pelo menos 3 letras ou números', true);
      try {
        await Cloud.definirSlug(s); inp.value = s; App.cacheLoja(); toast('Endereço salvo: ' + s + '.' + PLATAFORMA.dominio); this.endereco();
        const eq = $('#cf-end-loja'); if (eq) eq.textContent = s + '.' + PLATAFORMA.dominio;   // card Equipe e nuvem
      }
      catch (err) { toast(/reservado/.test(err.message) ? 'Este endereço é reservado. Escolha outro.' : /em uso/.test(err.message) ? 'Este endereço já é de outra loja. Escolha outro.' : err.message, true); }
    };
  },

  async dominio() {
    this.endereco();
    const box = $('#tm-dominio'); if (!box) return;
    if (!Cloud.temRecurso('dominio_proprio')) { box.innerHTML = `<span class="xs muted">Quer usar um domínio seu, que você já tem (ex.: sistema.sualoja.com.br)? Isso faz parte do plano <b class="gold">Pro</b>. <a href="#/plano">Ver planos</a></span>`; return; }
    const r = await Cloud.sb.from('lojas_dominios').select('dominio, verificado').eq('loja_id', Cloud.loja.id);
    if (!box.isConnected) return; // a pessoa saiu da tela enquanto carregava
    this.dominios = r.data || [];
    box.innerHTML = `<div class="lbl">Domínio seu (opcional)</div><p class="xs muted" style="margin:0 0 6px">Só se você já tem um domínio próprio e quer usá-lo no lugar do endereço acima.</p>${this.dominios.map(d => `<div class="kv"><span class="k">${esc(d.dominio)}</span><span class="v">${d.verificado ? '<span class="green">ativo</span>' : '<span class="orange">aguardando verificação</span>'}</span></div>`).join('')}
      <div class="row mt"><input class="input" id="tm-dom" placeholder="sistema.sualoja.com.br"><button class="btn outline-gold" id="tm-dom-ok">Adicionar</button></div>
      <p class="xs muted">No site onde você comprou o domínio, crie um registro <b>CNAME</b> apontando para <b>cname.vercel-dns.com</b>. Depois o suporte ativa o endereço.</p>`;
    $('#tm-dom-ok', box).onclick = async () => {
      const d = $('#tm-dom', box).value.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
      if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(d)) return toast('Domínio inválido', true);
      const { error } = await Cloud.sb.from('lojas_dominios').upsert([{ dominio: d, loja_id: Cloud.loja.id, verificado: false }]);
      if (error) return toast(/duplicate|unique/i.test(error.message) ? 'Este domínio já está em uso' : error.message, true);
      toast('Domínio adicionado: aguardando verificação'); this.dominio();
    };
  },
};
