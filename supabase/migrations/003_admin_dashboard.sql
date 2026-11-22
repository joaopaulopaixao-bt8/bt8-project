-- BT8 — Painel Admin 360 (etapas D1 e D2): funções agregadas.
-- Chamadas só pela Netlify Function admin-dashboard (service role), depois de ela validar role = 'admin'.
-- Depende da 002 (insert em app_events: eventos de dinheiro/webhook só pela service role, created_at = now()).
-- Mesmo assim, app_events não é confiável sozinho: evento de dinheiro só conta se estiver ligado a uma linha de
-- subscriptions (que só o backend grava) e todo número lido de metadata passa por private.admin_int().
-- Definições (detalhes em docs/ADMIN_METRICAS.md):
--   Pro ativo      = plan 'pro' com pro_until nulo ou futuro, sem contar admin.
--   MRR            = valor mensal das recorrentes com stripe_subscription_id e status active, past_due ou
--                    cancel_at_period_end (uma por usuário). trialing e checkout_started não entram.
--   Receita        = pagamentos confirmados ('payment_completed') no período menos reembolsos ('payment_refunded')
--                    no período. Valor = metadata.amount_cents; sem ele, preço de tabela e "estimado".
--   Pro vencendo   = pro_until nos próximos 7 dias e sem recorrente active/past_due/trialing.
-- Fuso: America/Sao_Paulo para "dia" e "mês".

create index if not exists app_events_type_created_idx on public.app_events(event_type, created_at desc);
create index if not exists profiles_created_idx on public.profiles(created_at desc);
create index if not exists tournaments_created_idx on public.tournaments(created_at desc);
create index if not exists subscriptions_checkout_session_idx on public.subscriptions((metadata->>'checkout_session_id'));
create index if not exists subscriptions_revoked_charge_idx on public.subscriptions((metadata->>'revoked_charge_id'));

-- Inteiro vindo de metadata: só aceita 1 a 9 dígitos; qualquer outra coisa vira null (nunca derruba a consulta).
create or replace function private.admin_int(p_value text)
returns integer
language sql
immutable
as $$
  select case when p_value ~ '^\d{1,9}$' then p_value::integer end;
$$;

-- Preço de tabela (centavos) usado quando o evento não traz o valor cobrado.
create or replace function private.admin_list_price_cents(p_plan_type text)
returns integer
language sql
immutable
as $$
  select case p_plan_type when 'recurring' then 690 when 'one_time_30d' then 1490 else 0 end;
$$;

-- Evento de dinheiro/webhook só vale se tiver os campos esperados e bater com o que o backend gravou.
-- Outros tipos passam direto (não entram em conta de dinheiro).
create or replace function private.admin_event_trusted(p_type text, p_user_id uuid, p_meta jsonb)
returns boolean
language sql
stable
security definer
set search_path = public, private
as $$
  select case p_type
    when 'payment_completed' then
      p_meta->>'plan_type' in ('recurring', 'one_time_30d') and exists (
        select 1 from public.subscriptions s
        where s.metadata->>'checkout_session_id' = p_meta->>'checkout_session_id' and s.user_id = p_user_id)
    when 'checkout_payment_failed' then exists (
        select 1 from public.subscriptions s
        where s.metadata->>'checkout_session_id' = p_meta->>'checkout_session_id' and s.user_id = p_user_id)
    when 'payment_refunded' then exists (
        select 1 from public.subscriptions s where s.metadata->>'revoked_charge_id' = p_meta->>'charge_id')
    when 'payment_disputed' then exists (
        select 1 from public.subscriptions s where s.metadata->>'revoked_charge_id' = p_meta->>'charge_id')
    when 'subscription_cancelled' then exists (
        select 1 from public.subscriptions s
        where s.stripe_subscription_id = p_meta->>'subscription_id' and s.user_id = p_user_id)
    when 'invoice_payment_failed' then coalesce(p_meta->>'invoice_id', '') ~ '^in_[A-Za-z0-9_]+$' and exists (
        select 1 from public.subscriptions s
        where s.user_id = p_user_id and s.plan_type = 'recurring' and s.stripe_subscription_id is not null)
    when 'stripe_webhook_failed' then p_user_id is null and coalesce(p_meta->>'type', '') ~ '^[a-z_.]{3,80}$'
    when 'stripe_event_processed' then p_user_id is null and coalesce(p_meta->>'event_id', '') ~ '^evt_[A-Za-z0-9_]+$'
    else true
  end;
$$;

