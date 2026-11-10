/* Importar XML (NF-e): no topo, escolher se os itens vão para as peças da oficina ou para os produtos do balcão.
   A escolha espelha para todos os itens e dá para trocar item por item (nota com peças e produtos juntos). */
const { test, expect } = require('@playwright/test');
const path = require('path');
const { vigiarErros, emailNovo, criarContaEOficina, semRolagemLateral } = require('./ajuda.cjs');
const PRINTS = path.join(__dirname, '..', 'prints');

const xml = (nNF, chave) => `<?xml version="1.0"?><nfeProc xmlns="http://www.portalfiscal.inf.br/nfe"><NFe><infNFe Id="NFe${chave}" versao="4.00">
<ide><nNF>${nNF}</nNF><serie>1</serie><dhEmi>2025-11-01T10:00:00-03:00</dhEmi></ide><emit><CNPJ>12345678000199</CNPJ><xNome>Distribuidora Auto Peças LTDA</xNome></emit>
<det nItem="1"><prod><cProd>OL5W30</cProd><cEAN>7891234567895</cEAN><xProd>OLEO 5W30 SINTETICO</xProd><uCom>L</uCom><qCom>4.0000</qCom><vUnCom>38.00</vUnCom><vProd>152.00</vProd></prod></det>
<det nItem="2"><prod><cProd>PAST01</cProd><cEAN>7890000000017</cEAN><xProd>PASTILHA DE FREIO DIANTEIRA</xProd><uCom>JG</uCom><qCom>2.0000</qCom><vUnCom>45.00</vUnCom><vProd>90.00</vProd></prod></det>
<total><ICMSTot><vNF>242.00</vNF></ICMSTot></total></infNFe></NFe></nfeProc>`;

test('XML: escolha no topo espelha para todos os itens e dá para trocar item por item', async ({ page }, info) => {
  test.skip(info.project.name !== 'celular', 'no celular');
  const erros = vigiarErros(page);
  await criarContaEOficina(page, { email: emailNovo('xmldest'), oficina: 'Oficina e Loja', tipos: 'moto' });
  const modal = page.locator('.modal').last();
  const modoOn = () => modal.locator('.nf-modo.on').getAttribute('data-modo');
  const ondeOn = i => modal.locator(`[data-linha="${i}"] .nf-onde button.on`).textContent();

  // 1ª nota: nada cadastrado ainda; o padrão é "Peças da oficina"
  await page.evaluate(x => NFe.previa(NFe.ler(x)), xml(501, '42251112345678000199550010000005011000005011'));
  await expect(modal).toContainText('Para onde vão os itens desta nota?');
  expect(await modoOn()).toBe('peca');
  await expect(modal.locator('#nf-resumo')).toHaveText('2 na oficina · 0 no balcão');
  // "Produtos do balcão" no topo: espelha para os 2 itens
  await modal.locator('[data-modo=balcao]').click();
  expect([await ondeOn(0), await ondeOn(1)]).toEqual(['Balcão', 'Balcão']);
  await expect(modal.locator('#nf-resumo')).toHaveText('0 na oficina · 2 no balcão');
  await expect(modal.locator('[data-dest="0"] option[value=novo]')).toHaveText(/produto novo do balcão/);
  // item por item: a pastilha fica só na oficina; o topo passa para "Item por item"
  await modal.locator('[data-onde="1:peca"]').click();
  expect(await modoOn()).toBe('misto');
  expect([await ondeOn(0), await ondeOn(1)]).toEqual(['Balcão', 'Oficina']);
  await expect(modal.locator('#nf-resumo')).toHaveText('1 na oficina · 1 no balcão');
  await semRolagemLateral(page);
  await modal.locator('.nf-destino').scrollIntoViewIfNeeded(); await page.evaluate(() => document.querySelectorAll('.toast').forEach(t => t.remove()));
  await page.screenshot({ path: path.join(PRINTS, 'xml-destino-celular.png') });
  await modal.locator('#nf-ok').click();
  await expect(page.locator('.toast').last()).toContainText('1 na oficina, 1 no balcão');
  let r = await page.evaluate(() => Store.db.pecas.filter(p => !p.deleted).map(p => [p.nome, !!p.balcao, p.qtd]).sort());
  expect(r).toEqual([['OLEO 5W30 SINTETICO', true, 4], ['PASTILHA DE FREIO DIANTEIRA', false, 2]]);
  // o balcão vende só o óleo
  expect(await page.evaluate(() => Store.db.pecas.filter(p => !p.deleted && p.balcao).map(p => p.nome))).toEqual(['OLEO 5W30 SINTETICO']);

  // 2ª nota com os mesmos itens: soma nos cadastros; cada item já vem com o lugar onde está
  await page.evaluate(x => NFe.previa(NFe.ler(x)), xml(502, '42251112345678000199550010000005021000005021'));
  expect(await modoOn()).toBe('misto');
  expect([await ondeOn(0), await ondeOn(1)]).toEqual(['Balcão', 'Oficina']);
  await expect(modal.locator('[data-dest="0"]')).toHaveValue(/^peca:/);
  // "Produtos do balcão" no topo: a pastilha também passa a vender no balcão
  await modal.locator('[data-modo=balcao]').click();
  expect(await modoOn()).toBe('balcao');
  await modal.locator('#nf-ok').click();
  await expect(page.locator('.toast').last()).toContainText('0 na oficina, 2 no balcão');
  r = await page.evaluate(() => Store.db.pecas.filter(p => !p.deleted).map(p => [p.nome, !!p.balcao, p.qtd]).sort());
  expect(r).toEqual([['OLEO 5W30 SINTETICO', true, 8], ['PASTILHA DE FREIO DIANTEIRA', true, 4]]);
  // a escolha fica lembrada para a próxima nota
  expect(await page.evaluate(() => Store.s.nfeDestino)).toBe('balcao');
  expect(erros).toEqual([]);
});

