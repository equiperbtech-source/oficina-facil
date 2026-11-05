/* POST /api/equipe/convidar  { loja_id, email, nome, papel }
   Só o dono, com a loja podendo gravar e com vaga no plano. O banco confere de novo (adicionar_funcionario). */
import { configurado, rpc, usuario, convidar, bearer, json, ehUuid, rota, ErroApi } from '../_lib/supa.js';

export async function POST(request) {
  return rota(async () => {
    if (!configurado()) return json(503, { erro: 'Servidor sem SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY configurados.' });
    const token = bearer(request);
    const user = await usuario(token);
    if (!user) return json(401, { erro: 'Faça login novamente.' });

    const b = await request.json().catch(() => null);
    const email = String(b?.email || '').trim().toLowerCase();
    const nome = String(b?.nome || '').trim().slice(0, 80);
    const papel = b?.papel === 'tecnico' ? 'tecnico' : 'atendente';
    if (!ehUuid(b?.loja_id) || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || !nome) throw new ErroApi(400, 'Preencha nome e e-mail válidos.');

    const a = await rpc('minha_assinatura', { p_loja: b.loja_id }, { token });
    if (!a || a.papel !== 'dono') return json(403, { erro: 'Só o dono da loja pode convidar.' });
    if (!a.pode_escrever) return json(403, { erro: 'A loja está em somente leitura. Regularize o plano para convidar.' });
    if (a.funcionarios_ativos >= a.limite_funcionarios) return json(409, { erro: `Limite de ${a.limite_funcionarios} funcionários do plano ${a.plano_nome || ''} atingido. Faça upgrade ou desative alguém.` });

    // link do e-mail volta para o mesmo site que fez o pedido (nunca um endereço vindo do corpo)
    const site = new URL(request.url).origin;
    const { jaExistia } = await convidar(email, nome, site);
    const r = await rpc('adicionar_funcionario', { p_loja: b.loja_id, p_email: email, p_nome: nome }, { token });
    if (papel === 'tecnico') await rpc('definir_papel', { p_loja: b.loja_id, p_user: r.user_id, p_papel: 'tecnico' }, { token });
    return json(200, { ok: true, jaExistia, user_id: r.user_id });
  });
}

export function GET() { return json(405, { erro: 'Use POST.' }); }
