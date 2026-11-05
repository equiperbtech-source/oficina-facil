# Mapa 3: vendas, estoque, financeiro, configurações, planos, vitrine (Reparo Simples → Oficina Simples)

Base lida: `scratchpad/orig/reparo-simples` (somente leitura). Todos os caminhos abaixo são relativos a essa pasta.
Arquivos lidos por inteiro: `js/pages/outros.js` (811 l.), `js/pages/vendas.js` (535), `js/pages/estoque.js` (208), `js/pages/financeiro.js` (199), `js/pages/metas.js` (322), `js/pages/nfe.js` (162), `js/pages/notas.js` (152), `js/importar.js` (227), `js/pages/planos.js` (186), `js/pages/pagamento.js` (60), `js/pages/aparencia.js` (139), `js/pages/vitrine-admin.js` (180), `js/vitrine.js` (139), `vitrine.html` (47). `js/i18n-es.js` (1657 l.) avaliado por estrutura e contagens.
Também conferi, para checar o documento: `js/store.js` (constantes, totais da OS, financeiro), `js/app.js:37` (MODULOS), `js/print.js:98`, `js/pdf.js:191/441`, `js/pages/os.js:438-441`, `supabase/saas/02_planos.sql`, `03_modulos.sql`, `15_garantia_os.sql`, `26_cards_bancada.sql`, `api/notas/*`.

---

## 1. Arquivo por arquivo

### 1.1 `js/pages/outros.js` — Follow-up/pós-venda, Serviços, Relatórios e Configurações

**O que faz hoje:** quatro telas num arquivo só: `Pages.posvenda` (rota Follow-up), `Pages.servicos` (catálogo), `Pages.relatorios` e `Pages.config` (Configurações inteira, incluindo equipe, e-mail, backup, senha, importação). Não tem caixa (está em `financeiro.js`) nem checklist (não existe tela para isso).

Seções, com linhas:

| Bloco | Linhas | O que tem | O que muda para a oficina |
|---|---|---|---|
| `MSG_MODELOS` | 6-22 | 3 mensagens editáveis: feedback de reparo (7 dias), feedback de **compra de celular** (7 dias, "garantia de 6 meses"), **oferta de capa e película** (30 dias). Variável `{aparelho}`. | Feedback de serviço (`{veiculo}`, `{placa}`); trocar "compra de celular" por "compra de veículo usado" (só se a vitrine de usados existir) ou tirar; **trocar a oferta de capa/película pelo lembrete de revisão** (doc 6.3). Variável `{aparelho}` → `{veiculo}`/`{modelo}`/`{placa}`. |
| `PosVenda.compras/feedback/oferta` | 24-60 | Lista OS pagas + vendas com item `seminovo`/`aparelho`; feedback 7-60 dias, oferta 30-120 dias. | Fonte vira OS pagas (e venda de veículo usado). Oferta → lembretes por `proximaRevisao { data, km }` (doc 7). Contagem por km não é possível sem km atual: só por data, ou estimativa km/dia. |
| `Pages.posvenda.render` | 62-100 | Abas: Agenda (`Followup.render`, de `followup.js`), Feedback 7 dias, **Capa/película 30 dias**, Não retirados (concluído há ≥3 dias), Garantia acabando (OS + **seminovos 180 dias**, l. 71), Aniversariantes. Mensagens fixas em código nas l. 89-90 (garantia "do seu *{aparelho}*", aniversário "desconto em serviço ou acessório"). | Aba "Capa/película" → "Revisão chegando" com a mensagem do doc 6.3. "Não retirados" → "Veículos prontos no pátio" (texto "Seu veículo está pronto para retirada"). "Garantia acabando": usar garantia por prazo **e** km (`Store.garantiaFim` só conhece data). |
| `campanha`, `editarMsg` etc. | 102-191 | Lista de envio, "Pular", "Desfazer", editor com prévia (fundo escuro fixo `#0b1a12`, l. 176). Textos: "Como está indo o aparelho?" (109), "Compra de celular" (121), "Mensagem p/ compra de celular" (111). | Reescrever os textos; prévia em fundo claro. |
| `Pages.servicos` | 193-232 | Catálogo (nome, preço, categoria). **Garantia "3 meses" é só texto fixo** (l. 204 e 213), não é dado do serviço. Começa **vazio**; `exemplos()` (227-231) carrega 12 serviços de celular só quando o dono toca "Carregar exemplos" (l. 200). Placeholder "Troca de tela iPhone 11" (212), categorias "Tela, Bateria, Software" (214). | **Catálogo padrão por tipo** (doc 4.5): criar ao cadastrar a oficina conforme `settings.tiposVeiculo`; cada serviço com `tipo: 'carro'|'moto'|'ambos'`, `preco` (mão de obra), `garantia { dias, km }` de verdade, e talvez `tempoEstimado`. Ver lista proposta em 1.1.1. |
| `Pages.relatorios` | 234-282 | Período (usa `FinPage.range`), OS abertas/pagas, ticket médio, vendas; barras: serviços mais realizados, **"Aparelhos mais atendidos"** (260), produtos mais vendidos, origem do cliente, OS por status, **"Faturamento por técnico"** (264, usa `Store.s.tecnicos` + `o.tecnicoId`). CSV de OS com colunas **Aparelho, IMEI** (275, 278). | "Veículos mais atendidos" (marca/modelo), "Faturamento por mecânico" (somar só a mão de obra dos itens de serviço de cada mecânico), novo cartão **"Mão de obra × peças"** do período (doc 6.1). CSV: Placa, Veículo, Km entrada, Mão de obra, Peças, Custo peças (tirar IMEI). |
| `Pages.config.topicos` | 285-314 | Cada cartão vira sanfona; lembra abertos em `localStorage` `rs_cfg_abertos`. | Mantém. Trocar prefixo `rs_` se quiser separar do produto antigo (mesmo domínio não acontece, então é cosmético). |
| Config: Idioma e moeda | 319-326 | Idioma do aparelho, idioma da loja, moeda BRL/CLP. | Mantém ("oficina"). Texto da l. 324 fala em conversão pela cotação: conferir com a armadilha 12 (moeda é da oficina). |
| Config: Dados da loja / Metas e taxas / Formato dos PDFs / **Garantia e termos** | 327-350 | Nome, responsável, CNPJ, telefone, Instagram, endereço, link Google; meta mensal, dias trabalhados, taxas débito/crédito; papel A4/80/58 mm; garantia padrão de reparo em dias (343), **"Seminovos 6 meses" fixo** (344), termos de garantia de reparo (345), **de seminovos** (346), **de celulares novos e acessórios** (347), termos de entrada (348). Salvar em 496-501. | Garantia padrão por **prazo e km** (`garantiaDias` + `garantiaKm`, padrão "3 meses ou 3.000 km"). Tirar seminovos (344, 346) ou trocar por "veículos usados" (se a vitrine de usados entrar). 347 → "peças e produtos vendidos no balcão". Termos de entrada reescritos para veículo (objetos deixados no veículo, prazo de retirada, autorização de test-drive). **Novo cartão "Checklist de entrada"** aqui (doc 4.3) e **"Tipos de veículo atendidos"** (doc 4.1). |
| `Aparencia.cardHTML()` | 352 | White-label (ver 1.11). | — |
| `Cotacao.cardHTML()` | 354 | Cartão da cotação (outro arquivo). | — |
| Config: Módulos | 356-361 | Liga/desliga módulos (Pro, `modulos_personalizaveis`); lista `MODULOS` em `js/app.js:37` inclui `bancada`, `aparelhos`, `notas`. | Renomear rótulos (Pátio, Veículos usados…); tirar `aparelhos` e `notas` se saírem. |
| Config: **Técnicos e assinaturas** | 363-370, 502-509 | Lista `s.tecnicos` (nome + assinatura desenhada), assinatura do dono. Ids são `uid()` locais, **não são os usuários da equipe**. | "Mecânicos e assinaturas". Ver risco R5 (metas por mecânico). |
| Config: Como conheceu | 372-376 | Origens do cliente. | Mantém. |
| Config: **Importar do sistema antigo** | 378-383, 512-514, 550-604 | Importa PDF de clientes e "Dossiê" CSV do **Reparo Pro** (texto visível na l. 380). | **Remover** (ver 1.8). |
| Config: só leitura p/ funcionário | 384-393 | Mostra dados da loja. | Textos. |
| Config: Backup | 396-402, 721-742 | Baixar/restaurar JSON. **Nome do arquivo `backup-rbtech-...json`** (724). | `backup-oficina-...json`. |
| Config: Link de pedido de orçamento | 404-409 | Texto: cliente preenche "marca, modelo, defeito e urgência". | Acrescentar placa e km (página em `pedido.js`, de outro mapa). |
| Config: **Equipe e nuvem** | 411-439, 515-547, 606-651 | Membros, troca de loja, endereço (subdomínio), adicionar funcionário com senha ou convite por e-mail, papel **Atendente / Técnico** (425, 623), código de convite, aprovar pedidos, ativar/desativar, sino de e-mail. | Rótulo "Mecânico" para o papel interno `tecnico` (manter a chave `tecnico`, que o banco usa). Texto 425: "Mecânico: só OS, pátio, estoque e clientes". |
| Config: Aviso por e-mail | 441-460, 652-688 | Brevo (chave própria opcional). Texto **"Enviando pelo Reparo Simples"** (655). | "Enviando pelo Oficina Simples" (nome configurável). |
| Config: Nuvem desligada, Acesso, Zona de perigo | 462-480 | Avisos, senha, e-mail (troca com aviso de e-mail da compra, 766-797), auditoria, versão, sair, apagar tudo. | Só textos ("aparelho" aqui significa o celular/computador do usuário: **não trocar por veículo**, ver R4). |

