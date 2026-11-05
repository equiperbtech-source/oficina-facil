/* Provedor de pagamento: Kiwify.
   ⚠️ A CONFIRMAR NA DOCUMENTAÇÃO OFICIAL (docs.kiwify.com.br) antes de ligar em produção:
   - Validação: HMAC-SHA1 do corpo bruto com o token do webhook, enviado no parâmetro "signature" da URL.
     (Descrito por integrações de terceiros; a página oficial não pôde ser aberta neste ambiente.)
   - Nomes dos campos do corpo (order_id, webhook_event_type, Customer.email, Product.product_id ...).
   Gatilhos confirmados na referência oficial "Criar webhook": compra_aprovada, compra_reembolsada, chargeback,
   subscription_canceled, subscription_late, subscription_renewed.
   Visto num evento real (out/2026): webhook_event_type "order_approved", order_status "paid",
   Customer.email, Product.product_id, Subscription.plan.id (plano dentro do produto), Subscription.next_payment, subscription_id.
   Tudo o que não for reconhecido com segurança vai para "revisão" (gravado, mas não aplicado). */
import crypto from 'node:crypto';

const TIPOS = {
  order_approved: 'compra_aprovada',      // nome real visto num evento da Kiwify em produção (assinatura paga via Pix)
  compra_aprovada: 'compra_aprovada',
  subscription_renewed: 'renovacao',
  subscription_late: 'atrasada',
  subscription_canceled: 'cancelada',
  compra_reembolsada: 'reembolso',
  chargeback: 'chargeback',
};

// primeiro valor preenchido entre vários caminhos possíveis ("A.b.c")
function pega(obj, ...caminhos) {
  for (const c of caminhos) {
    const v = c.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
    if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
  }
  return '';
}

export const kiwify = {
  nome: 'kiwify',

  validar(url, corpoBruto, token) {
    if (!token) return false;
    const recebida = new URL(url).searchParams.get('signature') || '';
    if (!/^[0-9a-f]{40}$/i.test(recebida)) return false;
    const esperada = crypto.createHmac('sha1', token).update(corpoBruto, 'utf8').digest('hex');
    return crypto.timingSafeEqual(Buffer.from(recebida.toLowerCase()), Buffer.from(esperada));
  },

  normalizar(p, corpoBruto) {
    const original = pega(p, 'webhook_event_type', 'event', 'trigger')
      || ({ paid: 'compra_aprovada', refunded: 'compra_reembolsada', chargedback: 'chargeback' })[pega(p, 'order_status')] || '';
    const tipo = TIPOS[original] || 'ignorado';
    const pedido = pega(p, 'order_id', 'order.id', 'id');
    const proxima = pega(p, 'Subscription.next_payment', 'subscription.next_payment', 'next_payment');
    const n = {
      tipo, tipo_original: original,
      email: pega(p, 'Customer.email', 'customer.email', 'email').toLowerCase(),
      produto_id: pega(p, 'Product.product_id', 'product.id', 'product_id'),
      oferta_id: pega(p, 'Subscription.plan.id', 'Product.product_offer_id', 'Product.offer_id', 'offer_id'), // assinatura: o plano (ex.: ESSENCIAL) vem em Subscription.plan
      pedido_id: pedido,
      assinatura_id: pega(p, 'subscription_id', 'Subscription.id', 'subscription.id'),
      proxima_cobranca: proxima && !isNaN(Date.parse(proxima)) ? new Date(proxima).toISOString() : null,
    };
    n.confiavel = tipo === 'ignorado' || !!(n.email && n.produto_id && n.pedido_id);
    // mesma entrega repetida = mesma chave; renovações do mesmo pedido se diferenciam pela data
    n.chave = pedido
      ? `kiwify:${original}:${pedido}:${pega(p, 'approved_date', 'updated_at') || proxima || ''}`
      : 'kiwify:' + crypto.createHash('sha256').update(corpoBruto).digest('hex');
    return n;
  },
};
