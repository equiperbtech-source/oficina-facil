/* POST /api/webhooks/kiwify?signature=...
   Única fonte (junto com /api/webhooks/hotmart) que altera plano e situação da assinatura.
   Regras comuns em _lib/pagamento.js. */
import { json, rota } from '../_lib/supa.js';
import { receberWebhook } from '../_lib/pagamento.js';

export async function POST(request) { return rota(() => receberWebhook(request, 'kiwify')); }
export function GET() { return json(405, { erro: 'Use POST.' }); }
