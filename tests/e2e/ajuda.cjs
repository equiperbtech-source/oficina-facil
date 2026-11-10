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

// cria conta pela tela e a oficina no "Quase lá" (tipos: 'carro' | 'moto' | 'carro,moto')
async function criarContaEOficina(page, { email, senha = 'senha123', oficina, tipos = 'carro,moto' }) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Criar conta' }).first().click();
  await page.fill('[name=email]', email);
  await page.fill('[name=senha]', senha);
  await page.fill('[name=senha2]', senha);
  await page.locator('#lg-btn').click();
  await page.locator('#ob-criar [name=nome]').fill(oficina);
  await page.locator(`#ob-criar input[name=tipos][value="${tipos}"]`).check({ force: true });
  await page.locator('#ob-criar button.primary').click();
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
// cria clientes, veículos e OS de exemplo direto pelo Store (para prints e telas que dependem de dados)
async function semearOS(page) {
  return page.evaluate(() => {
    const ck = { 'Pneus': 'ok', 'Freios': 'nok', 'Faróis e lanternas': 'ok' };
    const mk = (nome, tel, v, defeito, servicos, pecas, status) => {
      const c = Store.saveCliente({ nome, telefone: tel, veiculos: [] });
      const vv = { id: uid(), ...v };
      c.veiculos.push(vv); Store.saveCliente(c);
      const o = Store.saveOS({ clienteId: c.id, veiculo: { ...vv }, defeito, status, previsao: dayKey(addDays(new Date(), 2)), kmEntrada: v.km, nivelCombustivel: '1/2',
        checklist: ck, checklistItens: Checklist.itens(v.tipo), garantiaDias: 90, garantiaKm: 5000,
        itensServico: servicos.map(([n, val]) => ({ id: uid(), nome: n, qtd: 1, valor: val })), itensPeca: pecas.map(([n, val, q = 1]) => ({ id: uid(), nome: n, qtd: q, valor: val, custo: Math.round(val * 0.6) })), desconto: 0,
        servico: servicos.map(s => s[0]).join(', ') });
      return o;
    };
    const a = mk('Maria Souza', '48991154821', { tipo: 'carro', placa: 'ABC1D23', marca: 'Chevrolet', modelo: 'Onix', motor: '1.0', anoModelo: '2019', cor: 'Prata', km: 45000, combustivel: 'flex' },
      'Barulho na suspensão dianteira', [['Troca de amortecedores dianteiros', 350]], [['Amortecedor dianteiro', 250, 2]], 'servico');
    mk('João Pereira', '48988887777', { tipo: 'moto', placa: 'MOT2E45', marca: 'Honda', modelo: 'CG 160 Fan', cilindrada: '160', anoModelo: '2021', km: 18000 }, 'Corrente folgada', [['Relação (coroa, pinhão e corrente)', 90]], [['Kit relação', 230]], 'analise');
    mk('Ana Lima', '48977776666', { tipo: 'carro', placa: 'HBX2021', marca: 'Hyundai', modelo: 'HB20', anoModelo: '2021', km: 30000 }, 'Revisão dos 30 mil km', [['Revisão', 290]], [['Óleo 5W30', 45, 4], ['Filtro de óleo', 35]], 'peca');
    mk('Carlos Dias', '48966665555', { tipo: 'moto', placa: 'FAZ3B50', marca: 'Yamaha', modelo: 'Fazer 250', anoModelo: '2020', km: 22000 }, 'Freio traseiro fraco', [['Pastilhas / lonas de freio', 60]], [['Pastilha traseira', 80]], 'concluido');
    Store.tokenOS(a); Store.save();
    return { id: a.id, numero: a.numero, token: a.token };
  });
}
module.exports = { semearOS, vigiarErros, semRolagemLateral, emailNovo, criarContaEOficina, entrar, api, login };
