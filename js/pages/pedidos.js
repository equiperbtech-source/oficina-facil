/* Pedidos de orçamento enviados pelo próprio cliente pela página pública /pedido */
const URGENCIA = { baixa: ['Baixa', 'blue'], media: ['Média', 'orange'], alta: ['Urgente', 'red'] };
const PEDIDO_STATUS = { novo: ['Novo', 'gold'], lido: ['Lido', ''], orcado: ['Orçamento enviado', 'green'], recusado: ['Recusado', 'red'] };

const Pedidos = {
  todos() { return Store.db.pedidos.filter(p => !p.deleted).sort((a, b) => (a.lido - b.lido) || String(b.criadoEm).localeCompare(String(a.criadoEm))); },
  naoLidos() { return Store.db.pedidos.filter(p => !p.deleted && !p.lido); },
  get(id) { return Store.db.pedidos.find(p => p.id === id); },
  link() { return Cloud.loja ? `${location.origin}/pedido/${Cloud.loja.slug || Cloud.loja.id}` : null; },
  // "Chevrolet Onix 2019 · ABC1D23"
  veiculo(p) {
    const marca = String(p.marca || '').trim();
    const nome = [!marca || norm(p.modelo).includes(norm(marca)) ? '' : marca, p.modelo, p.ano].filter(Boolean).join(' ');
    return [nome, p.placa ? Placa.fmt(p.placa) : ''].filter(Boolean).join(' · ');
  },
  // veículo do pedido no formato do cadastro
  veiculoDe(p) {
    const v = { id: uid(), tipo: p.tipo === 'moto' ? 'moto' : 'carro', placa: Placa.norm(p.placa || ''), marca: p.marca || '', modelo: p.modelo || '', anoModelo: p.ano || '' };
    Object.keys(v).forEach(k => { if (!v[k]) delete v[k]; }); return v;
  },
  tempo(d) {
    const min = Math.round((Date.now() - new Date(d)) / 60000);
    return min < 1 ? 'agora' : min < 60 ? `há ${min} min` : min < 1440 ? `há ${Math.round(min / 60)} h` : fmtDateTime(d);
  },

  // Som curto + vibração quando chega pedido novo
  alerta() {
    try { navigator.vibrate && navigator.vibrate([180, 80, 180]); } catch {}
    try {
      const ac = new (window.AudioContext || window.webkitAudioContext)();
      [0, 0.18].forEach((t, i) => {
        const o = ac.createOscillator(), g = ac.createGain();
        o.type = 'sine'; o.frequency.value = i ? 1175 : 880;
        g.gain.setValueAtTime(0.0001, ac.currentTime + t); g.gain.exponentialRampToValueAtTime(0.25, ac.currentTime + t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + t + 0.16);
        o.connect(g); g.connect(ac.destination); o.start(ac.currentTime + t); o.stop(ac.currentTime + t + 0.18);
      });
    } catch {}
  },

  itemHTML(p, compacto) {
    const [ul, uc] = URGENCIA[p.urgencia] || URGENCIA.media;
    return `<div class="item bar" style="--bar:${p.lido ? 'var(--line-2)' : 'var(--gold)'};${p.lido ? '' : 'background:rgba(var(--gold-rgb), .06)'}" onclick="Pedidos.detalhe('${p.id}')">
      <div class="row between" style="align-items:flex-start"><div class="grow" style="min-width:0">
        <div class="meta"><span class="num">PEDIDO ${p.numero || ''}</span>${p.lido ? '' : '<span class="pill gold">● Não lido</span>'}<span class="pill ${uc}">${ul}</span><span>${this.tempo(p.criadoEm)}</span></div>
        <div class="title" style="margin-top:8px">${esc(p.nome)}</div>
        <div class="device">${icon(p.tipo === 'moto' ? 'moto' : 'car', 'sm')} <span data-no-i18n>${esc(this.veiculo(p))}</span></div>
      </div>${p.status !== 'novo' && p.status !== 'lido' ? `<span class="pill ${PEDIDO_STATUS[p.status][1]}">${PEDIDO_STATUS[p.status][0]}</span>` : ''}</div>
      ${compacto ? '' : `<div class="desc">${esc(p.defeito)}</div>`}
    </div>`;
  },

  lista() {
    const ps = this.todos();
    const link = this.link();
    return `${link ? `<div class="card mb row between wrap" style="padding:12px 16px"><div class="grow" style="min-width:0"><b>${icon('chat', 'sm')} Link para o cliente pedir orçamento</b><div class="xs muted ellipsis">${esc(link)}</div></div>
        <div class="row"><button class="btn sm" onclick="Pedidos.copiarLink()">Copiar</button><a class="btn sm success" target="_blank" href="https://api.whatsapp.com/send?text=${encodeURIComponent(`Peça seu orçamento na ${Store.s.loja} pelo link: ${link}`)}">${icon('whatsapp', 'sm')}</a></div></div>`
      : `<div class="info-box">${icon('info')}<span>Ligue a nuvem (Supabase) para receber pedidos de orçamento pelo link.</span></div>`}
      <div class="card pad-0"><div class="list-head"><b>${ps.length} pedido(s) · <span class="gold">${this.naoLidos().length} não lido(s)</span></b></div>
      ${ps.map(p => this.itemHTML(p)).join('') || `<div class="empty">${icon('chat')}<div>Nenhum pedido ainda. Divulgue o link no Instagram e no WhatsApp!</div></div>`}</div>`;
  },

  popup(lista) {
    if (!lista.length) return;
    if ($('#pd-popup')) $('#pd-popup').closest('.modal-backdrop').remove();
    const um = lista.length === 1 ? lista[0] : null;
    openModal({
      title: um ? 'Novo pedido de orçamento!' : `${lista.length} pedidos de orçamento não lidos`, icon: 'bell',
      subtitle: um ? `Pedido ${um.numero || ''} · ${this.tempo(um.criadoEm)}` : 'Enviados pelos clientes pelo link',
      body: `<div id="pd-popup" class="card pad-0">${lista.slice(0, 4).map(p => this.itemHTML(p, true)).join('')}</div>${lista.length > 4 ? `<p class="small muted center">+ ${lista.length - 4} pedido(s)</p>` : ''}`,
      foot: `<button class="btn" data-close>Depois</button>${um ? `<button class="btn primary" onclick="Pedidos.detalhe('${um.id}')">${icon('eye')} Ver pedido</button>` : `<button class="btn primary" onclick="closeAllModals();App.go('os',{tab:'pedidos'})">${icon('eye')} Ver pedidos</button>`}`,
    });
  },

  detalhe(id) {
    const p = this.get(id); if (!p) return;
    closeAllModals();
    if (!p.lido) { p.lido = true; p.lidoEm = nowISO(); p.lidoPor = App.userEmail(); if (p.status === 'novo') p.status = 'lido'; Store.save(); App.updateNav(); if (App.route === 'os') App.refresh(); }
    const [ul, uc] = URGENCIA[p.urgencia] || URGENCIA.media;
    const orc = p.orcamentoId && Store.db.orcamentos.find(o => o.id === p.orcamentoId);
    openModal({
      title: `Pedido ${p.numero || ''} · ${p.nome}`, subtitle: `Recebido ${fmtDateTime(p.criadoEm)}`, icon: 'chat',
      body: `<div class="row wrap mb"><span class="pill ${uc}">Urgência: ${ul}</span><span class="pill ${PEDIDO_STATUS[p.status]?.[1] || ''}">${PEDIDO_STATUS[p.status]?.[0] || p.status}</span></div>
        <div class="card mb">
          <div class="kv"><span class="k">Cliente</span><span class="v">${esc(p.nome)}</span></div>
          <div class="kv"><span class="k">WhatsApp</span><span class="v">${esc(fmtPhone(p.telefone))}</span></div>
          <div class="kv"><span class="k">Veículo</span><span class="v gold" data-no-i18n>${esc([p.marca, p.modelo, p.ano].filter(Boolean).join(' '))}</span></div>
          ${p.placa ? `<div class="kv"><span class="k">Placa</span><span class="v"><b class="placa-tag" data-no-i18n>${esc(Placa.fmt(p.placa))}</b></span></div>` : ''}
        </div>
        <div class="card mb"><div class="lbl mb">O que está acontecendo</div><div style="white-space:pre-wrap">${esc(p.defeito)}</div></div>
        ${orc ? `<button class="btn outline-gold block" onclick="closeAllModals();OrcPage.detalhe('${orc.id}')">${icon('card')} Ver orçamento ${orc.numero} · ${money(OrcPage.total(orc))}</button>` : ''}`,
      foot: `${p.status === 'recusado' ? '' : `<button class="btn primary" style="flex-basis:100%" onclick="Pedidos.criarOrcamento('${p.id}')">${icon('check')} ${orc ? 'Novo orçamento' : 'Aceitar e criar orçamento'}</button>`}
        <a class="btn success" target="_blank" href="${waLink(p.telefone, `Olá ${String(p.nome).split(' ')[0]}! Aqui é da ${Store.s.loja} 🔧\n\nRecebemos seu pedido de orçamento nº ${p.numero || ''} para o *${this.veiculo(p)}* (${p.defeito}).\n\nVamos analisar e já te enviamos o orçamento!`)}">${icon('whatsapp')} WhatsApp</a>
        ${p.status === 'recusado' ? `<button class="btn" onclick="Pedidos.status('${p.id}','lido')">${icon('undo')} Reabrir</button>` : `<button class="btn danger" onclick="Pedidos.status('${p.id}','recusado')">${icon('xCircle')} Recusar</button>`}
        <button class="btn ghost" onclick="Pedidos.naoLido('${p.id}')">Marcar não lido</button>`,
    });
  },

  status(id, st) { const p = this.get(id); p.status = st; Store.save(); closeAllModals(); App.refresh(); toast(st === 'recusado' ? 'Pedido recusado' : 'Pedido reaberto'); },
  naoLido(id) { const p = this.get(id); p.lido = false; if (p.status === 'lido') p.status = 'novo'; Store.save(); closeAllModals(); App.updateNav(); App.refresh(); },

  // Aceitar: abre o orçamento já preenchido com cliente, veículo e reclamação
  criarOrcamento(id) {
    const p = this.get(id);
    closeAllModals();
    const tel = onlyDigits(p.telefone);
    const cli = Store.clientesAtivos().find(c => tel && onlyDigits(c.telefone).replace(/^55/, '') === tel.replace(/^55/, ''));
    const v = this.veiculoDe(p), ja = cli && (cli.veiculos || []).find(x => v.placa && Placa.mesma(x.placa, v.placa));
    OrcPage.novo(null, { pedidoId: p.id, clienteId: cli?.id || null, nome: p.nome, telefone: tel, veiculo: ja || v, defeito: p.defeito });
  },

  async copiarLink() {
    const l = this.link(); if (!l) return;
    try { await navigator.clipboard.writeText(l); toast('Link copiado'); } catch { prompt('Copie o link:', l); }
  },
};
