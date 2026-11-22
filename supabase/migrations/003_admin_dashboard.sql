-- BT8 — Painel Admin 360 (etapas D1 e D2): funções agregadas.
-- Chamadas só pela Netlify Function admin-dashboard (service role), depois de ela validar role = 'admin'.
-- Definições (detalhes em docs/ADMIN_METRICAS.md):
--   Pro ativo      = plan 'pro' com pro_until nulo ou futuro, sem contar admin.
--   MRR            = valor mensal das recorrentes (última assinatura de cada usuário) com status active/past_due.
--   Receita        = pagamentos confirmados (app_events 'payment_completed') no período menos reembolsos
--                    ('payment_refunded') no período. Valor = metadata.amount_cents; sem ele, preço de tabela e "estimado".
--   Pro vencendo   = pro_until nos próximos 7 dias e sem recorrente active/past_due.
-- Fuso: America/Sao_Paulo para "dia" e "mês".

create index if not exists app_events_type_created_idx on public.app_events(event_type, created_at desc);
create index if not exists profiles_created_idx on public.profiles(created_at desc);
create index if not exists tournaments_created_idx on public.tournaments(created_at desc);

-- Preço de tabela (centavos) usado quando o evento não traz o valor cobrado.
create or replace function private.admin_list_price_cents(p_plan_type text)
returns integer
language sql
immutable
as $$
  select case p_plan_type when 'recurring' then 690 when 'one_time_30d' then 1490 else 0 end;
$$;

-- Pagamentos (+) e reembolsos (-) com valor em centavos e flag de estimativa.
create or replace function private.admin_money_events(p_from timestamptz, p_to timestamptz)
returns table (kind text, user_id uuid, plan_type text, amount_cents integer, estimated boolean, created_at timestamptz)
language sql
stable
security definer
set search_path = public, private
as $$
  select 'payment',
         e.user_id,
         e.metadata->>'plan_type',
         coalesce((e.metadata->>'amount_cents')::integer, private.admin_list_price_cents(e.metadata->>'plan_type')),
         (e.metadata->>'amount_cents') is null,
         e.created_at
  from public.app_events e
  where e.event_type = 'payment_completed' and e.created_at >= p_from and e.created_at < p_to
  union all
  select 'refund',
         s.user_id,
         s.plan_type,
         coalesce((e.metadata->>'amount_cents')::integer, private.admin_list_price_cents(s.plan_type)),
         (e.metadata->>'amount_cents') is null,
         e.created_at
  from public.app_events e
  left join lateral (
    select x.user_id, x.plan_type
    from public.subscriptions x
    where x.metadata->>'revoked_charge_id' = e.metadata->>'charge_id'
    order by x.updated_at desc
    limit 1
  ) s on true
  where e.event_type = 'payment_refunded' and e.created_at >= p_from and e.created_at < p_to;
$$;

-- Última assinatura de cada usuário não admin.
create or replace function private.admin_latest_subscriptions()
returns setof public.subscriptions
language sql
stable
security definer
set search_path = public, private
as $$
  select distinct on (s.user_id) s.*
  from public.subscriptions s
  join public.profiles p on p.id = s.user_id and p.role <> 'admin'
  order by s.user_id, s.created_at desc;
$$;

-- Tudo do painel, menos a lista de clientes. p_period: '7d', '30d' ou 'mes' (mês corrente até agora).
create or replace function public.admin_dashboard(p_period text default 'mes')
returns jsonb
language plpgsql
stable
security definer
set search_path = public, private
as $$
declare
  tz constant text := 'America/Sao_Paulo';
  v_now timestamptz := now();
  v_today date := (now() at time zone tz)::date;
  v_from timestamptz;
  v_prev_from timestamptz;
  v_prev_to timestamptz;
  v_days integer;
  v_month_from timestamptz := date_trunc('month', now() at time zone tz) at time zone tz;
  v_result jsonb;
