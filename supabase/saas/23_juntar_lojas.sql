-- =====================================================================
-- SaaS · Etapa 23: juntar lojas duplicadas da mesma conta numa só (sem perder nem duplicar dados).
-- Uso (SQL Editor, como admin do banco): select public.juntar_lojas_por_nome('Palhoça celular');
-- Fica a loja com mais registros (empate: a mais antiga); as outras entram nela e são apagadas.
--  - registros (OS, clientes, vendas...): entram todos; o mesmo registro nas duas fica com a versão mais nova
--  - número repetido (ex.: OS nº 1 nas duas lojas): o que veio de outra loja ganha o próximo número livre
--  - configurações: valem as da loja que fica; o que só existia na outra é acrescentado
--  - contadores de numeração: o maior; equipe, créditos de notas, notas, avisos e pagamentos: vão junto
-- Os gatilhos de e-mail não disparam durante a junção. Tudo numa transação: se algo falhar, nada muda.
-- ADITIVA (funções novas, sem acesso pelo app). Reverter: 23_juntar_lojas_reverter.sql
-- =====================================================================

create or replace function public.juntar_lojas(p_destino uuid, p_origem uuid) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare r record; novo int; movidos int := 0; renumerados int := 0; k int; s_dest jsonb; s_orig jsonb;
begin
  if p_destino = p_origem then raise exception 'escolha duas lojas diferentes'; end if;
  if not exists (select 1 from public.lojas where id = p_destino) or not exists (select 1 from public.lojas where id = p_origem) then raise exception 'loja não encontrada'; end if;
  perform set_config('oficina.migrando', '1', true);

  -- registros: entram todos; o mesmo registro nas duas lojas fica com a versão mais nova
  for r in select * from public.itens where loja_id = p_origem and colecao <> 'meta' loop
    if exists (select 1 from public.itens where loja_id = p_destino and colecao = r.colecao and id = r.id) then
      update public.itens set dados = r.dados, atualizado_em = r.atualizado_em
       where loja_id = p_destino and colecao = r.colecao and id = r.id and atualizado_em < r.atualizado_em;
      continue;
    end if;
    -- número repetido na loja que fica: próximo número livre
    if jsonb_typeof(r.dados -> 'numero') = 'number' or (r.dados ->> 'numero') ~ '^\d+$' then
      if exists (select 1 from public.itens where loja_id = p_destino and colecao = r.colecao and dados ->> 'numero' = r.dados ->> 'numero') then
        select coalesce(max(public.num_seguro(dados ->> 'numero')), 0)::int + 1 into novo from public.itens where loja_id = p_destino and colecao = r.colecao;
        r.dados := jsonb_set(r.dados, '{numero}', to_jsonb(novo));
        renumerados := renumerados + 1;
      end if;
    end if;
    insert into public.itens(loja_id, colecao, id, dados, atualizado_em) values (p_destino, r.colecao, r.id, r.dados, r.atualizado_em);
    movidos := movidos + 1;
  end loop;

  -- configurações: as da loja que fica valem; o que só existe na outra é acrescentado
  select dados into s_dest from public.itens where loja_id = p_destino and colecao = 'meta' and id = 'settings';
  select dados into s_orig from public.itens where loja_id = p_origem and colecao = 'meta' and id = 'settings';
  if s_orig is not null then
    insert into public.itens(loja_id, colecao, id, dados) values (p_destino, 'meta', 'settings', s_orig || coalesce(s_dest, '{}'::jsonb))
    on conflict (loja_id, colecao, id) do update set dados = s_orig || public.itens.dados, atualizado_em = now();
  end if;
  -- contadores de numeração: o maior de cada
  insert into public.itens(loja_id, colecao, id, dados)
    select p_destino, 'meta', 'seq', coalesce((select jsonb_object_agg(k2, greatest(coalesce(public.num_seguro(d.dados ->> k2), 0), coalesce(public.num_seguro(o.dados ->> k2), 0)))
      from public.itens o left join public.itens d on d.loja_id = p_destino and d.colecao = 'meta' and d.id = 'seq',
           lateral (select jsonb_object_keys(o.dados) as k2 union select jsonb_object_keys(coalesce(d.dados, '{}'::jsonb))) ks
      where o.loja_id = p_origem and o.colecao = 'meta' and o.id = 'seq'), '{}'::jsonb)
    where exists (select 1 from public.itens where loja_id = p_origem and colecao = 'meta' and id = 'seq')
  on conflict (loja_id, colecao, id) do update set dados = public.itens.dados || excluded.dados, atualizado_em = now();
  -- outros registros "meta" que só existam na outra loja
  insert into public.itens(loja_id, colecao, id, dados) select p_destino, colecao, id, dados from public.itens
   where loja_id = p_origem and colecao = 'meta' and id not in ('settings', 'seq') on conflict do nothing;

  -- equipe
  insert into public.membros(loja_id, user_id, email, nome, papel, notificar_pedidos, ativo)
    select p_destino, user_id, email, nome, papel, notificar_pedidos, ativo from public.membros where loja_id = p_origem
  on conflict (loja_id, user_id) do nothing;
  -- endereço curto, aparência, e-mail e fiscal: ficam os da loja que fica; os da outra só se faltar
  if (select slug from public.lojas where id = p_destino) is null then
    select slug into s_orig from (select to_jsonb(slug) as slug from public.lojas where id = p_origem) x;
    update public.lojas set slug = null where id = p_origem;
    update public.lojas set slug = s_orig #>> '{}' where id = p_destino;
  end if;
  update public.lojas_dominios set loja_id = p_destino where loja_id = p_origem;
  insert into public.lojas_tema select (jsonb_populate_record(null::public.lojas_tema, to_jsonb(t) || jsonb_build_object('loja_id', p_destino))).* from public.lojas_tema t where t.loja_id = p_origem on conflict do nothing;
  insert into public.lojas_email select (jsonb_populate_record(null::public.lojas_email, to_jsonb(t) || jsonb_build_object('loja_id', p_destino))).* from public.lojas_email t where t.loja_id = p_origem on conflict do nothing;
  insert into public.lojas_fiscal select (jsonb_populate_record(null::public.lojas_fiscal, to_jsonb(t) || jsonb_build_object('loja_id', p_destino))).* from public.lojas_fiscal t where t.loja_id = p_origem on conflict do nothing;
  -- créditos de notas: somam
  insert into public.creditos(loja_id, saldo) select p_destino, saldo from public.creditos where loja_id = p_origem
  on conflict (loja_id) do update set saldo = public.creditos.saldo + excluded.saldo;
  insert into public.consumo_mensal select (jsonb_populate_record(null::public.consumo_mensal, to_jsonb(c) || jsonb_build_object('loja_id', p_destino))).* from public.consumo_mensal c where c.loja_id = p_origem
  on conflict (loja_id, mes) do nothing;
  -- históricos: passam para a loja que fica
  update public.creditos_mov set loja_id = p_destino where loja_id = p_origem;
  update public.notas_fiscais set loja_id = p_destino where loja_id = p_origem;
  update public.consumo_notas set loja_id = p_destino where loja_id = p_origem;
  update public.avisos_loja set loja_id = p_destino where loja_id = p_origem;
  update public.nfse_eventos set loja_id = p_destino where loja_id = p_origem;
  update public.kiwify_eventos set loja_id = p_destino where loja_id = p_origem;
  update public.plataforma_avisos set loja_id = p_destino where loja_id = p_origem;

  delete from public.lojas where id = p_origem;
  perform set_config('oficina.migrando', '', true);
  return jsonb_build_object('registros_movidos', movidos, 'numeros_trocados', renumerados);
