-- =====================================================================
-- SaaS · Etapa 10: envio do certificado digital A1 pelo app
-- A loja envia o arquivo (.pfx/.p12) e a senha pelo app. O servidor (/api/notas/certificado) confere
-- a senha, a validade e o CNPJ, repassa ao provedor fiscal e DESCARTA o arquivo e a senha:
-- nada disso é gravado. Aqui ficam só os dados públicos do certificado, para mostrar e avisar o vencimento.
-- ADITIVA. Reverter: 10_certificado_reverter.sql
-- =====================================================================

alter table public.lojas_fiscal add column if not exists certificado_titular text;
alter table public.lojas_fiscal add column if not exists certificado_cnpj text;
alter table public.lojas_fiscal add column if not exists certificado_validade timestamptz;
alter table public.lojas_fiscal add column if not exists certificado_enviado_em timestamptz;
alter table public.lojas_fiscal add column if not exists certificado_provedor text;

-- Registra o envio (só o servidor chama, com a chave secreta: a loja não consegue marcar "enviado" sozinha)
create or replace function public.registrar_certificado(p_loja uuid, p_titular text, p_cnpj text, p_validade timestamptz, p_provedor text) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare fis public.lojas_fiscal; v_cnpj text := nullif(regexp_replace(coalesce(p_cnpj, ''), '\D', '', 'g'), '');
begin
  select * into fis from public.lojas_fiscal where loja_id = p_loja;
  if fis.loja_id is null or coalesce(fis.cnpj, '') = '' then raise exception 'Preencha e salve o cadastro fiscal (com o CNPJ) antes de enviar o certificado'; end if;
  if v_cnpj is not null and v_cnpj <> fis.cnpj then
    raise exception 'Este certificado é do CNPJ % e o cadastro fiscal da loja é do CNPJ %', v_cnpj, fis.cnpj;
  end if;
  if p_validade <= now() then raise exception 'Este certificado está vencido'; end if;
  update public.lojas_fiscal set certificado_no_provedor = true, certificado_titular = left(p_titular, 200), certificado_cnpj = v_cnpj,
    certificado_validade = p_validade, certificado_enviado_em = now(), certificado_provedor = p_provedor, atualizado_em = now()
   where loja_id = p_loja;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.registrar_certificado(uuid, text, text, timestamptz, text) from public, anon, authenticated;

-- O cadastro fiscal salvo pela loja não mexe mais na marca do certificado (só o servidor marca, depois de conferir)
create or replace function public.salvar_cadastro_fiscal(p_loja uuid, p jsonb) returns void
  language plpgsql security definer set search_path = public as $$
begin
  if not public.sou_dono(p_loja) then raise exception 'apenas o dono altera o cadastro fiscal'; end if;
  if not public.tem_recurso(p_loja, 'nota_fiscal') then raise exception 'notas fiscais fazem parte do plano Pro Max'; end if;
  if coalesce(p ->> 'regime', '') not in ('', 'mei', 'simples', 'presumido', 'real') then raise exception 'regime inválido'; end if;
  insert into public.lojas_fiscal(loja_id, cnpj, razao_social, inscricao_municipal, regime, codigo_servico, aliquota_iss, municipio_ibge, email_fiscal, ambiente)
  values (p_loja, regexp_replace(coalesce(p ->> 'cnpj', ''), '\D', '', 'g'), p ->> 'razao_social', p ->> 'inscricao_municipal', nullif(p ->> 'regime', ''),
          p ->> 'codigo_servico', nullif(p ->> 'aliquota_iss', '')::numeric, p ->> 'municipio_ibge', p ->> 'email_fiscal',
          case when p ->> 'ambiente' = 'producao' then 'producao' else 'homologacao' end)
  on conflict (loja_id) do update set cnpj = excluded.cnpj, razao_social = excluded.razao_social, inscricao_municipal = excluded.inscricao_municipal,
    regime = excluded.regime, codigo_servico = excluded.codigo_servico, aliquota_iss = excluded.aliquota_iss, municipio_ibge = excluded.municipio_ibge,
    email_fiscal = excluded.email_fiscal, ambiente = excluded.ambiente, atualizado_em = now(),
    -- trocou o CNPJ: o certificado enviado era de outra empresa
    certificado_no_provedor = case when excluded.cnpj is distinct from lojas_fiscal.cnpj then false else lojas_fiscal.certificado_no_provedor end;
end $$;
revoke all on function public.salvar_cadastro_fiscal(uuid, jsonb) from public, anon;
grant execute on function public.salvar_cadastro_fiscal(uuid, jsonb) to authenticated;
