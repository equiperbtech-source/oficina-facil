/* "Preencher OS por voz". Servidor: rota de verdade (login, oficina, limite 30/h, lista cadastrada no prompt,
   saída em JSON, áudio não guardado) com o Gemini (áudio) e o Claude Haiku (texto transcrito) simulados.
   Tela: reconhecimento de voz falso (as falas de aceitação como texto) e, sem ele, o microfone falso do Chromium
   gravando áudio; campos em amarelo, moto já cadastrada, telefone diferente.
   O teste com a IA de verdade fica em scripts/testar-voz.mjs (precisa da ANTHROPIC_API_KEY ou da GEMINI_API_KEY). */
const { test, expect } = require('@playwright/test');
const fs = require('fs'), path = require('path');
const { vigiarErros, emailNovo, criarContaEOficina, login } = require('./ajuda.cjs');
const { SERVICE_KEY } = require('../servidor/supabase-falso.cjs');
const PRINTS = path.join(__dirname, '..', 'prints');
test.use({ launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] }, permissions: ['microphone'] });

// as 3 falas de aceitação, como o reconhecimento de voz do celular transcreve (em dois pedaços: o Android para no silêncio)
const FALAS = {
  1: ['CG 160 placa ABC1D23 do João 32 mil quilômetros', 'troca de óleo e relação barulho no freio da frente'],
  2: ['Fazer 250 do Marcos telefone 48 99999 8888', 'revisão de 10 mil e pastilha traseira'],
  3: ['Biz da Maria não pega de manhã', 'ver bateria e vela'],
};
// reconhecimento de voz falso (no lugar do Chrome/Safari): fala o 1º pedaço, "para no silêncio", volta e fala o 2º
function falaFalsa(pedacos) {
  window.__pedacos = pedacos.slice();
  window.SpeechRecognition = window.webkitSpeechRecognition = class {
    start() {
      const p = window.__pedacos.shift();
      if (this.lang !== 'pt-BR') throw new Error('idioma');
      if (!p) return;
      const res = (txt, fim) => ({ resultIndex: 0, results: [Object.assign([{ transcript: txt }], { isFinal: fim })] });
      setTimeout(() => this.onresult?.(res(p.split(' ').slice(0, 2).join(' '), false)), 150);
      setTimeout(() => this.onresult?.(res(p, true)), 400);
      if (window.__pedacos.length) setTimeout(() => this.onend?.(), 700);   // silêncio: o navegador encerra sozinho
    }
    stop() { setTimeout(() => this.onend?.(), 30); }
    abort() { this.stop(); }
  };
}

// o que a IA devolve para as 3 falas de aceitação (os ids da lista cadastrada são trocados no teste)
const RESPOSTAS = {
  1: { placa: 'ABC-1D23', modelo_moto: 'CG 160', ano: null, km: 32000, nome_cliente: 'João', telefone_cliente: null, servicos: [{ nome: 'Troca de óleo', id_cadastro: '@oleo' }, { nome: 'Relação', id_cadastro: '@relacao' }], pecas: [], defeito_relatado: 'Barulho no freio da frente', observacoes: null, campos_incertos: ['ano', 'telefone_cliente'] },
  2: { placa: null, modelo_moto: 'Fazer 250', ano: null, km: null, nome_cliente: 'Marcos', telefone_cliente: '48 99999 8888', servicos: [{ nome: 'Revisão de 10 mil', id_cadastro: '@revisao' }], pecas: [{ nome: 'Pastilha traseira', quantidade: 1, id_cadastro: '@pastilha' }], defeito_relatado: null, observacoes: null, campos_incertos: ['placa', 'km'] },
  3: { placa: null, modelo_moto: 'Biz', ano: null, km: null, nome_cliente: 'Maria', telefone_cliente: null, servicos: [{ nome: 'Ver a bateria', id_cadastro: null }, { nome: 'Ver a vela', id_cadastro: null }], pecas: [], defeito_relatado: 'Não pega de manhã', observacoes: null, campos_incertos: ['placa'] },
};

