/* Etapas 3 e 4: veículos (placa, busca, carro × moto, nada de celular) e OS da oficina
   (mão de obra + peças − desconto de ponta a ponta, estoque, aprovação pelo link, PDF em 1 página). */
const { test, expect } = require('@playwright/test');
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const { vigiarErros, semRolagemLateral, emailNovo, criarContaEOficina, semearOS, api, login } = require('./ajuda.cjs');
const PRINTS = path.join(__dirname, '..', 'prints');
const shot = (page, n, info) => page.screenshot({ path: path.join(PRINTS, `etapa3-${n}-${info.project.name}.png`) });

// termos de celular que não podem aparecer em nenhuma tela do app
const PROIBIDOS = [/\bIMEI\b/i, /\bFace ID\b/i, /pel[íi]cula/i, /\bseminovo/i, /\bcapinha/i, /\bbancada\b/i, /assist[êe]ncia t[ée]cnica/i,
  /\bseu aparelho\b/i, /\bdo aparelho\b/i, /\baparelhos\b/i, /\bcelulares\b/i, /\bcelular (novo|seminovo|vendido)/i, /\bt[ée]cnico\b/i];
async function semCelular(page, onde) {
  const txt = await page.evaluate(() => {
    const vis = el => { const s = getComputedStyle(el); return s.display !== 'none' && s.visibility !== 'hidden'; };
    const out = [];
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n; while ((n = w.nextNode())) if (n.parentElement && vis(n.parentElement) && n.nodeValue.trim()) out.push(n.nodeValue.trim());
    document.querySelectorAll('[placeholder],[title],[aria-label]').forEach(e => out.push(e.getAttribute('placeholder') || '', e.getAttribute('title') || '', e.getAttribute('aria-label') || ''));
    document.querySelectorAll('option').forEach(e => out.push(e.textContent));
    return out.join('\n');
  });
  const achou = PROIBIDOS.filter(r => r.test(txt)).map(r => `${r} → "${(txt.match(r) || [])[0]}"`);
  expect(achou, `termos de celular em ${onde}`).toEqual([]);
}

test('placa: formatos, mesma placa antiga/Mercosul e busca com e sem hífen', async ({ page }) => {
  await page.goto('/');
  const r = await page.evaluate(() => ({
    norm: Placa.norm('abc-1234'), merc: Placa.valida('ABC1D23'), antiga: Placa.valida('ABC-1234'), estranha: Placa.valida('AB12345'),
    mesma: Placa.mesma('ABC1234', 'ABC1C34'), diferente: Placa.mesma('ABC1234', 'ABC1D34'), fmt: Placa.fmt('abc1234'), mask: Placa.mascarar('ABC1D23'),
    bate1: Placa.bate('abc-1d23', 'ABC1D23'), bate2: Placa.bate('ABC 1234', 'ABC1C34'), cpfOk: cpfValido('529.982.247-25'), cpfRuim: cpfValido('111.111.111-11'),
  }));
  expect(r).toEqual({ norm: 'ABC1234', merc: true, antiga: true, estranha: false, mesma: true, diferente: false, fmt: 'ABC-1234', mask: 'ABC•••3', bate1: true, bate2: true, cpfOk: true, cpfRuim: false });
});

