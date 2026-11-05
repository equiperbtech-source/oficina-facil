/* Etapa 1: o app abre com o nome novo, sem erros e sem rolagem lateral; cria conta e oficina. */
const { test, expect } = require('@playwright/test');
const { vigiarErros, semRolagemLateral, emailNovo, criarContaEOficina } = require('./ajuda.cjs');

test('tela de entrada com a marca Oficina Simples', async ({ page }, info) => {
  const erros = vigiarErros(page);
  await page.goto('/');
  await expect(page).toHaveTitle('Oficina Simples');
  await expect(page.locator('#login-form')).toContainText('Oficina Simples');
  await expect(page.locator('body')).not.toContainText(/Reparo|ReparaYa|RB Tech/);
  await expect(page.locator('html')).toHaveAttribute('lang', 'pt-BR');   // português é o padrão
  await semRolagemLateral(page);
  await page.screenshot({ path: `tests/prints/etapa1-login-${info.project.name}.png` });
  expect(erros).toEqual([]);
});

test('cria conta e oficina e chega no painel', async ({ page }, info) => {
  const erros = vigiarErros(page);
  await criarContaEOficina(page, { email: emailNovo('dono'), oficina: 'Oficina do Teste' });
  await expect(page.locator('body')).toContainText('Oficina do Teste');
  await semRolagemLateral(page);
  await page.screenshot({ path: `tests/prints/etapa1-painel-${info.project.name}.png` });
  expect(erros).toEqual([]);
});
