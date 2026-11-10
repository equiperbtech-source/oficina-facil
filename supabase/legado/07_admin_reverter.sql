-- Reverte a etapa 7 (remove o painel admin e a auditoria; acessos de suporte são apagados)
do $$ declare f text; begin
  foreach f in array array['admin_resumo()', 'admin_lojas(text,text,text,text,int,int)', 'admin_loja(uuid)', 'admin_eventos(text,int,int)', 'admin_produtos()',
    'admin_avisos()', 'admin_consumo_notas(text)', 'admin_auditoria_lista(int,int)', 'admin_alterar_plano(uuid,text,text)', 'admin_cortesia(uuid,int,text)',
    'admin_bloquear(uuid,boolean,text)', 'admin_creditar(uuid,int,text)', 'admin_entrar_como(uuid,text)', 'admin_sair_da_loja(uuid)',
    'admin_reprocessar_evento(bigint)', 'admin_vincular_compra(bigint,uuid,text)', 'admin_salvar_produto(jsonb)', 'admin_salvar_plano(text,numeric,int,int)',
    'admin_config(text,jsonb)', 'admin_verificar_dominio(text,boolean)', 'admin_aviso_lido(bigint)', 'admin_estado(uuid)',
    'auditar(text,uuid,jsonb,jsonb,text)', 'exigir_admin()', 'sou_super_admin()'] loop
    execute format('drop function if exists public.%s', f);
  end loop;
end $$;
delete from public.membros where papel = 'suporte';
drop table if exists public.admin_auditoria;
drop table if exists public.super_admins;
-- volta a regra de gravação da etapa 2 (sem a condição de suporte)
create or replace function public.pode_gravar_colecao(p_loja uuid, p_colecao text, p_id text) returns boolean
  language plpgsql stable security definer set search_path = public as $$
declare papel text := public.meu_papel(p_loja);
begin
  if papel is null or not public.pode_escrever(p_loja) then return false; end if;
  if p_colecao = 'meta' and p_id = 'settings' then return papel = 'dono'; end if;
  if papel = 'tecnico' and p_colecao in ('vendas', 'lancamentos', 'caixas') then return false; end if;
  if p_colecao = 'followups' then return public.tem_recurso(p_loja, 'followup'); end if;
  if p_colecao = 'metas_func' then return public.tem_recurso(p_loja, 'metas'); end if;
  if p_colecao in ('lotes', 'nfe_entradas') then return public.tem_recurso(p_loja, 'lotes') or public.tem_recurso(p_loja, 'importar_xml'); end if;
  return true;
end $$;
