-- Reverte a etapa 16 (comunicados da plataforma). Apaga os comunicados e quem leu.
drop function if exists public.admin_comunicados();
drop function if exists public.admin_salvar_comunicado(text, text, text);
drop function if exists public.admin_comunicado_ativo(bigint, boolean);
drop function if exists public.meus_comunicados(text);
drop function if exists public.marcar_comunicado_lido(bigint);
drop table if exists public.comunicados_lidos;
drop table if exists public.comunicados;
