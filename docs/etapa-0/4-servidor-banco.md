# Mapa 4 — Servidor, banco, admin, docs e scripts (Reparo Simples → Oficina Simples)

Base lida: `orig/reparo-simples` (somente leitura, nada foi alterado).
Todos os arquivos do escopo foram lidos por inteiro. `TUDO.sql` foi só conferido contra o `juntar-migracoes.cjs`.
Caminhos abaixo são relativos à raiz do zip. "L" = linha.

**Verificação prática (feita aqui, fora do projeto):** subi um Postgres 16 local com um mock mínimo do Supabase (schema `auth` com `users`/`uid()`/`jwt()`, `storage` com `buckets`/`objects`/`foldername()`, `realtime.send`, publicação `supabase_realtime`, papéis `anon`/`authenticated`). Rodei `schema.sql` → `TUDO.sql` 2x → os 8 testes SQL → todos os reverter em ordem inversa (e cada um 2x) → `TUDO.sql` de novo. Os resultados estão nas seções 4, 5 e 6. O banco de teste foi apagado e o Postgres desligado no fim.

---

## 1. Arquivo por arquivo

### 1.1 Relação entre `schema.sql` e `supabase/saas/` (qual é a base)

- **`supabase/schema.sql` é a base.** Ele cria `lojas`, `membros`, `itens`, as funções `minhas_lojas`/`sou_dono`, a RLS original, `criar_loja`, `acompanhar_os`, pedidos de orçamento, o e-mail por loja (Brevo via `pg_net`) e `unir_loja_solo`.
- **`saas/01..27` são incrementais e dependem do `schema.sql`.** O cabeçalho do TUDO diz isso: "Pré-requisito: supabase/schema.sql já rodado" (`scripts/juntar-migracoes.cjs` L9).
- Várias migrações **substituem** funções do `schema.sql`: `minhas_lojas`/`sou_dono` (02), as políticas de `itens` (02), `adicionar_funcionario` (02, 12), `entrar_na_loja` (02, 12, que muda o retorno para jsonb), `criar_loja` (22), `acompanhar_os` (15, 26), `enviar_email_loja`/`status_email`/`testar_email`/`avisar_pedido_email` (19, 20) e `html_pedido` (ganha uma versão com idioma no 20).
- **No banco novo, a ordem é: `schema.sql` uma vez → `TUDO.sql`.** Testei: funciona e o TUDO roda 2x sem erro.
- **Perigo:** o `schema.sql` **não** pode ser rodado de novo depois das migrações (detalhes no risco R1, seção 6). O README original manda "rodar o schema.sql de novo (é seguro repetir)" (README.md, seção Nuvem). Isso agora está errado.
- **Recomendação para a oficina:** juntar o `schema.sql` já "achatado" (só a versão final de cada função) como `00_base.sql`, tirar dele `unir_loja_solo` e o bloco `do $$` do fim (schema.sql L377-401), e fazer o TUDO começar por ele.

### 1.2 `supabase/schema.sql` (401 linhas)

| Trecho | O que faz | O que muda para a oficina |
|---|---|---|
| L1-5 | Cabeçalho "RB Tech Celulares" | Trocar o nome. |
| L10-49 | Tabelas `lojas` (código de convite de 8 caracteres), `membros` (papel dono/membro), `itens` (loja_id, colecao, id, dados jsonb) e o gatilho `tocar_itens` | Mantém. Os veículos ficam dentro de `clientes` (doc §7). |
| L52-60 | `minhas_lojas()` e `sou_dono()` (a 02 troca as duas) | — |
| L63-89 | RLS original de lojas/membros/itens (a 02 troca a de itens) | — |
| L93-101 | `criar_loja` **sem** trava (a 22 corrige) | Ver R1. |
| L104-134 | `entrar_na_loja` (entra na hora e chama `unir_loja_solo`), `novo_codigo_convite` e os grants | A 12 substitui. |
| L137-139 | Põe `itens` no realtime | Mantém. |
| L144-172 | Índice por `dados->>'token'` e `acompanhar_os` v1 | A 15 e a 26 substituem. |
| L175-192 | `membros.nome` e `adicionar_funcionario` | — |
| L196-235 | `info_loja` e `criar_pedido` (pedido de orçamento público). Pede marca/modelo/defeito; erro "Informe o modelo do aparelho" (L217); WhatsApp de 10 a 13 dígitos (L216) | Trocar por veículo: placa, marca, modelo, ano e "o que está acontecendo". O número com DDI de outro país pode ter mais de 13 dígitos. |
| L239-243 | `pg_net` e `membros.notificar_pedidos` | Mantém. |
| L246-255 | `lojas_email`: chave Brevo **própria de cada loja**, em texto puro, sem acesso pelo app | Mantém, ou tirar (a plataforma já tem a dela, migração 19). |
| L262-279 | `enviar_email_loja` v1 (remetente padrão "RB Tech", L276) | A 19 substitui. |
| L282-294 | `html_pedido` em PT: fundo preto `#000`, dourado `#d4af37`, `#151515`, `#aaa`; **`wa.me/55` fixo (L288)**; linha "Aparelho" (L289) | Novo tema; "Veículo"; tirar o 55 fixo (armadilha do §12). |
| L297-313 | Gatilho `avisar_pedido_email` (respeita `rbtech.migrando`) | A 19 e a 20 substituem. |
| L316-372 | `configurar_email`, `status_email`, `testar_email` (exemplo "Apple iPhone 13", L342), `resultado_email`, `definir_aviso_email` | Trocar o exemplo por um veículo. `resultado_email` é liberada para **qualquer** usuário logado e lê qualquer id de `net._http_response` (L346-353, L371). Isso vaza pouca coisa, mas dá para restringir. |
| L377-401 | `unir_loja_solo` (junta e **apaga** a loja solo) e um `do $$` que roda isso **a cada execução** do schema | Tirar da oficina (a 12 já parou de usar). |

### 1.3 Migrações `supabase/saas/NN_*.sql` e reverter

