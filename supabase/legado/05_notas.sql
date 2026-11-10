-- =====================================================================
-- SaaS · Etapa 5: notas fiscais (somente Pro Max)
-- Franquia mensal do plano + créditos comprados (não expiram). Só nota AUTORIZADA consome.
-- Ordem: franquia do mês primeiro, depois créditos. Reserva atômica na emissão (trava de linha),
-- confirmação na autorização, devolução da reserva se rejeitar. Nota cancelada depois de autorizada
-- CONTINUA consumindo (o provedor já cobrou). Certificado A1 nunca é guardado aqui.
-- ADITIVA. Reverter: 05_notas_reverter.sql
-- =====================================================================

create table if not exists public.lojas_fiscal (
  loja_id uuid primary key references public.lojas(id) on delete cascade,
  cnpj text, razao_social text, inscricao_municipal text,
  regime text check (regime in ('mei', 'simples', 'presumido', 'real')),
  codigo_servico text, aliquota_iss numeric(5,2), municipio_ibge text, email_fiscal text,
  ambiente text not null default 'homologacao' check (ambiente in ('homologacao', 'producao')),
  certificado_no_provedor boolean not null default false,   -- o A1 é enviado direto ao provedor
  atualizado_em timestamptz not null default now()
);
alter table public.lojas_fiscal enable row level security;
drop policy if exists lojas_fiscal_ver on public.lojas_fiscal;
create policy lojas_fiscal_ver on public.lojas_fiscal for select using (public.sou_dono(loja_id));
revoke insert, update, delete on public.lojas_fiscal from anon, authenticated;

create table if not exists public.notas_fiscais (
  id uuid primary key default gen_random_uuid(),
  loja_id uuid not null references public.lojas(id) on delete cascade,
  tipo text not null default 'nfse' check (tipo in ('nfse', 'nfe')),
  os_id text, cliente jsonb not null default '{}', descricao text, valor numeric(12,2) not null check (valor > 0),
  status text not null default 'reservada' check (status in ('reservada', 'processando', 'autorizada', 'rejeitada', 'cancelada', 'erro')),
  ref text not null unique,                     -- referência enviada ao provedor (idempotência)
  reserva_origem text check (reserva_origem in ('franquia', 'credito')),
  mes text not null default to_char(now() at time zone 'America/Sao_Paulo', 'YYYY-MM'),
  numero text, pdf_url text, xml_url text, erro text,
  provedor text, ambiente text,
  criado_por uuid, criado_em timestamptz not null default now(),
  autorizada_em timestamptz, cancelada_em timestamptz, atualizada_em timestamptz not null default now()
);
create index if not exists notas_fiscais_loja_idx on public.notas_fiscais(loja_id, criado_em desc);
alter table public.notas_fiscais enable row level security;
drop policy if exists notas_ver on public.notas_fiscais;
create policy notas_ver on public.notas_fiscais for select using (loja_id in (select public.minhas_lojas()) and public.meu_papel(loja_id) in ('dono', 'atendente', 'suporte'));
revoke insert, update, delete on public.notas_fiscais from anon, authenticated;

