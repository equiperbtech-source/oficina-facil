# PROMPT — OFICINA SIMPLES (SaaS para oficinas de carro e moto)

> Cole este texto inteiro no Claude Code, aberto no repositório `equiperbtech-source/oficina-facil`.
> Ele foi escrito para o trabalho ir **do início ao fim sem perguntas**. Você só aprova as permissões das ferramentas.

---

## 0. COMO VOCÊ VAI TRABALHAR (leia primeiro)

1. **Não me faça perguntas.** Todas as decisões de produto estão neste documento. Quando aparecer uma dúvida que ele não responde, escolha a opção **mais simples, mais segura e mais parecida com o Reparo Simples**, siga em frente e anote a escolha em `docs/DECISOES.md` (data, dúvida, o que escolheu, por quê).
2. **Vá até o fim.** Faça todas as etapas da seção 13 em sequência, sem parar para pedir aprovação entre elas. Ao terminar uma etapa, faça commit, escreva `docs/ETAPA-N.md` e passe direto para a próxima.
3. **Só pare se** um teste importante continuar falhando depois de 3 tentativas de correção com causas diferentes. Aí anote em `docs/PENDENCIAS.md` o que falha e por quê, e siga para a próxima etapa.
4. **Nada fora do repositório.** Não publique em produção, não crie projetos na Vercel, no Supabase ou na Kiwify, não mexa em domínio, não mande e-mail ou WhatsApp de verdade. Tudo que depende de mim vai para um checklist final (Etapa 10).
5. **Git:**
   - trabalhe no branch atual;
   - faça um commit por etapa, ou mais se a etapa for grande, com mensagem em português;
   - faça push ao fim de cada etapa;
   - nunca reescreva o histórico.
6. **Teste antes de dizer que está pronto.** Toda etapa termina com `npm run teste` passando e prints do celular (390×844) em `docs/prints/etapa-N/`.

---

## 1. ONDE O PROJETO ESTÁ AGORA

O repositório já tem o código do **Reparo Simples** (sistema SaaS para assistência técnica de celulares, em produção) copiado e adaptado até a **Etapa 2**:

- **Etapa 0** (`docs/ETAPA-0-PLANO.md` + `docs/etapa-0/`): mapa do código, arquivo por arquivo, com o que muda em cada um. **Leia antes de tudo.** Ele traz riscos e armadilhas que valem para todas as etapas.
- **Etapa 1** (`docs/ETAPA-1.md`) — base nova:
  - nome Oficina Simples, chaves `oficina_*` e `OFICINA_*`, logo novo;
  - correções de moeda, WhatsApp/55 e `[hidden]`;
  - nota fiscal e importação de concorrente removidas;
  - ambiente de testes (Postgres local + Supabase falso + Playwright).
- **Etapa 2** (`docs/ETAPA-2.md`): tema branco e azul, contraste AA, PDF e e-mails claros.

Leia também o `README.md`, o `package.json`, `tests/` e `supabase/saas/` para entender como rodar e testar.

**Referência opcional:** se o repositório `israelrbtechia/REPARORBTECH` (branch `saas`) estiver disponível nesta sessão, use-o **só para ler**, como referência das funções mais novas do Reparo Simples listadas na seção 6. Nunca grave nele. Se ele não estiver disponível, implemente essas funções a partir da descrição deste documento.

---

## 2. O PRODUTO EM UMA FRASE

**Oficina Simples** é o Reparo Simples transformado para **oficinas de carro e de moto**. Tem tudo que o original tem: clientes na palma da mão, OS, pátio, orçamento, WhatsApp pronto, garantia em PDF, link do cliente, estoque, fornecedores, vendas, financeiro, equipe e metas.

A troca é esta:
- **tudo que remete a celular sai**;
- **tudo que remete a carro e moto entra**.

Visual: **fundo branco com detalhes em azul escuro**. Cada oficina pode **personalizar** a sua (logo, cor, nome, textos, listas).

---

## 3. DECISÕES JÁ TOMADAS (não pergunte de novo)

