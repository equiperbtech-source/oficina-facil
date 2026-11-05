-- =====================================================================
-- SaaS · Etapa 14: segunda plataforma de pagamento (Hotmart) junto com a Kiwify.
-- - Cada evento e cada produto guardam de qual plataforma vieram (kiwify | hotmart).
-- - A loja guarda por onde assina (provedor_pagamento): aparece no painel admin.
-- - Lojas da Hotmart (ou em espanhol, antes de comprar) veem no app os preços e links da Hotmart
--   (pesos chilenos); as demais seguem com a Kiwify (reais).
-- - Aviso cancelado/atrasado de uma plataforma não derruba a assinatura ativa na outra:
--   fica registrado e vira aviso no painel para revisar.
-- ADITIVA. Reverter: 14_hotmart_reverter.sql
-- =====================================================================

alter table public.lojas add column if not exists provedor_pagamento text;
do $$ begin
  alter table public.lojas add constraint lojas_provedor_pagamento_ok check (provedor_pagamento is null or provedor_pagamento in ('kiwify', 'hotmart'));
exception when duplicate_object then null; end $$;

alter table public.kiwify_produtos add column if not exists provedor text not null default 'kiwify';
do $$ begin
  alter table public.kiwify_produtos add constraint kiwify_produtos_provedor_ok check (provedor in ('kiwify', 'hotmart'));
exception when duplicate_object then null; end $$;
drop index if exists public.kiwify_produtos_unico;
create unique index if not exists kiwify_produtos_unico_prov on public.kiwify_produtos (provedor, produto_id, coalesce(oferta_id, ''));

do $$ begin
  alter table public.kiwify_eventos add constraint kiwify_eventos_provedor_ok check (provedor in ('kiwify', 'hotmart'));
exception when duplicate_object then null; end $$;
create index if not exists kiwify_eventos_provedor_idx on public.kiwify_eventos(provedor, recebido_em desc);

-- lojas que já assinam: origem pelo último pagamento aplicado (hoje, todas da Kiwify)
update public.lojas l set provedor_pagamento = (
    select e.provedor from public.kiwify_eventos e
     where e.loja_id = l.id and e.status = 'aplicado' and e.tipo in ('compra_aprovada', 'renovacao') order by e.recebido_em desc limit 1)
 where l.provedor_pagamento is null
   and exists (select 1 from public.kiwify_eventos e where e.loja_id = l.id and e.status = 'aplicado' and e.tipo in ('compra_aprovada', 'renovacao'));

insert into public.plataforma_config(chave, valor) values
  ('hotmart_area_cliente_url', '""'::jsonb),
  -- preços mostrados no app para quem assina pela Hotmart (o valor cobrado é o do produto na Hotmart)
  ('precos_hotmart', '{"moeda": "CLP", "essencial": 20000, "pro": 34000}'::jsonb)
on conflict (chave) do nothing;

-- ---------- Registro idempotente: agora com a plataforma ----------
create or replace function public.registrar_evento_pagamento(p_valido boolean, p_norm jsonb, p_payload jsonb) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare ev public.kiwify_eventos; chave text := nullif(p_norm ->> 'chave', '');
  prov text := case when p_norm ->> 'provedor' = 'hotmart' then 'hotmart' else 'kiwify' end;