test('servidor: login, oficina, lista cadastrada no prompt, JSON limpo, limite de 30 por hora e áudio não guardado', async ({ page }, info) => {
  test.skip(info.project.name !== 'celular', 'uma vez basta');
  const conta = { email: emailNovo('vozapi'), oficina: 'Oficina Voz', tipos: 'moto' };
  await criarContaEOficina(page, conta);
  const loja = await page.evaluate(() => { Store.db.pecas.push({ id: 'pc-past', nome: 'Pastilha de freio traseira', codigo: '7891', qtd: 3 }); Store.save(); return Cloud.loja.id; });
  const tok = await login(conta.email);
  await page.waitForTimeout(2500);   // deixa a oficina subir para a nuvem
  process.env.SUPABASE_URL = 'http://127.0.0.1:54321'; process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_KEY;
  process.env.GEMINI_API_KEY = 'chave-de-teste'; delete process.env.GEMINI_MODEL; delete process.env.ANTHROPIC_API_KEY;
  const { POST } = await import(path.join(__dirname, '..', '..', 'api', 'os', 'voz.js'));
  // Gemini simulado: guarda o pedido e responde como a API (candidates[0].content.parts[0].text)
  const pedidos = [], fetchReal = global.fetch;
  global.fetch = async (url, op) => {
    if (String(url).startsWith('https://generativelanguage.googleapis.com/')) {
      pedidos.push({ url: String(url), op });
      const cat = JSON.parse(op.body).contents[0].parts[0].text;
      const idOleo = (cat.match(/^(\S+) \| Troca de óleo$/m) || [])[1];
      const resp = { ...RESPOSTAS[1], placa: 'abc 1d23', km: '32.000', servicos: [{ nome: 'Troca de óleo', id_cadastro: idOleo }, { nome: 'Inventado', id_cadastro: 'id-que-nao-existe' }], pecas: [{ nome: 'Pastilha traseira', quantidade: 1, id_cadastro: 'pc-past' }] };
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(resp) }] } }] }), { status: 200 });
    }
    return fetchReal(url, op);
  };
  const wav = Buffer.alloc(40000, 1);
  const chama = (h = {}) => POST(new Request('https://app.exemplo/api/os/voz', { method: 'POST', headers: { 'Content-Type': 'audio/wav', Authorization: 'Bearer ' + tok, 'X-Loja': loja, ...h }, body: wav }));
  try {
    expect((await POST(new Request('https://x/api/os/voz', { method: 'POST', headers: { 'Content-Type': 'audio/wav', 'X-Loja': loja }, body: wav }))).status).toBe(401);
    const r = await chama(); const j = await r.json();
    expect(r.status, JSON.stringify(j)).toBe(200);
    // pedido ao Gemini: modelo padrão, chave no cabeçalho, instruções, schema JSON, áudio inline e a lista cadastrada
    const p = pedidos[0], corpo = JSON.parse(p.op.body);
    expect(p.url).toContain('/models/gemini-flash-latest:generateContent');
    expect(p.op.headers['x-goog-api-key']).toBe('chave-de-teste');
    expect(corpo.systemInstruction.parts[0].text).toMatch(/Nunca invente dados/);
    expect(corpo.generationConfig.responseMimeType).toBe('application/json');
    expect(Object.keys(corpo.generationConfig.responseSchema.properties)).toEqual(['placa', 'modelo_moto', 'ano', 'km', 'nome_cliente', 'telefone_cliente', 'servicos', 'pecas', 'defeito_relatado', 'observacoes', 'campos_incertos']);
    expect(corpo.contents[0].parts[1].inlineData).toMatchObject({ mimeType: 'audio/wav' });
    expect(corpo.contents[0].parts[0].text).toContain('Troca de óleo');
    expect(corpo.contents[0].parts[0].text).toContain('pc-past | Pastilha de freio traseira | código 7891');
    // resposta limpa: placa normalizada, km número, id inventado descartado, incertos
    expect(j.dados).toMatchObject({ placa: 'ABC1D23', km: 32000, nome_cliente: 'João', modelo_moto: 'CG 160' });
    expect(j.dados.servicos[1]).toEqual({ nome: 'Inventado', id_cadastro: null });
    expect(j.dados.pecas[0]).toEqual({ nome: 'Pastilha traseira', quantidade: 1, id_cadastro: 'pc-past' });
    expect(j.dados.campos_incertos).toEqual(expect.arrayContaining(['ano', 'telefone_cliente']));
    // modelo trocado pela variável, sem mexer no código
    process.env.GEMINI_MODEL = 'gemini-2.5-flash'; await chama(); expect(pedidos[1].url).toContain('/models/gemini-2.5-flash:'); delete process.env.GEMINI_MODEL;
    // áudio curto demais, outra oficina e limite
    expect((await POST(new Request('https://x/api/os/voz', { method: 'POST', headers: { 'Content-Type': 'audio/wav', Authorization: 'Bearer ' + tok, 'X-Loja': loja }, body: Buffer.alloc(100) }))).status).toBe(422);
    expect((await chama({ 'X-Loja': '00000000-0000-0000-0000-000000000000' })).status).toBe(403);
    for (let i = 2; i < 30; i++) expect((await chama()).status).toBe(200);
    const lim = await chama(); expect(lim.status).toBe(429); expect((await lim.json()).erro).toBe('limite');
    expect(pedidos.length).toBe(30);   // a 31ª nem chega no Gemini
    // falha da IA vira erro curto (sem travar)
    global.fetch = async (url, op) => String(url).includes('generativelanguage') ? new Response('{"error":"x"}', { status: 500 }) : fetchReal(url, op);
    process.env.GEMINI_API_KEY = 'outra';
  } finally { global.fetch = fetchReal; }
  // nenhum áudio guardado: a rota não escreve arquivo nem banco (só o horário do uso)
  const fonte = fs.readFileSync(path.join(__dirname, '..', '..', 'api', 'os', 'voz.js'), 'utf8') + fs.readFileSync(path.join(__dirname, '..', '..', 'api', '_lib', 'voz.js'), 'utf8');
  expect(fonte).not.toMatch(/writeFile|createWriteStream|storage\/v1|\.upload\(/);
});