create table if not exists public.consumo_mensal (
  loja_id uuid not null references public.lojas(id) on delete cascade,
  mes text not null,
  usadas int not null default 0,          -- autorizadas pela franquia
  reservadas int not null default 0,      -- em emissão pela franquia
  alerta80 boolean not null default false, alerta100 boolean not null default false,
  primary key (loja_id, mes)
);
create table if not exists public.creditos (
  loja_id uuid primary key references public.lojas(id) on delete cascade,
  saldo int not null default 0 check (saldo >= 0),
  reservados int not null default 0 check (reservados >= 0),
  atualizado_em timestamptz not null default now(),
  check (reservados <= saldo)
);
create table if not exists public.creditos_mov (
  id bigserial primary key,
  loja_id uuid not null references public.lojas(id) on delete cascade,
  qtd int not null, motivo text not null, ref text,
  criado_em timestamptz not null default now()
);
create unique index if not exists creditos_mov_ref_unico on public.creditos_mov(loja_id, motivo, ref) where ref is not null;
create table if not exists public.consumo_notas (
  nota_id uuid primary key references public.notas_fiscais(id) on delete cascade,
  loja_id uuid not null references public.lojas(id) on delete cascade,
  mes text not null, origem text not null check (origem in ('franquia', 'credito')),
  criado_em timestamptz not null default now()
);
create table if not exists public.avisos_loja (
  id bigserial primary key,
  loja_id uuid not null references public.lojas(id) on delete cascade,
  tipo text not null, texto text not null, lido boolean not null default false,
  criado_em timestamptz not null default now()
);
create table if not exists public.nfse_eventos (
  id bigserial primary key,
  chave_idempotencia text unique, ref text, status text, payload jsonb,
  recebido_em timestamptz not null default now()
);
alter table public.nfse_eventos add column if not exists loja_id uuid references public.lojas(id) on delete cascade;
do $$ declare t text; begin
  foreach t in array array['consumo_mensal', 'creditos', 'creditos_mov', 'consumo_notas', 'avisos_loja', 'nfse_eventos'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke insert, update, delete on public.%I from anon, authenticated', t);
  end loop;
end $$;
drop policy if exists consumo_ver on public.consumo_mensal;
create policy consumo_ver on public.consumo_mensal for select using (loja_id in (select public.minhas_lojas()));
drop policy if exists creditos_ver on public.creditos;
create policy creditos_ver on public.creditos for select using (loja_id in (select public.minhas_lojas()));
drop policy if exists creditos_mov_ver on public.creditos_mov;
create policy creditos_mov_ver on public.creditos_mov for select using (public.sou_dono(loja_id));
drop policy if exists consumo_notas_ver on public.consumo_notas;
create policy consumo_notas_ver on public.consumo_notas for select using (loja_id in (select public.minhas_lojas()));
drop policy if exists avisos_loja_ver on public.avisos_loja;
create policy avisos_loja_ver on public.avisos_loja for select using (loja_id in (select public.minhas_lojas()));
revoke all on public.nfse_eventos from anon, authenticated;

create or replace function public.mes_atual() returns text language sql stable as $$ select to_char(now() at time zone 'America/Sao_Paulo', 'YYYY-MM') $$;

-- Saldo de notas da loja (para a tela e para a emissão)
create or replace function public.saldo_notas(p_loja uuid) returns jsonb
  language sql stable security definer set search_path = public as $$
  select case when p_loja in (select public.minhas_lojas()) or auth.uid() is null then (
    with f as (select coalesce((select franquia_notas_mes from public.planos where id = public.loja_plano(p_loja)), 0) as franquia),
         c as (select coalesce((select usadas from public.consumo_mensal where loja_id = p_loja and mes = public.mes_atual()), 0) as usadas,
                      coalesce((select reservadas from public.consumo_mensal where loja_id = p_loja and mes = public.mes_atual()), 0) as reservadas),
         k as (select coalesce((select saldo from public.creditos where loja_id = p_loja), 0) as saldo,
                      coalesce((select reservados from public.creditos where loja_id = p_loja), 0) as reservados)
    select jsonb_build_object('mes', public.mes_atual(), 'franquia', f.franquia, 'usadas', c.usadas, 'reservadas', c.reservadas,
      'restante_franquia', greatest(0, f.franquia - c.usadas - c.reservadas), 'creditos', k.saldo, 'creditos_reservados', k.reservados,
      'disponivel', greatest(0, f.franquia - c.usadas - c.reservadas) + greatest(0, k.saldo - k.reservados),
      'tem_recurso', public.tem_recurso(p_loja, 'nota_fiscal'))
    from f, c, k) end
$$;

-- Dono salva o cadastro fiscal (nunca o certificado)
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

-- 1) RESERVA ATÔMICA (chamada pela rota /api/notas/emitir com o token do usuário)
-- Trava a linha do mês e a dos créditos: emissões simultâneas esperam uma pela outra, sem estourar o limite.
create or replace function public.reservar_nota(p_loja uuid, p_tipo text, p_os text, p_cliente jsonb, p_descricao text, p_valor numeric) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare franquia int; cm public.consumo_mensal; cr public.creditos; origem text; n public.notas_fiscais; fis public.lojas_fiscal;
begin
  if public.meu_papel(p_loja) not in ('dono', 'atendente') then raise exception 'sem permissão para emitir notas'; end if;
  if not public.tem_recurso(p_loja, 'nota_fiscal') then raise exception 'notas fiscais fazem parte do plano Pro Max'; end if;
  if not public.pode_escrever(p_loja) then raise exception 'a loja está em somente leitura'; end if;
  select * into fis from public.lojas_fiscal where loja_id = p_loja;
  if fis.loja_id is null or coalesce(fis.cnpj, '') = '' then raise exception 'preencha o cadastro fiscal da loja antes de emitir'; end if;
  if coalesce(p_valor, 0) <= 0 then raise exception 'valor da nota inválido'; end if;

  franquia := coalesce((select franquia_notas_mes from public.planos where id = public.loja_plano(p_loja)), 0);
  insert into public.consumo_mensal(loja_id, mes) values (p_loja, public.mes_atual()) on conflict do nothing;
  insert into public.creditos(loja_id) values (p_loja) on conflict do nothing;
  select * into cm from public.consumo_mensal where loja_id = p_loja and mes = public.mes_atual() for update;
  select * into cr from public.creditos where loja_id = p_loja for update;

  if cm.usadas + cm.reservadas < franquia then
    origem := 'franquia';
    update public.consumo_mensal set reservadas = reservadas + 1 where loja_id = p_loja and mes = cm.mes;
  elsif cr.saldo - cr.reservados > 0 then
    origem := 'credito';
    update public.creditos set reservados = reservados + 1, atualizado_em = now() where loja_id = p_loja;
  else
    raise exception 'SEM_SALDO: franquia do mês e créditos esgotados. Compre notas avulsas ou um pacote.';
  end if;

  insert into public.notas_fiscais(loja_id, tipo, os_id, cliente, descricao, valor, ref, reserva_origem, mes, criado_por, ambiente)
  values (p_loja, case when p_tipo = 'nfe' then 'nfe' else 'nfse' end, p_os, coalesce(p_cliente, '{}'), left(p_descricao, 2000), round(p_valor, 2),
          'nf-' || replace(gen_random_uuid()::text, '-', ''), origem, cm.mes, auth.uid(), fis.ambiente)
  returning * into n;
  return jsonb_build_object('nota', to_jsonb(n), 'fiscal', to_jsonb(fis));