begin
  if not p_valido then
    insert into public.kiwify_eventos(provedor, assinatura_valida, tipo_original, payload, status, erro)
      values (prov, false, left(p_norm ->> 'tipo_original', 80), p_payload, 'rejeitado', 'assinatura do webhook inválida') returning * into ev;
    return jsonb_build_object('id', ev.id, 'status', ev.status, 'duplicado', false);
  end if;
  insert into public.kiwify_eventos(provedor, assinatura_valida, chave_idempotencia, tipo, tipo_original, email, produto_id, oferta_id, pedido_id, assinatura_id, proxima_cobranca, payload, status, erro)
  values (prov, true, chave, p_norm ->> 'tipo', left(p_norm ->> 'tipo_original', 80), lower(trim(p_norm ->> 'email')), p_norm ->> 'produto_id', nullif(p_norm ->> 'oferta_id', ''),
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

-- ---------- Regras por evento (a única função que muda plano/situação) ----------
create or replace function public.aplicar_evento_pagamento(p_evento bigint) returns text
  language plpgsql security definer set search_path = public as $$
declare ev public.kiwify_eventos; map public.kiwify_produtos; l public.lojas; v_loja uuid; v_motivo text; prox timestamptz; res text;
  nome_prov text; outra_ativa boolean;
begin
  select * into ev from public.kiwify_eventos where id = p_evento for update;
  if not found then return 'inexistente'; end if;
  if ev.status in ('aplicado', 'ignorado', 'rejeitado') then return ev.status; end if;   -- idempotente
  update public.kiwify_eventos set tentativas = tentativas + 1 where id = ev.id;
  if not ev.assinatura_valida then return 'rejeitado'; end if;
  if ev.tipo = 'ignorado' then update public.kiwify_eventos set status = 'ignorado', processado_em = now() where id = ev.id; return 'ignorado'; end if;
  nome_prov := initcap(ev.provedor);

  -- Hotmart: a oferta (código "off=" do link de checkout) já identifica o plano, mesmo sem o ID numérico do produto
  select * into map from public.kiwify_produtos k where k.ativo and k.provedor = ev.provedor
     and (k.produto_id = ev.produto_id or (ev.provedor = 'hotmart' and k.oferta_id is not null and k.oferta_id = ev.oferta_id))
     and (k.oferta_id is null or k.oferta_id = ev.oferta_id)
    order by k.oferta_id nulls last limit 1;
  -- Hotmart: cancelamento/atraso/reembolso podem vir sem a oferta. Só vale para a assinatura já ligada a uma loja
  -- (nunca pelo e-mail: avisos de outros produtos da mesma conta Hotmart não mexem em loja nenhuma)
  if map.id is null and ev.provedor = 'hotmart' and ev.tipo in ('atrasada', 'cancelada', 'reembolso', 'chargeback')
     and ev.assinatura_id is not null and exists (select 1 from public.lojas where assinatura_externa_id = ev.assinatura_id and provedor_pagamento = 'hotmart') then
    select * into map from public.kiwify_produtos k where k.ativo and k.provedor = 'hotmart' and k.tipo = 'plano' order by k.criado_em limit 1;
  end if;
  if map.id is null then
    update public.kiwify_eventos set status = 'revisao', erro = 'produto/oferta da ' || nome_prov || ' sem mapeamento (cadastre em Admin → Produtos)', processado_em = now() where id = ev.id;
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
  -- a loja já assina pela outra plataforma e o período pago ainda vale
  outra_ativa := l.provedor_pagamento is not null and l.provedor_pagamento <> ev.provedor
    and l.status_assinatura in ('ativa', 'inadimplente') and coalesce(l.periodo_pago_ate, l.proxima_cobranca, now()) > now();

  if map.tipo = 'plano' then
    prox := coalesce(ev.proxima_cobranca, now() + interval '30 days');
    if ev.tipo in ('compra_aprovada', 'renovacao') then
      if l.status_assinatura = 'bloqueada' then
        update public.kiwify_eventos set status = 'revisao', loja_id = l.id, erro = 'loja bloqueada (reembolso/chargeback/admin): reative pelo painel', processado_em = now() where id = ev.id;
        insert into public.plataforma_avisos(tipo, loja_id, texto, ref) values ('revisao', l.id, 'Pagamento recebido (' || nome_prov || ') para loja bloqueada', ev.id::text);
        return 'revisao';
      end if;
      if outra_ativa then
        insert into public.plataforma_avisos(tipo, loja_id, texto, ref) values ('revisao', l.id,
          'Possível cobrança em dobro: a loja assinava pela ' || initcap(l.provedor_pagamento) || ' e agora pagou pela ' || nome_prov || '. Cancele uma das assinaturas.', ev.id::text);
      end if;
      update public.lojas set plano_id = map.plano_id, status_assinatura = 'ativa', teste_ate = null, inadimplente_desde = null,
        proxima_cobranca = prox, periodo_pago_ate = greatest(coalesce(periodo_pago_ate, prox), prox),
        assinatura_externa_id = coalesce(ev.assinatura_id, assinatura_externa_id), comprador_email = coalesce(ev.email, comprador_email),
        provedor_pagamento = ev.provedor, assinatura_atualizada_em = now() where id = l.id;
      if l.plano_id is distinct from map.plano_id then perform public.ajustar_ao_plano(l.id); end if;
    elsif ev.tipo = 'troca_plano' then
      -- troca de plano na plataforma (ex.: Esencial → Pro): o plano muda na hora; datas e situação seguem iguais
      if l.status_assinatura = 'bloqueada' or outra_ativa then
        update public.kiwify_eventos set status = 'revisao', loja_id = l.id,
          erro = case when outra_ativa then 'troca de plano na ' || nome_prov || ', mas a loja assina pela ' || initcap(l.provedor_pagamento) else 'loja bloqueada: reative pelo painel' end,
          processado_em = now() where id = ev.id;
        return 'revisao';
      end if;
      update public.lojas set plano_id = map.plano_id, provedor_pagamento = ev.provedor,
        assinatura_externa_id = coalesce(ev.assinatura_id, assinatura_externa_id), assinatura_atualizada_em = now() where id = l.id;
      if l.plano_id is distinct from map.plano_id then perform public.ajustar_ao_plano(l.id); end if;
    elsif ev.tipo in ('atrasada', 'cancelada') and outra_ativa then
      -- aviso da plataforma antiga não derruba a assinatura que está em dia na outra
      insert into public.plataforma_avisos(tipo, loja_id, texto, ref) values ('revisao', l.id,
        initcap(ev.tipo) || ' na ' || nome_prov || ', mas a loja assina pela ' || initcap(l.provedor_pagamento) || ': nada foi alterado.', ev.id::text);
    elsif ev.tipo = 'atrasada' then
      update public.lojas set status_assinatura = 'inadimplente', inadimplente_desde = coalesce(inadimplente_desde, now()), assinatura_atualizada_em = now()
       where id = l.id and status_assinatura <> 'bloqueada';
    elsif ev.tipo = 'cancelada' then
      update public.lojas set status_assinatura = 'cancelada', periodo_pago_ate = coalesce(periodo_pago_ate, proxima_cobranca, now()), assinatura_atualizada_em = now()
       where id = l.id and status_assinatura <> 'bloqueada';
    elsif ev.tipo in ('reembolso', 'chargeback') then
      update public.lojas set status_assinatura = 'bloqueada', bloqueio_motivo = ev.tipo, assinatura_atualizada_em = now() where id = l.id;
      insert into public.plataforma_avisos(tipo, loja_id, texto, ref) values (ev.tipo, l.id, initcap(ev.tipo) || ' da assinatura (' || nome_prov || '): loja bloqueada', ev.id::text);
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

-- ---------- Plataforma, preços e links que a loja vê em "Meu plano" ----------
-- O idioma da tela de quem está usando (p_idioma) decide, em teste ou já assinando:
-- português → reais e Kiwify; espanhol → pesos chilenos e Hotmart.
-- Sem p_idioma: a plataforma em que a loja assina; senão o idioma da loja.
drop function if exists public.provedor_da_loja(uuid);
drop function if exists public.checkout_da_loja(uuid);
create or replace function public.provedor_da_loja(p_loja uuid, p_idioma text default null) returns text
  language sql stable security definer set search_path = public as $$
  select case when p_idioma = 'es' then 'hotmart' when p_idioma = 'pt' then 'kiwify' else
    coalesce((select provedor_pagamento from public.lojas where id = p_loja),
      case when (select idioma from public.lojas_tema where loja_id = p_loja) = 'es' then 'hotmart' else 'kiwify' end) end
$$;

create or replace function public.checkout_da_loja(p_loja uuid, p_idioma text default null) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
declare prov text; precos jsonb; assina text;
begin
  if not exists (select 1 from public.membros where loja_id = p_loja and user_id = auth.uid()) then raise exception 'sem acesso a esta loja'; end if;
  prov := public.provedor_da_loja(p_loja, p_idioma);
  -- cartão e cancelamento: sempre na plataforma em que a loja assina de verdade
  assina := coalesce((select provedor_pagamento from public.lojas where id = p_loja), prov);
  if prov = 'hotmart' then
    precos := coalesce((select valor from public.plataforma_config where chave = 'precos_hotmart'), '{}'::jsonb);
  else
    precos := jsonb_build_object('moeda', 'BRL') || coalesce((select jsonb_object_agg(id, preco_mensal) from public.planos where preco_mensal is not null), '{}'::jsonb);
  end if;
  return jsonb_build_object(
    'provedor', prov,
    'moeda', coalesce(precos ->> 'moeda', 'BRL'),
    'precos', precos - 'moeda',
    -- um link por plano (o primeiro cadastrado com link), mesmo que o plano tenha mais de uma linha (oferta e ID do plano)
    'planos', coalesce((select jsonb_agg(jsonb_build_object('plano_id', plano_id, 'url', checkout_url) order by criado_em) from (
                          select distinct on (plano_id) plano_id, checkout_url, criado_em from public.kiwify_produtos
                           where ativo and provedor = prov and tipo = 'plano' and coalesce(checkout_url, '') <> '' order by plano_id, criado_em) x), '[]'::jsonb),
    'notas', coalesce((select jsonb_agg(jsonb_build_object('qtd', qtd_notas, 'url', checkout_url, 'nome', nome) order by qtd_notas)
                       from public.kiwify_produtos where ativo and provedor = prov and tipo = 'notas' and coalesce(checkout_url, '') <> ''), '[]'::jsonb),
    'assina_por', (select provedor_pagamento from public.lojas where id = p_loja),
    'area_cliente', (select valor #>> '{}' from public.plataforma_config where chave = assina || '_area_cliente_url'),
    'param_email', case when prov = 'kiwify' then (select valor #>> '{}' from public.plataforma_config where chave = 'checkout_param_email') end);
end $$;

-- ---------- Painel admin: origem de cada loja e de cada pagamento ----------
create or replace function public.admin_resumo() returns jsonb
  language plpgsql stable security definer set search_path = public as $$
declare r jsonb; ph jsonb := coalesce((select valor from public.plataforma_config where chave = 'precos_hotmart'), '{}'::jsonb);
begin
  perform public.exigir_admin();
  select jsonb_build_object(
    'lojas', (select count(*) from public.lojas),
    'por_plano', (select coalesce(jsonb_object_agg(coalesce(plano_id, 'sem'), n), '{}') from (select plano_id, count(*) n from public.lojas group by 1) x),
    'por_situacao', (select coalesce(jsonb_object_agg(s, n), '{}') from (select public.loja_situacao(id) s, count(*) n from public.lojas group by 1) x),
    -- lojas pagantes por plataforma
    'por_origem', (select coalesce(jsonb_object_agg(coalesce(provedor_pagamento, 'sem'), n), '{}') from (select provedor_pagamento, count(*) n from public.lojas
                    where not isenta and public.loja_situacao(id) in ('ativa', 'inadimplente') and status_assinatura <> 'teste' group by 1) x),
    -- receita mensal: Kiwify (e lojas sem origem) em reais; Hotmart na moeda dela
    'mrr', (select coalesce(sum(p.preco_mensal), 0) from public.lojas l join public.planos p on p.id = l.plano_id
              where not l.isenta and coalesce(l.provedor_pagamento, 'kiwify') = 'kiwify' and public.loja_situacao(l.id) in ('ativa', 'inadimplente') and l.status_assinatura <> 'teste'),
    'mrr_hotmart', (select coalesce(sum((ph ->> l.plano_id)::numeric), 0) from public.lojas l
              where not l.isenta and l.provedor_pagamento = 'hotmart' and public.loja_situacao(l.id) in ('ativa', 'inadimplente') and l.status_assinatura <> 'teste'
                and (ph ->> l.plano_id) ~ '^[0-9.]+$'),
    'moeda_hotmart', coalesce(ph ->> 'moeda', 'CLP'),
    'novas_mes', (select count(*) from public.lojas where criado_em >= date_trunc('month', now())),
    'notas_mes', (select count(*) from public.consumo_notas where mes = public.mes_atual()),
    'eventos_pendentes', (select count(*) from public.kiwify_eventos where status in ('revisao', 'erro', 'pendente_loja')),
    'avisos', (select count(*) from public.plataforma_avisos where not lido)) into r;
  return r;
end $$;

create or replace function public.admin_lojas(p_busca text, p_plano text, p_situacao text, p_ordem text, p_limite int, p_offset int) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  perform public.exigir_admin();
  with base as (
    select l.id, l.nome, l.slug, l.plano_id, l.status_assinatura, public.loja_situacao(l.id) as situacao, l.proxima_cobranca, l.isenta, l.criado_em, l.provedor_pagamento,
      (select email from public.membros m where m.loja_id = l.id and m.papel = 'dono' order by m.criado_em limit 1) as dono_email,
      public.funcionarios_ativos(l.id) as funcionarios, public.limite_funcionarios(l.id) as limite,
      coalesce((select usadas from public.consumo_mensal c where c.loja_id = l.id and c.mes = public.mes_atual()), 0) as notas_mes,
      coalesce((select franquia_notas_mes from public.planos where id = public.loja_plano(l.id)), 0) as franquia,
      coalesce((select saldo from public.creditos k where k.loja_id = l.id), 0) as creditos,
      (select max(i.atualizado_em) from public.itens i where i.loja_id = l.id) as ultima_atividade
    from public.lojas l),
  filtro as (
    select * from base
    where (coalesce(p_busca, '') = '' or nome ilike '%' || p_busca || '%' or dono_email ilike '%' || p_busca || '%' or slug ilike '%' || p_busca || '%'
           or provedor_pagamento = lower(p_busca))
      and (coalesce(p_plano, '') = '' or plano_id = p_plano)
      and (coalesce(p_situacao, '') = '' or situacao = p_situacao))
  select jsonb_build_object('total', (select count(*) from filtro), 'lojas', coalesce((select jsonb_agg(to_jsonb(f)) from (
    select * from filtro order by
      case when p_ordem = 'nome' then nome end asc,
      case when p_ordem = 'proxima_cobranca' then proxima_cobranca end asc nulls last,
      case when p_ordem = 'atividade' then ultima_atividade end desc nulls last,
      criado_em desc
    limit least(coalesce(p_limite, 25), 100) offset greatest(coalesce(p_offset, 0), 0)) f), '[]'::jsonb)) into r;
  return r;
end $$;

create or replace function public.admin_eventos(p_status text, p_limite int, p_offset int) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
begin
  perform public.exigir_admin();
  return jsonb_build_object('total', (select count(*) from public.kiwify_eventos where coalesce(p_status, '') = '' or status = p_status),
    'eventos', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'recebido_em', e.recebido_em, 'provedor', e.provedor, 'tipo', e.tipo, 'tipo_original', e.tipo_original, 'status', e.status, 'email', e.email,
       'produto_id', e.produto_id, 'oferta_id', e.oferta_id, 'erro', e.erro, 'loja', (select nome from public.lojas where id = e.loja_id), 'valida', e.assinatura_valida, 'payload', e.payload))
     from (select * from public.kiwify_eventos where coalesce(p_status, '') = '' or status = p_status order by recebido_em desc
           limit least(coalesce(p_limite, 25), 100) offset greatest(coalesce(p_offset, 0), 0)) e), '[]'::jsonb));
