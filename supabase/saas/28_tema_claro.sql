-- 28 · Tema branco e azul (Oficina Simples) nos e-mails e na aparência padrão + WhatsApp certo nos e-mails.
-- ADITIVA: muda só padrões de coluna e refaz funções (create or replace). Seguro rodar de novo.
-- Reverter: 28_tema_claro_reverter.sql
--   - Aparência padrão de uma oficina nova: azul #1D4ED8 / #1E40AF sobre fundo branco.
--   - Oficinas que nunca mexeram na aparência (ainda com o preto e dourado de fábrica) passam ao padrão novo.
--   - E-mails de pedido (orçamento e vitrine): fundo branco, faixa azul em cima, botão azul.
--   - Link do WhatsApp nos e-mails: só ganha o 55 quando a oficina é do Brasil (moeda BRL) e o número
--     tem formato brasileiro (DDD que existe + 8 ou 9 dígitos). Igual ao foneWhats() do app.

-- ---------- aparência padrão ----------
alter table public.lojas_tema
  alter column cor_primaria set default '#1D4ED8',
  alter column cor_secundaria set default '#1E40AF',
  alter column cor_fundo set default '#FFFFFF';
update public.lojas_tema set cor_primaria = '#1D4ED8', cor_secundaria = '#1E40AF', cor_fundo = '#FFFFFF'
 where lower(cor_primaria) = '#d4af37' and lower(cor_secundaria) = '#b8860b' and lower(cor_fundo) = '#000000';

-- ---------- número para o WhatsApp (wa.me) ----------
create or replace function public.fone_whats(p_tel text, p_brasil boolean default true) returns text
  language plpgsql immutable set search_path = public as $$
declare s text := btrim(coalesce(p_tel, '')); d text := regexp_replace(coalesce(p_tel, ''), '\D', '', 'g');
begin
  if d = '' then return ''; end if;
  if left(s, 1) = '+' then return d; end if;                    -- já tem o país
  if left(d, 2) = '00' then return substr(d, 3); end if;        -- 00 + país
  if p_brasil and left(d, 2) = any (array['11','12','13','14','15','16','17','18','19','21','22','24','27','28','31','32','33','34','35','37','38',
      '41','42','43','44','45','46','47','48','49','51','53','54','55','61','62','63','64','65','66','67','68','69','71','73','74','75','77','79',
      '81','82','83','84','85','86','87','88','89','91','92','93','94','95','96','97','98','99'])
     and (d ~ '^\d{2}9\d{8}$' or d ~ '^\d{2}[2-5]\d{7}$') then
    return '55' || d;
  end if;
  return d;                                                     -- outro país: fica como foi digitado
end $$;

-- ---------- moldura comum dos e-mails (branco, faixa azul, botão azul) ----------
-- linhas: html das linhas <tr> (rótulo, valor); extra: bloco depois da tabela; botao/url: opcionais
create or replace function public.email_caixa(p_titulo text, p_sub text, p_linhas text, p_extra text, p_url text, p_botao text)
  returns text language sql immutable set search_path = public as $$
  select '<div style="font-family:Arial,Helvetica,sans-serif;background:#F5F7FA;padding:20px 12px">'
    || '<div style="max-width:560px;margin:0 auto;background:#FFFFFF;color:#0F172A;border:1px solid #E3E8EF;border-top:4px solid #1D4ED8;border-radius:12px;padding:24px">'
    || '<div style="font-size:12px;font-weight:bold;letter-spacing:.06em;color:#1D4ED8;margin-bottom:10px">OFICINA SIMPLES</div>'
    || '<div style="font-size:20px;font-weight:bold;color:#0F172A;margin-bottom:4px">' || p_titulo || '</div>'
    || '<div style="font-size:13px;color:#5B6B80;margin-bottom:16px">' || coalesce(p_sub, '') || '</div>'
    || '<table style="width:100%;font-size:15px;color:#0F172A;border-collapse:collapse">' || coalesce(p_linhas, '') || '</table>'
    || coalesce(p_extra, '')
    || case when coalesce(p_url, '') <> '' then '<a href="' || public.esc_html(p_url) || '" style="display:inline-block;margin-top:18px;background:#1D4ED8;color:#FFFFFF;padding:14px 22px;border-radius:10px;font-weight:bold;text-decoration:none">' || p_botao || '</a>' else '' end
    || '</div></div>'
