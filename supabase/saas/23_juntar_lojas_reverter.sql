-- Reverte a etapa 23 (só remove as funções; lojas já juntadas continuam juntas).
drop function if exists public.juntar_lojas_por_nome(text);
drop function if exists public.juntar_lojas(uuid, uuid);