| Nº | O que faz | O que muda para a oficina |
|---|---|---|
| **01 multiloja** | `plataforma_config` (sem acesso pelo app; `dominios_base`). `lojas.slug` com formato validado (L20-24). `lojas_dominios` (domínio próprio). `loja_por_host` (subdomínio ou domínio verificado → id, slug, nome). `loja_por_slug`. `definir_slug` com palavras reservadas (L78). Gatilho `avisar_os_publica` → `realtime.send` no canal `os-<token>`. `loja_padrao` = loja mais antiga (L106-108). `loja_publica` (ref, slug, host ou loja padrão) | Mantém. Cadastrar o domínio novo em `dominios_base` pelo admin. **Tirar ou rever `loja_padrao`** (risco R6). Reverter: L1-12, ok. |
| **02 planos** | Tabela `planos` (leitura pública). Seeds: essencial **39,99** e 2 funcionários; pro **77,90** e 5; pro_max sem preço, 5 funcionários e 40 notas/mês (L26-35). Configs `dias_teste`=7, `tolerancia_atraso_dias`=5, `plano_teste`=pro (L37-41). Colunas de assinatura em `lojas` (L44-57). Loja padrão = Pro Max isenta (L60-61). Gatilho de teste grátis para loja nova (L66-78). `revoke update` em lojas, fora `nome` (L81-82). `loja_situacao`, `loja_plano`, **`tem_recurso`**, **`pode_escrever`**. Papéis dono/membro/atendente/tecnico/suporte (L126). **`minhas_lojas` passa a exigir `ativo` e acesso não vencido** (L129-132). `meu_papel`, `sou_dono` (com ativo), `funcionarios_ativos`, `limite_funcionarios`. **`pode_ver_colecao`/`pode_gravar_colecao`**: técnico sem `lancamentos`/`caixas`/`vendas`; `meta/settings` só o dono; `followups`→recurso followup, `metas_func`→metas, `lotes`/`nfe_entradas`→lotes/importar_xml (L158-175). Nova RLS de `itens` (L177-189). `checar_vaga`, `adicionar_funcionario`, `entrar_na_loja`, `definir_papel`, `definir_membro_ativo`, `ajustar_ao_plano`, `minha_assinatura` | Preços e limites: perguntar ao dono (`on conflict do nothing`: mudar o seed não altera um banco já criado). O papel interno `tecnico` pode continuar e aparecer como "Mecânico" na tela (a constraint está na L126). Coleções novas que precisem de plano (ex.: `lembretes`, se for separada de `followups`) **têm de entrar em `pode_gravar_colecao`** (que é redefinida também na 07). Decidir o Pro Max (R7). |
| **03 módulos** | Índices de NF-e e lotes. `num_seguro`/`sim_seguro`. **`vitrine_publica`** devolve nome, preço, descrição, fotos, **cor, armazenamento, condição (seminovo/novo/acessório), bateria**, categoria e disponibilidade (L36-40). Bucket **`lojas-publico`** (público, 2 MB, png/jpeg/webp/svg) com gravação só na pasta da própria loja e com `pode_escrever` (L51-69) | A vitrine da oficina precisa de peças, acessórios e veículos usados (km, ano, marca/modelo). Trocar `armazenamento`/`bateria`/`seminovo`. **Nunca expor a placa nem o chassi** do veículo à venda. |
| **04 pagamentos** | `lojas.assinatura_externa_id` e `comprador_email`. `kiwify_produtos` (produto/oferta → plano ou pacote de notas, com `checkout_url`). `kiwify_eventos` (`chave_idempotencia` única, status recebido/aplicado/ignorado/pendente_loja/revisao/erro/rejeitado). `plataforma_avisos`. Configs `kiwify_area_cliente_url` e `checkout_param_email`. `registrar_evento_pagamento` (idempotente). `loja_do_evento` (primeiro pela assinatura, depois pelo e-mail do dono; 2 lojas → revisão). `aplicar_evento_pagamento` v1. Gatilho **`membros_aplicar_pendentes`**: quando um dono entra com o e-mail da compra, aplica a compra sozinho (L188-202). `checkout_planos` | Mantém (é o fluxo "conta ligada ao e-mail da compra" do §8). Detalhes na seção 1.6. |
| **05 notas** | Nota fiscal (só Pro Max): `lojas_fiscal`, `notas_fiscais`, `consumo_mensal`, `creditos`, `creditos_mov`, `consumo_notas`, `avisos_loja`, `nfse_eventos`; reserva atômica, confirmação, liberação, créditos, `evento_nota`, `email_dono` | O documento não fala de nota fiscal. **Decidir:** manter escondido, sem plano Pro Max, ou tirar. `avisos_loja`/`marcar_avisos_lidos` e `email_dono` são usados por outras partes. |
| **06 tema** | `lojas_tema` com **padrões dourado e preto** (`#d4af37`, `#b8860b`, `#000000`, L11-13); fontes; nome, slogan, rodapé e dados. A loja padrão ganha `/assets/logo.jpg` (L27-30). Gatilho de tema para loja nova. `salvar_tema` (só imagens do Storage da própria loja ou os 2 caminhos fixos, L51-55). `tema_publico`, `tema_por_os`. Domínio próprio só com o recurso `dominio_proprio` | **Novos padrões: `#1D4ED8`/`#2563EB`/`#FFFFFF`.** Atenção: o front pode assumir fundo escuro. Trocar os caminhos fixos `/assets/logo.jpg` e `/assets/icon-192.png` pelo logo novo. |
| **07 admin** | `super_admins`, `admin_auditoria`, `sou_super_admin`, `exigir_admin` (errcode 42501), `auditar`. `pode_gravar_colecao` agora barra `suporte` (L46-57). Funções `admin_*` de leitura e ação; **"entrar como a loja"** = membro `suporte` somente leitura por 2 h (L227-238). `admin_vincular_compra` exige `assinatura_id` (L264-278). Grants em laço (L338-350) | Mantém. Cadastrar o super admin à mão (L8). |
| **08 vitrine (pedidos)** | `criar_pedido_vitrine`: confere preço e estoque no banco, limita 3 pedidos por WhatsApp a cada 10 min e 60 por hora, retirada em até 30 dias | Mantém (peças e acessórios). Para veículo usado, provavelmente "tenho interesse", não carrinho. |
| **09 teste restrito** | `recursos_bloqueados_teste` = vitrine e nota_fiscal. `tem_recurso` e `minha_assinatura` com `bloqueados_teste` | Mantém. Revisar se o teste grátis libera lembretes e follow-up. |
| **10 certificado** | Dados públicos do certificado A1 e `registrar_certificado` (só o servidor chama) | Só se mantiver nota fiscal. |
| **11 dias de teste** | `admin_definir_teste` (0 a 90 dias; usa `plano_id` 'pro' como padrão, L23) | Mantém. |
| **12 convite seguro** | Código de 10 caracteres sem caracteres parecidos; o pedido de entrada fica **pendente** até o dono aprovar; 10 tentativas por hora; não apaga mais a loja solo; troca todos os códigos uma vez (`codigos_convite_trocados`) | Mantém. |
| **13 idioma** | `lojas_tema.idioma` pt/es e `definir_idioma` | Mantém (o documento pede ES nas telas novas). |
| **14 hotmart** | `lojas.provedor_pagamento`; `provedor` em produtos e eventos; config **`precos_hotmart` {CLP, essencial 20000, pro 34000}** (L39); `registrar`/`aplicar_evento_pagamento` v2 (troca de plano, aviso de cobrança em dobro, cancelamento da outra plataforma não derruba); **`provedor_da_loja`/`checkout_da_loja`: idioma es → Hotmart/CLP, pt → Kiwify/BRL** (L181-214); `admin_*` com a origem | Hotmart é opcional no documento. Se ficar, rever o acoplamento "espanhol = Chile = CLP = Hotmart". |
| **15 garantia OS** | `acompanhar_os` + `garantiaDias` | A 26 substitui. A garantia passa a ser `{dias, km}`. |
| **16 comunicados** | `comunicados` e `comunicados_lidos`; funções do admin e `meus_comunicados(p_idioma)` | Mantém. |
| **17 comunicados por provedor** | Versão pt/es; `versao_comunicado` pela plataforma em que a loja assina; `admin_salvar_comunicado2` | Mantém. **O reverter não roda 2x** (seção 5). |
| **18 e-mail da vitrine** | `html_pedido_vitrine` (preto e dourado; `wa.me/55` quando a loja não é ES, L26) e gatilho `avisar_pedido_vitrine_email` | A 21 substitui o HTML. Tema novo; tirar o 55. |
| **19 e-mail da plataforma** | `plataforma_email` (**chave Brevo da plataforma guardada no banco**, linha única); `site_da_loja` (`https://<slug>.<base>` ou `https://app.<base>`, L21-29); `enviar_email_loja` v2 (chave da loja → senão a da plataforma; remetente padrão **"Reparo Simples"**, L52); `status_email`; gatilhos; `testar_email`; `admin_email_plataforma` (exige `xkeysib-`); `admin_testar_email_plataforma` (remetente "Reparo Simples", L143). Comentário cita `<nome>.reparosimples.com` (L6) | Trocar o nome. O botão "Abrir no app" do e-mail depende de `dominios_base`. |
| **20 idioma/hotmart** | `idioma_da_loja` (Hotmart ou tema es → es), `idioma_por_os`, `tema_publico` com idioma; `html_pedido(d, site, idioma)` em ES (linha "Equipo", L37; sem 55 em ES); gatilhos; `testar_email` (iPhone 13, L85) | Textos: "Vehículo"; o exemplo vira um veículo. |
| **21 moeda** | `moeda_da_loja` (`settings.moedaBase` BRL/CLP; sem valor, CLP só se for Hotmart), `moeda_por_os`, `html_pedido_vitrine(…, moeda)` (L24-50, ainda preto e dourado e com 55) | Mantém (armadilha da moeda resolvida no banco). |
| **22 uma loja por conta** | `criar_loja` com **`pg_advisory_xact_lock(hashtext('criar_loja:'||uid))`** e devolve a loja de que a pessoa já é dona (L9-21) | Ver seção 1.5. |
| **23 juntar lojas** | `juntar_lojas`/`juntar_lojas_por_nome` (ferramenta de SQL Editor, sem acesso pelo app) | Opcional. O comentário cita "Palhoça celular" (L3). |
| **24 trocar e-mail** | `sincronizar_meu_email` (atualiza `membros.email` com o e-mail do auth) e `email_da_compra` | Mantém (afeta a ligação da compra pelo e-mail). |
| **25 fotos** | Bucket **`lojas-privado`** (privado, **3 MB por arquivo**, png/jpeg/webp); políticas ler/gravar/apagar só na pasta `<loja_id>/…` da própria loja; gravar exige `pode_escrever` (L5-21). Pasta sugerida `<loja_id>/aparelhos/` (comentário L2). **Sem limite de quantidade no banco** | O limite de 8 fotos está **só no front** (`js/pages/fotos.js` L6 `MAX: 8`). Para 12: mudar o front e, se quiser trava real, uma checagem no banco. Não há política de UPDATE (upsert falha). Renomear a pasta para `veiculos/` é opcional. |
| **26 cards da bancada** | `acompanhar_os` v3 com `statusNome` e `statusCor` | Base da nova `acompanhar_os` (seção 1.4). |
| **27 carrinhos abandonados** | `carrinhos_contato`; `admin_carrinhos` (a partir dos eventos `ignorado` com `status=abandoned` da Kiwify ou `PURCHASE_OUT_OF_SHOPPING_CART` da Hotmart); `admin_carrinho_marcar` | Mantém. |

