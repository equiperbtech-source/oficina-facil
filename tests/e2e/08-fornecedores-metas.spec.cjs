/* Etapa 6: cotação com o veículo, XML com quantidade decimal, parcelas Serviços × Balcão e metas por mecânico. */
const { test, expect } = require('@playwright/test');
const path = require('path');
const { vigiarErros, emailNovo, criarContaEOficina, semRolagemLateral } = require('./ajuda.cjs');
const PRINTS = path.join(__dirname, '..', 'prints');

const XML = `<?xml version="1.0"?><nfeProc xmlns="http://www.portalfiscal.inf.br/nfe"><NFe><infNFe Id="NFe42251112345678000199550010000012341000012345" versao="4.00">
<ide><nNF>1234</nNF><serie>1</serie><dhEmi>2025-11-01T10:00:00-03:00</dhEmi></ide><emit><CNPJ>12345678000199</CNPJ><xNome>Distribuidora Auto Peças LTDA</xNome></emit>
<det nItem="1"><prod><cProd>OL5W30</cProd><cEAN>7891234567895</cEAN><xProd>OLEO 5W30 SINTETICO</xProd><NCM>27101932</NCM><uCom>L</uCom><qCom>4.5000</qCom><vUnCom>38.00</vUnCom><vProd>171.00</vProd></prod></det>
<det nItem="2"><prod><cProd>FO123</cProd><cEAN>SEM GTIN</cEAN><xProd>FILTRO DE OLEO</xProd><uCom>UN</uCom><qCom>2.0000</qCom><vUnCom>25.00</vUnCom><vProd>50.00</vProd></prod></det>
<total><ICMSTot><vNF>221.00</vNF></ICMSTot></total></infNFe></NFe></nfeProc>`;

