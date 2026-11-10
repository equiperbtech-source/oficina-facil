-- =============================================================
-- Oficina Simples — esquema do Supabase
-- Cole este arquivo inteiro no SQL Editor do Supabase e clique em Run.
-- Pode ser executado mais de uma vez sem problemas.
-- =============================================================

create extension if not exists pgcrypto;

-- Lojas (cada assistência é uma loja; funcionários entram por código de convite)
create table if not exists public.lojas (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  codigo_convite text unique not null default upper(substr(md5(gen_random_uuid()::text), 1, 8)),
  criado_em timestamptz not null default now()
);

-- Quem tem acesso a cada loja
create table if not exists public.membros (
  loja_id uuid not null references public.lojas(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  email text,
  papel text not null default 'membro' check (papel in ('dono', 'membro')),
  criado_em timestamptz not null default now(),
  primary key (loja_id, user_id)
);
create index if not exists membros_user_idx on public.membros(user_id);

-- Todos os registros do app (OS, clientes, estoque, vendas, financeiro...)
-- Cada linha é um registro de uma coleção, guardado como JSON.
create table if not exists public.itens (
  loja_id uuid not null references public.lojas(id) on delete cascade,
  colecao text not null,
  id text not null,
  dados jsonb not null,
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid default auth.uid(),
  primary key (loja_id, colecao, id)
);
create index if not exists itens_atualizado_idx on public.itens(loja_id, atualizado_em);

create or replace function public.tocar_itens() returns trigger language plpgsql as $$
begin
  new.atualizado_em := now();
  new.atualizado_por := auth.uid();
  return new;
end $$;
drop trigger if exists itens_tocar on public.itens;
create trigger itens_tocar before insert or update on public.itens
  for each row execute function public.tocar_itens();

-- ---------- Funções auxiliares de permissão ----------
create or replace function public.minhas_lojas() returns setof uuid
  language sql stable security definer set search_path = public as $$
  select loja_id from public.membros where user_id = auth.uid()
$$;

create or replace function public.sou_dono(l uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.membros where loja_id = l and user_id = auth.uid() and papel = 'dono')
$$;

-- ---------- Segurança (RLS): cada usuário só vê a própria loja ----------
alter table public.lojas enable row level security;
alter table public.membros enable row level security;
alter table public.itens enable row level security;

drop policy if exists lojas_ver on public.lojas;
create policy lojas_ver on public.lojas for select using (id in (select public.minhas_lojas()));
drop policy if exists lojas_editar on public.lojas;
create policy lojas_editar on public.lojas for update using (public.sou_dono(id));

drop policy if exists membros_ver on public.membros;
create policy membros_ver on public.membros for select using (loja_id in (select public.minhas_lojas()));
drop policy if exists membros_remover on public.membros;
create policy membros_remover on public.membros for delete
  using ((public.sou_dono(loja_id) and user_id <> auth.uid()) or (user_id = auth.uid() and papel <> 'dono'));

drop policy if exists itens_ver on public.itens;
create policy itens_ver on public.itens for select using (loja_id in (select public.minhas_lojas()));
-- As configurações da loja (meta/settings) só o dono altera; o resto a equipe toda altera
drop policy if exists itens_inserir on public.itens;
create policy itens_inserir on public.itens for insert with check (loja_id in (select public.minhas_lojas())
  and (not (colecao = 'meta' and id = 'settings') or public.sou_dono(loja_id)));
drop policy if exists itens_editar on public.itens;
create policy itens_editar on public.itens for update using (loja_id in (select public.minhas_lojas()))
  with check (loja_id in (select public.minhas_lojas()) and (not (colecao = 'meta' and id = 'settings') or public.sou_dono(loja_id)));
drop policy if exists itens_apagar on public.itens;
create policy itens_apagar on public.itens for delete using (loja_id in (select public.minhas_lojas())
  and (not (colecao = 'meta' and id = 'settings') or public.sou_dono(loja_id)));

-- ---------- Ações (RPC) ----------
-- Cria uma loja e torna o usuário atual o dono
create or replace function public.criar_loja(p_nome text) returns public.lojas
  language plpgsql security definer set search_path = public as $$
declare l public.lojas;
begin
  if auth.uid() is null then raise exception 'não autenticado'; end if;
  insert into public.lojas(nome) values (coalesce(nullif(trim(p_nome), ''), 'Minha Loja')) returning * into l;
  insert into public.membros(loja_id, user_id, email, papel) values (l.id, auth.uid(), auth.jwt() ->> 'email', 'dono');
  return l;
end $$;

-- Entra numa loja existente usando o código de convite
create or replace function public.entrar_na_loja(p_codigo text) returns public.lojas
  language plpgsql security definer set search_path = public as $$
declare l public.lojas;
begin
  if auth.uid() is null then raise exception 'não autenticado'; end if;
  select * into l from public.lojas where codigo_convite = upper(trim(p_codigo));
  if not found then raise exception 'Código de convite inválido'; end if;
  insert into public.membros(loja_id, user_id, email, papel) values (l.id, auth.uid(), auth.jwt() ->> 'email', 'membro')
    on conflict (loja_id, user_id) do nothing;
  perform public.unir_loja_solo(auth.uid(), l.id);
  return l;
end $$;

-- Gera um novo código de convite (só o dono)
create or replace function public.novo_codigo_convite(p_loja uuid) returns text
  language plpgsql security definer set search_path = public as $$
declare c text;
begin
  if not public.sou_dono(p_loja) then raise exception 'apenas o dono pode fazer isso'; end if;
  c := upper(substr(md5(gen_random_uuid()::text), 1, 8));
  update public.lojas set codigo_convite = c where id = p_loja;
  return c;
end $$;

-- só usuários logados podem chamar as ações
revoke all on function public.criar_loja(text) from public, anon;
revoke all on function public.entrar_na_loja(text) from public, anon;
revoke all on function public.novo_codigo_convite(uuid) from public, anon;
grant execute on function public.criar_loja(text) to authenticated;
grant execute on function public.entrar_na_loja(text) to authenticated;
grant execute on function public.novo_codigo_convite(uuid) to authenticated;

-- ---------- Tempo real ----------
do $$ begin
  alter publication supabase_realtime add table public.itens;
exception when duplicate_object then null; end $$;

-- ---------- Acompanhamento público da OS (link enviado ao cliente) ----------
-- Quem tem o link (código secreto de 22 caracteres) vê apenas os dados daquela OS,
-- sem login e sem acesso a nenhum outro dado da loja.
create index if not exists itens_os_token_idx on public.itens ((dados ->> 'token')) where colecao = 'os';

create or replace function public.acompanhar_os(p_token text) returns jsonb
  language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'os', jsonb_build_object(
      'numero', o.dados -> 'numero', 'status', o.dados -> 'status', 'historico', o.dados -> 'historico',
      'aparelho', jsonb_build_object('modelo', o.dados #> '{aparelho,modelo}', 'imei', o.dados #> '{aparelho,imei}', 'idTipo', o.dados #> '{aparelho,idTipo}', 'cor', o.dados #> '{aparelho,cor}'),
      'defeito', o.dados -> 'defeito', 'servico', o.dados -> 'servico',
      'valor', o.dados -> 'valor', 'desconto', o.dados -> 'desconto',
      'pecas', (select coalesce(jsonb_agg(jsonb_build_object('nome', p -> 'nome', 'qtd', p -> 'qtd')), '[]'::jsonb) from jsonb_array_elements(coalesce(o.dados -> 'pecas', '[]'::jsonb)) p),
      'previsao', o.dados -> 'previsao', 'criadoEm', o.dados -> 'criadoEm', 'concluidoEm', o.dados -> 'concluidoEm',
      'pagoEm', o.dados -> 'pagoEm', 'entregueEm', o.dados -> 'entregueEm', 'formaPagamento', o.dados #> '{pagamento,forma}',
      'assinaturaCliente', o.dados -> 'assinaturaCliente'),
    'cliente', (select jsonb_build_object('nome', c.dados -> 'nome') from public.itens c
                where c.loja_id = o.loja_id and c.colecao = 'clientes' and c.id = o.dados ->> 'clienteId'),
    'loja', (select jsonb_build_object('nome', s.dados -> 'loja', 'cnpj', s.dados -> 'cnpj', 'telefone', s.dados -> 'telefone',
                    'endereco', s.dados -> 'endereco', 'instagram', s.dados -> 'instagram', 'termosGarantia', s.dados -> 'termosGarantia',
                    'tecnico', (select t -> 'nome' from jsonb_array_elements(coalesce(s.dados -> 'tecnicos', '[]'::jsonb)) t where t ->> 'id' = o.dados ->> 'tecnicoId' limit 1),
                    'assinaturaTecnico', coalesce((select t -> 'assinatura' from jsonb_array_elements(coalesce(s.dados -> 'tecnicos', '[]'::jsonb)) t where t ->> 'id' = o.dados ->> 'tecnicoId' limit 1), s.dados -> 'assinaturaDono'))
             from public.itens s where s.loja_id = o.loja_id and s.colecao = 'meta' and s.id = 'settings')
  )
  from public.itens o
  where o.colecao = 'os' and length(p_token) >= 16 and o.dados ->> 'token' = p_token
    and coalesce((o.dados ->> 'deleted')::boolean, false) = false
  limit 1
$$;
revoke all on function public.acompanhar_os(text) from public;
grant execute on function public.acompanhar_os(text) to anon, authenticated;

-- ---------- Funcionários criados pelo dono (Configurações → Equipe) ----------
alter table public.membros add column if not exists nome text;

-- O app cria a conta do funcionário (e-mail + senha) e o dono chama esta função
-- para colocá-la na loja. Só o dono consegue.
create or replace function public.adicionar_funcionario(p_loja uuid, p_email text, p_nome text) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare u record;
begin
  if not public.sou_dono(p_loja) then raise exception 'apenas o dono pode adicionar funcionários'; end if;
  select id, email, email_confirmed_at into u from auth.users where lower(email) = lower(trim(p_email)) limit 1;
  if not found then raise exception 'Conta não encontrada para este e-mail'; end if;
  insert into public.membros(loja_id, user_id, email, nome, papel) values (p_loja, u.id, u.email, nullif(trim(p_nome), ''), 'membro')
    on conflict (loja_id, user_id) do update set nome = coalesce(excluded.nome, public.membros.nome);
  perform public.unir_loja_solo(u.id, p_loja);
  return jsonb_build_object('user_id', u.id, 'confirmado', u.email_confirmed_at is not null);
end $$;
revoke all on function public.adicionar_funcionario(uuid, text, text) from public, anon;
grant execute on function public.adicionar_funcionario(uuid, text, text) to authenticated;

-- ---------- Pedidos de orçamento feitos pelo próprio cliente (página pública /pedido) ----------
-- Dados públicos da loja para o cabeçalho da página de pedido
create or replace function public.info_loja(p_loja uuid) returns jsonb
  language sql stable security definer set search_path = public as $$
  select jsonb_build_object('nome', coalesce(s.dados ->> 'loja', l.nome), 'telefone', s.dados -> 'telefone',
                            'instagram', s.dados -> 'instagram', 'endereco', s.dados -> 'endereco')
  from public.lojas l left join public.itens s on s.loja_id = l.id and s.colecao = 'meta' and s.id = 'settings'
  -- sem loja no link: usa a única loja cadastrada (link curto /pedido)
  where l.id = coalesce(p_loja, (select id from public.lojas where (select count(*) from public.lojas) = 1))
$$;
revoke all on function public.info_loja(uuid) from public;
grant execute on function public.info_loja(uuid) to anon, authenticated;

-- Cliente envia o pedido (sem login). Valida os campos e limita envios repetidos.
create or replace function public.criar_pedido(p_loja uuid, p_nome text, p_telefone text, p_marca text,
                                               p_modelo text, p_defeito text, p_urgencia text) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare v_tel text := regexp_replace(coalesce(p_telefone, ''), '\D', '', 'g'); v_num int; v_id text;
begin
  if p_loja is null and (select count(*) from public.lojas) = 1 then select id into p_loja from public.lojas; end if;
  if not exists (select 1 from public.lojas where id = p_loja) then raise exception 'Loja não encontrada'; end if;
  if length(trim(coalesce(p_nome, ''))) < 3 then raise exception 'Informe seu nome completo'; end if;
  if length(v_tel) < 10 or length(v_tel) > 13 then raise exception 'Informe um WhatsApp válido com DDD'; end if;
  if length(trim(coalesce(p_modelo, ''))) < 2 then raise exception 'Informe o modelo do aparelho'; end if;
  if length(trim(coalesce(p_defeito, ''))) < 3 then raise exception 'Descreva o defeito'; end if;
  if (select count(*) from public.itens where loja_id = p_loja and colecao = 'pedidos'
        and dados ->> 'telefone' = v_tel and atualizado_em > now() - interval '10 minutes') >= 3
     or (select count(*) from public.itens where loja_id = p_loja and colecao = 'pedidos'
        and atualizado_em > now() - interval '1 hour') >= 60 then
    raise exception 'Muitos pedidos em pouco tempo. Tente novamente mais tarde ou chame no WhatsApp.';
  end if;
  select coalesce(max((dados ->> 'numero')::int), 0) + 1 into v_num from public.itens where loja_id = p_loja and colecao = 'pedidos';
  v_id := 'ped-' || substr(md5(gen_random_uuid()::text), 1, 16);
  insert into public.itens (loja_id, colecao, id, dados) values (p_loja, 'pedidos', v_id, jsonb_build_object(
    'id', v_id, 'numero', v_num, 'nome', left(trim(p_nome), 100), 'telefone', v_tel,
    'marca', left(trim(coalesce(p_marca, '')), 40), 'modelo', left(trim(p_modelo), 80), 'defeito', left(trim(p_defeito), 1000),
    'urgencia', case when p_urgencia in ('baixa', 'media', 'alta') then p_urgencia else 'media' end,
    'status', 'novo', 'lido', false, 'criadoEm', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')));
  return jsonb_build_object('numero', v_num);
end $$;
revoke all on function public.criar_pedido(uuid, text, text, text, text, text, text) from public;
grant execute on function public.criar_pedido(uuid, text, text, text, text, text, text) to anon, authenticated;

-- ---------- Aviso por e-mail de pedido de orçamento (dono e funcionários) ----------
-- Envio pelo Brevo (brevo.com, grátis até 300 e-mails/dia) usando pg_net, direto do banco.
do $$ begin
  create extension if not exists pg_net;
exception when others then raise notice 'pg_net indisponível: %', sqlerrm; end $$;

alter table public.membros add column if not exists notificar_pedidos boolean not null default true;

-- Configuração privada de e-mail por loja (sem acesso pelo app: só as funções abaixo leem)
create table if not exists public.lojas_email (
  loja_id uuid primary key references public.lojas(id) on delete cascade,
  api_key text,
  remetente text,
  site_url text,
  ativo boolean not null default true,
  atualizado_em timestamptz not null default now()
);
alter table public.lojas_email enable row level security;
revoke all on public.lojas_email from anon, authenticated;

create or replace function public.esc_html(t text) returns text language sql immutable as $$
  select replace(replace(replace(replace(coalesce(t, ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), '"', '&quot;')
$$;

-- Monta e envia o e-mail (usado pelo gatilho e pelo teste)
create or replace function public.enviar_email_loja(p_loja uuid, p_assunto text, p_html text) returns bigint
  language plpgsql security definer set search_path = public as $$
declare cfg public.lojas_email; dest jsonb; nome text; req bigint;
begin
  select * into cfg from public.lojas_email where loja_id = p_loja and ativo and coalesce(api_key, '') <> '';
  if not found then return null; end if;
  select jsonb_agg(jsonb_build_object('email', m.email)) into dest from public.membros m
   where m.loja_id = p_loja and coalesce(m.email, '') <> '' and m.notificar_pedidos;
  if dest is null then return null; end if;
  select coalesce(s.dados ->> 'loja', l.nome) into nome from public.lojas l
    left join public.itens s on s.loja_id = l.id and s.colecao = 'meta' and s.id = 'settings' where l.id = p_loja;
  select net.http_post(
    url := 'https://api.brevo.com/v3/smtp/email',
    headers := jsonb_build_object('api-key', cfg.api_key, 'Content-Type', 'application/json', 'accept', 'application/json'),
    body := jsonb_build_object('sender', jsonb_build_object('email', cfg.remetente, 'name', coalesce(nome, 'Oficina Simples')), 'to', dest, 'subject', p_assunto, 'htmlContent', p_html),
    timeout_milliseconds := 8000) into req;
  return req;
end $$;
revoke all on function public.enviar_email_loja(uuid, text, text) from public, anon, authenticated;

create or replace function public.html_pedido(d jsonb, site text) returns text language sql immutable as $$
  select '<div style="font-family:Arial,sans-serif;background:#000;color:#fff;padding:24px;border-radius:12px;max-width:560px">'
    || '<div style="color:#d4af37;font-size:20px;font-weight:bold;margin-bottom:6px">Novo pedido de orçamento' || coalesce(' nº ' || (d ->> 'numero'), '') || '</div>'
    || '<div style="color:#aaa;font-size:13px;margin-bottom:16px">Enviado pelo cliente pelo link do site</div>'
    || '<table style="width:100%;font-size:15px;color:#fff;border-collapse:collapse">'
    || '<tr><td style="color:#aaa;padding:6px 0">Cliente</td><td><b>' || esc_html(d ->> 'nome') || '</b></td></tr>'
    || '<tr><td style="color:#aaa;padding:6px 0">WhatsApp</td><td><a style="color:#d4af37" href="https://wa.me/55' || esc_html(d ->> 'telefone') || '">' || esc_html(d ->> 'telefone') || '</a></td></tr>'
    || '<tr><td style="color:#aaa;padding:6px 0">Aparelho</td><td>' || esc_html(d ->> 'marca') || ' · <b>' || esc_html(d ->> 'modelo') || '</b></td></tr>'
    || '<tr><td style="color:#aaa;padding:6px 0">Urgência</td><td><b style="color:' || case d ->> 'urgencia' when 'alta' then '#f87171">URGENTE' when 'baixa' then '#60a5fa">Baixa' else '#fb923c">Média' end || '</b></td></tr>'
    || '</table><div style="margin-top:14px;padding:12px;background:#151515;border-radius:8px;color:#ddd">' || esc_html(d ->> 'defeito') || '</div>'
    || case when coalesce(site, '') <> '' then '<a href="' || esc_html(site) || '/#/os?tab=pedidos" style="display:inline-block;margin-top:18px;background:#d4af37;color:#000;padding:12px 20px;border-radius:8px;font-weight:bold;text-decoration:none">Abrir no app</a>' else '' end
    || '</div>'
$$;

-- Gatilho: pedido novo → e-mail para a equipe (nunca impede o pedido de ser salvo)
create or replace function public.avisar_pedido_email() returns trigger
  language plpgsql security definer set search_path = public as $$
declare site text;
begin
  if current_setting('oficina.migrando', true) = '1' then return new; end if;
  select site_url into site from public.lojas_email where loja_id = new.loja_id;
  perform public.enviar_email_loja(new.loja_id,
    'Novo pedido de orçamento: ' || coalesce(new.dados ->> 'modelo', '') || ' · ' || coalesce(new.dados ->> 'nome', '') || case when new.dados ->> 'urgencia' = 'alta' then ' (URGENTE)' else '' end,
    public.html_pedido(new.dados, site));
  return new;
exception when others then
  raise warning 'aviso de pedido por e-mail falhou: %', sqlerrm;
  return new;
end $$;
drop trigger if exists itens_avisar_pedido on public.itens;
create trigger itens_avisar_pedido after insert on public.itens
  for each row when (new.colecao = 'pedidos') execute function public.avisar_pedido_email();

-- Dono configura o e-mail pelo app (a chave fica guardada no banco, o app não consegue ler de volta)
create or replace function public.configurar_email(p_loja uuid, p_api_key text, p_remetente text, p_site text, p_ativo boolean) returns jsonb
  language plpgsql security definer set search_path = public as $$
begin
  if not public.sou_dono(p_loja) then raise exception 'apenas o dono pode configurar'; end if;
  insert into public.lojas_email(loja_id, api_key, remetente, site_url, ativo) values (p_loja, nullif(trim(p_api_key), ''), trim(p_remetente), p_site, p_ativo)
  on conflict (loja_id) do update set
    api_key = coalesce(nullif(trim(excluded.api_key), ''), public.lojas_email.api_key),
    remetente = excluded.remetente, site_url = excluded.site_url, ativo = excluded.ativo, atualizado_em = now();
  return public.status_email(p_loja);
end $$;

create or replace function public.status_email(p_loja uuid) returns jsonb
  language sql stable security definer set search_path = public as $$
  select case when p_loja in (select public.minhas_lojas()) then
    coalesce((select jsonb_build_object('configurado', coalesce(api_key, '') <> '', 'remetente', remetente, 'ativo', ativo,
      'chave', case when coalesce(api_key, '') <> '' then '••••' || right(api_key, 4) else '' end) from public.lojas_email where loja_id = p_loja),
      '{"configurado": false}'::jsonb) end
$$;

create or replace function public.testar_email(p_loja uuid) returns bigint
  language plpgsql security definer set search_path = public as $$
declare site text;
begin
  if not public.sou_dono(p_loja) then raise exception 'apenas o dono pode testar'; end if;
  select site_url into site from public.lojas_email where loja_id = p_loja;
  return public.enviar_email_loja(p_loja, 'Teste: avisos de pedido de orçamento funcionando ✅',
    public.html_pedido(jsonb_build_object('numero', 0, 'nome', 'Cliente de teste', 'telefone', '48999999999', 'marca', 'Apple', 'modelo', 'iPhone 13', 'defeito', 'Este é um e-mail de teste do aviso de pedidos.', 'urgencia', 'media'), site));
end $$;

-- Resultado do envio (o Brevo responde 201 quando aceita)
create or replace function public.resultado_email(p_id bigint) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare r jsonb;
begin
  execute 'select jsonb_build_object(''status'', status_code, ''resposta'', left(content::text, 300), ''erro'', error_msg) from net._http_response where id = $1' into r using p_id;
  return r;
exception when others then return null;
end $$;

-- Dono escolhe quem recebe (ou cada um desliga o próprio aviso)
create or replace function public.definir_aviso_email(p_loja uuid, p_user uuid, p_ativo boolean) returns void
  language plpgsql security definer set search_path = public as $$
begin
  if not (public.sou_dono(p_loja) or p_user = auth.uid()) then raise exception 'sem permissão'; end if;
  update public.membros set notificar_pedidos = p_ativo where loja_id = p_loja and user_id = p_user;
end $$;

revoke all on function public.configurar_email(uuid, text, text, text, boolean) from public, anon;
revoke all on function public.status_email(uuid) from public, anon;
revoke all on function public.testar_email(uuid) from public, anon;
revoke all on function public.resultado_email(bigint) from public, anon;
revoke all on function public.definir_aviso_email(uuid, uuid, boolean) from public, anon;
grant execute on function public.configurar_email(uuid, text, text, text, boolean) to authenticated;
grant execute on function public.status_email(uuid) to authenticated;
grant execute on function public.testar_email(uuid) to authenticated;
grant execute on function public.resultado_email(bigint) to authenticated;
grant execute on function public.definir_aviso_email(uuid, uuid, boolean) to authenticated;

-- ---------- Funcionário com loja própria por engano ----------
-- Se o funcionário entrou no app antes de ser adicionado, ele pode ter criado uma loja só dele.
-- Aí os dados ficavam separados. Esta função junta tudo na loja da equipe e apaga a loja solo.
create or replace function public.unir_loja_solo(p_user uuid, p_destino uuid) returns int
  language plpgsql security definer set search_path = public as $$
declare b uuid; n int := 0; k int;
begin
  perform set_config('oficina.migrando', '1', true);
  for b in select m.loja_id from public.membros m
            where m.user_id = p_user and m.papel = 'dono' and m.loja_id <> p_destino
              and (select count(*) from public.membros x where x.loja_id = m.loja_id) = 1 loop
    insert into public.itens(loja_id, colecao, id, dados)
      select p_destino, colecao, id, dados from public.itens where loja_id = b and colecao <> 'meta'
      on conflict (loja_id, colecao, id) do nothing;
    get diagnostics k = row_count; n := n + k;
    delete from public.lojas where id = b;
  end loop;
  perform set_config('oficina.migrando', '', true);
  return n;
end $$;
revoke all on function public.unir_loja_solo(uuid, uuid) from public, anon, authenticated;

-- Corrige quem já está nessa situação (roda ao executar este arquivo)
do $$ declare r record; begin
  for r in select user_id, loja_id from public.membros where papel = 'membro' loop
    perform public.unir_loja_solo(r.user_id, r.loja_id);
  end loop;
end $$;
