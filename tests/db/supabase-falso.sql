-- Simulação mínima do Supabase para os TESTES (nunca rodar no Supabase de verdade).
-- Cria o que o Supabase já traz pronto: papéis anon/authenticated, auth.users e auth.uid()/jwt(),
-- storage (buckets e objects com RLS), realtime.send, pg_net (net.http_post grava os e-mails numa tabela)
-- e um aviso (NOTIFY) a cada mudança em public.itens, usado pelo servidor de testes no "tempo real".
do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin create role service_role nologin bypassrls; exception when duplicate_object then null; end $$;
grant anon, authenticated, service_role to current_user;

create extension if not exists pgcrypto;

-- ---------- auth ----------
create schema if not exists auth;
grant usage on schema auth to anon, authenticated, service_role;
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  encrypted_password text,
  email_confirmed_at timestamptz default now(),
  raw_user_meta_data jsonb not null default '{}',
  raw_app_meta_data jsonb not null default '{"provider":"email","providers":["email"]}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create or replace function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
create or replace function auth.uid() returns uuid language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), auth.jwt() ->> 'sub')::uuid $$;
create or replace function auth.role() returns text language sql stable as $$ select auth.jwt() ->> 'role' $$;
create or replace function auth.email() returns text language sql stable as $$ select auth.jwt() ->> 'email' $$;
grant execute on all functions in schema auth to anon, authenticated, service_role;

-- ---------- storage ----------
create schema if not exists storage;
grant usage on schema storage to anon, authenticated, service_role;
create table if not exists storage.buckets (
  id text primary key, name text, public boolean default false,
  file_size_limit bigint, allowed_mime_types text[], created_at timestamptz default now()
);
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id), name text, owner uuid default auth.uid(),
  metadata jsonb default '{}', created_at timestamptz default now(), updated_at timestamptz default now(),
  unique (bucket_id, name)
);
alter table storage.objects enable row level security;
grant select, insert, update, delete on storage.objects to anon, authenticated;
grant select on storage.buckets to anon, authenticated;
grant all on storage.objects, storage.buckets to service_role;
create or replace function storage.foldername(name text) returns text[] language sql immutable as $$
  select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
create or replace function storage.filename(name text) returns text language sql immutable as $$
  select (string_to_array(name, '/'))[array_length(string_to_array(name, '/'), 1)] $$;
grant execute on all functions in schema storage to anon, authenticated, service_role;

-- ---------- realtime ----------
create schema if not exists realtime;
grant usage on schema realtime to anon, authenticated, service_role;
-- broadcast (ex.: canal os-<token> do link do cliente): vira NOTIFY para o servidor de testes repassar
create or replace function realtime.send(payload jsonb, event text, topic text, private boolean default true)
returns void language sql as $$
  select pg_notify('teste_broadcast', jsonb_build_object('topic', topic, 'event', event, 'payload', payload)::text)::text::void $$;
grant execute on all functions in schema realtime to anon, authenticated, service_role;
do $$ begin create publication supabase_realtime; exception when duplicate_object then null; end $$;

-- ---------- pg_net (e-mails pelo Brevo): nos testes nada sai da máquina, fica guardado aqui ----------
create schema if not exists net;
grant usage on schema net to anon, authenticated, service_role;
create table if not exists net.envios (
  id bigserial primary key, url text, headers jsonb, body jsonb, criado_em timestamptz default now()
);
create table if not exists net._http_response (
  id bigint primary key, status_code int, content text, error_msg text, created timestamptz default now()
);
create or replace function net.http_post(url text, body jsonb default '{}', params jsonb default '{}',
  headers jsonb default '{}', timeout_milliseconds int default 5000) returns bigint
language plpgsql security definer as $$
declare v bigint;
begin
  insert into net.envios(url, headers, body) values (url, headers, body) returning id into v;
  insert into net._http_response(id, status_code, content) values (v, 201, '{"messageId":"teste"}');
  return v;
end $$;
grant execute on all functions in schema net to anon, authenticated, service_role;

-- ---------- permissões padrão do Supabase no schema public ----------
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant select, insert, update, delete on tables to anon, authenticated, service_role;
alter default privileges in schema public grant usage, select on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