#### 1.1.1 Catálogo padrão proposto (doc 4.5), para trocar `exemplos()` (outros.js:227-231)
- **Carro:** Troca de óleo e filtros · Revisão · Pastilhas e discos de freio · Suspensão · Alinhamento e balanceamento · Elétrica · Injeção eletrônica · Ar-condicionado · Embreagem · Arrefecimento · Diagnóstico (scanner).
- **Moto:** Troca de óleo · Revisão · Relação (coroa, pinhão e corrente) · Pastilhas de freio · Pneus · Regulagem · Elétrica · Injeção/carburador · Embreagem · Suspensão.
- Preço inicial **0** (ou "a definir") é mais seguro que inventar preço; o dono edita. Criar uma vez na criação da oficina (idempotente: marcar `settings.catalogoCriado = true`) e também quando ele ligar um tipo novo em Configurações.

#### 1.1.2 Checklist editável nas Configurações (doc 4.3)
Não existe hoje: os itens estão fixos em `CHECKLIST_ITENS` (`js/store.js:77`: "Liga, Tela, Touch, Câmera…"). A OS guarda `o.checklist` como objeto `{ nomeDoItem: 'ok'|'nok' }` (`js/pages/os.js:438-441`), mas a impressão e o PDF **percorrem a constante**, não o que está na OS (`js/print.js:98`, `js/pdf.js:443`). Proposta: `settings.checklist = { carro: [...], moto: [...] }` com os padrões do doc, cartão novo em `Pages.config` (adicionar, renomear, tirar, reordenar por tipo), e print/PDF passam a percorrer as chaves gravadas na própria OS (assim OS antigas continuam certas depois que a lista muda). Estado "não verificado" = item ausente (já é assim). Nível de combustível fica fora do checklist (campo próprio `combustivel`).

---

### 1.2 `js/pages/vendas.js` — PDV (Venda de Produtos)

**O que faz hoje:** tela "Venda de Produtos" com abas Vender / Cadastro / Histórico. Mostra só **celulares em estoque** sem busca (l. 64-68); acessórios só aparecem buscando. Carrinho, "Nova venda" (modal com produtos, cadastro na hora, vendedor, cliente, **aparelho na troca**, desconto, forma), recibo (PDF/impressão/WhatsApp), **termo de garantia de 6 meses do seminovo** em PDF, cancelamento que devolve estoque e desfaz a troca.

