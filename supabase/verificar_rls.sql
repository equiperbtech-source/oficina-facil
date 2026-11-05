-- VERIFICAÇÃO DE SEGURANÇA (somente leitura)
-- 1) Toda tabela do schema public precisa ter RLS ligada.
-- 2) Toda tabela de dados da loja precisa ter a coluna loja_id (exceto as globais da plataforma,
--    que não guardam dados de loja e não são acessíveis pelo app).
select c.relname as tabela,
       c.relrowsecurity as rls_ligada,
       exists (select 1 from information_schema.columns k
               where k.table_schema = 'public' and k.table_name = c.relname and k.column_name in ('loja_id')) as tem_loja_id,
       case when c.relname = 'lojas' then 'a própria loja (id)'
            when c.relname in ('planos', 'plataforma_config', 'kiwify_produtos', 'super_admins') then 'tabela global da plataforma (sem dados de loja)'
            else '' end as observacao,
       case when not c.relrowsecurity then 'PROBLEMA: sem RLS'
            when c.relname not in ('lojas', 'planos', 'plataforma_config', 'kiwify_produtos', 'super_admins') and not exists (select 1 from information_schema.columns k
               where k.table_schema = 'public' and k.table_name = c.relname and k.column_name = 'loja_id') then 'PROBLEMA: sem loja_id'
            else 'ok' end as situacao
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
order by situacao desc, tabela;
