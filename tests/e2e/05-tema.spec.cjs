/* Etapa 2: tema branco e azul. Contraste AA (axe) nas telas principais, sem dourado, botões de 44 px
   no celular, sem rolagem lateral, e prints: login, painel, OS, pátio, link do cliente, PDF e e-mail. */
const { test, expect } = require('@playwright/test');
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const { vigiarErros, semRolagemLateral, emailNovo, criarContaEOficina, semearOS, api, login } = require('./ajuda.cjs');
const { psql, BANCO } = require('../db/preparar.cjs');
const AXE = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const PRINTS = path.join(__dirname, '..', 'prints');

async function contraste(page, onde) {
  await page.addScriptTag({ content: AXE });
  const r = await page.evaluate(async () => (await axe.run(document, { runOnly: ['color-contrast'] })).violations);
  const lista = r.flatMap(v => v.nodes.map(n => `${n.target.join(' ')} → ${n.any[0]?.message || ''}`));
  expect(lista, `contraste em ${onde}`).toEqual([]);
}
async function semDourado(page) {
  const achou = await page.evaluate(() => {
    const ruins = ['rgb(212, 175, 55)', 'rgb(184, 134, 11)', 'rgb(0, 0, 0)'];   // dourado, dourado escuro e fundo preto
    const out = new Set();
    for (const el of document.querySelectorAll('body *')) {
      const s = getComputedStyle(el);
      if (s.display === 'none' || s.visibility === 'hidden') continue;
      for (const k of ['color', 'backgroundColor', 'borderTopColor']) if (ruins.slice(0, 2).includes(s[k])) out.add(`${el.tagName}.${el.className} ${k}`);
      if (s.backgroundColor === 'rgb(0, 0, 0)') out.add(`${el.tagName}.${el.className} fundo preto`);
    }
    return [...out].slice(0, 10);
  });
  expect(achou).toEqual([]);
}
async function botoes44(page) {
  const pequenos = await page.evaluate(() => [...document.querySelectorAll('button, .btn, a.btn, .icon-btn')]
    .filter(b => {
      const r = b.getBoundingClientRect(); if (!r.width || !r.height || getComputedStyle(b).visibility === 'hidden') return false;
      // .mini: área de toque ampliada por ::before (inset -8px de cada lado)
      const extra = b.classList.contains('mini') ? 16 : 0;
      return r.height + extra < 43.5;
    })
    .map(b => `${b.tagName}.${b.className} "${(b.textContent || b.getAttribute('title') || '').trim().slice(0, 24)}" ${Math.round(b.getBoundingClientRect().height)}px`));
  expect(pequenos).toEqual([]);
}

test('tema claro em todas as telas principais', async ({ page }, info) => {
  const cel = info.project.name === 'celular', sufixo = info.project.name;
  const erros = vigiarErros(page);
  const shot = async n => { await page.evaluate(() => document.querySelectorAll('.toast').forEach(t => t.remove())); return page.screenshot({ path: path.join(PRINTS, `etapa2-${n}-${sufixo}.png`), fullPage: false }); };

  // login
  await page.goto('/');
  await expect(page.locator('#login-form')).toBeVisible();
  await contraste(page, 'login'); await semDourado(page); await semRolagemLateral(page);
  if (cel) await botoes44(page);
  await shot('login');

  // painel
  const conta = { email: emailNovo('tema'), oficina: 'Oficina do Teste' };
  await criarContaEOficina(page, conta);
  const os = await semearOS(page);
  await page.goto('/#/dashboard');
  await page.waitForTimeout(300);
  await contraste(page, 'painel'); await semDourado(page); await semRolagemLateral(page);
  if (cel) await botoes44(page);
  await shot('painel');

  // lista de OS e detalhe
  await page.goto('/#/os');
  await expect(page.locator('#os-list')).toContainText('Maria Souza');
  await contraste(page, 'lista de OS'); await semDourado(page); await semRolagemLateral(page);
  if (cel) await botoes44(page);
  await shot('os-lista');
  await page.evaluate(id => OSPage.detalhe(id), os.id);
  await expect(page.locator('.modal')).toBeVisible();
  await page.waitForTimeout(300);
  await contraste(page, 'detalhe da OS'); await semDourado(page);
  if (cel) await botoes44(page);
  await shot('os-detalhe');
  await page.evaluate(() => closeAllModals());

  // pátio (quadro por etapa)
  await page.goto('/#/bancada');
  await expect(page.locator('body')).toContainText('Maria Souza');
  await contraste(page, 'pátio'); await semDourado(page);
  if (cel) await botoes44(page);
  await shot('patio');

  // menu lateral aberto (vidro) no celular
  if (cel) { await page.locator('.menu-btn').first().click(); await page.waitForTimeout(350); await shot('menu'); await page.keyboard.press('Escape'); await page.goto('/#/dashboard'); }

  // link do cliente: espera a OS chegar na nuvem
  const tok = await login(conta.email);
  await expect.poll(async () => (await api(`/rest/v1/itens?select=id&colecao=eq.os&id=eq.${os.id}`, { token: tok })).dados.length, { timeout: 15000 }).toBe(1);
  const pub = await page.context().newPage(); const errosPub = vigiarErros(pub);
  await pub.goto(`/acompanhar/${os.token}`);
  await expect(pub.locator('#track')).toContainText(`#${os.numero}`);
  await contraste(pub, 'link do cliente'); await semDourado(pub); await semRolagemLateral(pub);
  if (cel) await botoes44(pub);
  await pub.screenshot({ path: path.join(PRINTS, `etapa2-link-cliente-${sufixo}.png`), fullPage: true });
  expect(errosPub).toEqual([]);
  await pub.close();

  // PDF da OS (vira imagem para o print) — só uma vez
  if (cel) {
    const b64 = await page.evaluate(async id => { const doc = await Pdf.ordem(Store.osById(id)); return doc.output('datauristring').split(',')[1]; }, os.id);
    const arq = path.join(PRINTS, 'etapa2-os.pdf'); fs.writeFileSync(arq, Buffer.from(b64, 'base64'));
    const paginas = Number(/Pages:\s+(\d+)/.exec(execFileSync('pdfinfo', [arq]).toString())[1]);
    expect(paginas, 'PDF da OS sem fotos em 1 página').toBe(1);
    execFileSync('pdftoppm', ['-png', '-r', '80', '-f', '1', '-l', '1', arq, path.join(PRINTS, 'etapa2-pdf-os')]);
    const png = fs.readdirSync(PRINTS).find(f => f.startsWith('etapa2-pdf-os') && f.endsWith('.png'));
    expect(png).toBeTruthy();
    fs.renameSync(path.join(PRINTS, png), path.join(PRINTS, 'etapa2-pdf-os.png'));
    // cores do PDF (pela imagem): tem azul nas linhas e molduras, nada de dourado, sem fundo escuro
    const png64 = fs.readFileSync(path.join(PRINTS, 'etapa2-pdf-os.png')).toString('base64');
    const cores = await page.evaluate(async b64 => {
      const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
      const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height;
      const cx = cv.getContext('2d'); cx.drawImage(img, 0, 0);
      const d = cx.getImageData(0, 0, cv.width, cv.height).data; let azul = 0, dourado = 0, escuro = 0;
      for (let i = 0; i < d.length; i += 4) {
        const [r, g, b] = [d[i], d[i + 1], d[i + 2]];
        if (b > 150 && r < 90 && g < 130) azul++;
        if (r > 170 && g > 130 && b < 90 && r - b > 100) dourado++;
        if (r < 40 && g < 40 && b < 40) escuro++;
      }
      return { azul, dourado, escuroPct: escuro / (d.length / 4) };
    }, png64);
    expect(cores.azul).toBeGreaterThan(200);
    expect(cores.dourado).toBe(0);
    expect(cores.escuroPct).toBeLessThan(0.05);   // só texto; nada de faixas pretas (economiza tinta)
  }
  expect(erros).toEqual([]);
});