Pontos com linha:
- Estado/filtro `cat: '' | 'seminovo' | 'novo'` (3), resumo "Celulares em estoque" e "VALOR DOS CELULARES EM ESTOQUE" (37-43), busca "celular ou acessório" (44), abas "Todos os celulares/Seminovos/Novos" (46), botões "Cadastrar celular/acessório" (50-51).
- Cartão do produto com pills "Seminovo · 6 meses", armazenamento, 🔋 bateria, IMEI (76).
- `itemDe` e `add` copiam `seminovo`, `aparelho`, `imei`, `garantiaDias` 180/365/90 (124, 131).
- `registrar()` (138-165): baixa estoque, grava `vendedorId` (meta), **troca** via `AparelhosPage.entrarNoEstoque` (153), receita "Aparelho na troca" com `forma: 'troca'` (160), despesa "Compra de aparelhos" (161). É também usada pela vitrine (`vitrine-admin.js:147`).
- Modal Nova venda: troca de aparelho (187-189, 332, 347), "Quem vendeu o aparelho?" só aparece se há celular no carrinho (231-242), equipe guardada em `localStorage` `rbtech_equipe_<loja>` (244), cadastro rápido que adivinha celular por regex de marcas (273, 288), campos IMEI/armazenamento/bateria (278-279), aviso "Venda de celular seminovo sem cliente" (357), categorias "Celulares seminovos/novos" (363).
- Aba Cadastro (434-492): tipos Celular seminovo/novo/Acessório, IMEI único em estoque (476-477).

**O que muda para a oficina:**
- PDV de **balcão**: óleo, aditivo, palheta, lâmpada, acessórios, peças avulsas. Tipos de produto: `produto` (balcão) e, opcional no Pro, `veiculo` (veículo usado à venda). Tirar `seminovo/novo celular`, IMEI, armazenamento, bateria, "Saúde da bateria".
- Sem busca, mostrar os produtos mais vendidos/todos (não "só celulares").
- **Troca de aparelho → remover** (troca de veículo envolve documento/transferência, foge do escopo). Isso tira a dependência de `AparelhosPage` (153, 188, 347) e a forma `troca` no financeiro.
- "Quem vendeu" deve aparecer em **qualquer** venda (meta de vendas por vendedor do doc 5), não só quando tem celular (234, 369-370).
- Busca de cliente: acrescentar **placa** (l. 322 hoje busca nome, telefone, CPF).
- Decidir se o PDV também vende itens de `Store.db.pecas` (ver R10).
- Garantia de produto de balcão: dias (padrão 90) mantém; termo de garantia de seminovo (417-431) só se vender veículo usado.

---

### 1.3 `js/pages/estoque.js` — Estoque de peças (+ editor compartilhado com produtos)

**O que faz hoje:** lista de peças com custo do inventário, baixo estoque, histórico de movimentações, fornecedores (com WhatsApp), entrada em lote (lança despesa "Compra de estoque"), importar XML de NF-e, notas importadas, etiquetas, CSV. O mesmo `editar()` serve para produtos, com bloco de celular (tipo seminovo/novo/acessório, IMEI/Serial, cor, armazenamento, bateria, condição, status) (98-108).

**O que muda:**
- Textos: "peças de reparo e insumos técnicos" (10) → "peças e insumos da oficina"; placeholder "Tela iPhone 11 Incell" (83) → "Pastilha dianteira Onix 2019"; categorias "Tela, Bateria..." (86) → "Freio, Filtro, Óleo, Suspensão, Elétrica"; "Modelos compatíveis: iPhone 11, XR" (88) → "Veículos compatíveis: Onix 2017-2019, Prisma"; fornecedor "boa qualidade de telas" (189).
- Campos úteis para autopeças: **código do fabricante/OEM** (já há `codigo`), **marca da peça**, **unidade** (litro, unidade, kit; óleo vende fracionado) e **quantidade decimal** (hoje `parseInt` em 127, 166; o lote usa `type=number` inteiro). Ver R11.
- Bloco de celular do editor de produto (98-108, 115-123, 129): tirar ou trocar por campos de veículo usado (placa, ano, km, cor, combustível, câmbio) se a vitrine de usados entrar.
- Lote com validade (157) é útil (óleo/fluido). Mantém.

---

### 1.4 `js/pages/financeiro.js` — Financeiro e Caixa

**O que faz hoje:** `FinPage`: períodos, **lucro líquido**, margem, "A receber em bancada" (41), faturamento separado em **OS × Vendas** (44), custo de peças/produtos, taxas de cartão, despesas, compras de estoque (não reduzem lucro), recebido por forma, despesas por categoria, lançamentos, nova receita/despesa, CSV. `Pages.caixa` (103-199): abrir com troco, suprimento, sangria, fechar com conferência, histórico, "Exigir caixa aberto". Os números vêm de `Store.resumo` (`js/store.js:275-292`).

**O que muda / relatório mão de obra × peças:**
- Hoje a OS tem **um só valor** (`Store.osTotal = valor − desconto`, `store.js:188`) e o custo vem de `o.pecas[].custo` (`store.js:189`). A receita da OS é um lançamento com `valor` e `custo` (`store.js:224`, sincronizada em `syncReceitaOS`, 200-205). **Não existe** separação mão de obra × peças em lugar nenhum.
- Proposta: no lançamento da OS gravar também `maoObra` e `pecasValor` (desconto rateado proporcionalmente, como já é feito nas metas, `metas.js:37`), em `addReceita`/`syncReceitaOS`. `Store.resumo` soma `r.maoObra` e `r.pecas`; `FinPage` ganha um cartão "Mão de obra × Peças" ao lado de "OS × Vendas" (44); CSV ganha colunas. Lançamentos antigos sem os campos contam tudo como mão de obra (ou "não separado").
- Lucro = total − custo das peças − taxas (doc 6.1): já é a fórmula atual (`store.js:280-289`), só falta a separação.
- "A receber em bancada" → "A receber no pátio". Categorias de despesa (69): acrescentar "Ferramentas e equipamentos", "Descarte de óleo/resíduos", "Terceirizados (retífica, torno)".
- Forma `troca` (21, 59, 106) some se a troca sair do PDV.
- Caixa: sem mudança de regra.

---

### 1.5 `js/pages/metas.js` — Metas da loja e por funcionário

