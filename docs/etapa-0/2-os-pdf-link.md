# Mapa 2 — OS, orçamento, cotação, clientes, PDF/impressão e link do cliente

Base lida (somente leitura): `orig/reparo-simples`. Todas as referências são `arquivo:linha` do original.
Arquivos lidos por inteiro: `js/pages/os.js`, `aparelhos.js`, `padrao.js`, `fotos.js`, `orcamentos.js`, `cotacao.js`, `clientes.js`, `followup.js`, `dashboard.js`, `pedidos.js`, `js/pdf.js`, `js/print.js`, `js/acompanhar.js`, `acompanhar.html`, `pedido.html`, `js/pedido.js`. Referência: `js/store.js`, e conferências pontuais em `js/pages/metas.js`, `js/pages/outros.js`, `js/util.js`, `supabase/saas/26_cards_bancada.sql`, `supabase/saas/25_fotos_aparelho.sql` e `supabase/schema.sql`.

---

## 0. Como a OS funciona hoje (o essencial para a oficina)

- **Dados da OS** (gravados por `os.js:441` e `os.js:348`): `defeito`, `servico` (texto livre), `valor` (um número só), `desconto`, `previsao`, `status`, `tecnicoId`, `senha`, `padrao` (desenho), `acessorios`, `obs`, `checklist` (objeto `{ "Tela": "ok" | "nok" }`; "não verificado" = chave ausente), `fotos` (caminhos), `fotosImprimir`, `garantiaDias`, `aparelho` (cópia `{id,tipo,modelo,imei,idTipo,cor}`), `pecas: []`, `orcamentoId`.
- **Itens hoje:** NÃO existe lista de itens na OS. Há um único `valor` (`os.js:398`) e um texto `servico`. O catálogo de serviços só preenche esses dois campos (`os.js:419-423`).
- **Peças do estoque na OS:** existem, mas só como **custo**. São lançadas depois de criada a OS, no detalhe (`os.js:488`, `addPeca` em `os.js:531-559`): baixa o estoque **na hora** (`Store.movimentar('peca', p, -q, ...)`, `os.js:546`), guarda `{pecaId, nome, qtd, custo}` (`os.js:547`); peça avulsa só tem custo (`os.js:554`). Remover devolve ao estoque (`os.js:520-525`). A peça **não tem preço de venda na OS** e não soma no total do cliente.
- **Total e lucro:** `Store.osTotal(o) = valor − desconto` (`store.js:188`); `Store.osCustoPecas(o) = Σ custo×qtd` (`store.js:189`); detalhe mostra "Lucro bruto = total − custo de peças" (`os.js:492-496`). No pagamento entra um lançamento com `valor = osTotal`, `custo = osCustoPecas`, `taxa` da forma (`store.js:224`, `store.js:260`); `syncReceitaOS` mantém o lançamento em dia ao editar (`store.js:200-205`).
- **Garantia:** só por dias. `garantiaDiasOS` (`store.js:236`), início = `concluidoEm || pagoEm || entregueEm` (`store.js:234`), fim = início + dias (`store.js:237`).
- **Quem finalizou (metas):** `setOSStatus` grava `concluidoPor/concluidoPorNome` ao marcar "Concluído" **e também ao ir direto para "Pago"** (`marcarQuem`, `store.js:216-221`). Metas por funcionário contam `(o.concluidoPor || o.criadoPor) === uid` (`metas.js:281`). Ou seja: **sim, fica registrado** — mas registra **o usuário logado que clicou** (normalmente o atendente que recebeu), não o técnico da OS (`tecnicoId`). Sem nuvem, `Store.quem()` devolve `{}` e nada é gravado (`store.js:173-176`).

---

## 1. Arquivo por arquivo: o que faz hoje e o que muda

### 1.1 `js/pages/os.js` (702 linhas) — OS, assistente, detalhe, pagamento, garantia e Bancada

**Hoje:** lista de OS com abas/filtros/busca (`os.js:5-99`); menu de status (`101-117`); link de acompanhamento e mensagens de WhatsApp (`119-142`); PDF da OS/garantia e impressão (`144-175`); modal "Reparo finalizado" (`177-193`); pagamento (`196-225`); modal de garantia com técnico e assinatura (`227-264`); assistente de nova OS em 3 passos (`266-356`); pós-criação (`358-372`); assinatura do cliente (`374-386`); campos do serviço + checklist + fotos + senha/desenho (`389-443`); detalhe (`446-529`); adicionar peça (`531-559`); editar (`561-586`); lixeira (`588-601`); Bancada kanban e editor de cards (`606-702`).

**O que muda:**

- **Assistente de abertura** (`novaOS`, `os.js:267-356`). Hoje: passos `['Cliente','Aparelho','Serviço']` (`os.js:272`). Cliente busca por nome/telefone/CPF (`os.js:301`, `os.js:307`). Passo 2 lista `c.aparelhos` e mostra IMEI (`os.js:321`), salva `{tipo,modelo,imei,idTipo,cor}` (`os.js:330`). Passo 3 = `servicoFields`.
  Novo fluxo (critério de aceite: menos de 1 minuto):
  1. **Placa ou cliente**: um único campo "Placa, nome ou telefone". Se a placa normalizada já existe em algum `cliente.veiculos`, pula direto para o passo 3 com cliente + veículo escolhidos (usar `pre.clienteId` + `pre.veiculo`, como hoje `pre.aparelho` em `os.js:268`). Se não existe, oferece "Novo veículo" já com a placa preenchida.
  2. **Veículo**: substituir `ClientesPage.aparelhoFields` por `veiculoFields` (tipo carro/moto escondido se a oficina só atende um tipo; placa com validação Mercosul/antiga que avisa sem bloquear; marca, modelo, ano, cor, combustível, chassi opcional; cilindrada só moto; motor/câmbio só carro).
  3. **Entrada**: **km de entrada (obrigatório)**, nível de combustível (seletor vazio/¼/½/¾/cheio), checklist por tipo, fotos (12).
  4. **Serviços e peças**: duas listas (mão de obra com mecânico; peças do estoque ou avulsas), desconto, previsão, garantia dias/km, próxima revisão. Botão "Abrir OS".
  O `stepper` (`os.js:273`) aceita qualquer quantidade de passos; a navegação `w.step` (`os.js:275-279`) precisa de 4 casos.
- **`servicoFields` / `readServico`** (`os.js:389-443`):
  - Remover "Senha / padrão" e `Padrao.campoHTML` (`os.js:406`), `Padrao.ligar` (`os.js:418`), `senha` e `...Padrao.ler(root)` em `readServico` (`os.js:441`).
  - "Defeito relatado" placeholder "Não carrega, tela quebrada" (`os.js:394`) → "Barulho na suspensão, luz da injeção acesa...". "Serviço a executar" placeholder "Troca de conector de carga" (`os.js:396`).
  - Valor único (`os.js:398`) → listas `itensServico[]` e `itensPeca[]` (ver 1.1.b).
  - Checklist fixo `CHECKLIST_ITENS` (`os.js:411`, constante em `store.js:77`) → lista da oficina por tipo (`Store.s.checklist.carro/moto`). Manter o ciclo vazio→ok→nok (`os.js:424-429`).
  - "Acessórios deixados — Capinha, carregador, chip" (`os.js:409`) → "Objetos deixados no veículo (estepe, macaco, documento, som removível)".
  - "Observações internas — aparelho com marcas de uso" (`os.js:414`).
  - Garantia (`os.js:407`): acrescentar campo km ao lado dos dias; `prazoHint` (`os.js:432-435`) passa a mostrar "3 meses ou 3.000 km".
  - Novo: "Próxima revisão" (data e/ou km) com sugestão por tipo (carro 5.000 km/6 meses; moto 3.000 km/3 meses).