| Assunto | Decisão |
|---|---|
| Nome | **Oficina Simples** (o mesmo para carro e moto, em português e espanhol) |
| Público | Oficinas de **carro**, de **moto** e **mistas**. No cadastro: "Que veículos você atende? Carro / Moto / Os dois" (dá para mudar depois em Configurações) |
| País e moeda | Brasil, reais, Kiwify. O espanhol continua funcionando nas telas |
| Planos | Essencial **R$ 49,99** · Pro **R$ 89,99**, editáveis no admin. Teste grátis de 7 dias no Pro |
| Equipe | Até **4 pessoas** com acesso, nos dois planos. Na tela, os papéis são "Dono", "Atendente" e "Mecânico" (no banco, o papel continua `tecnico`) |
| Suporte | WhatsApp +55 48 99115-4821 (botão "Falar com o suporte") |
| Nota fiscal e Pro Max | Fora do produto |
| Vitrine online | Continua no Pro, vendendo **peças e acessórios**. Sem veículos à venda |
| Aprovação do orçamento pelo cliente no link | **Entra** |
| Domínio | Vem da variável `OFICINA_DOMINIO` (já é assim). Não deixe nenhum domínio fixo no código |
| Lembrete de revisão | Recurso **Pro** |
| Importar clientes/veículos de planilha (CSV) | **Entra** (simples: nome, telefone, CPF, placa, marca, modelo, ano) |
| Subdomínio inexistente com a pessoa logada | Mostra "Oficina não encontrada" com o botão "Ir para a minha oficina" |
| Nome do cliente no link público | Só o primeiro nome |

---

## 4. IDENTIDADE VISUAL — branco com azul escuro

A Etapa 2 usou um azul médio (`#1D4ED8`). **Troque para azul escuro**, mantendo os nomes de variável `--gold*` (que já são o azul) para não mexer em centenas de lugares.

| Token | Valor |
|---|---|
| Fundo | `#FFFFFF` |
| Cartões / fundo secundário | `#F5F7FA` |
| Bordas | `#E3E8EF` |
| Texto principal | `#0F172A` |
| Texto secundário | `#5B6B80` |
| **Azul escuro principal (botões, menu ativo, cabeçalhos)** | `#1E3A8A` |
| Hover / pressionado | `#172554` |
| Azul de destaque (links, ícones, foco) | `#1D4ED8` |
| Azul suave (chips, fundos de destaque) | `#EFF6FF` / `#DBEAFE` |
| Texto de sucesso / alerta / erro | `#137333` / `#C2410C` / `#B91C1C` (fundos e ícones: `#16A34A` / `#D97706` / `#DC2626`) |

Regras de aplicação:
- **Fundo sempre branco.** O azul escuro aparece só nos detalhes: botões principais, menu selecionado, títulos de seção, bordas de destaque, cabeçalho do PDF, ícones.
- Contraste **WCAG AA** em todas as telas, conferido pelo teste com axe que já existe.
- **Celular primeiro:** botões com 44 px ou mais, nenhuma rolagem lateral em 390 px.
- PDF e impressão com moldura e linhas azul escuro, fundo branco, sem faixas escuras (economia de tinta).
- Atualize `theme-color`, manifest, ícones, e-mails (nova migração com reverter), link do cliente, vitrine, pedido e admin.

---

## 5. PÁGINA DE LOGIN

- **Idêntica à do Reparo Simples** em estrutura e comportamento: entrar, criar conta, esqueci a senha, botão de idioma, logo e cores da oficina quando aberta pelo subdomínio dela.
- Nome do app: **Oficina Simples**, com o logo da Oficina Simples (roda + chave, já existe em `assets/`) no tema branco e azul escuro.
- Aberta pelo subdomínio de uma oficina: mostra o **logo, o nome e a cor da oficina** (white-label), como no original.
- O cadastro cria a oficina com a pergunta "Que veículos você atende?" e já deixa prontos o checklist e o catálogo de serviços do tipo escolhido.

---

## 6. O QUE MANTER DO REPARO SIMPLES (tudo, adaptado para oficina)

Mantenha **todos** os módulos do original, trocando o vocabulário. Confira um por um. O que faltar no repositório, implemente.

### 6.1 Clientes na palma da mão
- Lista com busca por **nome, telefone, CPF e placa** (com ou sem hífen, maiúscula ou minúscula).
- Ficha do cliente com:
  - botões grandes **WhatsApp** e **Ligar**;
  - **veículos do cliente** (vários);
  - **histórico de OS por veículo**;
  - total gasto e última visita;
  - observações.
