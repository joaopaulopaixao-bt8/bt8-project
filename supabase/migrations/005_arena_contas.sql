-- BT8 - 005: contas da Arena sem confiar em profiles.email (revisão do PR #19).
-- Idempotente. Aplicar numa transação só:
--   psql -v ON_ERROR_STOP=1 --single-transaction -f 005_arena_contas.sql
-- Teste: supabase/tests/005_arena_contas_test.sql.
--
-- Problema: profiles.email era editável pelo próprio usuário e não é único. As Functions achavam a
-- conta do gestor/scout por ele: quem trocasse o próprio e-mail para o do gestor viraria dono da arena.
-- 1) profiles.email passa a acompanhar auth.users (o cliente não muda mais);
-- 2) a busca de conta por e-mail é feita em auth.users, numa função só da service role;
-- 3) arena + membro dono são criados juntos numa RPC só da service role (admin-arena atômica).

create schema if not exists private;

-- ══ 1) profiles.email = auth.users.email ════════════════════════════

-- E-mail da própria conta (só devolve algo para o próprio usuário).
create or replace function private.email_da_conta(p_id uuid)
returns text
language sql
stable
security definer
set search_path = public, private, pg_temp
as $$ select u.email::text from auth.users u where u.id = p_id and p_id = auth.uid(); $$;
revoke all on function private.email_da_conta(uuid) from public, anon;
grant execute on function private.email_da_conta(uuid) to authenticated;

-- Invoker de propósito: para anon/authenticated o e-mail vem de auth.users; o postgres
-- (handle_new_user, migrações) e a service role passam direto.
create or replace function private.profile_email_guard()
returns trigger
language plpgsql
set search_path = public, private, pg_temp
as $$
begin
  if current_user not in ('anon', 'authenticated') then return new; end if;
  new.email := coalesce(private.email_da_conta(new.id), case when tg_op = 'UPDATE' then old.email end);
  return new;
end;
$$;
drop trigger if exists profiles_email_guard on public.profiles;
create trigger profiles_email_guard before insert or update on public.profiles
for each row execute function private.profile_email_guard();

-- Troca de e-mail confirmada no Auth atualiza o perfil.
create or replace function private.sync_profile_email()
returns trigger
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
begin
  update public.profiles set email = new.email where id = new.id and email is distinct from new.email;
  return new;
end;
$$;
revoke all on function private.sync_profile_email() from public, anon, authenticated;
drop trigger if exists on_auth_user_email_changed on auth.users;
create trigger on_auth_user_email_changed after update of email on auth.users
for each row when (old.email is distinct from new.email) execute function private.sync_profile_email();

-- Corrige perfis já alterados (roda como postgres: o guard não se aplica).
update public.profiles p set email = u.email
from auth.users u where u.id = p.id and p.email is distinct from u.email;

-- ══ 2) Conta por e-mail, só pela service role ═══════════════════════
create or replace function public.arena_conta_por_email(p_email text)
returns uuid
language sql
stable
security definer
set search_path = public, private, pg_temp
as $$ select u.id from auth.users u where lower(u.email) = lower(trim(p_email)) order by u.created_at limit 1; $$;
revoke all on function public.arena_conta_por_email(text) from public, anon, authenticated;
grant execute on function public.arena_conta_por_email(text) to service_role;

-- ══ 3) Arena + dono numa transação (admin-arena) ════════════════════
-- p_arena: {nome, slug, cidade, estado, whatsapp, plano, ativo_ate}. Slug repetido: erro 23505.
create or replace function public.arena_criar(p_arena jsonb, p_owner uuid, p_nome text, p_email text)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare a public.arenas;
begin
  if p_owner is null or not exists (select 1 from auth.users where id = p_owner) then
    raise exception 'Conta do gestor não encontrada.' using errcode = 'P0001', hint = 'nao_encontrado';
  end if;
  insert into public.arenas (nome, slug, cidade, estado, whatsapp, plano, ativo_ate, owner_id)
  values (p_arena ->> 'nome', p_arena ->> 'slug', p_arena ->> 'cidade', p_arena ->> 'estado', p_arena ->> 'whatsapp',
          coalesce(p_arena ->> 'plano', 'fundadora'), (p_arena ->> 'ativo_ate')::date, p_owner)
  returning * into a;
  insert into public.arena_members (arena_id, user_id, email, nome, papel)
  values (a.id, p_owner, p_email, p_nome, 'dono');
  return jsonb_build_object('ok', true, 'arena', to_jsonb(a) - 'owner_id');
end;
$$;
revoke all on function public.arena_criar(jsonb, uuid, text, text) from public, anon, authenticated;
grant execute on function public.arena_criar(jsonb, uuid, text, text) to service_role;

-- ══ Registro ════════════════════════════════════════════════════════
insert into private.schema_migrations (version, name) values ('005', '005_arena_contas.sql')
on conflict (version) do nothing;