- **1.1.b Mão de obra × peças** (maior mudança):
  - Hoje o catálogo preenche `servico` e `valor` (`os.js:420-423`); peças só no detalhe (`os.js:488`) e só como custo.
  - Novo: `itensServico: [{desc, qtd, valor, mecanicoId, garantiaDias, garantiaKm}]` e `itensPeca: [{pecaId|null, nome, qtd, preco, custo}]`. Total = Σ serviço + Σ peça − desconto. Lucro = total − Σ custo peça − taxa.
  - `addPeca` (`os.js:531-559`) passa a pedir **preço de venda** (vem de `peca.preco`, que já existe no estoque: `estoque.js:91`, `estoque.js:128`) e passa a poder ser usado dentro do assistente, não só no detalhe.
  - Detalhe (`os.js:487-497`): trocar "Peças utilizadas"/"Valor do serviço"/"Custo de peças"/"Lucro bruto" por: tabela Mão de obra (com mecânico), tabela Peças (qtd × preço), subtotais, desconto, total, custo das peças e lucro (lucro só para o dono, como `dashboard.js:22`).
  - **Pagamento** (`os.js:196-225`): hoje edita "Valor do serviço" (`os.js:206`) e grava `o.valor` (`os.js:217`). Com itens, mostrar o resumo (mão de obra, peças) e deixar editar só o desconto; senão o valor digitado diverge da soma dos itens.
- **Remoção de IMEI/senha/desenho no detalhe e na busca:** busca usa `o.aparelho?.imei` (`os.js:55`) e placeholder "Buscar cliente, IMEI, OS..." (`os.js:31`) → buscar placa normalizada (`o.veiculo.placa`) + modelo. Card "Aparelho" no detalhe com IMEI/Senha/Desenho (`os.js:468-474`) → card "Veículo" (tipo, placa, marca/modelo/ano, cor, km de entrada, combustível, chassi).
- **Histórico por placa:** botão "Histórico do veículo" no detalhe (perto de `os.js:504`, que hoje é o histórico de **status**; renomear esse para "Andamento" para não confundir).
- **Listagem** (`itemHTML`, `os.js:75-99`): ícone `phone` + modelo (`os.js:88`) → ícone carro/moto + placa em destaque + modelo.
- **Mensagens de WhatsApp** (`os.js:123-131`, `244`):
  - `msgEntrada` (`os.js:124`): "Recebemos seu aparelho *{modelo}* na {loja}." 📱 → "Recebemos seu veículo *{modelo}* ({placa}) na {oficina}." + km de entrada.
  - `msgPronto` (`os.js:127`): "Seu aparelho *{modelo}* (OS #{n}) está *pronto para retirada*!" → "Seu veículo *{modelo}* ({placa}) está pronto para retirada!" + garantia "3 meses ou 3.000 km".
  - `msgStatus` (`os.js:130`): manter, acrescentar placa.
  - Mensagem de garantia (`os.js:244`): acrescentar km.
  - As chaves vão por `t(...)` (`i18n`): mudar o texto exige mudar também as chaves em `js/i18n-es.js`.
- **"Reparo finalizado!"** (`os.js:181-183`) → "Serviço finalizado!", "Garantia do serviço". `garantiaModal` (`os.js:227-264`): "Responsável e assinatura técnica", "Técnico responsável", "Nenhum técnico cadastrado" (`os.js:238`, `250`, `253`) → "Mecânico".
- **Pós-criação** (`os.js:358-372`): "Imprimir etiqueta do aparelho" (`os.js:367`) → "Imprimir etiqueta (placa)".
- **Pedir peça** (`os.js:488`): passa só `aparelho.modelo` → passar `{marca, modelo, ano}` (ver cotação).
- **Editar** (`os.js:561-586`): "Aparelho" + `aparelhoFields` (`os.js:566`, `571`, `575`, `578`) → `veiculoFields`.
- **Bancada → Pátio** (`os.js:605-702`): título/descrição "Bancada — Aparelhos em reparo" (`os.js:610`), "Xd na bancada" (`os.js:621`), "Cards da bancada" (`os.js:638`), toasts (`672-680`). Card com placa grande + ícone carro/moto. **Bug de tema claro:** a bolinha de cor escolhida tem borda `#fff` (`os.js:663`) — some no fundo branco; trocar por borda escura/azul.
- **Etapa "Aguardando aprovação"** (pedida no doc §5): não existe em `OS_STATUS`/`ETAPAS_BASE` (`store.js:13-27`). Ver riscos (item R6).

### 1.2 `js/pages/aparelhos.js` (243) — estoque de celulares à venda

**Hoje:** módulo inteiro de celulares seminovos/novos: indicadores, filtros, card com IMEI/bateria (`aparelhos.js:63-93`), anúncio no WhatsApp 📱 (`95-97`), venda com troca de aparelho (`155-213`), compra de aparelho de cliente (`216-241`). Usa `GARANTIA_SEMINOVO_DIAS` (6 meses fixo) e `ehCelular` (`store.js:66-69`).

**O que muda:** não serve para oficina. O doc (§4.2) fala em "veículos usados à venda" opcional no Pro. Proposta: **esconder o módulo** na Etapa 3 (rota e menu) e decidir na Etapa 6 se vira "Veículos à venda" (campos: placa, marca, modelo, ano, km, cor, fotos, preço; sem IMEI, sem bateria, sem "troca de aparelho"). Reescrever do zero sai mais barato que adaptar (quase todo texto e campo é de celular).

### 1.3 `js/pages/padrao.js` (98) — desenho de desbloqueio

**Hoje:** grade 3×3 desenhada com o dedo, SVG para tela/impressão (`padrao.js:12-24`), desenho no PDF (`27-41`), campo no formulário (`44-97`).

**O que muda:** **apagar o arquivo** e todas as chamadas: `os.js:406`, `os.js:418`, `os.js:441`, `os.js:473`; `pdf.js:183-187`, `pdf.js:438`; `print.js:91`, `print.js:145`; tag `<script>` em `index.html:41` e na lista de cache `sw.js:8`. Os acessos em `pdf.js`/`print.js` já testam `typeof Padrao !== 'undefined'`, então tirar o arquivo não quebra, mas o código morto deve sair.

### 1.4 `js/pages/fotos.js` (122) — fotos no bucket privado

**Hoje:** `MAX: 8` (`fotos.js:6`); reduz para 1280 px JPEG (`14-21`); envia para `lojas-privado/<loja>/aparelhos/<uid>.jpg` (`fotos.js:28`); link assinado de 1 h (`35-42`); dataURL para o PDF (`45-51`); `paraImprimir` corta em `MAX` (`fotos.js:54`); campo "Fotos do aparelho (estado na entrada: riscos, trincas, marcas)" (`fotos.js:61`); galeria (`107-121`); apaga fotos órfãs ao salvar (`99-104`).