- **CPF com validação** (avisa se for inválido, sem bloquear) e foto **opcional do documento** do cliente (bucket privado; não sai em PDF).
- Pós-venda / follow-up: lembretes do dia com WhatsApp pronto (revisão, retorno, orçamento não aprovado).
- Importar clientes e veículos por CSV (seção 3).

### 6.2 Fornecedores
- Cadastro de fornecedores com nome, CNPJ, WhatsApp, telefone, e-mail, vendedor, prazo de entrega e observações.
- **Cotação de peças** com até 3 fornecedores pelo WhatsApp. A mensagem já leva o veículo, por exemplo: "Olá! Qual o valor da pastilha de freio dianteira do **Onix 1.0 2019**?" ou "… da **CG 160 Fan 2021**?".
- **Pedido ao fornecedor** e histórico de compras por fornecedor.
- Entrada por **XML de NF-e** (já existe em `js/pages/nfe.js`). Adapte para peças de oficina e aceite quantidade com decimal (óleo em litro).

### 6.3 OS, pátio e cliente
- **Assistente de abertura da OS em 4 passos:**
  1. placa ou cliente;
  2. veículo;
  3. entrada (km, combustível, checklist, fotos, assinatura);
  4. serviços e peças.
- **Pátio** (era "Bancada"): quadro kanban com etapas que a oficina cria, renomeia e tira.
  - Etapas padrão: Em análise, Aguardando aprovação, Aguardando peça, Em serviço, Pronto para retirada.
  - Card **Pago** fixo no fim, em todas as oficinas.
  - Barra de rolagem **em cima**, setas e arrastar com dedo e mouse.
  - A OS paga nunca aparece como "atrasada".
- **Previsão de entrega** que a oficina liga ou desliga. Ela some do link depois que o serviço é concluído.
- **Link de acompanhamento** em tempo real, com:
  - placa **mascarada** (ex.: ABC•••3), modelo, km e etapa;
  - itens da OS e garantia;
  - **aprovar o orçamento** com um toque;
  - garantia e comprovante para baixar.
  - Nunca mostra CPF, telefone ou fotos de entrada.
- **Links que abrem o PDF direto** (`?pdf=garantia` e `?pdf=comprovante`): o cliente que perdeu o documento baixa de novo pelo link.
- **WhatsApp pronto em cada etapa:**
  - a mensagem de "pronto" tem um **resumo curto da garantia**, que a oficina liga ou desliga;
  - com o resumo desligado, sai o aviso simples "seu veículo está pronto para retirada";
  - ao concluir, a mensagem agradece por escolher a {nome da oficina}.
  - Use `https://api.whatsapp.com/send?phone=…&text=…` (com `wa.me` os emojis quebram).
- **Termo de entrada e termo de garantia** em PDF:
  - com o logo da oficina (qualquer formato vira PNG comum num canvas antes de entrar no jsPDF);
  - em 1 página quando não houver fotos;
  - com a cláusula de abandono: veículo não retirado em 90 dias após o aviso.
- **Garantia editável** em cada OS e em cada venda.
- **Comprovante de pagamento** em PDF.
- **Impressão:** A4, cupom 58/80 mm e **etiqueta com a placa em destaque** (para prender no veículo ou na chave).

### 6.4 Orçamentos
- Mesmos itens da OS (mão de obra + peças).
- Envio pelo WhatsApp e PDF.
- Ao aprovar (no app ou pelo link), **os itens vão para a OS**, e não viram texto.

### 6.5 Estoque, vendas e financeiro
- Peças e produtos num cadastro só, com a opção "vende no balcão". Lotes, estoque mínimo e lista "comprar".
- **Vendas no balcão (PDV)** de peças e acessórios, recibo e caixa.
- **Parcelas no crédito:** taxa da maquininha por parcela e "sem juros até Nx", separadas em **Serviços (OS)** e **Peças/produtos (balcão)**.
- Financeiro com lucro real e relatório de **mão de obra × peças**.