Reverter: existe um para cada 01-27. Todos **funcionam na ordem inversa (27→01)**, e o TUDO volta a rodar depois (testado). Só funcionam nessa ordem: rodar o 02_reverter com a 12 aplicada, por exemplo, falha.

### 1.4 RLS, `acompanhar_os` e funções que citam aparelho/IMEI/celular

**RLS (versão final, depois da 07):**
- `minhas_lojas()` (02 L129) = vínculos `ativo` e não vencidos.
- `sou_dono(l)` (02 L140) = dono ativo.
- `pode_escrever(l)` (02 L116) = situação ativa, teste ou inadimplente.
- `itens`:
  - SELECT: `loja_id in minhas_lojas()`, e `lancamentos`/`caixas` não aparecem para o técnico.
  - INSERT/UPDATE: `pode_gravar_colecao` (07 L46).
  - DELETE: o mesmo, e técnico não apaga (02 L177-189).
- `lojas`:
  - SELECT: as próprias.
  - UPDATE: só a coluna `nome`, só o dono.
- Tabelas da plataforma: `revoke all` e acesso só pelas funções security definer.
- O teste `isolamento.sql` confere as duas direções entre lojas, e passou.

**`acompanhar_os` (versão final: 26 L9-34). O que devolve hoje** (confirmado rodando):
- da OS: `numero`, `status`, **`historico` inteiro**, `aparelho {modelo, imei, idTipo, cor}`, `defeito`, `servico`, `valor`, `desconto`, `pecas[{nome, qtd}]`, previsão, datas, forma de pagamento, `assinaturaCliente` (imagem), `garantiaDias`, `statusNome` e `statusCor`;
- do cliente: `cliente.nome` (nome completo);
- da loja: nome, CNPJ, telefone, endereço, Instagram, termos, `garantiaDias`, `tecnico` (nome) e `assinaturaTecnico` (imagem).