**O que muda:**
- `MAX: 8` → `12` (`fotos.js:6`). Isso já vale para envio e impressão (`fotos.js:54`, `76`, `81-82`).
- Pasta `aparelhos/` → `veiculos/` (`fotos.js:28`). A política do bucket só olha a 1ª pasta (= id da loja) (`25_fotos_aparelho.sql:12-18`), então a troca é segura e fotos antigas continuam abrindo.
- Textos: "Fotos do aparelho" (`fotos.js:61`, `109`) → "Fotos do veículo na entrada"; dica de ângulos (frente, traseira, lado esquerdo, lado direito, painel com km, avarias).
- Mensagem de erro "Rode a migração 25 (fotos do aparelho)" (`fotos.js:30`) → texto para o dono, sem citar migração (regra 9).
- Continua guardando só o caminho (armadilha §12 já atendida).

### 1.5 `js/pages/orcamentos.js` (194)

**Hoje:** itens genéricos `[{desc, qtd, valor}]`, total = Σ valor×qtd (`orcamentos.js:6`); formulário com "Aparelho e problema", IMEI, "Ex: iPhone 11" (`58-59`); itens livres + "Do catálogo" (`75-88`); salva `aparelho:{modelo, imei, tipo:'celular'}` (`99`); busca de cliente por nome/telefone/CPF/aparelho/IMEI (`112-150`); detalhe com mensagem 📱 (`156`); aprovar → cria aparelho `tipo:'celular', idTipo:'imei'` (`189`) e abre a OS com `servico` = descrições juntadas por " + " e `valor` = total (`191`).

**O que muda:**
- Itens: separar em `itensServico[]` e `itensPeca[]` (ou um campo `tipo: 'servico'|'peca'` por item — mais simples e compatível). Peça do estoque com sugestão (como `Cotacao.achaPeca`). Subtotais mão de obra/peças no formulário, no detalhe (`161-162`), na mensagem (`156`) e no `Print.orcamento`.
- **Aprovar → OS** (`184-192`): hoje achata tudo em texto + valor. Precisa levar os itens separados para a OS. Decidir quando dá baixa no estoque das peças (na abertura da OS ou quando a peça é aplicada).
- Campos "Aparelho"/"IMEI" (`59`) → veículo (placa + marca/modelo/ano) e km; busca de cliente (`113-115`, `130` "Nome, telefone, CPF ou aparelho") → incluir placa normalizada.
- Busca da lista (`22`, `33`) "Buscar cliente, aparelho, nº..." → placa.
- Ícone `phone` (`40`) → carro/moto.
- "Cotar peça" (`65`, `170`) passa marca/modelo/ano.
- Aprovação pelo cliente no link (doc §6.5): não existe nada hoje; seria uma função SQL nova pública por token (como `acompanhar_os`). Sugiro marcar como etapa futura.

### 1.6 `js/pages/cotacao.js` (160) — cotação/pedido de peça pelo WhatsApp

**Hoje:** `Cotacao.mensagem` monta "Olá, qual valor da {peca}?" / "Olá, quero pedir {q}x {peca}." (`cotacao.js:9-14`). `abrir(tipo, ctx)` recebe `ctx.aparelho` (só o modelo em texto) e tira "64GB/TB" do nome (`cotacao.js:27`). `nomeFinal` acrescenta " do {modelo}" quando a peça digitada não contém as palavras com número do modelo (`cotacao.js:42-46`). Placeholder "Ex: tela sem aro, bateria, conector de carga" (`cotacao.js:31`). Cadastro de até 3 fornecedores (`68-91`). Aba "Pedido fornecedor" com lista no localStorage `rs_pedido_forn_<loja>` (`96-160`).

**O que muda:**
- `ctx` passa a ser `{marca, modelo, ano, osNumero}`; `mod` = `modelo + ano` (ex.: "Onix 2019") → "Olá, qual valor da pastilha dianteira do Onix 2019?" (exatamente o exemplo do doc). Como a regra de `nomeFinal` usa as palavras com número como chave (`cotacao.js:44`), o ano entra como chave: se o mecânico já escreveu "2019", não duplica.
- Tirar a regra de "GB/TB" (`cotacao.js:27`), que é de celular.
- Placeholder → "Ex: pastilha dianteira, filtro de óleo, correia dentada".
- Chamadas que passam `aparelho`: `os.js:488`, `orcamentos.js:65` (lê `#orc-ap`), `orcamentos.js:170`.
- Chave do localStorage `rs_pedido_forn_` (`cotacao.js:98`): trocar prefixo para o produto novo (evita confusão se as duas apps rodarem no mesmo navegador/domínio de teste).

### 1.7 `js/pages/clientes.js` (177) — clientes e aparelhos

**Hoje:** lista com busca por nome/telefone/CPF/e-mail/modelo/IMEI (`clientes.js:20`, `30`); contagem "aparelho(s)" (`38`); formulário do cliente com DDI (`44-71`); `aparelhoFields` com tipos de `TIPOS_APARELHO` (celular, tablet, notebook...) e IMEI/SERIAL (`73-95`); editar com lista de aparelhos (`97-130`); detalhe com aparelhos e "Histórico de OS" (`132-162`); CSV com coluna "Aparelhos" (`171-175`).

**O que muda:**
- `c.aparelhos` → `c.veiculos` (doc §7). `aparelhoFields`/`bindAparelho` (`73-95`) → `veiculoFields`/`bindVeiculo` (tipo carro/moto, placa com máscara e aviso, marca, modelo, ano fab/modelo, cor, combustível, chassi, cilindrada/motor/câmbio conforme o tipo). Esses dois são usados também em `os.js:322-323`, `566`, `571`.
- **Placa única por oficina:** ao digitar a placa, procurar em todos os clientes (`Store.db.clientes[].veiculos[]`) e oferecer "usar o cadastro existente".
- Busca (`20`, `30`): incluir `placa` normalizada (sem hífen, maiúscula).
- Detalhe (`153`): cada veículo com botões "Histórico" (todas as OS daquela placa, inclusive de outro dono) e "Nova OS"; estatística "Aparelhos" (`143`) → "Veículos".
- CSV (`172-173`): coluna "Veículos" com placa + modelo.
- Textos: "Cadastro de clientes, aparelhos e histórico" (`9`), "dispositivos associados" (`100`), "Adicionar Dispositivo" (`105`), "Aparelho adicionado" (`117`), "Como conheceu a loja" (`58`).
- Migração de dados antigos não se aplica (produto novo, banco novo), então pode trocar o nome do campo sem compatibilidade.

### 1.8 `js/pages/followup.js` (82) — agenda de contatos (Pro)

**Hoje:** follow-ups manuais `{clienteId, motivo, status, proximoContato, obs, historico}`; motivos incluem "Retorno / revisão" e "Aparelho não retirado" (`followup.js:3`); abas Hoje/Próximos/Concluídos (`15-27`); botão WhatsApp com "Olá {nome}! Aqui é da {loja}." (`followup.js:40`) que marca como contatado (`46-51`). Fica dentro da tela Pós-venda (`outros.js:76`, `84`).

