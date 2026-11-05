/* Armadilhas que já aconteceram no sistema original (seção 12 do documento). */
const { test, expect } = require('@playwright/test');
const { vigiarErros, emailNovo, criarContaEOficina } = require('./ajuda.cjs');

test('WhatsApp: número de outro país sem "+" não ganha o 55 do Brasil', async ({ page }) => {
  await page.goto('/');
  const r = await page.evaluate(() => {
    Moeda.fixa = 'BRL';   // oficina do Brasil
    const br = {
      celularComDDD: foneWhats('(48) 99115-4821'), fixoComDDD: foneWhats('48 3333-4444'), comMais: foneWhats('+55 48 99115-4821'),
      jaCom55: foneWhats('5548991154821'), chileSemMais: foneWhats('56912345678'), chileComMais: foneWhats('+56 9 1234 5678'),
      portugalSemMais: foneWhats('351912345678'), com00: foneWhats('0056912345678'), curto: foneWhats('12345'), vazio: foneWhats(''),
    };
    Moeda.fixa = 'CLP';   // oficina de fora do Brasil: nunca põe 55
    const cl = { localChile: foneWhats('912345678'), pareceBR: foneWhats('48991154821') };
    Moeda.fixa = null;
    return { br, cl, link: (Moeda.fixa = 'BRL', waLink('48 99115-4821', 'Oi')) };
  });
  expect(r.br).toEqual({ celularComDDD: '5548991154821', fixoComDDD: '554833334444', comMais: '5548991154821', jaCom55: '5548991154821',
    chileSemMais: '56912345678', chileComMais: '56912345678', portugalSemMais: '351912345678', com00: '56912345678', curto: '12345', vazio: '' });
  expect(r.cl).toEqual({ localChile: '912345678', pareceBR: '48991154821' });
  expect(r.link).toBe('https://wa.me/5548991154821?text=Oi');
});

test('moeda é da oficina: trocar o idioma para espanhol não converte os valores', async ({ page }) => {
  const erros = vigiarErros(page);
  await criarContaEOficina(page, { email: emailNovo('moeda'), oficina: 'Oficina Moeda' });
  const pt = await page.evaluate(() => ({ base: Moeda.base(), tela: Moeda.tela(), v: money(1234.5), entrada: parseMoney('1.234,50') }));
  expect(pt).toEqual({ base: 'BRL', tela: 'BRL', v: expect.stringMatching(/R\$\s?1\.234,50/), entrada: 1234.5 });
  await page.evaluate(() => localStorage.setItem(I18N.chave, 'es'));   // a pessoa escolheu espanhol
  await page.reload();
  await expect(page.locator('#main')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'es');
  const es = await page.evaluate(() => ({ base: Moeda.base(), tela: Moeda.tela(), v: money(1234.5), entrada: parseMoney('1.234,50') }));
  expect(es).toEqual(pt);   // mesmos reais, sem cotação
  expect(erros).toEqual([]);
});

test('botão com o atributo hidden fica escondido mesmo com a classe .btn', async ({ page }) => {
  await page.goto('/');
  const vis = await page.evaluate(() => {
    const b = document.createElement('button'); b.className = 'btn primary'; b.hidden = true; b.textContent = 'x';
    document.body.appendChild(b); const d = getComputedStyle(b).display; b.remove(); return d;
  });
  expect(vis).toBe('none');
});
