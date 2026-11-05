-- Reverte a etapa 13 (o sistema volta a ficar só em português para as páginas do cliente)
drop function if exists public.definir_idioma(uuid, text);
alter table public.lojas_tema drop constraint if exists lojas_tema_idioma_ok;
alter table public.lojas_tema drop column if exists idioma;