end $$;

-- 2) Autorizada: transforma a reserva em consumo (idempotente) e gera alertas de 80%/100%
create or replace function public.confirmar_nota(p_ref text, p_numero text, p_pdf text, p_xml text, p_provedor text) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare n public.notas_fiscais; franquia int; cm public.consumo_mensal; alerta text;
begin
  select * into n from public.notas_fiscais where ref = p_ref for update;
  if not found then raise exception 'nota não encontrada'; end if;
  if n.status in ('autorizada', 'cancelada') then return jsonb_build_object('status', n.status, 'repetido', true); end if;
  if n.status not in ('reservada', 'processando') then return jsonb_build_object('status', n.status, 'ignorado', true); end if;

  if n.reserva_origem = 'franquia' then
    update public.consumo_mensal set reservadas = greatest(0, reservadas - 1), usadas = usadas + 1 where loja_id = n.loja_id and mes = n.mes returning * into cm;
  else
    update public.creditos set reservados = greatest(0, reservados - 1), saldo = saldo - 1, atualizado_em = now() where loja_id = n.loja_id;
    insert into public.creditos_mov(loja_id, qtd, motivo, ref) values (n.loja_id, -1, 'uso', n.ref);
  end if;
  insert into public.consumo_notas(nota_id, loja_id, mes, origem) values (n.id, n.loja_id, n.mes, n.reserva_origem) on conflict do nothing;
  update public.notas_fiscais set status = 'autorizada', numero = p_numero, pdf_url = p_pdf, xml_url = p_xml, provedor = p_provedor,
    erro = null, autorizada_em = now(), atualizada_em = now() where id = n.id;

  -- alertas da franquia (uma vez por mês cada)
  if cm.loja_id is not null then
    franquia := coalesce((select franquia_notas_mes from public.planos where id = public.loja_plano(n.loja_id)), 0);
    if franquia > 0 and cm.usadas >= franquia and not cm.alerta100 then
      alerta := '100';
      update public.consumo_mensal set alerta100 = true, alerta80 = true where loja_id = cm.loja_id and mes = cm.mes;
      insert into public.avisos_loja(loja_id, tipo, texto) values (n.loja_id, 'franquia100', 'Você usou 100% das notas do mês. As próximas usam créditos avulsos.');
    elsif franquia > 0 and cm.usadas >= ceil(franquia * 0.8) and not cm.alerta80 then
      alerta := '80';
      update public.consumo_mensal set alerta80 = true where loja_id = cm.loja_id and mes = cm.mes;
      insert into public.avisos_loja(loja_id, tipo, texto) values (n.loja_id, 'franquia80', format('Você já usou %s de %s notas do mês (80%%).', cm.usadas, franquia));
    end if;
  end if;
  return jsonb_build_object('status', 'autorizada', 'alerta', alerta, 'loja_id', n.loja_id);