**O que faz hoje:** `Metas.cfg()` cria na primeira abertura (e **salva**) metas de celular: "iPhones / celulares" alvo 32, "Fone bluetooth", "Capa premium", "Película hidrogel", **lucro por aparelho R$ 400** (7-16). Tipo especial `celulares` conta qualquer venda com `aparelho/seminovo` (38, 48). Tela com progresso, projeção, zerar/ajustar contagem, cartão "Lucro por aparelho" (134-154), edição e escolha de produtos. `MetasEquipe` (272-322, Pro): por pessoa da equipe, **valor vendido**, **celulares vendidos**, **OS concluídas** (`concluidoPor || criadoPor`, l. 281: já trata a armadilha da OS que vai direto para "Pago", junto com `store.js:217-221`).

**O que muda (metas por mecânico/vendedor):**
- Metas padrão da oficina: faturamento de mão de obra no mês (R$), OS concluídas, ticket médio, e metas de produto (óleo, palhetas…) ligadas ao cadastro. Tirar o tipo `celulares` e o cartão "Lucro por aparelho" (ou trocar por "lucro médio por OS").
- Não criar metas de celular automaticamente (7-16 hoje grava no banco da loja na primeira abertura).
- `MetasEquipe`: "Celulares vendidos" (279, 298, 308) → "Mão de obra realizada (R$)" para mecânico; "Valor vendido" fica para vendedor. **Mecânico conta pelo `tecnicoId` dos itens de serviço**, não por quem clicou "Concluído" (ver R5).
- Recurso `metas` (Pro) cobre loja e equipe juntos; o doc só cita "metas por funcionário" como Pro. Perguntar se metas da oficina ficam no Essencial.

---

### 1.6 `js/pages/nfe.js` — Importar XML de NF-e de **compra** (entrada de estoque)

**O que é:** não emite nota. Lê o XML (layout 4.00) da nota que o **fornecedor** emitiu, mostra prévia, sugere item existente (EAN, código, nome), cria fornecedor pelo CNPJ, cada item vira um **lote**, evita importar a mesma chave duas vezes (local e na nuvem), lança despesa "Compra de estoque". Recurso `importar_xml` (Essencial).

**Faz sentido manter?** Sim, e muito: distribuidoras de autopeças mandam XML em toda compra. Mudanças pequenas:
- Destino padrão hoje é `novo:produto` (77) e o produto novo nasce `tipoProduto: 'acessorio'` (135). Na oficina o padrão deve ser **`novo:peca`**.
- Guardar `ncm` e `unidade` no item (já lidos na l. 22, hoje descartados) e aceitar **quantidade decimal** (óleo em litros; hoje `parseInt` na l. 106).
- Texto visível com "aparelho": nenhum (só a palavra "loja" em 5 textos).

### 1.7 `js/pages/notas.js` — Notas fiscais (emissão NFS-e / NF-e), plano **Pro Max**

**O que é:** franquia mensal + créditos avulsos, cadastro fiscal (CNPJ, IM, regime, código do serviço, ISS, IBGE, ambiente), envio do certificado A1 (não fica guardado), emissão da OS ou avulsa via `/api/notas/emitir` (`api/notas/emitir.js`, provedor em `api/_lib/fiscal.js`), lista com PDF/XML. O plano Pro Max está marcado **"em breve"** (`planos.js:19`), então hoje ninguém usa.

**Faz sentido manter?** Para oficina a nota é mais complexa: mão de obra é **NFS-e** (municipal, item 14.01 da LC 116 já cobre conserto de veículos, o placeholder da l. 107 serve) e peças vendidas são **NF-e/NFC-e** (ICMS). O código atual emite uma nota com um valor só (`notas.js:121-125`, valor = `Store.osTotal`), o que não serve para OS com peças. Recomendação: **copiar o código mas deixar desligado/"em breve"** (como já está) e tirar o item do menu e da landing na primeira versão. Quando for ligar: emitir NFS-e só da mão de obra e NF-e das peças. Perguntar ao dono. Descrição automática usa "Serviço de reparo - {aparelho}" (121).

### 1.8 `js/importar.js` — Importação do "Reparo Pro"

**O que é:** `Dossie` lê o CSV "Dossiê de auditoria" do sistema **Reparo Pro** (OS em atraso, vendas, estoque, serviços) com heurísticas de celular (`ehPeca`: tela, bateria, flex… l. 40-44; `ehAparelho`: iPhone, Galaxy… l. 45). `ClientesPDF` lê o PDF de clientes do Reparo Pro com `pdf.js` (150-227), inclusive correção de DDD "4848" (193).

**Faz sentido manter?** **Não.** É de um sistema de celular, cita um concorrente por nome na tela (`outros.js:380`, `importar.js:180`; regra 8 do doc) e as heurísticas são de celular. Remover `js/importar.js`, o cartão `outros.js:378-383`, os handlers `outros.js:513-514` e `550-604`, as strings da seção "importação" em `i18n-es.js:1390-1394`, e conferir se `js/vendor/pdf.min.js` ainda é usado por outra coisa antes de tirar. Alternativa futura: importar clientes/veículos de **planilha CSV genérica** (nome, telefone, placa, modelo) — perguntar se o dono precisa disso na migração de clientes.

### 1.9 `js/pages/planos.js` — Planos, aviso do topo, tela de bloqueio, Meu plano

**O que faz:** `RECURSOS` (3-14) com textos; `PLANOS_PADRAO` (25-29) usado offline com **preços fixos** (Essencial 39,99 / Pro 77,90 / Pro Max); `PLANOS_EM_BREVE = ['pro_max']` (19); selo/aviso do teste grátis, inadimplência, somente leitura; tela "bloqueado"/"em breve"/"liberado ao assinar"; "Meu plano" com comparação. O banco decide (`tem_recurso`, `supabase/saas/02_planos.sql:28-34`).

**O que muda (recursos Pro do doc 8):** vitrine, follow-up **e lembretes de revisão**, metas por funcionário, módulos escolhidos. Sugestão: lembretes de revisão entram no recurso `followup` existente (não precisa mexer em SQL de recursos). Tirar `nota_fiscal` e o Pro Max da lista mostrada (ou manter "em breve"). Atualizar preços de `PLANOS_PADRAO` quando o dono definir (e a tabela `planos` no SQL novo). Textos: "loja" → "oficina" (16 ocorrências).

### 1.10 `js/pages/pagamento.js` — Checkout Kiwify/Hotmart