end $$;

create or replace function public.admin_salvar_produto(p jsonb) returns uuid
  language plpgsql security definer set search_path = public as $$
declare v_id uuid; antes jsonb; prov text := case when p ->> 'provedor' = 'hotmart' then 'hotmart' else 'kiwify' end;
begin
  perform public.exigir_admin();
  if nullif(p ->> 'id', '') is not null then
    select to_jsonb(k) into antes from public.kiwify_produtos k where id = (p ->> 'id')::uuid;
    update public.kiwify_produtos set provedor = prov, produto_id = p ->> 'produto_id', oferta_id = nullif(p ->> 'oferta_id', ''), nome = coalesce(p ->> 'nome', ''), tipo = p ->> 'tipo',
      plano_id = nullif(p ->> 'plano_id', ''), qtd_notas = nullif(p ->> 'qtd_notas', '')::int, checkout_url = nullif(p ->> 'checkout_url', ''),
      ativo = coalesce((p ->> 'ativo')::boolean, true) where id = (p ->> 'id')::uuid returning id into v_id;
  else
    insert into public.kiwify_produtos(provedor, produto_id, oferta_id, nome, tipo, plano_id, qtd_notas, checkout_url, ativo)
    values (prov, p ->> 'produto_id', nullif(p ->> 'oferta_id', ''), coalesce(p ->> 'nome', ''), p ->> 'tipo', nullif(p ->> 'plano_id', ''), nullif(p ->> 'qtd_notas', '')::int,
            nullif(p ->> 'checkout_url', ''), coalesce((p ->> 'ativo')::boolean, true)) returning id into v_id;
  end if;
  perform public.auditar('produto', null, antes, (select to_jsonb(k) from public.kiwify_produtos k where id = v_id), null);
  return v_id;
