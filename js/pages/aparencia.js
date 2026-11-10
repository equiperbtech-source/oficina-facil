/* Aparência da oficina (Configurações): logo, cores, fonte, nome, slogan, rodapé, dados da empresa e domínio próprio.
   Pré-visualização ao vivo no próprio app; só salva se o contraste passar na WCAG AA. */
const Aparencia = {
  dominios: [],
  cardHTML() {
    if (!Cloud.enabled || !Cloud.loja || !Cloud.loja.tema) return '';
    const t = Cloud.loja.tema;
    return `<div class="card mb" id="cf-tema">
      <h3>${icon('star', 'sm')} Aparência <span class="gold">da oficina</span></h3>
      <p class="small muted" style="margin-top:0">Logo, cores e dados que aparecem no app, nos PDFs e nas páginas dos clientes. Mexa e veja na hora; só vale depois de salvar.</p>
      <div class="row" style="gap:12px;align-items:center" id="tm-logo-box"></div>
      <div class="grid grid-2 mt" style="gap:10px">
        ${[['cor_primaria', 'Cor principal'], ['cor_secundaria', 'Cor ao tocar']].map(([k, l]) => `<div class="field"><label>${l}</label><input type="color" class="input" name="${k}" value="${esc(t[k])}" style="padding:4px;min-height:44px"></div>`).join('')}
      </div>
      <div id="tm-contraste" class="small mb"></div>
      ${field('Fonte', `<select class="input" name="fonte">${FONTES.map(f => `<option ${t.fonte === f ? 'selected' : ''}>${f}</option>`).join('')}</select>`)}
      ${field('Nome exibido', `<input class="input" name="nome_exibicao" maxlength="60" value="${esc(t.nome_exibicao || '')}">`)}
      ${field('Slogan', `<input class="input" name="slogan" maxlength="120" value="${esc(t.slogan || '')}">`, { opt: true })}
      ${field('Rodapé', `<input class="input" name="rodape" maxlength="200" value="${esc(t.rodape || '')}" placeholder="Ex: © Sua Loja · Sua cidade">`, { opt: true })}
      <div class="form-row">${field('CNPJ', `<input class="input" name="cnpj" value="${esc(t.cnpj || '')}">`, { opt: true })}${field('WhatsApp', `<input class="input" name="whatsapp" inputmode="tel" value="${esc(t.whatsapp || '')}">`, { opt: true })}</div>
      <div class="form-row">${field('Telefone', `<input class="input" name="telefone" inputmode="tel" value="${esc(t.telefone || '')}">`, { opt: true })}${field('Endereço', `<input class="input" name="endereco" value="${esc(t.endereco || '')}">`, { opt: true })}</div>
      <div class="grid grid-2"><button class="btn" id="tm-desfazer">${icon('undo')} Desfazer</button><button class="btn primary" id="tm-salvar">${icon('check')} Salvar aparência</button></div>
      <div class="section-title mt">${icon('chat', 'sm')} Endereço da oficina</div>
      <div id="tm-endereco" class="small"></div>
      <div id="tm-dominio" class="small mt"></div>
    </div>`;
  },

  form() { const el = $('#cf-tema'); const o = {}; $$('[name]', el).forEach(i => o[i.name] = i.value.trim()); o.logo_url = this.logo ?? Cloud.loja.tema.logo_url; o.favicon_url = this.favicon ?? Cloud.loja.tema.favicon_url; o.cor_fundo = '#FFFFFF'; return o; },

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

  // Endereço curto: digita só "oficinadojoao" e a oficina fica em oficinadojoao.<dominio> (aceita colar o endereço completo)
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
    box.innerHTML = `<p class="xs muted" style="margin:0 0 8px">Digite só o nome da oficina, sem espaços. O sistema da sua oficina fica no endereço abaixo, já com a sua logo e as suas cores.</p>
      <div class="row" style="gap:8px;align-items:stretch">
        <div class="input" style="display:flex;align-items:center;gap:2px;padding-top:0;padding-bottom:0;flex:1;min-width:0">
          <input id="tm-slug" placeholder="sualoja" value="${esc(atual)}" maxlength="60" autocomplete="off" autocapitalize="none" spellcheck="false" ${dono ? '' : 'disabled'}
            style="border:0;background:transparent;color:inherit;font:inherit;outline:none;flex:1;min-width:50px;padding:10px 0">
          <span class="muted" style="white-space:nowrap" data-no-i18n>.${PLATAFORMA.dominio}</span></div>
        ${dono ? `<button class="btn outline-gold" id="tm-slug-ok">Salvar</button>` : ''}</div>
      <div class="xs mt" id="tm-slug-prev" data-no-i18n>${prev(atual)}</div>
      ${dono ? '' : '<p class="xs muted">Só o dono da oficina altera o endereço.</p>'}`;
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
      catch (err) { toast(/reservado/.test(err.message) ? 'Este endereço é reservado. Escolha outro.' : /em uso/.test(err.message) ? 'Este endereço já é de outra oficina. Escolha outro.' : err.message, true); }
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

/* Configurações → Oficina: liga/desliga, listas e textos editáveis (com prévia).
   Só o que a oficina muda é guardado (o resto vem dos padrões na leitura); junta campo a campo entre dispositivos. */
const MSG_PADRAO = {
  entrada: 'Olá {cliente}! Recebemos seu {veiculo} placa {placa} na {oficina}. Acompanhe: {link}',
  pronto: 'Olá {cliente}! Seu {veiculo} placa {placa} está pronto para retirada. Total: {total}. {link}',
  status: 'Olá {cliente}! Atualização do seu {veiculo} placa {placa}: {etapa}. {link}',
  obrigado: 'Olá {cliente}! Obrigado por escolher a {oficina}. {link}',
};
const PersonalizarOficina = {
  LIGA: [['usarPrevisao', 'Previsão de entrega na OS e no link'], ['whatsResumoGarantia', 'Resumo da garantia na mensagem de "pronto"'], ['aprovacaoLink', 'Cliente pode aprovar o orçamento pelo link'],
    ['mecanicoVePreco', 'Mecânico vê o preço de venda das peças']],
  liga(k) { const v = Store.s[k]; return k === 'mecanicoVePreco' ? v === true : v !== false; },
  // mensagem personalizada (vazia = a padrão do sistema, mais completa)
  mensagem(tipo, vars) {
    const tpl = String((Store.s.msgs || {})[tipo] || '').trim(); if (!tpl) return null;
    return tpl.replace(/\{(\w+)\}/g, (m, k) => vars[k] ?? m).replace(/[ \t]+\n/g, '\n').trim();
  },
  cardHTML() {
    const s = Store.s, ck = s.checklist || {}, msgs = s.msgs || {};
    return `<div class="card mb" id="cf-oficina"><h3>${icon('layers', 'sm')} Oficina: <span class="gold">listas e textos</span></h3>
      <div class="lbl mb">${t('Liga / desliga')}</div>
      ${this.LIGA.map(([k, l]) => `<label class="check" style="padding:6px 0"><input type="checkbox" data-liga="${k}" ${this.liga(k) ? 'checked' : ''}> ${t(l)}</label>`).join('')}
      <div class="lbl mt mb">${t('Checklist de entrada')} <span class="xs muted">${t('(um item por linha; vazio = lista padrão)')}</span></div>
      <div class="form-row">${Veiculo.tipos().map(k => field(TIPOS_VEICULO[k].label, `<textarea class="input" data-ck-tipo="${k}" style="min-height:160px" placeholder="${esc(CHECKLIST_PADRAO[k].join('\n'))}">${esc((ck[k] || []).join('\n'))}</textarea>`)).join('')}</div>
      <p class="xs muted" style="margin-top:-6px">${t('As OS já abertas guardam a lista da entrada: mudar aqui não altera OS antigas.')}</p>
      ${field('Categorias de peças (uma por linha)', `<textarea class="input" data-cats style="min-height:100px" placeholder="${esc(CATEGORIAS_PECAS.join('\n'))}">${esc((s.categoriasPecas || []).join('\n'))}</textarea>`, { opt: true })}
      <div class="lbl mt mb">${t('Mensagens de WhatsApp')} <span class="xs muted">${t('(vazio = mensagem padrão)')}</span></div>
      <p class="xs muted" style="margin-top:0">${t('Variáveis')}: {cliente} {veiculo} {placa} {oficina} {link} {total} {etapa}</p>
      ${[['entrada', 'Entrada do veículo'], ['status', 'Mudança de etapa'], ['pronto', 'Pronto para retirada'], ['obrigado', 'Pagamento (agradecimento)']].map(([k, l]) => field(l, `<textarea class="input" data-msg="${k}" placeholder="${esc(MSG_PADRAO[k])}">${esc(msgs[k] || '')}</textarea>`, { opt: true })).join('')}
      <div class="lbl mb">${t('Prévia')}</div><div class="card" id="cf-of-prev" style="white-space:pre-wrap;background:#ECFDF5;border-color:#A7F3D0;color:#0F172A;font-size:14px"></div>
      <div class="grid grid-2 mt"><button class="btn" id="cf-of-pdf">${icon('file')} ${t('Prévia do PDF')}</button><button class="btn primary" id="cf-of-ok">${icon('check')} ${t('Salvar')}</button></div></div>`;
  },
  exemplo() {
    return { numero: 123, clienteId: null, status: 'concluido', criadoEm: nowISO(), veiculo: { tipo: Veiculo.tipoPadrao(), placa: 'ABC1D23', marca: 'Chevrolet', modelo: 'Onix', motor: '1.0', anoModelo: '2019', cor: 'Prata' },
      defeito: t('Barulho ao frear'), kmEntrada: 45000, nivelCombustivel: '1/2', checklist: {}, checklistItens: Checklist.itens(Veiculo.tipoPadrao()),
      itensServico: [{ id: 's', nome: t('Troca de pastilhas'), qtd: 1, valor: 120 }], itensPeca: [{ id: 'p', nome: t('Pastilha dianteira'), qtd: 1, valor: 180 }], desconto: 0, garantiaDias: 90, garantiaKm: 5000 };
  },
  ligar() {
    const el = $('#cf-oficina'); if (!el) return;
    const prev = () => {
      const msgs = {}; $$('[data-msg]', el).forEach(x => { if (x.value.trim()) msgs[x.dataset.msg] = x.value; });
      const antes = Store.s.msgs; Store.s.msgs = msgs;
      $('#cf-of-prev', el).textContent = OSPage.msgPronto(this.exemplo(), { nome: 'Maria Souza' });
      Store.s.msgs = antes;
    };
    $$('[data-msg]', el).forEach(x => x.oninput = prev); prev();
    $('#cf-of-pdf', el).onclick = async () => { const doc = await Pdf.ordem(this.exemplo()); Pdf.abrirParaImprimir(doc, 'previa-os.pdf'); };
    $('#cf-of-ok', el).onclick = () => {
      const s = Store.s;
      $$('[data-liga]', el).forEach(c => { s[c.dataset.liga] = c.checked; });
      const ck = { ...(s.checklist || {}) };
      $$('[data-ck-tipo]', el).forEach(x => { const l = x.value.split('\n').map(v => v.trim()).filter(Boolean); if (l.length) ck[x.dataset.ckTipo] = l; else delete ck[x.dataset.ckTipo]; });
      s.checklist = ck;
      const cats = $('[data-cats]', el).value.split('\n').map(v => v.trim()).filter(Boolean); if (cats.length) s.categoriasPecas = cats; else delete s.categoriasPecas;
      const msgs = {}; $$('[data-msg]', el).forEach(x => { if (x.value.trim()) msgs[x.dataset.msg] = x.value.trim(); }); s.msgs = msgs;
      Store.save(); toast(t('Configurações da oficina salvas'));
    };
  },
};