**O que faz:** busca links e preços por RPC `checkout_da_loja`, abre checkout com aviso de usar o mesmo e-mail, área do cliente, compra de notas avulsas. **A plataforma é escolhida pelo idioma da tela** (7-14: espanhol → Hotmart em CLP; português → Kiwify em reais), com **preços CLP fixos de fallback** (`essencial: 20000, pro: 34000`, l. 13).

**O que muda:** nada de estrutura; produto novo na Kiwify/Hotmart é configuração do admin. Rever o fallback de preço (l. 13) e a escolha por idioma (ver R7). Tirar "Pro Max"/"comprar notas" se notas ficarem fora.

### 1.11 `js/pages/aparencia.js` — White-label

**O que faz:** cartão em Configurações: logo (bucket público `lojas-publico`, até 512 KB, SVG checado), 3 cores (`cor_primaria`, `cor_secundaria`, `cor_fundo`), fonte, nome, slogan, rodapé, CNPJ/WhatsApp/telefone/endereço; prévia ao vivo com **contraste WCAG AA** (`Tema.validar`) e só salva se passar (47-48); endereço por subdomínio `<slug>.PLATAFORMA.dominio`; domínio próprio (Pro) com CNAME para Vercel.

**O que muda:** quase nada aqui; os **padrões de cor** vêm do banco/`js/tema.js` (fora deste mapa) e devem virar branco/azul do doc 3. Testar que uma cor da oficina sobre fundo **branco** passa no `Tema.validar`. Textos "Aparência da loja", "Endereço da loja", "sualoja" → oficina. Comentário com `rbtech.reparosimples.com` (87).

### 1.12 `js/pages/vitrine-admin.js` — Vitrine (painel, Pro)

**O que faz:** abas "Produtos na vitrine" e "Pedidos". Filtro **Celulares/Acessórios/Na vitrine** (4, 37, 50); liga/desliga item, preço, descrição, **até 4 fotos públicas** reduzidas a 1200 px (7-27, 72-82). Pedidos: separar, retirar (registra venda via `VendasPage.registrar`, 146-147), cancelar, WhatsApp; aviso flutuante de pedido novo.

**O que muda:** filtros "Peças e acessórios" / "Veículos usados" / "Na vitrine"; ícone `phone` do item sem foto (53) → caixa/carro; textos "Escolha os aparelhos e acessórios…" (42), WhatsApp "Confira os aparelhos disponíveis" (48), placeholder "Aparelho impecável… Garantia de 6 meses" (71). Para veículo usado: mais fotos (8-12) e campos km/ano/cor/combustível/câmbio.

### 1.13 `js/vitrine.js` + `vitrine.html` — Vitrine pública

**O que faz:** página sem login; dados de `vitrine_publica` (`supabase/saas/03_modulos.sql:37-39` devolve `armazenamento`, `bateria`, `condicao` = seminovo/novo/acessório, nunca custo/IMEI). Filtros Seminovos/Novos/Acessórios (`COND`, l. 4, 45), cartão mostra armazenamento · cor · bateria (60), carrinho até 10 por item (36), retirada com dia/horário fixo **9h-19h** (75-89), pedido via `criar_pedido_vitrine`, WhatsApp. `vitrine.html` carrega CSS do app, `config.js`, `i18n.js`, **`i18n-es.js` inteiro (96 KB)**, supabase, `tema.js`, `ui.js`.

**O que muda (peças, acessórios e veículos usados — doc 5):**
- Peças/acessórios: fluxo atual serve (carrinho + retirada).
- **Veículo usado não cabe no carrinho/retirada com pagamento na loja**: propor cartão de veículo com fotos, preço, km, ano, cor, combustível, câmbio e botão **"Tenho interesse"** (WhatsApp) ou "Agendar visita", sem quantidade. Exige mudar `vitrine_publica` (SQL) para devolver esses campos e um `tipo`.
- Horário de retirada configurável pela oficina (hoje fixo 9-19 h e todo dia, inclusive domingo).
- `vitrine.html`: `theme-color #000000` (6), descrição "Celulares e acessórios disponíveis na loja." (8), favicon `rs-192.png` (9), CSS próprio usa `var(--gold)` (24) e `var(--gold-grad)` com sombra preta (30).
- Restos de marca: `window.RBTECH_CONFIG` (11), `localStorage` `rbtech_pedido_cliente` (93, 121).

### 1.14 `js/i18n-es.js` — Dicionário espanhol

- **Estrutura:** um objeto `I18N.dic.es = { 'texto exato em português': 'texto em espanhol' }` + listas de regras `I18N.regras.es = [[/regex/, troca]]`. Arquivo de 1657 linhas, ~96 KB, **~1.440 entradas** e **~135 regras regex**; organizado por seções com comentário (`// ---------- metas ----------` etc., l. 5-1390) e blocos acrescentados depois com `Object.assign(I18N.dic.es, {...})` (l. 740, 1467, 1533, 1586, 1613, 1642).
- **Como funciona** (`js/i18n.js`): a **chave é o texto em português exatamente como aparece na tela** (sem espaços nas pontas). Em PT nada é traduzido. Em ES um observador troca nós de texto, `placeholder`, `title`, `aria-label`; PDFs passam por `I18N.pdf(doc)` (tenta texto inteiro, MAIÚSCULAS e "Rótulo: valor"). O que não está no dicionário **fica em português sem erro** — então trocar qualquer texto PT "quebra" a tradução em silêncio. `data-no-i18n` desliga a tradução de um trecho.
- **Glossário atual (l. 1-3):** aparelho = *equipo*, peça = *repuesto*, loja = *tienda*, bancada = *taller* (depois também *mesón*). Para oficina: oficina = *taller*, veículo = *vehículo*, mecânico = *mecánico*, pátio = *patio*, placa = *patente* (Chile) / *placa*, quilometragem = *kilometraje*. Note o choque: hoje *taller* já significa "bancada".
- **Contagem de chaves (texto PT) com termos de celular:** 169 linhas no total com aparelho/celular/técnico/IMEI/seminovo/bancada/reparo/assistência/tela/bateria/película/capa/iPhone/desbloqueio. Por termo: aparelho 79, reparo 29, celular 26, tela/bateria/película/capa 22, técnico 15, IMEI 14, seminovo 9, bancada 9, desbloqueio/padrão/senha 9, assistência 5, marcas 3. Além disso **73 chaves com "loja"** (vira "oficina"). Exemplos: l. 50 `'Nome, telefone, CPF ou aparelho'`, l. 90 `'Quem vendeu o aparelho?'`, l. 92 `'Os aparelhos e o valor desta venda contam na meta…'`, bloco "Desenho de desbloqueio" (fim do arquivo) inteiro sai.
- **Cuidado:** parte das chaves com "aparelho" fala do **dispositivo** do usuário (l. 107 "acessar o sistema de qualquer aparelho", 148, 177 "salvo no aparelho") e deve ficar como *dispositivo*.
- Recomendação: refazer o dicionário junto com cada tela (mesma etapa que muda o texto PT) e criar um teste que, em ES, procura textos que ficaram em português nas telas novas (critério de aceite 11).

