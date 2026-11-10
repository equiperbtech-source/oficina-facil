# Publicação na Vercel

> Este guia cresce até a Etapa 10. Por enquanto ele cobre só a **prévia** (o app no ar, sem banco),
> para você acompanhar as etapas no celular. A publicação de verdade, com Supabase, Kiwify, domínio
> e e-mails, entra aqui no fim.

## Parte 1 — Prévia agora (sem banco)

Na prévia o app abre em **modo local**: dá para criar a oficina, cadastrar clientes, abrir OS e
ver as telas, mas tudo fica salvo só naquele navegador. Não há login na nuvem, nem link do cliente,
nem pagamento. Serve para ver o visual e as telas novas a cada etapa.

### 1. Importar o repositório (uma vez só, ~3 minutos)

1. Entre em **vercel.com** com a sua conta (pode ser a conta grátis, "Hobby").
2. Clique em **Add New… → Project**.
3. Em **Import Git Repository**, escolha `equiperbtech-source/oficina-facil`.
   - Se ele não aparecer: clique em **Adjust GitHub App Permissions** e dê acesso a esse repositório.
4. Na tela de configuração, **não mude nada**:
   - Framework Preset: **Other**
   - Root Directory: `./`
   - Build e Output: já vêm do arquivo `vercel.json` (`node scripts/build.cjs` → `dist`)
   - **Não cadastre nenhuma variável agora.**
5. Clique em **Deploy**.

### 2. O primeiro build vai dar erro — é de propósito

A Vercel trata o primeiro build como **produção**. O app tem uma trava: produção sem o banco
configurado **para com erro**, para nunca sair um app sem nuvem por engano. A mensagem é:

```
[config] ERRO: produção sem OFICINA_SUPABASE_URL
```

Isso é esperado. Para a prévia, faça só isto:

1. No projeto, abra **Settings → Environments → Production**.
2. Em **Branch Tracking**, troque o branch de produção para `main` e salve.
   (Esse branch ainda não existe; assim, nenhum build vira "produção" até a Etapa 10.)

### 3. Abrir a prévia

A cada etapa terminada eu faço push no branch `claude/new-session-lji9tt`, e a Vercel publica
sozinha uma prévia nova. Para achar:

1. Abra a aba **Deployments** do projeto.
2. Clique na publicação mais recente do branch `claude/new-session-lji9tt` (marcada como *Preview*).
3. Clique em **Visit**.

O endereço fixo do branch fica parecido com
`oficina-facil-git-claude-new-session-lji9tt-<sua-conta>.vercel.app` e sempre mostra a versão mais nova.

**No celular:** por padrão a Vercel pede login na Vercel para abrir prévias. Se quiser abrir sem
login (ou mandar para alguém ver), desligue em **Settings → Deployment Protection → Vercel
Authentication**. Como a prévia não tem banco nem dados, não há risco nisso.

### O que conferir na prévia

- O app abre com a marca **Oficina Simples**, fundo branco e detalhes em azul.
- Dá para criar uma oficina de teste e navegar pelas telas.
- Cada etapa nova aparece sozinha alguns minutos depois do push. Se o celular mostrar a versão
  antiga, use **Menu → Atualizar o sistema**.

## Parte 2 — Produção (com banco)

Tempo: ~40 minutos. Faça na ordem. Nenhuma chave vai para o código: tudo fica nas variáveis da Vercel.

### 1. Supabase (o banco)
1. Em **supabase.com**, crie um projeto novo (região **São Paulo**). Guarde a senha do banco.
2. **SQL Editor → New query**: cole o conteúdo de `supabase/saas/TUDO.sql` e rode. É o banco inteiro (base única + migrações); pode rodar de novo sem problema.
3. (Não use os arquivos de `supabase/legado/`: são só histórico.)
4. Ainda no SQL Editor, cadastre você como **super admin** (troque pelo seu e-mail de login, depois de criar sua conta no app):
   ```sql
   insert into public.super_admins(user_id) select id from auth.users where email = 'SEU-EMAIL';
   ```
5. **Authentication → Sign In / Providers → Email**: desligue **Confirm email** (o dono entra na hora).
6. **Authentication → URL Configuration**:
   - Site URL: `https://app.SEUDOMINIO.com.br`
   - Redirect URLs: `https://app.SEUDOMINIO.com.br/**` e `https://*.SEUDOMINIO.com.br/**`
7. **Project Settings → Data API**: copie a **Project URL**. **Project Settings → API Keys**: copie a **publishable key** (a pública) e a **secret key** (a secreta; só vai na Vercel).

### 2. Vercel (o app)
Em **Settings → Environment Variables** do projeto (marque só **Production**, a não ser que diga outra coisa):

