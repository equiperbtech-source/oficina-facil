/* POST /api/admin  { acao, args }  — painel super admin.
   Confere o login e se é super admin; chama a função do banco com o token do próprio admin
   (o banco confere de novo com exigir_admin e grava auditoria). Só ações da lista abaixo. */
import { bancoDiferente, configurado, rpc, usuario, bearer, json, rota, ErroApi } from './_lib/supa.js';

const ACOES = {
  resumo: ['admin_resumo', []],
  lojas: ['admin_lojas', ['p_busca', 'p_plano', 'p_situacao', 'p_ordem', 'p_limite', 'p_offset']],
  loja: ['admin_loja', ['p_loja']],
  eventos: ['admin_eventos', ['p_status', 'p_limite', 'p_offset']],
  produtos: ['admin_produtos', []],
  avisos: ['admin_avisos', []],
  consumo: ['admin_consumo_notas', ['p_mes']],
  auditoria: ['admin_auditoria_lista', ['p_limite', 'p_offset']],
  alterar_plano: ['admin_alterar_plano', ['p_loja', 'p_plano', 'p_motivo']],
  cortesia: ['admin_cortesia', ['p_loja', 'p_dias', 'p_motivo']],
  definir_teste: ['admin_definir_teste', ['p_loja', 'p_dias', 'p_motivo']],
  bloquear: ['admin_bloquear', ['p_loja', 'p_bloquear', 'p_motivo']],
  creditar: ['admin_creditar', ['p_loja', 'p_qtd', 'p_motivo']],
  entrar_como: ['admin_entrar_como', ['p_loja', 'p_motivo']],
  reprocessar: ['admin_reprocessar_evento', ['p_evento']],
  vincular: ['admin_vincular_compra', ['p_evento', 'p_loja', 'p_motivo']],
  salvar_produto: ['admin_salvar_produto', ['p']],
  salvar_plano: ['admin_salvar_plano', ['p_id', 'p_preco', 'p_max', 'p_franquia']],
  config: ['admin_config', ['p_chave', 'p_valor']],
  verificar_dominio: ['admin_verificar_dominio', ['p_dominio', 'p_ok']],
  aviso_lido: ['admin_aviso_lido', ['p_id']],
  comunicados: ['admin_comunicados', []],
  salvar_comunicado: ['admin_salvar_comunicado', ['p_titulo', 'p_mensagem', 'p_idioma']],
  salvar_comunicado2: ['admin_salvar_comunicado2', ['p_titulo', 'p_mensagem', 'p_titulo_es', 'p_mensagem_es']],
  email_plataforma: ['admin_status_email_plataforma', []],
  salvar_email_plataforma: ['admin_email_plataforma', ['p_api_key', 'p_remetente', 'p_ativo']],
  testar_email_plataforma: ['admin_testar_email_plataforma', ['p_para']],
  resultado_email: ['resultado_email', ['p_id']],
  comunicado_ativo: ['admin_comunicado_ativo', ['p_id', 'p_ativo']],
  carrinhos: ['admin_carrinhos', ['p_filtro']],
  duplicadas: ['admin_duplicadas', []],
  unir: ['admin_unir_lojas', ['p_a', 'p_b', 'p_motivo']],
  carrinho_marcar: ['admin_carrinho_marcar', ['p_email', 'p_situacao', 'p_canal']],
};

export async function POST(request) {
  return rota(async () => {
    if (!configurado()) return json(503, { erro: 'Servidor sem configuração do Supabase.' });
    const token = bearer(request);
    if (!(await usuario(token))) {
      const outro = await bancoDiferente(request);
      return json(401, { erro: outro ? 'A variável SUPABASE_URL da Vercel (Production) aponta para outro banco. Use o Project URL do Supabase real e faça Redeploy.' : 'Faça login novamente.' });
    }
    if ((await rpc('sou_super_admin', {}, { token })) !== true) return json(403, { erro: 'Acesso restrito ao administrador.' });
    const b = await request.json().catch(() => null);
    const def = ACOES[b?.acao];
    if (!def) throw new ErroApi(400, 'Ação desconhecida.');
    const [fn, nomes] = def, a = b.args || {};
    const args = Object.fromEntries(nomes.map(n => [n, a[n] === undefined ? null : a[n]]));
    try { return json(200, { ok: true, dados: await rpc(fn, args, { token }) }); }
    catch (e) { if (e instanceof ErroApi && e.status === 400) return json(400, { erro: e.message }); throw e; }
  });
}
export function GET() { return json(405, { erro: 'Use POST.' }); }
