/* Follow-up de clientes (plano Pro): agenda de contatos com status, próximo contato e observações.
   Fica na mesma tela do Pós-venda, na aba "Agenda". */
const FU_MOTIVOS = { pos_venda: 'Pós-venda', retorno: 'Retorno / revisão', garantia: 'Fim de garantia', orcamento: 'Orçamento pendente', retirada: 'Veículo não retirado', aniversario: 'Aniversário', outro: 'Outro' };
const FU_STATUS = { pendente: ['A contatar', 'gold'], contatado: ['Contatado', 'green'], sem_resposta: ['Sem resposta', 'orange'], agendado: ['Agendado', 'blue'], concluido: ['Concluído', ''] };

const Followup = {
  filtro: 'hoje',
  todos() { return Store.db.followups.filter(f => !f.deleted); },
  abertos() { return this.todos().filter(f => f.status !== 'concluido'); },
  // a fazer hoje ou atrasados
  paraHoje() { const h = dayKey(); return this.abertos().filter(f => !f.proximoContato || f.proximoContato <= h); },
  nome(f) { const c = f.clienteId && Store.cliente(f.clienteId); return c?.nome || f.nome || 'Cliente'; },
  telefone(f) { const c = f.clienteId && Store.cliente(f.clienteId); return c?.telefone || f.telefone || ''; },

  render() {
    const h = dayKey();
    const listas = {
      hoje: this.paraHoje(),
      proximos: this.abertos().filter(f => f.proximoContato && f.proximoContato > h),
      concluidos: this.todos().filter(f => f.status === 'concluido').slice(-60),
    };
    const lista = listas[this.filtro].sort((a, b) => String(a.proximoContato || '').localeCompare(String(b.proximoContato || '')));
    return `<div class="row wrap between mb">
        <div class="tabs" id="fu-f">${[['hoje', 'Hoje e atrasados'], ['proximos', 'Próximos'], ['concluidos', 'Concluídos']].map(([k, l]) => `<button data-k="${k}" class="${this.filtro === k ? 'on' : ''}">${l} ${listas[k].length && k !== 'concluidos' ? `<span class="pill gold xs" style="padding:1px 7px">${listas[k].length}</span>` : ''}</button>`).join('')}</div>
        <button class="btn primary sm" onclick="Followup.novo()">${icon('plus', 'sm')} Novo follow-up</button></div>
      <div class="card pad-0">${lista.map(f => this.linha(f, h)).join('') || `<div class="empty">${icon('checkCircle')}<div>${this.filtro === 'hoje' ? 'Nenhum contato para hoje. 👌' : 'Nada aqui.'}</div></div>`}</div>`;
  },

  linha(f, h) {
    const [st, cor] = FU_STATUS[f.status] || FU_STATUS.pendente;
    const atrasado = f.status !== 'concluido' && f.proximoContato && f.proximoContato < h;
    const tel = this.telefone(f);
    return `<div class="item" style="cursor:default"><div class="row" style="align-items:flex-start">
      <div class="avatar">${esc(this.nome(f)[0].toUpperCase())}</div>
      <div class="grow" style="min-width:0"><b class="ellipsis" style="display:block">${esc(this.nome(f))}</b>
        <div class="row wrap" style="gap:6px;margin:4px 0"><span class="pill xs">${esc(FU_MOTIVOS[f.motivo] || f.motivo || 'Contato')}</span><span class="pill xs ${cor}">${st}</span>
          ${f.proximoContato ? `<span class="pill xs ${atrasado ? 'red' : ''}">${icon('calendar', 'sm')} ${fmtDate(f.proximoContato)}${atrasado ? ' · atrasado' : ''}</span>` : ''}</div>
        ${f.obs ? `<div class="small muted" style="white-space:pre-wrap">${esc(f.obs)}</div>` : ''}</div>
      <div class="col" style="gap:6px;align-items:flex-end">
        ${tel ? `<a class="btn sm success" target="_blank" rel="noopener" href="${esc(waLink(tel, `Olá ${this.nome(f).split(' ')[0]}! Aqui é da ${Store.s.loja}.`))}" onclick="Followup.contatou('${f.id}')">${icon('whatsapp', 'sm')}</a>` : ''}
        <button class="btn sm" onclick="Followup.editar('${f.id}')">${icon('edit', 'sm')}</button>
      </div></div></div>`;
  },

  // Abrir o WhatsApp já marca como contatado (o próximo passo é escolhido no editar)
  contatou(id) {
    const f = Store.db.followups.find(x => x.id === id); if (!f || f.status === 'concluido') return;
    f.status = 'contatado'; f.atualizadoEm = nowISO();
    (f.historico ||= []).push({ data: nowISO(), status: 'contatado', por: Store.quem().nome || null });
    Store.save(); setTimeout(() => App.refresh(), 400);
  },

  novo(pre = {}) { this.editar(null, pre); },

  editar(id, pre = {}) {
    const f = id ? Store.db.followups.find(x => x.id === id) : { status: 'pendente', motivo: pre.motivo || 'pos_venda', clienteId: pre.clienteId || null, proximoContato: pre.data || dayKey(), obs: pre.obs || '' };
    if (!f) return;
    const clientes = Store.clientesAtivos ? Store.clientesAtivos() : Store.db.clientes.filter(c => !c.deleted);
    openModal({
      title: id ? 'Follow-up' : 'Novo follow-up', icon: 'chat',
      body: `${id ? `<p style="margin-top:0"><b>${esc(this.nome(f))}</b></p>` : field('Cliente', `<select class="input" name="clienteId"><option value="">Escolha...</option>${clientes.sort((a, b) => a.nome.localeCompare(b.nome)).map(c => `<option value="${c.id}" ${c.id === f.clienteId ? 'selected' : ''}>${esc(c.nome)}${c.telefone ? ' · ' + esc(fmtPhone(c.telefone)) : ''}</option>`).join('')}</select>`)}
        <div class="form-row">${field('Motivo', `<select class="input" name="motivo">${selectOpts(FU_MOTIVOS, f.motivo)}</select>`)}${field('Status', `<select class="input" name="status">${selectOpts(Object.fromEntries(Object.entries(FU_STATUS).map(([k, [l]]) => [k, l])), f.status)}</select>`)}</div>
        ${field('Próximo contato', `<input class="input" type="date" name="proximoContato" value="${esc(f.proximoContato || '')}">`, { opt: true })}
        ${field('Observações', `<textarea class="input" name="obs" placeholder="O que foi conversado, o que ficou combinado...">${esc(f.obs || '')}</textarea>`, { opt: true })}
        ${(f.historico || []).length ? `<div class="section-title mt">Histórico</div>${f.historico.slice(-6).reverse().map(x => `<div class="xs muted">${fmtDateTime(x.data)} · ${esc((FU_STATUS[x.status] || [x.status])[0])}${x.por ? ' · ' + esc(x.por) : ''}${x.obs ? ' · ' + esc(x.obs) : ''}</div>`).join('')}` : ''}`,
      foot: `${id ? `<button class="btn danger" id="fu-del">${icon('trash')}</button>` : ''}<button class="btn" data-close>Cancelar</button><button class="btn primary" id="fu-ok">${icon('check')} Salvar</button>`,
      onMount: (el, m) => {
        $('#fu-ok', el).onclick = () => {
          const v = readForm(el);
          if (!id && !v.clienteId) return toast('Escolha o cliente', true);
          const mudouStatus = v.status !== f.status;
          Object.assign(f, { motivo: v.motivo, status: v.status, proximoContato: v.proximoContato || null, obs: v.obs.trim(), atualizadoEm: nowISO() });
          if (!id) { Object.assign(f, { id: uid(), clienteId: v.clienteId, criadoEm: nowISO(), historico: [] }); Store.db.followups.push(f); }
          if (mudouStatus || !id) (f.historico ||= []).push({ data: nowISO(), status: f.status, por: Store.quem().nome || null });
          Store.save(); m.close(); App.refresh(); toast('Follow-up salvo');
        };
        const d = $('#fu-del', el);
        if (d) d.onclick = async () => { if (await confirmDialog('Excluir este follow-up?', { danger: true, ok: 'Excluir' })) { f.deleted = true; Store.save(); m.close(); App.refresh(); } };
      },
    });
  },
};
