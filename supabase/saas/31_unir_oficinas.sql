-- 31 · Admin: unir oficinas duplicadas do mesmo e-mail, sem apagar nem sobrescrever nada.
-- ADITIVA: colunas novas e funções novas. Seguro rodar de novo. Reverter: 31_unir_oficinas_reverter.sql
--   - Prevalece a oficina com MAIS cadastros (empate: a mais antiga). Nada dela é substituído:
--     registro que já existe nela fica como está; da outra só entra o que falta.
--   - Número repetido (OS nº 1 nas duas): o que veio da outra ganha o próximo número livre.
--   - Configurações: valem as da que prevalece; só entra o que ela não tinha.
--   - A outra oficina NÃO é apagada: fica marcada como unida (unida_a/unida_em) e sem equipe (ninguém entra nela).

alter table public.lojas add column if not exists unida_a uuid references public.lojas(id) on delete set null;
alter table public.lojas add column if not exists unida_em timestamptz;

create or replace function public.unir_oficinas(p_destino uuid, p_origem uuid) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare r record; novo int; movidos int := 0; renumerados int := 0; mantidos int := 0; s_dest jsonb; s_orig jsonb;
begin
  if p_destino = p_origem then raise exception 'escolha duas oficinas diferentes'; end if;
  if not exists (select 1 from public.lojas where id = p_destino) or not exists (select 1 from public.lojas where id = p_origem) then raise exception 'oficina não encontrada'; end if;
  perform set_config('oficina.migrando', '1', true);
  for r in select * from public.itens where loja_id = p_origem and colecao <> 'meta' order by colecao, id loop
    if exists (select 1 from public.itens where loja_id = p_destino and colecao = r.colecao and id = r.id) then mantidos := mantidos + 1; continue; end if;
    if (r.dados ->> 'numero') ~ '^\d+$' and exists (select 1 from public.itens where loja_id = p_destino and colecao = r.colecao and dados ->> 'numero' = r.dados ->> 'numero') then
      select coalesce(max(public.num_seguro(dados ->> 'numero')), 0)::int + 1 into novo from public.itens where loja_id = p_destino and colecao = r.colecao;
      r.dados := jsonb_set(r.dados, '{numero}', to_jsonb(novo)); renumerados := renumerados + 1;
    end if;
    insert into public.itens(loja_id, colecao, id, dados, atualizado_em) values (p_destino, r.colecao, r.id, r.dados, r.atualizado_em);
    movidos := movidos + 1;
  end loop;
  -- configurações: as da que prevalece ficam; só entra o que ela não tinha
  select dados into s_dest from public.itens where loja_id = p_destino and colecao = 'meta' and id = 'settings';
  select dados into s_orig from public.itens where loja_id = p_origem and colecao = 'meta' and id = 'settings';
  if s_orig is not null then
    insert into public.itens(loja_id, colecao, id, dados) values (p_destino, 'meta', 'settings', s_orig)
    on conflict (loja_id, colecao, id) do update set dados = s_orig || public.itens.dados, atualizado_em = now();
  end if;
  -- contadores: o maior de cada (para não repetir número)
  insert into public.itens(loja_id, colecao, id, dados)
    select p_destino, 'meta', 'seq', o.dados from public.itens o where o.loja_id = p_origem and o.colecao = 'meta' and o.id = 'seq'
  on conflict (loja_id, colecao, id) do update set dados = (select jsonb_object_agg(k, greatest(coalesce(public.num_seguro(public.itens.dados ->> k), 0), coalesce(public.num_seguro(excluded.dados ->> k), 0)))
      from (select jsonb_object_keys(public.itens.dados) k union select jsonb_object_keys(excluded.dados)) ks), atualizado_em = now();
  -- equipe da outra entra (sem tirar ninguém); a outra fica sem equipe e marcada como unida
  insert into public.membros(loja_id, user_id, email, nome, papel, notificar_pedidos, ativo, principal)
    select p_destino, user_id, email, nome, case when papel = 'dono' then 'atendente' else papel end, notificar_pedidos, ativo, false from public.membros m
     where m.loja_id = p_origem and not exists (select 1 from public.membros x where x.loja_id = p_destino and x.user_id = m.user_id)
  on conflict do nothing;
  delete from public.membros where loja_id = p_origem;
  update public.lojas set unida_a = p_destino, unida_em = now() where id = p_origem;
  perform set_config('oficina.migrando', '', true);
  return jsonb_build_object('destino', p_destino, 'origem', p_origem, 'registros_movidos', movidos, 'ja_existiam', mantidos, 'numeros_trocados', renumerados);
end $$;
revoke all on function public.unir_oficinas(uuid, uuid) from public, anon, authenticated;

-- oficinas do mesmo e-mail de dono (candidatas a unir)
create or replace function public.admin_duplicadas() returns jsonb
  language plpgsql security definer set search_path = public as $$
begin
  perform public.exigir_admin();
  return coalesce((select jsonb_agg(g order by g ->> 'email') from (
    select jsonb_build_object('email', lower(m.email), 'oficinas', jsonb_agg(jsonb_build_object('id', l.id, 'nome', l.nome, 'criado_em', l.criado_em,
             'cadastros', (select count(*) from public.itens i where i.loja_id = l.id and i.colecao <> 'meta')) order by l.criado_em)) g
      from public.membros m join public.lojas l on l.id = m.loja_id
     where m.papel = 'dono' and m.email is not null and l.unida_a is null
     group by lower(m.email) having count(distinct l.id) > 1) x), '[]'::jsonb);
end $$;
revoke all on function public.admin_duplicadas() from public, anon;
grant execute on function public.admin_duplicadas() to authenticated;

-- unir duas oficinas (o admin escolhe as duas; a com mais cadastros prevalece)
create or replace function public.admin_unir_lojas(p_a uuid, p_b uuid, p_motivo text) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare na int; nb int; ca timestamptz; cb timestamptz; destino uuid; origem uuid; r jsonb;
begin
  perform public.exigir_admin();
  if coalesce(trim(p_motivo), '') = '' then raise exception 'informe o motivo'; end if;
  if not exists (select 1 from public.membros a join public.membros b on lower(a.email) = lower(b.email)
                  where a.loja_id = p_a and b.loja_id = p_b and a.papel = 'dono' and b.papel = 'dono') then
    raise exception 'as duas oficinas precisam ter o mesmo e-mail de dono';
  end if;
  select count(*) into na from public.itens where loja_id = p_a and colecao <> 'meta';
  select count(*) into nb from public.itens where loja_id = p_b and colecao <> 'meta';
  select criado_em into ca from public.lojas where id = p_a; select criado_em into cb from public.lojas where id = p_b;
  if na > nb or (na = nb and ca <= cb) then destino := p_a; origem := p_b; else destino := p_b; origem := p_a; end if;
  r := public.unir_oficinas(destino, origem);
  perform public.auditar('unir_oficinas', destino, jsonb_build_object('origem', origem, 'cadastros', jsonb_build_object(p_a::text, na, p_b::text, nb)), r, p_motivo);
  return r;
end $$;
revoke all on function public.admin_unir_lojas(uuid, uuid, text) from public, anon;
grant execute on function public.admin_unir_lojas(uuid, uuid, text) to authenticated;
