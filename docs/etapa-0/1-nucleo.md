# Mapa 1: núcleo do app (Reparo Simples → Oficina Simples)

Base lida: `orig/reparo-simples` (somente leitura). Linhas citadas como `arquivo:linha` do original.
Obs.: o `js/config.js` do zip já vem em branco (`window.RBTECH_CONFIG = { supabaseUrl: '', supabaseAnonKey: '' }`).

---

## 1. Arquivo por arquivo

### js/store.js (335 linhas): banco local e regras de negócio
**O que faz hoje:** guarda tudo num objeto `Store.db` salvo no localStorage (`DB_KEY = 'rbtech_db_v1'`, :11). Define os status da OS (`OS_STATUS` :13-20), os cards da bancada (`Etapas` :28-61), papéis, formas de pagamento, tipos de aparelho, checklist, as configurações padrão (`defaultDB()` :79-124) e as regras de OS, financeiro, estoque e lotes (`Store` :126-333). `Store.save()` (:136) desfaz a alteração quando a loja está em somente leitura e chama `Cloud.schedule()`.

**O que muda:**
- `DB_KEY` :11 → `'oficina_db_v1'` (prefixo novo, ver seção 2).
- `OS_STATUS` :13-20: cores de tema escuro (`#60a5fa`, `#fb923c`, `#c084fc`, `#4ade80`, `#f87171`). Em fundo branco essas cores ficam abaixo de 3:1. Trocar pelos tons 600/700 (ex.: azul `#2563EB`, laranja `#D97706`, roxo `#7C3AED`, verde `#16A34A`, vermelho `#DC2626`). `pago` usa `#d4af37` + `pill: 'gold'` (:18): trocar por azul ou verde, e a pill `gold` por `blue` ou uma `primary` nova.
  - Rótulos: `concluido` 'Concluído' → **'Pronto para retirada'**. Os ids (`analise`, `peca`, `servico`, `concluido`, `pago`) devem ficar como estão, porque o SQL (`acompanhar_os`, migrações 15 e 26) e as OS já salvas usam esses ids.
- **Pátio (antiga bancada):** `ETAPAS_BASE` :26 = `['analise','peca','servico','concluido']`. O documento pede 5 etapas padrão, incluindo **"Aguardando aprovação"**, que **não existe** no original. Para isso é preciso criar o status base `aprovacao` em `OS_STATUS`, em `ETAPAS_BASE` :26, na ordem padrão de `Etapas.aplicar()` :46 (`['analise','peca','servico',...extras,'concluido']`, que deve ganhar `'aprovacao'` depois de `peca`) e em `OS_ATIVOS` :21, além do dicionário ES e da página `acompanhar`. `ETAPAS_FIXAS` :27 continua `['analise','concluido']`. `Etapas.CORES` :29 (`#facc15`, `#a3e635`, `#22d3ee` etc.) também são cores para fundo escuro: amarelo e verde-limão ficam ilegíveis no branco.
- `nomeForma` :63 'Aparelho na troca' → 'Veículo na troca' (ou tirar a troca, se o PDV da oficina não tiver isso).
- `GARANTIA_REPARO_DIAS` :65 / `GARANTIA_SEMINOVO_DIAS` :66 → garantia por **dias e km** (`garantia { dias, km }` da seção 7 do documento). `garantiaDiasOS` :236 e `garantiaFim` :237 só calculam por data. Falta `garantiaKm` e o texto "o que vier primeiro".
- `tipoProduto` / `ehCelular` :68-69 (seminovo/novo/acessório) → peça / acessório / veículo usado.
- `PAPEIS` :71 `tecnico: 'Técnico'` → **'Mecânico'** só no rótulo. O id `tecnico` deve ficar, porque o banco usa (`pode_gravar_colecao`, `definir_papel`) e aparece também em `cloud.js:318,326,407,468`, `app.js:41` e `store.js:258,265`.
- `TIPOS_APARELHO` :73-76 (celular, tablet, notebook...) → `TIPOS_VEICULO = [['carro','Carro','car'],['moto','Moto','moto']]`, com ícones novos em `util.js` `ICONS`.
- `CHECKLIST_ITENS` :77 (Liga, Tela, Touch, Face ID...) → listas padrão **por tipo** (carro/moto, seção 4.3), mais as personalizações da oficina.
- `defaultDB().settings` :83-102: `termosGarantia`, `termosGarantiaSeminovo`, `termosGarantiaProduto` e `termosEntrada` :93-96 precisam ser reescritos para oficina, e `PADROES_IDIOMA.es` :3-10 também. Campos novos: `tiposVeiculo`, `garantiaKm`, `revisaoPadrao` (km/meses por tipo), personalização do checklist. `tecnicos: []` :101 pode manter o nome interno (é a lista de mecânicos).
- `osTotal` :188 = `valor - desconto` e `osCustoPecas` :189 lê `o.pecas`. Os dois devem passar a somar `itensServico[]` + `itensPeca[]` (Total = mão de obra + peças − desconto). Isso afeta também `syncReceitaOS` :200-205 e `addReceita` :224/:257.
- `resumo()` :275-291 separa `os` e `vendas`, mas não separa **mão de obra × peças**. O lançamento da OS precisa guardar os dois valores (ex.: `l.maoObra`, `l.pecas`) para o relatório.
- `ehCompraEstoque` :292 regex `Compra de (estoque|aparelhos)` → incluir `veículos`.
- `setOSStatus` :206-231: a armadilha das metas **já está resolvida** (ver seção 4).
- `linkOS` :248 `/acompanhar/<token>`: sem mudança.
- Lotes e estoque (:297-332): sem mudança.

### js/cloud.js (560 linhas): Supabase, login, loja, plano e sincronização
**O que faz hoje:** faz login e cadastro no Supabase, carrega a loja do usuário (`carregarLoja` :128), assinatura, recursos e papel (`temRecurso` :319, `podeGravar` :322), tema (`carregarTema` :263), resolve a loja pelo endereço (`lojaDoHost` :292, `hostDesconhecido` :310) e sincroniza `Store.db` com a tabela `itens` (push/pull/realtime, merge de 3 vias :9-38, `mesclarMeta` :370).