**O que muda (lembrete de revisão):**
- Novo motivo `revisao` ("Revisão / próxima troca"); "Aparelho não retirado" → "Veículo não retirado".
- Lembretes vêm de `o.proximaRevisao {data, km}` das OS pagas. Duas opções: (a) ao pagar a OS, criar um follow-up `motivo:'revisao'` com `proximoContato = proximaRevisao.data` (aproveita a tela atual, o "contatado" e o histórico); (b) lista calculada na hora, como `PosVenda.compras()` (`outros.js:26-35`). Recomendo (a): aparece em "Hoje e atrasados" no dia certo sem lógica nova.
- Mensagem pronta do doc: "Oi, {nome}! Aqui é da {oficina}. Tá chegando a hora da revisão do seu {modelo} ({placa}). Quer agendar?" — `linha()` (`followup.js:40`) precisa escolher a mensagem pelo motivo.
- Respeitar o plano: o card do painel já testa `Cloud.temRecurso('followup')` (`dashboard.js:70`).

### 1.9 `js/pages/dashboard.js` (124) — Visão geral

**Hoje:** faturamento/meta/lucro do dia (`31-53`), quadradinhos por etapa com rótulos fixos `{analise:'Em análise', peca:'Aguard. peça', servico:'Em serviço', concluido:'Prontas'}` (`56`), metas do mês (`63-66`), pedidos não lidos (`67-69`), pós-venda "oferecer capa/película" (`70-72`), mês, atrasadas, estoque baixo (`73-78`), gráfico 7 dias (`80-85`), prontas para retirada e últimas OS (`87-96`), `detalheHoje` com "Aparelhos recebidos na troca" (`111`), `osMini` com modelo + defeito (`117-123`).

**O que muda:** "Prontas"/"Prontas para retirada" ok; `osMini` (`121`) mostra placa + modelo; card novo "Revisões desta semana" (Pro); texto do pós-venda "capa/película" (`72`) → algo de oficina (ou tirar a oferta); "Aparelhos recebidos na troca" (`111`) some se não houver troca; faturamento do mês pode mostrar "Mão de obra × Peças" (`75` hoje mostra "OS × Vendas"). Os rótulos fixos de `56` ignoram cards renomeados; com "Aguardando aprovação" o quadradinho usará `OS_STATUS[st].label`, ok.

### 1.10 `js/pages/pedidos.js` (107) — pedidos de orçamento enviados pelo link público

**Hoje:** lista/aviso sonoro/popup dos pedidos (`pedidos.js:5-65`); `aparelho(p)` junta marca + modelo com regra especial para Apple/iPhone (`pedidos.js:10-13`); mensagem 📱 "Recebemos seu pedido... para o *{aparelho}*" (`85`); "Aceitar e criar orçamento" preenche cliente/aparelho/defeito (`95-101`).

**O que muda:** `aparelho(p)` → `veiculo(p)` = "marca modelo ano" (sem regra Apple); mostrar placa se vier; ícone `phone` (`39`); mensagem do WhatsApp (`85`) sem 📱; `criarOrcamento` passa `veiculo` estruturado.

### 1.11 `js/pdf.js` (545) — PDFs (jsPDF) e cupom térmico

**Hoje:**
- Cores `pdfCor()`/`pdfCorEscura()` com dourado de fallback (`pdf.js:4-5`).
- `garantia(d)` A4 (`26-116`): cabeçalho, selo "GARANTIA DE 3 MESES (90 DIAS)" (`selo`, `136-139`), "Aparelho seminovo"/"Serviço de reparo" (`45`), blocos Cliente, Aparelho com IMEI/Serial (`66-67`), tabela de itens (`72-80`), total, validade início/fim (`86-95`), condições, assinaturas com "Técnico responsável" (`112`). **Não tem quebra de página no laço dos itens** (`76-80`), só antes das assinaturas (`104`).
- `cabecalho` em fundo branco com moldura (`120-134`); fallback "Assistência técnica" (`125`).
- `ordem(o)` A4 (`149-238`): Cliente; Aparelho com IMEI/Senha/Acessórios (`180-182`); Desenho (`183-187`); Serviço (`188-190`); Checklist em 3 colunas usando **a constante** `CHECKLIST_ITENS` (`191-200`); Fotos 4 por linha em caixa 4:3 com `cabe()` por linha (`201-212`); "VALOR DO SERVIÇO" (`216-217`); Termos + link + assinaturas mantidos juntos com `cabe(...)` (`220-234`); rodapé "página n de N" (`235-236`). Só blocos de fotos/valor/termos chamam `cabe()`; os demais podem passar de 280 mm sem quebrar.
- `recibo(v)` (`241-331`) com IMEI, troca de aparelho, "Celulares seminovos"/"Celulares novos e acessórios" (`306-307`).
- Cupom 80/58 mm (`336-429`); `cupomOrdem` (`431-452`) com IMEI, Senha, Desenho, "Acompanhe o reparo em" (`449`); `cupomRecibo` (`454-478`); `cupomGarantia` (`480-499`) "apresente este termo junto com o aparelho na loja" (`495`).
- `GarantiaDados.os` (`519-531`): **um item só** = `servico` valendo `total + desconto`, e as peças com `valor: null` ("incluso") (`526`). `GarantiaDados.venda` (`533-544`) por seminovo.

**O que muda:**
- Cores: fallback para azul (`#1D4ED8` = `[29, 78, 216]`; escuro `#1E40AF` = `[30, 64, 175]`) em `pdf.js:4-5`; nomes `GOLD/GOLD_D` → `COR/COR_E` (`31`, `121`, `153`, `245`).
- Cabeçalho: fallback "Oficina mecânica" (`125`). Doc pede "cabeçalho com borda azul": já é só moldura (`122`, `141`) — basta trocar a cor.
- **OS (`ordem`)**: bloco "Veículo" (tipo, placa em destaque, marca/modelo/ano, cor, km de entrada, combustível, chassi) no lugar de `180-187`; "Técnico" → "Mecânico" (`190`); checklist vindo da **lista salva na OS** (não da constante, ver R5) e em 3–4 colunas; nível de combustível; **tabela Mão de obra** (descrição, mecânico, qtd, valor) e **tabela Peças** (qtd, unitário, total), subtotais, desconto, total (no lugar de `213-218`); garantia "X meses ou Y km"; próxima revisão; fotos com `MAX 12` (3 linhas de 4: cerca de 107 mm). Pôr `cabe()` também nas linhas das tabelas e no checklist. Manter o bloco termos+link+assinaturas junto (`222`).
- **1 página sem fotos**: hoje cabe, mas o tamanho do texto `s.termosEntrada` decide (`220-222`); com tabelas de itens + checklist de 16 itens fica justo. Sugestões: fonte 8–8,5 nas tabelas, checklist em 4 colunas (16 itens = 4 linhas = 20 mm), termos de entrada padrão curtos. Precisa de teste automatizado com dados realistas (≈5 serviços, 6 peças).
- **Garantia (`garantia`)**: selo "GARANTIA DE 3 MESES OU 3.000 KM" (`selo`, `136-139`), "Serviço de reparo" → "Serviço executado"; validade "Válida até dd/mm/aaaa **ou** até o km N" (km de entrada/saída + km da garantia); `GarantiaDados.os` (`526`) passa a listar cada serviço e cada peça com valor; garantia por serviço (doc §6.4) → uma linha por serviço com seu prazo; quebra de página no laço dos itens (`76-80`). "Técnico responsável" (`112`, `497`) → "Mecânico responsável". Texto "junto com o aparelho na loja" (`101`, `495`) → "junto com o veículo na oficina".
- **Cupom** (`cupomOrdem`, `431-452`): placa em fonte grande logo abaixo do nº da OS, km, combustível, itens (`c.item`), sem IMEI/Senha/Desenho (`438`); "Acompanhe o reparo" (`449`) → "Acompanhe o serviço".
- **Recibo**: tirar IMEI (`264`, `460`), troca de aparelho (`273-279`, `463`) e "Celulares..." (`306-307`, `473-474`) → "Peças e produtos".

