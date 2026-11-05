/* E-mails da plataforma (boas-vindas, alertas) via Brevo — mesmo serviço já usado nos avisos de pedido.
   Chave em BREVO_API_KEY e remetente em BREVO_REMETENTE (variáveis de ambiente). Sem chave: não envia. */
export async function enviarEmail(para, assunto, html) {
  const chave = process.env.BREVO_API_KEY, remetente = process.env.BREVO_REMETENTE;
  if (!chave || !remetente || !para) return false;
  try {
    const r = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': chave, 'Content-Type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ sender: { email: remetente, name: process.env.PLATAFORMA_NOME || 'Oficina Simples' }, to: [{ email: para }], subject: assunto, htmlContent: html }),
    });
    return r.ok;
  } catch { return false; }
}

export const escHtml = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
