-- =====================================================================
-- OFICINA SIMPLES · 00_base.sql — base única do banco novo
-- Banco novo: rode só o supabase/saas/TUDO.sql (que começa por este arquivo). Seguro rodar de novo.
-- Feito a partir do schema e das migrações 01–27 do sistema original, na ordem, com estas diferenças:
--   - sem "oficina padrão": página pública sem oficina no endereço não cai em oficina nenhuma;
--   - sem função que apaga oficinas (a junção antiga 23 e a "unir loja solo" saíram;
--     a união segura de duplicadas é a 31, que nunca apaga nem sobrescreve);
--   - índice único "1 oficina principal por dono" (fim do arquivo);
--   - textos do pedido do cliente falando de veículo.
-- Os arquivos antigos ficam em supabase/legado/ só como histórico (não rode).
-- =====================================================================

-- >>>>>>>>>>>>>>>>>>>> origem: schema.sql >>>>>>>>>>>>>>>>>>>>
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
drop function if exists public.entrar_na_loja(text);   -- (a versão final, com outro retorno, vem mais abaixo)
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
  where l.id = p_loja
$$;
revoke all on function public.info_loja(uuid) from public;
grant execute on function public.info_loja(uuid) to anon, authenticated;

-- Cliente envia o pedido (sem login). Valida os campos e limita envios repetidos.
create or replace function public.criar_pedido(p_loja uuid, p_nome text, p_telefone text, p_marca text,
                                               p_modelo text, p_defeito text, p_urgencia text) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare v_tel text := regexp_replace(coalesce(p_telefone, ''), '\D', '', 'g'); v_num int; v_id text;
begin
  if not exists (select 1 from public.lojas where id = p_loja) then raise exception 'Oficina não encontrada'; end if;
  if length(trim(coalesce(p_nome, ''))) < 3 then raise exception 'Informe seu nome completo'; end if;
  if length(v_tel) < 10 or length(v_tel) > 13 then raise exception 'Informe um WhatsApp válido com DDD'; end if;
  if length(trim(coalesce(p_modelo, ''))) < 2 then raise exception 'Informe o modelo do veículo'; end if;
  if length(trim(coalesce(p_defeito, ''))) < 3 then raise exception 'Conte o que está acontecendo com o veículo'; end if;
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



-- >>>>>>>>>>>>>>>>>>>> origem: 01_multiloja.sql >>>>>>>>>>>>>>>>>>>>
-- =====================================================================
-- SaaS · Etapa 1: multi-loja por endereço (host) e acompanhamento em tempo real
-- Migração ADITIVA: só cria colunas/tabelas/funções novas. Não altera nem apaga
-- nenhum registro existente. Pode rodar mais de uma vez (idempotente).
-- Reverter: 01_multiloja_reverter.sql
-- =====================================================================

-- Configurações gerais da plataforma (só funções e o painel admin acessam)
create table if not exists public.plataforma_config (
  chave text primary key,
  valor jsonb not null,
  atualizado_em timestamptz not null default now()
);
alter table public.plataforma_config enable row level security;
revoke all on public.plataforma_config from anon, authenticated;
-- Domínios da plataforma onde cada loja ganha um subdomínio (ex.: minhaloja.seudominio.com.br)
insert into public.plataforma_config(chave, valor) values ('dominios_base', '[]'::jsonb) on conflict (chave) do nothing;

-- Endereço curto da loja (subdomínio / link público)
alter table public.lojas add column if not exists slug text;
create unique index if not exists lojas_slug_unico on public.lojas (lower(slug)) where slug is not null;
do $$ begin
  alter table public.lojas add constraint lojas_slug_formato check (slug is null or slug ~ '^[a-z0-9]([a-z0-9-]{1,38}[a-z0-9])?$');
exception when duplicate_object then null; end $$;

-- Domínios próprios das lojas (ex.: sistema.minhaloja.com.br)
create table if not exists public.lojas_dominios (
  dominio text primary key check (dominio = lower(dominio) and dominio ~ '^[a-z0-9.-]+\.[a-z]{2,}$'),
  loja_id uuid not null references public.lojas(id) on delete cascade,
  verificado boolean not null default false,
  criado_em timestamptz not null default now()
);
create index if not exists lojas_dominios_loja_idx on public.lojas_dominios(loja_id);
alter table public.lojas_dominios enable row level security;
drop policy if exists lojas_dominios_ver on public.lojas_dominios;
create policy lojas_dominios_ver on public.lojas_dominios for select using (loja_id in (select public.minhas_lojas()));
drop policy if exists lojas_dominios_dono on public.lojas_dominios;
create policy lojas_dominios_dono on public.lojas_dominios for all using (public.sou_dono(loja_id)) with check (public.sou_dono(loja_id) and verificado = false);

-- Descobre a loja pelo endereço acessado (domínio próprio verificado ou subdomínio da plataforma).
-- Público: devolve só dados de vitrine (id, slug, nome). Nunca dados internos.
create or replace function public.loja_por_host(p_host text) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
declare h text := lower(split_part(coalesce(p_host, ''), ':', 1)); base text; sub text; l public.lojas;
begin
  if h = '' then return null; end if;
  select lo.* into l from public.lojas_dominios d join public.lojas lo on lo.id = d.loja_id where d.dominio = h and d.verificado;
  if not found then
    for base in select jsonb_array_elements_text(valor) from public.plataforma_config where chave = 'dominios_base' loop
      if h like '%.' || lower(base) then
        sub := left(h, length(h) - length(base) - 1);
        if sub !~ '\.' then select * into l from public.lojas where lower(slug) = sub; end if;
        exit;
      end if;
    end loop;
  end if;
  if l.id is null then return null; end if;
  return jsonb_build_object('id', l.id, 'slug', l.slug,
    'nome', coalesce((select s.dados ->> 'loja' from public.itens s where s.loja_id = l.id and s.colecao = 'meta' and s.id = 'settings'), l.nome));
end $$;
revoke all on function public.loja_por_host(text) from public;
grant execute on function public.loja_por_host(text) to anon, authenticated;

-- Loja pelo slug (links públicos /pedido/<slug>, /vitrine/<slug>)
create or replace function public.loja_por_slug(p_slug text) returns uuid
  language sql stable security definer set search_path = public as $$
  select id from public.lojas where lower(slug) = lower(trim(p_slug))
$$;
revoke all on function public.loja_por_slug(text) from public;
grant execute on function public.loja_por_slug(text) to anon, authenticated;

-- Dono escolhe o endereço curto da loja
create or replace function public.definir_slug(p_loja uuid, p_slug text) returns text
  language plpgsql security definer set search_path = public as $$
declare s text := lower(trim(p_slug));
begin
  if not public.sou_dono(p_loja) then raise exception 'apenas o dono pode alterar o endereço'; end if;
  if s in ('www', 'app', 'admin', 'api', 'painel', 'suporte', 'pedido', 'vitrine', 'acompanhar') then raise exception 'endereço reservado'; end if;
  if exists (select 1 from public.lojas where lower(slug) = s and id <> p_loja) then raise exception 'este endereço já está em uso'; end if;
  update public.lojas set slug = s where id = p_loja;
  return s;
end $$;
revoke all on function public.definir_slug(uuid, text) from public, anon;
grant execute on function public.definir_slug(uuid, text) to authenticated;

-- ---------- Acompanhamento da OS em tempo real ----------
-- Quando uma OS com link muda, avisa só o canal daquele link ("os-<token>").
-- A mensagem não leva dados: a página pública busca de novo pelo acompanhar_os (que só expõe o permitido).
create or replace function public.avisar_os_publica() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if new.colecao = 'os' and coalesce(new.dados ->> 'token', '') <> '' and new.dados is distinct from old.dados then
    begin
      perform realtime.send(jsonb_build_object('em', now()), 'mudou', 'os-' || (new.dados ->> 'token'), false);
    exception when others then null; -- sem Realtime disponível: a página continua atualizando a cada 15 s
    end;
  end if;
  return new;
end $$;
drop trigger if exists itens_avisar_os_publica on public.itens;
create trigger itens_avisar_os_publica after update on public.itens
  for each row when (new.colecao = 'os') execute function public.avisar_os_publica();

-- Loja padrão da plataforma = a loja mais antiga (a sua). Mantém funcionando os links antigos
-- sem loja no endereço (ex.: /pedido) mesmo depois que outras lojas forem cadastradas.

-- Resolve a oficina de uma página pública: id no link, endereço curto ou domínio (nunca uma oficina "padrão")
create or replace function public.loja_publica(p_ref text, p_host text) returns uuid
  language plpgsql stable security definer set search_path = public as $$
declare r text := trim(coalesce(p_ref, '')); l uuid;
begin
  if r ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    select id into l from public.lojas where id = r::uuid;
  elsif r <> '' then
    l := public.loja_por_slug(r);
  else
    l := (public.loja_por_host(p_host) ->> 'id')::uuid;
  end if;
  return (select id from public.lojas where id = l);
end $$;
revoke all on function public.loja_publica(text, text) from public;
grant execute on function public.loja_publica(text, text) to anon, authenticated;


-- >>>>>>>>>>>>>>>>>>>> origem: 02_planos.sql >>>>>>>>>>>>>>>>>>>>
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


-- >>>>>>>>>>>>>>>>>>>> origem: 03_modulos.sql >>>>>>>>>>>>>>>>>>>>
-- =====================================================================
-- SaaS · Etapa 3: vitrine pública, fotos (Storage), notas de entrada (XML) e lotes
-- ADITIVA. Os dados novos (lotes, notas de entrada, follow-ups, metas por funcionário)
-- ficam na mesma tabela itens, com loja_id e as regras (RLS) da etapa 2.
-- Reverter: 03_modulos_reverter.sql
-- =====================================================================

-- Nota de entrada (XML) é gravada com id = chave da NF-e: a chave primária (loja, coleção, id)
-- já impede importar a mesma nota duas vezes na mesma loja. Índice extra para busca por chave:
create index if not exists itens_nfe_chave_idx on public.itens (loja_id, (dados ->> 'chave')) where colecao = 'nfe_entradas';
create index if not exists itens_lotes_item_idx on public.itens (loja_id, (dados ->> 'itemId')) where colecao = 'lotes';

-- ---------- Vitrine pública ----------
-- Devolve só o que a loja marcou para a vitrine, com campos públicos (nunca custo, fornecedor, IMEI etc.).
-- Conversões tolerantes: um campo salvo vazio ou com vírgula ("", "1,5") não pode derrubar a vitrine inteira
create or replace function public.num_seguro(t text) returns numeric language plpgsql immutable as $$
begin
  return nullif(replace(trim(t), ',', '.'), '')::numeric;
exception when others then return null;
end $$;
create or replace function public.sim_seguro(t text) returns boolean language sql immutable as $$
  select lower(trim(coalesce(t, ''))) in ('true', 't', '1', 'sim', 'yes')
$$;

