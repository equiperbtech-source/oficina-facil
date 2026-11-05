-- =====================================================================
-- SaaS · Etapa 27: carrinhos abandonados no painel admin.
-- Kiwify ("status": "abandoned") e Hotmart (PURCHASE_OUT_OF_SHOPPING_CART) mandam um aviso quando a pessoa
-- abre o checkout e não paga. Esses avisos já ficam em kiwify_eventos como "ignorado" (não mexem em loja).
-- Aqui o painel passa a listar essas pessoas (uma linha por e-mail, a tentativa mais recente), mostra se ela
-- comprou depois e guarda se o admin já entrou em contato (WhatsApp ou e-mail) ou descartou.
-- ADITIVA (tabela e funções novas). Reverter: 27_carrinhos_abandonados_reverter.sql
-- =====================================================================

create table if not exists public.carrinhos_contato (
  email text primary key,                                  -- sempre em minúsculas
  situacao text not null check (situacao in ('contatado', 'descartado')),
  canal text,                                              -- whatsapp | email
  atualizado_em timestamptz not null default now()
);
alter table public.carrinhos_contato enable row level security;
revoke all on public.carrinhos_contato from anon, authenticated;

-- p_filtro: 'abertos' (a recuperar: não comprou e ninguém falou ainda) | 'contatados' | 'compraram' | 'descartados' | 'todos'
create or replace function public.admin_carrinhos(p_filtro text) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
begin
  perform public.exigir_admin();
  return coalesce((select jsonb_agg(to_jsonb(x) order by x.recebido_em desc) from (
    select c.*, cc.situacao, cc.canal, cc.atualizado_em as contato_em,
      exists (select 1 from public.kiwify_eventos a where lower(a.email) = c.email and a.tipo in ('compra_aprovada', 'renovacao') and a.recebido_em >= c.recebido_em - interval '2 days')
        or exists (select 1 from public.lojas l where lower(l.comprador_email) = c.email) as comprou,
      exists (select 1 from public.membros m where lower(m.email) = c.email) as tem_conta,
      (select count(*) from public.kiwify_eventos t where t.tipo = 'ignorado' and lower(coalesce(nullif(t.email, ''), t.payload ->> 'email', t.payload #>> '{data,buyer,email}', '')) = c.email
         and (t.payload ->> 'status' = 'abandoned' or t.tipo_original in ('PURCHASE_OUT_OF_SHOPPING_CART', 'carrinho_abandonado', 'abandoned_cart'))) as tentativas
    from (
      select distinct on (b.email) b.* from (
        select e.id, e.provedor, e.recebido_em,
          lower(coalesce(nullif(e.email, ''), e.payload ->> 'email', e.payload #>> '{data,buyer,email}', '')) as email,
          coalesce(e.payload ->> 'name', e.payload #>> '{data,buyer,name}') as nome,
          coalesce(e.payload ->> 'phone', e.payload #>> '{data,buyer,checkout_phone}', e.payload #>> '{data,buyer,phone}') as telefone,
          coalesce(e.payload ->> 'subscription_plan', e.payload ->> 'offer_name', e.payload #>> '{data,offer,name}', e.payload #>> '{data,subscription,plan,name}') as plano,
          coalesce(e.payload ->> 'product_name', e.payload #>> '{data,product,name}') as produto,
          coalesce(e.payload ->> 'country', e.payload #>> '{data,buyer,address,country_iso}') as pais,
          e.payload ->> 'checkout_link' as checkout
        from public.kiwify_eventos e
        where e.tipo = 'ignorado'
          and (e.payload ->> 'status' = 'abandoned' or e.tipo_original in ('PURCHASE_OUT_OF_SHOPPING_CART', 'carrinho_abandonado', 'abandoned_cart'))
      ) b where b.email <> '' order by b.email, b.recebido_em desc
    ) c
    left join public.carrinhos_contato cc on cc.email = c.email
  ) x
  where case coalesce(nullif(p_filtro, ''), 'abertos')
    when 'abertos' then not x.comprou and x.situacao is null
    when 'contatados' then not x.comprou and x.situacao = 'contatado'
    when 'descartados' then not x.comprou and x.situacao = 'descartado'
    when 'compraram' then x.comprou
    else true end
  ), '[]'::jsonb);
end $$;

-- marca a pessoa como contatada (whatsapp/email) ou descartada; 'reabrir' volta para "a recuperar"
create or replace function public.admin_carrinho_marcar(p_email text, p_situacao text, p_canal text) returns void
  language plpgsql security definer set search_path = public as $$
declare e text := lower(trim(coalesce(p_email, '')));
begin
  perform public.exigir_admin();
  if e = '' then raise exception 'E-mail obrigatório'; end if;
  if p_situacao = 'reabrir' then delete from public.carrinhos_contato where email = e; return; end if;
  if p_situacao not in ('contatado', 'descartado') then raise exception 'Situação inválida'; end if;
  insert into public.carrinhos_contato (email, situacao, canal, atualizado_em) values (e, p_situacao, nullif(p_canal, ''), now())
  on conflict (email) do update set situacao = excluded.situacao, canal = coalesce(excluded.canal, public.carrinhos_contato.canal), atualizado_em = now();
end $$;

revoke all on function public.admin_carrinhos(text), public.admin_carrinho_marcar(text, text, text) from public, anon;
grant execute on function public.admin_carrinhos(text), public.admin_carrinho_marcar(text, text, text) to authenticated;
