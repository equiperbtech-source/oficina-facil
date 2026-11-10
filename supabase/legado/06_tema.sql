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
