-- Reverte a etapa 27: tira a aba de carrinhos abandonados do banco (os avisos continuam em kiwify_eventos).
drop function if exists public.admin_carrinho_marcar(text, text, text);
drop function if exists public.admin_carrinhos(text);
drop table if exists public.carrinhos_contato;
