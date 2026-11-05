-- =====================================================================
-- SaaS · Etapa 7: painel super admin
-- Quem é super admin fica numa tabela sem acesso pelo app. Toda função admin confere de novo
-- (além do middleware e da rota /api/admin). Toda ação grava auditoria (ator, ação, loja, antes/depois).
-- "Entrar como a loja" = acesso de suporte SOMENTE LEITURA por 2 horas, com aviso na tela e log.
-- ADITIVA. Reverter: 07_admin_reverter.sql
-- Depois de rodar, cadastre você como super admin (troque pelo SEU e-mail de login):
--   insert into public.super_admins(user_id) select id from auth.users where email = 'seu-email@exemplo.com';
-- =====================================================================

create table if not exists public.super_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  criado_em timestamptz not null default now()
);
alter table public.super_admins enable row level security;
revoke all on public.super_admins from anon, authenticated;

create table if not exists public.admin_auditoria (
  id bigserial primary key,
  ator uuid, ator_email text, acao text not null, loja_id uuid,
  antes jsonb, depois jsonb, motivo text,
  criado_em timestamptz not null default now()
);
create index if not exists admin_auditoria_data_idx on public.admin_auditoria(criado_em desc);
alter table public.admin_auditoria enable row level security;
revoke all on public.admin_auditoria from anon, authenticated;

create or replace function public.sou_super_admin() returns boolean
  language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.super_admins where user_id = auth.uid())
$$;

create or replace function public.exigir_admin() returns void
  language plpgsql stable security definer set search_path = public as $$
begin
  if not public.sou_super_admin() then raise exception 'acesso restrito ao administrador' using errcode = '42501'; end if;
end $$;

create or replace function public.auditar(p_acao text, p_loja uuid, p_antes jsonb, p_depois jsonb, p_motivo text) returns void
  language sql security definer set search_path = public as $$
  insert into public.admin_auditoria(ator, ator_email, acao, loja_id, antes, depois, motivo)
  values (auth.uid(), (select email from auth.users where id = auth.uid()), p_acao, p_loja, p_antes, p_depois, p_motivo)
$$;

-- Suporte: somente leitura (redefine a regra de gravação da etapa 2 acrescentando esta condição)
create or replace function public.pode_gravar_colecao(p_loja uuid, p_colecao text, p_id text) returns boolean
  language plpgsql stable security definer set search_path = public as $$
declare papel text := public.meu_papel(p_loja);
begin
  if papel is null or papel = 'suporte' or not public.pode_escrever(p_loja) then return false; end if;
  if p_colecao = 'meta' and p_id = 'settings' then return papel = 'dono'; end if;
  if papel = 'tecnico' and p_colecao in ('vendas', 'lancamentos', 'caixas') then return false; end if;
  if p_colecao = 'followups' then return public.tem_recurso(p_loja, 'followup'); end if;
  if p_colecao = 'metas_func' then return public.tem_recurso(p_loja, 'metas'); end if;
  if p_colecao in ('lotes', 'nfe_entradas') then return public.tem_recurso(p_loja, 'lotes') or public.tem_recurso(p_loja, 'importar_xml'); end if;
  return true;
end $$;

