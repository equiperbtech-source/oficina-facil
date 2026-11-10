/* Etapa 5: tela do mecânico (fotos e peças rápidas, fila sem internet), sem custo para o mecânico, CSV e revisão. */
const { test, expect } = require('@playwright/test');
const path = require('path');
const { vigiarErros, emailNovo, criarContaEOficina, semearOS } = require('./ajuda.cjs');
const PRINTS = path.join(__dirname, '..', 'prints');
// JPEG pequeno de verdade (1×1) para as fotos
const JPG = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64');
let JPG_REAL = null;   // uma foto de verdade (print da tela em JPEG)
const foto = n => ({ name: `f${n}.jpg`, mimeType: 'image/jpeg', buffer: JPG_REAL || JPG });

test('mecânico: abrir OS, 5 fotos e 3 peças em menos de 30 s; fotos sem internet sobem quando a conexão volta', async ({ page, context }, info) => {
  test.skip(info.project.name !== 'celular', 'no celular');
  const erros = vigiarErros(page).filter(e => !/net::ERR_INTERNET_DISCONNECTED|Failed to fetch/i.test(e));
  await criarContaEOficina(page, { email: emailNovo('mec'), oficina: 'Oficina Rápida' });
  await page.evaluate(() => {
    for (const [i, n] of ['Óleo 5W30', 'Filtro de óleo', 'Filtro de ar'].entries()) Store.db.pecas.push({ id: 'p' + i, nome: n, codigo: '78900' + i, qtd: 20, minimo: 2, custo: 10, preco: 30, unidade: 'un' });
    Store.saveCliente({ nome: 'Lia Rocha', telefone: '48988880000', veiculos: [{ id: 'v1', tipo: 'carro', placa: 'RAP1D00', marca: 'Fiat', modelo: 'Argo', anoModelo: '2022' }] });
  });
  JPG_REAL = await page.screenshot({ type: 'jpeg', quality: 50, clip: { x: 0, y: 0, width: 120, height: 90 } });
  const t0 = Date.now();
  // abrir a OS pelo assistente (placa → entrada → serviço)
  await page.goto('/#/os');
  await page.locator('.page-actions .btn.primary').click();
  await page.fill('#wz-q', 'RAP1D00'); await page.locator('#wz-res [data-vei]').click();
  await page.locator('#wz-next').click();
  await page.fill('[name=defeito]', 'Revisão'); await page.locator('#wz-save').click();
  await page.evaluate(() => closeAllModals());
  // tela do mecânico: 5 fotos e 3 peças
  await page.goto('/#/mecanico');
  await page.locator('[data-mc-fotos]').first().setInputFiles([1, 2, 3, 4, 5].map(foto));
  for (const nome of ['789000', '789001', '789002']) {
    await page.locator('[data-mc-peca]').first().click();
    await page.fill('#mp-q', nome);
    await page.locator('#mp-res [data-p]').first().click();
    await page.evaluate(() => closeAllModals());
  }
  await expect.poll(() => page.evaluate(() => (Store.db.os[0].fotos || []).length), { timeout: 20000 }).toBe(5);
  expect(await page.evaluate(() => Store.db.os[0].itensPeca.length)).toBe(3);
  expect(Date.now() - t0, 'abrir OS + 5 fotos + 3 peças').toBeLessThan(30000);
  await page.goto('/#/mecanico'); await page.screenshot({ path: path.join(PRINTS, 'etapa5-mecanico-celular.png') });

  // sem internet: as fotos ficam na fila do celular e sobem quando a conexão volta
  await context.setOffline(true);
  await page.locator('[data-mc-fotos]').first().setInputFiles([6, 7].map(foto));
  await page.waitForTimeout(800);
  expect(await page.evaluate(() => FilaFotos.pendentes())).toBe(2);
  expect(await page.evaluate(() => Store.db.os[0].fotos.length)).toBe(5);
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect.poll(() => page.evaluate(() => Store.db.os[0].fotos.length), { timeout: 20000 }).toBe(7);
  expect(await page.evaluate(() => FilaFotos.pendentes())).toBe(0);
  // fotos nunca no localStorage
  expect(await page.evaluate(() => /data:image|blob:/.test(JSON.stringify(localStorage)))).toBe(false);
  expect(erros.filter(e => !/net::|Failed to fetch|ERR_INTERNET/i.test(e))).toEqual([]);
});

