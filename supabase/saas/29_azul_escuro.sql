-- 29 · Azul escuro (Oficina Simples): aparência padrão e moldura dos e-mails.
-- ADITIVA: muda só padrões de coluna e refaz uma função (create or replace). Seguro rodar de novo.
-- Reverter: 29_azul_escuro_reverter.sql
--   - Aparência padrão de uma oficina nova: azul escuro #1E3A8A / #172554 sobre fundo branco.
--   - Oficinas que nunca mexeram na aparência (ainda com o azul médio da 28) passam ao padrão novo.
--   - E-mails: faixa de cima, nome e botão em azul escuro. Links continuam no azul de destaque #1D4ED8.

alter table public.lojas_tema
  alter column cor_primaria set default '#1E3A8A',
  alter column cor_secundaria set default '#172554',
  alter column cor_fundo set default '#FFFFFF';
update public.lojas_tema set cor_primaria = '#1E3A8A', cor_secundaria = '#172554'
 where lower(cor_primaria) = '#1d4ed8' and lower(cor_secundaria) = '#1e40af' and lower(cor_fundo) = '#ffffff';

create or replace function public.email_caixa(p_titulo text, p_sub text, p_linhas text, p_extra text, p_url text, p_botao text)
  returns text language sql immutable set search_path = public as $$
  select '<div style="font-family:Arial,Helvetica,sans-serif;background:#F5F7FA;padding:20px 12px">'
    || '<div style="max-width:560px;margin:0 auto;background:#FFFFFF;color:#0F172A;border:1px solid #E3E8EF;border-top:4px solid #1E3A8A;border-radius:12px;padding:24px">'
    || '<div style="font-size:12px;font-weight:bold;letter-spacing:.06em;color:#1E3A8A;margin-bottom:10px">OFICINA SIMPLES</div>'
    || '<div style="font-size:20px;font-weight:bold;color:#0F172A;margin-bottom:4px">' || p_titulo || '</div>'
    || '<div style="font-size:13px;color:#5B6B80;margin-bottom:16px">' || coalesce(p_sub, '') || '</div>'
    || '<table style="width:100%;font-size:15px;color:#0F172A;border-collapse:collapse">' || coalesce(p_linhas, '') || '</table>'
    || coalesce(p_extra, '')
    || case when coalesce(p_url, '') <> '' then '<a href="' || public.esc_html(p_url) || '" style="display:inline-block;margin-top:18px;background:#1E3A8A;color:#FFFFFF;padding:14px 22px;border-radius:10px;font-weight:bold;text-decoration:none">' || p_botao || '</a>' else '' end
    || '</div></div>'
$$;
revoke all on function public.email_caixa(text, text, text, text, text, text) from public, anon, authenticated;