---

## 2. Textos visíveis com aparelho/celular/técnico/IMEI etc.

Contagem bruta de ocorrências da palavra no arquivo (inclui nomes internos como `o.aparelho`, `p.imei`; "visível" = estimativa de textos que aparecem na tela).

| Arquivo | aparelho | celular | técnico | IMEI (maiúsc., visível) | seminovo | reparo | loja | capa/película | marcas (iPhone/Samsung/Xiaomi) |
|---|---|---|---|---|---|---|---|---|---|
| `js/pages/outros.js` | 43 | 7 | 12 | 1 (+1 campo) | 8 | 24 | 72 | 6 | 4 |
| `js/pages/vendas.js` | 45 | 55 | 0 | 9 (53 com código) | 52 | 0 | 24 | 1 | 9 |
| `js/pages/estoque.js` | 4 | 9 | 0 | 1 | 15 | 1 | 0 | 1 | 3 |
| `js/pages/financeiro.js` | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `js/pages/metas.js` | 18 | 26 | 0 | 0 | 5 | 0 | 8 | 2 | 1 |
| `js/pages/nfe.js` | 1 | 0 | 0 | 0 | 1 | 0 | 5 | 0 | 0 |
| `js/pages/notas.js` | 2 | 0 | 0 | 0 | 0 | 1 | 13 | 0 | 0 |
| `js/importar.js` | 14 | 2 | 0 | 0 | 5 | 3 | 0 | 0 | 6 |
| `js/pages/planos.js` | 0 | 0 | 0 | 0 | 0 | 0 | 16 | 0 | 0 |
| `js/pages/pagamento.js` | 0 | 0 | 0 | 0 | 0 | 0 | 8 | 0 | 0 |
| `js/pages/aparencia.js` | 0 | 0 | 0 | 0 | 0 | 1 (comentário) | 30 | 0 | 0 |
| `js/pages/vitrine-admin.js` | 4 | 6 | 0 | 0 | 0 | 0 | 9 | 1 | 0 |
| `js/vitrine.js` | 0 | 0 | 0 | 1 (comentário) | 3 | 0 | 15 | 1 | 0 |
| `vitrine.html` | 0 | 1 | 0 | 0 | 0 | 0 | 1 | 0 | 0 |

Exemplos por arquivo:
- **outros.js:** "Feedback de compra de celular (7 dias)" (13); "Oferta de capa e película (30 dias)" (18); aba "Capa/película · 30 dias" (76); "Como está indo o aparelho?" (109); "Compra de celular" (121); "Troca de tela iPhone 11" (212); exemplos "Troca de tela, bateria, conector…" (228); "Desempenho da assistência" (248); "Aparelhos mais atendidos" (260); "Faturamento por técnico" / "Sem técnico" (264); CSV "Aparelho, IMEI" (275); "Dados da loja, metas, garantia, técnicos" (318); "Seminovos 6 meses" (344); "Termos da garantia de aparelhos seminovos" (346); "celulares novos e acessórios" (347); "Técnicos e assinaturas" / "Nome do técnico" (364-369); "Arquivos exportados do Reparo Pro" (380); "Técnico: só OS, bancada, estoque e clientes" (425); "aparelho(s) com garantia de 6 meses" (587); "Enviando pelo Reparo Simples" (655).
- **vendas.js:** "Celulares em estoque" (37); "VALOR DOS CELULARES EM ESTOQUE" (41); "Buscar celular ou acessório..." (44, 177); "Todos os celulares/Seminovos/Novos" (46); "Cadastrar celular" (50); "Seminovo · 6 meses", "🔋", "IMEI" (76); "Nenhum celular em estoque" (81); "Cliente vai dar um aparelho na troca" (187); "Aparelho na troca" (206); "IMEI do aparelho" (221); "Quem vendeu o aparelho?" (237); "Celular seminovo/novo" (274); "Saúde da bateria" (279, 446); "Venda de celular seminovo sem cliente" (357); "Aparelho recebido na troca" (392); "Garantia do aparelho" (430); "Ex: iPhone 13 128GB" (442); "Já existe um aparelho em estoque com este IMEI" (477).
- **estoque.js:** "peças de reparo e insumos técnicos" (10); "Tela iPhone 11 Incell" (83); "Tela, Bateria..." (86); "iPhone 11, XR" (88); "Celular seminovo / Celular novo" (101); "IMEI / Serial", "Saúde da bateria" (104-105); "boa qualidade de telas" (189).
- **financeiro.js:** "lucro da assistência" (27); "A receber em bancada" (41); "Compras de estoque e aparelhos" (48).
- **metas.js:** "iPhones / celulares", "Fone bluetooth", "Capa premium", "Película hidrogel" (11-14); "Qualquer celular vendido, novo ou seminovo" (117); "Lucro por aparelho" (135); "Média por aparelho" (137); "Aparelhos vendidos" (149); "Lucro mínimo por aparelho vendido" (211); "Celulares vendidos" (298, 308).
- **nfe.js:** só "loja" ("Esta nota já foi importada nesta loja", 116).
- **notas.js:** "Serviço de reparo - {modelo do aparelho}" (121); "Cadastro fiscal da loja" (103).
- **importar.js:** "Este PDF não parece ser a lista de clientes do Reparo Pro" (180); heurísticas de celular (42-45).
- **planos.js / pagamento.js / aparencia.js:** só "loja" (ex.: "Loja bloqueada", "Logo, cor do tema…", "Aparência da loja", "Endereço da loja").
- **vitrine-admin.js:** "Escolha os aparelhos e acessórios…" (42); "Confira os aparelhos disponíveis" (48); abas "Celulares/Acessórios" (50); "Aparelho impecável… Garantia de 6 meses" (71).
- **vitrine.js:** "Seminovo/Novo/Acessório" (4); "Bateria …" (60); "Escolha, reserve e retire na loja." (54); "Ex: quero a capa na cor preta" (105).
- **vitrine.html:** "Celulares e acessórios disponíveis na loja." (8).

