-- =====================================================================
-- SaaS · Etapa 21: moeda da loja (reais ou pesos chilenos).
-- O app guarda nas configurações da loja em que moeda os valores estão (moedaBase: BRL ou CLP; loja do
-- Chile/Hotmart = CLP). As páginas do cliente e o e-mail do pedido da vitrine mostram os valores nessa moeda.
-- ADITIVA (funções novas e atualizadas). Reverter: 21_moeda_loja_reverter.sql
-- =====================================================================

create or replace function public.moeda_da_loja(p_loja uuid) returns text
  language sql stable security definer set search_path = public as $$
  select coalesce(
    (select case when s.dados ->> 'moedaBase' in ('BRL', 'CLP') then s.dados ->> 'moedaBase' end
       from public.itens s where s.loja_id = p_loja and s.colecao = 'meta' and s.id = 'settings'),
    -- sem moeda salva: pesos só para quem assina pela Hotmart (o idioma da tela não decide a moeda)
    case when (select provedor_pagamento from public.lojas where id = p_loja) = 'hotmart' then 'CLP' else 'BRL' end)
$$;

create or replace function public.moeda_por_os(p_token text) returns text
  language sql stable security definer set search_path = public as $$
  select public.moeda_da_loja(o.loja_id) from public.itens o
   where o.colecao = 'os' and length(p_token) >= 16 and o.dados ->> 'token' = p_token limit 1
$$;

-- total do e-mail da vitrine na moeda da loja (texto continua no idioma da loja)
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

create or replace function public.avisar_pedido_vitrine_email() returns trigger
  language plpgsql security definer set search_path = public as $$
declare idi text;
begin
  if current_setting('oficina.migrando', true) = '1' then return new; end if;
  idi := public.idioma_da_loja(new.loja_id);
  perform public.enviar_email_loja(new.loja_id,
    case when idi = 'es' then 'Nuevo pedido de la vitrina' else 'Novo pedido da vitrine' end
      || coalesce(' nº ' || (new.dados ->> 'numero'), '') || ' · ' || coalesce(new.dados ->> 'nome', ''),
    public.html_pedido_vitrine(new.dados, public.site_da_loja(new.loja_id), idi, public.moeda_da_loja(new.loja_id)));
  return new;
exception when others then
  raise warning 'aviso de pedido da vitrine por e-mail falhou: %', sqlerrm;
  return new;
end $$;

revoke all on function public.html_pedido_vitrine(jsonb, text, text, text) from public, anon, authenticated;
revoke all on function public.moeda_da_loja(uuid), public.moeda_por_os(text) from public;
grant execute on function public.moeda_da_loja(uuid), public.moeda_por_os(text) to anon, authenticated;
