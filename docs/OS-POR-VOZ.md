# Preencher OS por voz

## Como funciona
1. **OS → Nova OS → "Gravar áudio"** (botão grande com microfone, no primeiro passo).
2. O mecânico fala, com cronômetro e botão **Parar** (até 1:30; para sozinho no limite).
   - **Chrome (Android) e Safari (iPhone):** o próprio celular transcreve a fala (reconhecimento de voz do navegador, sem custo) e o texto aparece na tela enquanto ele fala. Só o **texto** vai para `/api/os/voz` ("Lendo a fala...").
   - **Navegador sem reconhecimento de voz:** grava o áudio, converte em WAV 16 kHz e manda o **áudio** ("Lendo o áudio...").
3. O servidor confere o login e se a pessoa é da oficina, conta o uso (**30 por hora por oficina**), busca os serviços e peças cadastrados e manda a fala + a lista para a IA, com saída em JSON pelo schema combinado:
   - **texto → Claude Haiku 5.5** (`ANTHROPIC_API_KEY`), com JSON Schema (structured outputs);
   - **áudio → Gemini** (`GEMINI_API_KEY`): o Claude não recebe áudio. Sem `ANTHROPIC_API_KEY`, o texto também vai para o Gemini.
   O áudio e o texto ficam só na memória da chamada: **não são guardados**.
4. Abre a tela **"Confira a OS"** já preenchida (com "O que eu entendi", o texto transcrito). O que a IA não entendeu fica vazio e **amarelo**, com "Confira este campo".
5. Placa já cadastrada: puxa o cliente e a moto e avisa "Moto já cadastrada: [modelo] de [cliente]". Telefone falado diferente do cadastrado: pergunta qual manter.
6. O mecânico corrige e toca em **Abrir OS**. A IA nunca salva sozinha.

Erros: microfone bloqueado (explica como liberar no Android e no iPhone); falha da IA ou limite ("Não consegui ler o áudio agora, preencha manualmente ou tente de novo"); fala curta ou sem fala (pede para gravar de novo, sem gastar a IA); navegador sem reconhecimento de voz quando o servidor só tem o Claude ("Este navegador não transcreve a fala...").

## Configuração (Vercel → Settings → Environment Variables)
| Variável | Valor |
|---|---|
| `ANTHROPIC_API_KEY` | chave da API do Claude: **console.anthropic.com → API Keys**. É paga por uso e **separada** da assinatura Claude Pro/Max (a assinatura não dá chave nem créditos de API). Coloque créditos em Billing |
| `VOZ_CLAUDE_MODEL` | `claude-haiku-5-5` (padrão quando vazia). Dá para trocar sem mexer no código |
| `GEMINI_API_KEY` | opcional, gratuita: **aistudio.google.com → Get API key**. Serve para quem usa navegador sem reconhecimento de voz |
| `GEMINI_MODEL` | `gemini-flash-latest` (padrão quando vazia) |

Depois de salvar as variáveis, faça **Redeploy**. No banco: rode a migração `supabase/saas/32_os_por_voz.sql` (ou o `TUDO.sql` de novo, que já inclui).

**Custo do Haiku 5.5:** US$ 0,10 por milhão de tokens de entrada e US$ 0,50 por milhão de saída. Uma OS por voz usa por volta de 1.000 a 3.000 tokens de entrada (instruções + lista cadastrada + fala) e algumas centenas de saída: na casa de **US$ 0,0005 por OS** (cerca de 2 mil OS por dólar). O limite de 30 por hora por oficina continua valendo.

## Arquivos
- `api/os/voz.js` (rota: texto → Claude, áudio → Gemini) e `api/_lib/voz.js` (chamadas ao Claude, pelo SDK oficial `@anthropic-ai/sdk`, e ao Gemini; instruções, schemas e limpeza da resposta)
- `js/pages/voz.js` (reconhecimento de voz, gravação e tela de revisão) + o botão no passo 1 da nova OS (`js/pages/os.js`)
- `supabase/saas/32_os_por_voz.sql` + reverter (limite por oficina e lista cadastrada)

## Testes
- `tests/e2e/12-os-por-voz.spec.cjs`: rota de verdade com o Claude e o Gemini simulados (login, oficina, lista no prompt, JSON Schema, modelo pela variável, recusa e falha da IA, limite de 30/h, nada guardado); tela com reconhecimento de voz falso para as 3 falas de aceitação (e a gravação de áudio quando o navegador não transcreve), os erros e o "só salva quando o mecânico manda".
- `scripts/testar-voz.mjs`: as 3 falas com a **IA de verdade** (precisa da chave):
  - Claude Haiku (as 3 falas já transcritas): `ANTHROPIC_API_KEY=... node scripts/testar-voz.mjs`
  - Gemini (áudios): `GEMINI_API_KEY=... node scripts/testar-voz.mjs fala1.mp3 fala2.mp3 fala3.mp3`