end $$;

-- 3) Rejeitada/erro: devolve a reserva (não consome)
create or replace function public.liberar_nota(p_ref text, p_status text, p_erro text) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare n public.notas_fiscais;
begin
  select * into n from public.notas_fiscais where ref = p_ref for update;
  if not found then raise exception 'nota não encontrada'; end if;
  if n.status not in ('reservada', 'processando') then return jsonb_build_object('status', n.status, 'ignorado', true); end if;
  if n.reserva_origem = 'franquia' then
    update public.consumo_mensal set reservadas = greatest(0, reservadas - 1) where loja_id = n.loja_id and mes = n.mes;
  else
    update public.creditos set reservados = greatest(0, reservados - 1), atualizado_em = now() where loja_id = n.loja_id;
  end if;
  update public.notas_fiscais set status = case when p_status = 'erro' then 'erro' else 'rejeitada' end, erro = left(p_erro, 1000), atualizada_em = now() where id = n.id;
  return jsonb_build_object('status', case when p_status = 'erro' then 'erro' else 'rejeitada' end);
end $$;

create or replace function public.marcar_nota_processando(p_ref text, p_provedor text) returns void
  language sql security definer set search_path = public as $$
  update public.notas_fiscais set status = 'processando', provedor = p_provedor, atualizada_em = now() where ref = p_ref and status = 'reservada'
$$;

-- Cancelamento de nota autorizada: continua consumindo (padrão definido)
create or replace function public.cancelar_nota_registro(p_ref text) returns jsonb
  language plpgsql security definer set search_path = public as $$
begin
  update public.notas_fiscais set status = 'cancelada', cancelada_em = now(), atualizada_em = now() where ref = p_ref and status = 'autorizada';
  return jsonb_build_object('status', (select status from public.notas_fiscais where ref = p_ref));
end $$;

-- Créditos comprados (chamados pelo webhook de pagamento) — idempotentes pela referência do evento
create or replace function public.creditar_notas(p_loja uuid, p_qtd int, p_motivo text, p_ref text) returns int
  language plpgsql security definer set search_path = public as $$
begin
  if p_qtd <= 0 then raise exception 'quantidade inválida'; end if;
  insert into public.creditos(loja_id) values (p_loja) on conflict do nothing;
  begin
    insert into public.creditos_mov(loja_id, qtd, motivo, ref) values (p_loja, p_qtd, p_motivo, p_ref);
  exception when unique_violation then return (select saldo from public.creditos where loja_id = p_loja); -- já creditado
  end;
  update public.creditos set saldo = saldo + p_qtd, atualizado_em = now() where loja_id = p_loja;
  return (select saldo from public.creditos where loja_id = p_loja);