---

## 3. Dourado e cores escuras (arquivo:linha)

Não há cor dourada em hex nestes arquivos: o dourado vem das **classes e variáveis do CSS** (`gold`, `outline-gold`, `pill gold`, `var(--gold)`, `--gold-rgb`, `--gold-soft`, `--gold-grad`). Total: 146 ocorrências de "gold" nestes 11 arquivos.

- `js/pages/outros.js` (66): 96, 112, 120, 121, 125, 173, 200, 213 (`color:var(--gold)`), 244, 254, 259-264, 270, 328, 335, 337, 339, 342, 344, 357, 360, 364, 367, 369, 373, 375, 379, 382, **385** (`rgba(var(--gold-rgb), .45)`), 386, 397, 398, 405, 412, 417, 428, **432** (`var(--gold-soft)` + `--gold-rgb`), 433, 442, 452, 503, 529-531, 559, 567, 580, **617** (`--gold-rgb`/`--gold-soft`), 623, 624, **625** (`color:var(--gold)`), 771, 790.
- `js/pages/vendas.js` (23): 73 (`border-color:var(--gold)`), 76, 77, 79, 81, 93, 179, **192** (`--gold-soft`/`--gold-rgb`), 207, 217, 257, 258, 383, 394, **420** (`--gold-rgb`), 440, **447** (`color:var(--gold)`), 465, 500, 516.
- `js/pages/estoque.js`: 14, **24** (`--gold-rgb`), 40, 50, 58, 93, 190.
- `js/pages/financeiro.js`: 30, 41, 44, 51, 52, 59, 127, 133, 146, 184.
- `js/pages/metas.js`: 107, 108, 120, 124, 135, 213, 259, 290.
- `js/pages/notas.js`: 3 (`NF_STATUS` cor `'gold'`), 32, 33, 35, 37.
- `js/pages/planos.js`: 21 (`SITUACAO.teste` cor `'gold'`), 73 (aviso `bar('gold')`), 105, 117, 128, 159, **169** (`--gold-rgb`), 170, 175.
- `js/pages/aparencia.js`: 9, 104, 124, 129.
- `js/pages/vitrine-admin.js`: 2 (`PV_STATUS.novo` `'gold'`), 31, 112, 119, 171.
- `js/vitrine.js`: 52, 98, 134.
- `vitrine.html`: **24** (`.vt-preco color: var(--gold)`), **30** (`.vt-cart background: var(--gold-grad)`).

Cores escuras / feitas para fundo preto:
- `js/pages/outros.js:176` prévia da mensagem com fundo `#0b1a12` e borda `#1f3d2b` (verde-escuro).
- `vitrine.html:6` `<meta name="theme-color" content="#000000">`; `vitrine.html:30` sombra `rgba(0,0,0,.45)`.
- `js/pages/vitrine-admin.js:81` botão sobre foto `rgba(0,0,0,.7)` (aceitável sobre foto).
- Tons "400" pensados para fundo escuro (contraste fraco em branco se usados como texto): `outros.js:462` `rgba(251,146,60,.45)`, `outros.js:477` `rgba(248,113,113,.35)`, `vendas.js:392` `rgba(192,132,252,.45)`, `estoque.js:23` `rgba(251,146,60,.12)`, `financeiro.js:57` `rgba(248,113,113,.1)`, `vitrine.js:131` `rgba(74,222,128,.12)`. As classes `.green/.red/.orange` do CSS precisam virar `#16A34A/#DC2626/#D97706`.
- `js/pages/outros.js:366` fundo `#fff` da assinatura: ok no tema claro.

Sugestão prática: redefinir `--gold`, `--gold-rgb`, `--gold-soft`, `--gold-grad` no `css/style.css` com os azuis do doc (um ponto só) e, numa segunda passada, renomear as classes `gold`→`accent` com busca e troca. Evita mexer em 146 linhas destes arquivos na etapa 2.

---

## 4. Riscos e pontos do documento que não batem com o código