test('mecânico não vê custo, lucro nem financeiro em nenhuma tela', async ({ page }, info) => {
  test.skip(info.project.name !== 'celular', 'uma vez basta');
  await criarContaEOficina(page, { email: emailNovo('semcusto'), oficina: 'Oficina Custo' });
  const os = await semearOS(page);
  await page.evaluate(() => { Store.db.pecas.push({ id: 'pz', nome: 'Pastilha', qtd: 5, custo: 41.11, preco: 90 }); Store.save(); Cloud.papel = () => 'tecnico'; Cloud.ehDono = () => false; $('.shell')?.remove(); App.render(); });
  const proibido = /\bcusto\b|\blucro\b|R\$\s?41,11/i;
  for (const r of ['mecanico', 'dashboard', 'patio', 'os', 'clientes', 'orcamentos', 'pecas', 'metas']) {
    await page.goto('/#/' + r); await page.waitForTimeout(150);
    const txt = await page.locator('#main').innerText();
    expect(txt, `custo em ${r}`).not.toMatch(proibido);
  }
  for (const r of ['financeiro', 'caixa', 'relatorios', 'vendas']) { await page.goto('/#/' + r); await page.waitForTimeout(100); expect(await page.evaluate(() => App.route)).not.toBe(r); }
  await page.evaluate(id => OSPage.detalhe(id), os.id);
  expect(await page.locator('.modal').last().innerText()).not.toMatch(proibido);
  await page.evaluate(id => OSPage.editarItens(Store.osById(id)), os.id);
  expect(await page.locator('.modal').last().innerText()).not.toMatch(proibido);
});

test('CSV de clientes e veículos; próxima revisão gera lembrete com WhatsApp', async ({ page }, info) => {
  test.skip(info.project.name !== 'celular', 'uma vez basta');
  await criarContaEOficina(page, { email: emailNovo('csv'), oficina: 'Oficina CSV' });
  const r = await page.evaluate(() => ImportarCSV.importar(ImportarCSV.ler('nome;telefone;cpf;placa;marca;modelo;ano\nJosé Lima;48 99999-1111;529.982.247-25;ABC-1234;Fiat;Uno;2010\nJosé Lima;48999991111;;MOT9Z99;Honda;Biz;2018\nRita;48977770000;;ABC1C34;VW;Gol;2012')));
  expect(r).toEqual({ novos: 2, veics: 2, repetidas: 1 });   // mesma placa antiga/Mercosul não duplica
  expect(await page.evaluate(() => Store.clientesAtivos().find(c => c.nome === 'José Lima').veiculos.length)).toBe(2);
  // revisão: só km, sem histórico → usa o prazo padrão; vencida hoje aparece no pós-venda
  const lemb = await page.evaluate(() => {
    const c = Store.clientesAtivos()[0], v = c.veiculos[0];
    const o = Store.saveOS({ clienteId: c.id, veiculo: { ...v }, defeito: 'x', status: 'pago', pagoEm: nowISO(), kmEntrada: 50000, proximaRevisao: { data: dayKey(), km: 60000 } });
    return Revisao.lembretes(7).map(x => ({ id: x.o.id, hoje: x.hoje, msg: Revisao.mensagem(x) }))[0];
  });
  expect(lemb.hoje).toBe(true);
  expect(lemb.msg).toContain('ABC-1234');
  expect(lemb.msg).toContain('60.000 km');
});