test('servidor: texto transcrito vai para o Claude Haiku (JSON Schema, lista cadastrada); áudio continua no Gemini', async ({ page }, info) => {
  test.skip(info.project.name !== 'celular', 'uma vez basta');
  const conta = { email: emailNovo('vozclaude'), oficina: 'Oficina Haiku', tipos: 'moto' };
  await criarContaEOficina(page, conta);
  const loja = await page.evaluate(() => { Store.db.pecas.push({ id: 'pc-past', nome: 'Pastilha de freio traseira', codigo: '7891', qtd: 3 }); Store.save(); return Cloud.loja.id; });
  const tok = await login(conta.email);
  await page.waitForTimeout(2500);
  process.env.SUPABASE_URL = 'http://127.0.0.1:54321'; process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_KEY;
  process.env.ANTHROPIC_API_KEY = 'chave-claude-teste'; delete process.env.VOZ_CLAUDE_MODEL;
  process.env.GEMINI_API_KEY = 'chave-gemini-teste'; delete process.env.GEMINI_MODEL;
  const { POST } = await import(path.join(__dirname, '..', '..', 'api', 'os', 'voz.js'));
  // Claude simulado: responde como a API de mensagens (content[0].text com o JSON); Gemini simulado também
  const claude = [], gemini = [], fetchReal = global.fetch;
  let respostaClaude = null;
  global.fetch = async (url, op = {}) => {
    const u = String(url instanceof Request ? url.url : url);
    if (u.startsWith('https://api.anthropic.com/')) {
      const corpo = JSON.parse(op.body);
      claude.push({ url: u, headers: new Headers(op.headers), corpo });
      if (respostaClaude) return respostaClaude();
      const cat = corpo.messages[0].content;
      const idOleo = (cat.match(/^(\S+) \| Troca de óleo$/m) || [])[1];
      const resp = { ...RESPOSTAS[1], placa: 'ABC 1D23', servicos: [{ nome: 'Troca de óleo', id_cadastro: idOleo }], pecas: [{ nome: 'Pastilha traseira', quantidade: 1, id_cadastro: 'pc-past' }] };
      return new Response(JSON.stringify({ id: 'msg_1', type: 'message', role: 'assistant', model: corpo.model, content: [{ type: 'text', text: JSON.stringify(resp) }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 10, output_tokens: 10 } }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (u.startsWith('https://generativelanguage.googleapis.com/')) {
      gemini.push({ url: u, corpo: JSON.parse(op.body) });
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(RESPOSTAS[3]) }] } }] }), { status: 200 });
    }
    return fetchReal(url, op);
  };
  const FALA = 'CG 160 placa ABC1D23 do João 32 mil quilômetros troca de óleo e relação barulho no freio da frente';
  const texto = (txt, h = {}) => POST(new Request('https://app.exemplo/api/os/voz', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok, 'X-Loja': loja, ...h }, body: JSON.stringify({ texto: txt }) }));
  const audio = () => POST(new Request('https://app.exemplo/api/os/voz', { method: 'POST', headers: { 'Content-Type': 'audio/wav', Authorization: 'Bearer ' + tok, 'X-Loja': loja }, body: Buffer.alloc(40000, 1) }));
  try {
    expect((await POST(new Request('https://x/api/os/voz', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Loja': loja }, body: '{"texto":"x"}' }))).status).toBe(401);
    const r = await texto(FALA); const j = await r.json();
    expect(r.status, JSON.stringify(j)).toBe(200);
    // pedido ao Claude: Haiku 5.5, chave no cabeçalho, instruções + aviso de transcrição, JSON Schema, lista cadastrada e a fala
    const p = claude[0];
    expect(p.url).toBe('https://api.anthropic.com/v1/messages');
    expect(p.headers.get('x-api-key') || p.headers.get('authorization')).toContain('chave-claude-teste');   // o SDK manda a chave (Authorization ou x-api-key)
    expect(p.corpo.model).toBe('claude-haiku-5-5');
    expect(p.corpo.system).toMatch(/Nunca invente dados/); expect(p.corpo.system).toMatch(/TRANSCRIÇÃO/);
    expect(p.corpo.output_config.format.type).toBe('json_schema');
    expect(p.corpo.output_config.format.schema.additionalProperties).toBe(false);
    expect(p.corpo.output_config.format.schema.properties.servicos.items.additionalProperties).toBe(false);
    expect(Object.keys(p.corpo.output_config.format.schema.properties)).toEqual(['placa', 'modelo_moto', 'ano', 'km', 'nome_cliente', 'telefone_cliente', 'servicos', 'pecas', 'defeito_relatado', 'observacoes', 'campos_incertos']);
    expect(p.corpo).not.toHaveProperty('temperature');
    expect(p.corpo.messages[0].content).toContain('pc-past | Pastilha de freio traseira | código 7891');
    expect(p.corpo.messages[0].content).toContain(FALA);
    expect(j.dados).toMatchObject({ placa: 'ABC1D23', km: 32000, nome_cliente: 'João', modelo_moto: 'CG 160' });
    expect(j.dados.pecas[0]).toEqual({ nome: 'Pastilha traseira', quantidade: 1, id_cadastro: 'pc-past' });
    expect(gemini.length).toBe(0);
    // modelo trocado pela variável
    process.env.VOZ_CLAUDE_MODEL = 'claude-sonnet-5-5'; await texto(FALA); expect(claude[1].corpo.model).toBe('claude-sonnet-5-5'); delete process.env.VOZ_CLAUDE_MODEL;
    // fala vazia não gasta a IA
    expect((await texto('é...')).status).toBe(422); expect(claude.length).toBe(2);
    // áudio (navegador sem reconhecimento de voz) continua indo para o Gemini
    expect((await audio()).status).toBe(200); expect(gemini.length).toBe(1); expect(gemini[0].corpo.contents[0].parts[1].inlineData.mimeType).toBe('audio/wav');
    // falha e recusa do Claude viram erro curto (a tela mostra "preencha manualmente ou tente de novo")
    respostaClaude = () => new Response(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'x' } }), { status: 400, headers: { 'content-type': 'application/json' } });
    let e = await texto(FALA); expect(e.status).toBe(502); expect((await e.json()).erro).toBe('falha_ia');
    respostaClaude = () => new Response(JSON.stringify({ id: 'msg_2', type: 'message', role: 'assistant', model: 'claude-haiku-5-5', content: [], stop_reason: 'refusal', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 0 } }), { status: 200, headers: { 'content-type': 'application/json' } });
    e = await texto(FALA); expect(e.status).toBe(502); expect((await e.json()).erro).toBe('sem_resposta');
    respostaClaude = null;
    // sem a chave do Claude, o texto vai para o Gemini (como texto); sem nenhuma chave, 503
    delete process.env.ANTHROPIC_API_KEY;
    expect((await texto(FALA)).status).toBe(200); expect(gemini[1].corpo.contents[0].parts[1].text).toContain(FALA); expect(gemini[1].corpo.systemInstruction.parts[0].text).toMatch(/TRANSCRIÇÃO/);
    process.env.ANTHROPIC_API_KEY = 'chave-claude-teste'; delete process.env.GEMINI_API_KEY;
    const sem = await audio(); expect(sem.status).toBe(503); expect((await sem.json()).erro).toBe('sem_chave');
  } finally { global.fetch = fetchReal; delete process.env.ANTHROPIC_API_KEY; delete process.env.VOZ_CLAUDE_MODEL; }
});

