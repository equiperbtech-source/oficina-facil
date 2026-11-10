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
