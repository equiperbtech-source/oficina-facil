# Etapa 0: leitura do Reparo Simples e plano da Oficina Simples

Li o código inteiro do zip (`reparo-simples/`): telas, servidor, banco e scripts. **Nada foi alterado no original.**
Também rodei o banco do original num Postgres local, com um mock do Supabase: o `schema.sql`, o `TUDO.sql` duas vezes, os 8 testes de banco e todos os reverter.

Os detalhes, com arquivo e linha de cada ponto, estão em 4 mapas:

- [1. Núcleo do app: sincronização, tema, menu, util, CSS, build](etapa-0/1-nucleo.md)
- [2. OS, orçamento, cotação, clientes, PDF, impressão e link do cliente](etapa-0/2-os-pdf-link.md)
- [3. Vendas, estoque, financeiro, metas, configurações, planos e vitrine](etapa-0/3-vendas-estoque-config.md)
- [4. Servidor, banco, pagamentos, admin, docs e testes](etapa-0/4-servidor-banco.md)

Este arquivo é o resumo: o que muda em cada arquivo, as surpresas que o código revelou, os riscos e as perguntas que só você responde.

---

## 1. Surpresas: o que o documento diz e o código mostra diferente

| # | Documento | Código real | Proposta |
|---|---|---|---|
| 1 | "Ambiente de testes que já usamos: Postgres + mock + Playwright" | **Não veio no zip.** Só há testes de banco em SQL, que se rodam à mão | Criar do zero na Etapa 1. O mock mínimo do Supabase que montei nesta leitura serve de base |
| 2 | Landing com "a mesma estrutura da landing do Reparo Simples" | **A landing não está no zip** | Fazer do zero na Etapa 9, seguindo a estrutura descrita no documento. Se quiser, mande a landing atual (ou o link) como referência |
| 3 | "`middleware.js` trata subdomínios" | Ele **só protege o `/admin`**. O subdomínio é resolvido no navegador (`loja_por_host`) | Nada a mexer no middleware. O subdomínio curinga é configurado na Vercel |
| 4 | Armadilha "moeda nunca vem do idioma" | **Ainda acontece:** com a tela em espanhol, os valores são convertidos pela cotação (`util.js:20-46`). A escolha da plataforma de pagamento também segue o idioma (`pagamento.js:9`) | Corrigir já na Etapa 1: a tela mostra sempre a moeda da oficina |
| 5 | Armadilha "WhatsApp não pode ganhar o 55" | **Ainda acontece** em `util.js:94`, na vitrine (`vitrine.js:63/135`) e nos e-mails do banco (`wa.me/55` fixo) | Corrigir na Etapa 1: só pôr o 55 quando a oficina é do Brasil e o número tem o tamanho brasileiro |
| 6 | Armadilha do `hidden` + `.btn` | Não há regra `[hidden]` no CSS; o risco continua aberto | Acrescentar `[hidden]{display:none!important}` |
| 7 | Armadilhas "configurações voltando" e "meta de quem leva direto ao Pago" | **Já estão corrigidas** no original | Manter. Ressalva: guardar nas configurações só o que a oficina mudou, e calcular os padrões (checklist, revisão) na hora da leitura |
| 8 | Subdomínio inexistente nunca abre o sistema | Quem **já está logado** e abre um subdomínio inexistente entra normalmente | Decidir junto (pergunta 10) |
| 9 | "`TUDO.sql` contém todas as migrações" | O `TUDO.sql` depende do `schema.sql`. **Rodar o `schema.sql` de novo depois das migrações desfaz a segurança** (permissões, trava de cadastro duplicado) e roda uma função que apaga lojas. O README do original manda fazer isso | Banco novo começa com um **`00_base.sql` único**, só com a versão final de cada função, e o `TUDO.sql` passa a incluí-lo |
| 10 | Link do cliente "sem dados pessoais" | Hoje ele **devolve o IMEI, a assinatura do cliente (imagem) e o nome completo**. Telefone, CPF e fotos não | Reescrever `acompanhar_os` do zero, com uma lista fechada do que pode sair |
| 11 | OS com "mão de obra e peças" | A OS tem **um valor só**. A peça entra só como custo, sem preço para o cliente, e o estoque baixa na hora em que a peça é lançada | É a maior mudança do projeto (ver seção 3) |
| 12 | Checklist editável | Lista fixa no código. O PDF e a impressão leem essa lista fixa | Lista por tipo nas configurações, e cada OS guarda a lista usada (assim as OS antigas não mudam) |
| 13 | Pátio com "Aguardando aprovação" | Essa etapa não existe | Criar como etapa fixa (`aprovacao`), também no link do cliente |
| 14 | Planos Essencial e Pro | Também existe um **Pro Max com nota fiscal** inteiro: banco, telas, servidor e admin | Proposta: deixar de fora (pergunta 6) |
| 15 | Hotmart "América Latina, moeda local" | Está presa a **espanhol = Chile = pesos chilenos**, com a marca "ReparaYa" | Ver pergunta 5 |
| 16 | — | O idioma padrão do app é **espanhol** | Padrão português |
| 17 | — | "Loja padrão": se o `TUDO.sql` rodar de novo depois do primeiro cliente, a oficina desse cliente passa a responder pelos links públicos sem endereço (testado) | Remover esse comportamento |
| 18 | — | A tela "Importar do sistema antigo" cita um concorrente pelo nome | Remover (regra 8) |
| 19 | Placa única por oficina | Os veículos ficam dentro do cliente (jsonb) e o app funciona sem internet, então o banco não consegue travar placa repetida | Checagem no app, com aviso "placa já cadastrada em {cliente}". No banco, índice só para a busca |
| 20 | — | Com o `js/config.js` em branco e sem as variáveis na Vercel, a produção abre **sem nuvem** e o admin não abre | Entra no checklist da Etapa 10 |