-- ---------- Leitura ----------
create or replace function public.admin_resumo() returns jsonb
  language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  perform public.exigir_admin();
  select jsonb_build_object(
    'lojas', (select count(*) from public.lojas),
    'por_plano', (select coalesce(jsonb_object_agg(coalesce(plano_id, 'sem'), n), '{}') from (select plano_id, count(*) n from public.lojas group by 1) x),
    'por_situacao', (select coalesce(jsonb_object_agg(s, n), '{}') from (select public.loja_situacao(id) s, count(*) n from public.lojas group by 1) x),
    'mrr', (select coalesce(sum(p.preco_mensal), 0) from public.lojas l join public.planos p on p.id = l.plano_id
              where not l.isenta and public.loja_situacao(l.id) in ('ativa', 'inadimplente') and l.status_assinatura <> 'teste'),
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
    select l.id, l.nome, l.slug, l.plano_id, l.status_assinatura, public.loja_situacao(l.id) as situacao, l.proxima_cobranca, l.isenta, l.criado_em,
      (select email from public.membros m where m.loja_id = l.id and m.papel = 'dono' order by m.criado_em limit 1) as dono_email,
      public.funcionarios_ativos(l.id) as funcionarios, public.limite_funcionarios(l.id) as limite,
      coalesce((select usadas from public.consumo_mensal c where c.loja_id = l.id and c.mes = public.mes_atual()), 0) as notas_mes,
      coalesce((select franquia_notas_mes from public.planos where id = public.loja_plano(l.id)), 0) as franquia,
      coalesce((select saldo from public.creditos k where k.loja_id = l.id), 0) as creditos,
      (select max(i.atualizado_em) from public.itens i where i.loja_id = l.id) as ultima_atividade
    from public.lojas l),
  filtro as (
    select * from base
    where (coalesce(p_busca, '') = '' or nome ilike '%' || p_busca || '%' or dono_email ilike '%' || p_busca || '%' or slug ilike '%' || p_busca || '%')
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

create or replace function public.admin_loja(p_loja uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
begin
  perform public.exigir_admin();
  return jsonb_build_object(
    'loja', (select to_jsonb(l) || jsonb_build_object('situacao', public.loja_situacao(l.id)) from public.lojas l where l.id = p_loja),
    'membros', (select coalesce(jsonb_agg(jsonb_build_object('email', email, 'nome', nome, 'papel', papel, 'ativo', ativo, 'criado_em', criado_em, 'expira_em', expira_em) order by criado_em), '[]') from public.membros where loja_id = p_loja),
    'pagamentos', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'recebido_em', recebido_em, 'tipo', tipo, 'status', status, 'erro', erro, 'produto_id', produto_id) order by recebido_em desc), '[]') from (select * from public.kiwify_eventos where loja_id = p_loja order by recebido_em desc limit 50) e),
    'creditos', (select coalesce(jsonb_agg(to_jsonb(c) order by c.criado_em desc), '[]') from (select * from public.creditos_mov where loja_id = p_loja order by criado_em desc limit 50) c),
    'notas', (select coalesce(jsonb_agg(jsonb_build_object('criado_em', criado_em, 'status', status, 'numero', numero, 'valor', valor, 'erro', erro, 'ambiente', ambiente) order by criado_em desc), '[]') from (select * from public.notas_fiscais where loja_id = p_loja order by criado_em desc limit 50) n),
    'consumo', (select coalesce(jsonb_agg(to_jsonb(c) order by c.mes desc), '[]') from (select * from public.consumo_mensal where loja_id = p_loja order by mes desc limit 12) c),
    'tema', (select to_jsonb(t) from public.lojas_tema t where t.loja_id = p_loja),
    'dominios', (select coalesce(jsonb_agg(to_jsonb(d)), '[]') from public.lojas_dominios d where d.loja_id = p_loja),
    'registros', (select count(*) from public.itens where loja_id = p_loja));
end $$;

create or replace function public.admin_eventos(p_status text, p_limite int, p_offset int) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
begin
  perform public.exigir_admin();
  return jsonb_build_object('total', (select count(*) from public.kiwify_eventos where coalesce(p_status, '') = '' or status = p_status),
    'eventos', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'recebido_em', e.recebido_em, 'tipo', e.tipo, 'tipo_original', e.tipo_original, 'status', e.status, 'email', e.email,
       'produto_id', e.produto_id, 'oferta_id', e.oferta_id, 'erro', e.erro, 'loja', (select nome from public.lojas where id = e.loja_id), 'valida', e.assinatura_valida, 'payload', e.payload))
     from (select * from public.kiwify_eventos where coalesce(p_status, '') = '' or status = p_status order by recebido_em desc
           limit least(coalesce(p_limite, 25), 100) offset greatest(coalesce(p_offset, 0), 0)) e), '[]'::jsonb));
end $$;

create or replace function public.admin_produtos() returns jsonb
  language plpgsql stable security definer set search_path = public as $$
begin
  perform public.exigir_admin();
  return jsonb_build_object('produtos', coalesce((select jsonb_agg(to_jsonb(k) order by k.criado_em) from public.kiwify_produtos k), '[]'),
    'planos', coalesce((select jsonb_agg(to_jsonb(p) order by p.ordem) from public.planos p), '[]'),
    'config', coalesce((select jsonb_object_agg(chave, valor) from public.plataforma_config), '{}'));
end $$;

create or replace function public.admin_avisos() returns jsonb
  language plpgsql stable security definer set search_path = public as $$
begin
  perform public.exigir_admin();
  return coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'tipo', a.tipo, 'texto', a.texto, 'lido', a.lido, 'criado_em', a.criado_em, 'loja_id', a.loja_id, 'loja', l.nome) order by a.criado_em desc)
    from (select * from public.plataforma_avisos order by criado_em desc limit 100) a left join public.lojas l on l.id = a.loja_id), '[]');
end $$;