test('veículos: busca por placa acha cliente, veículo e OS; placa repetida avisa; carro e moto mostram os campos certos; nada de celular', async ({ page }, info) => {
  const erros = vigiarErros(page);
  await criarContaEOficina(page, { email: emailNovo('veic'), oficina: 'Oficina Placa' });
  // o catálogo do tipo escolhido nasce junto com a oficina
  expect(await page.evaluate(() => ({ tipos: Store.s.tiposVeiculo, carro: Store.db.servicos.filter(s => s.tipo === 'carro').length, moto: Store.db.servicos.filter(s => s.tipo === 'moto').length })))
    .toEqual({ tipos: ['carro', 'moto'], carro: 13, moto: 10 });
  await semearOS(page);

  // clientes: busca com e sem hífen, maiúscula e minúscula
  await page.goto('/#/clientes');
  for (const q of ['ABC1D23', 'abc-1d23', 'hbx-2021', 'HBX2021']) {
    await page.fill('#cl-q', q);
    await expect(page.locator('#cl-list .item')).toHaveCount(1);
  }
  await page.fill('#cl-q', 'ABC1D23');
  await expect(page.locator('#cl-list')).toContainText('Maria Souza');
  // OS: busca por placa
  await page.goto('/#/os');
  await page.fill('#os-q', 'abc-1d23');
  await expect(page.locator('#os-list .item')).toHaveCount(1);
  await expect(page.locator('#os-list')).toContainText('Onix');
  await semCelular(page, 'lista de OS'); await semRolagemLateral(page);

  // assistente: placa já cadastrada aparece com o cliente e o veículo
  await page.goto('/#/os');
  await page.locator('.page-actions .btn.primary').click();
  await page.fill('#wz-q', 'abc1d23');
  await expect(page.locator('#wz-res [data-vei]')).toHaveCount(1);
  await expect(page.locator('#wz-res')).toContainText('Maria Souza');
  await semCelular(page, 'assistente passo 1');
  await shot(page, 'os-passo1', info);
  // novo cliente com placa repetida: avisa "placa já cadastrada em Maria Souza"
  await page.evaluate(() => closeAllModals());
  await page.evaluate(() => ClientesPage.editar());
  const form = page.locator('.modal').last();
  await form.locator('[name=placa]').fill('ABC-1D23');
  await expect(form.locator('.placa-aviso')).toContainText('Placa já cadastrada em Maria Souza');
  // a placa antiga do mesmo veículo também conta (ABC1D23 = ABC1323)
  await form.locator('[name=placa]').fill('ABC1323');
  await expect(form.locator('.placa-aviso')).toContainText('Maria Souza');
  // formato estranho avisa sem bloquear
  await form.locator('[name=placa]').fill('AB12345');
  await expect(form.locator('.placa-aviso')).toContainText('Formato de placa');
  // carro × moto: campos certos
  await form.locator('[data-vtipo=carro]').click();
  await expect(form.locator('[name=motor]')).toBeVisible(); await expect(form.locator('[name=cambio]')).toBeVisible();
  await expect(form.locator('[name=cilindrada]')).toBeHidden(); await expect(form.locator('[name=partida]')).toBeHidden();
  await form.locator('[data-vtipo=moto]').click();
  await expect(form.locator('[name=cilindrada]')).toBeVisible(); await expect(form.locator('[name=partida]')).toBeVisible(); await expect(form.locator('[name=freio]')).toBeVisible();
  await expect(form.locator('[name=motor]')).toBeHidden(); await expect(form.locator('[name=cambio]')).toBeHidden();
  await semCelular(page, 'cadastro de cliente');
  await shot(page, 'cliente-moto', info);
  await page.evaluate(() => closeAllModals());

  // telas principais sem nenhum termo de celular
  for (const r of ['dashboard', 'patio', 'os', 'clientes', 'orcamentos', 'pecas', 'vendas', 'servicos', 'posvenda', 'metas', 'relatorios', 'config']) {
    await page.goto('/#/' + r); await page.waitForTimeout(150);
    await semCelular(page, r);
    if (info.project.name === 'celular') await semRolagemLateral(page);
  }
  await page.goto('/#/patio'); await shot(page, 'patio', info);
  expect(erros).toEqual([]);
});

