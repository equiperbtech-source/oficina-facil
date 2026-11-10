/* POST /api/os/voz — "Preencher OS por voz".
   Corpo: o áudio (audio/wav, até 90 s). Cabeçalhos: Authorization: Bearer <login>, X-Loja: <id da oficina>.
   Confere o login e se a pessoa é da oficina, conta o uso (30 por hora por oficina), manda o áudio e a lista
   de serviços/peças da oficina para o Gemini e devolve só os campos para o formulário. O áudio fica só na
   memória desta chamada: nunca é gravado. A OS nunca é salva aqui: quem salva é o mecânico, depois de revisar. */
import { configurado, rpc, usuario, bearer, json, ehUuid, rota } from '../_lib/supa.js';
import { chamarGemini, limpar, ErroIA, MODELO_PADRAO } from '../_lib/voz.js';

const LIMITE_BYTES = 4 * 1024 * 1024;   // 90 s de WAV 16 kHz mono ≈ 2,9 MB (a Vercel aceita até 4,5 MB)
const TIPOS = /^audio\/(wav|x-wav|wave|webm|ogg|mp4|mpeg|mp3|aac|flac)$/;

export async function POST(request) {
  return rota(async () => {
    if (!configurado()) return json(503, { erro: 'servidor_sem_banco' });
    if (!process.env.GEMINI_API_KEY) return json(503, { erro: 'sem_chave' });
    const token = bearer(request);
    if (!(await usuario(token))) return json(401, { erro: 'sem_login' });
    const loja = request.headers.get('x-loja');
    if (!ehUuid(loja)) return json(400, { erro: 'sem_oficina' });
    const mime = String(request.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!TIPOS.test(mime)) return json(415, { erro: 'formato' });
    const buf = Buffer.from(await request.arrayBuffer());
    if (buf.length > LIMITE_BYTES) return json(413, { erro: 'grande_demais' });
    if (buf.length < 8000) return json(422, { erro: 'curto' });   // menos de ~0,3 s de áudio

    const uso = await rpc('registrar_uso_voz', { p_loja: loja }, { token });
    if (uso === 'limite') return json(429, { erro: 'limite' });
    if (uso !== 'ok') return json(403, { erro: uso || 'sem_acesso' });
    const catalogo = (await rpc('voz_catalogo', { p_loja: loja }, { token })) || {};

    try {
      const bruto = await chamarGemini({ audioB64: buf.toString('base64'), mime: mime === 'audio/x-wav' || mime === 'audio/wave' ? 'audio/wav' : mime, catalogo,
        chave: process.env.GEMINI_API_KEY, modelo: (process.env.GEMINI_MODEL || '').trim() || MODELO_PADRAO });
      return json(200, { dados: limpar(bruto, catalogo) });
    } catch (e) {
      if (e instanceof ErroIA) { console.error('[voz] IA:', e.motivo, e.detalhe || ''); return json(502, { erro: e.motivo }); }
      throw e;
    }
  });
}

export function GET() { return json(405, { erro: 'Use POST.' }); }
