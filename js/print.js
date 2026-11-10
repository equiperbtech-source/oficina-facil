/* Documentos para impressão (OS, garantia, orçamento, recibo, etiquetas) */
const Print = {
  css: `
    #print-root { display: none; }
    @media print {
      @page { margin: 12mm; }
      body > *:not(#print-root) { display: none !important; }
      html, body { background: #fff !important; color: #111 !important; height: auto !important; min-height: 0 !important; overflow: visible !important; }
      #print-root, .pdoc { margin: 0 !important; padding: 0 !important; }
      #print-root { display: block !important; }
    }
    .pdoc { font-family: Inter, Arial, sans-serif; color: #111; font-size: 12.5px; line-height: 1.45; background: #fff; }
    /* cabeçalho em fundo branco com moldura (sem faixa preta: economiza tinta) */
    .pdoc .ph { display: flex; align-items: center; gap: 14px; background: #fff; color: #111; padding: 12px 16px; border-radius: 10px; border: 2px solid var(--gold, #1E3A8A); }
    .pdoc .ph img { width: 64px; height: 64px; object-fit: contain; border-radius: 8px; }
    .pdoc .ph .n { font-size: 20px; font-weight: 800; color: #111; }
    .pdoc .ph .d { font-size: 11px; color: #555; }
    .pdoc .ph .doc { margin-left: auto; text-align: right; }
    .pdoc .ph .doc b { display: block; font-size: 16px; color: #111; }
    .pdoc h3 { font-size: 12px; text-transform: uppercase; letter-spacing: .1em; margin: 16px 0 6px; padding-bottom: 4px; border-bottom: 2px solid var(--gold, #1E3A8A); color: #000; }
    .pdoc table { width: 100%; border-collapse: collapse; }
    .pdoc td, .pdoc th { border: 1px solid #ccc; padding: 6px 8px; text-align: left; vertical-align: top; }
    .pdoc th { background: #f3f3f3; font-size: 11px; text-transform: uppercase; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .pdoc .g2 { display: grid; grid-template-columns: 1fr 1fr; gap: 0 18px; }
    .pdoc .pkv { display: flex; gap: 6px; padding: 2px 0; }
    .pdoc .pkv b { min-width: 92px; }
    .pdoc .fotos { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; break-inside: avoid; page-break-inside: avoid; }
    .pdoc .fotos img { width: 100%; aspect-ratio: 4 / 3; object-fit: cover; border: 1px solid #ccc; border-radius: 6px; display: block; }
    .pdoc .total { text-align: right; font-size: 16px; font-weight: 800; margin-top: 8px; }
    .pdoc .terms { font-size: 10.5px; color: #333; text-align: justify; }
    .pdoc .sigs { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; margin-top: 40px; break-inside: avoid; page-break-inside: avoid; }
    .pdoc .sig { text-align: center; border-top: 1px solid #111; padding-top: 4px; font-size: 11px; position: relative; }
    .pdoc .sig img { position: absolute; bottom: 100%; left: 50%; transform: translateX(-50%); height: 56px; }
    .pdoc .cut { border-top: 1px dashed #999; margin: 22px 0; position: relative; }
    .pdoc .chk { display: grid; grid-template-columns: repeat(3, 1fr); gap: 2px 10px; font-size: 11px; }
    .pdoc .foot { text-align: center; font-size: 10px; color: #777; margin-top: 18px; }
    .pdoc .stamp { display: inline-block; border: 2px solid var(--gold, #1E3A8A); color: var(--gold-3, #172554); font-weight: 800; padding: 4px 12px; border-radius: 6px; letter-spacing: .1em; }
    .etq { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
    .etq div { border: 1px dashed #999; padding: 8px; font-size: 11px; text-align: center; page-break-inside: avoid; }
    .etq b { display: block; font-size: 13px; }
  `,
  init() {
    const st = document.createElement('style'); st.textContent = this.css; document.head.appendChild(st);
    const r = document.createElement('div'); r.id = 'print-root'; document.body.appendChild(r);
  },
  run(html) {
    const root = $('#print-root');
    root.innerHTML = `<div class="pdoc">${html}</div>`;
    const imgs = $$('img', root).filter(i => !i.complete);
    Promise.all(imgs.map(i => new Promise(r => { i.onload = i.onerror = r; }))).then(() => setTimeout(() => window.print(), 50));
  },
  header(tipo, numero) {
    const s = Store.s;
    const logo = typeof Tema !== 'undefined' && Tema.atual ? Tema.atual.logo_url : '';
    return `<div class="ph">${logo ? `<img src="${esc(logo)}" alt="">` : ''}
      <div><div class="n">${esc(s.loja)}</div>
      <div class="d">${[s.cnpj && 'CNPJ ' + esc(s.cnpj), s.telefone && esc(s.telefone), s.instagram && esc(s.instagram)].filter(Boolean).join(' · ')}</div>
      <div class="d">${esc(s.endereco || '')}</div></div>
      <div class="doc"><span class="d">${esc(tipo)}</span><b>${numero ? '#' + numero : ''}</b><span class="d">${fmtDateTime(new Date())}</span></div></div>`;
  },
  clienteBlock(c) {
    c = c || {};
    return `<h3>Cliente</h3><div class="g2">
      <div class="pkv"><b>Nome:</b> ${esc(c.nome || '—')}</div>
      <div class="pkv"><b>${esc(c.docTipo || 'Doc')}:</b> ${esc(c.doc || '—')}</div>
      <div class="pkv"><b>Telefone:</b> ${esc(fmtPhone(c.telefone) || '—')}</div>
      <div class="pkv"><b>E-mail:</b> ${esc(c.email || '—')}</div></div>`;
  },
  veiculoBlock(v) {
    v = v || {};
    return `<h3>${v.tipo === 'moto' ? 'Moto' : 'Carro'}</h3><div class="g2">
      <div class="pkv"><b>Placa:</b> <span class="placa-print">${esc(v.placa ? Placa.fmt(v.placa) : '—')}</span></div>
      <div class="pkv"><b>Veículo:</b> ${esc(Veiculo.completo(v) || '—')}</div>
      <div class="pkv"><b>Cor:</b> ${esc(v.cor || '—')}</div>
      <div class="pkv"><b>Combustível:</b> ${esc(COMBUSTIVEIS[v.combustivel] || '—')}</div></div>`;
  },
  sigImg(src) { return src ? `<img src="${src}" alt="">` : ''; },
  // Fotos do veículo (as marcadas para sair na impressão)
  fotosBlock(urls) { return urls.length ? `<h3>Fotos do veículo</h3><div class="fotos">${urls.map(u => `<img src="${esc(u)}" alt="">`).join('')}</div>` : ''; },

  async os(o) {
    const fotos = await Fotos.urlsParaImprimir(o);
    const c = Store.cliente(o.clienteId);
    const s = Store.s;
    const tec = s.tecnicos.find(x => x.id === o.tecnicoId);
    this.run(`
      ${this.header('Termo de entrada', o.numero)}
      ${this.clienteBlock(c)}
      ${this.veiculoBlock(o.veiculo)}
      <div class="g2"><div class="pkv"><b>Km na entrada:</b> ${o.kmEntrada ? fmtKm(o.kmEntrada) : '—'}</div><div class="pkv"><b>Combustível no tanque:</b> ${esc(Combustivel.rotulo(o.nivelCombustivel) || '—')}</div>
      <div class="pkv"><b>Itens no veículo:</b> ${esc(o.acessorios || 'Nenhum')}</div></div>
      <h3>Serviço</h3>
      <div class="pkv"><b>Reclamação:</b> ${esc(o.defeito || '—')}</div>
      <div class="pkv"><b>Serviço:</b> ${esc(o.servico || '—')}</div>
      ${o.obs ? `<div class="pkv"><b>Obs.:</b> ${esc(o.obs)}</div>` : ''}
      <div class="g2"><div class="pkv"><b>Entrada:</b> ${fmtDateTime(o.criadoEm)}</div>${s.usarPrevisao !== false ? `<div class="pkv"><b>Previsão:</b> ${fmtDate(o.previsao)}</div>` : ''}
      <div class="pkv"><b>Mecânico:</b> ${esc(Mecanicos.nome(o.mecanicoId || o.tecnicoId) || '—')}</div><div class="pkv"><b>Etapa:</b> ${esc(OS_STATUS[o.status].label)}</div></div>
      ${o.checklist && Object.keys(o.checklist).length ? `<h3>Checklist de entrada</h3><div class="chk">${Checklist.daOS(o).map(i => `<div>${o.checklist[i] === 'ok' ? '☑' : o.checklist[i] === 'nok' ? '☒' : '☐'} ${esc(i)}</div>`).join('')}</div>` : ''}
      ${this.fotosBlock(fotos)}
      ${(() => {
        if (!OSItens.temItens(o)) return `<div class="total">Valor: ${money(Store.osTotal(o))}${o.desconto ? ` <span style="font-size:11px;font-weight:400">(desconto ${money(o.desconto)})</span>` : ''}</div>`;
        const k = OSItens.totais(o);
        const linhas = l => l.map(i => `<tr><td>${esc(i.nome)}</td><td>${fmtQtd(i.qtd)}</td><td>${money((Number(i.valor) || 0) * (Number(i.qtd) || 0))}</td></tr>`).join('');
        return `<div class="g2"><div>${(o.itensServico || []).length ? `<h3>Mão de obra</h3><table><tr><th>Serviço</th><th style="width:40px">Qtd</th><th style="width:90px">Total</th></tr>${linhas(o.itensServico)}</table>` : ''}</div>
          <div>${(o.itensPeca || []).length ? `<h3>Peças</h3><table><tr><th>Peça</th><th style="width:40px">Qtd</th><th style="width:90px">Total</th></tr>${linhas(o.itensPeca)}</table>` : ''}</div></div>
          <p style="text-align:right;margin:6px 0 0">Mão de obra ${money(k.mo)} · Peças ${money(k.pe)}${k.desconto ? ` · Desconto -${money(k.desconto)}` : ''}</p>
          <div class="total">Total: ${money(k.total)}</div>`;
      })()}
      <h3>Termos</h3><div class="terms">${esc(Termos.entrada())}</div>
      <div class="sigs"><div class="sig">${this.sigImg(o.assinaturaCliente)}Assinatura do cliente</div><div class="sig">${this.sigImg(tec?.assinatura || s.assinaturaDono)}${esc(s.loja)}</div></div>`);
  },

  async orcamento(orc) {
    const fotos = await Fotos.urlsParaImprimir(orc);
    const c = Store.cliente(orc.clienteId);
    OrcPage.normalizar(orc);
    const k = OSItens.totais(orc);
    const linhas = l => l.map(i => `<tr><td>${esc(i.nome)}</td><td>${fmtQtd(i.qtd)}</td><td>${money(i.valor)}</td><td>${money((Number(i.valor) || 0) * (Number(i.qtd) || 0))}</td></tr>`).join('');
    this.run(`
      ${this.header('Orçamento', orc.numero)}
      ${this.clienteBlock(c)}
      ${this.veiculoBlock(orc.veiculo)}
      ${orc.defeito ? `<div class="pkv" style="margin-top:6px"><b>Reclamação:</b> ${esc(orc.defeito)}</div>` : ''}
      ${this.fotosBlock(fotos)}
      ${orc.itensServico.length ? `<h3>Mão de obra</h3><table><tr><th>Serviço</th><th style="width:50px">Qtd</th><th style="width:100px">Unit.</th><th style="width:100px">Total</th></tr>${linhas(orc.itensServico)}</table>` : ''}
      ${orc.itensPeca.length ? `<h3>Peças</h3><table><tr><th>Peça</th><th style="width:50px">Qtd</th><th style="width:100px">Unit.</th><th style="width:100px">Total</th></tr>${linhas(orc.itensPeca)}</table>` : ''}
      <p style="text-align:right;margin:8px 0 0">Mão de obra ${money(k.mo)} · Peças ${money(k.pe)}${k.desconto ? ` · Desconto -${money(k.desconto)}` : ''}</p>
      <div class="total">Total: ${money(k.total)}</div>
      <p><b>Validade:</b> ${fmtDate(orc.validade)} · <b>Prazo estimado:</b> ${esc(orc.prazo || '—')}</p>
      ${orc.obs ? `<p><b>Obs.:</b> ${esc(orc.obs)}</p>` : ''}
      <div class="foot">Orçamento sujeito a alteração após a desmontagem e o diagnóstico completo.</div>`);
  },

  venda(v) {
    const c = v.clienteId ? Store.cliente(v.clienteId) : null;
    this.run(`
      ${this.header('Recibo de Venda', v.numero)}
      ${c ? this.clienteBlock(c) : ''}
      <h3>Itens</h3>
      <table><tr><th>Item</th><th style="width:50px">Qtd</th><th style="width:100px">Unit.</th><th style="width:100px">Total</th></tr>
      ${v.itens.map(i => `<tr><td>${esc(i.nome)}</td><td>${fmtQtd(i.qtd)}</td><td>${money(i.preco)}</td><td>${money(i.preco * i.qtd)}</td></tr>`).join('')}</table>
      ${v.desconto ? `<div class="right" style="margin-top:6px">Desconto: -${money(v.desconto)}</div>` : ''}
      <div class="total">Total: ${money(v.total)}</div>
      <p><b>Pagamento:</b> ${esc(nomeForma(v.forma))}${v.parcelas > 1 ? ` ${v.parcelas}x` : ''} · <b>Data:</b> ${fmtDateTime(v.data)}</p>
      ${v.itens.filter(i => i.garantiaDias).map(i => `<p><b>Garantia ${esc(i.nome)}:</b> ${esc(prazoGarantia(i.garantiaDias))} (até ${fmtDate(addDays(v.data, i.garantiaDias))})</p>`).join('')}
      <div class="foot">${esc(Termos.rodape())}</div>`);
  },

  etiquetas(itens) {
    this.run(`<div class="etq">${itens.map(p => `<div><b>${esc(p.nome)}</b>${p.codigo ? esc(p.codigo) + '<br>' : ''}${p.preco ? `<b>${money(p.preco)}</b>` : ''}<span style="font-size:9px">${esc(Store.s.loja)}</span></div>`).join('')}</div>`);
  },

  // Etiqueta para prender no veículo ou na chave: placa em destaque
  osEtiqueta(o) {
    const c = Store.cliente(o.clienteId), v = o.veiculo || {};
    this.run(`<div style="width:62mm;border:1.5px solid #000;padding:6px;font-size:11px;text-align:center">
      <div style="font:800 26px/1.1 ui-monospace,Menlo,monospace;letter-spacing:.06em;border:2px solid #000;border-radius:4px;padding:4px 0;margin-bottom:5px">${esc(v.placa ? Placa.fmt(v.placa) : '———')}</div>
      <b style="font-size:15px">OS #${o.numero}</b><br>${esc(Veiculo.completo(v) || '')}<br>${esc(c?.nome || '')}<br>
      <span style="font-size:10px">${esc(o.defeito || '')}</span><br>${t('Entrada')}: ${fmtDate(o.criadoEm)}${o.kmEntrada ? ' · ' + fmtKm(o.kmEntrada) : ''}</div>`);
  },
};
document.addEventListener('DOMContentLoaded', () => Print.init());
