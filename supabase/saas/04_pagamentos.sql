-- =====================================================================
-- SaaS · Etapa 4: pagamento recorrente (Kiwify) — eventos, mapeamento de produtos,
-- fila de compras sem loja e regras que mudam plano/situação.
-- O webhook (/api/webhooks/kiwify) é a ÚNICA porta de entrada: valida a origem, grava o
-- evento bruto (idempotente pela chave) e chama aplicar_evento_pagamento. O app nunca altera plano.
-- ADITIVA. Reverter: 04_pagamentos_reverter.sql
-- =====================================================================

-- Vínculo da loja com a assinatura no provedor
alter table public.lojas add column if not exists assinatura_externa_id text;
alter table public.lojas add column if not exists comprador_email text;
create index if not exists lojas_assinatura_externa_idx on public.lojas(assinatura_externa_id) where assinatura_externa_id is not null;

-- Produtos/ofertas do provedor → plano ou pacote de notas (editável no painel admin, sem mexer no código)
create table if not exists public.kiwify_produtos (
  id uuid primary key default gen_random_uuid(),
  produto_id text not null,
  oferta_id text,
  nome text not null default '',
  tipo text not null check (tipo in ('plano', 'notas')),
  plano_id text references public.planos(id),
  qtd_notas int check (qtd_notas is null or qtd_notas > 0),
  checkout_url text,
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  check ((tipo = 'plano' and plano_id is not null) or (tipo = 'notas' and qtd_notas is not null))
);
create unique index if not exists kiwify_produtos_unico on public.kiwify_produtos (produto_id, coalesce(oferta_id, ''));
alter table public.kiwify_produtos enable row level security;
revoke all on public.kiwify_produtos from anon, authenticated;

-- Todo evento recebido (válido ou não), com o corpo bruto para auditoria e reprocessamento
create table if not exists public.kiwify_eventos (
  id bigserial primary key,
  provedor text not null default 'kiwify',
  recebido_em timestamptz not null default now(),
  assinatura_valida boolean not null,
  chave_idempotencia text unique,               -- mesmo evento repetido não entra de novo
  tipo text,                                    -- normalizado: compra_aprovada | renovacao | atrasada | cancelada | reembolso | chargeback | ignorado
  tipo_original text,
  email text, produto_id text, oferta_id text, pedido_id text, assinatura_id text,
  proxima_cobranca timestamptz,
  payload jsonb,
  status text not null default 'recebido' check (status in ('recebido', 'aplicado', 'ignorado', 'pendente_loja', 'revisao', 'erro', 'rejeitado')),
  loja_id uuid references public.lojas(id) on delete set null,
  erro text,
  processado_em timestamptz,
  tentativas int not null default 0
);
create index if not exists kiwify_eventos_status_idx on public.kiwify_eventos(status, recebido_em desc);
create index if not exists kiwify_eventos_email_idx on public.kiwify_eventos(lower(email)) where status = 'pendente_loja';
alter table public.kiwify_eventos enable row level security;
revoke all on public.kiwify_eventos from anon, authenticated;

-- Avisos para o dono da plataforma (painel admin): reembolso, chargeback, eventos para revisar
create table if not exists public.plataforma_avisos (
  id bigserial primary key,
  tipo text not null,
  loja_id uuid references public.lojas(id) on delete set null,
  texto text not null,
  ref text,
  lido boolean not null default false,
  criado_em timestamptz not null default now()
);
alter table public.plataforma_avisos enable row level security;
revoke all on public.plataforma_avisos from anon, authenticated;

insert into public.plataforma_config(chave, valor) values
  ('kiwify_area_cliente_url', '""'::jsonb),
  ('checkout_param_email', '""'::jsonb)      -- nome do parâmetro de e-mail no checkout, se o provedor aceitar (confirmar na documentação)
on conflict (chave) do nothing;

-- ---------- Registro idempotente do evento (chamado pelo webhook com a chave do servidor) ----------
create or replace function public.registrar_evento_pagamento(p_valido boolean, p_norm jsonb, p_payload jsonb) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare ev public.kiwify_eventos; chave text := nullif(p_norm ->> 'chave', '');
begin
  if not p_valido then
    insert into public.kiwify_eventos(assinatura_valida, tipo_original, payload, status, erro)
      values (false, left(p_norm ->> 'tipo_original', 80), p_payload, 'rejeitado', 'assinatura do webhook inválida') returning * into ev;
    return jsonb_build_object('id', ev.id, 'status', ev.status, 'duplicado', false);
  end if;
  insert into public.kiwify_eventos(assinatura_valida, chave_idempotencia, tipo, tipo_original, email, produto_id, oferta_id, pedido_id, assinatura_id, proxima_cobranca, payload, status, erro)
  values (true, chave, p_norm ->> 'tipo', left(p_norm ->> 'tipo_original', 80), lower(trim(p_norm ->> 'email')), p_norm ->> 'produto_id', nullif(p_norm ->> 'oferta_id', ''),
          p_norm ->> 'pedido_id', nullif(p_norm ->> 'assinatura_id', ''), (p_norm ->> 'proxima_cobranca')::timestamptz, p_payload,
          case when p_norm ->> 'tipo' = 'ignorado' then 'ignorado' when coalesce((p_norm ->> 'confiavel')::boolean, false) then 'recebido' else 'revisao' end,
          case when not coalesce((p_norm ->> 'confiavel')::boolean, false) and p_norm ->> 'tipo' <> 'ignorado' then 'campos obrigatórios não encontrados no evento (conferir formato do provedor)' end)
  on conflict (chave_idempotencia) do nothing
  returning * into ev;
  if ev.id is null then
    select * into ev from public.kiwify_eventos where chave_idempotencia = chave;
    return jsonb_build_object('id', ev.id, 'status', ev.status, 'duplicado', true);
  end if;
  return jsonb_build_object('id', ev.id, 'status', ev.status, 'duplicado', false);
