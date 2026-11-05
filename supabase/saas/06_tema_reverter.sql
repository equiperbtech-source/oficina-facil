-- Reverte a etapa 6 (apaga os temas; o app volta à identidade fixa)
drop policy if exists lojas_dominios_dono on public.lojas_dominios;
create policy lojas_dominios_dono on public.lojas_dominios for all using (public.sou_dono(loja_id)) with check (public.sou_dono(loja_id) and verificado = false);
drop function if exists public.tema_por_os(text);
drop function if exists public.tema_publico(uuid);
drop function if exists public.salvar_tema(uuid, jsonb);
drop trigger if exists lojas_tema_inicial on public.lojas;
drop function if exists public.lojas_tema_inicial();
drop table if exists public.lojas_tema;
