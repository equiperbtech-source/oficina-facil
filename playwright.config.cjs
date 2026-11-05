/* Testes de ponta a ponta (Playwright): celular 390×844 e computador.
   Antes de tudo, monta o banco de teste do zero e liga o Supabase de mentira (tests/servidor). */
const { defineConfig } = require('@playwright/test');
module.exports = defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  webServer: {
    command: 'node tests/servidor/supabase-falso.cjs',
    url: 'http://127.0.0.1:4173/index.html',
    reuseExistingServer: false,
    timeout: 60_000,
    stdout: 'ignore',
  },
  use: {
    baseURL: 'http://127.0.0.1:4173',
    serviceWorkers: 'block',
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'celular', use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } },
    { name: 'computador', use: { viewport: { width: 1280, height: 800 } } },
  ],
});