end $$;

-- Loja do evento: pela assinatura já vinculada; senão pelo e-mail do dono. Mais de uma loja = revisão.
create or replace function public.loja_do_evento(ev public.kiwify_eventos, out loja uuid, out motivo text)
  language plpgsql stable security definer set search_path = public as $$
declare n int;
begin
  if ev.assinatura_id is not null then
    select id into loja from public.lojas where assinatura_externa_id = ev.assinatura_id;
    if loja is not null then return; end if;
  end if;
  select count(distinct m.loja_id) into n from public.membros m where m.papel = 'dono' and lower(m.email) = lower(trim(ev.email));
  if n = 1 then select m.loja_id into loja from public.membros m where m.papel = 'dono' and lower(m.email) = lower(trim(ev.email));
  elsif n > 1 then motivo := 'o e-mail é dono de mais de uma loja';
  else motivo := 'nenhuma loja com este e-mail de dono'; end if;
end $$;

-- ---------- Regras por evento (a única função que muda plano/situação) ----------
create or replace function public.aplicar_evento_pagamento(p_evento bigint) returns text
  language plpgsql security definer set search_path = public as $$
declare ev public.kiwify_eventos; map public.kiwify_produtos; l public.lojas; v_loja uuid; v_motivo text; prox timestamptz; res text;
begin
  select * into ev from public.kiwify_eventos where id = p_evento for update;
  if not found then return 'inexistente'; end if;
  if ev.status in ('aplicado', 'ignorado', 'rejeitado') then return ev.status; end if;   -- idempotente
  update public.kiwify_eventos set tentativas = tentativas + 1 where id = ev.id;
  if not ev.assinatura_valida then return 'rejeitado'; end if;
  if ev.tipo = 'ignorado' then update public.kiwify_eventos set status = 'ignorado', processado_em = now() where id = ev.id; return 'ignorado'; end if;

  select * into map from public.kiwify_produtos k where k.ativo and k.produto_id = ev.produto_id and (k.oferta_id is null or k.oferta_id = ev.oferta_id)
    order by k.oferta_id nulls last limit 1;
  if map.id is null then
    update public.kiwify_eventos set status = 'revisao', erro = 'produto/oferta sem mapeamento (cadastre em Admin → Produtos)', processado_em = now() where id = ev.id;
    return 'revisao';
  end if;

  select * into v_loja, v_motivo from public.loja_do_evento(ev);
  if v_loja is null then
    -- compra sem loja: entra na fila e é aplicada quando o dono se cadastrar com este e-mail
    res := case when ev.tipo in ('compra_aprovada', 'renovacao') and v_motivo like 'nenhuma%' then 'pendente_loja' else 'revisao' end;
    update public.kiwify_eventos set status = res, erro = v_motivo, processado_em = now() where id = ev.id;
    return res;
  end if;
  select * into l from public.lojas where id = v_loja for update;

  if map.tipo = 'plano' then
    prox := coalesce(ev.proxima_cobranca, now() + interval '30 days');
    if ev.tipo in ('compra_aprovada', 'renovacao') then
      if l.status_assinatura = 'bloqueada' then
        update public.kiwify_eventos set status = 'revisao', loja_id = l.id, erro = 'loja bloqueada (reembolso/chargeback/admin): reative pelo painel', processado_em = now() where id = ev.id;
        insert into public.plataforma_avisos(tipo, loja_id, texto, ref) values ('revisao', l.id, 'Pagamento recebido para loja bloqueada', ev.id::text);
        return 'revisao';
      end if;
      update public.lojas set plano_id = map.plano_id, status_assinatura = 'ativa', teste_ate = null, inadimplente_desde = null,
        proxima_cobranca = prox, periodo_pago_ate = greatest(coalesce(periodo_pago_ate, prox), prox),
        assinatura_externa_id = coalesce(ev.assinatura_id, assinatura_externa_id), comprador_email = coalesce(ev.email, comprador_email),
        assinatura_atualizada_em = now() where id = l.id;
      if l.plano_id is distinct from map.plano_id then perform public.ajustar_ao_plano(l.id); end if;
    elsif ev.tipo = 'atrasada' then
      update public.lojas set status_assinatura = 'inadimplente', inadimplente_desde = coalesce(inadimplente_desde, now()), assinatura_atualizada_em = now()
       where id = l.id and status_assinatura <> 'bloqueada';
    elsif ev.tipo = 'cancelada' then
      update public.lojas set status_assinatura = 'cancelada', periodo_pago_ate = coalesce(periodo_pago_ate, proxima_cobranca, now()), assinatura_atualizada_em = now()
       where id = l.id and status_assinatura <> 'bloqueada';
    elsif ev.tipo in ('reembolso', 'chargeback') then
      update public.lojas set status_assinatura = 'bloqueada', bloqueio_motivo = ev.tipo, assinatura_atualizada_em = now() where id = l.id;
      insert into public.plataforma_avisos(tipo, loja_id, texto, ref) values (ev.tipo, l.id, initcap(ev.tipo) || ' da assinatura: loja bloqueada', ev.id::text);
    end if;
  else
    -- pacote/nota avulsa (só Pro Max): créditos de notas (funções da etapa 5)
    if ev.tipo = 'compra_aprovada' then
      if not public.tem_recurso(l.id, 'nota_fiscal') or to_regprocedure('public.creditar_notas(uuid,integer,text,text)') is null then
        update public.kiwify_eventos set status = 'revisao', loja_id = l.id, erro = 'compra de notas para loja sem o plano Pro Max', processado_em = now() where id = ev.id;
        insert into public.plataforma_avisos(tipo, loja_id, texto, ref) values ('revisao', l.id, 'Compra de notas avulsas sem plano Pro Max', ev.id::text);
        return 'revisao';
      end if;
      execute 'select public.creditar_notas($1, $2, $3, $4)' using l.id, map.qtd_notas, 'compra', ev.id::text;
    elsif ev.tipo in ('reembolso', 'chargeback') then
      if to_regprocedure('public.estornar_creditos(uuid,integer,text)') is not null then
        execute 'select public.estornar_creditos($1, $2, $3)' using l.id, map.qtd_notas, ev.id::text;
      end if;
      insert into public.plataforma_avisos(tipo, loja_id, texto, ref) values (ev.tipo, l.id, initcap(ev.tipo) || ' de notas avulsas: créditos não usados retirados', ev.id::text);
    end if;
  end if;

  update public.kiwify_eventos set status = 'aplicado', loja_id = l.id, erro = null, processado_em = now() where id = ev.id;
  return 'aplicado';