---

## 2. Mapa: o que muda em cada arquivo

Legenda: **T** = tema branco/azul · **V** = vocabulário (veículo, mecânico, pátio, oficina) · **M** = marca/nome/chaves · **N** = funcionalidade nova · **R** = remover.

### Telas e lógica (front)

| Arquivo | Mudança | Etapa |
|---|---|---|
| `css/style.css` | T: tokens novos, mantendo os nomes `--gold*` (que viram azul) para não mexer em centenas de lugares; sombras leves; vidro para fundo claro; cores de status AA; botões ≥ 44 px; `[hidden]`; seta do select | 2 |
| `js/tema.js` | T + M: `TEMA_PADRAO` azul/branco; sem cores próprias da oficina, valem os tokens do CSS (hoje o tema calculado sobrescreve o CSS); nome, logo, domínio e WhatsApp do suporte | 1-2 |
| `js/store.js` | V + N: status com cores AA, "Pronto para retirada", etapa `aprovacao`; `TIPOS_VEICULO`; checklist padrão por tipo; total = mão de obra + peças − desconto; garantia dias + km; lançamento com `maoDeObra` e `pecas`; termos de oficina | 3-4 |
| `js/cloud.js` | M: chaves locais e textos. Sincronização sem mudança (já corrigida). Avaliar juntar campo a campo também na OS | 1 |
| `js/app.js` | M + V + N: menu (Pátio, sem "Aparelhos"), "Que veículos você atende?" no cadastro, "Oficina não encontrada", versão 1 | 1, 3 |
| `js/util.js` | N + correções: `normPlaca`/`validaPlaca`/`fmtPlaca`, busca por placa, ícones de carro/moto/km/combustível, **moeda sem conversão pelo idioma**, **WhatsApp sem 55 indevido** | 1, 3 |
| `js/ui.js` | Quase nada. Assinatura continua em imagem (ver riscos) | — |
| `js/i18n.js` / `js/i18n-es.js` | Padrão PT; ~240 chaves com termos de celular ou "loja" reescritas; bloco do desenho de desbloqueio sai; glossário vehículo/mecánico/taller/repuesto | cada etapa |
| `js/pages/os.js` | N: assistente em 4 passos (placa/cliente → veículo → entrada: km, combustível, checklist, fotos → serviços e peças); itens de mão de obra (com mecânico) e de peça; garantia dias/km; próxima revisão; botão Histórico; pátio com ícone carro/moto. R: senha, IMEI e desenho | 3-5 |
| `js/pages/clientes.js` | N: vários veículos por cliente, placa, campos por tipo, histórico por placa, busca por placa | 3, 5 |
| `js/pages/orcamentos.js` | N: mesmos itens da OS; ao aprovar, os itens vão para a OS (hoje viram texto) | 4 |
| `js/pages/cotacao.js` | V: mensagem ao fornecedor com marca, modelo e ano | 6 |
| `js/pages/fotos.js` | Limite de 8 para 12; pasta `veiculos/`; dicas de ângulo | 4 |
| `js/pages/padrao.js` | **R** (desenho de desbloqueio) | 3 |
| `js/pages/aparelhos.js` | **R** do menu na Etapa 3; vira "Veículos à venda" na Etapa 6, se você quiser | 3, 6 |
| `js/pages/followup.js` + `outros.js` (pós-venda) | N: lembretes de revisão do dia/semana com WhatsApp pronto; tira "capa + película" | 5 |
| `js/pages/outros.js` | Serviços: catálogo pronto por tipo, criado com a oficina, com garantia dias/km. Configurações: "Checklist de entrada" por tipo, tipos de veículo, revisão padrão. Relatórios: mão de obra × peças. R: importar de concorrente | 4-6 |
| `js/pages/dashboard.js` | V + etapa nova | 3 |
| `js/pages/vendas.js` | V: tira seminovo/IMEI/troca de aparelho; venda de peças no balcão (pergunta 8) | 6 |
| `js/pages/estoque.js`, `nfe.js` | V: peças de oficina; quantidade com decimal (óleo em litro) | 6 |
| `js/pages/financeiro.js` | N: mão de obra × peças | 4 |
| `js/pages/metas.js` | V + N: metas padrão de oficina; OS por mecânico (contadas pelo mecânico do serviço, não por quem clicou) | 6 |
| `js/pages/notas.js`, `js/importar.js` | **R** (ou desligado), conforme pergunta 6 | 1 |
| `js/pages/planos.js`, `pagamento.js` | M + correção: plataforma de pagamento pela moeda da oficina, não pelo idioma | 8 |
| `js/pages/aparencia.js`, `vitrine-admin.js` | T + V | 2, 6 |
| `js/pdf.js`, `js/print.js` | T (borda azul, sem fundo escuro) + N: itens separados, placa em destaque, km, combustível, checklist da OS, garantia dias/km; 1 página sem fotos; quebra correta com fotos; um só layout A4 | 2, 4 |
| `js/acompanhar.js` + `acompanhar.html` | T + N: placa mascarada, km, itens, garantia em km, etapa "Aguardando aprovação"; aprovar orçamento (pergunta 4) | 2, 4 |
| `pedido.html` + `js/pedido.js` | T + V: pedido de orçamento com placa, marca, modelo e ano | 2, 6 |
| `vitrine.html` + `js/vitrine.js` | T + N: peças e acessórios; veículos usados com "Tenho interesse" (pergunta 7) | 2, 6 |
| `index.html`, `manifest.webmanifest`, `sw.js` | M + T: título, cor, ícones, cache `oficina-v1`, lista de arquivos | 1-2 |
| `assets/` | M: logo novo SVG/PNG 32/180/192/512. **Apagar os antigos** (o build publica a pasta inteira) | 2 |