| Dado | Devolve hoje? |
|---|---|
| Telefone do cliente | Não |
| CPF do cliente | Não |
| Fotos | Não |
| **IMEI** | **Sim** (26 L14). O README diz o contrário ("sem telefone, CPF ou IMEI") |

Pedido do documento para a oficina (§7): devolver tipo, marca/modelo, placa mascarada (ABC•••3), km, `itensServico`/`itensPeca`, status e garantia `{dias, km}`; nunca CPF, telefone ou fotos.
- Tirar `imei`.
- Avaliar tirar `assinaturaCliente` (dado pessoal) e reduzir `cliente.nome` ao primeiro nome.
- `tema_por_os`, `idioma_por_os` e `moeda_por_os` não conferem `deleted` (06 L74, 20 L16, 21 L17). É uma diferença pequena em relação à `acompanhar_os`.

**Funções SQL que citam aparelho, IMEI ou celular (adaptar):**
- `acompanhar_os` (schema L151, 15 L13, 26 L14);
- `vitrine_publica` (03 L36-39: armazenamento, seminovo, bateria);
- `criar_pedido` (schema L208-231: marca/modelo/defeito, "aparelho" L217);
- `html_pedido` PT (schema L289 "Aparelho") e ES (20 L37 "Equipo");
- `testar_email` (19 L106 e 20 L85: Apple iPhone 13);
- comentários em 03 L14, 05 L4, 16 L4, 23 L3 e 25 L1-20.

O resto (planos, pagamentos, admin) não fala de aparelho.

### 1.5 Criação de loja idempotente (armadilha "cadastro duplicado")

- **Existe trava no banco:** a 22 usa `pg_advisory_xact_lock` por usuário e, se a conta já é dona de uma loja, devolve essa loja (22 L14-17). Dois toques ou uma nova tentativa não criam a segunda loja.
- "Mesmo e-mail" = mesma conta (o e-mail é único no Supabase Auth). Por isso a trava é por `auth.uid()`.
- **Não existe trava por constraint** (por exemplo, um índice único em `membros(user_id) where papel='dono'`). Ela foi omitida de propósito: o banco original tinha lojas duplicadas, e a 23 serve para juntá-las. No banco novo dá para pôr esse índice único.
- **Risco:** rodar o `schema.sql` de novo volta o `criar_loja` sem trava (R1).
- O teste `pagamentos.sql` L100 cria uma "Segunda loja" para o mesmo dono e espera 2 lojas. Com a 22 aplicada, `criar_loja` devolve a mesma loja. Mesmo assim o teste passa, porque o evento vai para "revisão" por outro motivo: a loja foi bloqueada pelo reembolso do passo 13. Na prática o teste não cobre mais o caso "e-mail com duas lojas" como o nome diz.

### 1.6 Planos/recursos, webhooks Kiwify/Hotmart, compras sem loja e e-mails

- **Recursos dos planos** (02 L27-34): `acompanhamento_os`, `importar_xml`, `lotes`, `tema` (Essencial); mais `modulos_personalizaveis`, `followup`, `metas`, `vitrine`, `dominio_proprio` (Pro); mais `nota_fiscal` (Pro Max).
  - O documento pede no Pro: vitrine, follow-up e lembretes, metas e módulos. Ou seja, os recursos atuais cobrem isso. Lembrete = `followup`, a menos que se crie um recurso novo.
- **Webhook** (`api/webhooks/kiwify.js`, `hotmart.js` → `api/_lib/pagamento.js` `receberWebhook`):
  1. Segredo da variável `KIWIFY_WEBHOOK_TOKEN` ou `HOTMART_HOTTOK`; sem ele, responde 503 (L36-37).
  2. Corpo de até 256 KB.
  3. Valida a origem:
     - Kiwify: HMAC-SHA1 do corpo bruto no parâmetro `?signature=`, comparado em tempo constante (`kiwify.js` L35-41). O próprio arquivo avisa: "A CONFIRMAR NA DOCUMENTAÇÃO OFICIAL" (L2-4).
     - Hotmart: cabeçalho `X-HOTMART-HOTTOK` ou `hottok` no corpo (`hotmart.js` L46-50).
  4. Normaliza o evento.
  5. Grava sempre, inclusive inválido. Inválido fica como `rejeitado`, com o payload resumido em 2000 caracteres (L47); a resposta é 401.
- **Idempotência** (a chave única é `chave_idempotencia`):
  - Kiwify: `kiwify:<evento>:<order_id>:<approved_date|updated_at|next_payment>` (`kiwify.js` L60-62).
  - Hotmart: `hotmart:<evento>:<transação|assinatura>:<recorrência|data de cancelamento/troca>[:oferta]` (`hotmart.js` L74-76).
  - Duplicado → 200 `duplicado:true`.
  - `aplicar_evento_pagamento` não reaplica eventos `aplicado`, `ignorado` ou `rejeitado`.
  - Evento sem e-mail, produto ou pedido vai para `revisao`.
- **Compras sem loja:** sem loja com aquele e-mail de dono, `compra_aprovada`/`renovacao` vira `pendente_loja`. O servidor manda o e-mail de boas-vindas com o link `${SITE_URL}/?cadastro=1&idioma=..&email=..` (`pagamento.js` L55-60). Quando a pessoa cria a loja com o mesmo e-mail, o gatilho `membros_aplicar_pendentes` (04 L188-202) aplica a compra. No admin dá para "Vincular" manualmente pelo ID da loja (exige `assinatura_id`).
- **Ligação por e-mail:** usa o `membros.email` do dono, gravado de `auth.jwt()->>'email'` na criação (22 L19) e atualizado por `sincronizar_meu_email` (24). A assinatura já ligada (`assinatura_externa_id`) tem prioridade.
- **E-mails:**