### 1.12 `js/print.js` (148) — impressão pela tela (A4)

**Hoje:** CSS de impressão com moldura e títulos dourados (`print.js:14`, `20`, `37`); `aparelhoBlock` com IMEI/Serial (`69-76`); `fotosBlock` "Fotos do aparelho" (`79`); `os(o)` (`81-103`) com Senha/Desenho (`90-91`), Técnico (`97`), checklist pela constante (`98`), **sem tabela de itens nem peças**, só "Valor" (`100`); `orcamento` (`105-122`) com tabela; `venda` (`124-137`) com IMEI e "6 meses"; `etiquetas` de produto (`139-141`); `osEtiqueta` 62 mm com nome, modelo, defeito, entrada, **senha e desenho** (`143-146`).

**O que muda:**
- Cores `#d4af37`/`#9a7a10` → azul (`14`, `20`, `37`).
- `aparelhoBlock` → `veiculoBlock` (placa, marca/modelo/ano, cor, km, combustível).
- `os(o)`: tirar Senha/Desenho; checklist da lista salva na OS; **acrescentar tabelas Mão de obra e Peças** (hoje não existem nesta impressão); garantia dias/km; próxima revisão; envolver "Termos + assinaturas" num bloco `break-inside: avoid` (hoje só `.fotos` tem, `print.js:27`).
- **Etiqueta** (`143-146`): placa grande (≈22–26 px, negrito) no topo, OS #, modelo/cor, km, cliente, entrada; sem senha/desenho (doc §6.6).
- `orcamento`: subtotais por tipo; rodapé "sujeito a alteração após análise técnica" (`121`) ok para oficina.
- Observação: há **dois layouts** de OS em A4 (`Print.os` HTML e `Pdf.ordem` jsPDF; escolha em `os.js:156-163`). Sugestão: imprimir A4 também pelo PDF (`Pdf.abrirParaImprimir`, já usado para cupom) e manter um layout só.

### 1.13 `js/acompanhar.js` (123) + `acompanhar.html` (55) — link público do cliente

**Hoje:**
- Lê o token da URL, aplica tema/idioma/moeda da loja (`acompanhar.js:20-33`), chama `acompanhar_os` e repete a cada 15 s + aviso em tempo real pelo canal `os-<token>` (`36-38`, `41-52`).
- `acompanhar_os` (`26_cards_bancada.sql:9-33`) devolve:
  `os{numero, status, historico, aparelho{modelo, imei, idTipo, cor}, defeito, servico, valor, desconto, pecas[{nome,qtd}], previsao, criadoEm, concluidoEm, pagoEm, entregueEm, formaPagamento, assinaturaCliente, garantiaDias, statusNome, statusCor}`, `cliente{nome}`, `loja{nome, cnpj, telefone, endereco, instagram, termosGarantia, garantiaDias, tecnico, assinaturaTecnico}`. Não devolve telefone/CPF do cliente nem fotos; **devolve IMEI e as assinaturas (imagens)**.
- Renderização (`acompanhar.js:60-121`): cabeçalho "Acompanhamento do reparo" (`75`), "Veja como está o seu aparelho" (`76`), status grande com `ST` (`5-12`) e 4 passos `PASSOS` Recebido/Em reparo/Pronto/Entregue (`13-14`, `82-83`), previsão, card de garantia com botão PDF (gera `Pdf.garantia` no navegador, `108-120`), card "Seu aparelho" com modelo/defeito/serviço/entrada/valor (`92-99`), histórico, WhatsApp da loja (`104`). Total calculado local = `valor − desconto` (`65`); garantia só por dias, padrão 90 duplicado (`3`, `68`).

**O que muda:**
- SQL `acompanhar_os` nova: `veiculo{tipo, marca, modelo, ano, cor}`, `placa` **mascarada no SQL** (ex.: `left(p,3) || '•••' || right(p,1)` → "ABC•••3"), `kmEntrada`, `itensServico[{desc, qtd, valor}]`, `itensPeca[{nome, qtd, valor}]`, `total` calculado, `garantiaDias`, `garantiaKm`, `proximaRevisao`. **Nunca** chassi, IMEI, telefone, CPF, fotos.
- Textos: `ST` (`5-12`): "Nosso técnico está avaliando o aparelho", "Seu aparelho está na bancada sendo reparado", "Pronto para retirada — Pode vir buscar seu aparelho", "Aparelho entregue" → mecânico/veículo/pátio; `PASSOS` "Em reparo" → "Em serviço"; incluir "Aguardando aprovação" em `ST`/`ORDEM` (hoje cairia em "Em análise", `63`).
- Card "Seu veículo" com ícone carro/moto, placa mascarada, km, lista de serviços e peças com valores e total.
- Garantia "X meses ou Y km"; `Pdf.garantia` recebe itens separados (`112-116`).
- Mensagem WhatsApp (`104`): "minha OS #{n} ({modelo})" → incluir placa mascarada não faz sentido; usar modelo.
- `acompanhar.html`: título "Acompanhe seu reparo" (`8`), placeholder "Acompanhamento do reparo" (`39`), `theme-color #000000` (`6`), passo apagado com fundo `#1a1a1a` (`27`), cores `--gold` (`18`, `25`, `28-29`), ícones `rs-192/180` (`9-10`, `39`).

### 1.14 `pedido.html` (41) + `js/pedido.js` (102) — página pública "Pedir orçamento"

**Hoje:** o cliente escolhe marca de celular (`MARCAS`, `pedido.js:3`), modelo "iPhone 13, Galaxy A54, Moto G84" (`44`), defeito "caiu e a tela quebrou, não carrega, bateria..." (`45`), urgência; envia por `criar_pedido(p_loja, p_nome, p_telefone, p_marca, p_modelo, p_defeito, p_urgencia)` (`pedido.js:64`; SQL em `supabase/schema.sql:208-235`). Meta tags falam de celular (`pedido.html:8`, `10`).

**O que muda:** tipo carro/moto (escondido se a oficina só atende um), marcas de carro/moto conforme `tiposVeiculo`, modelo, **ano** e placa (opcional), defeito "barulho ao frear, luz da injeção acesa, revisão dos 20 mil km". A função SQL tem assinatura fixa: para guardar ano/placa precisa de função nova (`criar_pedido_v2`) ou juntar no campo modelo. Ajustar meta tags/tema (`pedido.html:6`, `8-13`, `20`, `28`).

---

## 2. Textos visíveis com vocabulário de celular (por arquivo)

Contagem automática (case-insensitive). "Total" inclui nomes internos (`o.aparelho`, `tecnicoId`...); "~texto" é a estimativa do que aparece na tela/PDF. Exemplos com linha.

