-- Reverter da 28 (tema claro): volta os e-mails e a aparência padrão ao preto e dourado do sistema original.
-- As oficinas que já estão com o azul padrão continuam com ele (não dá para saber quem escolheu de propósito).
-- Seguro rodar de novo.
alter table public.lojas_tema
  alter column cor_primaria set default '#d4af37',
  alter column cor_secundaria set default '#b8860b',
  alter column cor_fundo set default '#000000';

create or replace function public.html_pedido(d jsonb, site text) returns text language sql immutable as $$
  select '<div style="font-family:Arial,sans-serif;background:#000;color:#fff;padding:24px;border-radius:12px;max-width:560px">'
    || '<div style="color:#d4af37;font-size:20px;font-weight:bold;margin-bottom:6px">Novo pedido de orçamento' || coalesce(' nº ' || (d ->> 'numero'), '') || '</div>'
    || '<div style="color:#aaa;font-size:13px;margin-bottom:16px">Enviado pelo cliente pelo link do site</div>'
    || '<table style="width:100%;font-size:15px;color:#fff;border-collapse:collapse">'
    || '<tr><td style="color:#aaa;padding:6px 0">Cliente</td><td><b>' || esc_html(d ->> 'nome') || '</b></td></tr>'
    || '<tr><td style="color:#aaa;padding:6px 0">WhatsApp</td><td><a style="color:#d4af37" href="https://wa.me/55' || esc_html(d ->> 'telefone') || '">' || esc_html(d ->> 'telefone') || '</a></td></tr>'
    || '<tr><td style="color:#aaa;padding:6px 0">Aparelho</td><td>' || esc_html(d ->> 'marca') || ' · <b>' || esc_html(d ->> 'modelo') || '</b></td></tr>'
    || '<tr><td style="color:#aaa;padding:6px 0">Urgência</td><td><b style="color:' || case d ->> 'urgencia' when 'alta' then '#f87171">URGENTE' when 'baixa' then '#60a5fa">Baixa' else '#fb923c">Média' end || '</b></td></tr>'
    || '</table><div style="margin-top:14px;padding:12px;background:#151515;border-radius:8px;color:#ddd">' || esc_html(d ->> 'defeito') || '</div>'
    || case when coalesce(site, '') <> '' then '<a href="' || esc_html(site) || '/#/os?tab=pedidos" style="display:inline-block;margin-top:18px;background:#d4af37;color:#000;padding:12px 20px;border-radius:8px;font-weight:bold;text-decoration:none">Abrir no app</a>' else '' end
    || '</div>'
$$;

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

create or replace function public.html_pedido_vitrine(d jsonb, site text, idioma text) returns text language plpgsql immutable as $$
declare es boolean := idioma = 'es'; linhas text := ''; it jsonb; ret text; tot numeric := coalesce(public.num_seguro(d ->> 'total'), 0);
  fmt_total text;
begin
  for it in select * from jsonb_array_elements(coalesce(d -> 'itens', '[]'::jsonb)) loop
    linhas := linhas || '<tr><td style="padding:6px 0;color:#fff">' || coalesce(it ->> 'qtd', '1') || 'x ' || public.esc_html(it ->> 'nome') || '</td></tr>';
  end loop;
  begin
    ret := to_char((d ->> 'retirada')::timestamptz at time zone case when es then 'America/Santiago' else 'America/Sao_Paulo' end, 'DD/MM/YYYY HH24:MI');
  exception when others then ret := coalesce(d ->> 'retirada', '');
  end;
  fmt_total := case when es then '$ ' || replace(to_char(tot, 'FM999G999G999'), ',', '.')
                    else 'R$ ' || replace(replace(replace(to_char(tot, 'FM999G999G990D00'), ',', '#'), '.', ','), '#', '.') end;
  return '<div style="font-family:Arial,sans-serif;background:#000;color:#fff;padding:24px;border-radius:12px;max-width:560px">'
    || '<div style="color:#d4af37;font-size:20px;font-weight:bold;margin-bottom:6px">' || case when es then 'Nuevo pedido de la vitrina' else 'Novo pedido da vitrine' end || coalesce(' nº ' || (d ->> 'numero'), '') || '</div>'
    || '<div style="color:#aaa;font-size:13px;margin-bottom:16px">' || case when es then 'El cliente compró por la vitrina online' else 'O cliente comprou pela vitrine online' end || '</div>'
    || '<table style="width:100%;font-size:15px;color:#fff;border-collapse:collapse">'
    || '<tr><td style="color:#aaa;padding:6px 0">' || case when es then 'Cliente' else 'Cliente' end || '</td><td><b>' || public.esc_html(d ->> 'nome') || '</b></td></tr>'
    || '<tr><td style="color:#aaa;padding:6px 0">WhatsApp</td><td><a style="color:#d4af37" href="https://wa.me/' || case when es then '' else '55' end || public.esc_html(d ->> 'telefone') || '">' || public.esc_html(d ->> 'telefone') || '</a></td></tr>'
    || '<tr><td style="color:#aaa;padding:6px 0">' || case when es then 'Retiro' else 'Retirada' end || '</td><td><b>' || public.esc_html(ret) || '</b></td></tr>'
    || '<tr><td style="color:#aaa;padding:6px 0">Total</td><td><b style="color:#d4af37">' || fmt_total || '</b></td></tr>'
    || '</table><table style="width:100%;margin-top:14px;padding:12px;background:#151515;border-radius:8px;font-size:15px">' || linhas || '</table>'
    || case when coalesce(d ->> 'obs', '') <> '' then '<div style="margin-top:10px;color:#ddd">' || case when es then 'Observación: ' else 'Observação: ' end || public.esc_html(d ->> 'obs') || '</div>' else '' end
    || case when coalesce(site, '') <> '' then '<a href="' || public.esc_html(site) || '/#/vitrine" style="display:inline-block;margin-top:18px;background:#d4af37;color:#000;padding:12px 20px;border-radius:8px;font-weight:bold;text-decoration:none">'
         || case when es then 'Abrir en la app' else 'Abrir no app' end || '</a>' else '' end
    || '</div>';