$$;
create or replace function public.email_linha(p_rotulo text, p_valor text) returns text language sql immutable as $$
  select '<tr><td style="color:#5B6B80;padding:7px 12px 7px 0;white-space:nowrap;vertical-align:top">' || p_rotulo || '</td><td style="padding:7px 0">' || coalesce(p_valor, '—') || '</td></tr>'
$$;

-- ---------- e-mail do pedido de orçamento (português e espanhol) ----------
create or replace function public.html_pedido(d jsonb, site text, idioma text) returns text language sql immutable set search_path = public as $$
  select public.email_caixa(
    case when idioma = 'es' then 'Nueva solicitud de presupuesto' else 'Novo pedido de orçamento' end || coalesce(' nº ' || (d ->> 'numero'), ''),
    case when idioma = 'es' then 'Enviada por el cliente desde el enlace del taller' else 'Enviado pelo cliente pelo link da oficina' end,
    public.email_linha('Cliente', '<b>' || public.esc_html(d ->> 'nome') || '</b>')
    || public.email_linha('WhatsApp', '<a style="color:#1D4ED8" href="https://wa.me/' || public.fone_whats(d ->> 'telefone', coalesce((d ->> '_brasil')::boolean, idioma <> 'es')) || '">' || public.esc_html(d ->> 'telefone') || '</a>')
    || public.email_linha(case when idioma = 'es' then 'Vehículo' else 'Veículo' end,
         concat_ws(' · ', nullif(public.esc_html(d ->> 'marca'), ''), '<b>' || public.esc_html(d ->> 'modelo') || '</b>', nullif(public.esc_html(d ->> 'ano'), ''), nullif(public.esc_html(d ->> 'placa'), '')))
    || public.email_linha(case when idioma = 'es' then 'Urgencia' else 'Urgência' end, '<b style="color:' || case d ->> 'urgencia'
         when 'alta' then '#DC2626">' || case when idioma = 'es' then 'URGENTE' else 'URGENTE' end
         when 'baixa' then '#1D4ED8">' || case when idioma = 'es' then 'Baja' else 'Baixa' end
         else '#C2410C">' || case when idioma = 'es' then 'Media' else 'Média' end end || '</b>'),
    '<div style="margin-top:14px;padding:12px 14px;background:#F5F7FA;border:1px solid #E3E8EF;border-radius:8px;color:#0F172A">' || public.esc_html(d ->> 'defeito') || '</div>',
    case when coalesce(site, '') <> '' then site || '/#/os?tab=pedidos' end,
    case when idioma = 'es' then 'Abrir en la app' else 'Abrir no app' end)
$$;
create or replace function public.html_pedido(d jsonb, site text) returns text language sql immutable set search_path = public as $$
  select public.html_pedido(d, site, 'pt')
$$;

-- o aviso passa ao e-mail se a oficina é do Brasil (para o WhatsApp do cliente)
create or replace function public.avisar_pedido_email() returns trigger
  language plpgsql security definer set search_path = public as $$
declare idi text;
begin
  if current_setting('oficina.migrando', true) = '1' then return new; end if;
  idi := public.idioma_da_loja(new.loja_id);
  perform public.enviar_email_loja(new.loja_id,
    case when idi = 'es' then 'Nueva solicitud de presupuesto: ' else 'Novo pedido de orçamento: ' end
      || coalesce(new.dados ->> 'modelo', '') || ' · ' || coalesce(new.dados ->> 'nome', '') || case when new.dados ->> 'urgencia' = 'alta' then ' (URGENTE)' else '' end,
    public.html_pedido(new.dados || jsonb_build_object('_brasil', public.moeda_da_loja(new.loja_id) = 'BRL'), public.site_da_loja(new.loja_id), idi));
  return new;
exception when others then
  raise warning 'aviso de pedido por e-mail falhou: %', sqlerrm;
  return new;
end $$;

-- ---------- e-mail do pedido da vitrine ----------
create or replace function public.html_pedido_vitrine(d jsonb, site text, idioma text, moeda text) returns text
  language plpgsql immutable set search_path = public as $$
declare es boolean := idioma = 'es'; linhas text := ''; it jsonb; ret text; tot numeric := coalesce(public.num_seguro(d ->> 'total'), 0);
  fmt_total text;