test('cotação leva marca, modelo e ano; XML com decimal; parcelas separadas; metas por mecânico', async ({ page }, info) => {
  test.skip(info.project.name !== 'celular', 'uma vez basta');
  const erros = vigiarErros(page);
  await criarContaEOficina(page, { email: emailNovo('forn'), oficina: 'Oficina Forn' });

  // cotação: a mensagem já leva o veículo (carro e moto)
  const msgs = await page.evaluate(() => {
    Store.db.fornecedores.push({ id: 'f1', nome: 'Auto Peças Sul', whatsapp: '48999991234', cnpj: '12.345.678/0001-99', vendedor: 'Rafa', prazo: 'mesmo dia' }); Store.save();
    const abrir = v => { Cotacao.abrir('cotacao', { veiculo: v }); const el = document.querySelector('.modal:last-of-type') || [...document.querySelectorAll('.modal')].pop();
      const inp = el.querySelector('#ct-livre'); inp.value = 'pastilha de freio dianteira'; inp.dispatchEvent(new Event('input')); const m = el.querySelector('#ct-msg').textContent; closeAllModals(); return m; };
    return [abrir({ tipo: 'carro', marca: 'Chevrolet', modelo: 'Onix', motor: '1.0', anoModelo: '2019' }), abrir({ tipo: 'moto', marca: 'Honda', modelo: 'CG 160 Fan', anoModelo: '2021' })];
  });
  expect(msgs[0]).toBe('Olá! Qual o valor da pastilha de freio dianteira do Onix 1.0 2019?');
  expect(msgs[1]).toMatch(/pastilha de freio dianteira do CG 160 Fan .*2021\?/);
  // pedido ao fornecedor fica no histórico
  await page.evaluate(() => Cotacao.registrar(Cotacao.fornecedores()[0], 'pedido', [{ nome: 'Pastilha', qtd: 2 }]));
  expect(await page.evaluate(() => Pages.fornecedor.compras(Store.db.fornecedores[0]).length)).toBe(1);
  await page.goto('/#/fornecedor'); await semRolagemLateral(page);
  await page.screenshot({ path: path.join(PRINTS, 'etapa6-fornecedores-celular.png') });

  // XML da NF-e com quantidade decimal (óleo em litro)
  const nf = await page.evaluate(x => NFe.ler(x), XML);
  expect(nf.itens.map(i => [i.qtd, i.unidade, i.custo])).toEqual([[4.5, 'L', 38], [2, 'UN', 25]]);
  await page.evaluate(() => { const p = { id: 'po', nome: 'Óleo 5W30', qtd: 0, unidade: 'L', custo: 38 }; Store.db.pecas.push(p); Store.movimentar('peca', p, 4.5, 'NF'); Store.movimentar('peca', p, -0.75, 'OS'); Store.save(); });
  expect(await page.evaluate(() => [Store.peca('po').qtd, fmtQtd(Store.peca('po').qtd)])).toEqual([3.75, '3,75']);

  // parcelas: taxa diferente para Serviços (OS) e Peças (balcão)
  const tx = await page.evaluate(() => {
    Store.s.parcelas = { os: { semJurosAte: 3, max: 6, taxas: { 1: 3, 3: 6 } }, balcao: { semJurosAte: 2, max: 6, taxas: { 1: 4, 3: 9 } } }; Store.save();
    return { os3: Store.taxa('credito', 100, 3, 'os'), balcao3: Store.taxa('credito', 100, 3, 'balcao'), deb: Store.taxa('debito', 100) };
  });
  expect(tx).toEqual({ os3: 6, balcao3: 9, deb: 1.5 });
  // venda no balcão em 3x usa a taxa do balcão; OS em 3x usa a dos serviços
  const lanc = await page.evaluate(() => {
    const v = VendasPage.registrar({ itens: [{ id: 'x', avulso: true, nome: 'Palheta', preco: 100, custo: 40, qtd: 1 }], forma: 'credito', parcelas: 3 });
    const c = Store.saveCliente({ nome: 'Ana', veiculos: [] });
    const o = Store.saveOS({ clienteId: c.id, veiculo: { tipo: 'carro', modelo: 'Gol' }, defeito: 'x', status: 'concluido', itensServico: [{ id: 's', nome: 'Revisão', qtd: 1, valor: 100 }], itensPeca: [] });
    Store.setOSStatus(o, 'pago', { forma: 'credito', parcelas: 3 });
    const l = Store.db.lancamentos;
    return { venda: l.find(x => x.origem === 'venda').taxa, os: l.find(x => x.origem === 'os').taxa };
  });
  expect(lanc).toEqual({ venda: 9, os: 6 });

  // metas: OS conta para o mecânico escolhido; sem mecânico (ou mecânico que não existe) conta para a oficina
  const metas = await page.evaluate(() => {
    Store.s.tecnicos = [{ id: 'm1', nome: 'Beto' }, { id: 'm2', nome: 'Caio' }]; Store.save();
    const c = Store.saveCliente({ nome: 'Rui', veiculos: [] });
    const mk = mec => { const o = Store.saveOS({ clienteId: c.id, veiculo: { tipo: 'carro', modelo: 'Uno' }, defeito: 'x', status: 'analise', mecanicoId: mec, itensServico: [{ id: uid(), nome: 'Freio', qtd: 1, valor: 50 }], itensPeca: [] }); Store.setOSStatus(o, 'concluido'); return o; };
    mk('m1'); mk('m1'); mk(null); mk('fantasma');
    // direto para "Pago" também conta
    const o = Store.saveOS({ clienteId: c.id, veiculo: { tipo: 'carro', modelo: 'Uno' }, defeito: 'x', status: 'analise', mecanicoId: 'm2', itensServico: [{ id: uid(), nome: 'Óleo', qtd: 1, valor: 80 }], itensPeca: [] });
    Store.setOSStatus(o, 'pago', { forma: 'pix' });
    const n = Metas.numeros(monthKey());
    return { m1: n.por.m1.os, m2: n.por.m2.os, oficina: n.por.oficina.os, moM2: n.por.m2.maoDeObra, fantasma: 'fantasma' in n.por };
  });
  expect(metas).toEqual({ m1: 2, m2: 1, oficina: 3, moM2: 80, fantasma: false });   // oficina: sem mecânico + fantasma + a OS paga da Ana (sem mecânico)
  await page.goto('/#/metas'); await page.locator('#mt-abas button[data-k=mecanicos]').click();
  await expect(page.locator('#mt-corpo')).toContainText('Beto');
  await page.screenshot({ path: path.join(PRINTS, 'etapa6-metas-celular.png') });
  expect(erros).toEqual([]);
});
