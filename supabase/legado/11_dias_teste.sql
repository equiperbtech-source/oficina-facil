-- =====================================================================
-- SaaS · Etapa 11: dias de teste grátis pelo painel /admin
-- "Dias de teste": define quantos dias de teste a loja ainda tem (aumenta OU diminui; 0 = encerra agora).
--   A loja continua EM TESTE: aviso no topo e sem vitrine/notas. Tira a cortesia, se houver.
-- "Cortesia" (já existia) continua sendo acesso COMPLETO grátis, como se a loja tivesse pago.
-- ADITIVA. Reverter: 11_dias_teste_reverter.sql
-- =====================================================================

create or replace function public.admin_definir_teste(p_loja uuid, p_dias int, p_motivo text) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare antes jsonb := public.admin_estado(p_loja); l public.lojas;
begin
  perform public.exigir_admin();
  if p_dias is null or p_dias < 0 or p_dias > 90 then raise exception 'dias de teste inválidos (0 a 90)'; end if;
  select * into l from public.lojas where id = p_loja;
  if not found then raise exception 'loja não encontrada'; end if;
  if l.isenta then raise exception 'loja isenta não tem teste'; end if;
  if l.status_assinatura = 'bloqueada' then raise exception 'loja bloqueada: desbloqueie antes'; end if;
  if l.status_assinatura in ('ativa', 'inadimplente') and l.assinatura_externa_id is not null and coalesce(l.periodo_pago_ate, l.proxima_cobranca) > now() then
    raise exception 'esta loja tem assinatura paga: use "Alterar plano" ou "Cortesia"';
  end if;
  update public.lojas set status_assinatura = 'teste', teste_ate = now() + make_interval(days => p_dias), cortesia_ate = null,
    plano_id = coalesce(plano_id, 'pro'), inadimplente_desde = null, assinatura_atualizada_em = now()
   where id = p_loja;
  perform public.auditar('dias_teste', p_loja, antes, public.admin_estado(p_loja), p_motivo);
  return public.admin_estado(p_loja);
end $$;
revoke all on function public.admin_definir_teste(uuid, int, text) from public, anon;
grant execute on function public.admin_definir_teste(uuid, int, text) to authenticated;