- **R1. Checklist não é editável e a impressão usa a lista fixa.** `CHECKLIST_ITENS` (`js/store.js:77`), `js/print.js:98`, `js/pdf.js:443`. Se só a tela usar a lista nova, a impressão continua mostrando itens de celular. Alternativa: lista em `settings.checklist[tipo]` e impressão/PDF a partir de `o.checklist` (ver 1.1.2).
- **R2. Catálogo de serviços não é "pronto ao criar".** Começa vazio e os exemplos são de celular, carregados por botão (`outros.js:200, 227-231`); garantia "3 meses" é texto fixo (`outros.js:204, 213`). Alternativa: criar o catálogo por tipo na criação da oficina, com garantia `{ dias, km }` real por serviço.
- **R3. Mão de obra × peças não existe no modelo.** OS tem `valor` único e `pecas[]` só com custo (`store.js:188-189`); lançamento financeiro tem `valor` e `custo` (`store.js:224`, `203`); `Store.resumo` separa OS × Vendas, não MO × peças (`store.js:280-284`). Precisa: `itensServico[]`/`itensPeca[]` na OS (doc 7), `maoObra`/`pecasValor` no lançamento, migração das OS antigas (todas viram "mão de obra" ou "não separado"), notas fiscais e metas lendo os campos novos. É a mudança de maior impacto desta parte.
- **R4. "Aparelho" tem dois sentidos.** Também quer dizer o celular/computador do usuário: `outros.js:285, 321, 398, 413, 464, 735, 806`; `i18n-es.js:107, 148, 177`. Uma troca global "aparelho → veículo" estraga esses textos ("salvo neste veículo"). Fazer a troca texto a texto, e usar "dispositivo"/"celular ou computador" nesses casos.
- **R5. Técnicos da configuração ≠ funcionários com login.** `s.tecnicos` (ids locais, `outros.js:509`) é usado na OS (`o.tecnicoId`) e no relatório (`outros.js:264`); as metas por funcionário usam `user_id` do Supabase e `concluidoPor` (`metas.js:276-281`). Mecânico sem login nunca aparece na meta, e quem clica "Concluído" pode ser o atendente. Alternativa: meta do mecânico contada pelo `tecnicoId` dos itens de serviço; permitir ligar um mecânico da lista a um usuário da equipe (campo opcional `userId`), e mostrar mecânicos sem login na aba "Por funcionário".
- **R6. Importar do "Reparo Pro" cita concorrente.** `outros.js:380`, `importar.js:150, 180`. Contra a regra 8; sem utilidade para oficina. Remover (1.8).
- **R7. Plataforma de pagamento decidida pelo idioma da tela.** `pagamento.js:7-14` (e preços CLP fixos na l. 13). O doc (armadilha 12) diz que moeda é da oficina, nunca do idioma. Um dono brasileiro que troca a tela para espanhol cai na Hotmart em pesos. Alternativa: escolher pela `moedaBase`/país da oficina e, se precisar, deixar o dono escolher.
- **R8. WhatsApp na vitrine pública põe 55 sozinho.** `vitrine.js:63` e `135`: `zap.length <= 11 ? '55' + zap : zap`. Número chileno sem "+" (ex.: 56 9 1234 5678 = 11 dígitos) ganha 55 — é exatamente a armadilha 12 ("Telefone para WhatsApp"). Usar a mesma função `waLink` do app (conferir se ela já trata) ou exigir DDI.
- **R9. Veículo usado na vitrine não cabe no carrinho.** Carrinho com quantidade até 10, "pagamento na retirada", horário 9-19 h fixo (`vitrine.js:36, 75-89, 99`); `vitrine_publica` devolve campos de celular (`03_modulos.sql:37-39`). Alternativa: tipo `veiculo` com cartão próprio e botão "Tenho interesse/Agendar visita" pelo WhatsApp; nova versão de `vitrine_publica` (migração aditiva) com km, ano, cor, combustível, câmbio; fotos públicas (bucket `lojas-publico`) e **placa nunca exibida**.
- **R10. Peças e produtos são estoques separados.** PDV só vende `Store.db.produtos` (`vendas.js:65, 255`); peças (`Store.db.pecas`) só saem pela OS. Na oficina o balcão vende peça (filtro, lâmpada). Perguntar: o PDV busca também peças, ou "produto" e "peça" viram um cadastro só com um marcador "vende no balcão"?
- **R11. Quantidade inteira.** Estoque, lote e NF-e usam `parseInt` (`estoque.js:127, 166`; `nfe.js:106`) e `qty` +/-1. Óleo é vendido em litro e às vezes fracionado (3,5 L). Alternativa: aceitar decimal com unidade no item; ajustar `Store.movimentar`/lotes (fora deste mapa).
- **R12. Garantia por km no pós-venda.** "Garantia acabando" usa `Store.garantiaFim(o)` (só data) e seminovo 180 dias (`outros.js:70-72`). O km atual do cliente não é conhecido: aviso só pela data; o km aparece no texto da garantia/PDF/link.
- **R13. Metas padrão de celular gravadas no banco.** `metas.js:7-17` cria e salva "iPhones/celulares, Fone, Capa, Película, R$ 400 por aparelho" na primeira abertura. Trocar o padrão antes de qualquer oficina abrir a tela.
- **R14. Notas fiscais (Pro Max) emitem um valor só.** `notas.js:121-125`. Para oficina, NFS-e (mão de obra) e NF-e (peças) são documentos diferentes. Manter desligado nesta versão e perguntar ao dono.
- **R15. Tradução silenciosa.** A chave é o texto PT (1.14); qualquer texto novo/alterado sem entrada no dicionário aparece em português em ES sem erro. Fazer PT e ES juntos e testar. Revisar o glossário (*taller* já é "bancada").
- **R16. Restos de marca e chaves locais.** `backup-rbtech-` (`outros.js:724`), `rbtech_equipe_` (`vendas.js:244`), `RBTECH_CONFIG` e `rbtech_pedido_cliente` (`vitrine.js:11, 93, 121`), "Reparo Simples" (`outros.js:655`, `i18n-es.js` "Este e-mail já tem uma conta no Reparo Simples"), favicon `rs-192.png` (`vitrine.html:9`). Como o domínio é outro, `localStorage` não se mistura, mas os nomes aparecem para o usuário (arquivo de backup) e em configuração.
- **R17. Página pública já devolve IMEI hoje.** `supabase/saas/15_garantia_os.sql:13` e `26_cards_bancada.sql:14` montam `'imei'` no retorno do acompanhamento. O doc 7 pede placa mascarada e sem dados pessoais; na versão nova o campo correspondente (placa) tem que ir **mascarado** no SQL, não só na tela. (Fora do meu escopo de arquivos, mas é risco direto.)
- **R18. Papel `tecnico` no banco.** Mostrar "Mecânico" na tela, mas manter a chave `tecnico` (`store.js:71`, `outros.js:425, 523, 612, 623`) porque as regras de acesso usam esse nome.
- **R19. Doc diz "Estoque (peças, produtos, seminovos com IMEI)".** No código, seminovo é um `produto` com `tipoProduto: 'seminovo'` mais a tela `js/pages/aparelhos.js`; tirar seminovo afeta `vendas.js`, `estoque.js:98-123`, `metas.js`, `outros.js` (pós-venda e garantias) e `vitrine`. Remover de forma coordenada (ou esconder primeiro e apagar depois).
- **R20. Pontos do doc que já estão certos no código (não refazer):** OS que vai direto para "Pago" registra quem finalizou (`store.js:217-221`, `metas.js:281`); botão de convite/criação desabilitado durante o envio (`outros.js:520, 541`); contraste WCAG AA na aparência (`aparencia.js:37-48`); fotos da vitrine reduzidas antes do upload (`vitrine-admin.js:8-15`).

Perguntas para o dono (desta parte): (1) PDV vende peças do estoque de peças? (2) Vitrine terá veículos usados já na primeira versão? Com carrinho ou só "tenho interesse"? (3) Notas fiscais ficam fora agora? (4) Metas da oficina (não por funcionário) ficam no Essencial? (5) Precisa importar clientes/veículos de planilha na migração? (6) Mecânicos sem login no sistema devem aparecer nas metas?