-- Pagamentos e reembolsos confiáveis, com valor em centavos e flag de estimativa.
-- O plano vem da linha de subscriptions (gravada pelo backend), não do evento.
create or replace function private.admin_money_events(p_from timestamptz, p_to timestamptz)
returns table (kind text, user_id uuid, plan_type text, amount_cents integer, estimated boolean, created_at timestamptz)
language sql
stable
security definer
set search_path = public, private
as $$
  -- distinct on: o mesmo checkout ou a mesma cobrança gravados duas vezes contam uma vez só.
  select * from (
    select distinct on (e.metadata->>'checkout_session_id')
           'payment'::text as kind, e.user_id, s.plan_type,
           coalesce(private.admin_int(e.metadata->>'amount_cents'), private.admin_list_price_cents(s.plan_type)) as amount_cents,
           private.admin_int(e.metadata->>'amount_cents') is null as estimated,
           e.created_at
    from public.app_events e
    join lateral (
      select x.plan_type from public.subscriptions x
      where x.metadata->>'checkout_session_id' = e.metadata->>'checkout_session_id' and x.user_id = e.user_id
      order by x.created_at desc limit 1
    ) s on true
    where e.event_type = 'payment_completed' and e.created_at >= p_from and e.created_at < p_to
    order by e.metadata->>'checkout_session_id', e.created_at
  ) pay
  union all
  select * from (
    select distinct on (e.metadata->>'charge_id')
           'refund'::text, s.user_id, s.plan_type,
           coalesce(private.admin_int(e.metadata->>'amount_cents'), private.admin_list_price_cents(s.plan_type)),
           private.admin_int(e.metadata->>'amount_cents') is null,
           e.created_at
    from public.app_events e
    join lateral (
      select x.user_id, x.plan_type from public.subscriptions x
      where x.metadata->>'revoked_charge_id' = e.metadata->>'charge_id'
      order by x.updated_at desc limit 1
    ) s on true
    where e.event_type = 'payment_refunded' and e.created_at >= p_from and e.created_at < p_to
    order by e.metadata->>'charge_id', e.created_at
  ) ref;
$$;