**O que muda:**
- Marca e chaves: `SNAP_KEY 'rbtech_sync_snap'` :7, `window.RBTECH_CONFIG` :66,70,202, `'rbtech_loja'` :78,123, `'rbtech_loja_escolhida'` :136,152, `storageKey 'rbtech-novo-func'` :203, mensagem "Este e-mail já tem uma conta no Reparo Simples" :110, comentários com reparosimples.com :278,290,309.
- `setStatus` :362: a cor de "sincronizando" é `var(--gold)`. Com o tema novo, a variável troca de valor sozinha (ver seção 3). Os textos "salvo no aparelho" aqui falam do **celular/computador do usuário**, não do veículo. **Não podem virar "veículo"** (o mesmo vale para app.js:173,380,432,543,587).
- `SYNC_COLS` :4-5: sem mudança se os veículos ficarem dentro de `clientes` (como pede a seção 7). Uma coleção nova (ex.: `lembretes`) teria que entrar aqui **e** nas regras do SQL `pode_gravar_colecao` (espelhadas em `podeGravar` :322-330).
- `podeGravar` :327: `followups` depende do recurso `followup`. Lembretes de revisão (Pro) seguem a mesma regra.
- O motor de sincronização (`mesclar`, `stableStr`, `hash`, `push`, `pull`, `applyRow`, `onChange`) fica **sem mudança**.

### js/app.js (595 linhas): casca do app (login, cadastro, menu, rotas)
**O que faz hoje:** monta o menu (`NAV` :7-33), as rotas por plano e papel (`ROTA_RECURSO` :35, `MODULOS` :37-38, `ROTA_OCULTA` :40-43), a inicialização (`start` :50), a tela "loja não encontrada" (:104), "conta de outra loja" (:119), `bootCloud` :137, `garantirMoeda` :160, o login na nuvem (:416), o onboarding/criar loja (:495) e o login local (:552).

**O que muda:**
- `NAV` :11 `['bancada','Bancada','phone']` → rótulo **'Pátio'** e ícone de carro (pode manter a rota `bancada`, ou trocar por `patio` com cuidado em `MODULOS` :37, `updateNav` :387 e na página `os.js`). :20 `['aparelhos','Aparelhos','devices']` → 'Veículos à venda' (Pro/vitrine) ou sair do menu. `MODULOS` :37 e `ROTA_OCULTA.tecnico` :41 acompanham.
- Textos: :432 e :559 "gerenciar sua assistência" → "sua oficina". :501 "Crie sua loja", :509 "criar loja", :510 placeholder "Ex: Assistência do João" → "Ex: Oficina do João", :511 "Criar loja", :515, :536 "Loja criada!", :547 → oficina.
- **Cadastro "Que veículos você atende?"** entra em `renderOnboarding` :508-512, no formulário `#ob-criar`, e no submit :527-538, que deve gravar `Store.s.tiposVeiculo` junto com `Store.s.loja = f.nome` :534. O botão já fica desabilitado contra toque duplo (:529-530).
- `lojaNaoEncontrada` :104-116: "Loja não encontrada" → "Oficina não encontrada", "Entrar no Reparo Simples" :114 → `PLATAFORMA.nome`.
- `contaDeOutraLoja` :119-134: "Esta conta é de outra loja" → oficina.
- Ouro: :431, :441, :471, :500, :502 (`rgba(var(--gold-rgb), .5)` / `var(--gold-soft)`), :509, :514, :517 (`outline-gold`), :522 (`aviso-plano gold`), :558, :565, :587. Todos via classe/variável, então trocam com o tema.
- Chaves: `SESSION_KEY 'rbtech_session'` :2, `TEMA_HOST_KEY 'rbtech_tema_host'` :45, `'rbtech_loja'` :66,152,177, `'rbtech_loja_escolhida'` :272, `RBTECH_CONFIG` :54-55.
- `APP_VERSAO = '45'` :4 → reiniciar ('1'). `BUILD_ID '__BUILD_ID__'` :6 precisa continuar (o build.cjs procura esse marcador).
- Faixa de teste :55 (`#f59e0b` com texto `#000`): serve no tema claro, sem mudança.
- `garantirMoeda` :160-167: ver a armadilha da moeda na seção 4.

### js/util.js (190 linhas): formatação, moeda, datas, telefone, ícones
**O que faz hoje:** `esc`, moeda (`Moeda` :16-34, `money` :35, `parseMoney` :46, `moneyInput` :51), datas, `fmtPhone` :73, `maskDoc` :79, `prazoGarantia` :86, `waLink` :92-96, busca `matches` :98 e o conjunto `ICONS` :115-187.

**O que muda:**
- `Moeda.tela()` :20 converte a moeda **pelo idioma da tela** (ES → CLP, PT → BRL) e `fator()` :25 aplica a cotação. Esse é exatamente o "bug sério" da seção 12 (ver seção 4). Proposta: `tela()` = `base()`, `fator()` = 1, e tirar a busca de cotação (`atualizarCotacao` :26-33, chamada em `app.js:63`).
- `waLink` :92-96: põe `55` em qualquer número **sem "+"** de até 11 dígitos. A armadilha **não** está resolvida (ver seção 4).
- `rs_cotacao` :22,27,31: chave com prefixo antigo (sai junto com a conversão).
- `matches` :98 compara texto normalizado. Para buscar **placa** "com e sem hífen", falta uma normalização própria, ex.: `normPlaca = s => String(s||'').toUpperCase().replace(/[^A-Z0-9]/g,'')`, mais `validaPlaca` (Mercosul `^[A-Z]{3}\d[A-Z0-9]\d{2}$` e antiga `^[A-Z]{3}\d{4}$`) e `fmtPlaca`. O lugar natural dessas funções é este arquivo.
- `ICONS`: incluir `car`, `moto` e `gauge` (km) / `fuel` (combustível). Os ícones `phone`, `tablet`, `laptop`, `gamepad`, `watch` e `devices` (:120,128,167-171) deixam de ser usados no menu e no tipo.
- `maskDoc` e `fmtPhone`: sem mudança.

### js/ui.js (128 linhas): toast, modal, confirmação, dropdown, formulários, assinatura
**O que faz hoje:** `toast` :3, `openModal` :14, `confirmDialog` :39, `dropdown` :52, `pageHead` :71, `statusPill` :75-78, `readForm`, `field` :91 ("(opcional)"), `signaturePad` :101-118, paginação :120-128 ("Página X de Y").

