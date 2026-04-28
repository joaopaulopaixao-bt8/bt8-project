-- BT8 paid MVP - staging schema baseline
-- Execute this in the Supabase STAGING project SQL Editor.

create extension if not exists pgcrypto;

create schema if not exists private;

-- Profiles are keyed by auth.users.id.
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  nome text,
  telefone text,
  data_nascimento date,
  sexo text check (sexo is null or sexo in ('M', 'F', 'O')),
  cidade text,
  estado text,
  avatar_url text,
  provider text,
  plan text not null default 'free' check (plan in ('free', 'pro')),
  role text not null default 'user' check (role in ('user', 'admin')),
  pro_until timestamptz,
  stripe_customer_id text,
  subscription_status text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tournaments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  mode text not null,
  category text,
  title text,
  players jsonb not null default '[]'::jsonb,
  standings jsonb not null default '[]'::jsonb,
  state jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  stripe_customer_id text,
  stripe_subscription_id text,
  stripe_payment_intent_id text,
  plan_type text not null check (plan_type in ('recurring', 'one_time_30d')),
  status text not null default 'pending',
  price_id text,
  current_period_end timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.guest_usage (
  id uuid primary key default gen_random_uuid(),
  guest_id text,
  ip_hash text,
  user_agent_hash text,
  month_key text not null,
  tournaments_created integer not null default 0,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create table if not exists public.app_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  guest_id text,
  event_type text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists profiles_plan_idx on public.profiles(plan);
create index if not exists profiles_role_idx on public.profiles(role);
create index if not exists tournaments_user_created_idx on public.tournaments(user_id, created_at desc);
create index if not exists subscriptions_user_status_idx on public.subscriptions(user_id, status);
create index if not exists guest_usage_month_idx on public.guest_usage(month_key);
create unique index if not exists guest_usage_identity_idx
on public.guest_usage (
  coalesce(guest_id, ''),
  coalesce(ip_hash, ''),
  coalesce(user_agent_hash, ''),
  month_key
);
create index if not exists app_events_created_idx on public.app_events(created_at desc);
create index if not exists app_events_type_idx on public.app_events(event_type);

alter table public.profiles enable row level security;
alter table public.tournaments enable row level security;
alter table public.subscriptions enable row level security;
alter table public.guest_usage enable row level security;
alter table public.app_events enable row level security;

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at
before update on public.profiles
for each row execute function public.touch_updated_at();

drop trigger if exists tournaments_touch_updated_at on public.tournaments;
create trigger tournaments_touch_updated_at
before update on public.tournaments
for each row execute function public.touch_updated_at();

drop trigger if exists subscriptions_touch_updated_at on public.subscriptions;
create trigger subscriptions_touch_updated_at
before update on public.subscriptions
for each row execute function public.touch_updated_at();

create or replace function public.protect_profile_billing_fields()
returns trigger
language plpgsql
as $$
begin
  if auth.uid() = new.id and (
    new.plan is distinct from old.plan
    or new.role is distinct from old.role
    or new.pro_until is distinct from old.pro_until
    or new.stripe_customer_id is distinct from old.stripe_customer_id
    or new.subscription_status is distinct from old.subscription_status
  ) then
    raise exception 'Billing and role fields cannot be changed by the client.';
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_protect_billing_fields on public.profiles;
create trigger profiles_protect_billing_fields
before update on public.profiles
for each row execute function public.protect_profile_billing_fields();

create or replace function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, private
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
  );
$$;

grant usage on schema private to authenticated;
grant execute on function private.is_admin() to authenticated;

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  insert into public.profiles (id, email, nome, provider)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    coalesce(new.raw_app_meta_data->>'provider', 'email')
  )
  on conflict (id) do update
    set email = excluded.email,
        nome = coalesce(public.profiles.nome, excluded.nome),
        provider = coalesce(public.profiles.provider, excluded.provider);

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function private.handle_new_user();

drop policy if exists profiles_select_self_or_admin on public.profiles;
create policy profiles_select_self_or_admin
on public.profiles for select
to authenticated
using (id = auth.uid() or private.is_admin());

drop policy if exists profiles_insert_self on public.profiles;
create policy profiles_insert_self
on public.profiles for insert
to authenticated
with check (id = auth.uid());

drop policy if exists profiles_update_self_limited on public.profiles;
create policy profiles_update_self_limited
on public.profiles for update
to authenticated
using (id = auth.uid())
with check (id = auth.uid());

drop policy if exists tournaments_select_self_or_admin on public.tournaments;
create policy tournaments_select_self_or_admin
on public.tournaments for select
to authenticated
using (user_id = auth.uid() or private.is_admin());

drop policy if exists tournaments_insert_self on public.tournaments;
create policy tournaments_insert_self
on public.tournaments for insert
to authenticated
with check (user_id = auth.uid());

drop policy if exists tournaments_update_self on public.tournaments;
create policy tournaments_update_self
on public.tournaments for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists tournaments_delete_self on public.tournaments;
create policy tournaments_delete_self
on public.tournaments for delete
to authenticated
using (user_id = auth.uid());

drop policy if exists subscriptions_select_self_or_admin on public.subscriptions;
create policy subscriptions_select_self_or_admin
on public.subscriptions for select
to authenticated
using (user_id = auth.uid() or private.is_admin());

drop policy if exists app_events_insert_anyone on public.app_events;
create policy app_events_insert_anyone
on public.app_events for insert
to anon, authenticated
with check (user_id is null or user_id = auth.uid());

drop policy if exists app_events_select_admin on public.app_events;
create policy app_events_select_admin
on public.app_events for select
to authenticated
using (private.is_admin());

-- guest_usage is intentionally backend-only. No anon/auth policies.

insert into public.profiles (id, email, nome, role, plan)
select id, email, coalesce(raw_user_meta_data->>'full_name', split_part(email, '@', 1)), 'admin', 'pro'
from auth.users
where email = 'joaopaulopaixao@gmail.com'
on conflict (id) do update
  set role = 'admin',
      plan = 'pro',
      email = excluded.email,
      nome = coalesce(public.profiles.nome, excluded.nome);