### Servidor, banco e scripts

| Arquivo | Mudança | Etapa |
|---|---|---|
| `supabase/schema.sql` + `saas/01..27` | Viram **`00_base.sql` único**, sem "loja padrão", sem a função que junta e apaga lojas, sem nota fiscal (se confirmado), com índice único "1 oficina por dono" | 7 |
| Migrações novas (28+) | `acompanhar_os` da oficina; `vitrine_publica` com veículos (sem placa e sem chassi); `criar_pedido_veiculo`; índice da OS por placa; e-mails em branco/azul sem 55 fixo; tema padrão azul; recursos Pro para lembretes. Cada uma com reverter que roda 2x | 7 |
| `supabase/testes/*.sql` | Reescritos para banco vazio: criam as duas oficinas no próprio teste, sem depender de "loja 1" | 7 |
| `api/_lib/*`, `api/webhooks/kiwify.js`, `hotmart.js` | M: variáveis sem `RBTECH_`, e-mail de boas-vindas azul. Lógica (idempotência, compra sem oficina) mantida. **Testar com o produto novo da Kiwify**: o formato da assinatura está marcado "a confirmar" no próprio código | 8 |
| `api/notas/*`, `webhooks/nfse.js`, `_lib/fiscal.js`, `certificado.js` | **R**, se a nota fiscal ficar de fora | 1 |
| `api/admin.js`, `admin.html`, `admin-entrar.html`, `js/admin.js` | M + T + V: "oficinas", textos de carrinho abandonado sem a marca antiga | 8 |
| `middleware.js` | M: cookie e variáveis. Continua só protegendo o `/admin` | 1 |
| `scripts/gerar-config.cjs` | M: `OFICINA_SUPABASE_URL` etc. | 1 |
| `scripts/build.cjs`, `juntar-migracoes.cjs`, `vercel.json` | Sem mudança (o juntar passa a incluir o `00_base`) | — |
| `docs/` | Guia novo "banco do zero"; checklist de publicação limpo (Etapa 10) | 10 |
| **Novos** | `tests/` (Playwright: celular 390×844 e computador, duas oficinas, sem erro no console), `tests/db/` (Postgres + mock), `landing/` | 1, 9 |

