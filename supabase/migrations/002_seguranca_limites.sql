-- BT8 - 002: segurança e limites no banco (F0-01, F0-02, F1-04, F1-24)
-- Idempotente: pode ser reaplicada. Aplicar numa transação só:
--   psql -v ON_ERROR_STOP=1 --single-transaction -f 002_seguranca_limites.sql
-- "Cliente" aqui = quem chega pelo PostgREST com a chave pública ou o JWT do usuário
-- (roles anon/authenticated). Service role (Functions), triggers security definer
-- (private.handle_new_user) e o postgres das migrações não passam pelas travas.

create schema if not exists private;

-- ══ F1-24: controle de migrações ═══════════════════════════════════
create table if not exists private.schema_migrations (
  version text primary key,
  name text not null,
  applied_at timestamptz not null default now()
);
revoke all on private.schema_migrations from public, anon, authenticated;

-- ══ F0-01: cliente não cria nem altera plano, papel ou cobrança ═════
-- Antes era só BEFORE UPDATE e checava auth.uid(): um insert do próprio perfil com
-- role='admin'/plan='pro' passava. Agora vale para INSERT e UPDATE e, em vez de erro,
-- corrige os campos (o upsert do perfil no app continua funcionando).
create or replace function public.protect_profile_billing_fields()
returns trigger
language plpgsql
as $$
begin
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.plan := 'free';
    new.role := 'user';
    new.pro_until := null;
    new.stripe_customer_id := null;
    new.subscription_status := null;
  else
    new.plan := old.plan;
    new.role := old.role;
    new.pro_until := old.pro_until;
    new.stripe_customer_id := old.stripe_customer_id;
    new.subscription_status := old.subscription_status;
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_protect_billing_fields on public.profiles;
create trigger profiles_protect_billing_fields
before insert or update on public.profiles
for each row execute function public.protect_profile_billing_fields();

-- ══ F0-02: limite do plano Free também no banco ═════════════════════
-- Id gerado no front para salvar sem duplicar: upsert(..., { onConflict: 'user_id,client_uid' }).
-- Índice completo (não parcial): o PostgREST gera ON CONFLICT (user_id, client_uid) sem WHERE,
-- que não casa com índice parcial. NULLs não colidem, então os registros antigos ficam livres.
alter table public.tournaments add column if not exists client_uid text;
create unique index if not exists tournaments_user_client_uid_uidx
on public.tournaments (user_id, client_uid);

