-- Reverte a etapa 10 (os dados públicos do certificado ficam nas colunas; remova-as só se quiser)
drop function if exists public.registrar_certificado(uuid, text, text, timestamptz, text);
create or replace function public.salvar_cadastro_fiscal(p_loja uuid, p jsonb) returns void
  language plpgsql security definer set search_path = public as $$
begin
  if not public.sou_dono(p_loja) then raise exception 'apenas o dono altera o cadastro fiscal'; end if;
  if not public.tem_recurso(p_loja, 'nota_fiscal') then raise exception 'notas fiscais fazem parte do plano Pro Max'; end if;
  if coalesce(p ->> 'regime', '') not in ('', 'mei', 'simples', 'presumido', 'real') then raise exception 'regime inválido'; end if;
  insert into public.lojas_fiscal(loja_id, cnpj, razao_social, inscricao_municipal, regime, codigo_servico, aliquota_iss, municipio_ibge, email_fiscal, ambiente, certificado_no_provedor)
  values (p_loja, regexp_replace(coalesce(p ->> 'cnpj', ''), '\D', '', 'g'), p ->> 'razao_social', p ->> 'inscricao_municipal', nullif(p ->> 'regime', ''),
          p ->> 'codigo_servico', nullif(p ->> 'aliquota_iss', '')::numeric, p ->> 'municipio_ibge', p ->> 'email_fiscal',
          case when p ->> 'ambiente' = 'producao' then 'producao' else 'homologacao' end, coalesce((p ->> 'certificado_no_provedor')::boolean, false))
  on conflict (loja_id) do update set cnpj = excluded.cnpj, razao_social = excluded.razao_social, inscricao_municipal = excluded.inscricao_municipal,
    regime = excluded.regime, codigo_servico = excluded.codigo_servico, aliquota_iss = excluded.aliquota_iss, municipio_ibge = excluded.municipio_ibge,
    email_fiscal = excluded.email_fiscal, ambiente = excluded.ambiente, certificado_no_provedor = excluded.certificado_no_provedor, atualizado_em = now();
end $$;
-- Para apagar também as colunas, descomente:
-- alter table public.lojas_fiscal drop column if exists certificado_titular, drop column if exists certificado_cnpj,
--   drop column if exists certificado_validade, drop column if exists certificado_enviado_em, drop column if exists certificado_provedor;
