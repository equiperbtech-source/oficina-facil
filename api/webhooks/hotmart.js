/* POST /api/webhooks/hotmart  (cabeçalho X-HOTMART-HOTTOK = Hottok da conta, em HOTMART_HOTTOK)
   Mesmo caminho da Kiwify: valida, grava o evento (com a origem "hotmart") e aplica as regras no banco.
   Regras comuns em _lib/pagamento.js. */
import { json, rota } from '../_lib/supa.js';
import { receberWebhook } from '../_lib/pagamento.js';

export async function POST(request) { return rota(() => receberWebhook(request, 'hotmart')); }
export function GET() { return json(405, { erro: 'Use POST.' }); }