for (const n of [1, 2, 3]) {
  test(`tela: fala ${n} preenche a OS, destaca o que falta e só salva quando o mecânico manda`, async ({ page }, info) => {
    test.skip(info.project.name !== 'celular', 'no celular');
    const erros = vigiarErros(page);
    await criarContaEOficina(page, { email: emailNovo('voz' + n), oficina: 'Oficina da Moto', tipos: 'moto' });
    const ids = await page.evaluate(() => {
      const sv = nome => Store.db.servicos.find(s => s.nome === nome)?.id;
      Store.db.servicos.find(s => s.nome === 'Troca de óleo').preco = 60;
      Store.db.pecas.push({ id: 'pc-past', nome: 'Pastilha de freio traseira', qtd: 5, preco: 45, custo: 20 });
      // fala 1: a moto já está cadastrada (placa ABC1D23, do João, telefone antigo)
      Store.saveCliente({ nome: 'João Silva', telefone: '48911112222', veiculos: [{ id: 'vj', tipo: 'moto', placa: 'ABC1D23', marca: 'Honda', modelo: 'CG 160 Fan', anoModelo: '2020', km: 30000 }] });
      // fala 2: o Marcos já é cliente com outro telefone
      Store.saveCliente({ nome: 'Marcos', telefone: '48933334444', veiculos: [] });
      Store.save();
      return { '@oleo': sv('Troca de óleo'), '@relacao': sv('Relação (coroa, pinhão e corrente)'), '@revisao': sv('Revisão'), '@pastilha': 'pc-past' };
    });
    const resp = JSON.parse(JSON.stringify(RESPOSTAS[n]).replace(/"(@\w+)"/g, (m, k) => JSON.stringify(ids[k])));
    if (n === 2) resp.telefone_cliente = '48999998888';
    // a rota do servidor devolve o que o Gemini devolveria (já limpo)
    let chamadas = 0, corpo = null;
    await page.route('**/api/os/voz', async route => {
      chamadas++; corpo = route.request().postDataBuffer();
      const { limpar } = await import(path.join(__dirname, '..', '..', 'api', '_lib', 'voz.js'));
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ dados: limpar(resp, { servicos: Object.values(ids).map(id => ({ id })), pecas: [{ id: 'pc-past' }] }) }) });
    });
    const antes = await page.evaluate(() => Store.db.os.length);
    await page.goto('/#/os');
    await page.locator('.page-actions .btn.primary').click();
    await expect(page.locator('#voz-gravar')).toBeVisible();
    expect((await page.locator('#voz-gravar').boundingBox()).height).toBeGreaterThanOrEqual(56);
    const comTexto = n !== 3;   // fala 3: navegador sem reconhecimento de voz → grava o áudio (Gemini)
    if (comTexto) await page.evaluate(falaFalsa, FALAS[n]);
    else await page.evaluate(() => { window.SpeechRecognition = window.webkitSpeechRecognition = undefined; });
    await page.locator('#voz-gravar').click();
    await expect(page.locator('#voz-tempo')).toBeVisible();
    if (comTexto) await expect(page.locator('#voz-texto')).toHaveText(FALAS[n].join(' '));   // o texto aparece enquanto fala
    await page.waitForTimeout(2300);
    await expect(page.locator('#voz-tempo')).toHaveText(/0:0[2-3]/);
    await page.locator('#voz-parar').click();
    await expect(page.locator('.modal').last()).toContainText('Confira a OS', { timeout: 15000 });
    expect(chamadas).toBe(1);
    if (comTexto) {
      expect(JSON.parse(corpo.toString())).toEqual({ texto: FALAS[n].join(' ') });   // só o texto vai para o servidor
      await expect(page.locator('.voz-ouvido')).toContainText('O que eu entendi');
    } else expect(corpo.slice(0, 4).toString()).toBe('RIFF');   // o áudio vai como WAV
    const val = k => page.locator(`[data-voz=${k}] [name]`).first().inputValue();
    const amarelo = k => page.locator(`[data-voz=${k}]`).evaluate(e => e.classList.contains('voz-confira'));
    // nada foi salvo ainda: a IA nunca salva sozinha
    expect(await page.evaluate(() => Store.db.os.length)).toBe(antes);
    if (n === 1) {
      await expect(page.locator('.modal').last()).toContainText('Moto já cadastrada: Honda CG 160 Fan 2020 de João Silva');
      expect([await val('placa'), await val('modelo_moto'), await val('km'), await val('nome_cliente')]).toEqual(['ABC1D23', 'CG 160', '32.000', 'João']);
      expect(await val('defeito_relatado')).toBe('Barulho no freio da frente');
      expect(await amarelo('placa')).toBe(false);
      await expect(page.locator('[data-it-lista=servico] [data-f=nome]')).toHaveCount(2);
      expect(await page.locator('[data-it-lista=servico] [data-f=nome]').first().inputValue()).toBe('Troca de óleo');
    }
    if (n === 2) {
      expect([await val('modelo_moto'), await val('nome_cliente')]).toEqual(['Fazer 250', 'Marcos']);
      await expect(page.locator('.voz-fone')).toContainText('(48) 93333-4444');
      await expect(page.locator('.voz-fone')).toContainText('(48) 99999-8888');
      expect(await amarelo('placa')).toBe(true); expect(await amarelo('defeito_relatado')).toBe(true);
      expect(await page.locator('[data-it-lista=peca] [data-f=nome]').first().inputValue()).toBe('Pastilha de freio traseira');
      await page.locator('[data-voz=defeito_relatado] textarea').fill('Revisão de 10 mil');
      expect(await amarelo('defeito_relatado')).toBe(false);
    }
    if (n === 3) {
      expect(await val('placa')).toBe('');
      expect(await amarelo('placa')).toBe(true);
      await expect(page.locator('[data-voz=placa] .voz-msg')).toBeVisible();
      await expect(page.locator('[data-voz=placa] .voz-msg')).toHaveText(/Confira este campo/);
      expect([await val('modelo_moto'), await val('nome_cliente'), await val('defeito_relatado')]).toEqual(['Biz', 'Maria', 'Não pega de manhã']);
    }
    await page.screenshot({ path: path.join(PRINTS, `os-voz-fala${n}-celular.png`), fullPage: true });
    // o mecânico confere e salva
    await page.locator('#voz-salvar').click();
    await expect(page.locator('.modal').last()).toContainText('criada');
    const o = await page.evaluate(() => { const o = Store.db.os[Store.db.os.length - 1], c = Store.cliente(o.clienteId); return { placa: o.veiculo.placa || '', modelo: o.veiculo.modelo, km: o.kmEntrada, cliente: c.nome, fone: c.telefone, defeito: o.defeito, sv: o.itensServico.map(i => i.nome), pc: o.itensPeca.map(i => [i.nome, i.qtd]), clientes: Store.db.clientes.length, origem: o.origem }; });
    expect(o.origem).toBe('voz');
    if (n === 1) expect(o).toMatchObject({ placa: 'ABC1D23', modelo: 'CG 160 Fan', km: 32000, cliente: 'João Silva', defeito: 'Barulho no freio da frente', sv: ['Troca de óleo', 'Relação (coroa, pinhão e corrente)'], clientes: 2 });
    if (n === 2) expect(o).toMatchObject({ modelo: 'Fazer 250', cliente: 'Marcos', fone: '48999998888', sv: ['Revisão'], pc: [['Pastilha de freio traseira', 1]], clientes: 2 });
    if (n === 3) expect(o).toMatchObject({ placa: '', modelo: 'Biz', cliente: 'Maria', defeito: 'Não pega de manhã', sv: ['Ver a bateria', 'Ver a vela'], clientes: 3 });
    expect(erros).toEqual([]);
  });
}

