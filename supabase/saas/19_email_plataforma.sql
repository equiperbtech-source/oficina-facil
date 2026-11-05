-- =====================================================================
-- SaaS · Etapa 19: aviso de pedidos por e-mail ligado em todas as lojas pela chave da plataforma.
-- O admin cadastra UMA chave do Brevo (/admin → Produtos e planos → E-mail da plataforma). Toda loja sem
-- chave própria passa a receber os avisos (pedido de orçamento e vitrine) por ela, com o nome da loja como
-- remetente. Loja com chave própria continua usando a dela; loja que pausou ("Enviar avisos" desmarcado) não recebe.
-- O botão "Abrir no app" do e-mail usa o endereço da loja (<nome>.<dominio>) quando ela não salvou outro.
-- ADITIVA (tabela nova e funções novas/atualizadas). Reverter: 19_email_plataforma_reverter.sql
-- =====================================================================

create table if not exists public.plataforma_email (
  id boolean primary key default true check (id),
  api_key text,
  remetente text,
  ativo boolean not null default true,
  atualizado_em timestamptz not null default now()
);
alter table public.plataforma_email enable row level security;
revoke all on public.plataforma_email from anon, authenticated;

-- endereço do app da loja para o botão do e-mail
create or replace function public.site_da_loja(p_loja uuid) returns text
  language sql stable security definer set search_path = public as $$
  select coalesce(
    nullif((select site_url from public.lojas_email where loja_id = p_loja), ''),
    (select 'https://' || l.slug || '.' || b.base from public.lojas l,
       lateral (select jsonb_array_elements_text(valor) as base from public.plataforma_config where chave = 'dominios_base' limit 1) b
      where l.id = p_loja and coalesce(l.slug, '') <> ''),
    (select 'https://app.' || b.base from (select jsonb_array_elements_text(valor) as base from public.plataforma_config where chave = 'dominios_base' limit 1) b))
$$;

-- envio: chave da loja → senão chave da plataforma (se a loja não pausou)
create or replace function public.enviar_email_loja(p_loja uuid, p_assunto text, p_html text) returns bigint
  language plpgsql security definer set search_path = public as $$
declare cfg public.lojas_email; pl public.plataforma_email; chave text; rem text; dest jsonb; nome text; req bigint;
begin
  select * into cfg from public.lojas_email where loja_id = p_loja;
  if found and not cfg.ativo then return null; end if;                              -- loja pausou
  if found and coalesce(cfg.api_key, '') <> '' then chave := cfg.api_key; rem := cfg.remetente;
  else
    select * into pl from public.plataforma_email where id and ativo and coalesce(api_key, '') <> '';
    if not found then return null; end if;
    chave := pl.api_key; rem := pl.remetente;
  end if;
  select jsonb_agg(jsonb_build_object('email', m.email)) into dest from public.membros m
   where m.loja_id = p_loja and coalesce(m.email, '') <> '' and m.notificar_pedidos and coalesce(m.ativo, true);
  if dest is null then return null; end if;
  select coalesce(nullif(s.dados ->> 'loja', ''), l.nome) into nome from public.lojas l
    left join public.itens s on s.loja_id = l.id and s.colecao = 'meta' and s.id = 'settings' where l.id = p_loja;
  select net.http_post(
    url := 'https://api.brevo.com/v3/smtp/email',
    headers := jsonb_build_object('api-key', chave, 'Content-Type', 'application/json', 'accept', 'application/json'),
    body := jsonb_build_object('sender', jsonb_build_object('email', rem, 'name', coalesce(nome, 'Oficina Simples')), 'to', dest, 'subject', p_assunto, 'htmlContent', p_html),
    timeout_milliseconds := 8000) into req;
  return req;
end $$;
revoke all on function public.enviar_email_loja(uuid, text, text) from public, anon, authenticated;

