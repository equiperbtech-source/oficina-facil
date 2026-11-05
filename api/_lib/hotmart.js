/* Provedor de pagamento: Hotmart (webhook versão 2.0.0).
   ⚠️ CONFERIR NO PRIMEIRO EVENTO REAL (Admin → Pagamentos → Ver) antes de confiar 100%:
   - Validação: o "Hottok" da conta (Hotmart → Ferramentas → Webhook) chega no cabeçalho X-HOTMART-HOTTOK
     (versões antigas mandavam no corpo, campo "hottok"). Comparado em tempo constante com HOTMART_HOTTOK.
   - Corpo: { id, event, version, data: { product: { id }, buyer: { email }, purchase: { transaction, offer: { code },
     recurrence_number, date_next_charge (ms) }, subscription: { subscriber: { code }, plan: { id } } } }.
     No cancelamento da assinatura (SUBSCRIPTION_CANCELLATION) o e-mail vem em data.subscriber.email.
     Na troca de plano (SWITCH_PLAN): data.plans[{ id, offer.key, current }], data.subscription.{ user.email, product.id, subscriber_code }.
   - O plano é reconhecido pela oferta (código "off=" do link de checkout), cadastrada no /admin → Produtos e planos.
   Formatos conferidos com os eventos de teste da Hotmart (out/2026).
   Tudo o que não for reconhecido com segurança vai para "revisão" (gravado, mas não aplicado). */
import crypto from 'node:crypto';

const TIPOS = {
  PURCHASE_APPROVED: 'compra_aprovada',          // 1ª cobrança; as seguintes viram "renovacao" pelo recurrence_number
  PURCHASE_DELAYED: 'atrasada',                  // cobrança da assinatura não passou
  SUBSCRIPTION_CANCELLATION: 'cancelada',
  PURCHASE_REFUNDED: 'reembolso',
  PURCHASE_CHARGEBACK: 'chargeback',
  SWITCH_PLAN: 'troca_plano',                    // plano novo = item de data.plans com current: true
  // PURCHASE_COMPLETE (fim da garantia), PURCHASE_CANCELED (pagamento não concluído), PURCHASE_PROTEST
  // e outros: registrados como 'ignorado'
};

function pega(obj, ...caminhos) {
  for (const c of caminhos) {
    const v = c.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
    if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
  }
  return '';
}
// data em milissegundos (padrão da Hotmart) ou texto ISO
function data(v) {
  if (!v) return null;
  const d = /^\d{10,}$/.test(v) ? new Date(Number(v)) : new Date(v);
  return isNaN(d) ? null : d.toISOString();
}
function iguais(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

export const hotmart = {
  nome: 'hotmart',

  validar(headers, payload, token) {
    if (!token) return false;
    const recebido = headers.get('x-hotmart-hottok') || (payload && typeof payload.hottok === 'string' ? payload.hottok : '');
    return !!recebido && iguais(recebido, token);
  },

  normalizar(p, corpoBruto) {
    const original = pega(p, 'event');
    let tipo = TIPOS[original] || 'ignorado';
    const recorrencia = parseInt(pega(p, 'data.purchase.recurrence_number') || '0', 10);
    if (tipo === 'compra_aprovada' && recorrencia > 1) tipo = 'renovacao';
    const transacao = pega(p, 'data.purchase.transaction');
    const assinatura = pega(p, 'data.subscription.subscriber.code', 'data.subscriber.code', 'data.subscription.subscriber_code');
    const planoAtual = Array.isArray(p?.data?.plans) ? p.data.plans.find(x => x && x.current) : null;
    const n = {
      provedor: 'hotmart',
      tipo, tipo_original: original,
      email: pega(p, 'data.buyer.email', 'data.subscriber.email', 'data.subscription.user.email').toLowerCase(),
      produto_id: pega(p, 'data.product.id', 'data.subscription.product.id'),
      // oferta = código "off=" do link de checkout (um por plano: Esencial, Pro); sem oferta, o ID do plano
      oferta_id: pega(p, 'data.purchase.offer.code') || pega(planoAtual, 'offer.key', 'offer.code')
        || (planoAtual?.id != null ? String(planoAtual.id) : pega(p, 'data.subscription.plan.id', 'data.plan.id')),
      pedido_id: transacao || assinatura,
      assinatura_id: assinatura,
      proxima_cobranca: data(pega(p, 'data.purchase.date_next_charge', 'data.date_next_charge')),
    };
    n.confiavel = tipo === 'ignorado' || !!(n.email && n.produto_id && n.pedido_id);
    // mesma entrega repetida = mesma chave; cada cobrança da assinatura tem transação própria
    n.chave = n.pedido_id
      ? `hotmart:${original}:${n.pedido_id}:${recorrencia || pega(p, 'data.cancellation_date', 'data.switch_plan_date') || ''}${tipo === 'troca_plano' ? ':' + n.oferta_id : ''}`
      : 'hotmart:' + (pega(p, 'id') || crypto.createHash('sha256').update(corpoBruto).digest('hex'));
    return n;
  },
};
