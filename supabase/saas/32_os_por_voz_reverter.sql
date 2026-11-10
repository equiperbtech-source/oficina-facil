-- Reverter da 32 (OS por voz): apaga as funções e a tabela de uso (só tem horários, nenhum áudio). Seguro rodar de novo.
drop function if exists public.voz_catalogo(uuid);
drop function if exists public.registrar_uso_voz(uuid);
drop table if exists public.voz_uso;
