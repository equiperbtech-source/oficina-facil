-- Reverte a etapa 19: volta ao aviso por e-mail só com a chave de cada loja (etapas anteriores).
create or replace function public.enviar_email_loja(p_loja uuid, p_assunto text, p_html text) returns bigint
  language plpgsql security definer set search_path = public as $$
declare cfg public.lojas_email; dest jsonb; nome text; req bigint;
begin
  select * into cfg from public.lojas_email where loja_id = p_loja and ativo and coalesce(api_key, '') <> '';
  if not found then return null; end if;
  select jsonb_agg(jsonb_build_object('email', m.email)) into dest from public.membros m
   where m.loja_id = p_loja and coalesce(m.email, '') <> '' and m.notificar_pedidos;
  if dest is null then return null; end if;
  select coalesce(s.dados ->> 'loja', l.nome) into nome from public.lojas l
    left join public.itens s on s.loja_id = l.id and s.colecao = 'meta' and s.id = 'settings' where l.id = p_loja;
  select net.http_post(
    url := 'https://api.brevo.com/v3/smtp/email',
    headers := jsonb_build_object('api-key', cfg.api_key, 'Content-Type', 'application/json', 'accept', 'application/json'),
    body := jsonb_build_object('sender', jsonb_build_object('email', cfg.remetente, 'name', coalesce(nome, 'Oficina Simples')), 'to', dest, 'subject', p_assunto, 'htmlContent', p_html),
    timeout_milliseconds := 8000) into req;
  return req;
end $$;
revoke all on function public.enviar_email_loja(uuid, text, text) from public, anon, authenticated;

create or replace function public.status_email(p_loja uuid) returns jsonb
  language sql stable security definer set search_path = public as $$
  select case when p_loja in (select public.minhas_lojas()) then
    coalesce((select jsonb_build_object('configurado', coalesce(api_key, '') <> '', 'remetente', remetente, 'ativo', ativo,
      'chave', case when coalesce(api_key, '') <> '' then '••••' || right(api_key, 4) else '' end) from public.lojas_email where loja_id = p_loja),
      '{"configurado": false}'::jsonb) end
$$;

create or replace function public.avisar_pedido_email() returns trigger
  language plpgsql security definer set search_path = public as $$
declare site text;
begin
  if current_setting('oficina.migrando', true) = '1' then return new; end if;
  select site_url into site from public.lojas_email where loja_id = new.loja_id;
  perform public.enviar_email_loja(new.loja_id,
    'Novo pedido de orçamento: ' || coalesce(new.dados ->> 'modelo', '') || ' · ' || coalesce(new.dados ->> 'nome', '') || case when new.dados ->> 'urgencia' = 'alta' then ' (URGENTE)' else '' end,
    public.html_pedido(new.dados, site));
  return new;
exception when others then
  raise warning 'aviso de pedido por e-mail falhou: %', sqlerrm;
  return new;
end $$;

create or replace function public.testar_email(p_loja uuid) returns bigint
  language plpgsql security definer set search_path = public as $$
declare site text;
begin
  if not public.sou_dono(p_loja) then raise exception 'apenas o dono pode testar'; end if;
  select site_url into site from public.lojas_email where loja_id = p_loja;
  return public.enviar_email_loja(p_loja, 'Teste: avisos de pedido de orçamento funcionando ✅',
    public.html_pedido(jsonb_build_object('numero', 0, 'nome', 'Cliente de teste', 'telefone', '48999999999', 'marca', 'Apple', 'modelo', 'iPhone 13', 'defeito', 'Este é um e-mail de teste do aviso de pedidos.', 'urgencia', 'media'), site));
end $$;

create or replace function public.avisar_pedido_vitrine_email() returns trigger
  language plpgsql security definer set search_path = public as $$
declare site text; idi text;
begin
  if current_setting('oficina.migrando', true) = '1' then return new; end if;
  select site_url into site from public.lojas_email where loja_id = new.loja_id;
  select coalesce(t.idioma, 'pt') into idi from public.lojas_tema t where t.loja_id = new.loja_id;
  perform public.enviar_email_loja(new.loja_id,
    case when idi = 'es' then 'Nuevo pedido de la vitrina' else 'Novo pedido da vitrine' end
      || coalesce(' nº ' || (new.dados ->> 'numero'), '') || ' · ' || coalesce(new.dados ->> 'nome', ''),
    public.html_pedido_vitrine(new.dados, site, coalesce(idi, 'pt')));
  return new;
exception when others then
  raise warning 'aviso de pedido da vitrine por e-mail falhou: %', sqlerrm;
  return new;
end $$;

drop function if exists public.admin_testar_email_plataforma(text);
drop function if exists public.admin_status_email_plataforma();
drop function if exists public.admin_email_plataforma(text, text, boolean);
drop function if exists public.site_da_loja(uuid);
drop table if exists public.plataforma_email;
