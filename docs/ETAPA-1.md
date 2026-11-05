# Etapa 1: base nova

## Suas decisões (registradas)

| Assunto | Decisão |
|---|---|
| Nome | **Oficina Simples** (o mesmo em português e espanhol) |
| WhatsApp do suporte | +55 48 99115-4821 (botão "Falar com o suporte") |
| Preços | Essencial **R$ 49,99** · Pro **R$ 89,99** (editáveis no admin) |
| Aprovação do orçamento pelo link | **Entra agora** (Etapa 4) |
| País | **Só Brasil**: Kiwify e reais. O produto da Kiwify você configura depois (Etapa 8). O espanhol continua funcionando nas telas |
| Vitrine | Fica **vazia** por enquanto; decidimos depois o que entra |
| Mecânicos | Até **4 pessoas da equipe** com acesso ao app (nos dois planos). O mecânico lança itens numa OS de forma rápida, **com nome e foto da peça** (Etapa 4) |
| Nota fiscal / Pro Max | Fora do produto (era a minha sugestão; me avise se quiser diferente) |

## O que foi feito

1. **Código copiado** do Reparo Simples para este repositório, sem as imagens e documentos do original e sem nenhuma chave.
2. **Nome novo em tudo:**
   - título, manifest, e-mails, admin, mensagens do app;
   - chaves internas (`oficina_*`), variáveis de ambiente (`OFICINA_*`), cookie do admin e cache do modo offline.
3. **Logo novo** (roda + chave inglesa, azul) em SVG e PNG 32/180/192/512.
4. **Domínio vindo da publicação:** não fica mais fixo no código. Sai da variável `OFICINA_DOMINIO` na Vercel; enquanto ela estiver vazia, os endereços por oficina ficam desligados.
5. **Armadilhas que ainda estavam abertas no original, corrigidas:**
   - Moeda: o idioma da tela não converte mais os valores (sem cotação). A plataforma de pagamento segue a moeda da oficina.
   - WhatsApp: só ganha o 55 quando a oficina é do Brasil e o número tem DDD que existe; número de outro país nunca vira brasileiro.
   - Botão com `hidden`: agora fica escondido de verdade.
   - Idioma padrão: português.
6. **Saíram:** nota fiscal (telas e servidor), importação do sistema concorrente e o leitor de PDF que só servia para ela. O plano Pro Max fica desativado no banco.
7. **Planos no banco:** Essencial R$ 49,99 e Pro R$ 89,99, 4 funcionários cada. O teste grátis libera tudo, menos a vitrine.
8. **Publicação mais segura:** em produção, sem as variáveis do Supabase, a publicação para com erro, em vez de sair um app sem nuvem.
9. **Ambiente de testes criado do zero:**
   - Postgres local, montado do zero a cada rodada;
   - um "Supabase de mentira" com login, dados, fotos e tempo real, usando as regras de segurança reais do banco;
   - Playwright no celular (390×844) e no computador.

## Resultado dos testes

`npm run teste` → **14 passaram, 0 falharam.** Outros 4 só rodam no celular, uma vez, e aparecem como "pulados" na rodada do computador.

| Teste | Celular | Computador |
|---|---|---|
| `TUDO.sql` está em dia com as migrações | ✅ | (uma vez) |
| Banco do zero, `TUDO.sql` 2 vezes sem erro, planos certos, toda tabela com RLS | ✅ | (uma vez) |
| Tela de entrada com a marca nova, em português, sem rolagem lateral, sem erro no console | ✅ | ✅ |
| Cria conta e oficina e chega ao painel, sem erros | ✅ | ✅ |
| **Duas oficinas:** B não vê clientes, oficina, equipe nem fotos de A, nem pela tela nem chamando o servidor direto, e não consegue gravar, alterar ou apagar nada de A | ✅ | (uma vez) |
| WhatsApp sem 55 indevido (10 casos) | ✅ | ✅ |
| Moeda: com a tela em espanhol, os valores continuam em reais | ✅ | ✅ |
| Botão com `hidden` escondido | ✅ | ✅ |
| **Dois aparelhos** da mesma oficina: cliente aparece sozinho no outro; cada um muda um campo das configurações quase junto e os dois valores ficam | ✅ | (uma vez) |

Prints: [`docs/prints/etapa-1/`](prints/etapa-1/). O visual ainda é o preto e dourado do original; o tema branco e azul é a Etapa 2.

## O que ainda não mudou (de propósito, fica para a etapa certa)

- **Visual** preto e dourado, e o 55 fixo no HTML dos e-mails do banco: Etapa 2, junto com os e-mails novos.
- **Textos de celular** ("aparelho", "loja", "assistência", "técnico"): Etapa 3.
- **Banco:** ainda usa o `schema.sql` + migrações do original (com nota fiscal e Pro Max desativados). A base única e limpa é a Etapa 7.
- **Admin:** ainda mostra colunas de notas. Fica para a Etapa 8.

## O que você precisa fazer agora

Nada. Quando quiser ver o app rodando, me peça uma publicação de teste (vai precisar de um Supabase e de uma Vercel novos; o passo a passo vem na Etapa 10).