### 6.6 Equipe e metas
- Login por funcionário, papéis, auditoria.
- **Metas:**
  - OS concluídas contam para o **mecânico responsável** escolhido na OS;
  - sem mecânico escolhido, contam para a **oficina** (nunca para um funcionário "fantasma");
  - OS que vai direto para "Pago" registra quem finalizou.

### 6.7 Plataforma
- Planos, teste grátis e recursos por plano (`Cloud.temRecurso`).
- Kiwify com webhooks idempotentes e fila "compras sem oficina".
- **Admin:**
  - carrinhos abandonados;
  - **ativar plano manualmente**;
  - **vincular compra a uma oficina** (com busca);
  - **unir oficinas duplicadas do mesmo e-mail**, em que a oficina com mais cadastros prevalece e nada dela é substituído;
  - abas **"Em teste"** e **"Bloqueadas e expiradas"** na lista de oficinas.
- **Multi-oficinas no Pro:** o dono cria até 3 oficinas na mesma conta, cada uma com dados, metas e equipe próprios, e troca entre elas sem sair. A assinatura é uma só, a da oficina principal.
- Funciona sem internet e sincroniza. Backup completo.

---

## 7. CELULAR SAI, CARRO E MOTO ENTRAM

### 7.1 Remover tudo que é de celular
Remova:
- IMEI;
- senha do aparelho e **desenho de desbloqueio** (`js/pages/padrao.js`);
- "Aparelhos" / seminovos / troca de aparelho;
- capa, película, chip;
- checklist de celular (tela, câmera, Face ID, carregamento, etc.);
- textos "assistência técnica", "bancada", "técnico de celular";
- ícones de celular.

Procure no código inteiro, nas telas, PDFs, mensagens, e-mails, `i18n-es.js`, admin e testes. Inclua um teste que **falha se aparecer** "IMEI", "aparelho" (no sentido de celular), "celular" (no sentido de produto), "Face ID" ou "película" em qualquer tela do app.

> Cuidado: "aparelho" também quer dizer o celular ou computador de **quem usa** o sistema ("salvo neste aparelho"). Esse uso pode ficar, ou trocar por "neste dispositivo". Troque texto por texto, nunca com substituição automática, e sempre com o espanhol junto.

### 7.2 Veículo (carro ou moto)
- Todo veículo guarda `tipo: 'carro' | 'moto'`. O formulário e os ícones mudam conforme o tipo.
- **Placa:**
  - aceita Mercosul (ABC1D23) e antiga (ABC-1234);
  - é guardada sem hífen e em maiúsculas;
  - a placa antiga e a Mercosul do mesmo veículo (ABC1234 ↔ ABC1C34) contam como o mesmo veículo;
  - formato estranho gera aviso, sem bloquear.
- **Campos comuns:** placa, marca, modelo, versão, ano de fabricação/modelo, cor, **km**, combustível (gasolina, etanol, flex, diesel, GNV, elétrico, híbrido), chassi (opcional), observações.
- **Campos só do carro:** motor (ex.: 1.0, 2.0), câmbio (manual, automático, CVT).
- **Campos só da moto:** cilindrada (cc), partida (pedal/elétrica), freio (tambor/disco/ABS).
- Um cliente pode ter vários veículos.
- **Placa única por oficina:** se já existir, avisa "placa já cadastrada em {cliente}" e oferece usar o cadastro (a checagem é no app, porque ele funciona sem internet).
- **Histórico do veículo por placa:** todas as OS, datas, km, serviços e peças trocadas.

### 7.3 Checklist de entrada (editável pela oficina, por tipo)
- **Carro:**
  - lataria e pintura (com riscos/amassados marcados), para-brisa e vidros, faróis e lanternas, pneus e estepe;
  - freios, suspensão, óleo, arrefecimento, bateria, ar-condicionado, painel (luzes acesas), som/multimídia;
  - itens no veículo: macaco, chave de roda, triângulo, documentos, objetos pessoais.
- **Moto:**
  - freio dianteiro e traseiro, pneus, relação (coroa/pinhão/corrente), óleo, embreagem;
  - luzes e setas, buzina, painel, bateria, partida, suspensão, retrovisores, carenagem/pintura.
