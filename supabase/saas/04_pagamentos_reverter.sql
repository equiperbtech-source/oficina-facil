-- Reverte a etapa 4 (apaga o histórico de eventos de pagamento e o mapeamento de produtos; os planos das lojas ficam como estão)
drop trigger if exists membros_aplicar_pendentes on public.membros;
drop function if exists public.aplicar_pendentes_do_email();
drop function if exists public.checkout_planos();
drop function if exists public.aplicar_evento_pagamento(bigint);
drop function if exists public.loja_do_evento(public.kiwify_eventos);
drop function if exists public.registrar_evento_pagamento(boolean, jsonb, jsonb);
drop table if exists public.plataforma_avisos;
drop table if exists public.kiwify_eventos;
drop table if exists public.kiwify_produtos;
delete from public.plataforma_config where chave in ('kiwify_area_cliente_url', 'checkout_param_email');
drop index if exists public.lojas_assinatura_externa_idx;
alter table public.lojas drop column if exists comprador_email, drop column if exists assinatura_externa_id;
