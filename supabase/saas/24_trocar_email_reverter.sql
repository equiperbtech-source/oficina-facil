-- Reverte a etapa 24 (só remove as funções; os e-mails já atualizados continuam).
drop function if exists public.email_da_compra(uuid);
drop function if exists public.sincronizar_meu_email();