- **Combustível** como seletor visual: vazio, 1/4, 1/2, 3/4, cheio.
- Estados de cada item: OK, com defeito, não verificado.
- Cada OS guarda a lista usada, para que as OS antigas não mudem quando a oficina edita o checklist.

### 7.4 Catálogo de serviços pronto (criado com a oficina, editável)
- **Carro:** troca de óleo e filtros, revisão, alinhamento e balanceamento, freios (pastilhas/discos), suspensão, embreagem, correia dentada, arrefecimento, injeção eletrônica/scanner, elétrica, ar-condicionado, troca de bateria, troca de pneus.
- **Moto:** troca de óleo, revisão, relação, pastilhas/lonas, pneus, regulagem, elétrica, injeção/carburador, embreagem, suspensão.
- Cada serviço tem preço sugerido em branco (a oficina preenche) e garantia padrão em dias e km.

### 7.5 Vocabulário
| Original | Novo |
|---|---|
| Assistência / loja | Oficina |
| Aparelho | Veículo (ou "carro"/"moto" quando o tipo é conhecido) |
| Técnico | Mecânico |
| Bancada | Pátio |
| Defeito relatado | Reclamação do cliente |
| "Seu aparelho está pronto" | "Seu {carro/moto} {modelo} placa {placa} está pronto para retirada" |

---

## 8. NOVIDADES DE OFICINA

1. **Mão de obra e peças separadas** na OS, no orçamento, no PDF, no link e no financeiro.
   - Total = mão de obra + peças − desconto.
   - A OS continua gravando `valor` (o total), para não quebrar relatórios.
2. **Itens da OS:**
   - **serviço:** nome, quantidade, valor, mecânico, garantia em dias e km;
   - **peça:** do estoque ou avulsa, com quantidade, valor, custo, quem lançou e quando.
   - A peça do estoque baixa quando é lançada como usada e **volta** ao estoque se sair da OS.
3. **Tela do mecânico (rápida, no celular):**
   - os veículos dele em cartões grandes, com a placa em destaque;
   - botão **"Fotos"**: câmera traseira direto, várias seguidas, foto reduzida no celular (~1600 px, JPEG 0,75), fila offline em IndexedDB, mostra "enviando 2 de 5";
   - botão **"+ Peça"**: usadas recentemente, busca por nome/código/aplicação e leitura de código de barras pela câmera;
   - mover de etapa com um toque.
   - O mecânico **não vê custo, lucro nem financeiro**.
4. **Garantia por prazo e/ou km** ("3 meses ou 5.000 km, o que vier primeiro"), no PDF, no link e no resumo do WhatsApp.
5. **Próxima revisão** na OS, por data e/ou km.
   - Padrões: carro 10.000 km / 12 meses; moto 3.000 km / 3 meses. Editáveis em Configurações.
   - O follow-up lista os lembretes do dia e da semana com WhatsApp pronto (Pro).
   - Lembrete só por km: estime a data pela média de km/dia das OS anteriores da mesma placa; sem histórico, use o prazo padrão.
6. **Até 12 fotos por OS**, com etiqueta opcional de um toque (Entrada, Avaria, Peça trocada, Peça velha, Painel/km). A oficina escolhe quais saem no PDF.

---

## 9. OFICINA EDITÁVEL E PERSONALIZÁVEL

Tela **Configurações → Aparência e oficina**, com **pré-visualização ao vivo** (como fica o app, o PDF e o link do cliente):

- **Marca:** nome da oficina, logo (qualquer formato; vira PNG no PDF), cor de destaque própria. O app valida o contraste: cor clara demais é recusada com explicação. Fundo continua sempre branco.
- **Endereço curto** (subdomínio), dados da oficina (CNPJ, endereço, telefone, WhatsApp, Instagram, horário).
- **Textos editáveis:** termo de entrada, termo de garantia, mensagens de WhatsApp de cada etapa (com variáveis `{cliente}`, `{veiculo}`, `{placa}`, `{oficina}`, `{link}`, `{total}`) e o rodapé do PDF.
- **Listas editáveis:** etapas do pátio, checklist por tipo, catálogo de serviços, categorias de peças, formas de pagamento, taxas da maquininha.
- **Tipos atendidos:** carro, moto ou os dois. O que não é atendido some das telas.
- **Liga/desliga:** previsão de entrega, resumo da garantia no WhatsApp, aprovação pelo link, fotos de "peça velha" no link, preço de venda visível para o mecânico.
- Tudo salvo por oficina, sincronizado entre dispositivos, com merge campo a campo (como as configurações do original). Só o que a oficina mudou é guardado; os padrões são calculados na leitura.

