-- Dados FICTÍCIOS para ver o painel Admin 360 no Supabase LOCAL. Nunca rodar em produção.
-- Uso: docker exec -i supabase_db_bt8 psql -U postgres -d postgres < supabase/seed_admin_demo.sql
-- Pode rodar de novo: apaga e recria só os usuários @demo.bt8.test.

do $$
begin
  if exists (select 1 from public.profiles where email = 'joaopaulopaixao@gmail.com') or current_database() <> 'postgres'
     or not exists (select 1 from auth.users where email = 'admin@bt8.test') then
    raise exception 'seed_admin_demo.sql é só para o Supabase local (precisa do admin@bt8.test do seed.sql).';
  end if;
end $$;

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
       'cliente' || n || '@demo.bt8.test', crypt('bt8-local-123', gen_salt('bf')), now(),
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
       case when n <= 2 then 'past_due' else 'active' end,
       now() + ((n % 25 + 3) || ' days')::interval, '{}'::jsonb,
       now() - ((55 - n * 4) || ' days')::interval
from generate_series(1, 10) n;

-- Pro 30 dias: clientes 11-18 (11-13 vencem nos próximos 7 dias; 17-18 já venceram).
insert into public.subscriptions (user_id, plan_type, status, current_period_end, metadata, created_at)
select ('00000000-0000-4000-9000-' || lpad(n::text, 12, '0'))::uuid, 'one_time_30d', 'paid',
       now() + (case when n <= 13 then (n - 10) * 2 when n >= 17 then -5 else 12 end || ' days')::interval,
       '{}'::jsonb,
       now() - (case when n <= 13 then 30 - (n - 10) * 2 when n >= 17 then 35 else 18 end || ' days')::interval
from generate_series(11, 18) n;

-- Cancelado (19) e reembolsado (20).
insert into public.subscriptions (user_id, plan_type, status, current_period_end, metadata, created_at)
values
  ('00000000-0000-4000-9000-000000000019', 'recurring', 'canceled', now() - interval '2 days', '{}'::jsonb, now() - interval '40 days'),
  ('00000000-0000-4000-9000-000000000020', 'one_time_30d', 'refunded', null,
   '{"revoked_reason":"refunded","revoked_charge_id":"ch_demo_20"}'::jsonb, now() - interval '6 days');

update public.profiles p
set plan = case when s.status in ('active', 'past_due') or (s.status = 'paid' and s.current_period_end > now()) then 'pro' else 'free' end,
    pro_until = s.current_period_end,
    subscription_status = s.status
from public.subscriptions s
where s.user_id = p.id and p.email like '%@demo.bt8.test';

-- Eventos de pagamento no formato do webhook (PR #9): sem amount_cents -> painel mostra "estimado".
insert into public.app_events (user_id, event_type, metadata, created_at)
select s.user_id, 'payment_completed', jsonb_build_object('plan_type', s.plan_type, 'checkout_session_id', 'cs_demo_' || s.id), s.created_at
from public.subscriptions s join public.profiles p on p.id = s.user_id
where p.email like '%@demo.bt8.test';

insert into public.app_events (user_id, event_type, metadata, created_at) values
  ('00000000-0000-4000-9000-000000000020', 'payment_refunded', '{"charge_id":"ch_demo_20"}', now() - interval '4 days'),
  ('00000000-0000-4000-9000-000000000019', 'subscription_cancelled', '{"status":"canceled"}', now() - interval '2 days'),
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
select (array['guest_limit_reached','free_limit_reached'])[1 + (i % 2)], '{}'::jsonb, now() - (i || ' hours')::interval
from generate_series(1, 9) i;
