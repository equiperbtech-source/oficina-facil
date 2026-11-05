-- Reverte a etapa 18: pedido da vitrine deixa de mandar e-mail (continua aparecendo no app).
drop trigger if exists itens_avisar_pedido_vitrine on public.itens;
drop function if exists public.avisar_pedido_vitrine_email();
drop function if exists public.html_pedido_vitrine(jsonb, text, text);