create or replace function public.admin_consumo_notas(p_mes text) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
begin
  perform public.exigir_admin();
  return coalesce((select jsonb_agg(jsonb_build_object('loja', l.nome, 'loja_id', l.id, 'mes', p_mes,
      'franquia', (select count(*) from public.consumo_notas c where c.loja_id = l.id and c.mes = p_mes and c.origem = 'franquia'),
      'creditos', (select count(*) from public.consumo_notas c where c.loja_id = l.id and c.mes = p_mes and c.origem = 'credito'),
      'rejeitadas', (select count(*) from public.notas_fiscais n where n.loja_id = l.id and n.mes = p_mes and n.status in ('rejeitada', 'erro')),
      'canceladas', (select count(*) from public.notas_fiscais n where n.loja_id = l.id and n.mes = p_mes and n.status = 'cancelada')) order by l.nome)
    from public.lojas l where exists (select 1 from public.notas_fiscais n where n.loja_id = l.id and n.mes = p_mes)), '[]');
end $$;

create or replace function public.admin_auditoria_lista(p_limite int, p_offset int) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
begin
  perform public.exigir_admin();
  return jsonb_build_object('total', (select count(*) from public.admin_auditoria),
    'itens', coalesce((select jsonb_agg(jsonb_build_object('criado_em', a.criado_em, 'ator', a.ator_email, 'acao', a.acao, 'loja', l.nome, 'antes', a.antes, 'depois', a.depois, 'motivo', a.motivo) order by a.criado_em desc)
      from (select * from public.admin_auditoria order by criado_em desc limit least(coalesce(p_limite, 50), 200) offset greatest(coalesce(p_offset, 0), 0)) a
      left join public.lojas l on l.id = a.loja_id), '[]'));
end $$;

-- ---------- Ações (todas com auditoria) ----------
create or replace function public.admin_estado(p_loja uuid) returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('plano', plano_id, 'status', status_assinatura, 'cortesia_ate', cortesia_ate, 'bloqueio', bloqueio_motivo, 'situacao', public.loja_situacao(id))
  from public.lojas where id = p_loja
$$;

create or replace function public.admin_alterar_plano(p_loja uuid, p_plano text, p_motivo text) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare antes jsonb := public.admin_estado(p_loja); n int;
begin
  perform public.exigir_admin();
  if not exists (select 1 from public.planos where id = p_plano) then raise exception 'plano inexistente'; end if;
  update public.lojas set plano_id = p_plano, status_assinatura = case when status_assinatura = 'teste' then 'ativa' else status_assinatura end,
    teste_ate = null, assinatura_atualizada_em = now() where id = p_loja;
  n := public.ajustar_ao_plano(p_loja);
  perform public.auditar('alterar_plano', p_loja, antes, public.admin_estado(p_loja) || jsonb_build_object('desativados', n), p_motivo);
  return public.admin_estado(p_loja);
end $$;

create or replace function public.admin_cortesia(p_loja uuid, p_dias int, p_motivo text) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare antes jsonb := public.admin_estado(p_loja);
begin
  perform public.exigir_admin();
  if p_dias < 1 or p_dias > 365 then raise exception 'dias inválidos'; end if;
  update public.lojas set cortesia_ate = greatest(coalesce(cortesia_ate, now()), now()) + make_interval(days => p_dias) where id = p_loja;
  perform public.auditar('cortesia', p_loja, antes, public.admin_estado(p_loja), p_motivo);
  return public.admin_estado(p_loja);
end $$;

create or replace function public.admin_bloquear(p_loja uuid, p_bloquear boolean, p_motivo text) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare antes jsonb := public.admin_estado(p_loja);
begin
  perform public.exigir_admin();
  if p_bloquear then update public.lojas set status_assinatura = 'bloqueada', bloqueio_motivo = coalesce(p_motivo, 'admin') where id = p_loja;
  else update public.lojas set status_assinatura = 'ativa', bloqueio_motivo = null, inadimplente_desde = null where id = p_loja; end if;
  perform public.auditar(case when p_bloquear then 'bloquear' else 'reativar' end, p_loja, antes, public.admin_estado(p_loja), p_motivo);
  return public.admin_estado(p_loja);
end $$;

create or replace function public.admin_creditar(p_loja uuid, p_qtd int, p_motivo text) returns int
  language plpgsql security definer set search_path = public as $$