test('e-mail de pedido: branco e azul, com o WhatsApp certo', async ({ page }, info) => {
  test.skip(info.project.name !== 'celular', 'uma vez basta');
  const html = psql(['-tA', '-c', `select public.html_pedido('{"numero":7,"nome":"Ana Lima","telefone":"48 99115-4821","marca":"Chevrolet","modelo":"Onix","ano":"2019","defeito":"Barulho ao frear","urgencia":"alta"}'::jsonb, 'https://app.exemplo.com.br', 'pt')`], BANCO);
  expect(html).toContain('https://wa.me/5548991154821');
  expect(html).not.toMatch(/d4af37|#000;|background:#000/i);
  const chile = psql(['-tA', '-c', `select public.html_pedido('{"nome":"Pedro","telefone":"56912345678","modelo":"x","_brasil":false}'::jsonb, '', 'es')`], BANCO);
  expect(chile).toContain('https://wa.me/56912345678"');
  await page.setViewportSize({ width: 390, height: 700 });
  await page.setContent(html);
  await page.screenshot({ path: path.join(PRINTS, 'etapa2-email-pedido.png') });
  await contraste(page, 'e-mail');
});

test('cor própria da oficina (white-label) sobre fundo branco continua legível', async ({ page }, info) => {
  test.skip(info.project.name !== 'celular', 'uma vez basta');
  await criarContaEOficina(page, { email: emailNovo('cor'), oficina: 'Oficina Verde' });
  await semearOS(page);
  // a oficina escolheu um verde escuro como cor principal
  await page.evaluate(() => Tema.aplicar({ cor_primaria: '#166534', cor_secundaria: '#14532D', cor_fundo: '#FFFFFF', fonte: 'Inter', nome_exibicao: 'Oficina Verde' }));
  expect(await page.evaluate(() => Tema.validar({ cor_primaria: '#166534', cor_secundaria: '#14532D', cor_fundo: '#FFFFFF' }).ok)).toBe(true);
  await page.goto('/#/os'); await page.waitForTimeout(300);
  await contraste(page, 'tema próprio');
  await page.screenshot({ path: path.join(PRINTS, 'etapa2-white-label-celular.png') });
  // uma cor clara demais é recusada pela validação (não deixa salvar)
  expect(await page.evaluate(() => Tema.validar({ cor_primaria: '#FDE047', cor_secundaria: '#FACC15', cor_fundo: '#FFFFFF' }).ok)).toBe(false);
});

test('entrada do painel admin no tema novo', async ({ page }, info) => {
  const erros = vigiarErros(page);
  await page.goto('/admin-entrar.html');
  await expect(page.locator('body')).toContainText('Oficina Simples');
  await contraste(page, 'admin'); await semDourado(page); await semRolagemLateral(page);
  if (info.project.name === 'celular') await botoes44(page);
  await page.screenshot({ path: path.join(PRINTS, `etapa2-admin-${info.project.name}.png`) });
  expect(erros).toEqual([]);
});