test('OS: assistente em 4 passos, mão de obra + peças − desconto de ponta a ponta, estoque e aprovação pelo link', async ({ page }, info) => {
  test.skip(info.project.name !== 'celular', 'uma vez basta');
  const erros = vigiarErros(page);
  const conta = { email: emailNovo('os'), oficina: 'Oficina Itens' };
  await criarContaEOficina(page, conta);
  // peça no estoque (10 un.) e cliente com uma moto
  await page.evaluate(() => {
    Store.db.pecas.push({ id: 'pc1', nome: 'Pastilha de freio dianteira', codigo: '789100', qtd: 10, minimo: 2, custo: 40, preco: 90, unidade: 'un', aplicacao: 'CG 160' });
    const c = Store.saveCliente({ nome: 'Pedro Alves', telefone: '48999990000', veiculos: [{ id: 'v1', tipo: 'moto', placa: 'MOT1A23', marca: 'Honda', modelo: 'CG 160 Fan', anoModelo: '2021', km: 12000 }] });
    Store.save(); return c.id;
  });
  // passo 1: placa
  await page.goto('/#/os');
  await page.locator('.page-actions .btn.primary').click();
  await page.fill('#wz-q', 'mot1a23');
  await page.locator('#wz-res [data-vei]').click();
  // passo 3: entrada (km, combustível, checklist de moto)
  await expect(page.locator('#ck')).toContainText('Relação (coroa, pinhão, corrente)');
  await expect(page.locator('#ck')).not.toContainText('Para-brisa');
  await page.fill('[name=kmEntrada]', '12500');
  await page.locator('[data-comb="1/4"]').click();
  await page.locator('[data-ck="Freio dianteiro"][data-v=nok]').click();
  await page.locator('[data-ck="Pneus"][data-v=ok]').click();
  await shot(page, 'os-entrada', info);
  await page.locator('#wz-next').click();
  // passo 4: serviços e peças
  await page.fill('[name=defeito]', 'Freio dianteiro fraco');
  await page.locator('[data-it-cat]').selectOption({ label: 'Pastilhas / lonas de freio' });
  await page.locator('[data-it-lista=servico] [data-f=valor]').first().fill('80,00');
  await page.fill('[data-it-q]', 'pastilha');
  await page.locator('[data-pc=pc1]').click();
  await page.locator('[data-it-lista=peca] [data-f=qtd]').first().fill('2');
  await page.fill('[data-it-desc]', '10,00');
  await expect(page.locator('[data-it-total]')).toHaveText('R$ 250,00');   // 80 + 2×90 − 10
  await page.locator('[name=pedirAprovacao]').check();
  await shot(page, 'os-itens', info);
  await page.locator('#wz-save').click();
  await expect(page.locator('.modal')).toContainText('OS #1 criada');
  await page.evaluate(() => closeAllModals());
  const o = await page.evaluate(() => { const o = Store.db.os[0]; return { status: o.status, total: Store.osTotal(o), valor: o.valor, mo: o.maoDeObra, pecas: o.totalPecas, estoque: Store.peca('pc1').qtd, km: o.kmEntrada, comb: o.nivelCombustivel, ck: o.checklist, itensCk: o.checklistItens.length, gk: o.garantiaKm }; });
  expect(o).toMatchObject({ status: 'aprovacao', total: 250, valor: 250, mo: 80, pecas: 180, estoque: 8, km: 12500, comb: '1/4', ck: { 'Freio dianteiro': 'nok', 'Pneus': 'ok' }, itensCk: 14, gk: 3000 });

  // peça sai da OS: volta ao estoque
  await page.evaluate(() => { const o = Store.db.os[0]; const antes = o.itensPeca; o.itensPeca = []; OSItens.baixarEstoque(o, antes); Store.saveOS(o); });
  expect(await page.evaluate(() => Store.peca('pc1').qtd)).toBe(10);
  await page.evaluate(() => { const o = Store.db.os[0]; OSPage.lancarPeca(o, Store.peca('pc1'), 2); });
  expect(await page.evaluate(() => [Store.peca('pc1').qtd, Store.osTotal(Store.db.os[0])])).toEqual([8, 250]);

  // PDF da OS sem fotos: 1 página, com placa
  const b64 = await page.evaluate(async () => { const o = Store.db.os[0]; return (await Pdf.ordem(o)).output('datauristring').split(',')[1]; });
  const arq = path.join(PRINTS, 'etapa3-os.pdf'); fs.writeFileSync(arq, Buffer.from(b64, 'base64'));
  expect(Number(/Pages:\s+(\d+)/.exec(execFileSync('pdfinfo', [arq]).toString())[1]), 'PDF da OS sem fotos em 1 página').toBe(1);
  const txtPdf = execFileSync('pdftotext', [arq, '-']).toString();
  expect(txtPdf).toContain('MOT1A23'); expect(txtPdf).toContain('R$ 250,00'); expect(txtPdf).toMatch(/abandonad/);
  execFileSync('pdftoppm', ['-png', '-r', '80', '-singlefile', arq, path.join(PRINTS, 'etapa3-pdf-os')]);

  // link do cliente: placa mascarada, primeiro nome, itens e total; aprovar move a OS
  const tok = await login(conta.email);
  const token = await page.evaluate(() => Store.tokenOS(Store.db.os[0]));
  await expect.poll(async () => (await api(`/rest/v1/itens?select=dados&colecao=eq.os`, { token: tok })).dados?.[0]?.dados?.token, { timeout: 15000 }).toBe(token);
  const pub = await page.context().newPage(); const errosPub = vigiarErros(pub);
  await pub.goto(`/acompanhar/${token}`);
  await expect(pub.locator('#track')).toContainText('MOT•••3');
  await expect(pub.locator('#track')).toContainText('Pedro');
  await expect(pub.locator('#track')).not.toContainText('Alves');
  await expect(pub.locator('#track')).not.toContainText('48999990000');
  await expect(pub.locator('#track')).toContainText('R$ 250,00');
  await semCelular(pub, 'link do cliente'); await semRolagemLateral(pub);
  await pub.screenshot({ path: path.join(PRINTS, 'etapa3-link-cliente-celular.png'), fullPage: true });
  // o banco não devolve nada pessoal
  const pubDados = await api('/rest/v1/rpc/acompanhar_os', { method: 'POST', body: { p_token: token } });
  const json = JSON.stringify(pubDados.dados);
  expect(json).not.toMatch(/MOT1A23|48999990000|Alves|assinatura|custo/);
  await pub.locator('#t-aprovar').click();
  await expect(pub.locator('#track')).toContainText('Em serviço');
  await expect.poll(() => page.evaluate(() => Store.db.os[0].status), { timeout: 15000 }).toBe('servico');
  expect(errosPub).toEqual([]);

  // pagamento: o financeiro recebe mão de obra e peças separados
  await page.evaluate(() => { const o = Store.db.os[0]; Store.setOSStatus(o, 'pago', { forma: 'pix' }); });
  const l = await page.evaluate(() => Store.db.lancamentos.find(x => x.origem === 'os'));
  expect(l).toMatchObject({ valor: 250 });
  expect(Math.round((l.maoDeObra + l.pecas) * 100) / 100).toBe(250);
  // OS paga nunca aparece como atrasada
  expect(await page.evaluate(() => { const o = Store.db.os[0]; o.previsao = '2020-01-01'; return Store.osAtrasada(o); })).toBe(false);
  expect(erros).toEqual([]);
});