declare antes int := coalesce((select saldo from public.creditos where loja_id = p_loja), 0); depois int;
begin
  perform public.exigir_admin();
  if p_qtd = 0 or abs(p_qtd) > 10000 then raise exception 'quantidade inválida'; end if;
  if p_qtd > 0 then depois := public.creditar_notas(p_loja, p_qtd, 'admin', 'admin-' || gen_random_uuid());
  else perform public.estornar_creditos(p_loja, -p_qtd, 'admin-' || gen_random_uuid()); depois := coalesce((select saldo from public.creditos where loja_id = p_loja), 0); end if;
  perform public.auditar('creditos', p_loja, jsonb_build_object('saldo', antes), jsonb_build_object('saldo', depois), p_motivo);
  return depois;
end $$;

-- Entrar como a loja: vínculo de suporte (somente leitura) por 2 horas, com auditoria
create or replace function public.admin_entrar_como(p_loja uuid, p_motivo text) returns timestamptz
  language plpgsql security definer set search_path = public as $$
declare ate timestamptz := now() + interval '2 hours';
begin
  perform public.exigir_admin();
  if coalesce(trim(p_motivo), '') = '' then raise exception 'informe o motivo do acesso'; end if;
  if exists (select 1 from public.membros where loja_id = p_loja and user_id = auth.uid() and papel <> 'suporte') then raise exception 'você já faz parte desta loja'; end if;
  insert into public.membros(loja_id, user_id, email, nome, papel, expira_em) values (p_loja, auth.uid(), (select email from auth.users where id = auth.uid()), 'Suporte da plataforma', 'suporte', ate)
  on conflict (loja_id, user_id) do update set expira_em = ate, ativo = true;
  perform public.auditar('entrar_como', p_loja, null, jsonb_build_object('ate', ate), p_motivo);
  return ate;
end $$;

create or replace function public.admin_sair_da_loja(p_loja uuid) returns void
  language plpgsql security definer set search_path = public as $$
begin
  perform public.exigir_admin();
  delete from public.membros where loja_id = p_loja and user_id = auth.uid() and papel = 'suporte';
  perform public.auditar('sair_da_loja', p_loja, null, null, null);
end $$;

create or replace function public.admin_reprocessar_evento(p_evento bigint) returns text
  language plpgsql security definer set search_path = public as $$
declare ev public.kiwify_eventos; r text;
begin
  perform public.exigir_admin();
  select * into ev from public.kiwify_eventos where id = p_evento;
  if ev.id is null then raise exception 'evento não encontrado'; end if;
  if not ev.assinatura_valida then raise exception 'evento com assinatura inválida nunca é aplicado'; end if;
  if ev.status not in ('revisao', 'erro', 'pendente_loja') then raise exception 'só eventos em revisão, com erro ou na fila podem ser reprocessados'; end if;
  update public.kiwify_eventos set status = 'recebido' where id = p_evento;
  r := public.aplicar_evento_pagamento(p_evento);
  perform public.auditar('reprocessar_evento', ev.loja_id, jsonb_build_object('evento', p_evento, 'status', ev.status), jsonb_build_object('status', r), null);
  return r;
end $$;

-- Fila "compras sem loja": vincular manualmente a uma loja (quando o e-mail da compra é diferente)
create or replace function public.admin_vincular_compra(p_evento bigint, p_loja uuid, p_motivo text) returns text
  language plpgsql security definer set search_path = public as $$
declare ev public.kiwify_eventos; r text;
begin
  perform public.exigir_admin();
  select * into ev from public.kiwify_eventos where id = p_evento;
  if ev.id is null or not ev.assinatura_valida then raise exception 'evento inválido'; end if;
  if coalesce(trim(p_motivo), '') = '' then raise exception 'informe o motivo'; end if;
  update public.lojas set assinatura_externa_id = coalesce(ev.assinatura_id, assinatura_externa_id) where id = p_loja;
  if ev.assinatura_id is null then raise exception 'evento sem id de assinatura: não dá para vincular com segurança'; end if;
  update public.kiwify_eventos set status = 'recebido' where id = p_evento;
  r := public.aplicar_evento_pagamento(p_evento);
  perform public.auditar('vincular_compra', p_loja, jsonb_build_object('evento', p_evento, 'email', ev.email), jsonb_build_object('status', r), p_motivo);
  return r;
end $$;

create or replace function public.admin_salvar_produto(p jsonb) returns uuid
  language plpgsql security definer set search_path = public as $$