-- Mesma regra do front (src/js/access.js, FREE_MONTHLY_TOURNAMENT_LIMIT): Free salva até
-- 3 torneios por mês; Pro (plan='pro' e pro_until vazio ou no futuro) e Admin sem limite.
-- O mês é o de Brasília.
create or replace function private.can_save_tournament()
returns boolean
language sql
volatile -- volatile enxerga as linhas já inseridas pelo mesmo comando (insert de várias linhas)
security definer
set search_path = public, private
as $$
  select exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and (p.role = 'admin' or (p.plan = 'pro' and (p.pro_until is null or p.pro_until > now())))
    )
    or (
      select count(*)
      from public.tournaments t
      where t.user_id = auth.uid()
        and t.created_at >= date_trunc('month', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo'
    ) < 3;
$$;

revoke all on function private.can_save_tournament() from public;
grant execute on function private.can_save_tournament() to authenticated;

create or replace function private.enforce_tournament_limits()
returns trigger
language plpgsql
set search_path = public, private
as $$
begin
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    -- Mudar a data tiraria o torneio da conta do mês.
    new.created_at := old.created_at;
    return new;
  end if;

  new.created_at := now();
  -- Upsert por client_uid de um torneio que já existe vira UPDATE (ON CONFLICT): não é torneio novo.
  if new.client_uid is not null and exists (
    select 1 from public.tournaments t where t.user_id = new.user_id and t.client_uid = new.client_uid
  ) then
    return new;
  end if;
  -- Serializa os inserts do mesmo usuário: dois salvamentos simultâneos não furam o limite.
  perform pg_advisory_xact_lock(hashtextextended('bt8_tournament_limit:' || new.user_id::text, 0));
  if not private.can_save_tournament() then
    raise exception 'Limite do plano Free atingido: até 3 torneios salvos por mês. Ative o BT8 Pro para salvar sem limite.'
      using errcode = 'P0001', hint = 'free_limit_reached';
  end if;

  return new;
end;
$$;

drop trigger if exists tournaments_enforce_limits on public.tournaments;
create trigger tournaments_enforce_limits
before insert or update on public.tournaments
for each row execute function private.enforce_tournament_limits();

-- Tamanho máximo (folga grande: um torneio real fica em dezenas de KB).
-- NOT VALID: vale para linhas novas/alteradas sem travar a aplicação por linha antiga.
alter table public.tournaments drop constraint if exists tournaments_tamanho_maximo_chk;
alter table public.tournaments add constraint tournaments_tamanho_maximo_chk check (
  octet_length(players::text) <= 102400
  and octet_length(standings::text) <= 262144
  and octet_length(state::text) <= 1048576
) not valid;

-- ══ F1-04: app_events sem lixo ══════════════════════════════════════
-- Lista completa (front + Functions). Evento novo no código = incluir aqui numa migração nova,
-- senão o insert falha. NOT VALID para não depender de eventos antigos já gravados.
alter table public.app_events drop constraint if exists app_events_event_type_chk;
alter table public.app_events add constraint app_events_event_type_chk check (event_type in (
  -- front (trackEvent em src/js/*.js) e captura de erros
  'checkout_cancelled', 'checkout_returned_success', 'checkout_started', 'client_error',
  'free_limit_reached', 'free_tournament_saved', 'guest_limit_reached', 'guest_tournament_created',
  'guest_try_started', 'login_completed', 'pending_checkout_continued', 'pro_expired',
  'pro_tournament_saved', 'ranking_image_downloaded', 'ranking_shared', 'signup_completed',
  'signup_started', 'tournament_created', 'tournament_finished', 'upgrade_clicked',
  -- só backend (Netlify Functions com service role)
  'account_deleted', 'admin_checkout_ignored', 'admin_subscription_ignored',
  'charge_partially_refunded', 'checkout_payment_failed', 'checkout_payment_pending',
  'invoice_payment_failed', 'payment_completed', 'payment_disputed', 'payment_refunded',
  'stripe_event_processed', 'stripe_webhook_failed', 'subscription_cancel_at_period_end',
  'subscription_cancel_mode_mismatch', 'subscription_cancelled', 'subscription_updated'
)) not valid;

alter table public.app_events drop constraint if exists app_events_metadata_tamanho_chk;
alter table public.app_events add constraint app_events_metadata_tamanho_chk
check (octet_length(metadata::text) <= 16384) not valid;

-- Cliente só grava os eventos do front, com metadata pequeno: não consegue forjar
-- payment_completed e afins, que alimentam o painel de receita.
drop policy if exists app_events_insert_anyone on public.app_events;
create policy app_events_insert_anyone
on public.app_events for insert
to anon, authenticated
with check (
  (user_id is null or user_id = auth.uid())
  and event_type in (
    'checkout_cancelled', 'checkout_returned_success', 'checkout_started', 'client_error',
    'free_limit_reached', 'free_tournament_saved', 'guest_limit_reached', 'guest_tournament_created',
    'guest_try_started', 'login_completed', 'pending_checkout_continued', 'pro_expired',
    'pro_tournament_saved', 'ranking_image_downloaded', 'ranking_shared', 'signup_completed',
    'signup_started', 'tournament_created', 'tournament_finished', 'upgrade_clicked'
  )
  and octet_length(metadata::text) <= 4096
);

-- Data e dono do evento do cliente vêm do banco, não do front.
create or replace function private.enforce_app_event_client()
returns trigger
language plpgsql
set search_path = public, private
as $$
begin
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;
  new.created_at := now();
  if new.user_id is not null and new.user_id is distinct from auth.uid() then
    raise exception 'Evento com user_id de outro usuário.' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists app_events_enforce_client on public.app_events;
create trigger app_events_enforce_client
before insert on public.app_events
for each row execute function private.enforce_app_event_client();

-- Idempotência do webhook do Stripe (PR #9): a segunda reserva do mesmo evento dá 23505.
-- Se falhar por duplicata antiga, ver a consulta em docs/SUPABASE_VPS.md.
create unique index if not exists app_events_stripe_event_uidx
on public.app_events ((metadata->>'event_id'))
where event_type = 'stripe_event_processed';

-- ══ Registro ════════════════════════════════════════════════════════
insert into private.schema_migrations (version, name) values
  ('001', '001_paid_mvp_staging.sql'),
  ('002', '002_seguranca_limites.sql')
on conflict (version) do nothing;