create or replace function public.vitrine_publica(p_ref text, p_host text) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
declare l uuid := public.loja_publica(p_ref, p_host); s jsonb;
begin
  if l is null then return null; end if;
  if not public.tem_recurso(l, 'vitrine') then return jsonb_build_object('indisponivel', true); end if;
  select dados into s from public.itens where loja_id = l and colecao = 'meta' and id = 'settings';
  return jsonb_build_object(
    'loja', jsonb_build_object('nome', coalesce(s ->> 'loja', (select nome from public.lojas where id = l)),
      'telefone', s ->> 'telefone', 'whatsapp', coalesce(s ->> 'whatsapp', s ->> 'telefone'), 'endereco', s ->> 'endereco', 'instagram', s ->> 'instagram'),
    'itens', coalesce((select jsonb_agg(jsonb_build_object(
        'id', i.id, 'nome', i.dados ->> 'nome', 'preco', public.num_seguro(i.dados ->> 'preco'), 'descricao', i.dados ->> 'descricao',
        'fotos', coalesce(i.dados -> 'fotos', '[]'::jsonb), 'cor', i.dados ->> 'cor', 'armazenamento', i.dados ->> 'armazenamento',
        'condicao', case when public.sim_seguro(i.dados ->> 'seminovo') then 'seminovo' when i.dados ->> 'tipoProduto' = 'novo' then 'novo' else 'acessorio' end,
        'bateria', i.dados ->> 'bateria', 'categoria', i.dados ->> 'categoria',
        'disponivel', coalesce(public.num_seguro(i.dados ->> 'qtd'), 0) > 0)
        order by (coalesce(public.num_seguro(i.dados ->> 'qtd'), 0) > 0) desc, i.dados ->> 'nome')
      from public.itens i
      where i.loja_id = l and i.colecao = 'produtos' and public.sim_seguro(i.dados ->> 'vitrine')
        and not public.sim_seguro(i.dados ->> 'deleted')), '[]'::jsonb));
end $$;
revoke all on function public.vitrine_publica(text, text) from public;
grant execute on function public.vitrine_publica(text, text) to anon, authenticated;

-- ---------- Fotos e logos (Supabase Storage) ----------
-- Pasta por loja: <loja_id>/... Só a equipe da loja grava na pasta dela; leitura pública (vitrine e logo).
do $$ begin
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('lojas-publico', 'lojas-publico', true, 2097152, array['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'])
  on conflict (id) do nothing;

  drop policy if exists lojas_publico_ler on storage.objects;
  create policy lojas_publico_ler on storage.objects for select using (bucket_id = 'lojas-publico');
  drop policy if exists lojas_publico_gravar on storage.objects;
  create policy lojas_publico_gravar on storage.objects for insert to authenticated
    with check (bucket_id = 'lojas-publico' and (storage.foldername(name))[1] in (select public.minhas_lojas()::text) and public.pode_escrever(((storage.foldername(name))[1])::uuid));
  drop policy if exists lojas_publico_alterar on storage.objects;
  create policy lojas_publico_alterar on storage.objects for update to authenticated
    using (bucket_id = 'lojas-publico' and (storage.foldername(name))[1] in (select public.minhas_lojas()::text));
  drop policy if exists lojas_publico_apagar on storage.objects;
  create policy lojas_publico_apagar on storage.objects for delete to authenticated
    using (bucket_id = 'lojas-publico' and (storage.foldername(name))[1] in (select public.minhas_lojas()::text));
exception when undefined_table or invalid_schema_name or undefined_function then
  raise notice 'Storage indisponível neste banco: fotos e logos desativados (%).', sqlerrm;
end $$;


-- >>>>>>>>>>>>>>>>>>>> origem: 04_pagamentos.sql >>>>>>>>>>>>>>>>>>>>
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


-- >>>>>>>>>>>>>>>>>>>> origem: 05_notas.sql >>>>>>>>>>>>>>>>>>>>
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


-- >>>>>>>>>>>>>>>>>>>> origem: 06_tema.sql >>>>>>>>>>>>>>>>>>>>
-- =====================================================================
-- SaaS · Etapa 6: personalização visual (white-label) por loja
-- Layout fixo; só a aparência varia (logo, cores, fonte da lista, nome, slogan, rodapé, dados da empresa).
-- ADITIVA. A loja padrão (sua) recebe um tema com a identidade atual da Oficina Simples (nada muda na tela).
-- Reverter: 06_tema_reverter.sql
-- =====================================================================

create table if not exists public.lojas_tema (
  loja_id uuid primary key references public.lojas(id) on delete cascade,
  logo_url text, favicon_url text,
  cor_primaria text not null default '#d4af37' check (cor_primaria ~ '^#[0-9a-fA-F]{6}$'),
  cor_secundaria text not null default '#b8860b' check (cor_secundaria ~ '^#[0-9a-fA-F]{6}$'),
  cor_fundo text not null default '#000000' check (cor_fundo ~ '^#[0-9a-fA-F]{6}$'),
  fonte text not null default 'Inter' check (fonte in ('Inter', 'Roboto', 'Poppins', 'Montserrat', 'Open Sans', 'Lato')),
  nome_exibicao text check (char_length(nome_exibicao) <= 60),
  slogan text check (char_length(slogan) <= 120),
  rodape text check (char_length(rodape) <= 200),
  cnpj text, endereco text, telefone text, whatsapp text,
  atualizado_em timestamptz not null default now()
);
alter table public.lojas_tema enable row level security;
drop policy if exists lojas_tema_ver on public.lojas_tema;
create policy lojas_tema_ver on public.lojas_tema for select using (loja_id in (select public.minhas_lojas()));
revoke insert, update, delete on public.lojas_tema from anon, authenticated;

