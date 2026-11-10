-- Reverte a etapa 9: o teste grátis volta a liberar tudo do plano do teste (definições da etapa 2)
create or replace function public.tem_recurso(p_loja uuid, p_recurso text) returns boolean
  language sql stable security definer set search_path = public as $$
  select coalesce((select p_recurso = any(p.recursos) from public.planos p where p.id = public.loja_plano(p_loja)), false)
$$;

create or replace function public.minha_assinatura(p_loja uuid) returns jsonb
  language sql stable security definer set search_path = public as $$
  select case when p_loja in (select public.minhas_lojas()) then jsonb_build_object(
    'plano', l.plano_id, 'plano_nome', p.nome, 'plano_efetivo', public.loja_plano(l.id),
    'status', l.status_assinatura, 'situacao', public.loja_situacao(l.id), 'pode_escrever', public.pode_escrever(l.id),
    'recursos', coalesce((select to_jsonb(pe.recursos) from public.planos pe where pe.id = public.loja_plano(l.id)), '[]'::jsonb),
    'teste_ate', l.teste_ate, 'proxima_cobranca', l.proxima_cobranca, 'periodo_pago_ate', l.periodo_pago_ate,
    'inadimplente_desde', l.inadimplente_desde, 'cortesia_ate', l.cortesia_ate, 'isenta', l.isenta,
    'tolerancia_dias', coalesce((select (valor #>> '{}')::int from public.plataforma_config where chave = 'tolerancia_atraso_dias'), 5),
    'funcionarios_ativos', public.funcionarios_ativos(l.id), 'limite_funcionarios', public.limite_funcionarios(l.id),
    'papel', public.meu_papel(l.id))
  end
  from public.lojas l left join public.planos p on p.id = l.plano_id where l.id = p_loja
$$;

drop function if exists public.bloqueado_no_teste(text);
delete from public.plataforma_config where chave = 'recursos_bloqueados_teste';
