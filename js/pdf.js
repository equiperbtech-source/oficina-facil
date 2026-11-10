/* PDF de garantia (jsPDF). Usado pelo app e pela página pública de acompanhamento.
   Recebe um objeto simples para funcionar com dados locais ou vindos do Supabase. */
// cores do tema da loja nos PDFs (sem tema: o dourado original)
const pdfCor = () => (typeof Tema !== 'undefined' && Tema.atual ? Tema.rgb(Tema.atual.cor_primaria) : [30, 58, 138]);   // azul escuro da Oficina Simples
const pdfCorEscura = () => (typeof Tema !== 'undefined' && Tema.atual ? Tema.rgb(Tema.misturar(Tema.atual.cor_secundaria, '#000000', 0.2)) : [23, 37, 84]);

const Pdf = {
  logo: null, logoUrl: null,
  // logo da loja (tema); sem logo própria, o ícone original. PNG/JPG viram imagem no PDF.
  async carregarLogo() {
    const url = (typeof Tema !== 'undefined' && Tema.atual) ? (Tema.atual.logo_url || null) : null;
    if (this.logoUrl === url) return this.logo;
    this.logoUrl = url; this.logo = null;
    if (!url) return null;
    try {
      const b = await (await fetch(url)).blob();
      if (!/image\/(png|jpe?g)/.test(b.type)) return null; // SVG/WEBP: o PDF sai só com o nome
      this.logo = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(b); });
    } catch { this.logo = null; }
    return this.logo;
  },

  /* d = { tipo: 'reparo'|'venda', numero, loja:{nome,cnpj,telefone,endereco,instagram}, cliente:{nome,doc,docTipo,telefone},
          aparelho:{modelo,imei,idTipo,cor}, itens:[{desc,valor,qtd}], total, desconto, forma, inicio, dias, termos,
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
    const selo = this.selo(d.dias);
    doc.setDrawColor(...GOLD); doc.setLineWidth(0.8);
    doc.roundedRect(W / 2 - 50, y - 7, 100, 12, 2, 2, 'S');
    doc.setTextColor(...GOLD_D); doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.text(selo, W / 2, y + 0.8, { align: 'center' });
    y += 8;
    doc.setTextColor(...GRAY); doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
    doc.text(d.tipo === 'venda' ? 'Aparelho seminovo' : 'Serviço de reparo', W / 2, y + 2, { align: 'center' });
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
    titulo('Aparelho');
    kv([['Modelo', d.aparelho?.modelo], [d.aparelho?.idTipo === 'serial' ? 'Serial' : 'IMEI', d.aparelho?.imei], ['Cor', d.aparelho?.cor]]);
    if (d.defeito) kv([['Defeito', d.defeito]]);

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
    this.moldura(doc, M, y, W - 2 * M, 16);
    doc.setTextColor(...GRAY); doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
    doc.text('INÍCIO DA GARANTIA', M + 8, y + 6); doc.text('VÁLIDA ATÉ', W / 2 + 8, y + 6);
    doc.setTextColor(...BLACK); doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.text(fmtDate(ini), M + 8, y + 12.5);
    doc.setTextColor(...GOLD_D); doc.text(fmtDate(fim), W / 2 + 8, y + 12.5);
    y += 24;

    titulo('Condições da garantia');
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(50, 50, 50);
    const termos = doc.splitTextToSize(d.termos || '', W - 2 * M);
    doc.text(termos, M, y, { lineHeightFactor: 1.35 }); y += termos.length * 4.1 + 4;
    doc.text(doc.splitTextToSize('Para acionar a garantia, apresente este termo (impresso ou no celular) junto com o aparelho na loja.', W - 2 * M), M, y); y += 8;

    // Assinaturas
    if (y > 245) { doc.addPage(); y = 30; }
    y = Math.max(y + 18, 250);
    const sig = (img, label, x) => {
      if (img) try { doc.addImage(img, 'PNG', x + 15, y - 17, 50, 16); } catch {}
      doc.setDrawColor(...BLACK); doc.setLineWidth(0.3); doc.line(x, y, x + 80, y);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(...GRAY); doc.text(label, x + 40, y + 4.5, { align: 'center' });
    };
    sig(d.assinaturaCliente, 'Cliente — ' + (d.cliente?.nome || ''), M);
    sig(d.assinaturaTecnico, d.tipo === 'venda' ? (L.nome || 'Loja') : 'Técnico responsável' + (d.tecnico ? ' — ' + d.tecnico : ''), W - M - 80);

    this.rodape(doc, `Obrigado pela preferência! ${L.nome || ''}`);
    return doc;
  },

  // Cabeçalho preto com logo, dados da loja e número do documento
  // Cabeçalho em fundo branco com moldura na cor da loja (sem faixa preta: economiza tinta)
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
  // "GARANTIA DE 3 MESES (90 DIAS)" quando é em meses; senão "GARANTIA DE 45 DIAS"
  selo(dias) {
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
    const s = Store.s, c = Store.cliente(o.clienteId) || {}, a = o.aparelho || {};
    const tec = s.tecnicos.find(t => t.id === o.tecnicoId);
    const L = { nome: s.loja, cnpj: s.cnpj, telefone: s.telefone, endereco: s.endereco, instagram: s.instagram };
    this.cabecalho(doc, await this.carregarLogo(), L, 'ORDEM DE SERVIÇO', `OS #${o.numero}`);
    const fotos = await Fotos.imagensParaImprimir(o);
    let y = 52;
    // com fotos a OS pode passar de 1 página: quebra antes do bloco que não cabe
    const cabe = h => { if (y + h > 280) { doc.addPage(); y = 20; } };
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
    titulo('Aparelho');
    const tipo = (TIPOS_APARELHO.find(t => t[0] === a.tipo) || [])[1];
    kv([['Modelo', (a.modelo || '—') + (tipo ? ` (${tipo})` : '')], [a.idTipo === 'serial' ? 'Serial' : 'IMEI', a.imei], ['Cor', a.cor], ['Senha', o.senha], ['Acessórios', o.acessorios || 'Nenhum']]);
    if (typeof Padrao !== 'undefined' && Padrao.valido(o.padrao)) {
      doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5); doc.setTextColor(...BLACK); doc.text('Desenho:', M, y + 4);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...GRAY); doc.text('Começa no ponto 1', M, y + 9);
      Padrao.pdf(doc, o.padrao, M + 26, y, 20); y += 23;
    }
    titulo('Serviço');
    linha('Defeito', o.defeito); linha('Serviço', o.servico); if (o.obs) linha('Obs.', o.obs);
    kv([['Entrada', fmtDateTime(o.criadoEm)], ['Previsão', fmtDate(o.previsao)], ['Técnico', tec?.nome], ['Status', OS_STATUS[o.status]?.label], ['Garantia', t('{prazo} após a conclusão', { prazo: prazoGarantia(Store.garantiaDiasOS(o)) })]]);
    if (o.checklist && Object.keys(o.checklist).length) {
      titulo('Checklist de entrada');
      doc.setFontSize(8.5);
      CHECKLIST_ITENS.forEach((it, i) => {
        const v = o.checklist[it]; const x = M + (i % 3) * 62, yy = y + Math.floor(i / 3) * 5;
        doc.setTextColor(...(v === 'nok' ? [200, 40, 40] : v === 'ok' ? [20, 130, 60] : GRAY));
        doc.text(`${v === 'ok' ? '[OK]' : v === 'nok' ? '[X]' : '[ ]'} ${it}`, x, yy);
      });
      y += Math.ceil(CHECKLIST_ITENS.length / 3) * 5 + 2;
    }
    if (fotos.length) {
      // 4 por linha, foto inteira (sem cortar) centralizada numa caixa 4:3
      const col = 4, gap = 3, bw = (W - 2 * M - gap * (col - 1)) / col, bh = bw * 0.75;
      cabe(10 + bh); titulo('Fotos do aparelho');
      fotos.forEach((f, i) => {
        if (i && i % col === 0) { y += bh + gap; cabe(bh); }
        const x = M + (i % col) * (bw + gap), k = Math.min(bw / f.w, bh / f.h), w = f.w * k, h = f.h * k;
        doc.setDrawColor(200, 200, 200); doc.setLineWidth(0.2); doc.rect(x, y, bw, bh);
        try { doc.addImage(f.src, 'JPEG', x + (bw - w) / 2, y + (bh - h) / 2, w, h); } catch {}
      });
      y += bh + 4;
    }
    y += 2;
    cabe(20);
    this.moldura(doc, M, y, W - 2 * M, 13);
    doc.setTextColor(...GRAY); doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.text('VALOR DO SERVIÇO', M + 6, y + 8.3);
    doc.setTextColor(...BLACK); doc.setFont('helvetica', 'bold'); doc.setFontSize(14); doc.text(money(Store.osTotal(o)), W - M - 6, y + 8.8, { align: 'right' });
    y += 20;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
    const termos = doc.splitTextToSize(s.termosEntrada || '', W - 2 * M);
    // termos, link e assinaturas andam juntos: se não cabem no fim da página, vão todos para a próxima
    cabe(10 + termos.length * 4.1 + 4 + (Cloud.loja && o.token ? 6 : 0) + 30);
    titulo('Termos');
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(50, 50, 50);
    doc.text(termos, M, y, { lineHeightFactor: 1.35 }); y += termos.length * 4.1 + 4;
    if (Cloud.loja && o.token) { doc.setTextColor(...BLACK); doc.setFont('helvetica', 'bold'); doc.text('Acompanhe em tempo real: ', M, y); doc.setFont('helvetica', 'normal'); doc.setTextColor(30, 80, 200); doc.textWithLink(Store.linkOS(o), M + 42, y, { url: Store.linkOS(o) }); y += 6; }
    y = Math.min(Math.max(y + 22, 255), 278);
    const sig = (img, label, x) => {
      if (img) try { doc.addImage(img, 'PNG', x + 15, y - 17, 50, 16); } catch {}
      doc.setDrawColor(...BLACK); doc.setLineWidth(0.3); doc.line(x, y, x + 80, y);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(...GRAY); doc.text(label, x + 40, y + 4.5, { align: 'center' });
    };
    sig(o.assinaturaCliente, 'Assinatura do cliente', M);
    sig(tec?.assinatura || s.assinaturaDono, s.loja, W - M - 80);
    const pags = doc.getNumberOfPages();
    for (let n = 1; n <= pags; n++) { doc.setPage(n); this.rodape(doc, `Obrigado pela preferência! ${s.loja}${pags > 1 ? `   ·   página ${n} de ${pags}` : ''}`); }
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

    titulo('Produtos');
    doc.setDrawColor(200, 200, 200); doc.setLineWidth(0.3); doc.line(M, y + 2.2, W - M, y + 2.2);   // cabeçalho da tabela: só uma linha
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor(...GRAY);
    doc.text('PRODUTO', M + 2, y); doc.text('QTD', 128, y, { align: 'right' }); doc.text('UNIT.', 158, y, { align: 'right' }); doc.text('TOTAL', W - M - 2, y, { align: 'right' }); y += 6;
    for (const i of v.itens) {
      const desc = doc.splitTextToSize(i.nome + (i.imei ? ` — IMEI ${i.imei}` : ''), 100);
      espaco(desc.length * 4.6 + 3);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(30, 30, 30);
      doc.text(desc, M + 2, y); doc.text(String(i.qtd), 128, y, { align: 'right' }); doc.text(money(i.preco), 158, y, { align: 'right' }); doc.text(money(i.preco * i.qtd), W - M - 2, y, { align: 'right' });
      y += desc.length * 4.6; doc.setDrawColor(225, 225, 225); doc.setLineWidth(0.2); doc.line(M, y - 2.5, W - M, y - 2.5); y += 1.5;
    }
    espaco(22);
    doc.setFontSize(9.5); doc.setTextColor(...GRAY);
    if (v.desconto) { doc.text('Subtotal ' + money(v.subtotal || v.total + v.desconto) + '   ·   Desconto -' + money(v.desconto), W - M - 2, y, { align: 'right' }); y += 6; }
    if (v.troca) {
      espaco(12);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(40, 40, 40);
      doc.text(doc.splitTextToSize(`Aparelho recebido na troca: ${v.troca.nome}${v.troca.imei ? ' (IMEI ' + v.troca.imei + ')' : ''}`, 130), M + 2, y);
      doc.text('-' + money(v.troca.valor), W - M - 2, y, { align: 'right' }); y += 5.5;
      doc.setFont('helvetica', 'bold'); doc.text(v.pago >= 0 ? 'Valor pago pelo cliente' : 'Valor devolvido ao cliente', M + 2, y); doc.text(money(Math.abs(v.pago)), W - M - 2, y, { align: 'right' }); y += 6;
    }
    this.moldura(doc, M, y - 1, W - 2 * M, 11);
    doc.setTextColor(...GRAY); doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.text(`${v.troca ? 'Troca + ' : ''}${FORMAS_PGTO[v.forma] || v.forma || ''} · ${fmtDateTime(v.data)}`, M + 5, y + 6);
    doc.setTextColor(...BLACK); doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.text('TOTAL ' + money(v.total), W - M - 5, y + 6.3, { align: 'right' });
    y += 16;

    // Garantia agrupada por prazo (ex.: "iPhone 13 — 6 meses" e "28 acessórios — 3 meses")
    const grupos = {};
    for (const i of v.itens.filter(i => i.seminovo || i.garantiaDias)) {
      const dias = i.seminovo ? GARANTIA_SEMINOVO_DIAS : i.garantiaDias;
      (grupos[dias] ||= []).push(i);
    }
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
    const termos = [];
    if (v.itens.some(i => i.seminovo)) termos.push(['Celulares seminovos', s.termosGarantiaSeminovo]);
    if (v.itens.some(i => !i.seminovo)) termos.push(['Celulares novos e acessórios', s.termosGarantiaProduto]);
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
      this.rodape(doc, `Obrigado pela preferência! ${s.loja}${pages > 1 ? `   ·   página ${n} de ${pages}` : ''}`);
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
    c.centro('Obrigado pela preferência!', F, true);
    c.centro('Emitido em ' + fmtDateTime(new Date()), F - 1.2);
    return y;
  },

  async cupomOrdem(o) {
    const s = Store.s, cl = Store.cliente(o.clienteId) || {}, a = o.aparelho || {};
    const tec = s.tecnicos.find(t => t.id === o.tecnicoId);
    const tipo = (TIPOS_APARELHO.find(t => t[0] === a.tipo) || [])[1];
    return this.cupom(c => {
      c.titulo('Ordem de serviço'); c.centro(`OS #${o.numero}`, c.F + 3, true);
      c.titulo('Cliente'); c.kv('Nome', cl.nome); c.kv(cl.docTipo || 'Documento', cl.doc); c.kv('Telefone', fmtPhone(cl.telefone));
      c.titulo('Aparelho'); c.kv('Modelo', (a.modelo || '—') + (tipo ? ` (${tipo})` : '')); c.kv(a.idTipo === 'serial' ? 'Serial' : 'IMEI', a.imei); c.kv('Cor', a.cor); c.kv('Senha', o.senha); if (typeof Padrao !== 'undefined' && Padrao.valido(o.padrao)) c.kv('Desenho', Padrao.texto(o.padrao) + ' (1 a 9: da esquerda p/ direita, de cima p/ baixo)'); c.kv('Acessórios', o.acessorios || 'Nenhum');
      c.titulo('Serviço'); c.kv('Defeito', o.defeito); c.kv('Serviço', o.servico); c.kv('Obs.', o.obs);
      c.kv('Entrada', fmtDateTime(o.criadoEm)); c.kv('Previsão', o.previsao ? fmtDate(o.previsao) : ''); c.kv('Técnico', tec?.nome); c.kv('Status', OS_STATUS[o.status]?.label);
      if (o.checklist && Object.keys(o.checklist).length) {
        c.titulo('Checklist de entrada');
        const ok = CHECKLIST_ITENS.filter(i => o.checklist[i] === 'ok'), nok = CHECKLIST_ITENS.filter(i => o.checklist[i] === 'nok');
        if (ok.length) c.kv('OK', ok.join(', ')); if (nok.length) c.kv('Com defeito', nok.join(', '));
      }
      c.tracejado(); c.total('VALOR', money(Store.osTotal(o)));
      c.kv('Garantia', t('{prazo} após a conclusão', { prazo: prazoGarantia(Store.garantiaDiasOS(o)) }));
      if (s.termosEntrada) { c.titulo('Termos'); c.texto(s.termosEntrada); }
      if (Cloud.loja && o.token) { c.espaco(1); c.texto('Acompanhe o reparo em: ' + Store.linkOS(o)); }
      c.assinatura('Assinatura do cliente', o.assinaturaCliente);
    });
  },

  async cupomRecibo(v) {
    const s = Store.s, cl = v.clienteId ? Store.cliente(v.clienteId) || {} : {};
    return this.cupom(c => {
      c.titulo('Recibo de venda'); c.centro(`VENDA #${v.numero}`, c.F + 3, true); c.centro(fmtDateTime(v.data), c.F - 0.6);
      c.titulo('Cliente'); c.kv('Nome', cl.nome || v.clienteNome || 'Consumidor final'); c.kv('Telefone', fmtPhone(cl.telefone)); c.kv(cl.docTipo || 'CPF', cl.doc);
      c.titulo('Produtos');
      for (const i of v.itens) c.item(i.nome + (i.imei ? ` — IMEI ${i.imei}` : ''), i.qtd, i.preco, i.preco * i.qtd);
      c.tracejado();
      if (v.desconto) { c.par('Subtotal', money(v.subtotal || v.total + v.desconto)); c.par('Desconto', '-' + money(v.desconto)); }
      if (v.troca) { c.par(`Aparelho na troca: ${v.troca.nome}${v.troca.imei ? ' (IMEI ' + v.troca.imei + ')' : ''}`, '-' + money(v.troca.valor)); c.par(v.pago >= 0 ? 'Valor pago pelo cliente' : 'Valor devolvido ao cliente', money(Math.abs(v.pago)), c.F, true); }
      c.total('TOTAL', money(v.total));
      c.kv('Pagamento', `${v.troca ? 'Troca + ' : ''}${FORMAS_PGTO[v.forma] || v.forma || ''}`);
      const grupos = {};
      for (const i of v.itens.filter(i => i.seminovo || i.garantiaDias)) (grupos[i.seminovo ? GARANTIA_SEMINOVO_DIAS : i.garantiaDias] ||= []).push(i);
      if (Object.keys(grupos).length) {
        c.titulo('Garantia');
        for (const [dias, its] of Object.entries(grupos).sort((a, b) => b[0] - a[0])) c.kv(its.map(i => i.nome).join(', '), `${t('até')} ${fmtDate(addDays(v.data, +dias))}`);
      }
      const termos = [];
      if (v.itens.some(i => i.seminovo) && s.termosGarantiaSeminovo) termos.push(['Celulares seminovos', s.termosGarantiaSeminovo]);
      if (v.itens.some(i => !i.seminovo) && s.termosGarantiaProduto) termos.push(['Celulares novos e acessórios', s.termosGarantiaProduto]);
      if (termos.length) { c.titulo('Termos de garantia'); for (const [t, txt] of termos) { if (termos.length > 1) c.centro(t, c.F - 0.4, true); c.texto(txt); } }
      c.assinatura('Cliente — ' + (cl.nome || v.clienteNome || ''));
    });
  },

  async cupomGarantia(d) {
    const ini = d.inicio ? new Date(d.inicio) : new Date(), fim = addDays(ini, d.dias);
    return this.cupom(c => {
      c.titulo('Termo de garantia'); c.centro(d.tipo === 'venda' ? `VENDA #${d.numero}` : `OS #${d.numero}`, c.F + 3, true);
      c.centro(this.selo(d.dias), c.F + 0.6, true);
      c.centro(d.tipo === 'venda' ? 'Aparelho seminovo' : 'Serviço de reparo', c.F - 0.6);
      c.titulo('Cliente'); c.kv('Nome', d.cliente?.nome); c.kv(d.cliente?.docTipo || 'Documento', d.cliente?.doc); c.kv('Telefone', d.cliente?.telefone);
      c.titulo('Aparelho'); c.kv('Modelo', d.aparelho?.modelo); c.kv(d.aparelho?.idTipo === 'serial' ? 'Serial' : 'IMEI', d.aparelho?.imei); c.kv('Cor', d.aparelho?.cor); c.kv('Defeito', d.defeito);
      c.titulo(d.tipo === 'venda' ? 'Compra' : 'Serviço executado');
      for (const it of d.itens || []) c.par((it.qtd > 1 ? `${it.qtd}x ` : '') + it.desc, it.valor == null ? 'incluso' : money(it.valor));
      if (d.desconto) c.par('Desconto', '-' + money(d.desconto));
      c.total('TOTAL', money(d.total));
      c.kv('Pagamento', d.forma);
      c.tracejado(); c.par('Início da garantia', fmtDate(ini), c.F, true); c.par('Válida até', fmtDate(fim), c.F + 1, true);
      if (d.termos) { c.titulo('Condições da garantia'); c.texto(d.termos); }
      c.texto('Para acionar a garantia, apresente este termo junto com o aparelho na loja.');
      c.assinatura('Cliente — ' + (d.cliente?.nome || ''), d.assinaturaCliente);
      c.assinatura(d.tipo === 'venda' ? 'Loja' : 'Técnico responsável' + (d.tecnico ? ' — ' + d.tecnico : ''), d.assinaturaTecnico);
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
    const tec = s.tecnicos.find(t => t.id === o.tecnicoId);
    return {
      tipo: 'reparo', numero: o.numero, loja: { nome: s.loja, cnpj: s.cnpj, telefone: s.telefone, endereco: s.endereco, instagram: s.instagram },
      cliente: { nome: c.nome, doc: c.doc, docTipo: c.docTipo, telefone: fmtPhone(c.telefone) },
      aparelho: o.aparelho || {}, defeito: o.defeito,
      itens: [{ desc: o.servico || o.defeito || 'Serviço', valor: Store.osTotal(o) + (Number(o.desconto) || 0) }, ...(o.pecas || []).map(p => ({ desc: 'Peça: ' + p.nome, qtd: p.qtd, valor: null }))],
      desconto: Number(o.desconto) || 0, total: Store.osTotal(o), forma: FORMAS_PGTO[o.pagamento?.forma] || '',
      inicio: Store.garantiaInicio(o) || nowISO(), dias: Store.garantiaDiasOS(o), termos: s.termosGarantia,
      tecnico: tec?.nome, assinaturaTecnico: tec?.assinatura || s.assinaturaDono, assinaturaCliente: o.assinaturaCliente,
    };
  },
  // Um termo por aparelho seminovo vendido
  venda(v, item) {
    const s = Store.s, c = v.clienteId ? Store.cliente(v.clienteId) || {} : {};
    return {
      tipo: 'venda', numero: v.numero, loja: { nome: s.loja, cnpj: s.cnpj, telefone: s.telefone, endereco: s.endereco, instagram: s.instagram },
      cliente: { nome: c.nome || v.clienteNome || 'Consumidor', doc: c.doc, docTipo: c.docTipo, telefone: fmtPhone(c.telefone) },
      aparelho: { modelo: item.nome, imei: item.imei, cor: item.cor },
      itens: [{ desc: item.nome + (item.imei ? ` (IMEI ${item.imei})` : ''), qtd: item.qtd, valor: item.preco * item.qtd }],
      desconto: 0, total: item.preco * item.qtd, forma: FORMAS_PGTO[v.forma] || '',
      inicio: v.data, dias: GARANTIA_SEMINOVO_DIAS, termos: s.termosGarantiaSeminovo || s.termosGarantia,
      assinaturaTecnico: s.assinaturaDono,
    };
  },
};