| Arquivo | aparelho | celular | técnico | bancada | IMEI/serial | tela | bateria | reparo | loja | senha/desenho | outros (iPhone, chip, capa...) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| os.js | 54 / ~17 | 1 | 18 / ~8 | 13 / ~12 | 11 / ~5 | 2 | – | 7 / ~5 | 21 / ~12 | 16 / ~6 | chip/carregador/conector 5 |
| aparelhos.js | 52 / ~30 | 8 / ~3 | – | – | 19 / ~12 | – | 9 / ~4 | – | 2 | – | seminovo 21; iPhone 1 |
| padrao.js | 2 | 1 | – | – | – | 1 | – | – | – | 16 | Android/iPhone 6 |
| fotos.js | 6 / ~6 | – | – | – | – | – | – | – | 6 / ~4 | – | – |
| orcamentos.js | 34 / ~14 | 2 | – | – | 9 / ~5 | – | – | – | 3 | – | iPhone 1 |
| cotacao.js | 4 / ~3 | – | – | – | – | 6 | 1 | – | 1 | – | Samsung 2; conector 1 |
| clientes.js | 32 / ~12 | 2 | – | – | 22 / ~18 | – | – | – | 4 / ~3 | – | iPhone 1; chip 1 |
| followup.js | 1 | – | – | – | – | – | – | – | 1 | – | – |
| dashboard.js | 3 / ~1 | – | 2 (comentário) | – | – | – | – | – | – | – | capa/película 1 |
| pedidos.js | 6 / ~2 | – | – | – | – | – | – | – | 5 | – | Apple/iPhone 1 |
| pdf.js | 28 / ~15 | 6 | 21 / ~6 | – | 37 / ~19 | 1 | – | 5 | 26 / ~12 | 15 / ~4 | seminovo 20; "Assistência técnica" 1 |
| print.js | 10 / ~3 | – | 3 / ~1 | – | 10 / ~5 | – | – | – | 4 | 7 / ~4 | – |
| acompanhar.js | 11 / ~8 | – | 5 / ~2 | 1 | (SQL devolve) | – | – | 10 / ~8 | 11 / ~11 | – | – |
| acompanhar.html | – | – | – | – | – | – | – | 2 | – | – | – |
| pedido.html | 1 | 1 | – | – | – | – | – | – | – | – | – |
| pedido.js | 3 | – | – | – | – | 1 | 1 | – | 16 / ~7 | – | marcas de celular 6 |

Exemplos por arquivo (texto exato):
- **os.js**: "Total em bancada" (`20`), "Tempo médio em bancada" (`23`), "Buscar cliente, IMEI, OS..." (`31`), "Recebemos seu aparelho *{modelo}*" 📱 (`124`), "Seu aparelho ... está *pronto para retirada*!" (`127`), "Reparo finalizado!" / "Garantia do reparo" (`181-183`), "O pagamento é registrado pelo atendente ou pelo dono." (`197`), "Responsável e assinatura técnica", "assinatura do técnico" (`238`, `251`), "Técnico responsável" (`250`), "Nenhum técnico cadastrado... Cadastrar técnicos" (`253`), passos "Aparelho" (`272`), "aparelho(s)" (`308`), "Qual aparelho?", "Aparelhos do cliente" (`320-321`), "Informe o modelo do aparelho" (`329`), "Imprimir etiqueta do aparelho" (`367`), "Não carrega, tela quebrada" (`394`), "Troca de conector de carga" (`396`), "Técnico" (`403`), "Senha / padrão", "Senha do aparelho" (`406`), "padrão da loja" (`407`), "Capinha, carregador, chip" (`409`), "aparelho com marcas de uso" (`414`), card "Aparelho"/"IMEI"/"Senha"/"Desenho" (`469-473`), "Técnico" (`480`), "Bancada" / "Aparelhos em reparo" (`610`), "d na bancada" (`621`), "Cards da bancada", "etapas da sua loja" (`638-639`), "Tirar o card ... da bancada?" (`673`), "Card de volta na bancada" (`680`).
- **aparelhos.js**: "Aparelhos — Celulares seminovos e novos em estoque..." (`21`), "Comprar aparelho" (`24`), "Cadastrar aparelho no estoque" (`25`), "Buscar modelo, IMEI, cor..." (`40`), "IMEI" (`78`, `125`, `165`), "Saúde da bateria" (`127`), "Ex: iPhone 11 64GB" (`125`), "Vender aparelho", "Aparelho vendido" (`160-163`), "Cliente vai dar um aparelho na troca" (`168`), "Comprar aparelho" (`218`).
- **padrao.js**: "Desenhar padrão de desbloqueio" (`47`), "Desenho de desbloqueio (Android: ligue os pontos...)" (`49`).
- **fotos.js**: "Fotos do aparelho (estado na entrada: riscos, trincas, marcas)" (`61`, `109`), "Rode a migração 25 (fotos do aparelho)" (`30`).
- **orcamentos.js**: "Buscar cliente, aparelho, nº..." (`22`), "Aparelho e problema", "Aparelho — Ex: iPhone 11", "IMEI" (`58-59`), "Informe o aparelho" (`96`), "Nome, telefone, CPF ou aparelho" (`130`), mensagem com 📱 (`156`).
- **cotacao.js**: "Ex: tela sem aro, bateria, conector de carga" (`31`), comentário "tela 11 acha Tela iPhone 11 Incell" (`5`), "tela sem aro do Samsung A12" (`41`).
- **clientes.js**: "Cadastro de clientes, aparelhos e histórico" (`9`), "Buscar nome, telefone, CPF, IMEI..." (`20`), "aparelho(s)" (`38`), "Como conheceu a loja" (`58`), "Tipo de aparelho" (`75`), "Ex: iPhone 13 Pro Max" (`78`), "IMEI"/"SERIAL"/"Número de série" (`80-83`), "dispositivos associados" (`100`), "Aparelhos", "Adicionar Dispositivo" (`102-105`), "Nenhum aparelho cadastrado." (`111`), "Aparelho adicionado" (`117`), "Aparelhos" (`143`, `153`), CSV "Aparelhos" (`172`).
- **followup.js**: "Aparelho não retirado" (`3`).
- **dashboard.js**: "para oferecer capa/película" (`72`), "Aparelhos recebidos na troca" (`111`).
- **pedidos.js**: 📱 na mensagem "para o *{aparelho}*" (`85`).
- **pdf.js**: "Aparelho seminovo" / "Serviço de reparo" (`45`, `485`), "Aparelho" (`66`, `180`, `438`, `487`), "Serial"/"IMEI" (`67`, `182`, `438`, `487`), "apresente este termo ... junto com o aparelho na loja" (`101`, `495`), "Técnico responsável" (`112`, `497`), "Assistência técnica" (`125`), "Senha", "Desenho", "Começa no ponto 1" (`182-185`), "Técnico" (`190`, `440`), "Fotos do aparelho" (`204`), "IMEI" no recibo (`264`, `276`, `460`, `463`), "Aparelho recebido na troca" (`276`), "Celulares seminovos"/"Celulares novos e acessórios" (`306-307`, `473-474`), "Acompanhe o reparo em" (`449`).
- **print.js**: "Aparelho" (`72`), "Serial"/"IMEI" (`74`, `131`, `135`), "Fotos do aparelho" (`79`), "Senha", "Desenho" (`90-91`, `145`), "Técnico" (`97`).
- **acompanhar.js**: "Nosso técnico está avaliando o aparelho." (`6`), "Em reparo", "Seu aparelho está na bancada sendo reparado." (`8`), "Reparo finalizado! Pode vir buscar seu aparelho." (`9`), "Aparelho entregue." (`10`), "Fale com a loja" (`11`), passos "Em reparo" (`13`), "A loja ainda não ativou..." (`24`), "Fale com a loja" (`45`), "Etapa do seu reparo" (`63`), "Acompanhamento do reparo" (`75`), "Veja como está o seu aparelho" (`76`), "Seu aparelho"/"Aparelho" (`93-94`), "Etapa do reparo" (`102`), "Falar com a loja no WhatsApp" (`104`).
- **acompanhar.html**: "Acompanhe seu reparo" (`8`), "Acompanhamento do reparo" (`39`).
- **pedido.html**: "conserto do seu celular" (`8`), "problema do seu aparelho" (`10`).
- **pedido.js**: marcas de celular (`3`), "A loja ainda não ativou..." (`14`), "Loja não encontrada" (`18`), "Conte o que aconteceu com seu aparelho" (`37`), "Seu aparelho" (`42`), "Ex: iPhone 13, Galaxy A54, Moto G84" (`44`), "caiu e a tela quebrou, não carrega, bateria..." (`45`), "Informe o modelo do aparelho" (`60`), "Falar com a loja agora" (`89`).

