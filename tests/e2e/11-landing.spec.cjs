/* Etapa 9: landing. 390 px sem rolagem lateral, contraste AA (axe), UTMs passam para o cadastro, nada inventado. */
const { test, expect } = require('@playwright/test');
const fs = require('fs'), path = require('path');
const { vigiarErros, semRolagemLateral } = require('./ajuda.cjs');
const AXE = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');

test('landing: celular sem rolagem lateral, AA, UTMs no cadastro', async ({ page }, info) => {
  const erros = vigiarErros(page);
  await page.goto('/landing/index.html?utm_source=instagram&utm_campaign=lancamento&fbclid=abc');
  await expect(page.locator('h1')).toContainText('organizada no celular');
  await semRolagemLateral(page);
  await page.addScriptTag({ content: AXE });
  const v = await page.evaluate(async () => (await axe.run(document, { runOnly: ['color-contrast'] })).violations.flatMap(x => x.nodes.map(n => n.target.join(' '))));
  expect(v).toEqual([]);
  const href = await page.locator('.barra a').getAttribute('href');
  const u = new URL(href);
  expect(u.searchParams.get('cadastro')).toBe('1');
  expect(u.searchParams.get('utm_source')).toBe('instagram');
  expect(u.searchParams.get('utm_campaign')).toBe('lancamento');
  expect(u.searchParams.get('fbclid')).toBe('abc');
  await expect(page.locator('.planos')).toContainText('R$ 49,99');
  await expect(page.locator('.planos')).toContainText('R$ 89,99');
  // nada inventado: sem depoimentos, notas, contagem regressiva ou "% de desconto"
  const txt = await page.locator('body').innerText();
  expect(txt).not.toMatch(/depoimento|estrelas|★|\d+\s*mil (oficinas|clientes)|últimas vagas|termina em|% de desconto/i);
  await page.screenshot({ path: path.join(__dirname, '..', 'prints', `etapa9-landing-${info.project.name}.png`), fullPage: true });
  expect(erros).toEqual([]);
});