declare v_id uuid; antes jsonb;
begin
  perform public.exigir_admin();
  if nullif(p ->> 'id', '') is not null then
    select to_jsonb(k) into antes from public.kiwify_produtos k where id = (p ->> 'id')::uuid;
    update public.kiwify_produtos set produto_id = p ->> 'produto_id', oferta_id = nullif(p ->> 'oferta_id', ''), nome = coalesce(p ->> 'nome', ''), tipo = p ->> 'tipo',
      plano_id = nullif(p ->> 'plano_id', ''), qtd_notas = nullif(p ->> 'qtd_notas', '')::int, checkout_url = nullif(p ->> 'checkout_url', ''),
      ativo = coalesce((p ->> 'ativo')::boolean, true) where id = (p ->> 'id')::uuid returning id into v_id;
  else
    insert into public.kiwify_produtos(produto_id, oferta_id, nome, tipo, plano_id, qtd_notas, checkout_url, ativo)
    values (p ->> 'produto_id', nullif(p ->> 'oferta_id', ''), coalesce(p ->> 'nome', ''), p ->> 'tipo', nullif(p ->> 'plano_id', ''), nullif(p ->> 'qtd_notas', '')::int,
            nullif(p ->> 'checkout_url', ''), coalesce((p ->> 'ativo')::boolean, true)) returning id into v_id;
  end if;
  perform public.auditar('produto', null, antes, (select to_jsonb(k) from public.kiwify_produtos k where id = v_id), null);
  return v_id;
end $$;

create or replace function public.admin_salvar_plano(p_id text, p_preco numeric, p_max int, p_franquia int) returns void
  language plpgsql security definer set search_path = public as $$
declare antes jsonb;
begin
  perform public.exigir_admin();
  select to_jsonb(p) into antes from public.planos p where id = p_id;
  if antes is null then raise exception 'plano inexistente'; end if;
  update public.planos set preco_mensal = p_preco, max_funcionarios = coalesce(p_max, max_funcionarios), franquia_notas_mes = coalesce(p_franquia, franquia_notas_mes), atualizado_em = now() where id = p_id;
  perform public.auditar('plano', null, antes, (select to_jsonb(p) from public.planos p where id = p_id), null);
end $$;

create or replace function public.admin_config(p_chave text, p_valor jsonb) returns void
  language plpgsql security definer set search_path = public as $$
declare antes jsonb;
begin
  perform public.exigir_admin();
  if p_chave not in ('kiwify_area_cliente_url', 'checkout_param_email', 'dias_teste', 'tolerancia_atraso_dias', 'dominios_base', 'plano_teste') then raise exception 'configuração não editável'; end if;
  select valor into antes from public.plataforma_config where chave = p_chave;
  insert into public.plataforma_config(chave, valor) values (p_chave, p_valor) on conflict (chave) do update set valor = excluded.valor, atualizado_em = now();
  perform public.auditar('config', null, jsonb_build_object(p_chave, antes), jsonb_build_object(p_chave, p_valor), null);
end $$;

create or replace function public.admin_verificar_dominio(p_dominio text, p_ok boolean) returns void
  language plpgsql security definer set search_path = public as $$
declare l uuid;
begin
  perform public.exigir_admin();
  update public.lojas_dominios set verificado = p_ok where dominio = lower(p_dominio) returning loja_id into l;
  perform public.auditar(case when p_ok then 'dominio_ativado' else 'dominio_desativado' end, l, null, jsonb_build_object('dominio', p_dominio), null);
end $$;

create or replace function public.admin_aviso_lido(p_id bigint) returns void
  language plpgsql security definer set search_path = public as $$
begin
  perform public.exigir_admin();
  update public.plataforma_avisos set lido = true where id = p_id;
end $$;

-- permissões: o app só consegue perguntar "sou admin?"; o resto confere exigir_admin()
do $$ declare f text; begin
  foreach f in array array['admin_resumo()', 'admin_lojas(text,text,text,text,int,int)', 'admin_loja(uuid)', 'admin_eventos(text,int,int)', 'admin_produtos()',
    'admin_avisos()', 'admin_consumo_notas(text)', 'admin_auditoria_lista(int,int)', 'admin_alterar_plano(uuid,text,text)', 'admin_cortesia(uuid,int,text)',
    'admin_bloquear(uuid,boolean,text)', 'admin_creditar(uuid,int,text)', 'admin_entrar_como(uuid,text)', 'admin_sair_da_loja(uuid)',
    'admin_reprocessar_evento(bigint)', 'admin_vincular_compra(bigint,uuid,text)', 'admin_salvar_produto(jsonb)', 'admin_salvar_plano(text,numeric,int,int)',
    'admin_config(text,jsonb)', 'admin_verificar_dominio(text,boolean)', 'admin_aviso_lido(bigint)', 'sou_super_admin()'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
revoke all on function public.exigir_admin() from public, anon, authenticated;
revoke all on function public.auditar(text, uuid, jsonb, jsonb, text) from public, anon, authenticated;
revoke all on function public.admin_estado(uuid) from public, anon, authenticated;