---

## 3. Como ficam os dados da oficina

Os dados continuam em `public.itens`, como no original. O que muda:

- **Cliente:** `veiculos: [{ id, tipo, placa, marca, modelo, anoFab, anoModelo, cor, km, combustivel, chassi, cilindrada, motor, cambio, obs }]`. A placa é guardada **sem hífen e em maiúsculas** (a busca ignora hífen). A placa antiga e a Mercosul do mesmo carro (ABC1234 ↔ ABC1C34) contam como o mesmo veículo.
- **OS:**
  - `veiculo` (cópia na entrada), `kmEntrada`, `combustivel` (0, 1/4, 1/2, 3/4, cheio), `checklist` + `checklistItens` (a lista usada), `fotos` (só os caminhos);
  - `itensServico[{ id, nome, qtd, valor, mecanicoId, garantiaDias, garantiaKm }]`, `itensPeca[{ id, pecaId?, nome, qtd, valor, custo }]`;
  - `proximaRevisao { data, km }`, `garantiaDias` + `garantiaKm`.
  - Também grava `valor` = soma dos itens, para relatórios e banco continuarem funcionando.
- **Orçamento:** os mesmos itens. Ao aprovar, eles vão para a OS.
- **Lançamento financeiro da OS:** `maoDeObra` e `pecas` separados. Isso dá o relatório do mês.
- **Peça do estoque na OS:** baixa quando a OS é aberta ou a peça é marcada como usada (e não quando entra no orçamento). Se a peça sair da OS, volta ao estoque.
- **Configurações:** `tiposVeiculo`, `checklist` (só o que a oficina personalizou, por tipo), `revisaoPadrao` (carro 5.000 km / 6 meses; moto 3.000 km / 3 meses), `garantiaKm`.
- **Lembrete só por km:** como não há data, o app estima pela média de km/dia das OS anteriores da mesma placa. Sem histórico, usa o prazo padrão.
- **Nomes internos:** troco "aparelho" para "veiculo" nos dados (o banco é novo, não há dados antigos). O papel `tecnico` **fica com esse nome interno**, porque as permissões do banco usam ele; na tela aparece "Mecânico".

---

## 4. Riscos

