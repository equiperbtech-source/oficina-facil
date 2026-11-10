/* Cache offline do app */
const CACHE = 'oficina-v8';
const ASSETS = [
  './', 'index.html', 'manifest.webmanifest', 'css/style.css',
  'js/config.js', 'js/i18n.js', 'js/i18n-es.js', 'js/vendor/supabase.js', 'js/cloud.js', 'js/vendor/jspdf.umd.min.js', 'js/pdf.js',
  'acompanhar.html', 'js/acompanhar.js', 'js/pages/pedidos.js', 'js/pages/metas.js', 'js/pages/planos.js', 'js/pages/pagamento.js', 'js/pages/nfe.js', 'js/pages/followup.js', 'js/pages/vitrine-admin.js', 'js/pages/aparencia.js', 'vitrine.html', 'js/vitrine.js', 'pedido.html', 'js/pedido.js',
  'js/util.js', 'js/tema.js', 'js/store.js', 'js/veiculo.js', 'js/print.js', 'js/ui.js', 'js/app.js',
  'js/pages/dashboard.js', 'js/pages/os.js', 'js/pages/itens.js', 'js/pages/mecanico.js', 'js/pages/orcamentos.js', 'js/pages/cotacao.js', 'js/pages/fotos.js', 'js/pages/clientes.js',
  'js/pages/estoque.js', 'js/pages/vendas.js', 'js/pages/financeiro.js', 'js/pages/outros.js',
  'assets/oficina-simples.svg', 'assets/os-192.png', 'assets/os-512.png', 'assets/os-180.png',
];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS.map(a => new Request(a, { cache: 'reload' }))))); self.skipWaiting(); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});
// Rede primeiro (para receber atualizações), cache como fallback offline.
// Requisições para outros domínios (Supabase, fontes) não passam pelo cache.
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  // painel admin e rotas do servidor nunca vão para o cache offline
  if (u.pathname.startsWith('/api/') || u.pathname.startsWith('/admin')) return;
  e.respondWith(
    // no-cache: sempre confere com o servidor se o arquivo mudou (nunca usa versão velha guardada pelo navegador)
    fetch(e.request, { cache: 'no-cache' }).then(r => {
      if (r.ok) { const cp = r.clone(); caches.open(CACHE).then(c => c.put(e.request, cp)); }
      return r;
    }).catch(async () => (await caches.match(e.request, { ignoreSearch: true })) || (e.request.mode === 'navigate' ? caches.match('index.html') : Response.error()))
  );
});