-- Loja padrão (sua): tema com a identidade atual. Demais lojas existentes: tema padrão com o nome delas.
insert into public.lojas_tema(loja_id, logo_url, favicon_url, nome_exibicao)
  select l.id, '/assets/oficina-simples.svg', '/assets/os-192.png', coalesce((select s.dados ->> 'loja' from public.itens s where s.loja_id = l.id and s.colecao = 'meta' and s.id = 'settings'), l.nome)
  from public.lojas l where l.id = (select (valor #>> '{}')::uuid from public.plataforma_config where chave = 'loja_padrao')
on conflict (loja_id) do nothing;
insert into public.lojas_tema(loja_id, nome_exibicao) select id, left(nome, 60) from public.lojas on conflict (loja_id) do nothing;

-- Loja nova: só o tema padrão (sem logo de ninguém)
create or replace function public.lojas_tema_inicial() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  insert into public.lojas_tema(loja_id, nome_exibicao) values (new.id, left(new.nome, 60)) on conflict do nothing;
  return new;
end $$;
drop trigger if exists lojas_tema_inicial on public.lojas;
create trigger lojas_tema_inicial after insert on public.lojas for each row execute function public.lojas_tema_inicial();

-- Dono salva o tema (validado aqui também: cores, fonte e links das imagens só do Storage da própria loja)
create or replace function public.salvar_tema(p_loja uuid, t jsonb) returns void
  language plpgsql security definer set search_path = public as $$
declare img text;
begin
  if not public.sou_dono(p_loja) then raise exception 'apenas o dono altera a aparência'; end if;
  if not public.tem_recurso(p_loja, 'tema') then raise exception 'personalização indisponível no seu plano'; end if;
  if not public.pode_escrever(p_loja) then raise exception 'a loja está em somente leitura'; end if;
  foreach img in array array[t ->> 'logo_url', t ->> 'favicon_url'] loop
    if coalesce(img, '') <> '' and img !~ ('/storage/v1/object/public/lojas-publico/' || p_loja::text || '/') and img not in ('/assets/oficina-simples.svg', '/assets/os-192.png') then
      raise exception 'imagem inválida: envie pelo próprio app';
    end if;
  end loop;
  insert into public.lojas_tema(loja_id) values (p_loja) on conflict do nothing;
  update public.lojas_tema set
    logo_url = nullif(t ->> 'logo_url', ''), favicon_url = nullif(t ->> 'favicon_url', ''),
    cor_primaria = coalesce(nullif(t ->> 'cor_primaria', ''), cor_primaria), cor_secundaria = coalesce(nullif(t ->> 'cor_secundaria', ''), cor_secundaria),
    cor_fundo = coalesce(nullif(t ->> 'cor_fundo', ''), cor_fundo), fonte = coalesce(nullif(t ->> 'fonte', ''), fonte),
    nome_exibicao = nullif(trim(t ->> 'nome_exibicao'), ''), slogan = nullif(trim(t ->> 'slogan'), ''), rodape = nullif(trim(t ->> 'rodape'), ''),
    cnpj = nullif(trim(t ->> 'cnpj'), ''), endereco = nullif(trim(t ->> 'endereco'), ''), telefone = nullif(trim(t ->> 'telefone'), ''), whatsapp = nullif(trim(t ->> 'whatsapp'), ''),
    atualizado_em = now()
  where loja_id = p_loja;
end $$;

-- Tema público (páginas sem login: pedido, vitrine, acompanhamento, login pelo domínio da loja)
create or replace function public.tema_publico(p_loja uuid) returns jsonb
  language sql stable security definer set search_path = public as $$
  select to_jsonb(t) - 'loja_id' - 'atualizado_em' from public.lojas_tema t where t.loja_id = p_loja
$$;
-- Tema pela OS do link de acompanhamento (sem expor qual loja é)
create or replace function public.tema_por_os(p_token text) returns jsonb
  language sql stable security definer set search_path = public as $$
  select public.tema_publico(o.loja_id) from public.itens o
   where o.colecao = 'os' and length(p_token) >= 16 and o.dados ->> 'token' = p_token limit 1
$$;

-- Domínio próprio só nos planos que liberam
drop policy if exists lojas_dominios_dono on public.lojas_dominios;
create policy lojas_dominios_dono on public.lojas_dominios for all using (public.sou_dono(loja_id))
  with check (public.sou_dono(loja_id) and verificado = false and public.tem_recurso(loja_id, 'dominio_proprio'));

revoke all on function public.salvar_tema(uuid, jsonb) from public, anon;
grant execute on function public.salvar_tema(uuid, jsonb) to authenticated;
revoke all on function public.tema_publico(uuid) from public;
grant execute on function public.tema_publico(uuid) to anon, authenticated;
revoke all on function public.tema_por_os(text) from public;
grant execute on function public.tema_por_os(text) to anon, authenticated;


-- >>>>>>>>>>>>>>>>>>>> origem: 07_admin.sql >>>>>>>>>>>>>>>>>>>>
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


-- >>>>>>>>>>>>>>>>>>>> origem: 08_vitrine_pedidos.sql >>>>>>>>>>>>>>>>>>>>
-- =====================================================================
-- SaaS · Etapa 8b: pedidos da vitrine (carrinho do cliente com horário de retirada)
-- O cliente monta o carrinho na vitrine pública e finaliza com nome, WhatsApp e horário de retirada.
-- O pedido entra na loja (coleção pedidos_vitrine) e aparece em tempo real para a equipe separar.
-- Preço e disponibilidade são conferidos AQUI no banco (nunca confiamos no valor vindo do navegador).
-- O estoque só baixa quando a loja registra a venda na retirada.
-- ADITIVA. Reverter: 08_vitrine_pedidos_reverter.sql
-- =====================================================================

create or replace function public.criar_pedido_vitrine(p_ref text, p_host text, p_nome text, p_telefone text,
                                                       p_retirada text, p_itens jsonb, p_obs text) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare
  l uuid := public.loja_publica(p_ref, p_host);
  tel text := regexp_replace(coalesce(p_telefone, ''), '\D', '', 'g');
  ret timestamptz; it jsonb; prod jsonb; q int; itens jsonb := '[]'; total numeric := 0; num int; v_id text;
begin
  if l is null then raise exception 'Loja não encontrada'; end if;
  if not public.tem_recurso(l, 'vitrine') or not public.pode_escrever(l) then raise exception 'A vitrine desta loja não está recebendo pedidos agora'; end if;
  if length(trim(coalesce(p_nome, ''))) < 3 then raise exception 'Informe seu nome'; end if;
  if length(tel) < 10 or length(tel) > 13 then raise exception 'Informe um WhatsApp válido com DDD'; end if;
  begin ret := p_retirada::timestamptz; exception when others then raise exception 'Escolha o dia e o horário da retirada'; end;
  if ret < now() - interval '10 minutes' then raise exception 'O horário de retirada já passou'; end if;
  if ret > now() + interval '30 days' then raise exception 'Escolha uma retirada nos próximos 30 dias'; end if;
  if jsonb_typeof(p_itens) <> 'array' or jsonb_array_length(p_itens) = 0 or jsonb_array_length(p_itens) > 20 then raise exception 'Carrinho vazio ou grande demais'; end if;

  -- limite de envios: 3 por WhatsApp a cada 10 min e 60 por hora na loja
  if (select count(*) from public.itens where loja_id = l and colecao = 'pedidos_vitrine' and dados ->> 'telefone' = tel and atualizado_em > now() - interval '10 minutes') >= 3
     or (select count(*) from public.itens where loja_id = l and colecao = 'pedidos_vitrine' and atualizado_em > now() - interval '1 hour') >= 60 then
    raise exception 'Muitos pedidos seguidos. Tente de novo em alguns minutos.';
  end if;

  for it in select * from jsonb_array_elements(p_itens) loop
    q := least(greatest(coalesce(public.num_seguro(it ->> 'qtd'), 1)::int, 1), 10);
    select dados into prod from public.itens
     where loja_id = l and colecao = 'produtos' and id = it ->> 'id'
       and public.sim_seguro(dados ->> 'vitrine') and not public.sim_seguro(dados ->> 'deleted');
    if prod is null then raise exception 'Um dos itens não está mais na vitrine. Atualize a página.'; end if;
    if coalesce(public.num_seguro(prod ->> 'qtd'), 0) < q then raise exception '% não tem estoque suficiente (disponível: %)', prod ->> 'nome', greatest(coalesce(public.num_seguro(prod ->> 'qtd'), 0), 0)::int; end if;
    itens := itens || jsonb_build_array(jsonb_build_object('id', it ->> 'id', 'nome', prod ->> 'nome', 'preco', coalesce(public.num_seguro(prod ->> 'preco'), 0), 'qtd', q));
    total := total + coalesce(public.num_seguro(prod ->> 'preco'), 0) * q;
  end loop;

  select coalesce(max(public.num_seguro(dados ->> 'numero'))::int, 0) + 1 into num from public.itens where loja_id = l and colecao = 'pedidos_vitrine';
  v_id := gen_random_uuid()::text;
  insert into public.itens(loja_id, colecao, id, dados) values (l, 'pedidos_vitrine', v_id, jsonb_build_object(
    'id', v_id, 'numero', num, 'nome', left(trim(p_nome), 80), 'telefone', tel, 'retirada', ret, 'itens', itens, 'total', total,
    'obs', left(coalesce(trim(p_obs), ''), 300), 'status', 'novo', 'lido', false, 'criadoEm', now()));
  return jsonb_build_object('numero', num, 'total', total, 'retirada', ret);
end $$;
revoke all on function public.criar_pedido_vitrine(text, text, text, text, text, jsonb, text) from public;
grant execute on function public.criar_pedido_vitrine(text, text, text, text, text, jsonb, text) to anon, authenticated;


-- >>>>>>>>>>>>>>>>>>>> origem: 09_teste_restrito.sql >>>>>>>>>>>>>>>>>>>>
-- =====================================================================
-- SaaS · Etapa 9: teste grátis sem vitrine e sem notas fiscais
-- Durante o teste grátis a loja usa o plano do teste (Pro), MENOS os recursos da lista
-- "recursos_bloqueados_teste" (padrão: vitrine). Ao assinar, tudo do plano é liberado.
-- A regra fica no banco (tem_recurso): vale para o app, a vitrine pública, os pedidos e as notas.
-- ADITIVA. Reverter: 09_teste_restrito_reverter.sql
-- =====================================================================

insert into public.plataforma_config(chave, valor) values ('recursos_bloqueados_teste', '["vitrine"]'::jsonb)
on conflict (chave) do nothing;

-- recursos que o teste grátis não libera
create or replace function public.bloqueado_no_teste(p_recurso text) returns boolean
  language sql stable security definer set search_path = public as $$
  select coalesce((select valor ? p_recurso from public.plataforma_config where chave = 'recursos_bloqueados_teste'), false)
$$;

create or replace function public.tem_recurso(p_loja uuid, p_recurso text) returns boolean
  language sql stable security definer set search_path = public as $$
  select coalesce((select p_recurso = any(p.recursos) from public.planos p where p.id = public.loja_plano(p_loja)), false)
     and not (public.loja_situacao(p_loja) = 'teste' and public.bloqueado_no_teste(p_recurso))
$$;

-- a assinatura que o app lê: lista só o que está liberado agora e informa o que o teste bloqueia
create or replace function public.minha_assinatura(p_loja uuid) returns jsonb
  language sql stable security definer set search_path = public as $$
  select case when p_loja in (select public.minhas_lojas()) then jsonb_build_object(
    'plano', l.plano_id, 'plano_nome', p.nome, 'plano_efetivo', public.loja_plano(l.id),
    'status', l.status_assinatura, 'situacao', public.loja_situacao(l.id), 'pode_escrever', public.pode_escrever(l.id),
    'recursos', coalesce((select jsonb_agg(r) from public.planos pe, unnest(pe.recursos) r
                           where pe.id = public.loja_plano(l.id) and public.tem_recurso(l.id, r)), '[]'::jsonb),
    'bloqueados_teste', case when public.loja_situacao(l.id) = 'teste'
                          then coalesce((select valor from public.plataforma_config where chave = 'recursos_bloqueados_teste'), '[]'::jsonb)
                          else '[]'::jsonb end,
    'teste_ate', l.teste_ate, 'proxima_cobranca', l.proxima_cobranca, 'periodo_pago_ate', l.periodo_pago_ate,
    'inadimplente_desde', l.inadimplente_desde, 'cortesia_ate', l.cortesia_ate, 'isenta', l.isenta,
    'tolerancia_dias', coalesce((select (valor #>> '{}')::int from public.plataforma_config where chave = 'tolerancia_atraso_dias'), 5),
    'funcionarios_ativos', public.funcionarios_ativos(l.id), 'limite_funcionarios', public.limite_funcionarios(l.id),
    'papel', public.meu_papel(l.id))
  end
  from public.lojas l left join public.planos p on p.id = l.plano_id where l.id = p_loja
$$;

revoke all on function public.bloqueado_no_teste(text) from public, anon;
revoke all on function public.tem_recurso(uuid, text) from public, anon;
revoke all on function public.minha_assinatura(uuid) from public, anon;
grant execute on function public.bloqueado_no_teste(text), public.tem_recurso(uuid, text), public.minha_assinatura(uuid) to authenticated;


-- >>>>>>>>>>>>>>>>>>>> origem: 10_certificado.sql >>>>>>>>>>>>>>>>>>>>
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


-- >>>>>>>>>>>>>>>>>>>> origem: 11_dias_teste.sql >>>>>>>>>>>>>>>>>>>>
-- =====================================================================
-- SaaS · Etapa 11: dias de teste grátis pelo painel /admin
-- "Dias de teste": define quantos dias de teste a loja ainda tem (aumenta OU diminui; 0 = encerra agora).
--   A loja continua EM TESTE: aviso no topo e sem vitrine/notas. Tira a cortesia, se houver.
-- "Cortesia" (já existia) continua sendo acesso COMPLETO grátis, como se a loja tivesse pago.
-- ADITIVA. Reverter: 11_dias_teste_reverter.sql
-- =====================================================================

create or replace function public.admin_definir_teste(p_loja uuid, p_dias int, p_motivo text) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare antes jsonb := public.admin_estado(p_loja); l public.lojas;
begin
  perform public.exigir_admin();
  if p_dias is null or p_dias < 0 or p_dias > 90 then raise exception 'dias de teste inválidos (0 a 90)'; end if;
  select * into l from public.lojas where id = p_loja;
  if not found then raise exception 'loja não encontrada'; end if;
  if l.isenta then raise exception 'loja isenta não tem teste'; end if;
  if l.status_assinatura = 'bloqueada' then raise exception 'loja bloqueada: desbloqueie antes'; end if;
  if l.status_assinatura in ('ativa', 'inadimplente') and l.assinatura_externa_id is not null and coalesce(l.periodo_pago_ate, l.proxima_cobranca) > now() then
    raise exception 'esta loja tem assinatura paga: use "Alterar plano" ou "Cortesia"';
  end if;
  update public.lojas set status_assinatura = 'teste', teste_ate = now() + make_interval(days => p_dias), cortesia_ate = null,
    plano_id = coalesce(plano_id, 'pro'), inadimplente_desde = null, assinatura_atualizada_em = now()
   where id = p_loja;
  perform public.auditar('dias_teste', p_loja, antes, public.admin_estado(p_loja), p_motivo);
  return public.admin_estado(p_loja);
end $$;
revoke all on function public.admin_definir_teste(uuid, int, text) from public, anon;
grant execute on function public.admin_definir_teste(uuid, int, text) to authenticated;


-- >>>>>>>>>>>>>>>>>>>> origem: 12_convite_seguro.sql >>>>>>>>>>>>>>>>>>>>
-- =====================================================================
-- SaaS · Etapa 12: código de convite seguro
-- Antes: quem digitasse o código entrava NA HORA como funcionário (sem o dono aprovar) e, se tivesse
-- uma loja própria só com ele, essa loja era APAGADA e os dados copiados para a loja do código.
-- Agora:
--   * o código só envia um PEDIDO para entrar; a pessoa não vê nada até o dono aprovar em Equipe;
--   * nenhuma loja é apagada nem tem dados copiados ao entrar em outra equipe;
--   * no máximo 10 tentativas de código por hora para cada conta (impede adivinhar no chute);
--   * códigos novos mais longos (10 caracteres) e todos os códigos atuais são trocados agora.
-- ADITIVA. Reverter: 12_convite_seguro_reverter.sql
-- =====================================================================

alter table public.membros add column if not exists pendente boolean not null default false;
alter table public.membros add column if not exists pedido_em timestamptz;

create table if not exists public.convite_tentativas (
  id bigserial primary key,
  user_id uuid not null,
  em timestamptz not null default now(),
  acertou boolean not null default false
);
create index if not exists convite_tentativas_user_idx on public.convite_tentativas(user_id, em desc);
alter table public.convite_tentativas enable row level security;
revoke all on public.convite_tentativas from anon, authenticated;

-- código de 10 caracteres sem letras/números que se confundem (0/O, 1/I/L)
create or replace function public.gerar_codigo_convite() returns text
  language plpgsql volatile set search_path = public as $$
declare abc text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; c text; b bytea := uuid_send(gen_random_uuid()); i int;
begin
  loop
    c := '';
    for i in 0..9 loop c := c || substr(abc, 1 + (get_byte(b, i) % length(abc)), 1); end loop;
    exit when not exists (select 1 from public.lojas where codigo_convite = c);
    b := uuid_send(gen_random_uuid());
  end loop;
  return c;
end $$;
revoke all on function public.gerar_codigo_convite() from public, anon, authenticated;

-- Pedir para entrar na equipe com o código: fica PENDENTE até o dono aprovar
drop function if exists public.entrar_na_loja(text);
create function public.entrar_na_loja(p_codigo text) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare l public.lojas; m public.membros; uid uuid := auth.uid();
begin
  if uid is null then raise exception 'não autenticado'; end if;
  if (select count(*) from public.convite_tentativas where user_id = uid and em > now() - interval '1 hour') >= 10 then
    raise exception 'Muitas tentativas com código de convite. Aguarde 1 hora ou peça ao dono para adicionar você pelo e-mail.';
  end if;
  select * into l from public.lojas where codigo_convite = upper(regexp_replace(coalesce(p_codigo, ''), '\s', '', 'g'));
  insert into public.convite_tentativas(user_id, acertou) values (uid, found);
  -- código errado: responde sem erro, para a tentativa ficar registrada (um erro desfaria o registro)
  if l.id is null then return jsonb_build_object('situacao', 'invalido'); end if;

  select * into m from public.membros where loja_id = l.id and user_id = uid;
  if m.user_id is not null and m.ativo and (m.expira_em is null or m.expira_em > now()) then
    return jsonb_build_object('nome', l.nome, 'situacao', 'membro');
  end if;
  insert into public.membros(loja_id, user_id, email, papel, ativo, pendente, pedido_em)
  values (l.id, uid, auth.jwt() ->> 'email', 'atendente', false, true, now())
  on conflict (loja_id, user_id) do update set pendente = true, pedido_em = now()
    where public.membros.ativo = false and public.membros.papel in ('membro', 'atendente', 'tecnico');
  return jsonb_build_object('nome', l.nome, 'situacao', 'pendente');
end $$;
revoke all on function public.entrar_na_loja(text) from public, anon;
grant execute on function public.entrar_na_loja(text) to authenticated;

-- Pedidos que eu fiz e ainda aguardam aprovação (tela de quem ainda não tem loja)
create or replace function public.meus_pedidos_pendentes() returns jsonb
  language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('nome', l.nome, 'pedido_em', m.pedido_em) order by m.pedido_em desc), '[]'::jsonb)
    from public.membros m join public.lojas l on l.id = m.loja_id
   where m.user_id = auth.uid() and m.pendente and not m.ativo
$$;
revoke all on function public.meus_pedidos_pendentes() from public, anon;
grant execute on function public.meus_pedidos_pendentes() to authenticated;

-- Dono aprova (ativa) ou desativa: aprovar tira o "pendente"
create or replace function public.definir_membro_ativo(p_loja uuid, p_user uuid, p_ativo boolean) returns void
  language plpgsql security definer set search_path = public as $$
begin
  if not public.sou_dono(p_loja) then raise exception 'apenas o dono pode ativar ou desativar'; end if;
  if exists (select 1 from public.membros where loja_id = p_loja and user_id = p_user and papel in ('dono', 'suporte')) then raise exception 'não se aplica a este acesso'; end if;
  if p_ativo and not exists (select 1 from public.membros where loja_id = p_loja and user_id = p_user and ativo) then perform public.checar_vaga(p_loja); end if;
  update public.membros set ativo = p_ativo, pendente = false, desativado_em = case when p_ativo then null else now() end
   where loja_id = p_loja and user_id = p_user;
end $$;

-- Dono adiciona funcionário pelo e-mail: não apaga mais a loja própria da pessoa
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
    on conflict (loja_id, user_id) do update set nome = coalesce(excluded.nome, public.membros.nome), ativo = true, pendente = false, desativado_em = null;
  return jsonb_build_object('user_id', u.id, 'confirmado', u.email_confirmed_at is not null);
end $$;

-- Novo código (só o dono): 10 caracteres
create or replace function public.novo_codigo_convite(p_loja uuid) returns text
  language plpgsql security definer set search_path = public as $$
declare c text := public.gerar_codigo_convite();
begin
  if not public.sou_dono(p_loja) then raise exception 'apenas o dono pode fazer isso'; end if;
  update public.lojas set codigo_convite = c where id = p_loja;
  return c;
end $$;
revoke all on function public.novo_codigo_convite(uuid) from public, anon;
grant execute on function public.novo_codigo_convite(uuid) to authenticated;

-- lojas novas já nascem com o código longo
alter table public.lojas alter column codigo_convite set default public.gerar_codigo_convite();

-- troca TODOS os códigos atuais (os antigos podem ter vazado); só uma vez
do $$ declare r record; begin
  if not exists (select 1 from public.plataforma_config where chave = 'codigos_convite_trocados') then
    for r in select id from public.lojas loop
      update public.lojas set codigo_convite = public.gerar_codigo_convite() where id = r.id;
    end loop;
    insert into public.plataforma_config(chave, valor) values ('codigos_convite_trocados', to_jsonb(now()));
  end if;
end $$;

-- Dono: quantos pedidos de entrada esperam aprovação (aviso no topo do app)
create or replace function public.pedidos_equipe(p_loja uuid) returns int
  language sql stable security definer set search_path = public as $$
  select case when public.sou_dono(p_loja) then (select count(*)::int from public.membros where loja_id = p_loja and pendente and not ativo) else 0 end
$$;
revoke all on function public.pedidos_equipe(uuid) from public, anon;
grant execute on function public.pedidos_equipe(uuid) to authenticated;


-- >>>>>>>>>>>>>>>>>>>> origem: 13_idioma.sql >>>>>>>>>>>>>>>>>>>>
-- =====================================================================
-- SaaS · Etapa 13: idioma da loja (português ou espanhol)
-- Usado pelas páginas do cliente final (acompanhamento do reparo, vitrine) e por quem da equipe
-- ainda não escolheu um idioma. Fica em lojas_tema, que essas páginas já leem (tema_publico).
-- ADITIVA. Reverter: 13_idioma_reverter.sql
-- =====================================================================

alter table public.lojas_tema add column if not exists idioma text not null default 'pt';
do $$ begin
  alter table public.lojas_tema add constraint lojas_tema_idioma_ok check (idioma in ('pt', 'es'));
exception when duplicate_object then null; end $$;

create or replace function public.definir_idioma(p_loja uuid, p_idioma text) returns void
  language plpgsql security definer set search_path = public as $$
begin
  if not public.sou_dono(p_loja) then raise exception 'apenas o dono altera o idioma da loja'; end if;
  if p_idioma not in ('pt', 'es') then raise exception 'idioma inválido'; end if;
  insert into public.lojas_tema(loja_id, idioma) values (p_loja, p_idioma)
    on conflict (loja_id) do update set idioma = excluded.idioma, atualizado_em = now();
end $$;
revoke all on function public.definir_idioma(uuid, text) from public, anon;
grant execute on function public.definir_idioma(uuid, text) to authenticated;


-- >>>>>>>>>>>>>>>>>>>> origem: 14_hotmart.sql >>>>>>>>>>>>>>>>>>>>
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


-- >>>>>>>>>>>>>>>>>>>> origem: 15_garantia_os.sql >>>>>>>>>>>>>>>>>>>>
-- =====================================================================
-- SaaS · Etapa 15: prazo de garantia dos reparos ajustável.
-- O padrão da loja (Configurações, 90 dias = 3 meses) e o prazo de cada OS passam a ir para a página
-- pública de acompanhamento, que mostra e gera o termo com o prazo certo.
-- ADITIVA (só acrescenta dois campos ao que a função devolve). Reverter: 15_garantia_os_reverter.sql
-- =====================================================================

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
      'assinaturaCliente', o.dados -> 'assinaturaCliente', 'garantiaDias', o.dados -> 'garantiaDias'),
    'cliente', (select jsonb_build_object('nome', c.dados -> 'nome') from public.itens c
                where c.loja_id = o.loja_id and c.colecao = 'clientes' and c.id = o.dados ->> 'clienteId'),
    'loja', (select jsonb_build_object('nome', s.dados -> 'loja', 'cnpj', s.dados -> 'cnpj', 'telefone', s.dados -> 'telefone',
                    'endereco', s.dados -> 'endereco', 'instagram', s.dados -> 'instagram', 'termosGarantia', s.dados -> 'termosGarantia', 'garantiaDias', s.dados -> 'garantiaDias',
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


-- >>>>>>>>>>>>>>>>>>>> origem: 16_comunicados.sql >>>>>>>>>>>>>>>>>>>>
-- =====================================================================
-- SaaS · Etapa 16: comunicados da plataforma para todas as lojas.
-- O admin escreve uma mensagem em /admin → Comunicados; cada pessoa de qualquer loja vê um pop-up
-- ao abrir o sistema, uma vez só (fica marcado como lido para aquela pessoa, em qualquer aparelho).
-- ADITIVA (duas tabelas novas e funções novas). Reverter: 16_comunicados_reverter.sql
-- =====================================================================

create table if not exists public.comunicados (
  id bigserial primary key,
  titulo text not null default '',
  mensagem text not null check (length(trim(mensagem)) > 0 and length(mensagem) <= 4000),
  idioma text not null default 'todos' check (idioma in ('todos', 'pt', 'es')),
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  criado_por uuid
);
create table if not exists public.comunicados_lidos (
  comunicado_id bigint not null references public.comunicados(id) on delete cascade,
  user_id uuid not null,
  lido_em timestamptz not null default now(),
  primary key (comunicado_id, user_id)
);
alter table public.comunicados enable row level security;
alter table public.comunicados_lidos enable row level security;
revoke all on public.comunicados, public.comunicados_lidos from anon, authenticated;

-- ---------- Admin ----------
create or replace function public.admin_comunicados() returns jsonb
  language plpgsql stable security definer set search_path = public as $$
begin
  perform public.exigir_admin();
  return coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'titulo', c.titulo, 'mensagem', c.mensagem, 'idioma', c.idioma,
      'ativo', c.ativo, 'criado_em', c.criado_em, 'lidos', (select count(*) from public.comunicados_lidos l where l.comunicado_id = c.id))
    order by c.criado_em desc) from public.comunicados c), '[]'::jsonb);
