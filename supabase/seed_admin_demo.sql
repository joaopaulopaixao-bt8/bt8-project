-- Dados FICTÍCIOS para ver o painel Admin 360 no Supabase LOCAL. Nunca rodar em produção.
-- Uso (precisa do -v ambiente=local):
--   docker exec -i supabase_db_bt8 psql -U postgres -d postgres -v ambiente=local < supabase/seed_admin_demo.sql
-- Pode rodar de novo: apaga e recria só os usuários @demo.bt8.test.
-- As contas demo não têm senha (encrypted_password vazio): ninguém faz login com elas, em lugar nenhum.

\set ON_ERROR_STOP on
\if :{?ambiente}
\else
  \echo 'Recusado: rode com -v ambiente=local (seed só para o Supabase local).'
  \quit
\endif
select (:'ambiente' = 'local') as ambiente_ok \gset
\if :ambiente_ok
\else
  \echo 'Recusado: ambiente diferente de local.'
  \quit
\endif

begin;

-- Trava no próprio banco: precisa do admin do seed.sql local e de nenhum e-mail fora dos domínios de teste.
do $$
begin
  if not exists (
    select 1 from auth.users
    where id = '00000000-0000-4000-8000-000000000001' and email = 'admin@bt8.test'
  ) then
    raise exception 'Recusado: este banco não tem o admin@bt8.test do seed local.';
  end if;
  if exists (select 1 from auth.users where email is not null and email not like '%.test') then
    raise exception 'Recusado: há e-mails reais neste banco; seed_admin_demo.sql é só para o Supabase local.';
  end if;
end $$;

-- Eventos do seed levam metadata.demo = true; apaga antes (apagar o usuário só zera o user_id).
delete from public.app_events where metadata->>'demo' = 'true';
delete from auth.users where email like '%@demo.bt8.test';

select setseed(0.42);

-- 40 clientes criados ao longo dos últimos ~60 dias.
with names(n, nome) as (
  select i, (array['Ana','Bruno','Carla','Diego','Elisa','Fábio','Gabi','Hugo','Isa','João','Karen','Lucas','Mari','Nico','Olga','Pedro','Rafa','Sofia','Tiago','Vera'])[1 + (i % 20)]
            || ' ' || (array['Lima','Souza','Rocha','Alves','Costa','Melo','Dias','Reis'])[1 + (i % 8)]
  from generate_series(1, 40) i
)
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change, email_change_token_new)
select '00000000-0000-0000-0000-000000000000',
       ('00000000-0000-4000-9000-' || lpad(n::text, 12, '0'))::uuid,
       'authenticated', 'authenticated',
       'cliente' || n || '@demo.bt8.test', '', now(),
       '{"provider":"email","providers":["email"]}'::jsonb,
       jsonb_build_object('full_name', nome),
       now() - ((60 - n * 1.5) || ' days')::interval, now(), '', '', '', ''
from names;

update public.profiles p
set created_at = u.created_at, cidade = 'Cidade Demo', estado = 'SP'
from auth.users u
where u.id = p.id and u.email like '%@demo.bt8.test';

-- Mensais ativos: clientes 1-10 (1 e 2 com cobrança recusada -> past_due).
insert into public.subscriptions (user_id, plan_type, status, current_period_end, metadata, created_at)
select ('00000000-0000-4000-9000-' || lpad(n::text, 12, '0'))::uuid, 'recurring',
       case when n <= 2 then 'past_due' when n = 3 then 'cancel_at_period_end' else 'active' end,
       now() + ((n % 25 + 3) || ' days')::interval,
       jsonb_build_object('checkout_session_id', 'cs_demo_' || n, 'cancel_at_period_end', n = 3),
       now() - ((55 - n * 4) || ' days')::interval
from generate_series(1, 10) n;

-- Pro 30 dias: clientes 11-18 (11-13 vencem nos próximos 7 dias; 17-18 já venceram).
insert into public.subscriptions (user_id, plan_type, status, current_period_end, metadata, created_at)
select ('00000000-0000-4000-9000-' || lpad(n::text, 12, '0'))::uuid, 'one_time_30d', 'paid',
       now() + (case when n <= 13 then (n - 10) * 2 when n >= 17 then -5 else 12 end || ' days')::interval,
       jsonb_build_object('checkout_session_id', 'cs_demo_' || n),
       now() - (case when n <= 13 then 30 - (n - 10) * 2 when n >= 17 then 35 else 18 end || ' days')::interval
from generate_series(11, 18) n;

-- Cancelado (19) e reembolsado (20).
insert into public.subscriptions (user_id, plan_type, status, current_period_end, metadata, created_at)
values
  ('00000000-0000-4000-9000-000000000019', 'recurring', 'canceled', now() - interval '2 days',
   '{"checkout_session_id":"cs_demo_19"}'::jsonb, now() - interval '40 days'),
  ('00000000-0000-4000-9000-000000000020', 'one_time_30d', 'refunded', null,
   '{"checkout_session_id":"cs_demo_20","revoked_reason":"refunded","revoked_charge_id":"ch_demo_20"}'::jsonb,
   now() - interval '6 days');

