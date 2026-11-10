-- Reverte a etapa 5 (apaga notas, consumo e créditos registrados nesta etapa)
drop function if exists public.email_dono(uuid);
drop function if exists public.marcar_avisos_lidos(uuid);
drop function if exists public.evento_nota(text, text, text, text, text, text, text, text, jsonb);
drop function if exists public.estornar_creditos(uuid, int, text);
drop function if exists public.creditar_notas(uuid, int, text, text);
drop function if exists public.cancelar_nota_registro(text);
drop function if exists public.marcar_nota_processando(text, text);
drop function if exists public.liberar_nota(text, text, text);
drop function if exists public.confirmar_nota(text, text, text, text, text);
drop function if exists public.reservar_nota(uuid, text, text, jsonb, text, numeric);
drop function if exists public.salvar_cadastro_fiscal(uuid, jsonb);
drop function if exists public.saldo_notas(uuid);
drop function if exists public.mes_atual();
drop table if exists public.nfse_eventos, public.avisos_loja, public.consumo_notas, public.creditos_mov, public.creditos, public.consumo_mensal, public.notas_fiscais, public.lojas_fiscal;