1. **Troca automática de "aparelho" por "veículo" estraga textos.** "Aparelho" também quer dizer o celular ou computador de quem usa o sistema ("salvo no aparelho"). A troca vai ser texto por texto, sempre com o espanhol junto.
2. **Tradução silenciosa.** O espanhol usa o texto em português como chave, então um texto mudado sem tradução aparece em português sem dar erro. Vou incluir um teste que procura textos sem tradução nas telas novas.
3. **Mão de obra × peças mexe em tudo:** OS, orçamento, financeiro, relatórios, metas, PDF, link do cliente e banco. Por isso a OS continua guardando `valor` como total (compatibilidade), e há testes de soma ponta a ponta.
4. **Duas pessoas editando a mesma OS ao mesmo tempo:** vale a última gravação inteira (só as configurações juntam campo a campo). Com OS maiores, isso pesa mais. Proposta: usar a mesma junção das configurações para a OS e testar com dois aparelhos.
5. **Assinaturas em imagem** ficam no aparelho e dentro das configurações e da OS (mesmo problema das fotos, em menor escala). Proposta: levar para o bucket privado na Etapa 4.
6. **PDF em 1 página:** hoje depende do tamanho dos termos, e as tabelas não quebram página. Vai ter teste que conta as páginas.
7. **Webhook da Kiwify:** o formato está marcado no código como "a confirmar". Só dá para validar com uma compra de teste no produto novo.
8. **Contraste:** as cores de status e de cards foram feitas para fundo preto e falham no branco. Todas serão trocadas e conferidas.
9. **Reverter das migrações:** só funciona do último para o primeiro, e o 17 falha se rodar 2x. As migrações da oficina vão ter reverter que roda 2x, com teste.
10. **Sem internet, dois aparelhos** podem cadastrar a mesma placa. O app avisa e oferece juntar os cadastros.

---

## 5. Perguntas que só você responde

1. **Nome final.** "Oficina Simples" (documento) ou "Oficina Fácil" (nome do repositório)? E o nome em espanhol, se houver?
2. **Domínio** (os subdomínios ficam `<oficina>.dominio`) e **WhatsApp do suporte** que aparece no app.
3. **Preços** do Essencial e do Pro (o original tem R$ 39,99 e R$ 77,90) e **limite de funcionários** de cada um (2 e 5 no original). Mantém 7 dias de teste, com teste no plano Pro?
4. **Aprovação do orçamento pelo cliente no link** entra agora (Etapa 4) ou fica para depois?
5. **Espanhol e Hotmart no lançamento?** Se sim, para quais países e moedas? Hoje só existem real e peso chileno. A minha sugestão é lançar só no Brasil (Kiwify, português), deixando o espanhol funcionando nas telas como pede o documento.
6. **Nota fiscal e plano Pro Max:** posso tirar do produto? (Sugestão: tirar. Para oficina, a nota da mão de obra e a das peças são documentos diferentes e isso merece um projeto próprio.)
7. **Veículos usados na vitrine** entram já (Etapa 6)? Com botão "Tenho interesse" no WhatsApp em vez de carrinho (sugestão)?
8. **Balcão:** a venda (PDV) vende peças do estoque? Sugestão: peça e produto viram um cadastro só, com a opção "vende no balcão".
9. **Mecânicos sem login** (só cadastrados por nome) devem aparecer nas metas? Sugestão: sim, contando pelo mecânico dos serviços da OS.
10. **Subdomínio inexistente com a pessoa já logada:** mostrar "oficina não encontrada" com um botão "ir para a minha oficina" (sugestão), ou deixar entrar como hoje?
11. **Link do cliente:** mostra a assinatura do cliente no termo de garantia em PDF, ou o PDF do link sai sem assinaturas (sugestão)? E o nome do cliente completo ou só o primeiro nome (sugestão)?
12. **Importar clientes e veículos de planilha** (CSV) é necessário para o lançamento?
13. **E-mail remetente** da plataforma (domínio que será verificado no Brevo).

---

## 6. Próxima etapa (Etapa 1: base nova), depois da sua aprovação

1. Copiar o código para este repositório (`equiperbtech-source/oficina-facil`) sem as marcas antigas, sem `assets/` antigos e sem nenhuma chave, com o nome novo em título, manifest, e-mails, PDFs e metadados.
2. Já corrigir as três armadilhas que ainda estão abertas: moeda pelo idioma, 55 no WhatsApp e `[hidden]`.
3. Tirar nota fiscal, importação do concorrente e "loja padrão", se você confirmar.
4. Montar o ambiente de testes: Postgres local + mock do Supabase + Playwright (celular 390×844 e computador), com um primeiro teste que cria duas oficinas e confere que uma não vê a outra.
5. Entregar os prints do celular, o resultado dos testes e o que você precisa configurar.
