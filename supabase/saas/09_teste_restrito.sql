-- =====================================================================
-- SaaS · Etapa 9: teste grátis sem vitrine e sem notas fiscais
-- Durante o teste grátis a loja usa o plano do teste (Pro), MENOS os recursos da lista
-- "recursos_bloqueados_teste" (padrão: vitrine). Ao assinar, tudo do plano é liberado.
-- A regra fica no banco (tem_recurso): vale para o app, a vitrine pública, os pedidos e as notas.
-- ADITIVA. Reverter: 09_teste_restrito_reverter.sql
-- =====================================================================

insert into public.plataforma_config(chave, valor) values ('recursos_bloqueados_teste', '["vitrine"]'::jsonb)
on conflict (chave) do nothing;

-- recursos que o teste grátis não libera
create or replace function public.bloqueado_no_teste(p_recurso text) returns boolean
  language sql stable security definer set search_path = public as $$
  select coalesce((select valor ? p_recurso from public.plataforma_config where chave = 'recursos_bloqueados_teste'), false)
$$;

create or replace function public.tem_recurso(p_loja uuid, p_recurso text) returns boolean
  language sql stable security definer set search_path = public as $$
  select coalesce((select p_recurso = any(p.recursos) from public.planos p where p.id = public.loja_plano(p_loja)), false)
     and not (public.loja_situacao(p_loja) = 'teste' and public.bloqueado_no_teste(p_recurso))
$$;

-- a assinatura que o app lê: lista só o que está liberado agora e informa o que o teste bloqueia
create or replace function public.minha_assinatura(p_loja uuid) returns jsonb
  language sql stable security definer set search_path = public as $$
  select case when p_loja in (select public.minhas_lojas()) then jsonb_build_object(
    'plano', l.plano_id, 'plano_nome', p.nome, 'plano_efetivo', public.loja_plano(l.id),
    'status', l.status_assinatura, 'situacao', public.loja_situacao(l.id), 'pode_escrever', public.pode_escrever(l.id),
    'recursos', coalesce((select jsonb_agg(r) from public.planos pe, unnest(pe.recursos) r
                           where pe.id = public.loja_plano(l.id) and public.tem_recurso(l.id, r)), '[]'::jsonb),
    'bloqueados_teste', case when public.loja_situacao(l.id) = 'teste'
                          then coalesce((select valor from public.plataforma_config where chave = 'recursos_bloqueados_teste'), '[]'::jsonb)
                          else '[]'::jsonb end,
    'teste_ate', l.teste_ate, 'proxima_cobranca', l.proxima_cobranca, 'periodo_pago_ate', l.periodo_pago_ate,
    'inadimplente_desde', l.inadimplente_desde, 'cortesia_ate', l.cortesia_ate, 'isenta', l.isenta,
    'tolerancia_dias', coalesce((select (valor #>> '{}')::int from public.plataforma_config where chave = 'tolerancia_atraso_dias'), 5),
    'funcionarios_ativos', public.funcionarios_ativos(l.id), 'limite_funcionarios', public.limite_funcionarios(l.id),
    'papel', public.meu_papel(l.id))
  end
  from public.lojas l left join public.planos p on p.id = l.plano_id where l.id = p_loja
$$;

revoke all on function public.bloqueado_no_teste(text) from public, anon;
revoke all on function public.tem_recurso(uuid, text) from public, anon;
revoke all on function public.minha_assinatura(uuid) from public, anon;
grant execute on function public.bloqueado_no_teste(text), public.tem_recurso(uuid, text), public.minha_assinatura(uuid) to authenticated;