exception when others then
  update public.kiwify_eventos set status = 'erro', erro = left(sqlerrm, 300), processado_em = now() where id = p_evento;
  return 'erro';
end $$;

-- Compras na fila: quando o dono se cadastra com o mesmo e-mail, aplica sozinho
create or replace function public.aplicar_pendentes_do_email() returns trigger
  language plpgsql security definer set search_path = public as $$
declare e bigint;
begin
  if new.papel = 'dono' and coalesce(new.email, '') <> '' then
    for e in select id from public.kiwify_eventos where status = 'pendente_loja' and lower(email) = lower(trim(new.email)) order by recebido_em loop
      update public.kiwify_eventos set status = 'recebido' where id = e;
      perform public.aplicar_evento_pagamento(e);
    end loop;
  end if;
  return new;
end $$;
drop trigger if exists membros_aplicar_pendentes on public.membros;
create trigger membros_aplicar_pendentes after insert on public.membros
  for each row execute function public.aplicar_pendentes_do_email();

-- Links de assinatura para o app (Meu plano)
create or replace function public.checkout_planos() returns jsonb
  language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'planos', coalesce((select jsonb_agg(jsonb_build_object('plano_id', plano_id, 'url', checkout_url) order by criado_em)
                        from public.kiwify_produtos where ativo and tipo = 'plano' and coalesce(checkout_url, '') <> ''), '[]'::jsonb),
    'notas', coalesce((select jsonb_agg(jsonb_build_object('qtd', qtd_notas, 'url', checkout_url, 'nome', nome) order by qtd_notas)
                       from public.kiwify_produtos where ativo and tipo = 'notas' and coalesce(checkout_url, '') <> ''), '[]'::jsonb),
    'area_cliente', (select valor #>> '{}' from public.plataforma_config where chave = 'kiwify_area_cliente_url'),
    'param_email', (select valor #>> '{}' from public.plataforma_config where chave = 'checkout_param_email'))
$$;

revoke all on function public.registrar_evento_pagamento(boolean, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.aplicar_evento_pagamento(bigint) from public, anon, authenticated;
revoke all on function public.loja_do_evento(public.kiwify_eventos) from public, anon, authenticated;
revoke all on function public.checkout_planos() from public, anon;
grant execute on function public.checkout_planos() to authenticated;
