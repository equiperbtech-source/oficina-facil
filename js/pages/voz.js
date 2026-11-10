/* "Preencher OS por voz": o mecânico grava um áudio, o servidor (Gemini) devolve os campos e a tela de revisão
   mostra tudo preenchido. Campo que a IA não entendeu fica vazio e amarelo ("Confira este campo").
   A IA nunca salva: a OS só é aberta quando o mecânico toca em "Abrir OS". */
const VozOS = {
  MAX_SEG: 90,
  ROTULOS: { placa: 'Placa', modelo_moto: 'Modelo', ano: 'Ano', km: 'Km', nome_cliente: 'Nome do cliente', telefone_cliente: 'Telefone', defeito_relatado: 'Reclamação do cliente', observacoes: 'Observações' },

  botaoHTML() {
    return `<button type="button" class="btn primary block voz-btn" id="voz-gravar">${icon('mic')}<span><b>${t('Gravar áudio')}</b><small>${t('Fale a moto e o serviço: a OS vem preenchida')}</small></span></button>`;
  },

  /* ---------- 1. gravar ---------- */
  async iniciar() {
    if (!Cloud.enabled || !Cloud.loja) return toast(t('O preenchimento por voz precisa da nuvem ligada.'), true);
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') return this.semMicrofone('nao_suporta');
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); }
    catch (e) { return this.semMicrofone(e && e.name); }
    const partes = [], rec = new MediaRecorder(stream);
    rec.ondataavailable = e => { if (e.data && e.data.size) partes.push(e.data); };
    const inicio = Date.now();
    let timer, parado = false;
    const m = openModal({
      title: t('Gravando'), icon: 'mic',
      body: `<div class="center voz-rec"><div class="voz-ponto" aria-hidden="true"></div><div class="voz-tempo" id="voz-tempo" aria-live="polite">0:00</div>
        <div class="small muted">${t('Até 1:30. Ex.: "CG 160 placa ABC1D23 do João, 32 mil km, troca de óleo e relação, barulho no freio da frente."')}</div></div>`,
      foot: `<button class="btn" id="voz-cancelar">${t('Cancelar')}</button><button class="btn primary btn-grande" id="voz-parar" style="flex:1">${icon('pause')} ${t('Parar')}</button>`,
      onClose: () => { if (!parado) { parado = true; clearInterval(timer); try { rec.state !== 'inactive' && rec.stop(); } catch {} stream.getTracks().forEach(x => x.stop()); } },
    });
    const parar = enviar => {
      if (parado) return; parado = true; clearInterval(timer);
      rec.onstop = () => { stream.getTracks().forEach(x => x.stop()); m.close(); if (enviar) this.processar(new Blob(partes, { type: rec.mimeType || 'audio/webm' }), (Date.now() - inicio) / 1000); };
      try { rec.stop(); } catch { rec.onstop(); }
    };
    timer = setInterval(() => {
      const s = Math.floor((Date.now() - inicio) / 1000), el = $('#voz-tempo', m.el);
      if (el) el.textContent = `${Math.floor(s / 60)}:${pad(s % 60)}`;
      if (s >= this.MAX_SEG) parar(true);
    }, 250);
    $('#voz-parar', m.el).onclick = () => parar(true);
    $('#voz-cancelar', m.el).onclick = () => parar(false);
    rec.start(1000);
  },

  semMicrofone(motivo) {
    const ios = /iPhone|iPad/i.test(navigator.userAgent);
    openModal({
      title: t('Microfone bloqueado'), icon: 'mic',
      body: motivo === 'nao_suporta'
        ? `<p style="margin-top:0">${t('Este navegador não grava áudio. Use o Chrome (Android) ou o Safari atualizado (iPhone).')}</p>`
        : `<p style="margin-top:0">${t('Para gravar, o app precisa usar o microfone. Libere assim e toque em "Gravar áudio" de novo:')}</p>
          <ol class="small" style="padding-left:18px;line-height:1.7">${ios
            ? `<li>${t('Abra Ajustes → Safari → Microfone e escolha "Perguntar" ou "Permitir".')}</li><li>${t('Volte ao app e recarregue a página.')}</li>`
            : `<li>${t('Toque no cadeado ao lado do endereço, no alto da tela.')}</li><li>${t('Em Permissões → Microfone, escolha "Permitir".')}</li><li>${t('Recarregue a página.')}</li>`}</ol>
          <p class="xs muted">${t('Se instalou o app na tela inicial, a permissão fica nas configurações do celular, em Apps → navegador → Permissões.')}</p>`,
      foot: `<button class="btn primary" data-close>${t('Entendi')}</button>`,
    });
  },

  // áudio do navegador → WAV 16 kHz mono (formato que o Gemini sempre aceita) + mede se tem fala
  async paraWav(blob) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx();
    const audio = await ctx.decodeAudioData(await blob.arrayBuffer());
    ctx.close?.();
    const taxa = 16000, n = Math.max(1, Math.ceil(audio.duration * taxa));
    const off = new OfflineAudioContext(1, n, taxa);
    const src = off.createBufferSource(); src.buffer = audio; src.connect(off.destination); src.start();
    const pcm = (await off.startRendering()).getChannelData(0);
    let soma = 0, pico = 0; for (let i = 0; i < pcm.length; i++) { soma += pcm[i] * pcm[i]; pico = Math.max(pico, Math.abs(pcm[i])); }
    const buf = new ArrayBuffer(44 + pcm.length * 2), v = new DataView(buf);
    const str = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
    str(0, 'RIFF'); v.setUint32(4, 36 + pcm.length * 2, true); str(8, 'WAVE'); str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, taxa, true); v.setUint32(28, taxa * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); str(36, 'data'); v.setUint32(40, pcm.length * 2, true);
    for (let i = 0; i < pcm.length; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, pcm[i])) * 0x7fff, true);
    return { wav: new Blob([buf], { type: 'audio/wav' }), duracao: audio.duration, rms: Math.sqrt(soma / pcm.length), pico };
  },

  /* ---------- 2. enviar ---------- */
  async processar(blob, seg) {
    const lendo = openModal({ title: t('Lendo o áudio...'), icon: 'mic', body: `<div class="center" style="padding:20px 0"><span class="spinner voz-spin"></span><p class="muted">${t('Isso leva alguns segundos.')}</p></div>` });
    const falhou = msg => { lendo.close(); this.erro(msg); };
    let a;
    try { a = await this.paraWav(blob); } catch { return falhou('curto'); }
    if (a.duracao < 1.5 || seg < 1.5 || a.pico < 0.02 || a.rms < 0.003) return falhou('curto');
    try {
      const { data } = await Cloud.sb.auth.getSession();
      const r = await fetch('/api/os/voz', { method: 'POST', headers: { 'Content-Type': 'audio/wav', Authorization: 'Bearer ' + (data?.session?.access_token || ''), 'X-Loja': Cloud.loja.id }, body: a.wav });
      const j = await r.json().catch(() => ({}));
      lendo.close();
      if (r.status === 422 || (r.ok && j.dados?.vazio)) return this.erro('curto');
      if (!r.ok || !j.dados) return this.erro(j.erro === 'sem_login' ? 'login' : 'falha');
      this.revisar(j.dados);
    } catch { falhou('falha'); }
  },
  erro(tipo) {
    const msg = { curto: t('Não deu para ouvir a fala. Grave de novo, mais perto do celular e falando por alguns segundos.'),
      login: t('Sua sessão expirou. Entre de novo e grave outra vez.'),
      falha: t('Não consegui ler o áudio agora, preencha manualmente ou tente de novo') }[tipo] || tipo;
    openModal({ title: tipo === 'curto' ? t('Grave de novo') : t('Áudio não lido'), icon: 'mic', body: `<p style="margin-top:0">${esc(msg)}</p>`,
      foot: `<button class="btn" data-close>${t('Preencher manualmente')}</button><button class="btn primary" id="voz-de-novo">${icon('mic')} ${t('Gravar de novo')}</button>`,
      onMount: (el, m) => { $('#voz-de-novo', el).onclick = () => { m.close(); this.iniciar(); }; } });
  },

  /* ---------- 3. revisar e salvar (só o mecânico salva) ---------- */
  revisar(d) {
    const incertos = new Set(d.campos_incertos || []);
    const placa = Placa.norm(d.placa || '');
    const ja = placa ? Veiculo.porPlaca(placa) : null;
    const porFone = !ja && d.telefone_cliente ? Store.clientesAtivos().find(c => onlyDigits(c.telefone).replace(/^55/, '').endsWith(onlyDigits(d.telefone_cliente).replace(/^55/, '').slice(-8))) : null;
    // sem placa nem telefone conhecidos: o cliente com exatamente o mesmo nome (se só houver um)
    const mesmoNome = !ja && !porFone && d.nome_cliente ? Store.clientesAtivos().filter(c => norm(c.nome).trim() === norm(d.nome_cliente).trim()) : [];
    const cli = ja?.cliente || porFone || (mesmoNome.length === 1 ? mesmoNome[0] : null), vei = ja?.veiculo || null;
    const tipo = vei?.tipo || (Veiculo.tipos().includes('moto') ? 'moto' : Veiculo.tipoPadrao());
    // valores: o que a IA ouviu; o que faltou e já existe no cadastro vem do cadastro
    const v = {
      placa: placa ? Placa.fmt(placa) : '', modelo_moto: d.modelo_moto || (vei ? Veiculo.completo(vei) : ''), ano: d.ano || vei?.anoModelo || '', km: d.km || '',
      nome_cliente: d.nome_cliente || cli?.nome || '', telefone_cliente: d.telefone_cliente || '', defeito_relatado: d.defeito_relatado || '', observacoes: d.observacoes || '',
    };
    const foneCad = onlyDigits(cli?.telefone || '').replace(/^55(?=\d{10,11}$)/, ''), foneFalado = onlyDigits(d.telefone_cliente || '');
    const foneDiferente = foneCad && foneFalado && !foneCad.endsWith(foneFalado.slice(-8)) && !foneFalado.endsWith(foneCad.slice(-8));
    if (!v.telefone_cliente && foneCad) v.telefone_cliente = foneCad;
    // confere: o que a IA não ouviu e continua vazio, ou o que ela marcou como incerto
    const confere = k => !String(v[k] ?? '').trim() ? k !== 'observacoes' : incertos.has(k);
    // itens: serviços e peças da lista cadastrada já vêm com preço; os outros, só com o nome
    const r = { veiculo: { tipo }, itensServico: [], itensPeca: [], desconto: 0 };
    for (const s of d.servicos || []) {
      const c = s.id_cadastro && Store.db.servicos.find(x => x.id === s.id_cadastro && !x.deleted);
      r.itensServico.push({ id: uid(), servicoId: c?.id, nome: c?.nome || s.nome, qtd: 1, valor: Number(c?.preco) || 0, garantiaDias: c?.garantiaDias ?? null, garantiaKm: c?.garantiaKm || 0, voz: !c });
    }
    const q = Store.quem();
    for (const p of d.pecas || []) {
      const c = p.id_cadastro && Store.peca(p.id_cadastro);
      r.itensPeca.push({ id: uid(), pecaId: c?.id || null, nome: c?.nome || p.nome, qtd: Number(p.quantidade) || 1, valor: Number(c?.preco) || 0, custo: Number(c?.custo) || 0, em: nowISO(), ...(q.id ? { por: q.id, porNome: q.nome } : {}) });
    }
    const campo = (k, html, ajuda) => `<div class="field ${confere(k) ? 'voz-confira' : ''}" data-voz="${k}"><label>${t(this.ROTULOS[k])}</label>${html}<div class="voz-msg">${icon('alert', 'sm')} ${t('Confira este campo')}</div>${ajuda || ''}</div>`;
    const inp = (k, extra = '') => `<input class="input" name="${k}" value="${esc(v[k])}" ${extra}>`;
    const m = openModal({
      title: t('Confira a OS'), icon: 'mic', wide: true, subtitle: t('Preenchida pelo áudio. Revise e corrija antes de abrir.'),
      body: `${ja ? `<div class="aviso-plano green" style="margin:0 0 12px">${icon('checkCircle', 'sm')}<span>${t(tipo === 'moto' ? 'Moto já cadastrada: {m} de {c}' : 'Veículo já cadastrado: {m} de {c}', { m: Veiculo.completo(vei) || vei.modelo, c: cli.nome })}</span></div>`
          : cli ? `<div class="aviso-plano gold" style="margin:0 0 12px">${icon('user', 'sm')}<span>${t('Cliente já cadastrado: {c}', { c: cli.nome })}</span></div>` : ''}
        <div class="form-row">${campo('placa', inp('placa', 'autocapitalize="characters" maxlength="8"'))}${campo('modelo_moto', inp('modelo_moto'))}</div>
        <div class="form-row">${campo('ano', inp('ano', 'inputmode="numeric" maxlength="4"'))}${campo('km', `<input class="input" name="km" inputmode="numeric" value="${v.km ? fmtKm(v.km, false) : ''}">`)}</div>
        <div class="form-row">${campo('nome_cliente', inp('nome_cliente'))}${campo('telefone_cliente', `<input class="input" name="telefone_cliente" type="tel" value="${esc(fmtPhone(v.telefone_cliente))}">`)}</div>
        ${foneDiferente ? `<div class="card mb voz-fone"><b>${t('O telefone falado é diferente do cadastrado. Qual manter?')}</b>
          <label class="check" style="padding:6px 0"><input type="radio" name="qualFone" value="cadastro"> ${t('Cadastrado')}: <b>${esc(fmtPhone(foneCad))}</b></label>
          <label class="check" style="padding:6px 0"><input type="radio" name="qualFone" value="falado" checked> ${t('Falado agora')}: <b>${esc(fmtPhone(foneFalado))}</b></label></div>` : ''}
        ${campo('defeito_relatado', `<textarea class="input" name="defeito_relatado">${esc(v.defeito_relatado)}</textarea>`)}
        ${campo('observacoes', `<textarea class="input" name="observacoes">${esc(v.observacoes)}</textarea>`)}
        <div class="field ${(!r.itensServico.length || incertos.has('servicos')) ? 'voz-confira' : ''}" data-voz="itens"><label>${t('Serviços e peças')}</label>${OSItens.editorHTML(r, { modo: 'os' })}<div class="voz-msg">${icon('alert', 'sm')} ${t('Confira este campo')}</div></div>`,
      foot: `<button class="btn" data-close>${t('Cancelar')}</button><button class="btn" id="voz-regravar">${icon('mic')} ${t('Gravar de novo')}</button><button class="btn primary" id="voz-salvar">${icon('check')} ${t('Abrir OS')}</button>`,
      onMount: (el, mm) => {
        OSItens.ligar(el, r, { modo: 'os', onChange: () => $('[data-voz=itens]', el)?.classList.remove('voz-confira') });
        $$('[data-voz] [name]', el).forEach(i => i.addEventListener('input', () => i.closest('[data-voz]').classList.remove('voz-confira')));
        const pl = $('[name=placa]', el); pl.addEventListener('input', () => { pl.value = pl.value.toUpperCase(); });
        const km = $('[name=km]', el); km.oninput = () => { const x = onlyDigits(km.value).slice(0, 7); km.value = x ? fmtKm(+x, false) : ''; km.closest('[data-voz]').classList.remove('voz-confira'); };
        $('#voz-regravar', el).onclick = () => { mm.close(); this.iniciar(); };
        $('#voz-salvar', el).onclick = () => {
          const f = readForm(el);
          const faltam = [['modelo_moto', f.modelo_moto], ['nome_cliente', f.nome_cliente], ['defeito_relatado', f.defeito_relatado]].filter(x => !x[1]).map(x => x[0]);
          if (faltam.length) { faltam.forEach(k => $(`[data-voz=${k}]`, el)?.classList.add('voz-confira')); return toast(t('Preencha: {c}', { c: faltam.map(k => t(this.ROTULOS[k])).join(', ') }), true); }
          const pn = Placa.norm(f.placa);
          if (pn && !ja && Veiculo.porPlaca(pn)) return toast(t('Placa já cadastrada em {cliente}', { cliente: Veiculo.porPlaca(pn).cliente.nome }), true);
          const fone = foneDiferente && f.qualFone === 'cadastro' ? foneCad : onlyDigits(f.telefone_cliente);
          // cliente: o do cadastro (atualizando o telefone escolhido) ou um novo
          let c = cli ? Store.cliente(cli.id) : null;
          if (c) { if (fone && fone !== onlyDigits(c.telefone)) c.telefone = fone; if (!ja && f.nome_cliente && !c.nome) c.nome = f.nome_cliente; }
          else c = { nome: f.nome_cliente, telefone: fone, docTipo: 'CPF', veiculos: [] };
          // veículo: o do cadastro ou um novo (com a placa, o modelo, o ano e o km falados)
          const kmN = parseInt(onlyDigits(f.km), 10) || null, anoN = /^\d{4}$/.test(f.ano) ? f.ano : '';
          let veic = vei ? (c.veiculos || []).find(x => x.id === vei.id) : null;
          if (veic) { if (kmN && (!veic.km || kmN > veic.km)) veic.km = kmN; if (anoN && !veic.anoModelo) veic.anoModelo = anoN; }
          else { veic = { id: uid(), tipo, placa: pn, modelo: f.modelo_moto, ...(anoN ? { anoModelo: anoN } : {}), ...(kmN ? { km: kmN } : {}) }; Object.keys(veic).forEach(k => { if (veic[k] === '') delete veic[k]; }); c.veiculos = [...(c.veiculos || []), veic]; }
          c = Store.saveCliente(c);
          const itensServico = r.itensServico.filter(i => String(i.nome || '').trim()).map(({ voz, ...i }) => i), itensPeca = r.itensPeca.filter(i => String(i.nome || '').trim());
          const gd = Math.max(-1, ...itensServico.map(i => i.garantiaDias ?? -1)), gk = Math.max(0, ...itensServico.map(i => i.garantiaKm || 0));
          const o = Store.saveOS({ clienteId: c.id, veiculo: { ...veic }, defeito: f.defeito_relatado, obs: f.observacoes, kmEntrada: kmN, status: 'analise',
            previsao: Store.s.usarPrevisao === false ? null : dayKey(addDays(new Date(), 2)), checklist: {}, checklistItens: Checklist.itens(veic.tipo),
            itensServico, itensPeca, desconto: r.desconto || 0, servico: itensServico.map(i => i.nome).join(', '),
            garantiaDias: gd >= 0 ? gd : Store.garantiaDiasOS({}), garantiaKm: gk || Store.garantiaKmOS({}), origem: 'voz' });
          OSItens.baixarEstoque(o); Store.saveOS(o);
          mm.close(); App.refresh(); toast(t('OS #{n} aberta!', { n: o.numero }));
          OSPage.posCriacao(o);
        };
      },
    });
    return m;
  },
};