end $$;

-- Reembolso de pacote: retira só o que ainda não foi usado
create or replace function public.estornar_creditos(p_loja uuid, p_qtd int, p_ref text) returns int
  language plpgsql security definer set search_path = public as $$
declare c public.creditos; tirar int;
begin
  select * into c from public.creditos where loja_id = p_loja for update;
  if not found then return 0; end if;
  tirar := least(p_qtd, c.saldo - c.reservados);
  if tirar <= 0 then return 0; end if;
  begin
    insert into public.creditos_mov(loja_id, qtd, motivo, ref) values (p_loja, -tirar, 'estorno', p_ref);
  exception when unique_violation then return 0;
  end;
  update public.creditos set saldo = saldo - tirar, atualizado_em = now() where loja_id = p_loja;
  return tirar;
end $$;

-- Webhook do provedor fiscal: registra (idempotente) e aplica a mudança de status
create or replace function public.evento_nota(p_chave text, p_ref text, p_status text, p_numero text, p_pdf text, p_xml text, p_erro text, p_provedor text, p_payload jsonb) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare id bigint;
begin
  insert into public.nfse_eventos(chave_idempotencia, ref, status, payload, loja_id) values (p_chave, p_ref, p_status, p_payload, (select loja_id from public.notas_fiscais where ref = p_ref))
  on conflict (chave_idempotencia) do nothing returning nfse_eventos.id into id;
  if id is null then return jsonb_build_object('duplicado', true); end if;
  if p_status = 'autorizada' then return public.confirmar_nota(p_ref, p_numero, p_pdf, p_xml, p_provedor);
  elsif p_status in ('rejeitada', 'erro') then return public.liberar_nota(p_ref, p_status, p_erro);
  elsif p_status = 'cancelada' then return public.cancelar_nota_registro(p_ref);
  elsif p_status = 'processando' then perform public.marcar_nota_processando(p_ref, p_provedor); return jsonb_build_object('status', 'processando');
  end if;
  return jsonb_build_object('ignorado', true);
end $$;

create or replace function public.marcar_avisos_lidos(p_loja uuid) returns void
  language sql security definer set search_path = public as $$
  update public.avisos_loja set lido = true where loja_id = p_loja and p_loja in (select public.minhas_lojas())
$$;

revoke all on function public.reservar_nota(uuid, text, text, jsonb, text, numeric) from public, anon;
revoke all on function public.confirmar_nota(text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.liberar_nota(text, text, text) from public, anon, authenticated;
revoke all on function public.marcar_nota_processando(text, text) from public, anon, authenticated;
revoke all on function public.cancelar_nota_registro(text) from public, anon, authenticated;
revoke all on function public.creditar_notas(uuid, int, text, text) from public, anon, authenticated;
revoke all on function public.estornar_creditos(uuid, int, text) from public, anon, authenticated;
revoke all on function public.evento_nota(text, text, text, text, text, text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.saldo_notas(uuid) from public, anon;
revoke all on function public.salvar_cadastro_fiscal(uuid, jsonb) from public, anon;
revoke all on function public.marcar_avisos_lidos(uuid) from public, anon;
grant execute on function public.reservar_nota(uuid, text, text, jsonb, text, numeric), public.saldo_notas(uuid),
  public.salvar_cadastro_fiscal(uuid, jsonb), public.marcar_avisos_lidos(uuid) to authenticated;

-- E-mail do dono (para alertas enviados pelo servidor)
create or replace function public.email_dono(p_loja uuid) returns text
  language sql stable security definer set search_path = public as $$
  select email from public.membros where loja_id = p_loja and papel = 'dono' order by criado_em limit 1
$$;
revoke all on function public.email_dono(uuid) from public, anon, authenticated;
