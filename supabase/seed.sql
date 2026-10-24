-- Seed do Supabase LOCAL (rodado por `supabase db reset`). Nunca rodar em produção.
-- Usuários de teste (login por e-mail/senha em http://localhost:8888):
--   admin@bt8.test   / bt8-local-123   -> role admin, plan pro
--   usuario@bt8.test / bt8-local-123   -> usuário Free comum

do $$
declare
  u record;
begin
  for u in
    select * from (values
      ('00000000-0000-4000-8000-000000000001'::uuid, 'admin@bt8.test', 'Admin Local'),
      ('00000000-0000-4000-8000-000000000002'::uuid, 'usuario@bt8.test', 'Usuario Local')
    ) as t(id, email, nome)
  loop
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change, email_change_token_new
    ) values (
      '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated',
      u.email, crypt('bt8-local-123', gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('full_name', u.nome), now(), now(),
      '', '', '', ''
    );

    insert into auth.identities (
      id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at
    ) values (
      gen_random_uuid(), u.id, u.id::text, 'email',
      jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
      now(), now(), now()
    );
  end loop;
end $$;

-- O trigger on_auth_user_created já criou os perfis; promove o admin.
update public.profiles
set role = 'admin', plan = 'pro'
where email = 'admin@bt8.test';