begin
  for it in select * from jsonb_array_elements(coalesce(d -> 'itens', '[]'::jsonb)) loop
    linhas := linhas || '<div style="padding:4px 0">' || coalesce(it ->> 'qtd', '1') || 'x ' || public.esc_html(it ->> 'nome') || '</div>';
  end loop;
  begin
    ret := to_char((d ->> 'retirada')::timestamptz at time zone case when moeda = 'CLP' then 'America/Santiago' else 'America/Sao_Paulo' end, 'DD/MM/YYYY HH24:MI');
  exception when others then ret := coalesce(d ->> 'retirada', '');
  end;
  fmt_total := case when moeda = 'CLP' then '$ ' || replace(to_char(round(tot), 'FM999G999G999'), ',', '.')
                    else 'R$ ' || replace(replace(replace(to_char(tot, 'FM999G999G990D00'), ',', '#'), '.', ','), '#', '.') end;
  return public.email_caixa(
    case when es then 'Nuevo pedido de la vitrina' else 'Novo pedido da vitrine' end || coalesce(' nº ' || (d ->> 'numero'), ''),
    case when es then 'El cliente compró por la vitrina online' else 'O cliente comprou pela vitrine online' end,
    public.email_linha('Cliente', '<b>' || public.esc_html(d ->> 'nome') || '</b>')
    || public.email_linha('WhatsApp', '<a style="color:#1D4ED8" href="https://wa.me/' || public.fone_whats(d ->> 'telefone', coalesce(moeda, 'BRL') = 'BRL') || '">' || public.esc_html(d ->> 'telefone') || '</a>')
    || public.email_linha(case when es then 'Retiro' else 'Retirada' end, '<b>' || public.esc_html(ret) || '</b>')
    || public.email_linha('Total', '<b style="color:#1D4ED8">' || fmt_total || '</b>'),
    '<div style="margin-top:14px;padding:12px 14px;background:#F5F7FA;border:1px solid #E3E8EF;border-radius:8px;font-size:15px">' || linhas || '</div>'
    || case when coalesce(d ->> 'obs', '') <> '' then '<div style="margin-top:10px;color:#0F172A">' || case when es then 'Observación: ' else 'Observação: ' end || public.esc_html(d ->> 'obs') || '</div>' else '' end,
    case when coalesce(site, '') <> '' then site || '/#/vitrine' end,
    case when es then 'Abrir en la app' else 'Abrir no app' end);
end $$;
-- versão antiga (sem moeda): usa a nova, em reais
create or replace function public.html_pedido_vitrine(d jsonb, site text, idioma text) returns text language sql immutable set search_path = public as $$
  select public.html_pedido_vitrine(d, site, idioma, 'BRL')
$$;

-- e-mail de teste do dono: um pedido de exemplo com um veículo
create or replace function public.testar_email(p_loja uuid) returns bigint
  language plpgsql security definer set search_path = public as $$
declare idi text := public.idioma_da_loja(p_loja);
begin
  if not public.sou_dono(p_loja) then raise exception 'apenas o dono pode testar'; end if;
  return public.enviar_email_loja(p_loja,
    case when idi = 'es' then 'Prueba: avisos de pedidos funcionando ✅' else 'Teste: avisos de pedido de orçamento funcionando ✅' end,
    public.html_pedido(jsonb_build_object('numero', 0, 'nome', case when idi = 'es' then 'Cliente de prueba' else 'Cliente de teste' end,
      'telefone', '48999999999', 'marca', 'Chevrolet', 'modelo', 'Onix', 'ano', '2019',
      '_brasil', public.moeda_da_loja(p_loja) = 'BRL',
      'defeito', case when idi = 'es' then 'Este es un correo de prueba del aviso de pedidos.' else 'Este é um e-mail de teste do aviso de pedidos.' end, 'urgencia', 'media'),
      public.site_da_loja(p_loja), idi));
end $$;

revoke all on function public.html_pedido(jsonb, text, text), public.html_pedido(jsonb, text),
  public.html_pedido_vitrine(jsonb, text, text, text), public.html_pedido_vitrine(jsonb, text, text),
  public.email_caixa(text, text, text, text, text, text), public.email_linha(text, text) from public, anon, authenticated;
grant execute on function public.fone_whats(text, boolean) to anon, authenticated;