Observação: "loja" aparece em quase todo arquivo ("padrão da loja", "Falar com a loja", "Fale com a loja") → "oficina". Muitas frases passam por `t(...)`, então a troca também precisa ir para as chaves de `js/i18n-es.js`.

---

## 3. Dourado e cores escuras (PDF, impressão, link do cliente)

| Arquivo:linha | O que é | Trocar por |
|---|---|---|
| `js/pdf.js:4` | `pdfCor()` fallback `[212, 175, 55]` (#D4AF37) | `[29, 78, 216]` (#1D4ED8) |
| `js/pdf.js:5` | `pdfCorEscura()` fallback `[154, 122, 16]`; com tema mistura `cor_secundaria` com preto | `[30, 64, 175]` (#1E40AF) |
| `js/pdf.js:31, 40, 42, 50, 94` | `GOLD`/`GOLD_D` no selo, títulos e "válida até" da garantia | renomear e usar o azul |
| `js/pdf.js:121, 131` | número do documento no cabeçalho em `GOLD_D` | azul escuro |
| `js/pdf.js:141, 144` | moldura e linha do rodapé `pdfCor()` | azul |
| `js/pdf.js:153, 162` | títulos da OS sublinhados em `GOLD` | azul |
| `js/pdf.js:245, 252` | títulos do recibo em `GOLD` | azul |
| `js/print.js:14` | moldura do cabeçalho `#d4af37` | `#1D4ED8` |
| `js/print.js:20` | sublinhado dos títulos `#d4af37` | `#1D4ED8` |
| `js/print.js:37` | `.stamp` borda `#d4af37`, texto `#9a7a10` | `#1D4ED8` / `#1E40AF` |
| `js/print.js:23` | `th` fundo `#f3f3f3` (claro, ok) | pode virar `#F5F7FA` |
| `js/acompanhar.js:10` | status "pago/Entregue" cor `#d4af37` | azul ou verde `#16A34A` |
| `js/acompanhar.js:75` | número da OS com `color:var(--gold)` e borda `--gold-rgb` | variáveis novas |
| `js/acompanhar.js:84, 88-89, 94, 98` | `pill gold`, card de garantia `--gold-soft`, `.gold` | variáveis novas |
| `acompanhar.html:6` | `theme-color #000000` | `#FFFFFF` ou `#1D4ED8` |
| `acompanhar.html:18` | sombra dourada no logo | sombra suave |
| `acompanhar.html:25` | barra de progresso `var(--gold-grad)` | gradiente azul |
| `acompanhar.html:27` | bolinha do passo fundo `#1a1a1a` (escuro) | `#F5F7FA` com borda `#E3E8EF` |
| `acompanhar.html:28-29` | passo ativo `--gold`, texto `#000` | azul com texto branco |
| `pedido.html:6, 20` | `theme-color #000000`, sombra dourada no logo | idem |
| `js/pedido.js:36-37, 85-87` | classes `.gold` | dependem do CSS novo |
| `js/pages/padrao.js:14, 18, 22, 69` | dourado e brancos translúcidos | arquivo será removido |
| `js/pages/os.js:663` | bolinha de cor selecionada com borda `#fff` (some no tema claro) | borda `#0F172A` ou azul |
| `js/store.js:18` (referência) | `OS_STATUS.pago.color '#d4af37'` (usado em barras/pills da lista e em `acompanhar` via `ST`) | outra cor |

As classes `gold`, `outline-gold`, `pill gold` aparecem dezenas de vezes nos arquivos de página. Sugestão: **não renomear as classes agora**; redefinir `--gold*` no CSS para os azuis (o mapa de `css/style.css` é de outra parte). Renomear depois, se valer a pena.

---

## 4. Riscos e pontos do documento que não batem com o código (com proposta)

- **R1. `garantia { dias, km }` (doc §7) × `garantiaDias` número** usado em `Store.garantiaDiasOS` (`store.js:236`), `acompanhar_os` (`26_cards_bancada.sql:21`), `acompanhar.js:68`, `os.js:407`, `os.js:442`. Proposta: manter `garantiaDias` e **acrescentar `garantiaKm`**, em vez de um objeto novo; menos lugares para mudar.
- **R2. `itensServico[]`/`itensPeca[]` × `valor`/`pecas`.** Todo o financeiro lê `Store.osTotal` (`valor − desconto`) e `osCustoPecas` (`o.pecas`): `store.js:188-189`, `203`, `224`; `financeiro.js:24`; relatórios `outros.js:241`, `264`, `278`; `clientes.js:136`; `acompanhar.js:65`; SQL `acompanhar_os` (devolve `valor`/`pecas`). Proposta: (a) mudar `osTotal`/`osCustoPecas` para somar os itens; (b) **gravar `o.valor` = soma bruta dos itens** sempre que salvar (cache), para relatórios e SQL continuarem certos; (c) o lançamento financeiro ganha `maoDeObra` e `pecas` (para o relatório "mão de obra × peças do mês").
- **R3. Peças do estoque baixam na hora** em que são adicionadas (`os.js:546`), mesmo com OS "Em análise" e sem aprovação; no orçamento não há baixa nenhuma, e "Aprovar → OS" achata tudo em texto (`orcamentos.js:191`). Proposta: baixa ao **abrir a OS** (ou ao marcar a peça como aplicada) e devolução automática se a peça sair/OS for interrompida; levar os itens do orçamento para a OS.
- **R4. Metas "OS concluídas por mecânico" (doc §5).** Ir direto para "Pago" **registra** quem finalizou (`store.js:216-221`), mas é **o usuário logado** que clicou (atendente que recebeu), e o papel "técnico" nem pode receber (`os.js:197`). Os mecânicos da OS são `Store.s.tecnicos` (`{id, nome, assinatura}`, `outros.js:509`) — **não ligados ao login** — e o relatório por técnico usa `tecnicoId` (`outros.js:264`). Metas usam `concluidoPor || criadoPor` (`metas.js:281`). Proposta: ligar cada mecânico cadastrado a um membro da equipe (`userId` opcional) e contar a meta pelo mecânico dos itens de mão de obra (ou `tecnicoId`), com `concluidoPor` só como reserva. Sem nuvem, `quem()` é `{}` e nada é gravado (`store.js:173-176`).
- **R5. Checklist editável quebra OS antigas no PDF/impressão.** O PDF, o cupom e a impressão percorrem a constante `CHECKLIST_ITENS` (`pdf.js:194`, `199`, `443`; `print.js:98`), não o que foi salvo. Se a oficina renomear/tirar um item, ele some dos documentos das OS antigas. Proposta: gravar na OS a lista usada (`o.checklistItens`) ou imprimir por `Object.entries(o.checklist)` + itens não verificados da lista salva.
- **R6. "Aguardando aprovação" no Pátio (doc §5)** não existe em `OS_STATUS`/`ETAPAS_BASE` (`store.js:13-27`), nem em `ST`/`ORDEM` do link (`acompanhar.js:5-14`) — cairia em "Em análise" (`acompanhar.js:63`). Proposta mais barata: criar essa etapa como **card padrão `e_aprovacao`** na criação da oficina (as etapas extras já levam `statusNome`/`statusCor` até o link, `store.js:210-212`, sem mudar SQL); ou acrescentar `aprovacao` em `OS_STATUS`, `ETAPAS_BASE`, `dashboard.js:56`, `ST` e `ORDEM`.
- **R7. Placa única por oficina** (doc §4.2): veículos ficam dentro do jsonb do cliente; o banco não consegue garantir unicidade dentro de arrays sem trigger, e o app funciona offline (dois aparelhos podem criar a mesma placa). Proposta: checagem no app + aviso "placa já cadastrada em {cliente}" + ferramenta de juntar; índice no Postgres só para **busca** de OS por placa (`(dados #>> '{veiculo,placa}')` normalizada), não como trava.
- **R8. Busca pela placa com/sem hífen:** `matches` só faz `norm` (minúsculas, sem acento) e `includes` (`util.js:97-98`); "abc-1234" não acha "ABC1234". Proposta: guardar `placa` já normalizada (`[A-Z0-9]`, maiúscula) e normalizar a busca. Extra: placa antiga convertida para Mercosul troca o 5º caractere (dígito 0–9 → letra A–J): "ABC1234" ↔ "ABC1C34". Tratar as duas como o mesmo veículo no histórico.
- **R9. Histórico do veículo "por placa"**: hoje o histórico é por cliente (`clientes.js:134`, `154`). Se o carro trocar de dono, só a busca de OS por `o.veiculo.placa` (cópia na OS, `os.js:348`) mostra tudo — precisa ser por placa, não por `clienteId`.
- **R10. Lembrete de revisão por km** não tem data: a oficina não sabe quando o carro chega a +5.000 km. Proposta: o lembrete dispara pela data; se só houver km, estimar a data pela média de km/dia das OS anteriores da mesma placa; sem histórico, usar a data padrão (6 ou 3 meses).
- **R11. PDF "1 página sem fotos"** não é garantido hoje: depende do tamanho de `s.termosEntrada` (`pdf.js:220-222`) e, com tabelas de itens + checklist de 16 itens, fica no limite. Além disso só fotos/valor/termos chamam `cabe()` (`pdf.js:161`, `204-206`, `214`, `222`); tabelas longas podem passar do rodapé. `Pdf.garantia` não quebra página no laço de itens (`pdf.js:76-80`). Proposta: `cabe()` em toda linha de tabela, checklist em 4 colunas, teste Playwright que conta páginas com OS cheia sem fotos (=1) e com 12 fotos (termos + assinaturas na mesma página).
- **R12. Dois layouts A4 da OS** (`Print.os` em HTML e `Pdf.ordem` em jsPDF, escolhidos em `os.js:156-163`). Mudar tudo em dobro. Proposta: A4 "Imprimir" também pelo PDF. Se manter o HTML, pôr termos+assinaturas em bloco `break-inside: avoid` (hoje só fotos, `print.js:27`).
- **R13. Link do cliente devolve dados demais:** `aparelho.imei` e as assinaturas em imagem (cliente e técnico/dono) (`26_cards_bancada.sql:14`, `20`, `26-27`) vão para qualquer um com o link. O doc proíbe CPF, telefone e fotos; não fala de assinatura. Proposta: não devolver chassi; devolver assinatura só se o PDF de garantia precisar (pergunta para o dono) — ou gerar o PDF sem assinaturas no link.
- **R14. Pedido público** (`criar_pedido`, `supabase/schema.sql:208`) tem assinatura fixa sem ano/placa/tipo. Proposta: função nova `criar_pedido_veiculo` (aditiva), mantendo a antiga.
- **R15. Fotos 12**: `Fotos.MAX` também limita o que vai para impressão (`fotos.js:54`); 12 fotos = 3 linhas de 4 (≈107 mm no PDF), com quase certeza a OS vai a 2 páginas. Ok pelo doc ("quebra correta"), mas precisa de teste. O limite de 3 MB/foto do bucket continua (`25_fotos_aparelho.sql:7`).
- **R16. "Senha" removida:** oficina às vezes precisa do código do alarme/rádio; o doc manda remover a senha do aparelho. Proposta: não criar campo dedicado; deixar em "Observações internas" (que não sai no link).
- **R17. Garantia "por serviço"** (doc §6.4) × garantia única por OS hoje (`store.js:236-237`, cartão do link, "Garantia acabando" em `outros.js:69-72`). Proposta: cada item de mão de obra herda do catálogo; a OS mostra a maior (para avisos) e o PDF lista por item.
- **R18. Pós-venda/Follow-up de celular**: modelos "capa + película" (`outros.js:20`, `dashboard.js:72`) e "Compra de celular" (`outros.js:121`). Não é meu arquivo, mas o follow-up de revisão depende dele: trocar a oferta por algo de oficina ou tirar.
- **R19. WhatsApp e DDI** (armadilha §12): `waLink` põe 55 em qualquer número sem "+" com até 11 dígitos (`util.js:94`); um celular chileno de 9 dígitos digitado sem "+" vira Brasil. Todas as mensagens desta parte passam por `waLink`. (Arquivo de outra parte; registrar o risco.)
- **R20. `aparelhos.js` inteiro** é de celular (IMEI, bateria, troca); adaptar custa mais que esconder. Proposta: esconder na Etapa 3, decidir "veículos à venda" na Etapa 6.
- **R21. Constante duplicada** `GARANTIA_REPARO_DIAS = 90` em `acompanhar.js:3` e `store.js:65`; com km, criar também o padrão de km nos dois lugares (ou mandar sempre o valor da oficina pelo SQL).
- **R22. Nomes internos**: o doc permite manter nomes internos. Recomendo **trocar** `aparelho`→`veiculo` nos dados (banco novo, sem legado) mas manter a chave de papel `tecnico` (usada em RLS/permissões: `os.js:197`, `dashboard.js:22`, `store.js:258`) e só mudar o rótulo para "Mecânico".