end $$;

create or replace function public.admin_salvar_comunicado(p_titulo text, p_mensagem text, p_idioma text) returns bigint
  language plpgsql security definer set search_path = public as $$
declare novo bigint;
begin
  perform public.exigir_admin();
  if coalesce(trim(p_mensagem), '') = '' then raise exception 'escreva a mensagem'; end if;
  insert into public.comunicados(titulo, mensagem, idioma, criado_por)
  values (left(coalesce(trim(p_titulo), ''), 120), trim(p_mensagem), coalesce(nullif(p_idioma, ''), 'todos'), auth.uid())
  returning id into novo;
  perform public.auditar('comunicado', null, null, jsonb_build_object('id', novo, 'titulo', p_titulo, 'idioma', p_idioma), null);
  return novo;
end $$;

create or replace function public.admin_comunicado_ativo(p_id bigint, p_ativo boolean) returns void
  language plpgsql security definer set search_path = public as $$
begin
  perform public.exigir_admin();
  update public.comunicados set ativo = p_ativo where id = p_id;
  perform public.auditar('comunicado_ativo', null, null, jsonb_build_object('id', p_id, 'ativo', p_ativo), null);
end $$;

-- ---------- App (quem faz parte de alguma loja) ----------
-- comunicados ativos ainda não lidos por esta pessoa, no idioma do sistema dela (ou para todos)
create or replace function public.meus_comunicados(p_idioma text) returns jsonb
  language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'titulo', c.titulo, 'mensagem', c.mensagem, 'criado_em', c.criado_em) order by c.criado_em), '[]'::jsonb)
    from public.comunicados c
   where c.ativo and auth.uid() is not null
     and (c.idioma = 'todos' or c.idioma = coalesce(p_idioma, 'pt'))
     and exists (select 1 from public.membros m where m.user_id = auth.uid())
     and not exists (select 1 from public.comunicados_lidos l where l.comunicado_id = c.id and l.user_id = auth.uid())
$$;

create or replace function public.marcar_comunicado_lido(p_id bigint) returns void
  language sql security definer set search_path = public as $$
  insert into public.comunicados_lidos(comunicado_id, user_id)
  select p_id, auth.uid() where auth.uid() is not null and exists (select 1 from public.comunicados where id = p_id)
  on conflict do nothing
$$;

revoke all on function public.admin_comunicados(), public.admin_salvar_comunicado(text, text, text), public.admin_comunicado_ativo(bigint, boolean),
  public.meus_comunicados(text), public.marcar_comunicado_lido(bigint) from public, anon;
grant execute on function public.admin_comunicados(), public.admin_salvar_comunicado(text, text, text), public.admin_comunicado_ativo(bigint, boolean),
  public.meus_comunicados(text), public.marcar_comunicado_lido(bigint) to authenticated;


