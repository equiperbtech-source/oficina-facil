/* Etapa 7: personalização. Cor clara recusada; mudar etapa/checklist não altera OS antigas; mensagens com variáveis;
   liga/desliga; dois dispositivos editando as configurações ao mesmo tempo não perdem nada. */
const { test, expect } = require('@playwright/test');
const path = require('path');
const { vigiarErros, emailNovo, criarContaEOficina, entrar } = require('./ajuda.cjs');
const PRINTS = path.join(__dirname, '..', 'prints');

test('personalização: cor clara recusada, OS antigas não mudam, mensagens e liga/desliga', async ({ page }, info) => {
  test.skip(info.project.name !== 'celular', 'uma vez basta');
  const erros = vigiarErros(page);
  await criarContaEOficina(page, { email: emailNovo('pers'), oficina: 'Oficina Pers', tipos: 'moto' });
  // só moto: o formulário não oferece carro
  expect(await page.evaluate(() => Veiculo.tipos())).toEqual(['moto']);
  // cor clara demais: recusada com explicação; fundo sempre branco
  const v = await page.evaluate(() => Tema.validar({ cor_primaria: '#FDE047', cor_secundaria: '#FACC15', cor_fundo: '#FFFFFF' }));
  expect(v.ok).toBe(false); expect(v.problemas.join(' ')).toMatch(/contraste/);

  // OS antiga guarda a lista e o nome da etapa; mudar o checklist e renomear a etapa não altera a OS antiga
  const r = await page.evaluate(() => {
    const c = Store.saveCliente({ nome: 'Ana', veiculos: [] });
    const o = Store.saveOS({ clienteId: c.id, veiculo: { tipo: 'moto', modelo: 'Biz' }, defeito: 'x', status: 'peca', checklistItens: Checklist.itens('moto'), checklist: { 'Buzina': 'ok' } });
    const antes = Checklist.daOS(o).length;
    Store.s.checklist = { moto: ['Só um item'] }; Store.save();
    Etapas.salvar(e => { e.nomes = { peca: 'Esperando peça' }; });
    return { antes, depois: Checklist.daOS(Store.osById(o.id)).length, nova: Checklist.itens('moto'), etapa: OS_STATUS.peca.label, temBuzina: Checklist.daOS(Store.osById(o.id)).includes('Buzina') };
  });
  expect(r).toEqual({ antes: 14, depois: 14, nova: ['Só um item'], etapa: 'Esperando peça', temBuzina: true });

  // mensagem personalizada com variáveis; resumo da garantia liga/desliga
  const m = await page.evaluate(() => {
    const o = PersonalizarOficina.exemplo(), c = { nome: 'Maria Souza' };
    const padrao = OSPage.msgPronto(o, c);
    Store.s.whatsResumoGarantia = false; const semGarantia = OSPage.msgPronto(o, c);
    Store.s.msgs = { pronto: 'Oi {cliente}, a {veiculo} ({placa}) da {oficina} saiu! {total}' };
    const pers = OSPage.msgPronto(o, c);
    Store.s.whatsResumoGarantia = true; Store.s.msgs = {}; Store.save();
    return { padrao, semGarantia, pers };
  });
  expect(m.padrao).toMatch(/Garantia: \*3 meses ou 5\.000 km/);
  expect(m.semGarantia).not.toMatch(/Garantia/);
  expect(m.semGarantia).toMatch(/pronto para retirada/);
  expect(m.pers.replace(/\u00a0/g, ' ')).toBe('Oi Maria, a Onix 2019 (ABC1D23) da Oficina Pers saiu! R$ 300,00');   // oficina só de moto: exemplo sem motor
  // previsão desligada: some da OS
  expect(await page.evaluate(() => { Store.s.usarPrevisao = false; const o = { status: 'analise', previsao: '2020-01-01' }; const a = Store.osAtrasada(o); Store.s.usarPrevisao = true; return a; })).toBe(false);

  await page.goto('/#/config'); await page.evaluate(() => Pages.config.abrirTopico('cf-oficina'));
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(PRINTS, 'etapa7-aparencia-celular.png'), fullPage: false });
  expect(erros).toEqual([]);
});

test('dois dispositivos mudam configurações diferentes ao mesmo tempo e nada se perde', async ({ browser }, info) => {
  test.skip(info.project.name !== 'celular', 'uma vez basta');
  const conta = { email: emailNovo('dois'), oficina: 'Oficina Dois' };
  const a = await (await browser.newContext()).newPage();
  await criarContaEOficina(a, conta);
  const b = await (await browser.newContext()).newPage();
  await entrar(b, conta);
  await a.waitForTimeout(1500);
  await a.evaluate(() => { Store.s.checklist = { carro: ['Item do A'] }; Store.save(); });
  await b.evaluate(() => { Store.s.msgs = { pronto: 'Mensagem do B' }; Store.s.usarPrevisao = false; Store.save(); });
  const ler = p => p.evaluate(() => ({ ck: Store.s.checklist?.carro, msg: Store.s.msgs?.pronto, prev: Store.s.usarPrevisao }));
  const esperado = { ck: ['Item do A'], msg: 'Mensagem do B', prev: false };
  await expect.poll(() => ler(a), { timeout: 30000 }).toEqual(esperado);
  await expect.poll(() => ler(b), { timeout: 30000 }).toEqual(esperado);
  await a.reload(); await expect(a.locator('#main')).toBeVisible();
  await expect.poll(() => ler(a), { timeout: 30000 }).toEqual(esperado);
});
