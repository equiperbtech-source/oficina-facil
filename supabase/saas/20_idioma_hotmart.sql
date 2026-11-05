-- =====================================================================
-- SaaS · Etapa 20: idioma da loja para o cliente final e para os e-mails.
-- Loja que assina pela Hotmart = espanhol; as demais seguem o idioma da loja (Configurações, ou o PT/ES
-- que o dono escolhe no topo do app). Vale para vitrine, pedido de orçamento, acompanhamento do reparo e
-- os e-mails de aviso (orçamento e vitrine), que agora também têm versão em espanhol.
-- ADITIVA (funções novas e atualizadas). Reverter: 20_idioma_hotmart_reverter.sql
-- =====================================================================

create or replace function public.idioma_da_loja(p_loja uuid) returns text
  language sql stable security definer set search_path = public as $$
  select coalesce((select case when l.provedor_pagamento = 'hotmart' or t.idioma = 'es' then 'es' else 'pt' end
    from public.lojas l left join public.lojas_tema t on t.loja_id = l.id where l.id = p_loja), 'pt')
$$;

-- páginas do cliente: idioma sem depender de a loja ter personalizado a aparência
create or replace function public.idioma_por_os(p_token text) returns text
  language sql stable security definer set search_path = public as $$
  select public.idioma_da_loja(o.loja_id) from public.itens o
   where o.colecao = 'os' and length(p_token) >= 16 and o.dados ->> 'token' = p_token limit 1
$$;

create or replace function public.tema_publico(p_loja uuid) returns jsonb
  language sql stable security definer set search_path = public as $$
  select (to_jsonb(t) - 'loja_id' - 'atualizado_em') || jsonb_build_object('idioma', public.idioma_da_loja(p_loja))
    from public.lojas_tema t where t.loja_id = p_loja
$$;

-- e-mail do pedido de orçamento em português ou espanhol
create or replace function public.html_pedido(d jsonb, site text, idioma text) returns text language sql immutable as $$
  select case when idioma = 'es' then
    '<div style="font-family:Arial,sans-serif;background:#000;color:#fff;padding:24px;border-radius:12px;max-width:560px">'
    || '<div style="color:#d4af37;font-size:20px;font-weight:bold;margin-bottom:6px">Nueva solicitud de presupuesto' || coalesce(' nº ' || (d ->> 'numero'), '') || '</div>'
    || '<div style="color:#aaa;font-size:13px;margin-bottom:16px">Enviada por el cliente desde el enlace del sitio</div>'
    || '<table style="width:100%;font-size:15px;color:#fff;border-collapse:collapse">'
    || '<tr><td style="color:#aaa;padding:6px 0">Cliente</td><td><b>' || public.esc_html(d ->> 'nome') || '</b></td></tr>'
    || '<tr><td style="color:#aaa;padding:6px 0">WhatsApp</td><td><a style="color:#d4af37" href="https://wa.me/' || public.esc_html(d ->> 'telefone') || '">' || public.esc_html(d ->> 'telefone') || '</a></td></tr>'
    || '<tr><td style="color:#aaa;padding:6px 0">Equipo</td><td>' || public.esc_html(d ->> 'marca') || ' · <b>' || public.esc_html(d ->> 'modelo') || '</b></td></tr>'
    || '<tr><td style="color:#aaa;padding:6px 0">Urgencia</td><td><b style="color:' || case d ->> 'urgencia' when 'alta' then '#f87171">URGENTE' when 'baixa' then '#60a5fa">Baja' else '#fb923c">Media' end || '</b></td></tr>'
    || '</table><div style="margin-top:14px;padding:12px;background:#151515;border-radius:8px;color:#ddd">' || public.esc_html(d ->> 'defeito') || '</div>'
    || case when coalesce(site, '') <> '' then '<a href="' || public.esc_html(site) || '/#/os?tab=pedidos" style="display:inline-block;margin-top:18px;background:#d4af37;color:#000;padding:12px 20px;border-radius:8px;font-weight:bold;text-decoration:none">Abrir en la app</a>' else '' end
    || '</div>'
  else public.html_pedido(d, site) end
$$;

create or replace function public.avisar_pedido_email() returns trigger
  language plpgsql security definer set search_path = public as $$
declare idi text;
begin
  if current_setting('oficina.migrando', true) = '1' then return new; end if;
  idi := public.idioma_da_loja(new.loja_id);
  perform public.enviar_email_loja(new.loja_id,
    case when idi = 'es' then 'Nueva solicitud de presupuesto: ' else 'Novo pedido de orçamento: ' end
      || coalesce(new.dados ->> 'modelo', '') || ' · ' || coalesce(new.dados ->> 'nome', '') || case when new.dados ->> 'urgencia' = 'alta' then ' (URGENTE)' else '' end,
    public.html_pedido(new.dados, public.site_da_loja(new.loja_id), idi));
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

create or replace function public.testar_email(p_loja uuid) returns bigint
  language plpgsql security definer set search_path = public as $$
declare idi text := public.idioma_da_loja(p_loja);
begin
  if not public.sou_dono(p_loja) then raise exception 'apenas o dono pode testar'; end if;
  return public.enviar_email_loja(p_loja,
    case when idi = 'es' then 'Prueba: avisos de pedidos funcionando ✅' else 'Teste: avisos de pedido de orçamento funcionando ✅' end,
    public.html_pedido(jsonb_build_object('numero', 0, 'nome', case when idi = 'es' then 'Cliente de prueba' else 'Cliente de teste' end,
      'telefone', case when idi = 'es' then '56912345678' else '48999999999' end, 'marca', 'Apple', 'modelo', 'iPhone 13',
      'defeito', case when idi = 'es' then 'Este es un correo de prueba del aviso de pedidos.' else 'Este é um e-mail de teste do aviso de pedidos.' end, 'urgencia', 'media'),
      public.site_da_loja(p_loja), idi));
end $$;

revoke all on function public.html_pedido(jsonb, text, text) from public, anon, authenticated;
revoke all on function public.idioma_da_loja(uuid), public.idioma_por_os(text) from public;
grant execute on function public.idioma_da_loja(uuid), public.idioma_por_os(text) to anon, authenticated;
