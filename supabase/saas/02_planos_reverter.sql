-- Reverte a etapa 2: volta as regras e funções ao estado anterior. Dados das lojas (itens) não são tocados.
-- Atenção: funcionários com papel atendente/técnico voltam a ser "membro".
drop policy if exists itens_ver on public.itens;
create policy itens_ver on public.itens for select using (loja_id in (select public.minhas_lojas()));
drop policy if exists itens_inserir on public.itens;
create policy itens_inserir on public.itens for insert with check (loja_id in (select public.minhas_lojas())
  and (not (colecao = 'meta' and id = 'settings') or public.sou_dono(loja_id)));
drop policy if exists itens_editar on public.itens;
create policy itens_editar on public.itens for update using (loja_id in (select public.minhas_lojas()))
  with check (loja_id in (select public.minhas_lojas()) and (not (colecao = 'meta' and id = 'settings') or public.sou_dono(loja_id)));
drop policy if exists itens_apagar on public.itens;
create policy itens_apagar on public.itens for delete using (loja_id in (select public.minhas_lojas())
  and (not (colecao = 'meta' and id = 'settings') or public.sou_dono(loja_id)));

create or replace function public.minhas_lojas() returns setof uuid
  language sql stable security definer set search_path = public as $$
  select loja_id from public.membros where user_id = auth.uid()
$$;
create or replace function public.sou_dono(l uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.membros where loja_id = l and user_id = auth.uid() and papel = 'dono')
$$;
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

drop function if exists public.minha_assinatura(uuid);
drop function if exists public.ajustar_ao_plano(uuid);
drop function if exists public.definir_membro_ativo(uuid, uuid, boolean);
drop function if exists public.definir_papel(uuid, uuid, text);
drop function if exists public.checar_vaga(uuid);
drop function if exists public.pode_gravar_colecao(uuid, text, text);
drop function if exists public.pode_ver_colecao(uuid, text);
drop function if exists public.limite_funcionarios(uuid);
drop function if exists public.funcionarios_ativos(uuid);
drop function if exists public.meu_papel(uuid);
drop function if exists public.pode_escrever(uuid);
drop function if exists public.tem_recurso(uuid, text);
drop function if exists public.loja_plano(uuid);
drop function if exists public.loja_situacao(uuid);

update public.membros set papel = 'membro' where papel in ('atendente', 'tecnico');
delete from public.membros where papel = 'suporte';
alter table public.membros drop constraint if exists membros_papel_check;
alter table public.membros add constraint membros_papel_check check (papel in ('dono', 'membro'));
alter table public.membros drop column if exists expira_em;
alter table public.membros drop column if exists desativado_em;
alter table public.membros drop column if exists ativo;

grant update on public.lojas to authenticated;
drop trigger if exists lojas_assinatura_inicial on public.lojas;
drop function if exists public.lojas_padrao_assinatura();
alter table public.lojas drop constraint if exists lojas_status_assinatura_ok;
alter table public.lojas drop column if exists assinatura_atualizada_em, drop column if exists bloqueio_motivo,
  drop column if exists isenta, drop column if exists cortesia_ate, drop column if exists inadimplente_desde,
  drop column if exists periodo_pago_ate, drop column if exists proxima_cobranca, drop column if exists teste_ate,
  drop column if exists status_assinatura, drop column if exists plano_id;
delete from public.plataforma_config where chave in ('dias_teste', 'tolerancia_atraso_dias', 'plano_teste');
drop table if exists public.planos;
