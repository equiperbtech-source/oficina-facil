-- =====================================================================
-- SaaS · Etapa 2: planos, recursos, situação da assinatura, papéis e limites
-- ADITIVA: cria tabelas/colunas/funções e acrescenta condições às regras (RLS).
-- Nenhum registro de dados da loja (itens) é criado, alterado ou apagado.
-- A loja padrão (sua loja) fica no Pro Max, ativa e isenta de cobrança.
-- Reverter: 02_planos_reverter.sql
-- =====================================================================

-- ---------- Planos (tabela global, leitura pública) ----------
create table if not exists public.planos (
  id text primary key,
  nome text not null,
  preco_mensal numeric(10,2),             -- null = a definir
  max_funcionarios int not null,          -- sem contar o dono
  franquia_notas_mes int not null default 0,
  recursos text[] not null default '{}',
  ordem int not null default 0,
  ativo boolean not null default true,
  atualizado_em timestamptz not null default now()
);
alter table public.planos enable row level security;
drop policy if exists planos_ler on public.planos;
create policy planos_ler on public.planos for select using (true);
grant select on public.planos to anon, authenticated;

insert into public.planos(id, nome, preco_mensal, max_funcionarios, franquia_notas_mes, recursos, ordem) values
  ('essencial', 'Essencial', 49.99, 4, 0,
    array['acompanhamento_os', 'importar_xml', 'lotes', 'tema'], 1),
  ('pro', 'Pro', 89.99, 4, 0,
    array['acompanhamento_os', 'importar_xml', 'lotes', 'tema',
          'modulos_personalizaveis', 'followup', 'metas', 'vitrine', 'dominio_proprio'], 2),
  ('pro_max', 'Pro Max', null, 5, 40,
    array['acompanhamento_os', 'importar_xml', 'lotes', 'tema',
          'modulos_personalizaveis', 'followup', 'metas', 'vitrine', 'dominio_proprio', 'nota_fiscal'], 3)
on conflict (id) do nothing;
-- Oficina Simples: nota fiscal fica fora do produto (o plano Pro Max não é vendido)
update public.planos set ativo = false where id = 'pro_max' and ativo;

insert into public.plataforma_config(chave, valor) values
  ('dias_teste', '7'::jsonb),
  ('tolerancia_atraso_dias', '5'::jsonb),
  ('plano_teste', '"pro"'::jsonb)
on conflict (chave) do nothing;

-- ---------- Assinatura da loja (colunas novas em lojas) ----------
alter table public.lojas add column if not exists plano_id text references public.planos(id);
alter table public.lojas add column if not exists status_assinatura text not null default 'teste';
alter table public.lojas add column if not exists teste_ate timestamptz;
alter table public.lojas add column if not exists proxima_cobranca timestamptz;
alter table public.lojas add column if not exists periodo_pago_ate timestamptz;
alter table public.lojas add column if not exists inadimplente_desde timestamptz;
alter table public.lojas add column if not exists cortesia_ate timestamptz;
alter table public.lojas add column if not exists isenta boolean not null default false;
alter table public.lojas add column if not exists bloqueio_motivo text;
alter table public.lojas add column if not exists assinatura_atualizada_em timestamptz;
do $$ begin
  alter table public.lojas add constraint lojas_status_assinatura_ok
    check (status_assinatura in ('teste', 'ativa', 'inadimplente', 'cancelada', 'bloqueada'));
exception when duplicate_object then null; end $$;

