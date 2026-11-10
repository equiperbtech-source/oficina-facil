/* POST /api/os/voz — "Preencher OS por voz".
   Dois jeitos de mandar a fala (cabeçalhos: Authorization: Bearer <login>, X-Loja: <id da oficina>):
   - TEXTO (application/json, { texto }): a transcrição feita pelo reconhecimento de voz do celular. Vai para o
     Claude Haiku (ANTHROPIC_API_KEY) ou, sem essa chave, para o Gemini (GEMINI_API_KEY).
   - ÁUDIO (audio/wav, até 90 s): para navegador sem reconhecimento de voz. Só o Gemini recebe áudio.
   Confere o login e se a pessoa é da oficina, conta o uso (30 por hora por oficina), manda a fala e a lista de
   serviços/peças da oficina para a IA e devolve só os campos para o formulário. O áudio e o texto ficam só na
   memória desta chamada: nunca são gravados. A OS nunca é salva aqui: quem salva é o mecânico, depois de revisar. */
import { configurado, rpc, usuario, bearer, json, ehUuid, rota } from '../_lib/supa.js';
import { chamarGemini, chamarClaude, limpar, ErroIA, MODELO_PADRAO, MODELO_CLAUDE_PADRAO } from '../_lib/voz.js';

const LIMITE_BYTES = 4 * 1024 * 1024;   // 90 s de WAV 16 kHz mono ≈ 2,9 MB (a Vercel aceita até 4,5 MB)
const TIPOS = /^audio\/(wav|x-wav|wave|webm|ogg|mp4|mpeg|mp3|aac|flac)$/;
const env = k => (process.env[k] || '').trim();

export async function POST(request) {
  return rota(async () => {
    if (!configurado()) return json(503, { erro: 'servidor_sem_banco' });
    const mime = String(request.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    const ehTexto = mime === 'application/json';
    if (!ehTexto && !TIPOS.test(mime)) return json(415, { erro: 'formato' });
    // qual IA: texto → Claude (se houver chave), senão Gemini; áudio → só Gemini
    const ia = ehTexto && env('ANTHROPIC_API_KEY') ? 'claude' : env('GEMINI_API_KEY') ? 'gemini' : null;
    if (!ia) return json(503, { erro: 'sem_chave' });
    const token = bearer(request);
    if (!(await usuario(token))) return json(401, { erro: 'sem_login' });
    const loja = request.headers.get('x-loja');
    if (!ehUuid(loja)) return json(400, { erro: 'sem_oficina' });

    let texto = null, buf = null;
    if (ehTexto) {
      const corpo = await request.json().catch(() => null);
      texto = typeof corpo?.texto === 'string' ? corpo.texto.replace(/\s+/g, ' ').trim() : '';
      if (texto.length > 5000) return json(413, { erro: 'grande_demais' });
      if (texto.replace(/[^\p{L}\p{N}]/gu, '').length < 6) return json(422, { erro: 'curto' });   // quase nada foi falado
    } else {
      buf = Buffer.from(await request.arrayBuffer());
      if (buf.length > LIMITE_BYTES) return json(413, { erro: 'grande_demais' });
      if (buf.length < 8000) return json(422, { erro: 'curto' });   // menos de ~0,3 s de áudio
    }

    const uso = await rpc('registrar_uso_voz', { p_loja: loja }, { token });
    if (uso === 'limite') return json(429, { erro: 'limite' });
    if (uso !== 'ok') return json(403, { erro: uso || 'sem_acesso' });
    const catalogo = (await rpc('voz_catalogo', { p_loja: loja }, { token })) || {};

    try {
      const bruto = ia === 'claude'
        ? await chamarClaude({ texto, catalogo, chave: env('ANTHROPIC_API_KEY'), modelo: env('VOZ_CLAUDE_MODEL') || MODELO_CLAUDE_PADRAO })
        : await chamarGemini({ ...(texto ? { texto } : { audioB64: buf.toString('base64'), mime: mime === 'audio/x-wav' || mime === 'audio/wave' ? 'audio/wav' : mime }),
          catalogo, chave: env('GEMINI_API_KEY'), modelo: env('GEMINI_MODEL') || MODELO_PADRAO });
      return json(200, { dados: limpar(bruto, catalogo) });
    } catch (e) {
      if (e instanceof ErroIA) { console.error(`[voz] IA (${ia}):`, e.motivo, e.detalhe || ''); return json(502, { erro: e.motivo }); }
      throw e;
    }
  });
}

export function GET() { return json(405, { erro: 'Use POST.' }); }