-- >>>>>>>>>>>>>>>>>>>> origem: 17_comunicados_provedor.sql >>>>>>>>>>>>>>>>>>>>
-- =====================================================================
-- SaaS · Etapa 17: comunicado com duas versões — lojas Kiwify (português) e lojas Hotmart (espanhol).
-- Um envio só; cada loja recebe a versão de onde assina. Loja que ainda não assinou (teste, cortesia)
-- recebe pelo idioma da loja. Deixar uma das versões em branco = só aquele grupo recebe.
-- ADITIVA (duas colunas novas e funções novas; as da etapa 16 continuam funcionando).
-- Reverter: 17_comunicados_provedor_reverter.sql
-- =====================================================================

alter table public.comunicados add column if not exists titulo_es text not null default '';
alter table public.comunicados add column if not exists mensagem_es text not null default '';
alter table public.comunicados drop constraint if exists comunicados_mensagem_check;
alter table public.comunicados drop constraint if exists comunicados_texto_ok;
alter table public.comunicados add constraint comunicados_texto_ok check (
  (length(trim(mensagem)) > 0 or length(trim(mensagem_es)) > 0) and length(mensagem) <= 4000 and length(mensagem_es) <= 4000);

-- versão que a loja recebe: 'pt' (Kiwify) ou 'es' (Hotmart); sem assinatura, o idioma da loja
create or replace function public.versao_comunicado(p_loja uuid, p_idioma text) returns text
  language sql stable security definer set search_path = public as $$
  select case l.provedor_pagamento when 'hotmart' then 'es' when 'kiwify' then 'pt'
           else case when coalesce(t.idioma, p_idioma) = 'es' then 'es' else 'pt' end end
    from (select 1) x
    left join public.lojas l on l.id = p_loja and exists (select 1 from public.membros m where m.loja_id = l.id and m.user_id = auth.uid())
    left join public.lojas_tema t on t.loja_id = l.id
$$;

create or replace function public.meus_comunicados(p_idioma text, p_loja uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
declare v text := public.versao_comunicado(p_loja, p_idioma);
begin
  if auth.uid() is null or not exists (select 1 from public.membros m where m.user_id = auth.uid()) then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', c.id,
      'titulo', case when v = 'es' then c.titulo_es else c.titulo end,
      'mensagem', case when v = 'es' then c.mensagem_es else c.mensagem end, 'criado_em', c.criado_em) order by c.criado_em)
    from public.comunicados c
   where c.ativo and c.idioma in ('todos', v)
     and length(trim(case when v = 'es' then c.mensagem_es else c.mensagem end)) > 0
     and not exists (select 1 from public.comunicados_lidos l where l.comunicado_id = c.id and l.user_id = auth.uid())), '[]'::jsonb);
end $$;

-- versão antiga (app ainda não atualizado): só a mensagem em português
create or replace function public.meus_comunicados(p_idioma text) returns jsonb
  language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'titulo', c.titulo, 'mensagem', c.mensagem, 'criado_em', c.criado_em) order by c.criado_em), '[]'::jsonb)
    from public.comunicados c
   where c.ativo and auth.uid() is not null and length(trim(c.mensagem)) > 0
     and (c.idioma = 'todos' or c.idioma = coalesce(p_idioma, 'pt'))
     and exists (select 1 from public.membros m where m.user_id = auth.uid())
     and not exists (select 1 from public.comunicados_lidos l where l.comunicado_id = c.id and l.user_id = auth.uid())
$$;

create or replace function public.admin_salvar_comunicado2(p_titulo text, p_mensagem text, p_titulo_es text, p_mensagem_es text) returns bigint
  language plpgsql security definer set search_path = public as $$
declare novo bigint;
begin
  perform public.exigir_admin();
  if coalesce(trim(p_mensagem), '') = '' and coalesce(trim(p_mensagem_es), '') = '' then raise exception 'escreva a mensagem'; end if;
  insert into public.comunicados(titulo, mensagem, titulo_es, mensagem_es, idioma, criado_por)
  values (left(coalesce(trim(p_titulo), ''), 120), coalesce(trim(p_mensagem), ''), left(coalesce(trim(p_titulo_es), ''), 120), coalesce(trim(p_mensagem_es), ''), 'todos', auth.uid())
  returning id into novo;
  perform public.auditar('comunicado', null, null, jsonb_build_object('id', novo, 'titulo', p_titulo, 'titulo_es', p_titulo_es), null);
  return novo;
end $$;

create or replace function public.admin_comunicados() returns jsonb
  language plpgsql stable security definer set search_path = public as $$
begin
  perform public.exigir_admin();
  return coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'titulo', c.titulo, 'mensagem', c.mensagem, 'titulo_es', c.titulo_es, 'mensagem_es', c.mensagem_es,
      'idioma', c.idioma, 'ativo', c.ativo, 'criado_em', c.criado_em, 'lidos', (select count(*) from public.comunicados_lidos l where l.comunicado_id = c.id))
    order by c.criado_em desc) from public.comunicados c), '[]'::jsonb);
end $$;

revoke all on function public.versao_comunicado(uuid, text), public.meus_comunicados(text, uuid), public.meus_comunicados(text),
  public.admin_salvar_comunicado2(text, text, text, text), public.admin_comunicados() from public, anon;
grant execute on function public.versao_comunicado(uuid, text), public.meus_comunicados(text, uuid), public.meus_comunicados(text),
  public.admin_salvar_comunicado2(text, text, text, text), public.admin_comunicados() to authenticated;


-- >>>>>>>>>>>>>>>>>>>> origem: 18_email_vitrine.sql >>>>>>>>>>>>>>>>>>>>
-- =====================================================================
-- SaaS · Etapa 18: pedido da vitrine também avisa por e-mail.
-- Mesmo envio do aviso de pedidos de orçamento (Brevo configurado em Configurações → Aviso de pedidos
-- por e-mail; vai para quem está com o sino ligado na Equipe). Texto no idioma da loja.
-- ADITIVA (funções e gatilho novos). Reverter: 18_email_vitrine_reverter.sql
-- =====================================================================

create or replace function public.html_pedido_vitrine(d jsonb, site text, idioma text) returns text language plpgsql immutable as $$
declare es boolean := idioma = 'es'; linhas text := ''; it jsonb; ret text; tot numeric := coalesce(public.num_seguro(d ->> 'total'), 0);
  fmt_total text;
begin
  for it in select * from jsonb_array_elements(coalesce(d -> 'itens', '[]'::jsonb)) loop
    linhas := linhas || '<tr><td style="padding:6px 0;color:#fff">' || coalesce(it ->> 'qtd', '1') || 'x ' || public.esc_html(it ->> 'nome') || '</td></tr>';
  end loop;
  begin
    ret := to_char((d ->> 'retirada')::timestamptz at time zone case when es then 'America/Santiago' else 'America/Sao_Paulo' end, 'DD/MM/YYYY HH24:MI');
  exception when others then ret := coalesce(d ->> 'retirada', '');
  end;
  fmt_total := case when es then '$ ' || replace(to_char(tot, 'FM999G999G999'), ',', '.')
                    else 'R$ ' || replace(replace(replace(to_char(tot, 'FM999G999G990D00'), ',', '#'), '.', ','), '#', '.') end;
  return '<div style="font-family:Arial,sans-serif;background:#000;color:#fff;padding:24px;border-radius:12px;max-width:560px">'
    || '<div style="color:#d4af37;font-size:20px;font-weight:bold;margin-bottom:6px">' || case when es then 'Nuevo pedido de la vitrina' else 'Novo pedido da vitrine' end || coalesce(' nº ' || (d ->> 'numero'), '') || '</div>'
    || '<div style="color:#aaa;font-size:13px;margin-bottom:16px">' || case when es then 'El cliente compró por la vitrina online' else 'O cliente comprou pela vitrine online' end || '</div>'
    || '<table style="width:100%;font-size:15px;color:#fff;border-collapse:collapse">'
    || '<tr><td style="color:#aaa;padding:6px 0">' || case when es then 'Cliente' else 'Cliente' end || '</td><td><b>' || public.esc_html(d ->> 'nome') || '</b></td></tr>'
    || '<tr><td style="color:#aaa;padding:6px 0">WhatsApp</td><td><a style="color:#d4af37" href="https://wa.me/' || case when es then '' else '55' end || public.esc_html(d ->> 'telefone') || '">' || public.esc_html(d ->> 'telefone') || '</a></td></tr>'
    || '<tr><td style="color:#aaa;padding:6px 0">' || case when es then 'Retiro' else 'Retirada' end || '</td><td><b>' || public.esc_html(ret) || '</b></td></tr>'
    || '<tr><td style="color:#aaa;padding:6px 0">Total</td><td><b style="color:#d4af37">' || fmt_total || '</b></td></tr>'
    || '</table><table style="width:100%;margin-top:14px;padding:12px;background:#151515;border-radius:8px;font-size:15px">' || linhas || '</table>'
    || case when coalesce(d ->> 'obs', '') <> '' then '<div style="margin-top:10px;color:#ddd">' || case when es then 'Observación: ' else 'Observação: ' end || public.esc_html(d ->> 'obs') || '</div>' else '' end
    || case when coalesce(site, '') <> '' then '<a href="' || public.esc_html(site) || '/#/vitrine" style="display:inline-block;margin-top:18px;background:#d4af37;color:#000;padding:12px 20px;border-radius:8px;font-weight:bold;text-decoration:none">'
         || case when es then 'Abrir en la app' else 'Abrir no app' end || '</a>' else '' end
    || '</div>';
end $$;

-- Gatilho: pedido novo da vitrine → e-mail para a equipe (nunca impede o pedido de ser salvo)
create or replace function public.avisar_pedido_vitrine_email() returns trigger
  language plpgsql security definer set search_path = public as $$
declare site text; idi text;
begin
  if current_setting('oficina.migrando', true) = '1' then return new; end if;
  select site_url into site from public.lojas_email where loja_id = new.loja_id;
  select coalesce(t.idioma, 'pt') into idi from public.lojas_tema t where t.loja_id = new.loja_id;
  perform public.enviar_email_loja(new.loja_id,
    case when idi = 'es' then 'Nuevo pedido de la vitrina' else 'Novo pedido da vitrine' end
      || coalesce(' nº ' || (new.dados ->> 'numero'), '') || ' · ' || coalesce(new.dados ->> 'nome', ''),
    public.html_pedido_vitrine(new.dados, site, coalesce(idi, 'pt')));
  return new;
exception when others then
  raise warning 'aviso de pedido da vitrine por e-mail falhou: %', sqlerrm;
  return new;
end $$;
drop trigger if exists itens_avisar_pedido_vitrine on public.itens;
create trigger itens_avisar_pedido_vitrine after insert on public.itens
  for each row when (new.colecao = 'pedidos_vitrine') execute function public.avisar_pedido_vitrine_email();

revoke all on function public.html_pedido_vitrine(jsonb, text, text), public.avisar_pedido_vitrine_email() from public, anon, authenticated;


-- >>>>>>>>>>>>>>>>>>>> origem: 19_email_plataforma.sql >>>>>>>>>>>>>>>>>>>>
-- =====================================================================
-- SaaS · Etapa 19: aviso de pedidos por e-mail ligado em todas as lojas pela chave da plataforma.
-- O admin cadastra UMA chave do Brevo (/admin → Produtos e planos → E-mail da plataforma). Toda loja sem
-- chave própria passa a receber os avisos (pedido de orçamento e vitrine) por ela, com o nome da loja como
-- remetente. Loja com chave própria continua usando a dela; loja que pausou ("Enviar avisos" desmarcado) não recebe.
-- O botão "Abrir no app" do e-mail usa o endereço da loja (<nome>.<dominio>) quando ela não salvou outro.
-- ADITIVA (tabela nova e funções novas/atualizadas). Reverter: 19_email_plataforma_reverter.sql
-- =====================================================================

