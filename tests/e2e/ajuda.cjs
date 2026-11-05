/* Ajudas dos testes: vigia de erros no console, rolagem lateral, criar conta e oficina pela tela. */
const { expect } = require('@playwright/test');
const { ANON_KEY } = require('../servidor/supabase-falso.cjs');
const URL_SUPA = 'http://127.0.0.1:54321';

// junta todo erro de JavaScript e de console da página; o teste falha se sobrar algum
function vigiarErros(page) {
  const erros = [];
  page.on('pageerror', e => erros.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') erros.push('console: ' + m.text()); });
  // pedido que falhou: guarda o endereço e a resposta (ajuda a achar a causa)
  page.on('response', async r => { if (r.status() >= 400) { let t = ''; try { t = (await r.text()).slice(0, 300); } catch {} erros.push(`resposta ${r.status()} ${r.request().method()} ${r.url().replace(/^https?:\/\/[^/]+/, '')} ${t}`); } });
  return erros;
}
async function semRolagemLateral(page) {
  const r = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, tela: window.innerWidth }));
  expect(r.doc, 'rolagem lateral').toBeLessThanOrEqual(r.tela);
}
let n = 0;
const emailNovo = nome => `${nome}.${Date.now().toString(36)}${n++}@teste.local`;

// cria conta pela tela e a oficina no "Quase lá"
async function criarContaEOficina(page, { email, senha = 'senha123', oficina }) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Criar conta' }).first().click();
  await page.fill('[name=email]', email);
  await page.fill('[name=senha]', senha);
  await page.fill('[name=senha2]', senha);
  await page.locator('#lg-btn').click();
  await page.locator('#ob-criar [name=nome]').fill(oficina);
  await page.locator('#ob-criar button').click();
  await expect(page.locator('#main')).toBeVisible();
}
async function entrar(page, { email, senha = 'senha123' }) {
  await page.goto('/');
  await page.fill('[name=email]', email);
  await page.fill('[name=senha]', senha);
  await page.locator('#lg-btn').click();
  await expect(page.locator('#main')).toBeVisible();
}
// chamadas diretas à API (como um "hacker" com o login de uma oficina tentando ler outra)
async function api(caminho, { token = ANON_KEY, method = 'GET', body } = {}) {
  const r = await fetch(URL_SUPA + caminho, { method, headers: { apikey: ANON_KEY, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const txt = await r.text(); let dados = null; try { dados = txt ? JSON.parse(txt) : null; } catch { dados = txt; }
  return { status: r.status, dados };
}
async function login(email, senha = 'senha123') {
  const r = await fetch(URL_SUPA + '/auth/v1/token?grant_type=password', { method: 'POST', headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: senha }) });
  return (await r.json()).access_token;
}
module.exports = { vigiarErros, semRolagemLateral, emailNovo, criarContaEOficina, entrar, api, login };