begin
  if p_period = '7d' then
    v_days := 7;
    v_from := (v_today - 6)::timestamp at time zone tz;
    v_prev_from := v_from - interval '7 days';
    v_prev_to := v_now - interval '7 days';
  elsif p_period = '30d' then
    v_days := 30;
    v_from := (v_today - 29)::timestamp at time zone tz;
    v_prev_from := v_from - interval '30 days';
    v_prev_to := v_now - interval '30 days';
  else
    p_period := 'mes';
    v_days := extract(day from (date_trunc('month', v_today) + interval '1 month - 1 day'))::integer;
    v_from := v_month_from;
    v_prev_from := (date_trunc('month', v_today) - interval '1 month')::timestamp at time zone tz;
    -- Mesmo trecho do mês anterior (dia 1 até o mesmo dia/hora), limitado ao fim dele.
    v_prev_to := least(v_now - interval '1 month', v_month_from);
  end if;

  with
  cur as (select * from private.admin_money_events(v_from, v_now)),
  prev as (select * from private.admin_money_events(v_prev_from, v_prev_to)),
  prev_full as (
    select * from private.admin_money_events(v_prev_from, case when p_period = 'mes' then v_month_from else v_from end)
  ),
  latest as (select * from private.admin_latest_subscriptions()),
  recurring_live as (select * from latest where plan_type = 'recurring' and status in ('active', 'past_due')),
  pro_active as (
    select p.* from public.profiles p
    where p.role <> 'admin' and p.plan = 'pro' and (p.pro_until is null or p.pro_until > v_now)
  ),
  errors_24h as (
    select coalesce(nullif(e.metadata->>'message', ''), 'Sem mensagem') as message,
           count(*) as total,
           (array_agg(nullif(e.metadata->>'source', '') order by e.created_at desc))[1] as source,
           min(e.created_at) as first_at,
           max(e.created_at) as last_at
    from public.app_events e
    where e.event_type = 'client_error' and e.created_at >= v_now - interval '24 hours'
    group by 1
  ),
  errors_seen_before as (
    select distinct coalesce(nullif(e.metadata->>'message', ''), 'Sem mensagem') as message
    from public.app_events e
    where e.event_type = 'client_error'
      and e.created_at < v_now - interval '24 hours'
      and e.created_at >= v_now - interval '30 days'
  ),
  series as (
    select i,
           (v_from at time zone tz)::date + i as day,
           (v_prev_from at time zone tz)::date + i as prev_day
    from generate_series(0, v_days - 1) i
  )
  select jsonb_build_object(
    'period', p_period,
    'range', jsonb_build_object('from', v_from, 'to', v_now, 'prev_from', v_prev_from, 'prev_to', v_prev_to),
    'kpis', jsonb_build_object(
      'revenue_cents', (select coalesce(sum(case kind when 'refund' then -amount_cents else amount_cents end), 0) from cur),
      'revenue_prev_cents', (select coalesce(sum(case kind when 'refund' then -amount_cents else amount_cents end), 0) from prev),
      'revenue_estimated', (select coalesce(bool_or(estimated), false) from cur),
      'mrr_cents', (select coalesce(sum(coalesce((metadata->>'amount_cents')::integer, 690)), 0) from recurring_live),
      'mrr_estimated', (select coalesce(bool_or((metadata->>'amount_cents') is null), false) from recurring_live),
      'pro_active', (select count(*) from pro_active),
      'pro_new', (select count(*) from cur where kind = 'payment'),
      'pro_lost', (
        select count(*) from public.app_events e
        where e.event_type in ('subscription_cancelled', 'payment_refunded', 'payment_disputed')
          and e.created_at >= v_from
      ),
      'signups', (select count(*) from public.profiles where role <> 'admin' and created_at >= v_from),
      'signups_prev', (
        select count(*) from public.profiles where role <> 'admin' and created_at >= v_prev_from and created_at < v_prev_to
      )
    ),
    'daily', (
      select jsonb_agg(jsonb_build_object(
        'day', s.day,
        'cur', case when s.day > v_today then null else (
          select coalesce(sum(case kind when 'refund' then -amount_cents else amount_cents end), 0)
          from cur where (cur.created_at at time zone tz)::date = s.day) end,
        'prev', case when p_period = 'mes'
                       and s.prev_day >= (date_trunc('month', v_today))::date then null else (
          select coalesce(sum(case kind when 'refund' then -amount_cents else amount_cents end), 0)
          from prev_full where (prev_full.created_at at time zone tz)::date = s.prev_day) end
      ) order by s.i)
      from series s
    ),
    'needs_you', jsonb_build_object(
      'expiring', coalesce((
        select jsonb_agg(jsonb_build_object('id', p.id, 'nome', p.nome, 'email', p.email, 'pro_until', p.pro_until)
                         order by p.pro_until)
        from public.profiles p
        where p.role <> 'admin'
          and p.pro_until > v_now and p.pro_until <= v_now + interval '7 days'
          and not exists (select 1 from recurring_live r where r.user_id = p.id)
      ), '[]'::jsonb),
      'declined', coalesce((
        select jsonb_agg(jsonb_build_object('id', p.id, 'nome', p.nome, 'email', p.email, 'since', p.updated_at)
                         order by p.updated_at desc)
        from public.profiles p
        where p.role <> 'admin' and p.subscription_status = 'past_due'
      ), '[]'::jsonb),
      'new_errors', coalesce((
        select jsonb_agg(jsonb_build_object('message', e.message, 'total', e.total, 'first_at', e.first_at)
                         order by e.total desc)
        from errors_24h e
        where not exists (select 1 from errors_seen_before b where b.message = e.message)
      ), '[]'::jsonb)
    ),
    'usage_week', jsonb_build_object(
      'tournaments', (select count(*) from public.tournaments where created_at >= v_now - interval '7 days'),
      'by_mode', coalesce((
        select jsonb_agg(jsonb_build_object('mode', mode, 'count', n) order by n desc)
        from (
          select mode, count(*) as n from public.tournaments
          where created_at >= v_now - interval '7 days' group by mode
        ) m
      ), '[]'::jsonb),
      'active_users', (
        select count(distinct user_id) from public.tournaments where created_at >= v_now - interval '7 days'
      ),
      'guest_limit_blocks', (
        select count(*) from public.app_events
        where event_type = 'guest_limit_reached' and created_at >= v_now - interval '7 days'
      ),
      'free_limit_blocks', (
        select count(*) from public.app_events
        where event_type = 'free_limit_reached' and created_at >= v_now - interval '7 days'
      )
    ),
    'revenue', jsonb_build_object(
      'month_cents', (
        select coalesce(sum(case kind when 'refund' then -amount_cents else amount_cents end), 0)
        from private.admin_money_events(v_month_from, v_now)
      ),
      'month_estimated', (select coalesce(bool_or(estimated), false) from private.admin_money_events(v_month_from, v_now)),
      'by_plan', coalesce((
        select jsonb_agg(jsonb_build_object(
          'plan_type', t.plan_type,
          'active', (
            case t.plan_type
              when 'recurring' then (select count(*) from recurring_live)
              else (
                select count(*) from pro_active pa
                where not exists (select 1 from recurring_live r where r.user_id = pa.id)
              )
            end
          ),
          'payments', (select count(*) from cur where kind = 'payment' and cur.plan_type = t.plan_type),
          'gross_cents', (select coalesce(sum(amount_cents), 0) from cur where kind = 'payment' and cur.plan_type = t.plan_type)
        ))
        from (values ('recurring'), ('one_time_30d')) t(plan_type)
      ), '[]'::jsonb),
      'new_count', (select count(*) from cur where kind = 'payment'),
      'cancelled_count', (
        select count(*) from public.app_events
        where event_type = 'subscription_cancelled' and created_at >= v_from
      ),
      'refunds_count', (select count(*) from cur where kind = 'refund'),
      'refunds_cents', (select coalesce(sum(amount_cents), 0) from cur where kind = 'refund'),
      'disputes_count', (
        select count(*) from public.app_events where event_type = 'payment_disputed' and created_at >= v_from
      ),
      'recent', coalesce((
        select jsonb_agg(x order by x.created_at desc)
        from (
          select c.kind, c.plan_type, c.amount_cents, c.estimated, c.created_at, p.nome, p.email
          from cur c left join public.profiles p on p.id = c.user_id
          order by c.created_at desc limit 20
        ) x
      ), '[]'::jsonb)
    ),
    'health', jsonb_build_object(
      'errors_24h_total', (select coalesce(sum(total), 0) from errors_24h),
      'errors_24h', coalesce((
        select jsonb_agg(jsonb_build_object('message', message, 'source', source, 'total', total, 'first_at', first_at, 'last_at', last_at)
                         order by total desc)
        from errors_24h
      ), '[]'::jsonb),
      'payment_failures', coalesce((
        select jsonb_agg(x order by x.created_at desc)
        from (
          select e.event_type, e.created_at, e.metadata, p.nome, p.email
          from public.app_events e left join public.profiles p on p.id = e.user_id
          where e.event_type in ('checkout_payment_failed', 'invoice_payment_failed')
            and e.created_at >= v_now - interval '7 days'
          order by e.created_at desc limit 20
        ) x
      ), '[]'::jsonb),
      'webhook_failures', coalesce((
        select jsonb_agg(jsonb_build_object('created_at', e.created_at, 'metadata', e.metadata) order by e.created_at desc)
        from public.app_events e
        where e.event_type = 'stripe_webhook_failed' and e.created_at >= v_now - interval '7 days'
      ), '[]'::jsonb),
      'webhook_last_processed', (
        select max(created_at) from public.app_events where event_type = 'stripe_event_processed'
      )
    )
  ) into v_result;

  return v_result;