create table if not exists public.plataforma_email (
  id boolean primary key default true check (id),
  api_key text,
  remetente text,
  ativo boolean not null default true,
  atualizado_em timestamptz not null default now()
);
alter table public.plataforma_email enable row level security;
revoke all on public.plataforma_email from anon, authenticated;

-- endereço do app da loja para o botão do e-mail
create or replace function public.site_da_loja(p_loja uuid) returns text
  language sql stable security definer set search_path = public as $$
  select coalesce(
    nullif((select site_url from public.lojas_email where loja_id = p_loja), ''),
    (select 'https://' || l.slug || '.' || b.base from public.lojas l,
       lateral (select jsonb_array_elements_text(valor) as base from public.plataforma_config where chave = 'dominios_base' limit 1) b
      where l.id = p_loja and coalesce(l.slug, '') <> ''),
    (select 'https://app.' || b.base from (select jsonb_array_elements_text(valor) as base from public.plataforma_config where chave = 'dominios_base' limit 1) b))
$$;

-- envio: chave da loja → senão chave da plataforma (se a loja não pausou)
create or replace function public.enviar_email_loja(p_loja uuid, p_assunto text, p_html text) returns bigint
  language plpgsql security definer set search_path = public as $$
declare cfg public.lojas_email; pl public.plataforma_email; chave text; rem text; dest jsonb; nome text; req bigint;
begin
  select * into cfg from public.lojas_email where loja_id = p_loja;
  if found and not cfg.ativo then return null; end if;                              -- loja pausou
  if found and coalesce(cfg.api_key, '') <> '' then chave := cfg.api_key; rem := cfg.remetente;
  else
    select * into pl from public.plataforma_email where id and ativo and coalesce(api_key, '') <> '';
    if not found then return null; end if;
    chave := pl.api_key; rem := pl.remetente;
  end if;
  select jsonb_agg(jsonb_build_object('email', m.email)) into dest from public.membros m
   where m.loja_id = p_loja and coalesce(m.email, '') <> '' and m.notificar_pedidos and coalesce(m.ativo, true);
  if dest is null then return null; end if;
  select coalesce(nullif(s.dados ->> 'loja', ''), l.nome) into nome from public.lojas l
    left join public.itens s on s.loja_id = l.id and s.colecao = 'meta' and s.id = 'settings' where l.id = p_loja;
  select net.http_post(
    url := 'https://api.brevo.com/v3/smtp/email',
    headers := jsonb_build_object('api-key', chave, 'Content-Type', 'application/json', 'accept', 'application/json'),
    body := jsonb_build_object('sender', jsonb_build_object('email', rem, 'name', coalesce(nome, 'Oficina Simples')), 'to', dest, 'subject', p_assunto, 'htmlContent', p_html),
    timeout_milliseconds := 8000) into req;
  return req;
end $$;
revoke all on function public.enviar_email_loja(uuid, text, text) from public, anon, authenticated;

create or replace function public.status_email(p_loja uuid) returns jsonb
  language sql stable security definer set search_path = public as $$
  select case when p_loja in (select public.minhas_lojas()) then
    jsonb_build_object(
      'configurado', coalesce(e.api_key, '') <> '',
      'remetente', e.remetente,
      'ativo', coalesce(e.ativo, true),
      'chave', case when coalesce(e.api_key, '') <> '' then '••••' || right(e.api_key, 4) else '' end,
      'plataforma', coalesce(e.api_key, '') = '' and exists (select 1 from public.plataforma_email p where p.id and p.ativo and coalesce(p.api_key, '') <> ''))
  end
  from (select 1) x left join public.lojas_email e on e.loja_id = p_loja
$$;

-- gatilhos e teste com o endereço da loja
create or replace function public.avisar_pedido_email() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if current_setting('oficina.migrando', true) = '1' then return new; end if;
  perform public.enviar_email_loja(new.loja_id,
    'Novo pedido de orçamento: ' || coalesce(new.dados ->> 'modelo', '') || ' · ' || coalesce(new.dados ->> 'nome', '') || case when new.dados ->> 'urgencia' = 'alta' then ' (URGENTE)' else '' end,
    public.html_pedido(new.dados, public.site_da_loja(new.loja_id)));
  return new;
exception when others then
  raise warning 'aviso de pedido por e-mail falhou: %', sqlerrm;
  return new;
end $$;

create or replace function public.avisar_pedido_vitrine_email() returns trigger
  language plpgsql security definer set search_path = public as $$
declare idi text;
begin
  if current_setting('oficina.migrando', true) = '1' then return new; end if;
  select coalesce(t.idioma, 'pt') into idi from public.lojas_tema t where t.loja_id = new.loja_id;
  perform public.enviar_email_loja(new.loja_id,
    case when idi = 'es' then 'Nuevo pedido de la vitrina' else 'Novo pedido da vitrine' end
      || coalesce(' nº ' || (new.dados ->> 'numero'), '') || ' · ' || coalesce(new.dados ->> 'nome', ''),
    public.html_pedido_vitrine(new.dados, public.site_da_loja(new.loja_id), coalesce(idi, 'pt')));
  return new;
exception when others then
  raise warning 'aviso de pedido da vitrine por e-mail falhou: %', sqlerrm;
  return new;
end $$;

create or replace function public.testar_email(p_loja uuid) returns bigint
  language plpgsql security definer set search_path = public as $$
begin
  if not public.sou_dono(p_loja) then raise exception 'apenas o dono pode testar'; end if;
  return public.enviar_email_loja(p_loja, 'Teste: avisos de pedido de orçamento funcionando ✅',
    public.html_pedido(jsonb_build_object('numero', 0, 'nome', 'Cliente de teste', 'telefone', '48999999999', 'marca', 'Apple', 'modelo', 'iPhone 13', 'defeito', 'Este é um e-mail de teste do aviso de pedidos.', 'urgencia', 'media'), public.site_da_loja(p_loja)));
end $$;

-- ---------- Admin ----------
create or replace function public.admin_email_plataforma(p_api_key text, p_remetente text, p_ativo boolean) returns jsonb
  language plpgsql security definer set search_path = public as $$
begin
  perform public.exigir_admin();
  if coalesce(trim(p_api_key), '') <> '' and trim(p_api_key) !~ '^xkeysib-' then raise exception 'A chave do Brevo começa com xkeysib-'; end if;
  if coalesce(trim(p_remetente), '') !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Informe o e-mail remetente confirmado no Brevo'; end if;
  insert into public.plataforma_email(id, api_key, remetente, ativo) values (true, nullif(trim(p_api_key), ''), lower(trim(p_remetente)), p_ativo)
  on conflict (id) do update set api_key = coalesce(nullif(trim(excluded.api_key), ''), public.plataforma_email.api_key),
    remetente = excluded.remetente, ativo = excluded.ativo, atualizado_em = now();
  perform public.auditar('email_plataforma', null, null, jsonb_build_object('remetente', lower(trim(p_remetente)), 'ativo', p_ativo, 'trocou_chave', coalesce(trim(p_api_key), '') <> ''), null);
  return public.admin_status_email_plataforma();
end $$;

create or replace function public.admin_status_email_plataforma() returns jsonb
  language plpgsql stable security definer set search_path = public as $$
begin
  perform public.exigir_admin();
  return coalesce((select jsonb_build_object('configurado', coalesce(api_key, '') <> '', 'remetente', remetente, 'ativo', ativo,
      'chave', case when coalesce(api_key, '') <> '' then '••••' || right(api_key, 4) else '' end,
      'lojas_proprias', (select count(*) from public.lojas_email where coalesce(api_key, '') <> ''),
      'lojas_pausadas', (select count(*) from public.lojas_email where not ativo))
    from public.plataforma_email where id), '{"configurado": false}'::jsonb);
end $$;

create or replace function public.admin_testar_email_plataforma(p_para text) returns bigint
  language plpgsql security definer set search_path = public as $$
declare pl public.plataforma_email; req bigint;
begin
  perform public.exigir_admin();
  select * into pl from public.plataforma_email where id and coalesce(api_key, '') <> '';
  if not found then raise exception 'Salve a chave primeiro'; end if;
  select net.http_post(url := 'https://api.brevo.com/v3/smtp/email',
    headers := jsonb_build_object('api-key', pl.api_key, 'Content-Type', 'application/json', 'accept', 'application/json'),
    body := jsonb_build_object('sender', jsonb_build_object('email', pl.remetente, 'name', 'Oficina Simples'), 'to', jsonb_build_array(jsonb_build_object('email', p_para)),
      'subject', 'Teste: e-mail da plataforma funcionando ✅', 'htmlContent', '<p>Os avisos de pedido das lojas vão sair por esta conta do Brevo.</p>'),
    timeout_milliseconds := 8000) into req;
  return req;
end $$;

revoke all on function public.site_da_loja(uuid), public.admin_email_plataforma(text, text, boolean), public.admin_status_email_plataforma(), public.admin_testar_email_plataforma(text) from public, anon;
grant execute on function public.admin_email_plataforma(text, text, boolean), public.admin_status_email_plataforma(), public.admin_testar_email_plataforma(text) to authenticated;
revoke all on function public.site_da_loja(uuid) from authenticated;


-- >>>>>>>>>>>>>>>>>>>> origem: 20_idioma_hotmart.sql >>>>>>>>>>>>>>>>>>>>
-- =====================================================================
-- SaaS · Etapa 20: idioma da loja para o cliente final e para os e-mails.
-- Loja que assina pela Hotmart = espanhol; as demais seguem o idioma da loja (Configurações, ou o PT/ES
-- que o dono escolhe no topo do app). Vale para vitrine, pedido de orçamento, acompanhamento do reparo e
-- os e-mails de aviso (orçamento e vitrine), que agora também têm versão em espanhol.
-- ADITIVA (funções novas e atualizadas). Reverter: 20_idioma_hotmart_reverter.sql
-- =====================================================================

create or replace function public.idioma_da_loja(p_loja uuid) returns text
  language sql stable security definer set search_path = public as $$
  select coalesce((select case when l.provedor_pagamento = 'hotmart' or t.idioma = 'es' then 'es' else 'pt' end
    from public.lojas l left join public.lojas_tema t on t.loja_id = l.id where l.id = p_loja), 'pt')
$$;

-- páginas do cliente: idioma sem depender de a loja ter personalizado a aparência
create or replace function public.idioma_por_os(p_token text) returns text
  language sql stable security definer set search_path = public as $$
  select public.idioma_da_loja(o.loja_id) from public.itens o
   where o.colecao = 'os' and length(p_token) >= 16 and o.dados ->> 'token' = p_token limit 1
$$;

create or replace function public.tema_publico(p_loja uuid) returns jsonb
  language sql stable security definer set search_path = public as $$
  select (to_jsonb(t) - 'loja_id' - 'atualizado_em') || jsonb_build_object('idioma', public.idioma_da_loja(p_loja))
    from public.lojas_tema t where t.loja_id = p_loja
$$;