**O que muda:** praticamente **sem mudança**. A tinta da assinatura `ctx.strokeStyle = '#111'` :106 e o fundo do `.sig-pad` (#fff, css:298) já servem no tema claro. Ponto de atenção: `signaturePad().toDataURL()` :116 gera PNG em base64, que vai para `o.assinaturaCliente` (os.js:383) e `Store.s.tecnicos[].assinatura` / `Store.s.assinaturaDono` (outros.js:713). Isso fica salvo no localStorage **e** dentro de `meta/settings` (ver seção 5).

### js/tema.js (91 linhas): marca da plataforma e white-label
**O que faz hoje:** `PLATAFORMA` :5-13 (logo, ícone, domínio, WhatsApp do suporte, nome PT "Reparo Simples" / ES "ReparaYa", `marcaTexto` com a 2ª palavra em dourado). `TEMA_PADRAO` :15 (dourado `#d4af37`/`#b8860b` em fundo `#000000`). `Tema.aplicar` :43-70 recalcula **todas** as variáveis CSS a partir das 3 cores da loja. Tem validação de contraste WCAG (`validar` :29-41).

**O que muda:**
- `PLATAFORMA.logo '/assets/reparo-simples.svg'` e `icone '/assets/rs-192.png'` :6 → arquivos novos. `dominio: 'reparosimples.com'` :7 → domínio novo (ainda não definido: pergunta para o dono). `suporteWhats: '(número do suporte do Reparo Simples)'` :8 → WhatsApp do suporte do produto novo (pergunta). `nome` :10 → 'Oficina Simples' (PT) e o nome em ES (pergunta). `marcaTexto` :12 → "Oficina <span class="gold">Simples</span>". A classe pode continuar `gold`, que passa a ser azul.
- `TEMA_PADRAO` :15 → `{ cor_primaria: '#1D4ED8', cor_secundaria: '#1E40AF', cor_fundo: '#FFFFFF', fonte: 'Inter' }`.
- **Atenção:** `Tema.aplicar(null)` (chamado em app.js:105 e :491) **sobrescreve as variáveis do `:root` do CSS** com valores calculados a partir de `TEMA_PADRAO` (:48-56). Ou seja, mudar só o `css/style.css` **não basta**: o tema calculado vai ganhar. Pior: o cálculo gera cinzas neutros (`misturar(fundo, texto, 0.04/0.07…)`) e não os tokens da seção 3 (`#F5F7FA`, `#E3E8EF`, `#0F172A`, `#64748B`). A proposta é tratar o caso "sem tema / tema padrão" removendo as propriedades inline (`root.removeProperty`) para valerem os tokens do CSS, e calcular só quando a oficina tem cores próprias.
- Em fundo claro, `--btn-texto` = `textoSobre('#1D4ED8')` dá branco (:52). Está certo.
- `--gold-grad` :51 gera um degradê. O documento fala em botão azul chapado (`#1D4ED8`, hover `#1E40AF`). Pode virar `linear-gradient(135deg, primaria, primaria)` ou um leve degradê azul.
- Comentários :83 ("logo do Reparo Simples") e :85 ("RB <gold>Tech</gold>").

### js/i18n.js (156 linhas): tradutor PT→ES
**O que faz hoje:** o texto em português é a chave. Em ES, um MutationObserver traduz o DOM, os atributos e o PDF (`pdf()` :70). O idioma vem da escolha salva (`rs_idioma` :11), do idioma da loja (`rs_idioma_loja` :28,57 ou `rbtech_loja.tema.idioma` :28), de `RBTECH_CONFIG.idiomaPadrao` :29 e, por fim, **'es' como padrão** (:29-30). As páginas públicas seguem o idioma da loja (:21).

**O que muda:**
- Chaves `rs_idioma`, `rs_idioma_loja`, `rbtech_loja` e `RBTECH_CONFIG` (:11,28,29,57).
- **Idioma padrão `'es'`** (:29-30, e o comentário :10 "espanhol é o principal"): no produto novo o público principal é o Brasil, então o padrão deve ser **'pt'** (pergunta para o dono). Também `idiomas: { es, pt }` :10 (ordem do botão).
- O mecanismo fica sem mudança.

### js/i18n-es.js (1657 linhas, só estrutura)
**Estrutura:** `I18N.dic.es = { ... }` (:4-697) em seções comentadas: marca/login (:5), primeiro acesso (:120), menu (:150), planos (:192), painel (:256), status da OS (:296), bancada (:304), detalhe da OS (:333), pagamento/garantia (:386), nova OS (:452), clientes (:546), acompanhamento (:568), vitrine (:612), idioma, WhatsApp (:662), genéricos (:677). Depois vem `I18N.regras.es = [...]` (:700) com regex, e vários blocos `Object.assign(I18N.dic.es, {...})` + `I18N.regras.es.push(...)` (metas :741, estoque :787, vendas :836, aparelhos :917, follow-up :954, vitrine :998, serviços, financeiro, caixa, notas, relatórios, configurações :1167, orçamentos :1342, importação :1390, cards da bancada ~:1615, desenho de desbloqueio :1640-1657). São cerca de 1440 entradas no total.

**O que muda:** o glossário do cabeçalho :3 (aparelho = equipo, bancada = taller) passa a ser veículo = **vehículo**, mecânico = **mecánico**, pátio = **patio** (ou "taller"), oficina = **taller**, peça = repuesto. A chave é o texto PT, então **toda chave cujo texto PT mudar precisa ser reescrita** (ex.: 'Bancada' :155, 'Aparelhos' :162, 'Aparelho' :338, 'Técnico' :343, 'aparelho' :531…). A palavra "aparelho" aparece 68× e "Aparelho" 16×, "técnico/Técnico" 37×, "bancada" 13×, "celular" 32×, "IMEI" 12×. Marca: :30, :84, :96 e :151 citam "Reparo Simples". O bloco do desenho de desbloqueio (~:1640-1657) sai. Os termos "Tienda no encontrada" (:11) e "tu servicio técnico" (:7) também mudam.

### css/style.css (463 linhas): todo o visual
**O que faz hoje:** tokens no `:root` :1-27 (fundo preto, dourado), layout, cards, botões, formulários, kanban, modal, toast, login, vidro (:380-444), fotos (:454-463).

**O que muda:** é o tema inteiro. Detalhes na seção 3. Pontos estruturais:
- Tokens :2-22 → valores da seção 3 do documento. Ideia: **manter os nomes `--gold*`** (usados em cerca de 87 lugares de `js/pages`, com classes `.gold`, `.outline-gold`, `.badge-gold`, `.pill.gold`, `.aviso-plano.gold`) e só trocar os valores. Outra opção é criar `--primary*` com `--gold*` como apelido. Renomear tudo é mais arriscado.
- Sombras e fundos pretos fixos (`rgba(0,0,0,.5–.72)`, 23 linhas) ficam pesados no branco: backdrop :88, :266, :418, :439, :369; sombras :252, :285, :327, :356, :370, :413, :416, :420, :435. Reduzir para algo como `rgba(15,23,42,.08–.18)`.
- O vidro :380-434 usa `color-mix(var(--text) 13%)` para a borda e `--glass-hi`. No fundo claro, `--glass-hi` (texto escuro 24%) vira uma **linha escura** no topo dos botões, quando o efeito pede um brilho branco. Trocar `--glass-hi` por `rgba(255,255,255,.7)` e `--glass-sombra` por algo suave.
- `.sig-pad` :298 (#fff): sem mudança. `.ft-rm` :459 (botão preto sobre a foto): pode ficar.
- **`hidden` + `.btn`:** `.btn { display: inline-flex }` :170 e só existe `.hidden { display:none !important }` :51. **Não há regra `[hidden]`**, então a armadilha da seção 12 continua possível. Adicionar `[hidden] { display: none !important; }`.
- Comentário/seletor de marca :347-348 `.login-logo[src*="reparo-simples"]` → nome do arquivo do logo novo.
- Cores de status :18-22 (`--green #4ade80`, `--red #f87171`, `--blue #60a5fa`, `--orange #fb923c`, `--purple #c084fc`) → sucesso `#16A34A`, erro `#DC2626`, alerta `#D97706`, azul `#2563EB`, roxo `#7C3AED`. Os `rgba(74,222,128…)`, `rgba(248,113,113…)` etc. em :157-161, :180, :286, :334-335, :399 acompanham.
- `.btn` tem `min-height: 46px` :172 (atende 44 px), mas `.btn.sm` :183 tem 36px e `.icon-btn` :73 tem 42px (38px no celular, :378). Ficam abaixo dos **44 px** pedidos no documento.

### index.html (60 linhas)
**Hoje:** `theme-color #000000` :6, `apple-mobile-web-app-status-bar-style black` :8, título "Reparo Simples" :9-10, ícones `assets/rs-192.png` / `rs-180.png` :12-13, ordem dos scripts :24-58 (inclui `js/pages/padrao.js` :41 e `aparelhos.js` :48).
**Muda:** `theme-color` → `#FFFFFF` (ou o azul), status bar `default`, título e ícones novos, sair `padrao.js` :41 (desenho de desbloqueio é removido no 4.2). `aparelhos.js` :48 sai ou é renomeado se virar "veículos usados". Se entrarem arquivos novos (ex.: `js/pages/veiculo.js`, `historico.js`), incluir aqui **e** no `sw.js`.

### sw.js (31 linhas)
**Hoje:** `CACHE = 'rbtech-v48'` :2, lista de arquivos em cache :3-11 (inclui `assets/reparo-simples.svg`, `rs-192/512/180.png` :10, `js/pages/padrao.js` :8). Rede primeiro, cache como reserva. Não guarda `/api/` nem `/admin`.
**Muda:** nome do cache (ex.: `'oficina-v1'`), lista de ativos (logos novos, tirar `padrao.js`/`aparelhos.js` se saírem, incluir páginas novas). A lógica fica sem mudança. Atenção: `addAll` falha inteiro se **um** arquivo da lista não existir, e aí o SW não instala.

### manifest.webmanifest (29 linhas)
**Hoje:** name/short_name "Reparo Simples" :2-3, description "Sistema para assistências técnicas de celular…" :4, `background_color`/`theme_color #000000` :9-10, ícones `rs-*.png` :13-26.
**Muda:** tudo isso. A descrição nova seria algo como "Sistema para oficinas de carro e moto: OS, pátio, estoque e clientes", com `#FFFFFF`/azul e os ícones novos 192/512 (maskable).

### scripts/build.cjs (57 linhas)
**Hoje:** roda `gerar-config.cjs`, copia para `dist/` só os arquivos públicos (`*.html`, manifest, sw, css, js, assets), minifica JS e CSS com esbuild (o `vendor/` não é minificado), troca `__BUILD_ID__` em `dist/js/app.js` e gera `versao.json`.
**Muda:** sem mudança. Só atenção: tudo dentro de `assets/` vai para o site, então os arquivos antigos (logo.jpg, icon-*.png, rs-*.png) devem ser **apagados** da pasta, e não só deixados de usar.

### scripts/gerar-config.cjs (59 linhas)
**Hoje:** gera `js/config.js` a partir de `RBTECH_SUPABASE_URL` / `RBTECH_SUPABASE_ANON_KEY`, com a trava `RBTECH_CONFIRMO_BANCO_PRODUCAO` (:20-31) e a validação de chave pública (:47). Escreve `window.RBTECH_CONFIG` (:52).
**Muda:** prefixo das variáveis de ambiente e do global (ex.: `OFICINA_SUPABASE_URL`, `window.OFICINA_CONFIG` ou um neutro `APP_CONFIG`) em :20,21,30,31,39,44,48,52, no `.env.example` :7-8 e no `middleware.js` :22. Lógica sem mudança. **Atenção:** a regra "produção sem variáveis mantém o js/config.js do repositório" (:24-26) faz sentido só se o `config.js` commitado for o do Supabase novo. Hoje ele está vazio, então a produção sem variáveis abre em "modo local".

### scripts/juntar-migracoes.cjs (14 linhas)
Gera `supabase/saas/TUDO.sql` com `NN_*.sql` sem os de reverter. **Sem mudança** (o texto do cabeçalho cita `supabase/schema.sql` como pré-requisito, então o TUDO.sql não é o banco completo, ver seção 5).

### package.json (12 linhas)
`"name": "rbtech-sistema"` :2 e a descrição "App da assistência" :5 → nome novo. `esbuild 0.24.2`: sem mudança.

### vercel.json (97 linhas)
Build, cabeçalhos (no-cache para `sw.js`/`versao.json`, `X-Frame-Options DENY`, noindex para `/admin`) e reescritas (`/acompanhar/:token`, `/pedido/:loja`, `/vitrine/:loja`, `/admin`). **Sem mudança.** Não há nada de domínio nem de marca.

### middleware.js (42 linhas)
**Hoje:** **só protege `/admin`** (matcher :4). Lê o cookie `rb_admin` (:39), confere `rpc/sou_super_admin` com a chave pública lida de `/js/config.js` ou de `RBTECH_SUPABASE_*` (:12-25) e, se a pessoa não for admin, reescreve para `/admin-entrar.html`.
**Muda:** cookie `rb_admin` → `os_admin` (também em `admin-entrar.html:35-38` e `js/admin.js:41,51,62`, fora da minha parte) e variáveis de ambiente :22. **Não trata subdomínios** (ver seção 5).

### assets/ (só listagem)
`icon-180.png`, `icon-192.png`, `icon-512.png`, `logo.jpg` (provavelmente marca RB Tech, sem uso nos arquivos que li), `reparo-simples.svg`, `rs-180.png`, `rs-192.png`, `rs-32.png`, `rs-512.png`. **Trocar todos** pelo logo novo (SVG + PNG 32/180/192/512) e **apagar os antigos** (o build publica a pasta inteira).

---

## 2. Marca, nome, domínio e chaves a trocar

| Arquivo:linha | Hoje | Trocar por |
|---|---|---|
| js/tema.js:6 | `logo '/assets/reparo-simples.svg'`, `icone '/assets/rs-192.png'` | logo/ícone novos |
| js/tema.js:7 | `dominio: 'reparosimples.com'` | domínio novo (pergunta) |
| js/tema.js:8 | `suporteWhats: '(número do suporte do Reparo Simples)'` | WhatsApp do suporte novo (pergunta) |
| js/tema.js:10 | `'ReparaYa' : 'Reparo Simples'` | nome PT/ES novo |
| js/tema.js:12 | `Repara<gold>Ya</gold>` / `Reparo <gold>Simples</gold>` | `Oficina <gold>Simples</gold>` |
| js/tema.js:4,83,85 | comentários "ReparaYa / Reparo Simples / RB Tech" | limpar |
| js/store.js:11 | `DB_KEY = 'rbtech_db_v1'` | `oficina_db_v1` |
| js/cloud.js:7 | `SNAP_KEY = 'rbtech_sync_snap'` | `oficina_sync_snap` |
| js/cloud.js:66,70,202 | `window.RBTECH_CONFIG` | global novo |
| js/cloud.js:78,123 | `'rbtech_loja'` | `oficina_loja` |
| js/cloud.js:136,152 | `'rbtech_loja_escolhida'` | `oficina_loja_escolhida` |
| js/cloud.js:203 | `storageKey: 'rbtech-novo-func'` | `oficina-novo-func` |
| js/cloud.js:110 | "…uma conta no Reparo Simples" | `PLATAFORMA.nome` |
| js/cloud.js:278,290,309 | comentários reparosimples.com | limpar |
| js/app.js:2 | `SESSION_KEY = 'rbtech_session'` | `oficina_session` |
| js/app.js:45 | `TEMA_HOST_KEY = 'rbtech_tema_host'` | `oficina_tema_host` |
| js/app.js:54-55 | `RBTECH_CONFIG?.ambiente` | global novo |
| js/app.js:66,152,177 | `'rbtech_loja'` | `oficina_loja` |
| js/app.js:272 | `'rbtech_loja_escolhida'` | idem |
| js/app.js:114 | "Entrar no Reparo Simples" | `PLATAFORMA.nome` |
| js/app.js:141,394 | comentários | limpar |
| js/app.js:4 | `APP_VERSAO = '45'` | `'1'` |
| js/util.js:22,27,31 | `'rs_cotacao'` | sai junto com a conversão de moeda (ou `oficina_cotacao`) |
| js/i18n.js:11 | `chave: 'rs_idioma'` | `oficina_idioma` |
| js/i18n.js:28,57 | `'rs_idioma_loja'`, `'rbtech_loja'` | prefixo novo |
| js/i18n.js:29 | `window.RBTECH_CONFIG?.idiomaPadrao` / padrão `'es'` | global novo / `'pt'` |
| js/i18n-es.js:30,84,96,151 | "Reparo Simples" (chave e valor) | nome novo |
| css/style.css:347-348 | `/* marca Reparo Simples */ .login-logo[src*="reparo-simples"]` | nome do logo novo |
| index.html:9,10 | "Reparo Simples" | nome novo |
| index.html:12,13 | `assets/rs-192.png`, `rs-180.png` | ícones novos |
| sw.js:2 | `CACHE = 'rbtech-v48'` | `oficina-v1` |
| sw.js:10 | `reparo-simples.svg`, `rs-*.png` | arquivos novos |
| manifest.webmanifest:2,3,4 | nome e descrição (celular) | novos |
| manifest.webmanifest:13,18,23 | `rs-192/512.png` | novos |
| package.json:2,5 | `rbtech-sistema`, "App da assistência" | novos |
| scripts/gerar-config.cjs:20,21,30,31,39,44,48,52 | `RBTECH_SUPABASE_URL/ANON_KEY`, `RBTECH_CONFIRMO_BANCO_PRODUCAO`, `window.RBTECH_CONFIG` | prefixo novo |
| middleware.js:22 | `RBTECH_SUPABASE_*` | prefixo novo |
| middleware.js:39 | cookie `rb_admin` | `os_admin` (e em admin-entrar.html e js/admin.js) |
| .env.example:7-8 | `RBTECH_SUPABASE_*` | prefixo novo |
| js/config.js:4 | `window.RBTECH_CONFIG` | global novo |
| assets/* | `reparo-simples.svg`, `rs-*.png`, `icon-*.png`, `logo.jpg` | apagar e criar novos |

Fora da minha parte, mas usam o mesmo global/chave: `RBTECH_CONFIG` em `admin-entrar.html:28`, `js/vitrine.js:11`, `js/pedido.js:13`, `js/admin.js:42`, `js/acompanhar.js:22`. `PLATAFORMA.dominio` em `js/pages/aparencia.js:90-115`. `rb_admin_tentativa` em `admin-entrar.html:35-37` e `js/admin.js:41`.

**Por que trocar as chaves do localStorage:** se o domínio novo for diferente, a origem também é, então não há colisão. Mesmo assim a troca vale, porque deixa o código limpo e evita confusão em testes no `localhost`, onde os dois apps compartilhariam a mesma origem.

---

## 3. Dourado e cores escuras

**Contagem:** a palavra `gold` aparece **138 vezes em 91 linhas** nos meus arquivos: css/style.css 108× (70 linhas), js/app.js 16× (13 linhas), js/tema.js 12× (6 linhas), js/store.js 1×, js/cloud.js 1×. No CSS: `var(--gold)` 38×, `rgba(var(--gold-rgb)…)` 31×, `var(--gold-soft)` 13×, `var(--gold-grad)` 9×. Em `js/` (incluindo pages, fora da minha parte) há **87 linhas** com classes `.gold`/`outline-gold`/`badge-gold`/`pill gold`/`'gold'`. Isso pesa a favor de manter os nomes e trocar os valores.

**Hex dourado fixo (12 linhas):**
- css/style.css:11 `--gold: #d4af37` · :12 `--gold-2: #f5d76e` · :13 `--gold-3: #b8860b` · :14 `--gold-rgb: 212, 175, 55` · :17 `--gold-grad: linear-gradient(135deg, #f7e08a, #d4af37, #a87d14)`
- css/style.css:199 seta do `select` em SVG com `stroke='%23d4af37'` (cor dentro da URL, **não segue a variável**)
- css/style.css:460 e :462 `var(--gold, #d4af37)` (reserva)
- js/store.js:18 `pago: color '#d4af37', pill 'gold'`
- js/tema.js:15 `TEMA_PADRAO { cor_primaria '#d4af37', cor_secundaria '#b8860b', cor_fundo '#000000' }`
- js/tema.js:49-51 variáveis `--gold*` geradas pelo `Tema.aplicar`

**Fundo escuro / tema escuro:**
- css/style.css:2-10 `--bg #000`, `--bg-2 #0b0b0b`, `--card #111`, `--card-2 #181818`, `--line #262626`, `--line-2 #333`, `--text #fff`, `--muted #a3a3a3`, `--muted-2 #737373` (9 tokens)
- css/style.css:16 `--btn-texto: #000`
- css/style.css:18-22 cores de status claras para fundo escuro (5 tokens) + rgba correspondentes :157-161, :180, :286, :334-335, :399
- css/style.css: **23 linhas com `rgba(0,0,0,…)`** (sombras e véus): :88, :252, :266, :285, :327, :356, :369, :370, :389, :393(2), :396, :398, :404, :411, :413, :416, :418, :420, :423, :435, :439, :459
- css/style.css:101 `#25d366` (WhatsApp, fica), :181/:400 `#16a34a` (sucesso, já bate com o documento)
- js/tema.js:15 `cor_fundo '#000000'`. index.html:6 `theme-color #000000`. manifest.webmanifest:9-10 `#000000` (2×)
- js/store.js:14-19 e :29 cores de status e de cards em tons claros (11 hex) para fundo escuro

**Gradientes (5):** css:17 (`--gold-grad`), :148 (`.hero` radial dourado + linear escuro), :291 (`.login` radial dourado), :395 (`.btn.primary` brilho + gold-grad), :422 (`.fab` idem), mais js/tema.js:51 (gerado). Também :400 `.btn.success`.

**Brilhos dourados (`rgba(var(--gold-rgb), …)` em sombra):** :90 (logo do menu), :120 (`.page-icon`), :177 e :396 (`.btn.primary`), :293 (`.login-logo` drop-shadow), :308 e :423 (`.fab`). Esses podem ficar (viram azul), mas em fundo branco convém reduzir a opacidade.

---

## 4. Sincronização, Etapas, settings, coleções e as armadilhas da seção 12

### 4.1 Como funciona a sincronização (cloud.js)
- Cada registro vira uma linha em `itens` `(loja_id, colecao, id, dados jsonb)`. As coleções estão em `SYNC_COLS` :4-5. `settings` e `seq` vão como `colecao='meta'`, `id='settings'|'seq'` (`META_KEYS` :6, `localMap` :380-385).
- `snap` guarda o "colecao:id" e o hash do que está no servidor. O push sobe o que tem hash diferente (:405) e apaga o que sumiu localmente (:407). O papel `tecnico` nunca apaga (:407, :468).
- **Coleções comuns (os, clientes…): o merge é por registro inteiro, e não de 3 vias.** No pull (:484-486), o que está pendente aqui fica com a versão local. Se não há pendência, vale o servidor. Duas pessoas editando a **mesma OS** ao mesmo tempo: quem sobe por último sobrescreve a OS inteira. O merge de 3 vias **só vale para `meta`** (`mesclarMeta` :370).
- **Merge de 3 vias (`mesclar` :15-38):** desce em objetos (:20-27) e em listas de objetos com `id` (:28-36). Listas sem id (ex.: `origens`, array de strings) são tratadas como valor único (:37). Quando os dois lados mudaram um valor simples, vale o local se há base, e o servidor se não há (:37).
- **Cópia profunda da base: SIM, já existe.** `const copia = v => JSON.parse(JSON.stringify(v)); // base nunca aponta para o objeto em uso` (:12). É usada em todo lugar que grava a base: :424 (depois do upsert), :478 e :483 (pull), :551 (realtime). A base fica salva em `SNAP_KEY` junto com o snap (`saveSnap` :367).
- **Ordem que evita "configurações voltando":** `start()` :334-352 sobe as pendências **sem a meta** (`push({semMeta:true})` :349), baixa tudo e só então libera a meta (`metaPronta=true` :492; `push` força `semMeta` enquanto `!metaPronta`, :396). Antes de subir a meta, busca a versão atual do servidor e mescla (:411-419). No realtime, se há mudança local pendente, mescla em vez de sobrescrever (:548-553).
- **`seq`:** fica sempre o maior número de cada contador (:371-375). `Store.next` :155-161 ainda confere o maior `numero` existente.
- **Veredito sobre a armadilha "configurações voltando sozinhas":** **está corrigida neste código** (cópia profunda + merge de 3 vias + meta só depois do download). Riscos que sobram:
  1. `Store.load()` (store.js:133) e `afterRemote()` (cloud.js:520) **preenchem os valores padrão que faltam** em `settings`. O resultado é que o local difere do servidor e o padrão **sobe para a nuvem** (mesclar :18: chave só no local → fica a local). Se o produto novo puser padrões grandes em settings (checklist por tipo, catálogo, `tiposVeiculo`), eles vão ser gravados no servidor por qualquer aparelho do dono e podem "congelar" o padrão antigo. **Recomendação:** guardar em settings só o que a oficina personalizou e calcular o padrão na leitura (ex.: `checklistDe(tipo) = s.checklist?.[tipo] ?? CHECKLIST_PADRAO[tipo]`).
  2. **`tiposVeiculo` deve ser gravado na criação da oficina, antes de `prepararLoja`/`Cloud.start`.** Hoje `app.js:533-534` grava `Store.s.loja` **depois** de `prepararLoja()`. Funciona porque o `push` posterior mescla, mas é preciso cuidar para não deixar o padrão `['carro','moto']` preenchido sozinho por `Store.load` vencer a escolha.
  3. Mudanças em listas sem `id` (ex.: itens de checklist como `['Freios','Pneus']`) são atômicas: dois aparelhos editando a mesma lista ao mesmo tempo, vale o último. Para checklist editável, usar uma lista de objetos com `id` (`[{id,nome}]`), que o `mesclar` junta item a item (:28).
  4. Assinaturas em base64 dentro de `settings` (`tecnicos[].assinatura`, `assinaturaDono`, outros.js:713) deixam a meta grande. Toda alteração em settings reenvia tudo (o merge e o hash rodam sobre o objeto inteiro).
- O **teste "dois aparelhos editando ao mesmo tempo"** pedido no documento continua valendo: fazer com Playwright, com dois contextos de navegador na mesma oficina.

### 4.2 Etapas (bancada → pátio), store.js:22-61
- Configuração em `Store.s.etapas = { extras:[{id:'e_…',label,cor,removida}], ocultas:[…], ordem:[…] }` (:23). `extras` é uma lista com `id`, então o merge é item a item. `ocultas` e `ordem` são listas de strings, então valem inteiras (vale a última edição).
- `aplicar()` :36-50 reconstrói `OS_STATUS`/`OS_ATIVOS` e é chamado a cada `render`/`refresh` (app.js:230, :244). Cards apagados continuam com o nome guardado (`statusNome`/`statusCor` na OS, :43 e :212).
- Máximo de 8 cards extras (`MAX` :30). Fixos: `analise` e `concluido` (:27).
- **Para o pátio:** falta o card base "Aguardando aprovação" (ver seção 1). Uma alternativa sem mudar o código base seria criar um card extra padrão `e_aprovacao`, mas ele poderia ser removido pela oficina e não teria ligação com a aprovação de orçamento. Recomendo criar um id base `aprovacao`. "Pronto para retirada" = rótulo novo de `concluido`.

### 4.3 Settings padrão (store.js:83-102)
`loja, responsavel, cnpj, telefone, endereco, instagram, metaMensal 50000, diasTrabalho 26, garantiaDias 90, termosGarantia, termosGarantiaSeminovo, termosGarantiaProduto, termosEntrada, taxaDebito 1.5, taxaCredito 3.5, exigirCaixa false, origens [6], tecnicos []`.
Campos que aparecem em runtime sem estar no padrão: `moedaBase` (app.js:165), `etapas` (store.js:58), `modulos` (app.js:250), `assinaturaDono` (outros.js:713).
A acrescentar: `tiposVeiculo`, `garantiaKm`, personalização do checklist por tipo, padrão de revisão por tipo (km/meses).

### 4.4 Modelo das coleções (defaultDB :103-123)
`seq {os,orc,venda}`, `clientes, os, orcamentos, pecas, fornecedores, movEstoque, produtos, vendas, servicos, lancamentos, caixas, auditoria, pedidos, lotes, nfe_entradas, followups, metas_func, pedidos_vitrine`. É o mesmo que `SYNC_COLS`. O documento lista "os, clientes, pecas, produtos, vendas, orcamentos, lancamentos, meta/settings…", o que confere. Registros apagados usam `deleted: true` em vários lugares (`clientesAtivos` :165, `lancs` :272), além do apagar de verdade via sync.
Campos de OS que o núcleo usa: `id, numero, criadoEm, criadoPor(Nome), historico[], status, statusNome/Cor, valor, desconto, pecas[{custo,qtd}], pagamento{forma,data}, pagoEm, concluidoEm, concluidoPor(Nome), entregueEm, garantiaDias, token`. O resto (aparelho, defeito, checklist, fotos…) fica nas páginas.

### 4.5 Armadilhas da seção 12: confirmação pelo código
| Armadilha | Situação no código | Prova |
|---|---|---|
| Configurações voltando sozinhas (merge 3 vias + cópia profunda) | **Corrigida** | cloud.js:12 `copia`, :15-38 `mesclar`, :349 + :396 meta só depois do pull, :411-419, :548-553. Riscos que sobram listados em 4.1 |
| Metas: OS direto para "Pago" registra quem finalizou | **Corrigida** | store.js:215-222 (`marcarQuem()` também em `pago`) |
| Moeda é da oficina, nunca do idioma | **NÃO corrigida**: a tela ainda converte pelo idioma | util.js:20 `tela()` = CLP se `I18N.idioma==='es'`. :25 `fator()` usa a cotação. :35 `money()` multiplica. :46 `parseMoney` divide. app.js:63 baixa a cotação. A **base** é correta (`moedaBase` da loja, util.js:19, decidida sem olhar o idioma da tela em app.js:157-166, exceto na loja **nova**, :162, que usa o idioma do cadastro). Mas um dono brasileiro (BRL) que troca a tela para ES vê os valores convertidos para pesos. Correção: `tela()` → `base()` e `fator()` → 1 |
| Cadastro duplicado | **Parcial no front** | app.js:529-530 desabilita o botão e ignora o toque duplo. A trava no banco está no SQL `criar_loja` (fora da minha parte) |
| Subdomínio inexistente | **Corrigida no front, com ressalvas** | app.js:69: só quem **não** está logado vê "loja não encontrada". cloud.js:310-316: `hostDesconhecido` só dá `true` quando o RPC responde "nenhuma loja" (com erro ou sem internet, abre normal). Ressalva: quem **já está logado** e abre um subdomínio inexistente entra no sistema (`bootCloud` :142-143 só barra quando o host é **de outra** loja). Depende de `PLATAFORMA.dominio` correto (tema.js:7), senão a checagem fica desligada (cloud.js:312) |
| Telefone do WhatsApp sem "+" ganhando 55 | **NÃO corrigida** | util.js:94: `if (d && !phone.startsWith('+') && d.length <= 11) d = '55' + d`. Um número chileno digitado sem "+" (`56912345678`, 11 dígitos) vira `5556912345678`. O mesmo vale para os números locais do Chile (9 dígitos). Fora do núcleo, `js/vitrine.js:63,135` repete a regra à mão (`zap.length <= 11 ? '55'+zap`). Correção: só pôr 55 quando a oficina for do Brasil (moeda BRL/idioma da oficina) **e** o número tiver 10-11 dígitos com DDD válido. Se tiver 12-13 dígitos, ou o país da oficina não for o Brasil, não mexer |
| `hidden` + `.btn` | **Risco presente, sem uso problemático hoje** | css:170 `.btn{display:inline-flex}` vence o `[hidden]` do navegador e não existe regra `[hidden]{display:none!important}` (só `.hidden` em :51). Os `hidden` atuais no código estão em `<input type=file>` dentro de `label.btn` (o input não é `.btn`), então não quebram. Basta um `<button class="btn" hidden>` novo para aparecer. Correção: incluir `[hidden]{display:none!important}` no CSS |
| Fotos nunca no localStorage | Fora do núcleo (fotos.js) | No núcleo não há foto, mas as **assinaturas** em base64 vão para o localStorage e o jsonb (ui.js:116 → os.js:383, outros.js:713) |

---

## 5. Riscos e o que no documento não bate com o código

1. **"middleware.js trata subdomínios" (seção 1): falso.** O `middleware.js` só protege `/admin` (matcher :4). Os subdomínios são resolvidos **no navegador** (`Cloud.lojaDoHost` cloud.js:292 via RPC `loja_por_host` / `loja_por_slug`, e `PLATAFORMA.dominio`). Para o produto novo isso significa: domínio curinga na Vercel + `PLATAFORMA.dominio` + as funções SQL. Não há nada a mexer no middleware para subdomínio.
2. **Moeda × idioma: o documento diz que foi corrigido, mas o código ainda converte** (util.js:16-35). Decidir com o dono e corrigir já na Etapa 1/2.
3. **WhatsApp 55: o documento diz para não repetir, mas a regra ainda está ativa** (util.js:94, vitrine.js).
4. **`Tema.aplicar` sobrescreve os tokens do CSS** (tema.js:48-58). Trocar só o `style.css` não entrega o tema da seção 3: é preciso mexer em `TEMA_PADRAO` e na geração das variáveis. Os cinzas calculados não batem com `#F5F7FA`/`#E3E8EF`/`#64748B`.
5. **Idioma padrão do app é espanhol** (i18n.js:29-30, "espanhol é o principal"). O produto novo é para o Brasil. Trocar o padrão para `pt` (pergunta para o dono se o foco ES/Hotmart continua).
6. **"Aguardando aprovação" não existe** como etapa base (store.js:26). Precisa de status novo, com reflexo em `acompanhar_os` / página do cliente / ES.
7. **Merge de OS não é de 3 vias:** só a `meta` mescla campo a campo. Duas pessoas editando a mesma OS (ex.: mecânico mexendo no checklist enquanto o atendente lança peças) → vale a última gravação inteira. Com OS maiores (mão de obra × peças, checklist, km), o risco aumenta. Avaliar usar `mesclar` também para `os` (o código já suporta listas com `id`) ou, no mínimo, testar.
8. **"aparelho" tem dois sentidos no código:** o aparelho do cliente **e** o celular/computador de quem usa o sistema ("salvo no aparelho", "este aparelho tem dados…", cloud.js:362, app.js:173,380,432,543,587, i18n-es 'aparelho': 'equipo' :531). Uma troca automática "aparelho→veículo" quebra esses textos. A troca tem que ser manual. Para o segundo sentido, usar "neste celular/computador" ou "neste dispositivo".
9. **ID `tecnico` precisa ficar:** é valor de papel no banco (`definir_papel`, RLS `pode_gravar_colecao`). Mudar só o rótulo.
10. **Settings com padrões grandes sobem para a nuvem** (store.js:133 / cloud.js:520). Ver 4.1, item 1.
11. **Assinaturas base64 em `settings` e na OS** (ui.js:116). Vão para o localStorage (limite de ~5 MB) e para cada sincronização da meta. É o mesmo tipo de problema da armadilha das fotos. Avaliar mover para o bucket privado.
12. **Botões abaixo de 44 px:** `.btn.sm` 36px (css:183), `.icon-btn` 42/38px (css:73, :378), `.qty button` 34px (css:303), `.seg button` (css:217). O documento pede 44 px.
13. **Contraste:** as cores de status (store.js:14-19, css:18-22) e os cards (store.js:29) foram pensadas para fundo preto. Em branco, `#4ade80` (≈1,9:1) e `#facc15` (≈1,5:1) falham na AA. `Tema.validar` (tema.js:29) mede só a cor principal, não os status.
14. **Seta do `select` com o dourado dentro do SVG** (css:199): não segue a variável, precisa ser trocada à mão (ou trocar o SVG por `mask` + `background-color: var(--gold)` para seguir o white-label).
15. **`sw.js` `addAll`:** se algum arquivo listado (ex.: `padrao.js` removido) continuar na lista, a instalação do service worker falha e o app perde o modo offline. Atualizar a lista junto com o `index.html`.
16. **`assets/` é publicado inteiro** (build.cjs:43). Apagar os logos antigos (`logo.jpg` e `icon-*.png` parecem ser da marca RB Tech).
17. **`gerar-config.cjs` em produção sem variáveis mantém o `js/config.js` do repositório** (:24-26), que no zip está **vazio**. A produção abriria em modo local, sem nuvem. Para o produto novo, ou se faz commit do `config.js` com a URL/chave pública do Supabase novo, ou se configuram as variáveis + a confirmação na Vercel.
18. **Busca por placa:** `matches()` (util.js:98) não ignora hífen/espaço. "ABC-1234" não acha "abc1234". Precisa de uma normalização própria (ver util.js na seção 1).
19. **`TUDO.sql` depende de `supabase/schema.sql`** (juntar-migracoes.cjs:9). O critério "TUDO.sql roda duas vezes" não cobre o banco do zero. No banco novo, rodar `schema.sql` + `TUDO.sql`, ou incluir o schema no TUDO.
20. **Perguntas para o dono que saem desta parte:** nome final em PT e ES (tema.js:10), domínio (tema.js:7), WhatsApp do suporte (tema.js:8), idioma padrão (i18n.js:29), se a moeda deixa de converter pelo idioma (util.js:20), se fica a "troca" de veículo no PDV (store.js:63), se "Veículos à venda" substitui a tela Aparelhos (app.js:20).
