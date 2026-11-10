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

## Parte 2 — Produção (Etapa 10)

Vem no fim: Supabase novo e `TUDO.sql`, variáveis `OFICINA_*` (inclusive a trava
`OFICINA_CONFIRMO_BANCO_PRODUCAO`), domínio e subdomínio curinga, Kiwify e webhook, Brevo e Pixel,
e a volta do branch de produção para o branch certo.