-- e-mail do pedido de orçamento em português ou espanhol
create or replace function public.html_pedido(d jsonb, site text, idioma text) returns text language sql immutable as $$
  select case when idioma = 'es' then
    '<div style="font-family:Arial,sans-serif;background:#000;color:#fff;padding:24px;border-radius:12px;max-width:560px">'
    || '<div style="color:#d4af37;font-size:20px;font-weight:bold;margin-bottom:6px">Nueva solicitud de presupuesto' || coalesce(' nº ' || (d ->> 'numero'), '') || '</div>'
    || '<div style="color:#aaa;font-size:13px;margin-bottom:16px">Enviada por el cliente desde el enlace del sitio</div>'
    || '<table style="width:100%;font-size:15px;color:#fff;border-collapse:collapse">'
    || '<tr><td style="color:#aaa;padding:6px 0">Cliente</td><td><b>' || public.esc_html(d ->> 'nome') || '</b></td></tr>'
    || '<tr><td style="color:#aaa;padding:6px 0">WhatsApp</td><td><a style="color:#d4af37" href="https://wa.me/' || public.esc_html(d ->> 'telefone') || '">' || public.esc_html(d ->> 'telefone') || '</a></td></tr>'
    || '<tr><td style="color:#aaa;padding:6px 0">Equipo</td><td>' || public.esc_html(d ->> 'marca') || ' · <b>' || public.esc_html(d ->> 'modelo') || '</b></td></tr>'
    || '<tr><td style="color:#aaa;padding:6px 0">Urgencia</td><td><b style="color:' || case d ->> 'urgencia' when 'alta' then '#f87171">URGENTE' when 'baixa' then '#60a5fa">Baja' else '#fb923c">Media' end || '</b></td></tr>'
    || '</table><div style="margin-top:14px;padding:12px;background:#151515;border-radius:8px;color:#ddd">' || public.esc_html(d ->> 'defeito') || '</div>'
    || case when coalesce(site, '') <> '' then '<a href="' || public.esc_html(site) || '/#/os?tab=pedidos" style="display:inline-block;margin-top:18px;background:#d4af37;color:#000;padding:12px 20px;border-radius:8px;font-weight:bold;text-decoration:none">Abrir en la app</a>' else '' end
    || '</div>'
  else public.html_pedido(d, site) end
$$;

create or replace function public.avisar_pedido_email() returns trigger
  language plpgsql security definer set search_path = public as $$
declare idi text;
begin
  if current_setting('oficina.migrando', true) = '1' then return new; end if;
  idi := public.idioma_da_loja(new.loja_id);
  perform public.enviar_email_loja(new.loja_id,
    case when idi = 'es' then 'Nueva solicitud de presupuesto: ' else 'Novo pedido de orçamento: ' end
      || coalesce(new.dados ->> 'modelo', '') || ' · ' || coalesce(new.dados ->> 'nome', '') || case when new.dados ->> 'urgencia' = 'alta' then ' (URGENTE)' else '' end,
    public.html_pedido(new.dados, public.site_da_loja(new.loja_id), idi));
  return new;
exception when others then
  raise warning 'aviso de pedido por e-mail falhou: %', sqlerrm;
  return new;
end $$;

create or replace function public.avisar_pedido_vitrine_email() returns trigger
  language plpgsql security definer set search_path = public as $$
declare idi text;
begin
  if current_setting('oficina.migrando', true) = '1' then return new; end if;
  idi := public.idioma_da_loja(new.loja_id);
  perform public.enviar_email_loja(new.loja_id,
    case when idi = 'es' then 'Nuevo pedido de la vitrina' else 'Novo pedido da vitrine' end
      || coalesce(' nº ' || (new.dados ->> 'numero'), '') || ' · ' || coalesce(new.dados ->> 'nome', ''),
    public.html_pedido_vitrine(new.dados, public.site_da_loja(new.loja_id), idi));
  return new;
exception when others then
  raise warning 'aviso de pedido da vitrine por e-mail falhou: %', sqlerrm;
  return new;
end $$;

create or replace function public.testar_email(p_loja uuid) returns bigint
  language plpgsql security definer set search_path = public as $$
declare idi text := public.idioma_da_loja(p_loja);
begin
  if not public.sou_dono(p_loja) then raise exception 'apenas o dono pode testar'; end if;
  return public.enviar_email_loja(p_loja,
    case when idi = 'es' then 'Prueba: avisos de pedidos funcionando ✅' else 'Teste: avisos de pedido de orçamento funcionando ✅' end,
    public.html_pedido(jsonb_build_object('numero', 0, 'nome', case when idi = 'es' then 'Cliente de prueba' else 'Cliente de teste' end,
      'telefone', case when idi = 'es' then '56912345678' else '48999999999' end, 'marca', 'Apple', 'modelo', 'iPhone 13',
      'defeito', case when idi = 'es' then 'Este es un correo de prueba del aviso de pedidos.' else 'Este é um e-mail de teste do aviso de pedidos.' end, 'urgencia', 'media'),
      public.site_da_loja(p_loja), idi));
end $$;

revoke all on function public.html_pedido(jsonb, text, text) from public, anon, authenticated;
revoke all on function public.idioma_da_loja(uuid), public.idioma_por_os(text) from public;
grant execute on function public.idioma_da_loja(uuid), public.idioma_por_os(text) to anon, authenticated;


-- >>>>>>>>>>>>>>>>>>>> origem: 21_moeda_loja.sql >>>>>>>>>>>>>>>>>>>>
-- =====================================================================
-- SaaS · Etapa 21: moeda da loja (reais ou pesos chilenos).
-- O app guarda nas configurações da loja em que moeda os valores estão (moedaBase: BRL ou CLP; loja do
-- Chile/Hotmart = CLP). As páginas do cliente e o e-mail do pedido da vitrine mostram os valores nessa moeda.
-- ADITIVA (funções novas e atualizadas). Reverter: 21_moeda_loja_reverter.sql
-- =====================================================================

create or replace function public.moeda_da_loja(p_loja uuid) returns text
  language sql stable security definer set search_path = public as $$
  select coalesce(
    (select case when s.dados ->> 'moedaBase' in ('BRL', 'CLP') then s.dados ->> 'moedaBase' end
       from public.itens s where s.loja_id = p_loja and s.colecao = 'meta' and s.id = 'settings'),
    -- sem moeda salva: pesos só para quem assina pela Hotmart (o idioma da tela não decide a moeda)
    case when (select provedor_pagamento from public.lojas where id = p_loja) = 'hotmart' then 'CLP' else 'BRL' end)
$$;

create or replace function public.moeda_por_os(p_token text) returns text
  language sql stable security definer set search_path = public as $$
  select public.moeda_da_loja(o.loja_id) from public.itens o
   where o.colecao = 'os' and length(p_token) >= 16 and o.dados ->> 'token' = p_token limit 1
$$;

-- total do e-mail da vitrine na moeda da loja (texto continua no idioma da loja)
create or replace function public.html_pedido_vitrine(d jsonb, site text, idioma text, moeda text) returns text language plpgsql immutable as $$
declare es boolean := idioma = 'es'; linhas text := ''; it jsonb; ret text; tot numeric := coalesce(public.num_seguro(d ->> 'total'), 0);
  fmt_total text;
begin
  for it in select * from jsonb_array_elements(coalesce(d -> 'itens', '[]'::jsonb)) loop
    linhas := linhas || '<tr><td style="padding:6px 0;color:#fff">' || coalesce(it ->> 'qtd', '1') || 'x ' || public.esc_html(it ->> 'nome') || '</td></tr>';
  end loop;
  begin
    ret := to_char((d ->> 'retirada')::timestamptz at time zone case when es then 'America/Santiago' else 'America/Sao_Paulo' end, 'DD/MM/YYYY HH24:MI');
  exception when others then ret := coalesce(d ->> 'retirada', '');
  end;
  fmt_total := case when moeda = 'CLP' then '$ ' || replace(to_char(round(tot), 'FM999G999G999'), ',', '.')
                    else 'R$ ' || replace(replace(replace(to_char(tot, 'FM999G999G990D00'), ',', '#'), '.', ','), '#', '.') end;
  return '<div style="font-family:Arial,sans-serif;background:#000;color:#fff;padding:24px;border-radius:12px;max-width:560px">'
    || '<div style="color:#d4af37;font-size:20px;font-weight:bold;margin-bottom:6px">' || case when es then 'Nuevo pedido de la vitrina' else 'Novo pedido da vitrine' end || coalesce(' nº ' || (d ->> 'numero'), '') || '</div>'
    || '<div style="color:#aaa;font-size:13px;margin-bottom:16px">' || case when es then 'El cliente compró por la vitrina online' else 'O cliente comprou pela vitrine online' end || '</div>'
    || '<table style="width:100%;font-size:15px;color:#fff;border-collapse:collapse">'
    || '<tr><td style="color:#aaa;padding:6px 0">' || case when es then 'Cliente' else 'Cliente' end || '</td><td><b>' || public.esc_html(d ->> 'nome') || '</b></td></tr>'
    || '<tr><td style="color:#aaa;padding:6px 0">WhatsApp</td><td><a style="color:#d4af37" href="https://wa.me/' || case when es then '' else '55' end || public.esc_html(d ->> 'telefone') || '">' || public.esc_html(d ->> 'telefone') || '</a></td></tr>'
    || '<tr><td style="color:#aaa;padding:6px 0">' || case when es then 'Retiro' else 'Retirada' end || '</td><td><b>' || public.esc_html(ret) || '</b></td></tr>'
    || '<tr><td style="color:#aaa;padding:6px 0">Total</td><td><b style="color:#d4af37">' || fmt_total || '</b></td></tr>'
    || '</table><table style="width:100%;margin-top:14px;padding:12px;background:#151515;border-radius:8px;font-size:15px">' || linhas || '</table>'
    || case when coalesce(d ->> 'obs', '') <> '' then '<div style="margin-top:10px;color:#ddd">' || case when es then 'Observación: ' else 'Observação: ' end || public.esc_html(d ->> 'obs') || '</div>' else '' end
    || case when coalesce(site, '') <> '' then '<a href="' || public.esc_html(site) || '/#/vitrine" style="display:inline-block;margin-top:18px;background:#d4af37;color:#000;padding:12px 20px;border-radius:8px;font-weight:bold;text-decoration:none">'
         || case when es then 'Abrir en la app' else 'Abrir no app' end || '</a>' else '' end
    || '</div>';
end $$;

create or replace function public.avisar_pedido_vitrine_email() returns trigger
  language plpgsql security definer set search_path = public as $$
declare idi text;
begin
  if current_setting('oficina.migrando', true) = '1' then return new; end if;
  idi := public.idioma_da_loja(new.loja_id);
  perform public.enviar_email_loja(new.loja_id,
    case when idi = 'es' then 'Nuevo pedido de la vitrina' else 'Novo pedido da vitrine' end
      || coalesce(' nº ' || (new.dados ->> 'numero'), '') || ' · ' || coalesce(new.dados ->> 'nome', ''),
    public.html_pedido_vitrine(new.dados, public.site_da_loja(new.loja_id), idi, public.moeda_da_loja(new.loja_id)));
  return new;
exception when others then
  raise warning 'aviso de pedido da vitrine por e-mail falhou: %', sqlerrm;
  return new;
end $$;

revoke all on function public.html_pedido_vitrine(jsonb, text, text, text) from public, anon, authenticated;
revoke all on function public.moeda_da_loja(uuid), public.moeda_por_os(text) from public;
grant execute on function public.moeda_da_loja(uuid), public.moeda_por_os(text) to anon, authenticated;


-- >>>>>>>>>>>>>>>>>>>> origem: 22_uma_loja_por_conta.sql >>>>>>>>>>>>>>>>>>>>
-- =====================================================================
-- SaaS · Etapa 22: cada conta cria uma loja só.
-- Antes, tocar duas vezes em "Criar loja" (ou tentar de novo depois de um erro de internet) criava outra
-- loja para o mesmo e-mail. Agora, se a conta já é dona de uma loja, criar_loja devolve essa loja.
-- O bloqueio por conta evita duas criações ao mesmo tempo (toque duplo).
-- ADITIVA (só troca a função). Reverter: 22_uma_loja_por_conta_reverter.sql
-- =====================================================================

