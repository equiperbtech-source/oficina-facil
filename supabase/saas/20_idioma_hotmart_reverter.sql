-- Reverte a etapa 20: e-mails só em português e idioma só pela configuração da loja (etapas anteriores).
create or replace function public.tema_publico(p_loja uuid) returns jsonb
  language sql stable security definer set search_path = public as $$
  select to_jsonb(t) - 'loja_id' - 'atualizado_em' from public.lojas_tema t where t.loja_id = p_loja
$$;

create or replace function public.avisar_pedido_email() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if current_setting('oficina.migrando', true) = '1' then return new; end if;
  perform public.enviar_email_loja(new.loja_id,
    'Novo pedido de orçamento: ' || coalesce(new.dados ->> 'modelo', '') || ' · ' || coalesce(new.dados ->> 'nome', '') || case when new.dados ->> 'urgencia' = 'alta' then ' (URGENTE)' else '' end,
    public.html_pedido(new.dados, public.site_da_loja(new.loja_id)));
  return new;
exception when others then
  raise warning 'aviso de pedido por e-mail falhou: %', sqlerrm;
  return new;
end $$;

create or replace function public.avisar_pedido_vitrine_email() returns trigger
  language plpgsql security definer set search_path = public as $$
declare idi text;
begin
  if current_setting('oficina.migrando', true) = '1' then return new; end if;
  select coalesce(t.idioma, 'pt') into idi from public.lojas_tema t where t.loja_id = new.loja_id;
  perform public.enviar_email_loja(new.loja_id,
    case when idi = 'es' then 'Nuevo pedido de la vitrina' else 'Novo pedido da vitrine' end
      || coalesce(' nº ' || (new.dados ->> 'numero'), '') || ' · ' || coalesce(new.dados ->> 'nome', ''),
    public.html_pedido_vitrine(new.dados, public.site_da_loja(new.loja_id), coalesce(idi, 'pt')));
  return new;
exception when others then
  raise warning 'aviso de pedido da vitrine por e-mail falhou: %', sqlerrm;
  return new;
end $$;

create or replace function public.testar_email(p_loja uuid) returns bigint
  language plpgsql security definer set search_path = public as $$
begin
  if not public.sou_dono(p_loja) then raise exception 'apenas o dono pode testar'; end if;
  return public.enviar_email_loja(p_loja, 'Teste: avisos de pedido de orçamento funcionando ✅',
    public.html_pedido(jsonb_build_object('numero', 0, 'nome', 'Cliente de teste', 'telefone', '48999999999', 'marca', 'Apple', 'modelo', 'iPhone 13', 'defeito', 'Este é um e-mail de teste do aviso de pedidos.', 'urgencia', 'media'), public.site_da_loja(p_loja)));
end $$;

drop function if exists public.html_pedido(jsonb, text, text);
drop function if exists public.idioma_por_os(text);
drop function if exists public.idioma_da_loja(uuid);
