/* PDF de garantia (jsPDF). Usado pelo app e pela página pública de acompanhamento.
   Recebe um objeto simples para funcionar com dados locais ou vindos do Supabase. */
// cores do tema da loja nos PDFs (sem tema: o dourado original)
const pdfCor = () => (typeof Tema !== 'undefined' && Tema.atual ? Tema.rgb(Tema.atual.cor_primaria) : [30, 58, 138]);   // azul escuro da Oficina Simples
const pdfCorEscura = () => (typeof Tema !== 'undefined' && Tema.atual ? Tema.rgb(Tema.misturar(Tema.atual.cor_secundaria, '#000000', 0.2)) : [23, 37, 84]);

const Pdf = {
  logo: null, logoUrl: null,
  // logo da oficina (tema). Qualquer formato (PNG, JPG, SVG, WEBP) é redesenhado num canvas e vira PNG comum
  // antes de entrar no jsPDF. Só guarda em cache quando deu certo (falha: tenta de novo na próxima vez).
  async carregarLogo() {
    const url = (typeof Tema !== 'undefined' && Tema.atual) ? (Tema.atual.logo_url || null) : null;
    if (!url) return null;
    if (this.logoUrl === url && this.logo) return this.logo;
    try {
      const b = await (await fetch(url)).blob();
      const src = URL.createObjectURL(b);
      const img = await new Promise((ok, ko) => { const i = new Image(); i.onload = () => ok(i); i.onerror = ko; i.src = src; });
      const lado = 400, k = Math.min(lado / (img.naturalWidth || lado), lado / (img.naturalHeight || lado));
      const w = Math.max(1, Math.round((img.naturalWidth || lado) * k)), h = Math.max(1, Math.round((img.naturalHeight || lado) * k));
      const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
      const cx = cv.getContext('2d'); cx.fillStyle = '#ffffff'; cx.fillRect(0, 0, w, h); cx.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(src);
      const png = cv.toDataURL('image/png');
      if (!/^data:image\/png;base64,/.test(png) || png.length < 100) return null;
      this.logo = png; this.logoUrl = url;
      return png;
    } catch { return null; }
  },

  /* d = { tipo: 'reparo'|'venda', numero, loja:{nome,cnpj,telefone,endereco,instagram}, cliente:{nome,doc,docTipo,telefone},
          veiculo:{tipo,placa,marca,modelo,ano,km}, itens:[{desc,valor,qtd}], total, desconto, forma, inicio, dias, km, termos,
          defeito, assinaturaTecnico, tecnico, assinaturaCliente } */
  async garantia(d) {
    if (this.formato() !== 'a4') return this.cupomGarantia(d);
    const { jsPDF } = window.jspdf;
    const doc = I18N.pdf(new jsPDF({ unit: 'mm', format: 'a4' }));
    const W = 210, M = 14;
    const GOLD = pdfCor(), GOLD_D = pdfCorEscura(), BLACK = [0, 0, 0], GRAY = [90, 90, 90];
    const logo = await this.carregarLogo();
    const L = d.loja || {};

    this.cabecalho(doc, logo, L, 'TERMO DE GARANTIA', d.tipo === 'venda' ? `VENDA #${d.numero}` : `OS #${d.numero}`);

    let y = 52;
    // Selo da garantia
    const selo = this.selo(d.dias, d.km);
    doc.setDrawColor(...GOLD); doc.setLineWidth(0.8);
    doc.roundedRect(W / 2 - 50, y - 7, 100, 12, 2, 2, 'S');
    doc.setTextColor(...GOLD_D); doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.text(selo, W / 2, y + 0.8, { align: 'center' });
    y += 8;
    doc.setTextColor(...GRAY); doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
    doc.text(d.tipo === 'venda' ? 'Peças e acessórios' : d.km ? t('{prazo} ou {km}, o que vier primeiro', { prazo: prazoGarantia(d.dias), km: fmtKm(d.km) }) : 'Serviço executado', W / 2, y + 2, { align: 'center' });
    y += 8;

    const titulo = t => {
      y += 4; doc.setTextColor(...BLACK); doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.text(t.toUpperCase(), M, y);
      doc.setDrawColor(...GOLD); doc.setLineWidth(0.6); doc.line(M, y + 1.8, W - M, y + 1.8); y += 7;
    };
    const kv = (pares) => {
      doc.setFontSize(9.5);
      for (let i = 0; i < pares.length; i += 2) {
        [pares[i], pares[i + 1]].forEach((p, j) => {
          if (!p) return; const x = M + j * 92;
          doc.setFont('helvetica', 'bold'); doc.setTextColor(...BLACK); doc.text(p[0] + ':', x, y);
          doc.setFont('helvetica', 'normal'); doc.setTextColor(40, 40, 40); doc.text(doc.splitTextToSize(String(p[1] || '—'), 62), x + 26, y);
        });
        y += 6;
      }
    };

    titulo('Cliente');
    kv([['Nome', d.cliente?.nome], d.cliente?.doc ? [d.cliente.docTipo || 'Documento', d.cliente.doc] : null, d.cliente?.telefone ? ['Telefone', d.cliente.telefone] : null].filter(Boolean));
    if (d.veiculo && (d.veiculo.modelo || d.veiculo.placa)) {
      titulo('Veículo');
      kv([['Placa', d.veiculo.placa], ['Veículo', [d.veiculo.marca, d.veiculo.modelo, d.veiculo.ano].filter(Boolean).join(' ')], d.veiculo.km ? ['Km', fmtKm(d.veiculo.km)] : null, d.veiculo.cor ? ['Cor', d.veiculo.cor] : null].filter(Boolean));
    }
    if (d.defeito) kv([['Reclamação', d.defeito]]);

    titulo(d.tipo === 'venda' ? 'Compra' : 'Serviço executado');
    // tabela
    doc.setDrawColor(200, 200, 200); doc.setLineWidth(0.3); doc.line(M, y + 2.2, W - M, y + 2.2);   // cabeçalho da tabela: só uma linha
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor(...GRAY);
    doc.text('DESCRIÇÃO', M + 2, y); doc.text('VALOR', W - M - 2, y, { align: 'right' }); y += 6;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(30, 30, 30);
    for (const it of d.itens || []) {
      const linhas = doc.splitTextToSize((it.qtd > 1 ? `${it.qtd}x ` : '') + it.desc, 140);
      doc.text(linhas, M + 2, y); doc.text(it.valor == null ? 'incluso' : money(it.valor), W - M - 2, y, { align: 'right' });
      y += linhas.length * 5; doc.setDrawColor(225, 225, 225); doc.setLineWidth(0.2); doc.line(M, y - 3, W - M, y - 3); y += 1.5;
    }
    if (d.desconto) { doc.text('Desconto', M + 2, y); doc.text('-' + money(d.desconto), W - M - 2, y, { align: 'right' }); y += 6; }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(...BLACK);
    doc.text('TOTAL', M + 2, y + 1); doc.text(money(d.total), W - M - 2, y + 1, { align: 'right' }); y += 8;
    if (d.forma) { doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...GRAY); doc.text('Forma de pagamento: ' + d.forma, M + 2, y); y += 5; }

    // Validade
    y += 3;
    const ini = d.inicio ? new Date(d.inicio) : new Date();
    const fim = addDays(ini, d.dias);
    const kmFim = d.km && d.veiculo?.km ? Number(d.veiculo.km) + Number(d.km) : null;
    this.moldura(doc, M, y, W - 2 * M, 16);
    doc.setTextColor(...GRAY); doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
    doc.text('INÍCIO DA GARANTIA', M + 8, y + 6); doc.text('VÁLIDA ATÉ', W / 2 + 8, y + 6);
    doc.setTextColor(...BLACK); doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.text(fmtDate(ini), M + 8, y + 12.5);
    doc.setTextColor(...GOLD_D); doc.text(fmtDate(fim) + (kmFim ? `  ${t('ou')} ${fmtKm(kmFim)}` : ''), W / 2 + 8, y + 12.5);
    y += 24;

    titulo('Condições da garantia');
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(50, 50, 50);
    const termos = doc.splitTextToSize(d.termos || '', W - 2 * M);
    doc.text(termos, M, y, { lineHeightFactor: 1.35 }); y += termos.length * 4.1 + 4;
    doc.text(doc.splitTextToSize('Para acionar a garantia, apresente este termo (impresso ou no celular) e traga o veículo à oficina.', W - 2 * M), M, y); y += 8;

    // Assinaturas
    if (y > 245) { doc.addPage(); y = 30; }
    y = Math.max(y + 18, 250);
    const sig = (img, label, x) => {
      if (img) try { doc.addImage(img, 'PNG', x + 15, y - 17, 50, 16); } catch {}
      doc.setDrawColor(...BLACK); doc.setLineWidth(0.3); doc.line(x, y, x + 80, y);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(...GRAY); doc.text(label, x + 40, y + 4.5, { align: 'center' });
    };
    sig(d.assinaturaCliente, 'Cliente — ' + (d.cliente?.nome || ''), M);
    sig(d.assinaturaTecnico, d.tipo === 'venda' ? (L.nome || 'Oficina') : 'Mecânico responsável' + (d.tecnico ? ' — ' + d.tecnico : ''), W - M - 80);

    this.rodape(doc, d.rodape || `Obrigado pela preferência! ${L.nome || ''}`);
    return doc;
  },

  /* Orçamento (A4): cliente, veículo, mão de obra e peças separados, total, validade */
  async orcamento(orc) {
    const { jsPDF } = window.jspdf;
    const doc = I18N.pdf(new jsPDF({ unit: 'mm', format: 'a4' }));
    const W = 210, M = 14, GOLD = pdfCor(), BLACK = [0, 0, 0], GRAY = [90, 90, 90];
    const s = Store.s, c = Store.cliente(orc.clienteId) || {}, v = orc.veiculo || {};
    const L = { nome: s.loja, cnpj: s.cnpj, telefone: s.telefone, endereco: s.endereco, instagram: s.instagram };
    this.cabecalho(doc, await this.carregarLogo(), L, 'ORÇAMENTO', `ORC ${orc.numero}`);
    let y = 52;
    const titulo = tt => { y += 3; doc.setTextColor(...BLACK); doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.text(tt.toUpperCase(), M, y); doc.setDrawColor(...GOLD); doc.setLineWidth(0.6); doc.line(M, y + 1.8, W - M, y + 1.8); y += 7; };
    const kv = (k, val) => { if (!val) return; doc.setFont('helvetica', 'bold'); doc.setTextColor(...BLACK); doc.setFontSize(9.5); doc.text(k + ':', M, y); doc.setFont('helvetica', 'normal'); doc.setTextColor(40, 40, 40); const tt = doc.splitTextToSize(String(val), W - 2 * M - 30); doc.text(tt, M + 30, y); y += 5 * tt.length + 1; };
    titulo('Cliente'); kv('Nome', c.nome); kv('Telefone', fmtPhone(c.telefone));
    titulo('Veículo'); kv('Placa', v.placa ? Placa.fmt(v.placa) : ''); kv('Veículo', Veiculo.completo(v)); kv('Reclamação', orc.defeito);
    const tabela = (tt, lista) => {
      if (!lista.length) return;
      titulo(tt);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(30, 30, 30);
      for (const i of lista) {
        const l = doc.splitTextToSize((Number(i.qtd) !== 1 ? fmtQtd(i.qtd) + 'x ' : '') + i.nome, 140);
        if (y + l.length * 5 > 275) { doc.addPage(); y = 20; }
        doc.text(l, M + 2, y); doc.text(money((Number(i.valor) || 0) * (Number(i.qtd) || 0)), W - M - 2, y, { align: 'right' }); y += l.length * 5 + 0.5;
      }
    };
    tabela('Mão de obra', orc.itensServico || []); tabela('Peças', orc.itensPeca || []);
    const k = OSItens.totais(orc);
    y += 3; if (y > 255) { doc.addPage(); y = 20; }
    this.moldura(doc, M, y, W - 2 * M, 13);
    doc.setTextColor(...GRAY); doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
    doc.text(`MÃO DE OBRA ${money(k.mo)}  ·  PEÇAS ${money(k.pe)}${k.desconto ? `  ·  DESCONTO -${money(k.desconto)}` : ''}`, M + 6, y + 8.3);
    doc.setTextColor(...BLACK); doc.setFont('helvetica', 'bold'); doc.setFontSize(14); doc.text(money(k.total), W - M - 6, y + 8.8, { align: 'right' });
    y += 20;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...GRAY);
    doc.text(`${t('Válido até')} ${fmtDate(orc.validade)}${orc.prazo ? ` · ${t('Prazo')}: ${orc.prazo}` : ''}`, M, y); y += 6;
    if (orc.obs) { doc.text(doc.splitTextToSize(orc.obs, W - 2 * M), M, y); }
    this.rodape(doc, Termos.rodape());
    return doc;
  },

  /* Comprovante de pagamento da OS (mesmo d da garantia + pagoEm). 1 página, fundo branco. */
  async comprovante(d) {
    const { jsPDF } = window.jspdf;
    const doc = I18N.pdf(new jsPDF({ unit: 'mm', format: 'a4' }));
    const W = 210, M = 14, GOLD = pdfCor(), GOLD_D = pdfCorEscura(), BLACK = [0, 0, 0], GRAY = [90, 90, 90];
    const L = d.loja || {};
    this.cabecalho(doc, await this.carregarLogo(), L, 'COMPROVANTE DE PAGAMENTO', `OS #${d.numero}`);
    let y = 52;
    const titulo = tt => { y += 4; doc.setTextColor(...BLACK); doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.text(tt.toUpperCase(), M, y); doc.setDrawColor(...GOLD); doc.setLineWidth(0.6); doc.line(M, y + 1.8, W - M, y + 1.8); y += 7; };
    const kv = (k, val) => { if (!val) return; doc.setFont('helvetica', 'bold'); doc.setTextColor(...BLACK); doc.setFontSize(9.5); doc.text(k + ':', M, y); doc.setFont('helvetica', 'normal'); doc.setTextColor(40, 40, 40); doc.text(String(val), M + 32, y); y += 6; };
    titulo('Cliente'); kv('Nome', d.cliente?.nome);
    if (d.veiculo) { titulo('Veículo'); kv('Placa', d.veiculo.placa); kv('Veículo', [d.veiculo.marca, d.veiculo.modelo, d.veiculo.ano].filter(Boolean).join(' ')); }
    titulo('Itens');
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(30, 30, 30);
    for (const it of d.itens || []) {
      const l = doc.splitTextToSize((it.qtd > 1 ? `${fmtQtd(it.qtd)}x ` : '') + it.desc, 140);
      doc.text(l, M + 2, y); if (it.valor != null) doc.text(money(it.valor), W - M - 2, y, { align: 'right' });
      y += l.length * 5; doc.setDrawColor(225, 225, 225); doc.setLineWidth(0.2); doc.line(M, y - 3, W - M, y - 3); y += 1.5;
    }
    if (d.desconto) { doc.text('Desconto', M + 2, y); doc.text('-' + money(d.desconto), W - M - 2, y, { align: 'right' }); y += 6; }
    y += 2; this.moldura(doc, M, y, W - 2 * M, 18);
    doc.setTextColor(...GRAY); doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
    doc.text(`${d.forma || ''}${d.pagoEm ? ' · ' + fmtDateTime(d.pagoEm) : ''}`, M + 6, y + 7);
    doc.setTextColor(...GOLD_D); doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.text('PAGO ' + money(d.total), W - M - 6, y + 12, { align: 'right' });
    this.rodape(doc, d.rodape || `Obrigado pela preferência! ${L.nome || ''}`);
    return doc;
  },

  // Cabeçalho em fundo branco com moldura na cor da oficina (sem faixa escura: economiza tinta)
  cabecalho(doc, logo, L, titulo, numero) {
    const W = 210, M = 14, GOLD_D = pdfCorEscura();
    this.moldura(doc, M - 4, 5, W - 2 * M + 8, 34);
    if (logo) try { doc.addImage(logo, /^data:image\/jpe?g/.test(logo) ? 'JPEG' : 'PNG', M, 9, 26, 26); } catch {}
    const xT = logo ? M + 31 : M;
    doc.setTextColor(20, 20, 20); doc.setFont('helvetica', 'bold'); doc.setFontSize(18); doc.text(L.nome || (typeof Tema !== 'undefined' && Tema.nome()) || 'Oficina', xT, 16);
    doc.setTextColor(80, 80, 80); doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
    const info = [L.cnpj && 'CNPJ ' + L.cnpj, L.telefone, L.instagram].filter(Boolean).join('  ·  ');
    if (info) doc.text(info, xT, 23);
    if (L.endereco) doc.text(doc.splitTextToSize(L.endereco, 105), xT, 28);
    doc.setTextColor(80, 80, 80); doc.setFontSize(9); doc.text(titulo, W - M, 14, { align: 'right' });
    doc.setTextColor(...GOLD_D); doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.text(numero, W - M, 22, { align: 'right' });
    doc.setTextColor(110, 110, 110); doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
    doc.text('Emitido em ' + fmtDateTime(new Date()), W - M, 28, { align: 'right' });
  },
  // "GARANTIA DE 3 MESES (90 DIAS)" quando é em meses; senão "GARANTIA DE 45 DIAS"; com km: "GARANTIA: 3 MESES OU 5.000 KM"
  selo(dias, km) {
    if (km) return `GARANTIA: ${prazoGarantia(dias).toUpperCase()} OU ${fmtKm(km).toUpperCase()}`;
    const m = dias / 30;
    return dias && dias % 30 === 0 ? `GARANTIA DE ${m} ${m === 1 ? 'MÊS' : 'MESES'} (${dias} DIAS)` : `GARANTIA DE ${dias} DIAS`;
  },
  // caixa só com o contorno (nada preenchido) e rodapé com uma linha fina
  moldura(doc, x, y, w, h) { doc.setDrawColor(...pdfCor()); doc.setLineWidth(0.6); doc.roundedRect(x, y, w, h, 2, 2, 'S'); },
  rodape(doc, texto) {
    const W = 210, M = 14;
    doc.setDrawColor(...pdfCor()); doc.setLineWidth(0.4); doc.line(M, 286, W - M, 286);
    doc.setTextColor(80, 80, 80); doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.text(texto, W / 2, 291.5, { align: 'center' });
  },

  /* Ordem de serviço de entrada (1 via) */
  async ordem(o) {
    if (this.formato() !== 'a4') return this.cupomOrdem(o);
    const { jsPDF } = window.jspdf;
    const doc = I18N.pdf(new jsPDF({ unit: 'mm', format: 'a4' }));
    const W = 210, M = 14, GOLD = pdfCor(), BLACK = [0, 0, 0], GRAY = [90, 90, 90];
    const s = Store.s, c = Store.cliente(o.clienteId) || {}, v = o.veiculo || {};
    const tec = s.tecnicos.find(x => x.id === o.tecnicoId);
    const mec = Mecanicos.nome(o.mecanicoId || o.tecnicoId);
    const L = { nome: s.loja, cnpj: s.cnpj, telefone: s.telefone, endereco: s.endereco, instagram: s.instagram };
    this.cabecalho(doc, await this.carregarLogo(), L, 'TERMO DE ENTRADA', `OS #${o.numero}`);
    const fotos = await Fotos.imagensParaImprimir(o);
    let y = 52;
    // com fotos a OS pode passar de 1 página: quebra antes do bloco que não cabe
    const cabe = h => { if (y + h > 283) { doc.addPage(); y = 20; } };
    const titulo = t => { y += 3; doc.setTextColor(...BLACK); doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.text(t.toUpperCase(), M, y); doc.setDrawColor(...GOLD); doc.setLineWidth(0.6); doc.line(M, y + 1.8, W - M, y + 1.8); y += 7; };
    const kv = pares => {
      doc.setFontSize(9.5);
      for (let i = 0; i < pares.length; i += 2) {
        let h = 1;
        [pares[i], pares[i + 1]].forEach((p, j) => {
          if (!p) return; const x = M + j * 92;
          doc.setFont('helvetica', 'bold'); doc.setTextColor(...BLACK); doc.text(p[0] + ':', x, y);
          doc.setFont('helvetica', 'normal'); doc.setTextColor(40, 40, 40);
          const t = doc.splitTextToSize(String(p[1] || '—'), 62); doc.text(t, x + 26, y); h = Math.max(h, t.length);
        });
        y += 5 * h + 1;
      }
    };
    const linha = (k, v) => { doc.setFont('helvetica', 'bold'); doc.setTextColor(...BLACK); doc.setFontSize(9.5); doc.text(k + ':', M, y); doc.setFont('helvetica', 'normal'); doc.setTextColor(40, 40, 40); const t = doc.splitTextToSize(String(v || '—'), W - 2 * M - 28); doc.text(t, M + 28, y); y += 5 * t.length + 1; };

    titulo('Cliente');
    kv([['Nome', c.nome], [c.docTipo || 'Documento', c.doc], ['Telefone', fmtPhone(c.telefone)], ['E-mail', c.email]]);
    titulo(v.tipo === 'moto' ? 'Moto' : 'Carro');
    // placa em destaque
    if (v.placa) {
      doc.setDrawColor(...BLACK); doc.setLineWidth(0.6); doc.roundedRect(W - M - 52, y - 6, 52, 13, 1.5, 1.5, 'S');
      doc.setFillColor(...GOLD); doc.rect(W - M - 52, y - 6, 52, 2.6, 'F');
      doc.setTextColor(...BLACK); doc.setFont('courier', 'bold'); doc.setFontSize(17); doc.text(Placa.fmt(v.placa), W - M - 26, y + 5, { align: 'center' });
    }
    const larg = v.placa ? 120 : W - 2 * M;
    const linhaV = (k, val) => { if (!val) return; doc.setFont('helvetica', 'bold'); doc.setTextColor(...BLACK); doc.setFontSize(9.5); doc.text(k + ':', M, y); doc.setFont('helvetica', 'normal'); doc.setTextColor(40, 40, 40); const tt = doc.splitTextToSize(String(val), larg - 28); doc.text(tt, M + 28, y); y += 5 * tt.length + 1; };
    const yIni = y;
    linhaV('Veículo', Veiculo.completo(v) || '—');
    linhaV('Cor', v.cor); linhaV('Combustível', COMBUSTIVEIS[v.combustivel]);
    if (v.tipo === 'moto') linhaV('Cilindrada', v.cilindrada ? v.cilindrada + ' cc' : ''); else linhaV('Motor / câmbio', [v.motor, CAMBIOS[v.cambio]].filter(Boolean).join(' · '));
    linhaV('Chassi', v.chassi);
    y = Math.max(y, yIni + 14);
    kv([['Km na entrada', o.kmEntrada ? fmtKm(o.kmEntrada) : '—'], ['Combustível', Combustivel.rotulo(o.nivelCombustivel) || '—'], o.acessorios ? ['Itens no veículo', o.acessorios] : null].filter(Boolean));
    titulo('Serviço');
    linha('Reclamação', o.defeito); if (o.servico) linha('Serviço', o.servico); if (o.obs) linha('Obs.', o.obs);
    kv([['Entrada', fmtDateTime(o.criadoEm)], s.usarPrevisao !== false && o.previsao ? ['Previsão', fmtDate(o.previsao)] : null, ['Mecânico', mec || s.loja], ['Etapa', OS_STATUS[o.status]?.label], ['Garantia', t('{prazo} após a conclusão', { prazo: textoGarantia(o) })]].filter(Boolean));
    if (o.checklist && Object.keys(o.checklist).length) {
      const itens = Checklist.daOS(o);
      titulo('Checklist de entrada');
      doc.setFontSize(8.2);
      const colw = (W - 2 * M) / 3;
      itens.forEach((it, i) => {
        const val = o.checklist[it]; const x = M + (i % 3) * colw, yy = y + Math.floor(i / 3) * 4.6;
        doc.setTextColor(...(val === 'nok' ? [185, 28, 28] : val === 'ok' ? [19, 115, 51] : GRAY));
        doc.text(doc.splitTextToSize(`${val === 'ok' ? '[OK]' : val === 'nok' ? '[X]' : '[?]'} ${it}`, colw - 2)[0], x, yy);
      });
      y += Math.ceil(itens.length / 3) * 4.6 + 2;
    }
    if (fotos.length) {
      // 4 por linha, foto inteira (sem cortar) centralizada numa caixa 4:3
      const col = 4, gap = 3, bw = (W - 2 * M - gap * (col - 1)) / col, bh = bw * 0.75;
      cabe(10 + bh); titulo('Fotos do veículo');
      fotos.forEach((f, i) => {
        if (i && i % col === 0) { y += bh + gap; cabe(bh); }
        const x = M + (i % col) * (bw + gap), k = Math.min(bw / f.w, bh / f.h), w = f.w * k, h = f.h * k;
        doc.setDrawColor(200, 200, 200); doc.setLineWidth(0.2); doc.rect(x, y, bw, bh);
        try { doc.addImage(f.src, 'JPEG', x + (bw - w) / 2, y + (bh - h) / 2, w, h); } catch {}
      });
      y += bh + 4;
    }
    // itens (mão de obra e peças) em duas colunas compactas, para caber em 1 página
    const k = OSItens.totais(o);
    if (OSItens.temItens(o)) {
      const col = (titulo2, lista, x, w) => {
        let yy = y; doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor(...GRAY); doc.text(titulo2.toUpperCase(), x, yy); yy += 4.6;
        doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(30, 30, 30);
        for (const i of lista.slice(0, 10)) {
          const nm = doc.splitTextToSize((Number(i.qtd) !== 1 ? fmtQtd(i.qtd) + 'x ' : '') + i.nome, w - 26)[0];
          doc.text(nm, x, yy); doc.text(money((Number(i.valor) || 0) * (Number(i.qtd) || 0)), x + w, yy, { align: 'right' }); yy += 4.4;
        }
        if (lista.length > 10) { doc.setTextColor(...GRAY); doc.text(`+${lista.length - 10}`, x, yy); yy += 4.4; }
        return yy;
      };
      const cw = (W - 2 * M - 8) / 2;
      cabe(8 + 4.4 * Math.min(11, Math.max((o.itensServico || []).length, (o.itensPeca || []).length)));
      y += 1;
      y = Math.max(col('Mão de obra', o.itensServico || [], M, cw), col('Peças', o.itensPeca || [], M + cw + 8, cw)) + 1;
    }
    y += 2;
    cabe(20);
    this.moldura(doc, M, y, W - 2 * M, 13);
    doc.setTextColor(...GRAY); doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
    doc.text(OSItens.temItens(o) ? `MÃO DE OBRA ${money(k.mo)}  ·  PEÇAS ${money(k.pe)}${k.desconto ? `  ·  DESCONTO -${money(k.desconto)}` : ''}` : 'VALOR DO SERVIÇO', M + 6, y + 8.3);
    doc.setTextColor(...BLACK); doc.setFont('helvetica', 'bold'); doc.setFontSize(14); doc.text(money(Store.osTotal(o)), W - M - 6, y + 8.8, { align: 'right' });
    y += 20;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
    const termos = doc.splitTextToSize(Termos.entrada(), W - 2 * M);
    // termos, link e assinaturas andam juntos: se não cabem no fim da página, vão todos para a próxima
    cabe(8 + termos.length * 3.8 + 2 + (Cloud.loja && o.token ? 6 : 0) + 24);
    titulo('Termos');
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(50, 50, 50);
    doc.text(termos, M, y, { lineHeightFactor: 1.3 }); y += termos.length * 3.8 + 2;
    if (Cloud.loja && o.token) { doc.setTextColor(...BLACK); doc.setFont('helvetica', 'bold'); doc.text('Acompanhe em tempo real: ', M, y); doc.setFont('helvetica', 'normal'); doc.setTextColor(30, 80, 200); doc.textWithLink(Store.linkOS(o), M + 42, y, { url: Store.linkOS(o) }); y += 6; }
    y = Math.min(Math.max(y + 18, 255), 278);
    const sig = (img, label, x) => {
      if (img) try { doc.addImage(img, 'PNG', x + 15, y - 17, 50, 16); } catch {}
      doc.setDrawColor(...BLACK); doc.setLineWidth(0.3); doc.line(x, y, x + 80, y);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(...GRAY); doc.text(label, x + 40, y + 4.5, { align: 'center' });
    };
    sig(o.assinaturaCliente, 'Assinatura do cliente', M);
    sig(tec?.assinatura || s.assinaturaDono, s.loja, W - M - 80);
    const pags = doc.getNumberOfPages();
    for (let n = 1; n <= pags; n++) { doc.setPage(n); this.rodape(doc, `${Termos.rodape()}${pags > 1 ? `   ·   página ${n} de ${pags}` : ''}`); }
    return doc;
  },

  /* Recibo de venda com os termos de garantia. Cabe em 1 página; só quebra se não couber. */
  async recibo(v) {
    if (this.formato() !== 'a4') return this.cupomRecibo(v);
    const { jsPDF } = window.jspdf;
    const doc = I18N.pdf(new jsPDF({ unit: 'mm', format: 'a4' }));
    const W = 210, M = 14, FIM = 280, GOLD = pdfCor(), BLACK = [0, 0, 0], GRAY = [90, 90, 90];
    const s = Store.s, c = v.clienteId ? Store.cliente(v.clienteId) || {} : {};
    const L = { nome: s.loja, cnpj: s.cnpj, telefone: s.telefone, endereco: s.endereco, instagram: s.instagram };
    const logo = await this.carregarLogo();
    this.cabecalho(doc, logo, L, 'RECIBO DE VENDA', `VENDA #${v.numero}`);
    let y = 51;
    const espaco = h => { if (y + h > FIM) { doc.addPage(); y = 18; doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(...GRAY); doc.text(`${s.loja} · Recibo da venda #${v.numero} (continuação)`, M, 12); } };
    const titulo = t => { espaco(12); y += 2; doc.setTextColor(...BLACK); doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.text(t.toUpperCase(), M, y); doc.setDrawColor(...GOLD); doc.setLineWidth(0.6); doc.line(M, y + 1.8, W - M, y + 1.8); y += 7; };
    const kv = (k, val, x) => { doc.setFont('helvetica', 'bold'); doc.setTextColor(...BLACK); doc.setFontSize(9.5); doc.text(k + ':', x, y); doc.setFont('helvetica', 'normal'); doc.setTextColor(40, 40, 40); doc.text(String(val || '—'), x + 24, y); };

    titulo('Cliente');
    kv('Nome', c.nome || v.clienteNome || 'Consumidor final', M); kv('Telefone', fmtPhone(c.telefone), M + 100); y += 5.5;
    if (c.doc) { kv(c.docTipo || 'CPF', c.doc, M); y += 5.5; }

    titulo('Itens');
    doc.setDrawColor(200, 200, 200); doc.setLineWidth(0.3); doc.line(M, y + 2.2, W - M, y + 2.2);   // cabeçalho da tabela: só uma linha
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor(...GRAY);
    doc.text('ITEM', M + 2, y); doc.text('QTD', 128, y, { align: 'right' }); doc.text('UNIT.', 158, y, { align: 'right' }); doc.text('TOTAL', W - M - 2, y, { align: 'right' }); y += 6;
    for (const i of v.itens) {
      const desc = doc.splitTextToSize(i.nome, 100);
      espaco(desc.length * 4.6 + 3);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(30, 30, 30);
      doc.text(desc, M + 2, y); doc.text(fmtQtd(i.qtd), 128, y, { align: 'right' }); doc.text(money(i.preco), 158, y, { align: 'right' }); doc.text(money(i.preco * i.qtd), W - M - 2, y, { align: 'right' });
      y += desc.length * 4.6; doc.setDrawColor(225, 225, 225); doc.setLineWidth(0.2); doc.line(M, y - 2.5, W - M, y - 2.5); y += 1.5;
    }
    espaco(22);
    doc.setFontSize(9.5); doc.setTextColor(...GRAY);
    if (v.desconto) { doc.text('Subtotal ' + money(v.subtotal || v.total + v.desconto) + '   ·   Desconto -' + money(v.desconto), W - M - 2, y, { align: 'right' }); y += 6; }
    this.moldura(doc, M, y - 1, W - 2 * M, 11);
    doc.setTextColor(...GRAY); doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.text(`${nomeForma(v.forma)}${v.parcelas > 1 ? ` ${v.parcelas}x` : ''} · ${fmtDateTime(v.data)}`, M + 5, y + 6);
    doc.setTextColor(...BLACK); doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.text('TOTAL ' + money(v.total), W - M - 5, y + 6.3, { align: 'right' });
    y += 16;

    // Garantia agrupada por prazo (ex.: "Bateria 60Ah — 1 ano" e "3 itens — 3 meses")
    const grupos = {};
    for (const i of v.itens.filter(i => i.garantiaDias)) (grupos[i.garantiaDias] ||= []).push(i);
    const prazoTxt = d => d >= 365 && d % 365 === 0 ? `${d / 365} ano${d > 365 ? 's' : ''}` : d % 30 === 0 && d >= 60 ? `${d / 30} meses` : `${d} dias`;
    if (Object.keys(grupos).length) {
      titulo('Garantia');
      doc.setFontSize(9.5);
      for (const [dias, its] of Object.entries(grupos).sort((a, b) => b[0] - a[0])) {
        const nomes = its.length <= 3 ? its.map(i => i.nome).join(', ') : `${its.length} itens (${its.slice(0, 2).map(i => i.nome).join(', ')}...)`;
        const linhas = doc.splitTextToSize(nomes, 120);
        espaco(linhas.length * 4.6 + 2);
        doc.setFont('helvetica', 'bold'); doc.setTextColor(...BLACK); doc.text(linhas, M, y);
        doc.setFont('helvetica', 'normal'); doc.setTextColor(40, 40, 40); doc.text(`${prazoTxt(+dias)} · até ${fmtDate(addDays(v.data, +dias))}`, W - M, y, { align: 'right' });
        y += linhas.length * 4.6 + 1.2;
      }
      y += 1;
    }
    const termos = [['Peças e acessórios', s.termosGarantiaProduto]];
    if (termos.some(t => t[1])) {
      titulo('Termos de garantia');
      for (const [t, txt] of termos.filter(t => t[1])) {
        const linhas = doc.splitTextToSize(txt, W - 2 * M);
        espaco(6 + linhas.length * 3.7);
        if (termos.length > 1) { doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor(...BLACK); doc.text(t, M, y); y += 4.2; }
        doc.setFont('helvetica', 'normal'); doc.setFontSize(8.2); doc.setTextColor(50, 50, 50);
        doc.text(linhas, M, y, { lineHeightFactor: 1.3 }); y += linhas.length * 3.7 + 3;
      }
    }

    // Assinaturas e rodapé
    espaco(22);
    y = Math.min(Math.max(y + 16, 262), FIM - 4);
    const sig = (label, x) => { doc.setDrawColor(...BLACK); doc.setLineWidth(0.3); doc.line(x, y, x + 80, y); doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(...GRAY); doc.text(label, x + 40, y + 4.5, { align: 'center' }); };
    if (s.assinaturaDono) try { doc.addImage(s.assinaturaDono, 'PNG', W - M - 65, y - 17, 50, 16); } catch {}
    sig('Cliente — ' + (c.nome || v.clienteNome || ''), M); sig(s.loja, W - M - 80);
    const pages = doc.getNumberOfPages();
    for (let n = 1; n <= pages; n++) {
      doc.setPage(n);
      this.rodape(doc, `${Termos.rodape()}${pages > 1 ? `   ·   página ${n} de ${pages}` : ''}`);
    }
    return doc;
  },

  /* ---------- Cupom para impressora térmica (80 mm ou 58 mm) ----------
     Formato escolhido em Configurações (Store.s.formatoPdf: 'a4' | '80' | '58'). A página tem a largura do
     papel e a altura do conteúdo (desenha uma vez para medir e outra para valer). Só preto: sai nítido no térmico. */
  formato() { const f = typeof Store !== 'undefined' && Store.s ? Store.s.formatoPdf : null; return f === '80' || f === '58' ? f : 'a4'; },
  // Janela com os três formatos (A4, cupom 80 mm, cupom 58 mm). Um clique escolhe, guarda como padrão e segue.
  escolherFormato(titulo = 'Formato do PDF') {
    return new Promise(res => {
      let feito = false; const atual = this.formato();
      const op = (f, rotulo, desc, ic) => `<button class="btn block fmt-btn ${atual === f ? 'primary' : ''}" data-fmt="${f}" style="justify-content:flex-start;text-align:left;min-height:58px">${icon(ic)}<span class="grow"><b style="display:block">${rotulo}</b><span class="xs ${atual === f ? '' : 'muted'}">${desc}</span></span></button>`;
      const m = openModal({
        title: titulo, icon: 'printer',
        body: `<div class="col" style="gap:8px">${op('a4', 'A4', 'Folha comum (impressora normal)', 'file')}${op('80', 'Cupom 80 mm', 'Impressora térmica de 80 mm', 'printer')}${op('58', 'Cupom 58 mm', 'Impressora térmica de 58 mm (pequena)', 'printer')}</div>`,
        onClose: () => { if (!feito) res(null); },
        onMount: el => $$('[data-fmt]', el).forEach(b => b.onclick = () => {
          feito = true; Store.s.formatoPdf = b.dataset.fmt; Store.save(); m.close(); res(b.dataset.fmt);
        }),
      });
    });
  },
  // Imprimir: A4 usa a impressão da tela; cupom abre o PDF do cupom para imprimir
  abrirParaImprimir(doc, nome) {
    const url = doc.output('bloburl');
    const w = window.open(url, '_blank');
    if (!w) doc.save(nome);   // bloqueador de janelas: baixa o arquivo
  },
  async cupom(desenhar) {
    const { jsPDF } = window.jspdf;
    const W = +this.formato();
    const logo = await this.carregarLogo();
    const medir = I18N.pdf(new jsPDF({ unit: 'mm', format: [W, 3000] }));
    const altura = this.cupomDesenhar(medir, W, logo, desenhar);
    const doc = I18N.pdf(new jsPDF({ unit: 'mm', format: [W, Math.max(altura + 8, 80)] }));
    this.cupomDesenhar(doc, W, logo, desenhar);
    return doc;
  },
  cupomDesenhar(doc, W, logo, desenhar) {
    const estreito = W < 70, M = estreito ? 2 : 3, LW = W - 2 * M, F = estreito ? 7.2 : 8.4;   // margem, largura útil e fonte base
    let y = 5;
    const fonte = (tam, negrito) => { doc.setFont('helvetica', negrito ? 'bold' : 'normal'); doc.setFontSize(tam); doc.setTextColor(0, 0, 0); };
    const alt = tam => tam * 0.42;   // altura da linha (mm) para a fonte
    const c = {
      W, M, LW, F,
      centro(txt, tam = F, negrito = false) {
        if (!txt) return; fonte(tam, negrito);
        const l = doc.splitTextToSize(String(txt), LW); doc.text(l, W / 2, y + alt(tam) * 0.8, { align: 'center' }); y += l.length * alt(tam) + 0.6;
      },
      texto(txt, tam = F - 0.6) {
        if (!txt) return; fonte(tam);
        const l = doc.splitTextToSize(String(txt), LW); doc.text(l, M, y + alt(tam) * 0.8); y += l.length * alt(tam) + 0.8;
      },
      tracejado() { y += 1; doc.setLineDashPattern([0.8, 0.8], 0); doc.setDrawColor(0, 0, 0); doc.setLineWidth(0.2); doc.line(M, y, W - M, y); doc.setLineDashPattern([], 0); y += 2; },
      titulo(t) { c.tracejado(); c.centro(String(t).toUpperCase(), F + 0.4, true); y += 0.6; },
      // "Rótulo: valor" (quebra o valor nas linhas seguintes)
      kv(k, v) {
        if (v == null || v === '') return;
        // rótulo já no idioma do PDF (o tradutor do jsPDF troca o texto, então mede o traduzido)
        fonte(F, true); const rot = doc.splitTextToSize(k + ':', 999)[0]; const wr = doc.getTextWidth(rot + ' ');
        fonte(F); const primeira = doc.splitTextToSize(String(v), LW - wr);
        fonte(F, true); doc.text(rot, M, y + alt(F) * 0.8);
        fonte(F);
        if (primeira.length === 1) { doc.text(primeira[0], M + wr, y + alt(F) * 0.8); y += alt(F) + 0.6; return; }
        const resto = doc.splitTextToSize(String(v), LW); doc.text(resto, M, y + alt(F) * 1.8); y += (resto.length + 1) * alt(F) + 0.6;
      },
      // texto à esquerda e valor à direita na mesma linha
      par(esq, dir, tam = F, negrito = false) {
        fonte(tam, negrito); const wd = dir ? doc.getTextWidth(String(dir)) + 2 : 0;
        const l = doc.splitTextToSize(String(esq || ''), LW - wd);
        doc.text(l, M, y + alt(tam) * 0.8); if (dir) doc.text(String(dir), W - M, y + alt(tam) * 0.8, { align: 'right' });
        y += l.length * alt(tam) + 0.7;
      },
      // item vendido: descrição e, embaixo, "qtd x unitário ........ total"
      item(desc, qtd, unit, total) {
        fonte(F); const l = doc.splitTextToSize(String(desc), LW); doc.text(l, M, y + alt(F) * 0.8); y += l.length * alt(F) + 0.3;
        if (total != null) c.par(unit != null ? `${qtd} x ${money(unit)}` : (qtd > 1 ? `${qtd} un.` : ''), money(total), F - 0.6);
      },
      total(rotulo, valor) { y += 0.6; c.par(rotulo, valor, F + 2.4, true); y += 0.4; },
      assinatura(rotulo, img) {
        y += 4;
        if (img) try { doc.addImage(img, 'PNG', W / 2 - 18, y, 36, 11); } catch {}
        y += 12; doc.setDrawColor(0, 0, 0); doc.setLineWidth(0.25); doc.line(M + 4, y, W - M - 4, y); y += 1;
        c.centro(rotulo, F - 0.8);
      },
      espaco(mm = 2) { y += mm; },
    };
    // cabeçalho da loja
    const s = typeof Store !== 'undefined' ? Store.s : {};
    if (logo) try { const t = estreito ? 14 : 18; doc.addImage(logo, /^data:image\/jpe?g/.test(logo) ? 'JPEG' : 'PNG', W / 2 - t / 2, y, t, t); y += t + 2; } catch {}
    c.centro(s.loja || (typeof Tema !== 'undefined' && Tema.nome()) || '', F + 3, true);
    c.centro([s.cnpj && 'CNPJ ' + s.cnpj, s.telefone].filter(Boolean).join(' · '), F - 0.6);
    c.centro(s.endereco, F - 0.6);
    c.centro(s.instagram, F - 0.6);
    desenhar(c);
    c.tracejado();
    c.centro(typeof Termos !== 'undefined' ? Termos.rodape() : 'Obrigado pela preferência!', F, true);
    c.centro('Emitido em ' + fmtDateTime(new Date()), F - 1.2);
    return y;
  },

  async cupomOrdem(o) {
    const s = Store.s, cl = Store.cliente(o.clienteId) || {}, v = o.veiculo || {};
    const mec = Mecanicos.nome(o.mecanicoId || o.tecnicoId);
    return this.cupom(c => {
      c.titulo('Termo de entrada'); c.centro(`OS #${o.numero}`, c.F + 3, true);
      if (v.placa) c.centro(Placa.fmt(v.placa), c.F + 5, true);
      c.titulo('Cliente'); c.kv('Nome', cl.nome); c.kv(cl.docTipo || 'Documento', cl.doc); c.kv('Telefone', fmtPhone(cl.telefone));
      c.titulo(v.tipo === 'moto' ? 'Moto' : 'Carro'); c.kv('Veículo', Veiculo.completo(v)); c.kv('Cor', v.cor); c.kv('Km na entrada', o.kmEntrada ? fmtKm(o.kmEntrada) : ''); c.kv('Combustível', Combustivel.rotulo(o.nivelCombustivel)); c.kv('Itens no veículo', o.acessorios);
      c.titulo('Serviço'); c.kv('Reclamação', o.defeito); c.kv('Serviço', o.servico); c.kv('Obs.', o.obs);
      c.kv('Entrada', fmtDateTime(o.criadoEm)); c.kv('Previsão', o.previsao && s.usarPrevisao !== false ? fmtDate(o.previsao) : ''); c.kv('Mecânico', mec); c.kv('Etapa', OS_STATUS[o.status]?.label);
      if (o.checklist && Object.keys(o.checklist).length) {
        const itens = Checklist.daOS(o);
        c.titulo('Checklist de entrada');
        const ok = itens.filter(i => o.checklist[i] === 'ok'), nok = itens.filter(i => o.checklist[i] === 'nok'), nv = itens.filter(i => o.checklist[i] === 'nv');
        if (ok.length) c.kv('OK', ok.join(', ')); if (nok.length) c.kv('Com defeito', nok.join(', ')); if (nv.length) c.kv('Não verificado', nv.join(', '));
      }
      if (OSItens.temItens(o)) {
        c.titulo('Serviços e peças');
        for (const i of o.itensServico || []) c.item(i.nome, fmtQtd(i.qtd), i.valor, (Number(i.valor) || 0) * (Number(i.qtd) || 0));
        for (const i of o.itensPeca || []) c.item(i.nome, fmtQtd(i.qtd), i.valor, (Number(i.valor) || 0) * (Number(i.qtd) || 0));
        const k = OSItens.totais(o);
        c.tracejado(); c.par('Mão de obra', money(k.mo)); c.par('Peças', money(k.pe)); if (k.desconto) c.par('Desconto', '-' + money(k.desconto));
      } else c.tracejado();
      c.total('TOTAL', money(Store.osTotal(o)));
      c.kv('Garantia', t('{prazo} após a conclusão', { prazo: textoGarantia(o) }));
      c.titulo('Termos'); c.texto(Termos.entrada());
      if (Cloud.loja && o.token) { c.espaco(1); c.texto('Acompanhe em: ' + Store.linkOS(o)); }
      c.assinatura('Assinatura do cliente', o.assinaturaCliente);
    });
  },

  async cupomRecibo(v) {
    const s = Store.s, cl = v.clienteId ? Store.cliente(v.clienteId) || {} : {};
    return this.cupom(c => {
      c.titulo('Recibo de venda'); c.centro(`VENDA #${v.numero}`, c.F + 3, true); c.centro(fmtDateTime(v.data), c.F - 0.6);
      c.titulo('Cliente'); c.kv('Nome', cl.nome || v.clienteNome || 'Consumidor final'); c.kv('Telefone', fmtPhone(cl.telefone)); c.kv(cl.docTipo || 'CPF', cl.doc);
      c.titulo('Itens');
      for (const i of v.itens) c.item(i.nome, fmtQtd(i.qtd), i.preco, i.preco * i.qtd);
      c.tracejado();
      if (v.desconto) { c.par('Subtotal', money(v.subtotal || v.total + v.desconto)); c.par('Desconto', '-' + money(v.desconto)); }
      c.total('TOTAL', money(v.total));
      c.kv('Pagamento', `${nomeForma(v.forma)}${v.parcelas > 1 ? ` ${v.parcelas}x` : ''}`);
      const grupos = {};
      for (const i of v.itens.filter(i => i.garantiaDias)) (grupos[i.garantiaDias] ||= []).push(i);
      if (Object.keys(grupos).length) {
        c.titulo('Garantia');
        for (const [dias, its] of Object.entries(grupos).sort((a, b) => b[0] - a[0])) c.kv(its.map(i => i.nome).join(', '), `${t('até')} ${fmtDate(addDays(v.data, +dias))}`);
      }
      if (s.termosGarantiaProduto) { c.titulo('Termos de garantia'); c.texto(s.termosGarantiaProduto); }
      c.assinatura('Cliente — ' + (cl.nome || v.clienteNome || ''));
    });
  },

  async cupomGarantia(d) {
    const ini = d.inicio ? new Date(d.inicio) : new Date(), fim = addDays(ini, d.dias);
    return this.cupom(c => {
      c.titulo('Termo de garantia'); c.centro(d.tipo === 'venda' ? `VENDA #${d.numero}` : `OS #${d.numero}`, c.F + 3, true);
      c.centro(this.selo(d.dias, d.km), c.F + 0.6, true);
      c.titulo('Cliente'); c.kv('Nome', d.cliente?.nome); c.kv(d.cliente?.docTipo || 'Documento', d.cliente?.doc); c.kv('Telefone', d.cliente?.telefone);
      if (d.veiculo) { c.titulo('Veículo'); c.kv('Placa', d.veiculo.placa); c.kv('Veículo', [d.veiculo.marca, d.veiculo.modelo, d.veiculo.ano].filter(Boolean).join(' ')); c.kv('Km', d.veiculo.km ? fmtKm(d.veiculo.km) : ''); }
      c.kv('Reclamação', d.defeito);
      c.titulo(d.tipo === 'venda' ? 'Compra' : 'Serviço executado');
      for (const it of d.itens || []) c.par((it.qtd > 1 ? `${it.qtd}x ` : '') + it.desc, it.valor == null ? 'incluso' : money(it.valor));
      if (d.desconto) c.par('Desconto', '-' + money(d.desconto));
      c.total('TOTAL', money(d.total));
      c.kv('Pagamento', d.forma);
      c.tracejado(); c.par('Início da garantia', fmtDate(ini), c.F, true); c.par('Válida até', fmtDate(fim), c.F + 1, true);
      if (d.km && d.veiculo?.km) c.par(t('Ou até'), fmtKm(Number(d.veiculo.km) + Number(d.km)), c.F + 1, true);
      if (d.termos) { c.titulo('Condições da garantia'); c.texto(d.termos); }
      c.texto('Para acionar a garantia, apresente este termo e traga o veículo à oficina.');
      c.assinatura('Cliente — ' + (d.cliente?.nome || ''), d.assinaturaCliente);
      c.assinatura(d.tipo === 'venda' ? 'Oficina' : 'Mecânico responsável' + (d.tecnico ? ' — ' + d.tecnico : ''), d.assinaturaTecnico);
    });
  },

  nome(d) { return `garantia-${d.tipo === 'venda' ? 'venda' : 'os'}-${d.numero}.pdf`; },

  baixar(doc, nome) { doc.save(nome); },

  // No celular abre o menu de compartilhar (WhatsApp etc.) com o PDF anexado
  async compartilhar(doc, nome, texto) {
    const file = new File([doc.output('blob')], nome, { type: 'application/pdf' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: nome, text: texto }); return true; }
      catch (e) { if (e.name === 'AbortError') return true; }
    }
    doc.save(nome);
    return false;
  },
};