create or replace function public.criar_loja(p_nome text) returns public.lojas
  language plpgsql security definer set search_path = public as $$
declare l public.lojas;
begin
  if auth.uid() is null then raise exception 'não autenticado'; end if;
  perform pg_advisory_xact_lock(hashtext('criar_loja:' || auth.uid()::text));
  select lo.* into l from public.lojas lo join public.membros m on m.loja_id = lo.id
   where m.user_id = auth.uid() and m.papel = 'dono' order by lo.criado_em limit 1;
  if found then return l; end if;
  insert into public.lojas(nome) values (coalesce(nullif(trim(p_nome), ''), 'Minha Loja')) returning * into l;
  insert into public.membros(loja_id, user_id, email, papel) values (l.id, auth.uid(), auth.jwt() ->> 'email', 'dono');
  return l;
end $$;
revoke all on function public.criar_loja(text) from public, anon;
grant execute on function public.criar_loja(text) to authenticated;


-- >>>>>>>>>>>>>>>>>>>> origem: 24_trocar_email.sql >>>>>>>>>>>>>>>>>>>>
-- =====================================================================
-- SaaS · Etapa 24: trocar o e-mail de login sem perder a loja.
-- A loja fica ligada à conta (user_id), não ao e-mail. Depois que a pessoa confirma o e-mail novo, o app chama
-- sincronizar_meu_email() para atualizar o e-mail guardado na equipe (membros.email), que é o usado para achar
-- a loja numa compra nova. email_da_compra() mostra o e-mail usado na compra (Kiwify/Hotmart) para o aviso.
-- ADITIVA (funções novas). Reverter: 24_trocar_email_reverter.sql
-- =====================================================================

create or replace function public.sincronizar_meu_email() returns text
  language plpgsql security definer set search_path = public as $$
declare e text;
begin
  if auth.uid() is null then return null; end if;
  select lower(email) into e from auth.users where id = auth.uid();
  if coalesce(e, '') = '' then return null; end if;
  update public.membros set email = e where user_id = auth.uid() and lower(coalesce(email, '')) <> e;
  return e;
end $$;

-- e-mail usado na compra (só para o dono da loja)
create or replace function public.email_da_compra(p_loja uuid) returns text
  language sql stable security definer set search_path = public as $$
  select l.comprador_email from public.lojas l where l.id = p_loja and public.sou_dono(p_loja)
$$;

revoke all on function public.sincronizar_meu_email(), public.email_da_compra(uuid) from public, anon;
grant execute on function public.sincronizar_meu_email(), public.email_da_compra(uuid) to authenticated;


-- >>>>>>>>>>>>>>>>>>>> origem: 25_fotos_aparelho.sql >>>>>>>>>>>>>>>>>>>>
-- Etapa 25: fotos do aparelho (estado na entrada) na OS e no orçamento.
-- Bucket PRIVADO "lojas-privado": pasta por loja (<loja_id>/aparelhos/...). Só a equipe da loja lê, grava e apaga;
-- o sistema mostra as fotos por link temporário (assinado). Nada fica público: são fotos do aparelho do cliente.
-- Pode rodar de novo sem problema.
do $$ begin
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('lojas-privado', 'lojas-privado', false, 3145728, array['image/png', 'image/jpeg', 'image/webp'])
  on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

  drop policy if exists lojas_privado_ler on storage.objects;
  create policy lojas_privado_ler on storage.objects for select to authenticated
    using (bucket_id = 'lojas-privado' and (storage.foldername(name))[1] in (select public.minhas_lojas()::text));
  drop policy if exists lojas_privado_gravar on storage.objects;
  create policy lojas_privado_gravar on storage.objects for insert to authenticated
    with check (bucket_id = 'lojas-privado' and (storage.foldername(name))[1] in (select public.minhas_lojas()::text) and public.pode_escrever(((storage.foldername(name))[1])::uuid));
  drop policy if exists lojas_privado_apagar on storage.objects;
  create policy lojas_privado_apagar on storage.objects for delete to authenticated
    using (bucket_id = 'lojas-privado' and (storage.foldername(name))[1] in (select public.minhas_lojas()::text));
exception when undefined_table or invalid_schema_name or undefined_function then
  raise notice 'Storage indisponível neste banco: fotos do aparelho desativadas (%).', sqlerrm;
end $$;


-- >>>>>>>>>>>>>>>>>>>> origem: 26_cards_bancada.sql >>>>>>>>>>>>>>>>>>>>
-- =====================================================================
-- SaaS · Etapa 26: cards da bancada criados pela loja (ex.: "Aguardando cliente").
-- A configuração dos cards fica nas configurações da loja (itens/meta/settings), sem tabela nova.
-- Aqui a página pública de acompanhamento passa a receber o nome e a cor do card em que a OS está,
-- para o cliente ver "Aguardando cliente" em vez de um status genérico.
-- ADITIVA (só acrescenta dois campos ao que a função devolve). Reverter: 26_cards_bancada_reverter.sql
-- =====================================================================

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
      'assinaturaCliente', o.dados -> 'assinaturaCliente', 'garantiaDias', o.dados -> 'garantiaDias',
      'statusNome', o.dados -> 'statusNome', 'statusCor', o.dados -> 'statusCor'),
    'cliente', (select jsonb_build_object('nome', c.dados -> 'nome') from public.itens c
                where c.loja_id = o.loja_id and c.colecao = 'clientes' and c.id = o.dados ->> 'clienteId'),
    'loja', (select jsonb_build_object('nome', s.dados -> 'loja', 'cnpj', s.dados -> 'cnpj', 'telefone', s.dados -> 'telefone',
                    'endereco', s.dados -> 'endereco', 'instagram', s.dados -> 'instagram', 'termosGarantia', s.dados -> 'termosGarantia', 'garantiaDias', s.dados -> 'garantiaDias',
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


-- >>>>>>>>>>>>>>>>>>>> origem: 27_carrinhos_abandonados.sql >>>>>>>>>>>>>>>>>>>>
-- =====================================================================
-- SaaS · Etapa 27: carrinhos abandonados no painel admin.
-- Kiwify ("status": "abandoned") e Hotmart (PURCHASE_OUT_OF_SHOPPING_CART) mandam um aviso quando a pessoa
-- abre o checkout e não paga. Esses avisos já ficam em kiwify_eventos como "ignorado" (não mexem em loja).
-- Aqui o painel passa a listar essas pessoas (uma linha por e-mail, a tentativa mais recente), mostra se ela
-- comprou depois e guarda se o admin já entrou em contato (WhatsApp ou e-mail) ou descartou.
-- ADITIVA (tabela e funções novas). Reverter: 27_carrinhos_abandonados_reverter.sql
-- =====================================================================

create table if not exists public.carrinhos_contato (
  email text primary key,                                  -- sempre em minúsculas
  situacao text not null check (situacao in ('contatado', 'descartado')),
  canal text,                                              -- whatsapp | email
  atualizado_em timestamptz not null default now()
);
alter table public.carrinhos_contato enable row level security;
revoke all on public.carrinhos_contato from anon, authenticated;

-- p_filtro: 'abertos' (a recuperar: não comprou e ninguém falou ainda) | 'contatados' | 'compraram' | 'descartados' | 'todos'
create or replace function public.admin_carrinhos(p_filtro text) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
begin
  perform public.exigir_admin();
  return coalesce((select jsonb_agg(to_jsonb(x) order by x.recebido_em desc) from (
    select c.*, cc.situacao, cc.canal, cc.atualizado_em as contato_em,
      exists (select 1 from public.kiwify_eventos a where lower(a.email) = c.email and a.tipo in ('compra_aprovada', 'renovacao') and a.recebido_em >= c.recebido_em - interval '2 days')
        or exists (select 1 from public.lojas l where lower(l.comprador_email) = c.email) as comprou,
      exists (select 1 from public.membros m where lower(m.email) = c.email) as tem_conta,
      (select count(*) from public.kiwify_eventos t where t.tipo = 'ignorado' and lower(coalesce(nullif(t.email, ''), t.payload ->> 'email', t.payload #>> '{data,buyer,email}', '')) = c.email
         and (t.payload ->> 'status' = 'abandoned' or t.tipo_original in ('PURCHASE_OUT_OF_SHOPPING_CART', 'carrinho_abandonado', 'abandoned_cart'))) as tentativas
    from (
      select distinct on (b.email) b.* from (
        select e.id, e.provedor, e.recebido_em,
          lower(coalesce(nullif(e.email, ''), e.payload ->> 'email', e.payload #>> '{data,buyer,email}', '')) as email,
          coalesce(e.payload ->> 'name', e.payload #>> '{data,buyer,name}') as nome,
          coalesce(e.payload ->> 'phone', e.payload #>> '{data,buyer,checkout_phone}', e.payload #>> '{data,buyer,phone}') as telefone,
          coalesce(e.payload ->> 'subscription_plan', e.payload ->> 'offer_name', e.payload #>> '{data,offer,name}', e.payload #>> '{data,subscription,plan,name}') as plano,
          coalesce(e.payload ->> 'product_name', e.payload #>> '{data,product,name}') as produto,
          coalesce(e.payload ->> 'country', e.payload #>> '{data,buyer,address,country_iso}') as pais,
          e.payload ->> 'checkout_link' as checkout
        from public.kiwify_eventos e
        where e.tipo = 'ignorado'
          and (e.payload ->> 'status' = 'abandoned' or e.tipo_original in ('PURCHASE_OUT_OF_SHOPPING_CART', 'carrinho_abandonado', 'abandoned_cart'))
      ) b where b.email <> '' order by b.email, b.recebido_em desc
    ) c
    left join public.carrinhos_contato cc on cc.email = c.email
  ) x
  where case coalesce(nullif(p_filtro, ''), 'abertos')
    when 'abertos' then not x.comprou and x.situacao is null
    when 'contatados' then not x.comprou and x.situacao = 'contatado'
    when 'descartados' then not x.comprou and x.situacao = 'descartado'
    when 'compraram' then x.comprou
    else true end
  ), '[]'::jsonb);
end $$;

-- marca a pessoa como contatada (whatsapp/email) ou descartada; 'reabrir' volta para "a recuperar"
create or replace function public.admin_carrinho_marcar(p_email text, p_situacao text, p_canal text) returns void
  language plpgsql security definer set search_path = public as $$
declare e text := lower(trim(coalesce(p_email, '')));
begin
  perform public.exigir_admin();
  if e = '' then raise exception 'E-mail obrigatório'; end if;
  if p_situacao = 'reabrir' then delete from public.carrinhos_contato where email = e; return; end if;
  if p_situacao not in ('contatado', 'descartado') then raise exception 'Situação inválida'; end if;
  insert into public.carrinhos_contato (email, situacao, canal, atualizado_em) values (e, p_situacao, nullif(p_canal, ''), now())
  on conflict (email) do update set situacao = excluded.situacao, canal = coalesce(excluded.canal, public.carrinhos_contato.canal), atualizado_em = now();
end $$;

revoke all on function public.admin_carrinhos(text), public.admin_carrinho_marcar(text, text, text) from public, anon;
grant execute on function public.admin_carrinhos(text), public.admin_carrinho_marcar(text, text, text) to authenticated;

-- >>>>>>>>>>>>>>>>>>>> base: 1 oficina principal por dono >>>>>>>>>>>>>>>>>>>>
-- Cada conta tem uma oficina principal (a da assinatura). Oficinas extras (multi-oficinas do Pro) entram com principal = false.
alter table public.membros add column if not exists principal boolean not null default true;
create unique index if not exists membros_um_dono_principal on public.membros (user_id) where papel = 'dono' and principal;
delete from public.plataforma_config where chave = 'loja_padrao';