---

## 10. DADOS (orientação)

Os dados continuam em `public.itens` (jsonb por coleção e por oficina).

- `clientes`:
  - `cpf`, `docFotos[]`;
  - `veiculos: [{ id, tipo, placa, marca, modelo, versao, anoFab, anoModelo, cor, km, combustivel, chassi, motor, cambio, cilindrada, obs }]`.
- `os`:
  - `veiculo` (cópia na entrada), `kmEntrada`, `nivelCombustivel`, `checklist` + `checklistItens`, `fotos[{ caminho, etiqueta, noPdf, por, em }]`;
  - `itensServico[]`, `itensPeca[]`, `desconto`, `valor` (total);
  - `garantia { dias, km }`, `proximaRevisao { data, km }`;
  - `mecanicoId`, `previsao`, `assinaturas`.
- `fornecedores`: `{ nome, cnpj, whatsapp, telefone, email, vendedor, prazo, obs }`.
- `lancamentos` da OS: `maoDeObra` e `pecas` separados.
- **Banco:**
  - índice para buscar OS por placa;
  - `acompanhar_os` reescrita com **lista fechada** do que pode sair (nada de CPF, telefone, assinatura ou fotos de entrada).

---

## 11. BANCO E SEGURANÇA

- Banco novo começa com um **`00_base.sql` único**, com a versão final de cada função. Não pode ter "loja padrão" nem função que apaga lojas, e tem índice único "1 oficina principal por dono". O `TUDO.sql` o inclui.
- Migrações novas: **aditivas**, cada uma com `_reverter.sql`. `TUDO.sql` e cada reverter rodam **2 vezes seguidas sem erro**, com teste.
- RLS em toda tabela.
- Teste com **duas oficinas**: uma não vê clientes, veículos, OS, fotos, fornecedores nem notas da outra, nem pela tela nem chamando o banco direto.
- Fotos e documentos só no bucket **privado**, com link temporário. Nunca no localStorage.
- Segredos só em variáveis de ambiente. Nunca no código, em commits ou nas respostas.

---

## 12. LANDING (simples, sem nada inventado)

`landing/index.html`:
- celular primeiro, curta, para quem não gosta de ler, branco com azul escuro;
- barra fixa "Testar grátis";
- dores da oficina: veículo parado sem previsão, cliente ligando para saber, peça usada e não cobrada, cliente que não volta para a revisão, briga por risco na lataria;
- planos lado a lado, FAQ (inclusive como instalar no celular pelo navegador);
- UTMs repassadas para o cadastro e o checkout; Meta Pixel e Clarity por configuração (vazios por padrão).
- **Proibido:** depoimentos, números, avaliações, descontos ou contagem regressiva inventados, e citar concorrentes.

---

## 13. ETAPAS (faça todas, em ordem, sem parar)