-- Lojas que já existiam: a loja padrão (sua) vira Pro Max ativa e isenta; outras ganham o teste do Pro.
update public.lojas set plano_id = 'pro_max', status_assinatura = 'ativa', isenta = true, assinatura_atualizada_em = now()
 where plano_id is null and id = (select (valor #>> '{}')::uuid from public.plataforma_config where chave = 'loja_padrao');
update public.lojas set plano_id = 'pro', status_assinatura = 'teste', teste_ate = now() + interval '7 days', assinatura_atualizada_em = now()
 where plano_id is null;

-- Toda loja nova nasce no teste grátis do Pro (sem dados: só o plano)
create or replace function public.lojas_padrao_assinatura() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if new.plano_id is null then
    new.plano_id := coalesce((select valor #>> '{}' from public.plataforma_config where chave = 'plano_teste'), 'pro');
    new.status_assinatura := 'teste';
    new.teste_ate := now() + make_interval(days => coalesce((select (valor #>> '{}')::int from public.plataforma_config where chave = 'dias_teste'), 7));
  end if;
  return new;
end $$;
drop trigger if exists lojas_assinatura_inicial on public.lojas;
create trigger lojas_assinatura_inicial before insert on public.lojas
  for each row execute function public.lojas_padrao_assinatura();

-- Ninguém do app altera plano/status direto: só funções do servidor (webhook/admin).
revoke update on public.lojas from authenticated, anon;
grant update (nome) on public.lojas to authenticated;

-- ---------- Situação efetiva (calculada na hora) ----------
-- ativa | teste | inadimplente (ainda pode usar) | somente_leitura | expirada | bloqueada
create or replace function public.loja_situacao(p_loja uuid) returns text
  language plpgsql stable security definer set search_path = public as $$
declare l public.lojas; tol int;
begin
  select * into l from public.lojas where id = p_loja;
  if not found then return null; end if;
  if l.status_assinatura = 'bloqueada' then return 'bloqueada'; end if;
  if l.isenta or l.cortesia_ate > now() then return 'ativa'; end if;
  tol := coalesce((select (valor #>> '{}')::int from public.plataforma_config where chave = 'tolerancia_atraso_dias'), 5);
  return case l.status_assinatura
    when 'ativa' then 'ativa'
    when 'teste' then case when l.teste_ate > now() then 'teste' else 'expirada' end
    when 'inadimplente' then case when coalesce(l.inadimplente_desde, now()) + make_interval(days => tol) > now() then 'inadimplente' else 'somente_leitura' end
    when 'cancelada' then case when l.periodo_pago_ate > now() then 'ativa' else 'expirada' end
    else 'expirada' end;
end $$;

-- Plano que vale agora (null = sem plano pago: dados preservados, só leitura)
create or replace function public.loja_plano(p_loja uuid) returns text
  language sql stable security definer set search_path = public as $$
  select case when public.loja_situacao(p_loja) in ('ativa', 'teste', 'inadimplente', 'somente_leitura') then (select plano_id from public.lojas where id = p_loja) end
$$;

-- FUNÇÃO CENTRAL: a loja tem o recurso? (usada nas regras do banco, nas funções e nas rotas /api)
create or replace function public.tem_recurso(p_loja uuid, p_recurso text) returns boolean
  language sql stable security definer set search_path = public as $$
  select coalesce((select p_recurso = any(p.recursos) from public.planos p where p.id = public.loja_plano(p_loja)), false)
$$;

-- A loja pode gravar? (somente leitura quando o teste acaba, após a tolerância de atraso, ou bloqueada)
create or replace function public.pode_escrever(p_loja uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select coalesce(public.loja_situacao(p_loja) in ('ativa', 'teste', 'inadimplente'), false)
$$;

-- ---------- Papéis e funcionários ativos ----------
alter table public.membros add column if not exists ativo boolean not null default true;
alter table public.membros add column if not exists desativado_em timestamptz;
alter table public.membros add column if not exists expira_em timestamptz; -- acesso temporário (suporte)
alter table public.membros drop constraint if exists membros_papel_check;
alter table public.membros add constraint membros_papel_check check (papel in ('dono', 'membro', 'atendente', 'tecnico', 'suporte'));

-- Lojas que o usuário acessa: só vínculos ativos e não expirados
create or replace function public.minhas_lojas() returns setof uuid
  language sql stable security definer set search_path = public as $$
  select loja_id from public.membros where user_id = auth.uid() and ativo and (expira_em is null or expira_em > now())
$$;

create or replace function public.meu_papel(p_loja uuid) returns text
  language sql stable security definer set search_path = public as $$
  select case papel when 'membro' then 'atendente' else papel end from public.membros
   where loja_id = p_loja and user_id = auth.uid() and ativo and (expira_em is null or expira_em > now())
$$;

create or replace function public.sou_dono(l uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.membros where loja_id = l and user_id = auth.uid() and papel = 'dono' and ativo)
$$;

create or replace function public.funcionarios_ativos(p_loja uuid) returns int
  language sql stable security definer set search_path = public as $$
  select count(*)::int from public.membros where loja_id = p_loja and ativo and papel in ('membro', 'atendente', 'tecnico')
$$;

create or replace function public.limite_funcionarios(p_loja uuid) returns int
  language sql stable security definer set search_path = public as $$
  select coalesce((select max_funcionarios from public.planos where id = public.loja_plano(p_loja)), 0)
$$;

-- ---------- O que cada papel vê e grava (validado no banco, não só na tela) ----------
-- Técnico: não vê financeiro/caixa; não grava vendas, financeiro nem caixa; não apaga.
-- Atendente: tudo do dia a dia; configurações e equipe só o dono (regras já existentes).
create or replace function public.pode_ver_colecao(p_loja uuid, p_colecao text) returns boolean
  language sql stable security definer set search_path = public as $$
  select not (p_colecao in ('lancamentos', 'caixas') and public.meu_papel(p_loja) = 'tecnico')
$$;

create or replace function public.pode_gravar_colecao(p_loja uuid, p_colecao text, p_id text) returns boolean
  language plpgsql stable security definer set search_path = public as $$
declare papel text := public.meu_papel(p_loja);
begin
  if papel is null or not public.pode_escrever(p_loja) then return false; end if;
  if p_colecao = 'meta' and p_id = 'settings' then return papel = 'dono'; end if;
  if papel = 'tecnico' and p_colecao in ('vendas', 'lancamentos', 'caixas') then return false; end if;
  -- módulos pagos: grava só com o recurso do plano (dados antigos continuam visíveis)
  if p_colecao = 'followups' then return public.tem_recurso(p_loja, 'followup'); end if;
  if p_colecao = 'metas_func' then return public.tem_recurso(p_loja, 'metas'); end if;
  if p_colecao in ('lotes', 'nfe_entradas') then return public.tem_recurso(p_loja, 'lotes') or public.tem_recurso(p_loja, 'importar_xml'); end if;
  return true;
end $$;

drop policy if exists itens_ver on public.itens;
create policy itens_ver on public.itens for select
  using (loja_id in (select public.minhas_lojas()) and (colecao not in ('lancamentos', 'caixas') or public.pode_ver_colecao(loja_id, colecao)));
drop policy if exists itens_inserir on public.itens;
create policy itens_inserir on public.itens for insert
  with check (loja_id in (select public.minhas_lojas()) and public.pode_gravar_colecao(loja_id, colecao, id));
drop policy if exists itens_editar on public.itens;
create policy itens_editar on public.itens for update
  using (loja_id in (select public.minhas_lojas()))
  with check (loja_id in (select public.minhas_lojas()) and public.pode_gravar_colecao(loja_id, colecao, id));
drop policy if exists itens_apagar on public.itens;
create policy itens_apagar on public.itens for delete
  using (loja_id in (select public.minhas_lojas()) and public.pode_gravar_colecao(loja_id, colecao, id) and public.meu_papel(loja_id) <> 'tecnico');

-- ---------- Equipe: limites do plano ----------
create or replace function public.checar_vaga(p_loja uuid) returns void
  language plpgsql security definer set search_path = public as $$
begin
  if public.funcionarios_ativos(p_loja) >= public.limite_funcionarios(p_loja) then
    raise exception 'Limite de funcionários do plano atingido (%). Faça upgrade ou desative alguém.', public.limite_funcionarios(p_loja);
  end if;
end $$;

-- Dono adiciona funcionário (mesma assinatura de antes; agora respeita o limite e o papel)
create or replace function public.adicionar_funcionario(p_loja uuid, p_email text, p_nome text) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare u record; ja boolean;
begin
  if not public.sou_dono(p_loja) then raise exception 'apenas o dono pode adicionar funcionários'; end if;
  select id, email, email_confirmed_at into u from auth.users where lower(email) = lower(trim(p_email)) limit 1;
  if not found then raise exception 'Conta não encontrada para este e-mail'; end if;
  select exists(select 1 from public.membros where loja_id = p_loja and user_id = u.id and ativo) into ja;
  if not ja then perform public.checar_vaga(p_loja); end if;
  insert into public.membros(loja_id, user_id, email, nome, papel) values (p_loja, u.id, u.email, nullif(trim(p_nome), ''), 'atendente')
    on conflict (loja_id, user_id) do update set nome = coalesce(excluded.nome, public.membros.nome), ativo = true, desativado_em = null;
  perform public.unir_loja_solo(u.id, p_loja);
  return jsonb_build_object('user_id', u.id, 'confirmado', u.email_confirmed_at is not null);
end $$;

-- (a etapa 12 troca esta função por uma versão que devolve jsonb; ao rodar tudo de novo, recria nesta ordem)
drop function if exists public.entrar_na_loja(text);
create or replace function public.entrar_na_loja(p_codigo text) returns public.lojas
  language plpgsql security definer set search_path = public as $$
declare l public.lojas;
begin
  if auth.uid() is null then raise exception 'não autenticado'; end if;
  select * into l from public.lojas where codigo_convite = upper(trim(p_codigo));
  if not found then raise exception 'Código de convite inválido'; end if;
  if not exists (select 1 from public.membros where loja_id = l.id and user_id = auth.uid()) then
    perform public.checar_vaga(l.id);
  end if;
  insert into public.membros(loja_id, user_id, email, papel) values (l.id, auth.uid(), auth.jwt() ->> 'email', 'atendente')
    on conflict (loja_id, user_id) do nothing;
  perform public.unir_loja_solo(auth.uid(), l.id);
  return l;
end $$;

-- Dono muda o papel (atendente/técnico) de um funcionário
create or replace function public.definir_papel(p_loja uuid, p_user uuid, p_papel text) returns void
  language plpgsql security definer set search_path = public as $$
begin
  if not public.sou_dono(p_loja) then raise exception 'apenas o dono pode mudar papéis'; end if;
  if p_papel not in ('atendente', 'tecnico') then raise exception 'papel inválido'; end if;
  update public.membros set papel = p_papel where loja_id = p_loja and user_id = p_user and papel in ('membro', 'atendente', 'tecnico');
end $$;

-- Dono ativa/desativa funcionário (desativar não apaga nada do histórico)
create or replace function public.definir_membro_ativo(p_loja uuid, p_user uuid, p_ativo boolean) returns void
  language plpgsql security definer set search_path = public as $$
begin
  if not public.sou_dono(p_loja) then raise exception 'apenas o dono pode ativar ou desativar'; end if;
  if exists (select 1 from public.membros where loja_id = p_loja and user_id = p_user and papel in ('dono', 'suporte')) then raise exception 'não se aplica a este acesso'; end if;
  if p_ativo and not exists (select 1 from public.membros where loja_id = p_loja and user_id = p_user and ativo) then perform public.checar_vaga(p_loja); end if;
  update public.membros set ativo = p_ativo, desativado_em = case when p_ativo then null else now() end where loja_id = p_loja and user_id = p_user;
end $$;

-- Ao mudar de plano (webhook/admin): aplica limites sem apagar nada.
-- Se sobrar funcionário, ficam ativos os mais antigos; o dono pode trocar quem fica depois.
create or replace function public.ajustar_ao_plano(p_loja uuid) returns int
  language plpgsql security definer set search_path = public as $$
declare lim int := public.limite_funcionarios(p_loja); n int;
begin
  with excesso as (
    select user_id from public.membros where loja_id = p_loja and ativo and papel in ('membro', 'atendente', 'tecnico')
    order by criado_em offset lim)
  update public.membros m set ativo = false, desativado_em = now() from excesso e where m.loja_id = p_loja and m.user_id = e.user_id;
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------- O que o app precisa saber da assinatura ----------
create or replace function public.minha_assinatura(p_loja uuid) returns jsonb
  language sql stable security definer set search_path = public as $$
  select case when p_loja in (select public.minhas_lojas()) then jsonb_build_object(
    'plano', l.plano_id, 'plano_nome', p.nome, 'plano_efetivo', public.loja_plano(l.id),
    'status', l.status_assinatura, 'situacao', public.loja_situacao(l.id), 'pode_escrever', public.pode_escrever(l.id),
    'recursos', coalesce((select to_jsonb(pe.recursos) from public.planos pe where pe.id = public.loja_plano(l.id)), '[]'::jsonb),
    'teste_ate', l.teste_ate, 'proxima_cobranca', l.proxima_cobranca, 'periodo_pago_ate', l.periodo_pago_ate,
    'inadimplente_desde', l.inadimplente_desde, 'cortesia_ate', l.cortesia_ate, 'isenta', l.isenta,
    'tolerancia_dias', coalesce((select (valor #>> '{}')::int from public.plataforma_config where chave = 'tolerancia_atraso_dias'), 5),
    'funcionarios_ativos', public.funcionarios_ativos(l.id), 'limite_funcionarios', public.limite_funcionarios(l.id),
    'papel', public.meu_papel(l.id))
  end
  from public.lojas l left join public.planos p on p.id = l.plano_id where l.id = p_loja
$$;

revoke all on function public.loja_situacao(uuid) from public, anon;
revoke all on function public.loja_plano(uuid) from public, anon;
revoke all on function public.tem_recurso(uuid, text) from public, anon;
revoke all on function public.pode_escrever(uuid) from public, anon;
revoke all on function public.meu_papel(uuid) from public, anon;
revoke all on function public.funcionarios_ativos(uuid) from public, anon;
revoke all on function public.limite_funcionarios(uuid) from public, anon;
revoke all on function public.pode_ver_colecao(uuid, text) from public, anon;
revoke all on function public.pode_gravar_colecao(uuid, text, text) from public, anon;
revoke all on function public.checar_vaga(uuid) from public, anon, authenticated;
revoke all on function public.ajustar_ao_plano(uuid) from public, anon, authenticated;
revoke all on function public.definir_papel(uuid, uuid, text) from public, anon;
revoke all on function public.definir_membro_ativo(uuid, uuid, boolean) from public, anon;
revoke all on function public.minha_assinatura(uuid) from public, anon;
grant execute on function public.loja_situacao(uuid), public.loja_plano(uuid), public.tem_recurso(uuid, text), public.pode_escrever(uuid),
  public.meu_papel(uuid), public.funcionarios_ativos(uuid), public.limite_funcionarios(uuid), public.pode_ver_colecao(uuid, text),
  public.pode_gravar_colecao(uuid, text, text), public.definir_papel(uuid, uuid, text), public.definir_membro_ativo(uuid, uuid, boolean),
  public.minha_assinatura(uuid) to authenticated;
