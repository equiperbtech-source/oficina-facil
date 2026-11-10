/* Segurança por oficina: a oficina B não vê nem mexe em nada da oficina A — nem pela tela,
   nem chamando o servidor direto com o login dela (dados, oficina, equipe, fotos). */
const { test, expect } = require('@playwright/test');
const { vigiarErros, emailNovo, criarContaEOficina, entrar, api, login } = require('./ajuda.cjs');

test('oficina B não enxerga a oficina A', async ({ browser }, info) => {
  test.skip(info.project.name !== 'celular', 'uma vez basta');
  const A = { email: emailNovo('alfa'), oficina: 'Oficina Alfa' }, B = { email: emailNovo('beta'), oficina: 'Oficina Beta' };
  const nomeCliente = 'Cliente Secreto da Alfa';

  // --- A cria a oficina e um cliente pela tela ---
  const ctxA = await browser.newContext(); const pa = await ctxA.newPage(); const errosA = vigiarErros(pa);
  await criarContaEOficina(pa, A);
  await pa.goto('/#/clientes');
  await pa.getByRole('button', { name: /Novo Cliente/i }).click();
  await pa.locator('#cl-form [name=nome]').fill(nomeCliente);
  await pa.locator('#cl-save').click();
  await expect(pa.locator('#cl-list')).toContainText(nomeCliente);
  const tokA = await login(A.email);
  const lojaA = (await api('/rest/v1/lojas?select=id,nome', { token: tokA })).dados[0];
  expect(lojaA.nome).toBe('Oficina Alfa');
  // espera o cliente subir para a nuvem
  await expect.poll(async () => (await api(`/rest/v1/itens?select=id,dados&loja_id=eq.${lojaA.id}&colecao=eq.clientes`, { token: tokA })).dados.length, { timeout: 15000 }).toBe(1);
  const cliA = (await api(`/rest/v1/itens?select=id,dados&loja_id=eq.${lojaA.id}&colecao=eq.clientes`, { token: tokA })).dados[0];
  // A guarda uma foto no arquivo privado
  const up = await fetch(`http://127.0.0.1:54321/storage/v1/object/lojas-privado/${lojaA.id}/veiculos/teste.jpg`, { method: 'POST', headers: { apikey: tokA, Authorization: 'Bearer ' + tokA, 'Content-Type': 'image/jpeg' }, body: Buffer.from([0xff, 0xd8, 0xff, 0xd9]) });
  expect(up.status).toBe(200);
  expect(errosA).toEqual([]);

  // --- B cria a própria oficina, numa outra "pessoa" (outro navegador) ---
  const ctxB = await browser.newContext(); const pb = await ctxB.newPage(); const errosB = vigiarErros(pb);
  await criarContaEOficina(pb, B);
  await pb.goto('/#/clientes');
  await expect(pb.locator('#cl-list')).toContainText('Nenhum cliente');
  await expect(pb.locator('body')).not.toContainText(nomeCliente);
  await expect(pb.locator('body')).not.toContainText('Oficina Alfa');
  expect(errosB).toEqual([]);

  // A também tem OS (com veículo), fornecedores e notas
  for (const col of ['os', 'fornecedores', 'nfe_entradas', 'orcamentos']) await api('/rest/v1/itens', { token: tokA, method: 'POST', body: [{ loja_id: lojaA.id, colecao: col, id: 'x-' + col, dados: { veiculo: { placa: 'ABC1D23' }, nome: 'Forn A' } }] });
  expect((await api(`/rest/v1/itens?select=colecao&loja_id=eq.${lojaA.id}&colecao=in.(os,fornecedores,orcamentos)`, { token: tokA })).dados.length).toBe(3);
  // --- B tenta pelo servidor, com o login dele ---
  const tokB = await login(B.email);
  const lojaB = (await api('/rest/v1/lojas?select=id', { token: tokB })).dados;
  expect(lojaB.map(l => l.id)).not.toContain(lojaA.id);                       // só vê a própria oficina
  expect((await api(`/rest/v1/itens?select=id&loja_id=eq.${lojaA.id}`, { token: tokB })).dados).toEqual([]);   // dados da A: nada
  expect((await api('/rest/v1/itens?select=loja_id', { token: tokB })).dados.every(r => r.loja_id !== lojaA.id)).toBe(true);
  expect((await api(`/rest/v1/membros?select=user_id&loja_id=eq.${lojaA.id}`, { token: tokB })).dados).toEqual([]);   // equipe da A: nada
  // gravar na oficina A: recusado
  const grava = await api('/rest/v1/itens?on_conflict=loja_id,colecao,id', { token: tokB, method: 'POST', body: [{ loja_id: lojaA.id, colecao: 'clientes', id: 'invasor', dados: { nome: 'invasor' } }] });
  expect(grava.status).toBeGreaterThanOrEqual(400);
  // alterar ou apagar o cliente da A: não acontece nada
  await api(`/rest/v1/itens?loja_id=eq.${lojaA.id}&colecao=eq.clientes&id=eq.${cliA.id}`, { token: tokB, method: 'PATCH', body: { dados: { nome: 'alterado' } } });
  await api(`/rest/v1/itens?loja_id=eq.${lojaA.id}`, { token: tokB, method: 'DELETE' });
  const continua = (await api(`/rest/v1/itens?select=dados&loja_id=eq.${lojaA.id}&colecao=eq.clientes`, { token: tokA })).dados;
  expect(continua.map(r => r.dados.nome)).toEqual([nomeCliente]);
  // fotos da A: B não lê, não gera link e não grava na pasta da A
  const ler = await fetch(`http://127.0.0.1:54321/storage/v1/object/authenticated/lojas-privado/${lojaA.id}/veiculos/teste.jpg`, { headers: { apikey: tokB, Authorization: 'Bearer ' + tokB } });
  expect(ler.status).toBeGreaterThanOrEqual(400);
  const link = await fetch(`http://127.0.0.1:54321/storage/v1/object/sign/lojas-privado/${lojaA.id}/veiculos/teste.jpg`, { method: 'POST', headers: { apikey: tokB, Authorization: 'Bearer ' + tokB, 'Content-Type': 'application/json' }, body: '{"expiresIn":60}' });
  expect(link.status).toBeGreaterThanOrEqual(400);
  const upB = await fetch(`http://127.0.0.1:54321/storage/v1/object/lojas-privado/${lojaA.id}/veiculos/invasor.jpg`, { method: 'POST', headers: { apikey: tokB, Authorization: 'Bearer ' + tokB, 'Content-Type': 'image/jpeg' }, body: Buffer.from([0xff, 0xd8]) });
  expect(upB.status).toBeGreaterThanOrEqual(400);
  // sem login nenhum: recusado ou vazio, nunca os dados
  const anon = await api(`/rest/v1/itens?select=id&loja_id=eq.${lojaA.id}`);
  expect(anon.status >= 400 || (Array.isArray(anon.dados) && anon.dados.length === 0)).toBe(true);

  // --- e a A continua vendo tudo dela ---
  await pa.reload();
  await pa.goto('/#/clientes');
  await expect(pa.locator('#cl-list')).toContainText(nomeCliente);
  await ctxA.close(); await ctxB.close();
});
