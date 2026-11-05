/* Camada de pagamento: interface única para várias plataformas (Kiwify e Hotmart) no mesmo sistema.
   Cada provedor implementa: validar(...) e normalizar(payload, corpoBruto) →
   { provedor, chave, tipo, tipo_original, email, produto_id, oferta_id, pedido_id, assinatura_id, proxima_cobranca, confiavel }.
   As regras de negócio (plano, situação, créditos) ficam no banco: aplicar_evento_pagamento. */
import { kiwify } from './kiwify.js';
import { hotmart } from './hotmart.js';
import { configurado, rpc, json } from './supa.js';
import { enviarEmail, escHtml } from './email.js';

export const provedores = { kiwify, hotmart };

const LIMITE = 256 * 1024;
// segredo de cada plataforma (variáveis de ambiente da Vercel) e como cada uma assina o aviso
const SEGREDO = { kiwify: 'KIWIFY_WEBHOOK_TOKEN', hotmart: 'HOTMART_HOTTOK' };
const VALIDA = {
  kiwify: (req, bruto, _p, s) => kiwify.validar(req.url, bruto, s),
  hotmart: (req, _b, p, s) => hotmart.validar(req.headers, p, s),
};

// e-mail de boas-vindas da compra sem loja, no idioma da plataforma (Hotmart: espanhol)
const BOAS_VINDAS = {
  pt: (email, link) => ['Sua assinatura foi confirmada: crie o acesso da sua loja',
    `<div style="font-family:Arial,sans-serif;max-width:520px"><h2>Bem-vindo! 🎉</h2>
     <p>Recebemos o pagamento da sua assinatura. Falta só criar o acesso da sua loja com <b>este mesmo e-mail</b> (${escHtml(email)}): o plano é ativado na hora.</p>
     <p><a href="${escHtml(link)}" style="display:inline-block;background:#d4af37;color:#000;padding:12px 20px;border-radius:8px;font-weight:bold;text-decoration:none">Criar minha loja</a></p></div>`],
  es: (email, link) => ['Tu suscripción fue confirmada: crea el acceso de tu tienda',
    `<div style="font-family:Arial,sans-serif;max-width:520px"><h2>¡Bienvenido! 🎉</h2>
     <p>Recibimos el pago de tu suscripción. Solo falta crear el acceso de tu tienda con <b>este mismo correo</b> (${escHtml(email)}): el plan se activa al instante.</p>
     <p><a href="${escHtml(link)}" style="display:inline-block;background:#d4af37;color:#000;padding:12px 20px;border-radius:8px;font-weight:bold;text-decoration:none">Crear mi tienda</a></p></div>`],
};

/* Única fonte que altera plano e situação da assinatura. Valida a origem (401 se inválida),
   grava o evento bruto (idempotente), aplica as regras no banco e responde rápido. */
export async function receberWebhook(request, nome) {
  const prov = provedores[nome];
  const segredo = process.env[SEGREDO[nome]] || '';
  if (!segredo || !configurado()) return json(503, { erro: 'webhook não configurado' }); // a plataforma tenta de novo depois
  const bruto = await request.text();
  if (bruto.length > LIMITE) return json(413, { erro: 'corpo grande demais' });
  let payload; try { payload = JSON.parse(bruto); } catch { return json(400, { erro: 'JSON inválido' }); }

  const valido = VALIDA[nome](request, bruto, payload, segredo);
  const norm = { ...prov.normalizar(payload, bruto), provedor: nome };
  // o segredo nunca fica guardado no evento
  if (payload && typeof payload === 'object' && 'hottok' in payload) delete payload.hottok;
  // evento inválido fica registrado (resumido) para diagnóstico, mas nunca é aplicado
  const reg = await rpc('registrar_evento_pagamento', { p_valido: valido, p_norm: norm, p_payload: valido ? payload : { resumo: JSON.stringify(payload).slice(0, 2000) } });
  if (!valido) return json(401, { erro: 'assinatura inválida' });
  if (reg.duplicado) return json(200, { ok: true, duplicado: true });

  let status = reg.status;
  if (status === 'recebido') status = await rpc('aplicar_evento_pagamento', { p_evento: reg.id });

  // compra sem loja: e-mail de boas-vindas com o link de cadastro (o plano entra sozinho ao cadastrar com este e-mail)
  if (status === 'pendente_loja' && norm.email) {
    const idioma = nome === 'hotmart' ? 'es' : 'pt';
    const site = process.env.SITE_URL || new URL(request.url).origin;
    const link = `${site}/?cadastro=1&idioma=${idioma}&email=${encodeURIComponent(norm.email)}`;
    await enviarEmail(norm.email, ...BOAS_VINDAS[idioma](norm.email, link));
  }
  return json(200, { ok: true, status });
}