end $$;

create or replace function public.html_pedido_vitrine(d jsonb, site text, idioma text, moeda text) returns text language plpgsql immutable as $$
declare es boolean := idioma = 'es'; linhas text := ''; it jsonb; ret text; tot numeric := coalesce(public.num_seguro(d ->> 'total'), 0);
  fmt_total text;
begin
  for it in select * from jsonb_array_elements(coalesce(d -> 'itens', '[]'::jsonb)) loop
    linhas := linhas || '<tr><td style="padding:6px 0;color:#fff">' || coalesce(it ->> 'qtd', '1') || 'x ' || public.esc_html(it ->> 'nome') || '</td></tr>';
  end loop;
  begin
    ret := to_char((d ->> 'retirada')::timestamptz at time zone case when es then 'America/Santiago' else 'America/Sao_Paulo' end, 'DD/MM/YYYY HH24:MI');
  exception when others then ret := coalesce(d ->> 'retirada', '');
  end;
  fmt_total := case when moeda = 'CLP' then '$ ' || replace(to_char(round(tot), 'FM999G999G999'), ',', '.')
                    else 'R$ ' || replace(replace(replace(to_char(tot, 'FM999G999G990D00'), ',', '#'), '.', ','), '#', '.') end;
  return '<div style="font-family:Arial,sans-serif;background:#000;color:#fff;padding:24px;border-radius:12px;max-width:560px">'
    || '<div style="color:#d4af37;font-size:20px;font-weight:bold;margin-bottom:6px">' || case when es then 'Nuevo pedido de la vitrina' else 'Novo pedido da vitrine' end || coalesce(' nº ' || (d ->> 'numero'), '') || '</div>'
    || '<div style="color:#aaa;font-size:13px;margin-bottom:16px">' || case when es then 'El cliente compró por la vitrina online' else 'O cliente comprou pela vitrine online' end || '</div>'
    || '<table style="width:100%;font-size:15px;color:#fff;border-collapse:collapse">'
    || '<tr><td style="color:#aaa;padding:6px 0">' || case when es then 'Cliente' else 'Cliente' end || '</td><td><b>' || public.esc_html(d ->> 'nome') || '</b></td></tr>'
    || '<tr><td style="color:#aaa;padding:6px 0">WhatsApp</td><td><a style="color:#d4af37" href="https://wa.me/' || case when es then '' else '55' end || public.esc_html(d ->> 'telefone') || '">' || public.esc_html(d ->> 'telefone') || '</a></td></tr>'
    || '<tr><td style="color:#aaa;padding:6px 0">' || case when es then 'Retiro' else 'Retirada' end || '</td><td><b>' || public.esc_html(ret) || '</b></td></tr>'
    || '<tr><td style="color:#aaa;padding:6px 0">Total</td><td><b style="color:#d4af37">' || fmt_total || '</b></td></tr>'
    || '</table><table style="width:100%;margin-top:14px;padding:12px;background:#151515;border-radius:8px;font-size:15px">' || linhas || '</table>'
    || case when coalesce(d ->> 'obs', '') <> '' then '<div style="margin-top:10px;color:#ddd">' || case when es then 'Observación: ' else 'Observação: ' end || public.esc_html(d ->> 'obs') || '</div>' else '' end
    || case when coalesce(site, '') <> '' then '<a href="' || public.esc_html(site) || '/#/vitrine" style="display:inline-block;margin-top:18px;background:#d4af37;color:#000;padding:12px 20px;border-radius:8px;font-weight:bold;text-decoration:none">'
         || case when es then 'Abrir en la app' else 'Abrir no app' end || '</a>' else '' end
    || '</div>';
end $$;

revoke all on function public.html_pedido(jsonb, text, text), public.html_pedido_vitrine(jsonb, text, text, text) from public, anon, authenticated;
drop function if exists public.email_caixa(text, text, text, text, text, text);
drop function if exists public.email_linha(text, text);
drop function if exists public.fone_whats(text, boolean);