test('tela: microfone bloqueado explica como liberar; falha da IA não trava; áudio curto pede de novo', async ({ browser }, info) => {
  test.skip(info.project.name !== 'celular', 'no celular');
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  await criarContaEOficina(page, { email: emailNovo('vozerro'), oficina: 'Oficina Erro', tipos: 'moto' });
  // sem permissão de microfone
  await page.evaluate(() => { window.SpeechRecognition = window.webkitSpeechRecognition = undefined; navigator.mediaDevices.getUserMedia = () => Promise.reject(Object.assign(new Error('x'), { name: 'NotAllowedError' })); VozOS.iniciar(); });
  await expect(page.locator('.modal').last()).toContainText('Microfone bloqueado');
  await expect(page.locator('.modal').last()).toContainText('Permissões → Microfone');
  await page.evaluate(() => closeAllModals());
  // reconhecimento de voz sem permissão: a mesma explicação
  await page.evaluate(() => { window.SpeechRecognition = class { start() { setTimeout(() => { this.onerror?.({ error: 'not-allowed' }); this.onend?.(); }, 50); } stop() {} abort() {} }; VozOS.iniciar(); });
  await expect(page.locator('.modal').last()).toContainText('Microfone bloqueado');
  await page.evaluate(() => closeAllModals());
  // fala curta demais ("é...") não gasta a IA
  let gastou = 0; await page.route('**/api/os/voz', r => { gastou++; return r.fulfill({ status: 500, body: '{}' }); });
  await page.evaluate(() => { window.SpeechRecognition = class { start() { setTimeout(() => this.onresult?.({ results: [Object.assign([{ transcript: 'é...' }], { isFinal: true })] }), 50); } stop() { setTimeout(() => this.onend?.(), 10); } abort() {} }; VozOS.iniciar(); });
  await page.locator('#voz-parar').click();
  await expect(page.locator('.modal').last()).toContainText('Grave de novo'); expect(gastou).toBe(0);
  await page.evaluate(() => closeAllModals()); await page.unroute('**/api/os/voz');
  // áudio gravado (navegador sem reconhecimento), mas o servidor só tem o Claude, que não recebe áudio
  await page.route('**/api/os/voz', r => r.fulfill({ status: 503, contentType: 'application/json', body: '{"erro":"sem_chave"}' }));
  await page.evaluate(async () => { VozOS.paraWav = async () => ({ wav: new Blob(['RIFF']), duracao: 5, rms: 0.1, pico: 0.5 }); await VozOS.processar(new Blob(['x']), 5); });
  await expect(page.locator('.modal').last()).toContainText('Este navegador não transcreve a fala');
  await page.evaluate(() => closeAllModals()); await page.unroute('**/api/os/voz');
  // falha da API / limite
  await page.route('**/api/os/voz', r => r.fulfill({ status: 429, contentType: 'application/json', body: '{"erro":"limite"}' }));
  await page.evaluate(async () => { VozOS.paraWav = async () => ({ wav: new Blob(['RIFF']), duracao: 5, rms: 0.1, pico: 0.5 }); await VozOS.processar(new Blob(['x']), 5); });
  await expect(page.locator('.modal').last()).toContainText('Não consegui ler o áudio agora, preencha manualmente ou tente de novo');
  await page.locator('.modal').last().getByRole('button', { name: 'Preencher manualmente' }).click();
  await expect(page.locator('#main')).toBeVisible();
  // áudio curto / sem fala
  await page.evaluate(async () => { VozOS.paraWav = async () => ({ wav: new Blob(['RIFF']), duracao: 0.8, rms: 0.0001, pico: 0.001 }); await VozOS.processar(new Blob(['x']), 0.8); });
  await expect(page.locator('.modal').last()).toContainText('Grave de novo');
  await ctx.close();
});