test('XML: "Peças da oficina" leva para a oficina até o item que somava num produto antigo do balcão', async ({ page }, info) => {
  test.skip(info.project.name !== 'celular', 'no celular');
  const erros = vigiarErros(page);
  await criarContaEOficina(page, { email: emailNovo('xmlprod'), oficina: 'Oficina Produto', tipos: 'moto' });
  // um produto antigo do balcão (importação de antes) com o mesmo EAN do óleo
  await page.evaluate(() => { Store.db.produtos.push({ id: 'prod-oleo', nome: 'Óleo 5W30 (produto)', codigo: '7891234567895', qtd: 1, preco: 50, custo: 38 }); Store.save(); });
  const modal = page.locator('.modal').last();
  const modoOn = () => modal.locator('.nf-modo.on').getAttribute('data-modo');
  await page.evaluate(x => NFe.previa(NFe.ler(x)), xml(601, '42251112345678000199550010000006011000006011'));
  expect(await modoOn()).toBe('misto');
  await expect(modal.locator('#nf-resumo')).toHaveText('1 na oficina · 1 no balcão');
  await expect(modal.locator('[data-dest="0"]')).toHaveValue('produto:prod-oleo');
  // toque em "Peças da oficina": todos vão para a oficina (o óleo vira peça nova)
  await modal.locator('[data-modo=peca]').tap();
  expect(await modoOn()).toBe('peca');
  await expect(modal.locator('#nf-resumo')).toHaveText('2 na oficina · 0 no balcão');
  await expect(modal.locator('[data-dest="0"]')).toHaveValue('novo');
  // e volta para o balcão: o óleo continua como peça nova, agora no balcão
  await modal.locator('[data-modo=balcao]').tap();
  expect(await modoOn()).toBe('balcao');
  await modal.locator('[data-modo=peca]').tap();
  expect(await modoOn()).toBe('peca');
  // no item: "Oficina" também tira do produto antigo
  await page.evaluate(() => closeAllModals());
  await page.evaluate(x => NFe.previa(NFe.ler(x)), xml(602, '42251112345678000199550010000006021000006021'));
  await modal.locator('[data-onde="0:peca"]').tap();
  await expect(modal.locator('[data-dest="0"]')).toHaveValue('novo');
  await expect(modal.locator('#nf-resumo')).toHaveText('2 na oficina · 0 no balcão');
  await modal.locator('#nf-ok').tap();
  await expect(page.locator('.toast').last()).toContainText('2 na oficina, 0 no balcão');
  const r = await page.evaluate(() => ({ pecas: Store.db.pecas.filter(p => !p.deleted).map(p => [p.nome, !!p.balcao]).sort(), prod: Store.produto('prod-oleo').qtd }));
  expect(r).toEqual({ pecas: [['OLEO 5W30 SINTETICO', false], ['PASTILHA DE FREIO DIANTEIRA', false]], prod: 1 });
  expect(erros).toEqual([]);
});