| Etapa | O que fazer | Testes obrigatórios |
|---|---|---|
| **2b — Azul escuro** | Tokens da seção 4 em todo o sistema, PDF, e-mails (migração nova), páginas públicas, admin, login | axe AA em todas as telas; sem azul médio antigo nos botões; PDF 1 página |
| **3 — Veículos** | Seção 7 inteira: remover celular, carro e moto, placa, busca por placa, checklist por tipo, combustível, km, catálogo, vocabulário (PT e ES), "Que veículos você atende?" | Busca por placa (com e sem hífen) acha cliente, veículo e OS; placa repetida avisa; teste "nenhum termo de celular nas telas"; carro e moto mostram campos certos |
| **4 — OS da oficina** | Seção 8 (itens 1, 2, 4, 6), assistente em 4 passos, orçamento com itens, aprovação pelo link, PDF/cupom/etiqueta com placa, garantia dias/km, links `?pdf=` | Soma mão de obra + peças − desconto de ponta a ponta (OS → PDF → link → financeiro); peça volta ao estoque ao sair; aprovar pelo link move a OS; PDF sem fotos em 1 página |
| **5 — Mecânico rápido e clientes** | Seção 8 (item 3), seção 6.1, histórico por placa, próxima revisão e lembretes, CSV | Abrir OS, tirar 5 fotos e lançar 3 peças em menos de 30 s no celular; fotos sem internet sobem quando a conexão volta; mecânico não vê custo em nenhuma tela |
| **6 — Fornecedores, estoque, vendas, financeiro, metas** | Seções 6.2, 6.5 e 6.6 | Cotação leva marca/modelo/ano; XML com decimal; parcelas separadas por Serviços × Peças; meta conta para o mecânico certo, e sem mecânico conta para a oficina |
| **7 — Personalização** | Seção 9 inteira | Cor clara recusada; mudar etapa/checklist não altera OS antigas; dois dispositivos editando configurações ao mesmo tempo não perdem nada |
| **8 — Banco, segurança, pagamento e admin** | Seções 6.7 e 11: `00_base.sql`, migrações, RLS, Kiwify, admin completo, multi-oficinas | `TUDO.sql` 2x; cada reverter 2x; duas oficinas isoladas; webhook idempotente (mesmo evento 2x = uma ativação); unir oficinas sem perder nem sobrescrever dados |
| **9 — Landing** | Seção 12 | 390 px sem rolagem lateral; axe AA; UTMs passam para o link de cadastro |
| **10 — Revisão final e checklist** | Rodar tudo do zero; revisar textos PT/ES; escrever `docs/PUBLICACAO.md` com o passo a passo do que **eu** configuro (Supabase novo, rodar `TUDO.sql`, Vercel e variáveis `OFICINA_*`, domínio e subdomínio curinga, Kiwify e webhook, Brevo, Pixel) e um roteiro de teste manual de 15 minutos | `npm run teste` inteiro verde; nenhum erro no console; nenhum segredo no repositório (procure por chaves) |

---

## 14. ARMADILHAS QUE JÁ ACONTECERAM (não repetir)

- **Configurações voltando sozinhas:** merge de 3 vias com cópia profunda da base. Teste com dois dispositivos.
- **Moeda** é da oficina, nunca do idioma da tela.
- **WhatsApp:** número de outro país não ganha 55. Use `api.whatsapp.com/send` por causa dos emojis.
- **Botão com `hidden`:** `.btn` sobrescreve; a regra `[hidden]{display:none!important}` precisa existir.
- **Cadastro duplicado:** criar oficina é idempotente (botão travado enquanto cria + trava no banco).
- **Logo no PDF:** sempre redesenhar num canvas e gerar PNG comum. Só guardar em cache quando der certo.
- **OS paga aparecendo como atrasada:** atraso só conta antes da etapa concluída.
- **Variável com o mesmo nome da função de tradução `t()`** dentro de um `map` quebra a tela. Não sombreie `t`.
- **Tradução silenciosa:** o espanhol usa o texto em português como chave. Texto novo sem tradução aparece em português sem erro. Mantenha o teste que procura textos sem tradução.
- **Quadro do pátio:** barra de rolagem em cima e arrastar com o mouse.
- **Fotos** nunca no localStorage.
- **Service worker:** suba a versão do `CACHE` no `sw.js` a cada etapa, senão o celular fica com a versão velha.

---

## 15. COMO ME ENTREGAR

Ao fim de **cada** etapa, escreva em `docs/ETAPA-N.md`, em português simples e sem jargão:
- o que foi feito;
- resultado dos testes (o que passou e o que falhou);
- prints;
- decisões tomadas sozinho.

Depois siga para a próxima etapa.

Na **resposta final**, ao terminar a Etapa 10, mande:
1. o resumo de todas as etapas em uma tabela;
2. o resultado final de `npm run teste`;
3. os links dos prints principais (login, painel, OS de carro, OS de moto, pátio, link do cliente, PDF, aparência);
4. a lista de `docs/DECISOES.md` e `docs/PENDENCIAS.md`;
5. o que **eu** preciso fazer para publicar (resumo de `docs/PUBLICACAO.md`).

**Comece agora pela leitura de `docs/` e siga para a Etapa 2b.**