end $$;

-- junta todas as lojas com este nome e o mesmo dono (confere antes; não junta lojas de donos diferentes)
create or replace function public.juntar_lojas_por_nome(p_nome text) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare destino uuid; donos int; r record; out jsonb := '[]'::jsonb;
begin
  select count(distinct m.user_id) into donos from public.lojas l join public.membros m on m.loja_id = l.id and m.papel = 'dono' where l.nome = p_nome;
  if donos = 0 then raise exception 'nenhuma loja com o nome %', p_nome; end if;
  if donos > 1 then raise exception 'as lojas "%" têm donos diferentes: não junto automaticamente', p_nome; end if;
  select l.id into destino from public.lojas l where l.nome = p_nome
   order by (select count(*) from public.itens i where i.loja_id = l.id) desc, l.criado_em limit 1;
  for r in select l.id from public.lojas l where l.nome = p_nome and l.id <> destino order by l.criado_em loop
    out := out || jsonb_build_array(public.juntar_lojas(destino, r.id));
  end loop;
  return jsonb_build_object('loja_que_ficou', destino, 'juntadas', out,
    'registros_agora', (select count(*) from public.itens where loja_id = destino));
end $$;

revoke all on function public.juntar_lojas(uuid, uuid), public.juntar_lojas_por_nome(text) from public, anon, authenticated;