| Onde | Via | Textos e cores |
|---|---|---|
| (a) Servidor, `api/_lib/email.js` | Brevo, com `BREVO_API_KEY`, `BREVO_REMETENTE` e `PLATAFORMA_NOME` (padrão "Sistema da Assistência", L10) | Boas-vindas PT/ES com botão **dourado `#d4af37` e texto preto** ("Criar minha loja" / "Crear mi tienda", `pagamento.js` L21-30). Alerta de notas 80%/100% (`notas/emitir.js` L8-14) |
| (b) Banco, via `pg_net` | Chave da loja ou da plataforma | Pedido de orçamento, pedido da vitrine e teste. HTML com **fundo `#000`, dourado `#d4af37`, `#151515`, `#aaa`** (schema L283-293, 20 L31-41, 21 L37-49) |

  Para a oficina: tudo em branco e azul, e "loja" vira "oficina".
- **Admin** (`api/admin.js`):
  1. Confere o token e `sou_super_admin`.
  2. Só aceita ações da lista `ACOES` (L6-38) e repassa os argumentos pelo nome.
  3. O banco confere de novo (`exigir_admin`) e grava a auditoria.
  - `middleware.js` protege `/admin` (cookie `rb_admin` + RPC `sou_super_admin` com a chave pública). Sem isso, mostra `admin-entrar.html`.
  - `js/admin.js` tem as abas: Painel, Lojas, Pagamentos, Compras sem loja, Carrinhos abandonados, Produtos e planos, Notas, Avisos, Comunicados e Auditoria. Usa as classes de tema `gold`/`outline-gold` (que precisam ser trocadas).

### 1.7 Demais arquivos

| Arquivo | O que faz | Muda para a oficina |
|---|---|---|
| `api/admin.js` | Ponte para as funções `admin_*` (acima). Mensagem citando `SUPABASE_URL` (L46) | Só os textos; "lojas" vira "oficinas". |
| `api/_lib/supa.js` | fetch REST/Auth: `rpc`, `usuario`, `convidar` (`/auth/v1/invite`), `normalizarUrl`, `bancoDiferente` (compara com `/js/config.js`). `SUPABASE_URL` com **fallback para `RBTECH_SUPABASE_URL`** (L11) | Renomear as variáveis `RBTECH_*` (decisão). |
| `api/_lib/pagamento.js`, `kiwify.js`, `hotmart.js` | Seção 1.6 | E-mails novos; produto novo cadastrado no admin. |
| `api/_lib/email.js` | Envio Brevo | Nome padrão. |
| `api/_lib/fiscal.js`, `certificado.js`, `api/notas/*`, `api/webhooks/nfse.js` | Nota fiscal (provedor simulado; Focus/Nuvem "pendente") | Fora do escopo do documento. Remover ou deixar desligado. |
| `api/equipe/convidar.js` | Dono convida por e-mail (papel `tecnico`/`atendente`, L15), confere o plano e a vaga; o link volta para a origem do pedido (L24) | "Mecânico" na tela (o valor interno pode ficar `tecnico`). |
| `middleware.js` | **Só** protege `/admin` (matcher L4). Lê URL e chave de `/js/config.js` ou de `RBTECH_SUPABASE_URL`/`RBTECH_SUPABASE_ANON_KEY` (L16-24); guarda em cache no módulo | **Não trata subdomínios** (R2). Cookie `rb_admin` → renomear (opcional). |
| `vercel.json` | Build `node scripts/build.cjs` → `dist`; cabeçalhos (nosniff, DENY, CSP só com `frame-ancestors`, noindex no `/admin`); rewrites `/acompanhar/:token`, `/pedido(/:loja)`, `/vitrine(/:loja)`, `/admin` | Nada de marca. O domínio curinga se configura no painel da Vercel. |
| `admin.html` | Casca do painel: título "Reparo Simples · Admin" (L8), ícone `/assets/rs-192.png` (L7) | Nome, ícone e tema. |
| `admin-entrar.html` | Login do admin. Grava o token em cookie `rb_admin` (1 h, SameSite=Strict, **não é HttpOnly**, L38) | Nome, logo e tema (`.gold` na L16). |
| `js/admin.js` | Seção 1.6. Mensagens de carrinho: **"ReparaYa"** (L31, L34) e **"Reparo Simples"** (L32, L34); link de checkout `https://pay.kiwify.com.br/<código>` (L27); placeholder `reparosimples@gmail.com` (L246); `rbtech_loja_escolhida` (L158) | Marca nova; textos de oficina; tema azul. |
| `docs/SAAS_GUIA.md` | Passo a passo da migração do **banco real da RB Tech** para o SaaS (backup, cópia para teste, contagem) | Quase tudo é específico da migração de um banco existente. Reescrever para "banco novo do zero". |
| `docs/SAAS_CHECKLIST.md` | Checklist de configuração (variáveis, Kiwify, Hotmart, DNS, fiscal, produção) | Base boa para a Etapa 10. Limpar marca, IDs e URLs (seção 2). |
| `scripts/juntar-migracoes.cjs` | Junta `NN_*.sql` (sem os reverter, em ordem) no TUDO.sql | Mantém. Incluir o `00_base` se for criado. |
| `scripts/gerar-config.cjs` | Gera `js/config.js` (`window.RBTECH_CONFIG`) no build. Em produção **só** com `RBTECH_CONFIRMO_BANCO_PRODUCAO` = a URL; sem isso, mantém o `js/config.js` do repositório (L24-33) | No projeto novo o `config.js` do repo vem **em branco** → produção sem banco e admin inacessível (R3). |
| `supabase/verificar_rls.sql` | Lista tabelas sem RLS ou sem `loja_id` | A lista de exceções está desatualizada: aponta "PROBLEMA" em `carrinhos_contato`, `comunicados`, `comunicados_lidos`, `convite_tentativas` e `plataforma_email` (rodei; são falsos alarmes). |
| `supabase/relatorio_contagem.sql` | Contagem e hash por tabela/coleção para comparar antes e depois de uma migração | Útil só para migrar um banco existente. |

---

## 2. Marca, domínio, IDs, e-mails, URLs fixas e segredos