-- stripe_subscription_id nas recorrentes (o webhook grava sub_...).
update public.subscriptions s
set stripe_subscription_id = 'sub_demo_' || right(s.user_id::text, 2)
from public.profiles p
where p.id = s.user_id and p.email like '%@demo.bt8.test' and s.plan_type = 'recurring';

update public.profiles p
set plan = case when s.status in ('active', 'past_due', 'cancel_at_period_end') or (s.status = 'paid' and s.current_period_end > now()) then 'pro' else 'free' end,
    pro_until = s.current_period_end,
    subscription_status = s.status
from public.subscriptions s
where s.user_id = p.id and p.email like '%@demo.bt8.test';

-- Eventos de pagamento no formato do webhook (PR #9): sem amount_cents -> painel mostra "estimado".
insert into public.app_events (user_id, event_type, metadata, created_at)
select s.user_id, 'payment_completed', jsonb_build_object('plan_type', s.plan_type, 'checkout_session_id', s.metadata->>'checkout_session_id'), s.created_at
from public.subscriptions s join public.profiles p on p.id = s.user_id
where p.email like '%@demo.bt8.test';

insert into public.app_events (user_id, event_type, metadata, created_at) values
  ('00000000-0000-4000-9000-000000000020', 'payment_refunded', '{"charge_id":"ch_demo_20"}', now() - interval '4 days'),
  ('00000000-0000-4000-9000-000000000019', 'subscription_cancelled', '{"status":"canceled","subscription_id":"sub_demo_19"}', now() - interval '2 days'),
  ('00000000-0000-4000-9000-000000000001', 'invoice_payment_failed', '{"invoice_id":"in_demo_1"}', now() - interval '3 days'),
  ('00000000-0000-4000-9000-000000000002', 'invoice_payment_failed', '{"invoice_id":"in_demo_2"}', now() - interval '1 day'),
  (null, 'stripe_event_processed', '{"event_id":"evt_demo","type":"checkout.session.completed"}', now() - interval '3 hours');

-- Torneios dos últimos 60 dias.
insert into public.tournaments (user_id, mode, category, title, players, created_at)
select ('00000000-0000-4000-9000-' || lpad((1 + floor(random() * 30))::int::text, 12, '0'))::uuid,
       (array['s8','s8','s8','s4','s6','s12','df','da','mista'])[1 + floor(random() * 9)::int],
       'Demo', 'Torneio demo', '[]'::jsonb,
       now() - (random() * 60 || ' days')::interval
from generate_series(1, 140);

-- Erros do app nas últimas 24 h (um deles já aparecia antes = não é "novo").
insert into public.app_events (event_type, metadata, created_at)
select 'client_error', jsonb_build_object('message', m), now() - (random() * 23 || ' hours')::interval
from (values
  ('TypeError: Cannot read properties of undefined (reading ''players'')'),
  ('TypeError: Cannot read properties of undefined (reading ''players'')'),
  ('TypeError: Cannot read properties of undefined (reading ''players'')'),
  ('NetworkError when attempting to fetch resource.'),
  ('NetworkError when attempting to fetch resource.'),
  ('QuotaExceededError: localStorage cheio')
) v(m);
insert into public.app_events (event_type, metadata, created_at)
values ('client_error', '{"message":"NetworkError when attempting to fetch resource."}', now() - interval '5 days');

-- Bloqueios de limite na semana.
insert into public.app_events (event_type, metadata, created_at)
select (array['guest_limit_reached','free_limit_reached'])[1 + (i % 2)],
       case when i % 2 = 0 then '{"month_key":"demo","limit":1}'::jsonb else '{"used":2,"limit":2}'::jsonb end,
       now() - (i || ' hours')::interval
from generate_series(1, 9) i;
-- O front grava um guest_limit_reached a mais por bloqueio; o painel ignora este.
insert into public.app_events (event_type, metadata, created_at)
values ('guest_limit_reached', '{"source":"frontend"}', now() - interval '2 hours');

-- Visitantes sem login (guest_usage, normalmente escrita só pela Function guest-usage).
delete from public.guest_usage where guest_id like 'demo-%';
insert into public.guest_usage (guest_id, month_key, tournaments_created, first_seen_at, last_seen_at)
select 'demo-' || i, to_char(now() at time zone 'America/Sao_Paulo', 'YYYY-MM'), case when i <= 5 then 1 else 0 end,
       now() - (i || ' days')::interval, now() - (i || ' days')::interval
from generate_series(1, 7) i;

-- Marca os eventos inseridos nesta transação (xmin = id da transação) para a limpeza da próxima execução.
update public.app_events set metadata = metadata || '{"demo":true}'
where xmin::text::bigint = txid_current() % 4294967296;

commit;
