-- Reverte a etapa 1 (remove só o que a etapa 1 criou; nenhum dado da loja é tocado)
drop trigger if exists itens_avisar_os_publica on public.itens;
drop function if exists public.avisar_os_publica();
drop function if exists public.definir_slug(uuid, text);
drop function if exists public.loja_por_slug(text);
drop function if exists public.loja_publica(text, text);
drop function if exists public.loja_por_host(text);
drop table if exists public.lojas_dominios;
alter table public.lojas drop constraint if exists lojas_slug_formato;
drop index if exists public.lojas_slug_unico;
alter table public.lojas drop column if exists slug;
drop table if exists public.plataforma_config;
