-- Reverte a etapa 21: e-mail da vitrine volta a formatar o total pelo idioma (etapa 20).
create or replace function public.avisar_pedido_vitrine_email() returns trigger
  language plpgsql security definer set search_path = public as $$
declare idi text;
begin
  if current_setting('oficina.migrando', true) = '1' then return new; end if;
  idi := public.idioma_da_loja(new.loja_id);
  perform public.enviar_email_loja(new.loja_id,
    case when idi = 'es' then 'Nuevo pedido de la vitrina' else 'Novo pedido da vitrine' end
      || coalesce(' nº ' || (new.dados ->> 'numero'), '') || ' · ' || coalesce(new.dados ->> 'nome', ''),
    public.html_pedido_vitrine(new.dados, public.site_da_loja(new.loja_id), idi));
  return new;
exception when others then
  raise warning 'aviso de pedido da vitrine por e-mail falhou: %', sqlerrm;
  return new;
end $$;

drop function if exists public.html_pedido_vitrine(jsonb, text, text, text);
drop function if exists public.moeda_por_os(text);
drop function if exists public.moeda_da_loja(uuid);