create or replace function public.status_email(p_loja uuid) returns jsonb
  language sql stable security definer set search_path = public as $$
  select case when p_loja in (select public.minhas_lojas()) then
    jsonb_build_object(
      'configurado', coalesce(e.api_key, '') <> '',
      'remetente', e.remetente,
      'ativo', coalesce(e.ativo, true),
      'chave', case when coalesce(e.api_key, '') <> '' then '••••' || right(e.api_key, 4) else '' end,
      'plataforma', coalesce(e.api_key, '') = '' and exists (select 1 from public.plataforma_email p where p.id and p.ativo and coalesce(p.api_key, '') <> ''))
  end
  from (select 1) x left join public.lojas_email e on e.loja_id = p_loja
$$;

-- gatilhos e teste com o endereço da loja
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

-- ---------- Admin ----------
create or replace function public.admin_email_plataforma(p_api_key text, p_remetente text, p_ativo boolean) returns jsonb
  language plpgsql security definer set search_path = public as $$
begin
  perform public.exigir_admin();
  if coalesce(trim(p_api_key), '') <> '' and trim(p_api_key) !~ '^xkeysib-' then raise exception 'A chave do Brevo começa com xkeysib-'; end if;
  if coalesce(trim(p_remetente), '') !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Informe o e-mail remetente confirmado no Brevo'; end if;
  insert into public.plataforma_email(id, api_key, remetente, ativo) values (true, nullif(trim(p_api_key), ''), lower(trim(p_remetente)), p_ativo)
  on conflict (id) do update set api_key = coalesce(nullif(trim(excluded.api_key), ''), public.plataforma_email.api_key),
    remetente = excluded.remetente, ativo = excluded.ativo, atualizado_em = now();
  perform public.auditar('email_plataforma', null, null, jsonb_build_object('remetente', lower(trim(p_remetente)), 'ativo', p_ativo, 'trocou_chave', coalesce(trim(p_api_key), '') <> ''), null);
  return public.admin_status_email_plataforma();
end $$;

create or replace function public.admin_status_email_plataforma() returns jsonb
  language plpgsql stable security definer set search_path = public as $$
begin
  perform public.exigir_admin();
  return coalesce((select jsonb_build_object('configurado', coalesce(api_key, '') <> '', 'remetente', remetente, 'ativo', ativo,
      'chave', case when coalesce(api_key, '') <> '' then '••••' || right(api_key, 4) else '' end,
      'lojas_proprias', (select count(*) from public.lojas_email where coalesce(api_key, '') <> ''),
      'lojas_pausadas', (select count(*) from public.lojas_email where not ativo))
    from public.plataforma_email where id), '{"configurado": false}'::jsonb);
end $$;

create or replace function public.admin_testar_email_plataforma(p_para text) returns bigint
  language plpgsql security definer set search_path = public as $$
declare pl public.plataforma_email; req bigint;
begin
  perform public.exigir_admin();
  select * into pl from public.plataforma_email where id and coalesce(api_key, '') <> '';
  if not found then raise exception 'Salve a chave primeiro'; end if;
  select net.http_post(url := 'https://api.brevo.com/v3/smtp/email',
    headers := jsonb_build_object('api-key', pl.api_key, 'Content-Type', 'application/json', 'accept', 'application/json'),
    body := jsonb_build_object('sender', jsonb_build_object('email', pl.remetente, 'name', 'Oficina Simples'), 'to', jsonb_build_array(jsonb_build_object('email', p_para)),
      'subject', 'Teste: e-mail da plataforma funcionando ✅', 'htmlContent', '<p>Os avisos de pedido das lojas vão sair por esta conta do Brevo.</p>'),
    timeout_milliseconds := 8000) into req;
  return req;
end $$;

revoke all on function public.site_da_loja(uuid), public.admin_email_plataforma(text, text, boolean), public.admin_status_email_plataforma(), public.admin_testar_email_plataforma(text) from public, anon;
grant execute on function public.admin_email_plataforma(text, text, boolean), public.admin_status_email_plataforma(), public.admin_testar_email_plataforma(text) to authenticated;
revoke all on function public.site_da_loja(uuid) from authenticated;