-- Assinaturas recorrentes vivas (uma por usuário não admin): base do MRR e do "Pro vencendo".
create or replace function private.admin_recurring_live()
returns setof public.subscriptions
language sql
stable
security definer
set search_path = public, private
as $$
  select distinct on (s.user_id) s.*
  from public.subscriptions s
  join public.profiles p on p.id = s.user_id and p.role <> 'admin'
  where s.plan_type = 'recurring'
    and s.stripe_subscription_id is not null
    and s.status in ('active', 'past_due', 'cancel_at_period_end', 'trialing')
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
  recurring_live as (select * from private.admin_recurring_live()),
  recurring_paying as (select * from recurring_live where status <> 'trialing'),
  -- Eventos de dinheiro/webhook confiáveis desde o início do período anterior (nunca inclui client_error).
  trusted as (
    select e.* from public.app_events e
    where e.event_type in ('subscription_cancelled', 'payment_refunded', 'payment_disputed', 'checkout_payment_failed',
                           'invoice_payment_failed', 'stripe_webhook_failed', 'stripe_event_processed')
      and e.created_at >= least(v_prev_from, v_now - interval '7 days')
      and private.admin_event_trusted(e.event_type, e.user_id, e.metadata)
  ),
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
      'mrr_cents', (
        select coalesce(sum(coalesce(private.admin_int(metadata->>'amount_cents'), 690)), 0) from recurring_paying
      ),
      'mrr_estimated', (
        select coalesce(bool_or(private.admin_int(metadata->>'amount_cents') is null), false) from recurring_paying
      ),
      'mrr_cancelling', (select count(*) from recurring_paying where status = 'cancel_at_period_end'),
      'pro_active', (select count(*) from pro_active),
      'pro_new', (select count(distinct user_id) from cur where kind = 'payment'),
      'pro_lost', (
        select count(distinct coalesce(e.user_id, s.user_id))
        from trusted e
        left join public.subscriptions s on s.metadata->>'revoked_charge_id' = e.metadata->>'charge_id'
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
          and not exists (select 1 from recurring_live r where r.user_id = p.id and r.status <> 'cancel_at_period_end')
      ), '[]'::jsonb),
      'declined', coalesce((
        -- "desde" = última falha de cobrança registrada pelo webhook (não profiles.updated_at).
        select jsonb_agg(jsonb_build_object('id', p.id, 'nome', p.nome, 'email', p.email, 'since', f.failed_at)
                         order by f.failed_at desc nulls last)
        from public.profiles p
        left join lateral (
          select max(e.created_at) as failed_at from public.app_events e
          where e.user_id = p.id and e.event_type in ('invoice_payment_failed', 'checkout_payment_failed')
            and private.admin_event_trusted(e.event_type, e.user_id, e.metadata)
        ) f on true
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
      'guests_at_limit', (
        -- guest_usage só é escrita pela Function guest-usage (o cliente não infla).
        -- shortcut: limite de 1 torneio por visitante copiado de guest-usage.js; se o limite mudar, mudar aqui.
        select count(*) from public.guest_usage
        where tournaments_created >= 1 and last_seen_at >= v_now - interval '7 days'
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
              when 'recurring' then (select count(*) from recurring_paying)
              else (
                select count(*) from pro_active pa
                where not exists (select 1 from recurring_paying r where r.user_id = pa.id)
              )
            end
          ),
          'payments', (select count(*) from cur where kind = 'payment' and cur.plan_type = t.plan_type),
          'gross_cents', (select coalesce(sum(amount_cents), 0) from cur where kind = 'payment' and cur.plan_type = t.plan_type)
        ))
        from (values ('recurring'), ('one_time_30d')) t(plan_type)
      ), '[]'::jsonb),
      'new_count', (select count(distinct user_id) from cur where kind = 'payment'),
      'cancelled_count', (
        select count(distinct user_id) from trusted
        where event_type = 'subscription_cancelled' and created_at >= v_from
      ),
      'refunds_count', (select count(*) from cur where kind = 'refund'),
      'refunds_cents', (select coalesce(sum(amount_cents), 0) from cur where kind = 'refund'),
      'disputes_count', (
        select count(*) from trusted where event_type = 'payment_disputed' and created_at >= v_from
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
          from trusted e left join public.profiles p on p.id = e.user_id
          where e.event_type in ('checkout_payment_failed', 'invoice_payment_failed')
            and e.created_at >= v_now - interval '7 days'
          order by e.created_at desc limit 20
        ) x
      ), '[]'::jsonb),
      'webhook_failures', coalesce((
        select jsonb_agg(jsonb_build_object('created_at', e.created_at, 'metadata', e.metadata) order by e.created_at desc)
        from trusted e
        where e.event_type = 'stripe_webhook_failed' and e.created_at >= v_now - interval '7 days'
      ), '[]'::jsonb),
      'webhook_last_processed', (
        select max(e.created_at) from public.app_events e
        where e.event_type = 'stripe_event_processed' and e.created_at >= v_now - interval '30 days'
          and coalesce(e.metadata->>'status', 'done') <> 'processing' -- reserva do PR #9 ainda em andamento
          and private.admin_event_trusted(e.event_type, e.user_id, e.metadata)
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
    -- % e _ digitados na busca são literais.
    cross join lateral (
      select '%' || replace(replace(replace(coalesce(p_search, ''), '!', '!!'), '%', '!%'), '_', '!_') || '%' as pattern
    ) q
    where coalesce(p_search, '') = ''
       or p.nome ilike q.pattern escape '!'
       or p.email ilike q.pattern escape '!'
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
        and private.admin_event_trusted(e.event_type, e.user_id, e.metadata)
    ), '[]'::jsonb),
    'tournaments', jsonb_build_object(
      'total', (select count(*) from public.tournaments where user_id = p_user_id),
      'last_at', (select max(created_at) from public.tournaments where user_id = p_user_id)
    )
  );
$$;

-- Só a service role executa. O Supabase dá EXECUTE a anon/authenticated por padrão em funções novas.
revoke all on function private.admin_int(text) from public, anon, authenticated;
revoke all on function private.admin_list_price_cents(text) from public, anon, authenticated;
revoke all on function private.admin_event_trusted(text, uuid, jsonb) from public, anon, authenticated;
revoke all on function private.admin_money_events(timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function private.admin_recurring_live() from public, anon, authenticated;
revoke all on function public.admin_dashboard(text) from public, anon, authenticated;
revoke all on function public.admin_customers(text, integer) from public, anon, authenticated;
revoke all on function public.admin_customer(uuid) from public, anon, authenticated;
grant execute on function public.admin_dashboard(text) to service_role;
grant execute on function public.admin_customers(text, integer) to service_role;
grant execute on function public.admin_customer(uuid) to service_role;

insert into private.schema_migrations (version, name) values ('003', '003_admin_dashboard.sql')
on conflict (version) do nothing;
