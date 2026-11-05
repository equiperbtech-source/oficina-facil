-- Reverte a etapa 17: volta ao comunicado de uma versão só (a etapa 16 continua).
-- Comunicados só com a versão em espanhol são apagados (não cabem na regra antiga).
drop function if exists public.meus_comunicados(text, uuid);
drop function if exists public.versao_comunicado(uuid, text);
drop function if exists public.admin_salvar_comunicado2(text, text, text, text);
delete from public.comunicados where length(trim(mensagem)) = 0;
alter table public.comunicados drop constraint if exists comunicados_texto_ok;
alter table public.comunicados add constraint comunicados_mensagem_check check (length(trim(mensagem)) > 0 and length(mensagem) <= 4000);
alter table public.comunicados drop column if exists titulo_es;
alter table public.comunicados drop column if exists mensagem_es;
create or replace function public.admin_comunicados() returns jsonb
  language plpgsql stable security definer set search_path = public as $$
begin
  perform public.exigir_admin();
  return coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'titulo', c.titulo, 'mensagem', c.mensagem, 'idioma', c.idioma,
      'ativo', c.ativo, 'criado_em', c.criado_em, 'lidos', (select count(*) from public.comunicados_lidos l where l.comunicado_id = c.id))
    order by c.criado_em desc) from public.comunicados c), '[]'::jsonb);
end $$;