end;
$$;

-- Lista de clientes com busca por nome ou e-mail.
create or replace function public.admin_customers(p_search text default null, p_limit integer default 50)
returns jsonb
language sql
stable
security definer
set search_path = public, private
as $$
  select coalesce(jsonb_agg(row_to_json(c) order by c.created_at desc), '[]'::jsonb)
  from (
    select p.id, p.nome, p.email, p.role, p.created_at, p.subscription_status, p.pro_until,
           case
             when p.role = 'admin' then 'admin'
             when p.plan = 'pro' and (p.pro_until is null or p.pro_until > now()) then coalesce(ls.plan_type, 'pro')
             else 'free'
           end as plan,
           t.total as tournaments_total,
           t.last_at as last_tournament_at
    from public.profiles p
    left join lateral (
      select s.plan_type from public.subscriptions s where s.user_id = p.id order by s.created_at desc limit 1
    ) ls on true
    left join lateral (
      select count(*) as total, max(x.created_at) as last_at from public.tournaments x where x.user_id = p.id
    ) t on true
    where coalesce(p_search, '') = ''
       or p.nome ilike '%' || p_search || '%'
       or p.email ilike '%' || p_search || '%'
    order by p.created_at desc
    limit least(greatest(coalesce(p_limit, 50), 1), 200)
  ) c;
