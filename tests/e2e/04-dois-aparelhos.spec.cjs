/* Dois aparelhos da mesma oficina ao mesmo tempo (armadilha "configurações voltando sozinhas"):
   - o que um salva aparece no outro sozinho (tempo real);
   - cada um muda um campo diferente das configurações quase junto: os dois valores ficam. */
const { test, expect } = require('@playwright/test');
const { vigiarErros, emailNovo, criarContaEOficina, entrar, api, login } = require('./ajuda.cjs');

test('dois aparelhos editando a mesma oficina', async ({ browser }, info) => {
  test.skip(info.project.name !== 'celular', 'uma vez basta');
  const conta = { email: emailNovo('dois'), oficina: 'Oficina Dois Aparelhos' };
  const c1 = await browser.newContext(), c2 = await browser.newContext();
  const p1 = await c1.newPage(), p2 = await c2.newPage(); const e1 = vigiarErros(p1), e2 = vigiarErros(p2);
  await criarContaEOficina(p1, conta);
  await entrar(p2, conta);

  // aparelho 1 cadastra um cliente; o aparelho 2 vê sem recarregar
  await p2.goto('/#/clientes');
  await p1.goto('/#/clientes');
  await p1.getByRole('button', { name: /Novo Cliente/i }).click();
  await p1.locator('#cl-form [name=nome]').fill('Cliente do Aparelho 1');
  await p1.locator('#cl-save').click();
  await expect(p2.locator('#cl-list')).toContainText('Cliente do Aparelho 1', { timeout: 15000 });

  // os dois abrem as configurações; cada um muda um campo diferente e salva quase junto
  await p1.goto('/#/config'); await p2.goto('/#/config');
  for (const p of [p1, p2]) await p.locator('#cf-loja > h3').click();   // abre o cartão "Dados da oficina"
  await p1.locator('#cf-loja [name=telefone]').fill('48 3333-1111');
  await p2.locator('#cf-loja [name=instagram]').fill('@oficina.dois');
  await p1.locator('#cf-save').click();
  await p2.locator('#cf-save').click();
  const tok = await login(conta.email);
  await expect.poll(async () => {
    const r = await api('/rest/v1/itens?select=dados&colecao=eq.meta&id=eq.settings', { token: tok });
    const s = r.dados?.[0]?.dados || {}; return [s.telefone, s.instagram];
  }, { timeout: 15000 }).toEqual(['48 3333-1111', '@oficina.dois']);
  // e continuam assim nos dois aparelhos depois de recarregar
  for (const p of [p1, p2]) {
    await p.reload(); await p.goto('/#/config');
    if (!(await p.locator('#cf-loja [name=telefone]').isVisible())) await p.locator('#cf-loja > h3').click();
    await expect(p.locator('#cf-loja [name=telefone]')).toHaveValue('48 3333-1111');
    await expect(p.locator('#cf-loja [name=instagram]')).toHaveValue('@oficina.dois');
  }
  expect(e1).toEqual([]); expect(e2).toEqual([]);
  await c1.close(); await c2.close();
});