end $$;

create or replace function public.admin_config(p_chave text, p_valor jsonb) returns void
  language plpgsql security definer set search_path = public as $$
declare antes jsonb;
begin
  perform public.exigir_admin();
  if p_chave not in ('kiwify_area_cliente_url', 'hotmart_area_cliente_url', 'precos_hotmart', 'checkout_param_email', 'dias_teste', 'tolerancia_atraso_dias', 'dominios_base', 'plano_teste') then raise exception 'configuração não editável'; end if;
  if p_chave = 'precos_hotmart' and (jsonb_typeof(p_valor) <> 'object' or coalesce(p_valor ->> 'moeda', '') !~ '^[A-Z]{3}$') then raise exception 'preços da Hotmart: informe a moeda (ex.: CLP) e os valores'; end if;
  select valor into antes from public.plataforma_config where chave = p_chave;
  insert into public.plataforma_config(chave, valor) values (p_chave, p_valor) on conflict (chave) do update set valor = excluded.valor, atualizado_em = now();
  perform public.auditar('config', null, jsonb_build_object(p_chave, antes), jsonb_build_object(p_chave, p_valor), null);
end $$;

revoke all on function public.registrar_evento_pagamento(boolean, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.aplicar_evento_pagamento(bigint) from public, anon, authenticated;
revoke all on function public.provedor_da_loja(uuid, text) from public, anon, authenticated;
revoke all on function public.checkout_da_loja(uuid, text) from public, anon;
grant execute on function public.checkout_da_loja(uuid, text) to authenticated;
revoke all on function public.admin_resumo() from public, anon;
revoke all on function public.admin_lojas(text, text, text, text, int, int) from public, anon;
revoke all on function public.admin_eventos(text, int, int) from public, anon;
revoke all on function public.admin_salvar_produto(jsonb) from public, anon;
revoke all on function public.admin_config(text, jsonb) from public, anon;
grant execute on function public.admin_resumo(), public.admin_lojas(text, text, text, text, int, int), public.admin_eventos(text, int, int),
  public.admin_salvar_produto(jsonb), public.admin_config(text, jsonb) to authenticated;