$$;

-- Ficha do cliente: perfil, assinaturas e pagamentos.
create or replace function public.admin_customer(p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, private
as $$
  select jsonb_build_object(
    'profile', (
      select jsonb_build_object(
        'id', p.id, 'nome', p.nome, 'email', p.email, 'telefone', p.telefone, 'cidade', p.cidade,
        'estado', p.estado, 'provider', p.provider, 'role', p.role, 'plan', p.plan, 'pro_until', p.pro_until,
        'subscription_status', p.subscription_status, 'created_at', p.created_at
      ) from public.profiles p where p.id = p_user_id
    ),
    'subscriptions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'plan_type', s.plan_type, 'status', s.status, 'created_at', s.created_at,
        'current_period_end', s.current_period_end, 'cancel_at_period_end', s.metadata->'cancel_at_period_end'
      ) order by s.created_at desc)
      from public.subscriptions s where s.user_id = p_user_id
    ), '[]'::jsonb),
    'payments', coalesce((
      select jsonb_agg(jsonb_build_object('event_type', e.event_type, 'created_at', e.created_at, 'metadata', e.metadata)
                       order by e.created_at desc)
      from public.app_events e
      where e.user_id = p_user_id
        and e.event_type in ('payment_completed', 'payment_refunded', 'payment_disputed', 'subscription_cancelled',
                             'invoice_payment_failed', 'checkout_payment_failed')
    ), '[]'::jsonb),
    'tournaments', jsonb_build_object(
      'total', (select count(*) from public.tournaments where user_id = p_user_id),
      'last_at', (select max(created_at) from public.tournaments where user_id = p_user_id)
    )
  );
$$;

-- Só a service role executa. O Supabase dá EXECUTE a anon/authenticated por padrão em funções novas.
revoke all on function private.admin_list_price_cents(text) from public, anon, authenticated;
revoke all on function private.admin_money_events(timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function private.admin_latest_subscriptions() from public, anon, authenticated;
revoke all on function public.admin_dashboard(text) from public, anon, authenticated;
revoke all on function public.admin_customers(text, integer) from public, anon, authenticated;
revoke all on function public.admin_customer(uuid) from public, anon, authenticated;
grant execute on function public.admin_dashboard(text) to service_role;
grant execute on function public.admin_customers(text, integer) to service_role;
grant execute on function public.admin_customer(uuid) to service_role;