**Nome e marca:**
- `supabase/schema.sql` L2 ("RB Tech Celulares") e L276 (remetente "RB Tech").
- `saas/06_tema.sql` L4 ("identidade atual da RB Tech").
- `saas/19_email_plataforma.sql` L6 (`<nome>.reparosimples.com`), L52 e L143 ("Reparo Simples").
- `saas/19_email_plataforma_reverter.sql` L16 ("RB Tech").
- `admin.html` L7-8.
- `admin-entrar.html` L7, L8, L15, L16.
- `js/admin.js` L31-34 ("ReparaYa" e "Reparo Simples"), L66 (cabeçalho e `rs-192.png`), L246 (`reparosimples@gmail.com`).
- `docs/SAAS_GUIA.md` L12, L25, L35, L68, L76, L107.
- `docs/SAAS_CHECKLIST.md` L98 e L105 (ReparaYa / Reparo Simples).
- `package.json` (`"name": "rbtech-sistema"`).

**Domínios e URLs fixas:**
- `docs/SAAS_GUIA.md` L18 e `docs/SAAS_CHECKLIST.md` L36: `reparorb.vercel.app`.
- `docs/SAAS_CHECKLIST.md` L69: "landing `/es/` do Teste-rb".
- `js/admin.js` L27: `https://pay.kiwify.com.br/`; L303: placeholders `pay.kiwify.com.br` e `pay.hotmart.com`.
- `api/_lib/email.js` L7, `schema.sql` L274 e `19` L50, L141: `https://api.brevo.com/v3/smtp/email` (do serviço, pode ficar).
- `19` L28: `https://app.<base>` (gerado a partir de `dominios_base`).
- Nenhum `reparosimples.com` fixo em código executável. Os subdomínios vêm de `plataforma_config.dominios_base`.

**IDs de produto Kiwify/Hotmart:**
- **Nenhum no código.** Os produtos ficam na tabela `kiwify_produtos`, cadastrados pelo admin.
- Só a documentação mostra um ID e uma oferta da Hotmart com cara de reais: `docs/SAAS_CHECKLIST.md` L64-65. **Não reutilizar.**

**E-mails remetentes:**
- Nenhum remetente fixo em código executável: vêm de `BREVO_REMETENTE` (servidor), de `lojas_email.remetente` e de `plataforma_email.remetente` (banco).
- Só o placeholder `reparosimples@gmail.com` (`js/admin.js` L246).

**Identificadores internos com o prefixo da marca (trocar ou decidir):**
- `RBTECH_SUPABASE_URL`/`_ANON_KEY` em `api/_lib/supa.js` L11, `middleware.js` L22, `scripts/gerar-config.cjs` L20-21 e L44-48, `.env.example` L7-8 e docs.
- `RBTECH_CONFIRMO_BANCO_PRODUCAO` em `gerar-config.cjs` L30-31.
- `window.RBTECH_CONFIG` em `gerar-config.cjs` L52, `admin-entrar.html` L28 e `js/admin.js` L42.
- Cookie `rb_admin` em `middleware.js` L39, `admin-entrar.html` L35-38 e `js/admin.js` L41, L51, L62.
- `rbtech_loja_escolhida` em `js/admin.js` L158.
- GUC `rbtech.migrando` em `schema.sql` L301, L381, L391 e nas migrações 18-21 e 23.

**Segredos escritos no código:** **nenhum** nos arquivos do escopo. Procurei JWT `eyJ…`, `sb_secret_`, `sb_publishable_`, `xkeysib-…` e tokens. Não há valores, só placeholders e validações de formato. O `js/config.js` está em branco.
- Chaves que ficam **no banco**, em texto puro (por desenho): `lojas_email.api_key` e `plataforma_email.api_key` (Brevo).

---

## 3. Variáveis de ambiente e configs no banco

**Servidor (Vercel). Lista completa, conferida com `grep process.env`:**

| Variável | Onde | Uso |
|---|---|---|
| `SUPABASE_URL` | `api/_lib/supa.js` L11 | URL do Supabase para `/api` |
| `RBTECH_SUPABASE_URL` | `supa.js` L11 (fallback), `middleware.js` L22, `gerar-config.cjs` L20 | URL pública do site e do middleware |
| `RBTECH_SUPABASE_ANON_KEY` | `middleware.js` L22, `gerar-config.cjs` L21 | Chave pública |
| `SUPABASE_SERVICE_ROLE_KEY` | `supa.js` L12 | Chave secreta (webhooks, convite). Aceita `eyJ…` ou `sb_secret_` (L29) |
| `KIWIFY_WEBHOOK_TOKEN` | `pagamento.js` L14/L36 | Valida a Kiwify |
| `HOTMART_HOTTOK` | `pagamento.js` L14/L36 | Valida a Hotmart |
| `BREVO_API_KEY`, `BREVO_REMETENTE` | `email.js` L4 | E-mails do servidor |
| `PLATAFORMA_NOME` | `email.js` L10 | Nome do remetente |
| `SITE_URL` | `pagamento.js` L57 | Link do e-mail de boas-vindas |
| `FISCAL_PROVEDOR` | `fiscal.js` L35 | Provedor de nota (padrão simulado) |
| `FISCAL_WEBHOOK_TOKEN` | `webhooks/nfse.js` L13 | Retorno fiscal |
| `RBTECH_CONFIRMO_BANCO_PRODUCAO` | `gerar-config.cjs` L30 | Trava do banco de produção no build |
| `VERCEL_ENV`, `VERCEL_GIT_COMMIT_SHA` | `gerar-config.cjs` L8, `build.cjs` L48 | Definidas pela Vercel |

**Configs que vão para o banco** (o dono faz pelo admin ou pelo SQL Editor):
- `plataforma_config`:
  - `dominios_base` (01);
  - `loja_padrao` (01, automático);
  - `dias_teste`, `tolerancia_atraso_dias`, `plano_teste` (02);
  - `kiwify_area_cliente_url`, `checkout_param_email` (04);
  - `recursos_bloqueados_teste` (09);
  - `codigos_convite_trocados` (12, automático);
  - `hotmart_area_cliente_url`, `precos_hotmart` (14).
  - O admin edita só a lista de 07 L315 / 14 L308.
