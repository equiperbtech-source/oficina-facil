-- 30 · Link do cliente da oficina, aprovação do orçamento pelo link e busca de OS por placa.
-- ADITIVA: refaz acompanhar_os (create or replace), cria aprovar_os_link e um índice. Seguro rodar de novo.
-- Reverter: 30_link_oficina_reverter.sql
--
-- acompanhar_os devolve uma LISTA FECHADA do que pode sair no link público:
--   - placa mascarada (ABC•••3), marca, modelo, versão, ano, tipo e km da entrada;
--   - etapa, histórico (só etapa e data), previsão (só antes de ficar pronto e se a oficina usa previsão);
--   - itens da OS (serviços e peças: nome, quantidade e valor), mão de obra, peças, desconto e total;
--   - garantia (dias e km), forma de pagamento e as datas de conclusão/pagamento;
--   - se a OS está aguardando aprovação e se a oficina deixa aprovar pelo link;
--   - do cliente, só o primeiro nome. Da oficina, os dados do cabeçalho e os textos dos documentos.
-- Nunca sai: CPF, telefone ou e-mail do cliente, assinaturas, fotos de entrada, custo das peças,
-- chassi, placa completa nem observações internas.

-- ---------- placa mascarada (ABC1D23 → ABC•••3) ----------
create or replace function public.placa_mascarada(p text) returns text language sql immutable as $$
  select case when length(n) >= 4 then left(n, 3) || '•••' || right(n, 1) else '' end
    from (select upper(regexp_replace(coalesce(p, ''), '[^A-Za-z0-9]', '', 'g')) as n) x
$$;