| Variável | Valor |
|---|---|
| `OFICINA_SUPABASE_URL` | Project URL (`https://xxxx.supabase.co`) — marque também **Preview** se quiser a prévia com banco |
| `OFICINA_SUPABASE_ANON_KEY` | publishable key — idem |
| `OFICINA_CONFIRMO_BANCO_PRODUCAO` | **a mesma** Project URL (trava contra banco errado) |
| `OFICINA_DOMINIO` | `seudominio.com.br` |
| `SUPABASE_URL` | Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | secret key (**só aqui, nunca no chat ou no código**) |
| `SITE_URL` | `https://app.seudominio.com.br` |
| `KIWIFY_WEBHOOK_TOKEN` | token do webhook da Kiwify (passo 4) |
| `BREVO_API_KEY` e `BREVO_REMETENTE` | chave do Brevo e o e-mail remetente verificado (passo 5) |
| `PLATAFORMA_NOME` | `Oficina Simples` |

Depois: **Settings → Environments → Production → Branch Tracking**: volte o branch de produção para o branch que você quer publicar (hoje, `claude/new-session-lji9tt`) e faça **Redeploy**.

### 3. Domínio e subdomínio de cada oficina
1. Vercel → **Settings → Domains**: adicione `app.seudominio.com.br` e o curinga `*.seudominio.com.br`.
2. No seu registro de domínio (Registro.br, Cloudflare...), siga o que a Vercel mostrar. O curinga exige usar os **nameservers da Vercel** (ns1/ns2.vercel-dns.com).
3. Cada oficina escolhe o endereço curto em Configurações → Aparência (ex.: `joao.seudominio.com.br`).

### 4. Kiwify (pagamento)
1. Crie os produtos **Essencial (R$ 49,99/mês)** e **Pro (R$ 89,99/mês)** como assinatura.
2. **Webhooks**: URL `https://app.seudominio.com.br/api/webhooks/kiwify`, todos os eventos de compra/assinatura. Copie o **token** para `KIWIFY_WEBHOOK_TOKEN`.
3. No app, entre em `/admin` → **Produtos**: ligue cada produto da Kiwify ao plano certo e cole o link de checkout.
4. Faça uma compra de teste com cupom de 100% e confira em `/admin → Pagamentos`.

### 5. Brevo (e-mails)
1. Crie a conta em **brevo.com**, verifique o domínio do remetente (ex.: `contato@seudominio.com.br`).
2. **SMTP & API → API Keys**: gere a chave e cole em `BREVO_API_KEY`; o remetente em `BREVO_REMETENTE`.
3. Em **Brevo → Segurança → IPs autorizados**, desligue o bloqueio por IP (a Vercel muda de IP).

### 6. Meta Pixel e Clarity (opcional)
Ficam na landing (Etapa 9), por configuração, vazios por padrão.

### 7. Conferência rápida (5 min)
1. Abra `https://app.seudominio.com.br`, crie sua conta e a oficina ("Que veículos você atende?").
2. Rode o `insert` do super admin (passo 1.4) e abra `/admin`.
3. Crie um cliente com uma placa, abra uma OS pelos 4 passos, copie o link do cliente e abra no celular.
4. Gere o PDF da OS e o termo de garantia.

## Parte 3 — Roteiro de teste manual (15 minutos, no celular)

Faça depois de publicar, com o celular na mão.

| # | Faça | Tem que acontecer |
|---|---|---|
| 1 | Abra `app.seudominio.com.br` | Tela de entrada branca e azul, "Oficina Simples" |
| 2 | Criar conta → nome da oficina → "Os dois" | Painel abre; menu com Pátio, Mecânico, OS, Clientes... |
| 3 | Clientes → Novo cliente com placa `ABC-1D23` (carro) e outra `MOT1A23` (moto) | Carro mostra motor/câmbio; moto mostra cilindrada/partida/freio |
| 4 | Novo cliente com a placa `ABC1D23` de novo | Aviso "Placa já cadastrada em …" |
| 5 | OS → Nova OS → digite `abc1d23` | Acha o veículo; entrada com km, combustível e checklist de carro |
| 6 | Passo 4: um serviço do catálogo (ponha o valor), uma peça avulsa, desconto R$ 10 | Total = mão de obra + peças − 10 |
| 7 | Marque "Aguardar aprovação do cliente" e abra a OS | Etapa "Aguardando aprovação" |
| 8 | Copie o link de acompanhamento e abra numa aba anônima | Placa `ABC•••3`, só o primeiro nome, itens e total; botão "Aprovar orçamento" |
| 9 | Aprove no link | Em segundos a OS vai para "Em serviço" no app |
| 10 | Mecânico → Fotos (tire 3) e + Peça | Fotos aparecem na OS; peça entra nos itens |
| 11 | Pátio | Barra de rolagem em cima, setas, card "Pago" no fim |
| 12 | Mova para "Pronto para retirada" → WhatsApp | Mensagem "Seu carro … placa … está pronto para retirada" + garantia |
| 13 | Receber → Crédito 3x | Recebido; termo de garantia em PDF abre (1 página) |
| 14 | No link do cliente: `…/acompanhar/TOKEN?pdf=garantia` | Baixa o termo de garantia |
| 15 | Configurações → Oficina: listas e textos → desligue "Previsão de entrega" | A previsão some da OS e do link |