- `planos`: preço, máximo de funcionários e franquia.
- `kiwify_produtos`: ID do produto, oferta, plano e link do checkout de cada produto.
- `plataforma_email`: chave Brevo e remetente.
- `super_admins`: o `insert` manual (07 L8).
- `lojas_email`: chave própria da loja (opcional).
- Supabase Auth: Site URL e Redirect URLs (o convite usa `redirect_to`, CHECKLIST L18); "Confirm email" desligado (GUIA L27).
- Storage: buckets criados pelas migrações 03 e 25.
- `pg_net` precisa estar ativo para os e-mails do banco.

---

## 4. Testes SQL e infraestrutura de Playwright/mock

**Como funcionam:**
- Não há executor: cada arquivo é colado no SQL Editor do Supabase de **teste**.
- `isolamento`, `planos`, `pagamentos`, `notas` e `admin` gravam o resultado em uma tabela temporária `_res` e terminam com um `select` de linhas PASSOU/FALHOU.
- `convite`, `dias_teste` e `teste_restrito` usam `assert` dentro de `begin … rollback` e mostram um `NOTICE` "TODOS … PASSARAM".
- Simulam o usuário com `set_config('request.jwt.claim.sub' | 'request.jwt.claims')` e `set role authenticated`.
- Criam usuários direto em `auth.users`.
- Dependem de uma "**loja 1**": a mais antiga, com dono, de preferência Pro Max isenta.

**Resultado da execução local** (Postgres 16 + mock):

| Cenário | Resultado |
|---|---|
| Com uma loja criada **antes** do TUDO (como no banco original) | Todos passam: isolamento 12/12, planos 32, pagamentos 21, notas 19, admin 15, e os 3 com `assert` OK. Nenhum FALHOU |
| Em **banco vazio** (o caso da oficina) | isolamento: 3 FALHOU ("só enxerga a própria loja", "Loja 1 continua vendo…", "Limpeza…"); planos: 1 FALHOU ("Loja 1 continua isenta e no Pro Max"); pagamentos: 1 FALHOU ("Loja 1 intacta") |

Para o projeto novo, os testes precisam de uma semente de "loja 1" própria e não devem depender de Pro Max isenta. O teste de isolamento do documento pede duas oficinas criadas pelo próprio teste.

**Playwright/mock no zip:**
- **Não veio nada.** Procurei `playwright`, `puppeteer`, `chromium`, `mock`, `jest`, `vitest`, `pglite`, `pg-mem` e pastas ou arquivos `*test*`/`*spec*`/`*mock*`: só aparecem `supabase/testes/*.sql` e as migrações 09/11 (que têm "teste" no nome).
- `package.json` só tem `esbuild` como dependência de desenvolvimento.
- O ambiente "Postgres local + mock do Supabase + Playwright" do §1 do documento **precisa ser criado do zero**. O mock que montei aqui (cerca de 20 linhas SQL: `auth.users`/`uid()`/`jwt()`, `storage.buckets`/`objects`/`foldername()`, `realtime.send`, publicação, papéis) basta para rodar o schema, o TUDO e os testes SQL. Ele pode virar a base do ambiente novo.

---

## 5. TUDO.sql

- **Bate com as migrações:** regerei o arquivo com a mesma lógica do `scripts/juntar-migracoes.cjs` (numa cópia, fora do zip) e o `diff` deu **idêntico**. São 27 arquivos (01 a 27, sem os reverter), em ordem, com o cabeçalho e o separador `-- >>>>`.
- **É idempotente:** depois do `schema.sql`, o `TUDO.sql` rodou **2x seguidas sem erro** (com `ON_ERROR_STOP`), tanto com loja criada antes quanto em banco vazio. Também rodou de novo depois de todos os reverter (27→01) e depois de pares reverter+migração.
- **Ressalvas:**
  - (a) Ele **não inclui** o `schema.sql`, que é pré-requisito e **não** é idempotente depois das migrações (R1).
  - (b) Reexecutar não é totalmente "neutro": a 01 L106-108 grava como `loja_padrao` a loja mais antiga se a chave ainda não existir (R6).
  - (c) A 12 só troca os códigos de convite uma vez (marcada em `codigos_convite_trocados`).
- **Reverter:** todos funcionam em ordem inversa. **`17_comunicados_provedor_reverter.sql` falha se rodado 2x** ("constraint comunicados_mensagem_check already exists", L8: falta `drop constraint if exists` antes do `add`).

---

## 6. Riscos e pontos do documento que não batem com o código

- **R1 — `schema.sql` não é reexecutável depois das migrações (grave).**
  - Rodei schema → TUDO → schema: o segundo schema **falha** em `entrar_na_loja` ("cannot change return type", L104).
  - Antes de falhar, ele **já aplicou e gravou** (sem transação) a volta de:
    - `minhas_lojas` sem `ativo`/expiração (funcionário desativado e suporte vencido voltam a ver a loja);
    - `sou_dono`;
    - as políticas de `itens` sem `pode_gravar_colecao` (somente leitura, papel técnico e suporte deixam de valer);
    - `criar_loja` **sem trava** (cadastro duplicado volta).
  - Também roda `unir_loja_solo`, que apaga lojas.
  - O README original manda rodar o schema de novo. Para a oficina: base única (`00_base.sql`) e nunca reexecutar o schema antigo.
- **R2 — O documento diz que o "`middleware.js` trata subdomínios" (§1).** Falso. O middleware só protege `/admin` (matcher L4). O subdomínio é resolvido no navegador pela RPC `loja_por_host` (`js/cloud.js` L139/L297) e na tela "Loja não encontrada" (`js/app.js` L108-112). O curinga `*.dominio` é configuração da Vercel e não aparece no `vercel.json`.
- **R3 — Produção sem banco.** O `js/config.js` do zip vem em branco. O `gerar-config.cjs` só gera config em produção se `RBTECH_SUPABASE_URL` + `RBTECH_SUPABASE_ANON_KEY` + `RBTECH_CONFIRMO_BANCO_PRODUCAO` (igual à URL) estiverem definidas (L24-33); senão mantém o arquivo em branco. Com ele em branco, o app abre em "modo local" e o `/admin` nunca abre, porque o middleware lê o banco do `config.js` ou das `RBTECH_*` (`middleware.js` L16-24).
- **R4 — `acompanhar_os` devolve o IMEI** (26 L14), a assinatura do cliente (imagem) e o nome completo, apesar de o README dizer "sem IMEI". Telefone, CPF e fotos ela **não** devolve. A versão da oficina deve ser escrita do zero com a lista permitida.
- **R5 — WhatsApp com 55 fixo** no HTML de e-mail: schema L288 (sempre `wa.me/55`) e 18 L26 / 21 L42 (55 quando a loja não é ES). Isso fere a armadilha "número de outro país não ganha 55". `js/admin.js` L20-25 tem a mesma lógica para carrinhos.
- **R6 — "Loja padrão".**
  - 01, 02 e 06 assumem que a loja do dono da plataforma existe antes (ela vira Pro Max isenta, com logo fixo).
  - Num banco novo vazio, `loja_padrao` fica vazia (testado).
  - Se o TUDO for rodado de novo depois do 1º cliente, **a oficina do 1º cliente vira `loja_padrao`** (testado). Ela passa a responder `/pedido` e `/vitrine` sem slug, via `loja_publica` L121. O `info_loja`/`criar_pedido` do schema (L202, L213) faz o mesmo quando existe uma única loja.
  - Recomendação: tirar esse comportamento na oficina.
