-- Reverte os pedidos da vitrine (os pedidos já recebidos continuam guardados em itens)
drop function if exists public.criar_pedido_vitrine(text, text, text, text, text, jsonb, text);
