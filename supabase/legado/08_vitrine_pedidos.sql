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