- **R7 — Escopo dos planos.** O documento fala de Essencial e Pro; o banco tem **Pro Max + nota fiscal** inteiro (05, 10, `api/notas/*`, `webhooks/nfse.js`, admin "Notas"/"Créditos"; o teste `notas.sql` depende da franquia 40). Decidir: remover ou esconder.
- **R8 — Hotmart acoplada ao Chile.** Espanhol vira Hotmart, Hotmart vira CLP (14 L181-214, 20 L11, 21 L14) e as mensagens usam a marca "ReparaYa" (`js/admin.js` L31/L34). O documento quer Hotmart "América Latina, moeda local"; hoje só existem BRL e CLP (`moeda_da_loja` 21 L11).
- **R9 — Limite de fotos.** O "até 12 por OS" do documento: hoje o limite de 8 está **só no front** (`fotos.js` L6). O banco limita só o tamanho (3 MB) e o tipo. O bucket privado não tem política de UPDATE.
- **R10 — `pode_gravar_colecao` usa uma lista fixa de coleções pagas** (07 L53-55). Qualquer coleção nova da oficina que deva ser Pro (lembretes de revisão, se ficarem fora de `followups`) precisa entrar ali. Senão, fica liberada no Essencial.
- **R11 — Testes dependem da "loja 1"** (seção 4). Em banco novo, 5 verificações falham sem semente. O `verificar_rls.sql` aponta 5 falsos "PROBLEMA". O nome do caso "E-mail com duas lojas" (`pagamentos.sql` L99-102) não corresponde mais ao que acontece depois da 22.
- **R12 — Webhook da Kiwify sem confirmação oficial.** O formato da assinatura (HMAC-SHA1 em `?signature=`) e os nomes dos campos estão marcados como "a confirmar" (`kiwify.js` L2-10). O carrinho abandonado depende de `payload.status='abandoned'`. É obrigatório testar com o produto novo antes de vender.
- **R13 — Pequenos pontos de segurança:**
  - cookie de admin sem HttpOnly (`admin-entrar.html` L38; ele é só um token de acesso conferido no banco);
  - `resultado_email` liberada a qualquer logado (schema L371);
  - eventos inválidos guardam até 2000 caracteres do corpo, com e-mail do comprador (`pagamento.js` L47);
  - chaves Brevo em texto puro no banco (por desenho, sem acesso pelo app);
  - `tema_por_os`, `idioma_por_os` e `moeda_por_os` ignoram `deleted`.
- **R14 — Documentação.** `docs/SAAS_GUIA.md` e `relatorio_contagem.sql` foram escritos para migrar o banco **real** da RB Tech. Para a oficina (banco novo) servem de modelo, não de passo a passo. O checklist cita o ID e a oferta reais da Hotmart e o `reparorb.vercel.app` (seção 2).
- **R15 — O documento §1 diz "TUDO.sql (todas, idempotente, roda duas vezes sem erro)".** É verdade só para o TUDO. Os **reverter não são todos idempotentes** (17) e só funcionam em ordem inversa (o 02 isolado falha com a 12 aplicada).

---

## Resumo (10 linhas)

1. A base é o `supabase/schema.sql`. As migrações 01-27 são incrementais e substituem várias funções dele. Num banco novo, roda-se o schema uma vez e depois o TUDO.
2. O TUDO.sql bate exatamente com as migrações (regerado, diff idêntico) e rodou 2x sem erro num Postgres local com mock do Supabase. Os reverter funcionam em ordem inversa, mas o 17 falha se rodado 2x.
3. Grave: rodar o `schema.sql` de novo depois das migrações falha no meio e antes disso desfaz a RLS nova, o `minhas_lojas`, a trava do `criar_loja` e roda o `unir_loja_solo`. O README manda fazer isso. Solução: uma base única achatada.
4. `acompanhar_os` não devolve telefone, CPF nem fotos, mas devolve IMEI, assinatura do cliente e nome completo. Precisa ser reescrita com placa mascarada, km e itens.
5. A criação de loja é idempotente por trava `pg_advisory_xact_lock` + "já sou dono" (migração 22), sem índice único. O limite de 8 fotos existe só no front; o bucket `lojas-privado` limita só tamanho (3 MB) e tipo.
6. Os webhooks são idempotentes por `chave_idempotencia`. A compra sem loja fica `pendente_loja` e é aplicada por gatilho quando o dono cria a loja com o mesmo e-mail. O formato da Kiwify ainda está marcado "a confirmar".
7. Não há segredos no código. A marca aparece em admin.html, admin-entrar.html, js/admin.js ("ReparaYa"/"Reparo Simples"), schema/06/19 e docs. O ID e a oferta reais da Hotmart só aparecem na documentação. Os e-mails usam preto e dourado e têm `wa.me/55` fixo.
8. Playwright e mock não vieram no zip: só os testes SQL manuais. Todos passam com uma "loja 1" semeada; 5 verificações falham em banco vazio.
9. O documento erra ao dizer que o `middleware.js` trata subdomínios: ele só protege `/admin`. Com o `js/config.js` em branco e sem as variáveis `RBTECH_*` + confirmação, a produção fica sem banco e o admin não abre.
10. A decidir com o dono: Pro Max e nota fiscal, Hotmart (hoje presa a Chile/CLP/ReparaYa), preços dos planos, recurso dos lembretes em `pode_gravar_colecao` e remoção da "loja padrão".