-- ---------- link público da OS ----------
create or replace function public.acompanhar_os(p_token text) returns jsonb
  language sql stable security definer set search_path = public as $$
  with o as (
    select i.loja_id, i.dados d from public.itens i
     where i.colecao = 'os' and length(coalesce(p_token, '')) >= 16 and i.dados ->> 'token' = p_token
       and coalesce((i.dados ->> 'deleted')::boolean, false) = false
     limit 1
  ), s as (
    select coalesce((select x.dados from public.itens x, o where x.loja_id = o.loja_id and x.colecao = 'meta' and x.id = 'settings'), '{}'::jsonb) cfg
  )
  select jsonb_build_object(
    'os', jsonb_build_object(
      'numero', d -> 'numero', 'status', d -> 'status', 'statusNome', d -> 'statusNome', 'statusCor', d -> 'statusCor',
      'historico', (select coalesce(jsonb_agg(jsonb_build_object('status', h -> 'status', 'nome', h -> 'nome', 'data', h -> 'data')), '[]'::jsonb)
                      from jsonb_array_elements(case when jsonb_typeof(d -> 'historico') = 'array' then d -> 'historico' else '[]'::jsonb end) h),
      'veiculo', jsonb_build_object(
        'tipo', d #> '{veiculo,tipo}', 'placa', public.placa_mascarada(d #>> '{veiculo,placa}'),
        'marca', d #> '{veiculo,marca}', 'modelo', d #> '{veiculo,modelo}', 'versao', d #> '{veiculo,versao}',
        'ano', coalesce(d #> '{veiculo,anoModelo}', d #> '{veiculo,anoFab}'), 'cor', d #> '{veiculo,cor}'),
      'kmEntrada', d -> 'kmEntrada',
      'defeito', d -> 'defeito', 'servico', d -> 'servico',
      'itensServico', (select coalesce(jsonb_agg(jsonb_build_object('nome', it -> 'nome', 'qtd', it -> 'qtd', 'valor', it -> 'valor',
                          'garantiaDias', it -> 'garantiaDias', 'garantiaKm', it -> 'garantiaKm')), '[]'::jsonb)
                         from jsonb_array_elements(case when jsonb_typeof(d -> 'itensServico') = 'array' then d -> 'itensServico' else '[]'::jsonb end) it),
      'itensPeca', (select coalesce(jsonb_agg(jsonb_build_object('nome', it -> 'nome', 'qtd', it -> 'qtd', 'valor', it -> 'valor')), '[]'::jsonb)
                      from jsonb_array_elements(case when jsonb_typeof(d -> 'itensPeca') = 'array' then d -> 'itensPeca' else '[]'::jsonb end) it),
      'maoDeObra', d -> 'maoDeObra', 'pecas', d -> 'totalPecas', 'valor', d -> 'valor', 'desconto', d -> 'desconto', 'total', d -> 'total',
      'previsao', case when coalesce((cfg ->> 'usarPrevisao')::boolean, true) and coalesce(d ->> 'status', '') not in ('concluido', 'pago', 'interrompido')
                       then d -> 'previsao' end,
      'criadoEm', d -> 'criadoEm', 'concluidoEm', d -> 'concluidoEm', 'pagoEm', d -> 'pagoEm', 'entregueEm', d -> 'entregueEm',
      'formaPagamento', d #> '{pagamento,forma}', 'garantiaDias', d -> 'garantiaDias', 'garantiaKm', d -> 'garantiaKm',
      'aprovadoEm', d -> 'aprovadoEm',
      'podeAprovar', (d ->> 'status' = 'aprovacao' and coalesce((cfg ->> 'aprovacaoLink')::boolean, true))),
    'cliente', (select jsonb_build_object('nome', split_part(btrim(coalesce(c.dados ->> 'nome', '')), ' ', 1)) from public.itens c, o
                 where c.loja_id = o.loja_id and c.colecao = 'clientes' and c.id = o.d ->> 'clienteId'),
    'loja', jsonb_build_object('nome', cfg -> 'loja', 'cnpj', cfg -> 'cnpj', 'telefone', cfg -> 'telefone',
              'endereco', cfg -> 'endereco', 'instagram', cfg -> 'instagram', 'termosGarantia', cfg -> 'termosGarantia',
              'garantiaDias', cfg -> 'garantiaDias', 'garantiaKm', cfg -> 'garantiaKm', 'rodapePdf', cfg -> 'rodapePdf',
              'mecanico', (select t -> 'nome' from jsonb_array_elements(case when jsonb_typeof(cfg -> 'tecnicos') = 'array' then cfg -> 'tecnicos' else '[]'::jsonb end) t
                            where t ->> 'id' = coalesce(d ->> 'tecnicoId', d ->> 'mecanicoId') limit 1))
  )
  from o, s
$$;
revoke all on function public.acompanhar_os(text) from public;
grant execute on function public.acompanhar_os(text) to anon, authenticated;

-- ---------- aprovar o orçamento pelo link ----------
-- Só quando a OS está em "Aguardando aprovação" e a oficina deixa (aprovacaoLink, padrão: sim).
-- A OS vai para "Em serviço", com a aprovação no histórico. Devolve true se aprovou agora.
create or replace function public.aprovar_os_link(p_token text) returns boolean
  language plpgsql security definer set search_path = public as $$
declare r record; cfg jsonb; agora text := to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
  if length(coalesce(p_token, '')) < 16 then return false; end if;
  select loja_id, id, dados into r from public.itens
   where colecao = 'os' and dados ->> 'token' = p_token and coalesce((dados ->> 'deleted')::boolean, false) = false
   limit 1 for update;
  if not found or r.dados ->> 'status' <> 'aprovacao' then return false; end if;
  select dados into cfg from public.itens where loja_id = r.loja_id and colecao = 'meta' and id = 'settings';
  if not coalesce((cfg ->> 'aprovacaoLink')::boolean, true) then return false; end if;
  update public.itens set dados = (r.dados - 'statusNome' - 'statusCor')
      || jsonb_build_object('status', 'servico', 'aprovadoEm', agora, 'aprovadoPor', 'cliente (link)',
           'historico', coalesce(case when jsonb_typeof(r.dados -> 'historico') = 'array' then r.dados -> 'historico' end, '[]'::jsonb)
             || jsonb_build_array(jsonb_build_object('data', agora, 'status', 'servico', 'nota', 'Orçamento aprovado pelo cliente no link'))),
      atualizado_em = now(), atualizado_por = null
   where loja_id = r.loja_id and colecao = 'os' and id = r.id;
  return true;
end $$;
revoke all on function public.aprovar_os_link(text) from public;
grant execute on function public.aprovar_os_link(text) to anon, authenticated;

-- ---------- busca de OS por placa ----------
create index if not exists itens_os_placa_idx on public.itens (loja_id, (upper(regexp_replace(coalesce(dados #>> '{veiculo,placa}', ''), '[^A-Za-z0-9]', '', 'g'))))
  where colecao = 'os';

-- ---------- pedido de orçamento do cliente com o veículo (placa, tipo e ano) ----------
-- Usa as mesmas validações e limites do criar_pedido e acrescenta os dados do veículo ao pedido.
create or replace function public.criar_pedido_veiculo(p_loja uuid, p_nome text, p_telefone text, p_tipo text, p_placa text,
                                                        p_marca text, p_modelo text, p_ano text, p_defeito text, p_urgencia text) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare r jsonb; v_placa text := upper(regexp_replace(coalesce(p_placa, ''), '[^A-Za-z0-9]', '', 'g'));
begin
  r := public.criar_pedido(p_loja, p_nome, p_telefone, p_marca, p_modelo, p_defeito, p_urgencia);
  if p_loja is null and (select count(*) from public.lojas) = 1 then select id into p_loja from public.lojas; end if;
  update public.itens set dados = dados || jsonb_build_object(
      'tipo', case when p_tipo = 'moto' then 'moto' else 'carro' end, 'placa', left(v_placa, 7),
      'ano', left(regexp_replace(coalesce(p_ano, ''), '\D', '', 'g'), 4))
   where loja_id = p_loja and colecao = 'pedidos' and (dados ->> 'numero')::int = (r ->> 'numero')::int;
  return r;
end $$;
revoke all on function public.criar_pedido_veiculo(uuid, text, text, text, text, text, text, text, text, text) from public;
grant execute on function public.criar_pedido_veiculo(uuid, text, text, text, text, text, text, text, text, text) to anon, authenticated;
