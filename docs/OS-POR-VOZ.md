# Preencher OS por voz

## Como funciona
1. **OS → Nova OS → "Gravar áudio"** (botão grande com microfone, no primeiro passo).
2. Grava pelo navegador com cronômetro e botão **Parar** (até 1:30; para sozinho no limite).
3. O áudio vira WAV 16 kHz no celular e vai para `/api/os/voz` ("Lendo o áudio...").
4. O servidor confere o login e se a pessoa é da oficina, conta o uso (**30 por hora por oficina**), busca os serviços e peças cadastrados e manda **áudio + lista** para o **Gemini**, com saída em JSON pelo schema combinado. O áudio fica só na memória da chamada: **não é guardado**.
5. Abre a tela **"Confira a OS"** já preenchida. O que a IA não entendeu fica vazio e **amarelo**, com "Confira este campo".
6. Placa já cadastrada: puxa o cliente e a moto e avisa "Moto já cadastrada: [modelo] de [cliente]". Telefone falado diferente do cadastrado: pergunta qual manter.
7. O mecânico corrige e toca em **Abrir OS**. A IA nunca salva sozinha.

Erros: microfone bloqueado (explica como liberar no Android e no iPhone); falha da IA ou limite ("Não consegui ler o áudio agora, preencha manualmente ou tente de novo"); áudio curto ou sem fala (pede para gravar de novo).

## Configuração (Vercel → Environment Variables)
| Variável | Valor |
|---|---|
| `GEMINI_API_KEY` | chave do Google AI Studio (aistudio.google.com → Get API key) |
| `GEMINI_MODEL` | opcional. Vazio = `gemini-flash-latest` (o Gemini Flash mais recente). Para fixar um modelo, ex.: `gemini-2.5-flash` |

No banco: rode a migração `supabase/saas/32_os_por_voz.sql` (ou o `TUDO.sql` de novo, que já inclui).

## Arquivos
- `api/os/voz.js` (rota) e `api/_lib/voz.js` (chamada ao Gemini, instruções, schema e limpeza da resposta)
- `js/pages/voz.js` (gravação e tela de revisão) + o botão no passo 1 da nova OS (`js/pages/os.js`)
- `supabase/saas/32_os_por_voz.sql` + reverter (limite por oficina e lista cadastrada)

## Testes
- `tests/e2e/12-os-por-voz.spec.cjs`: rota de verdade com o Gemini simulado (login, oficina, lista no prompt, schema, modelo pela variável, limite de 30/h, áudio não guardado) e a tela com microfone falso para as 3 falas de aceitação, os erros e o "só salva quando o mecânico manda".
- `scripts/testar-voz.mjs`: as 3 falas com o **Gemini de verdade** (precisa da chave):
  `GEMINI_API_KEY=... node scripts/testar-voz.mjs fala1.mp3 fala2.mp3 fala3.mp3`
