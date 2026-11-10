-- Reverter da 29 (azul escuro): volta a aparência padrão e a moldura dos e-mails ao azul médio da 28.
-- As oficinas que já estão com o azul escuro padrão continuam com ele (não dá para saber quem escolheu de propósito).
-- Seguro rodar de novo.
alter table public.lojas_tema
  alter column cor_primaria set default '#1D4ED8',
  alter column cor_secundaria set default '#1E40AF',
  alter column cor_fundo set default '#FFFFFF';

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
revoke all on function public.email_caixa(text, text, text, text, text, text) from public, anon, authenticated;