/* Monta os dados do PDF a partir do banco local */
const GarantiaDados = {
  os(o) {
    const s = Store.s, c = Store.cliente(o.clienteId) || {};
    const tec = s.tecnicos.find(x => x.id === o.tecnicoId);
    const v = o.veiculo || {};
    return {
      tipo: 'reparo', numero: o.numero, loja: { nome: s.loja, cnpj: s.cnpj, telefone: s.telefone, endereco: s.endereco, instagram: s.instagram },
      cliente: { nome: c.nome, doc: c.doc, docTipo: c.docTipo, telefone: fmtPhone(c.telefone) },
      veiculo: { tipo: v.tipo, placa: v.placa ? Placa.fmt(v.placa) : '', marca: v.marca, modelo: Veiculo.nome(v) || v.modelo, cor: v.cor, km: o.kmEntrada || v.km || null }, defeito: o.defeito,
      itens: OSItens.temItens(o)
        ? [...(o.itensServico || []).map(i => ({ desc: i.nome, qtd: Number(i.qtd) || 1, valor: (Number(i.valor) || 0) * (Number(i.qtd) || 1) })),
           ...(o.itensPeca || []).map(i => ({ desc: t('Peça') + ': ' + i.nome, qtd: Number(i.qtd) || 1, valor: (Number(i.valor) || 0) * (Number(i.qtd) || 1) }))]
        : [{ desc: o.servico || o.defeito || 'Serviço', valor: (Number(o.valor) || 0) }],
      desconto: OSItens.totais(o).desconto, total: Store.osTotal(o), forma: nomeForma(o.pagamento?.forma) + (o.pagamento?.parcelas > 1 ? ` ${o.pagamento.parcelas}x` : ''), pagoEm: o.pagoEm,
      inicio: Store.garantiaInicio(o) || nowISO(), dias: Store.garantiaDiasOS(o), km: Store.garantiaKmOS(o), termos: Termos.garantia(),
      tecnico: tec?.nome || Mecanicos.nome(o.mecanicoId), assinaturaTecnico: tec?.assinatura || s.assinaturaDono, assinaturaCliente: o.assinaturaCliente,
    };
  },
};
