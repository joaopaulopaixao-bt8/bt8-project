-- Testes da migração 002. Rodar num banco com 001 + 002 aplicadas.
-- Tudo roda numa transação com ROLLBACK no fim: não deixa dados. Qualquer falha aborta (FALHOU: ...).
-- Staging local:
--   docker exec -i supabase_db_bt8 psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < supabase/tests/002_seguranca_limites_test.sql
\set ON_ERROR_STOP 1
begin;

-- ── Cadastro novo continua criando o perfil (auth -> private.handle_new_user) ──
insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-4000-a000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'teste1@bt8.test', '{"provider":"email"}', '{"full_name":"Teste Um"}', now(), now()),
  ('00000000-0000-4000-a000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'teste2@bt8.test', '{"provider":"email"}', '{"full_name":"Teste Dois"}', now(), now());

do $$
begin
  if not exists (select 1 from public.profiles where id = '00000000-0000-4000-a000-000000000001'
                 and nome = 'Teste Um' and plan = 'free' and role = 'user' and provider = 'email') then
    raise exception 'FALHOU: cadastro novo não criou o perfil';
  end if;
  raise notice 'ok: cadastro novo cria o perfil';
end $$;

-- Sem perfil, para o usuário 2 tentar criar o próprio como admin/pro.
delete from public.profiles where id = '00000000-0000-4000-a000-000000000002';

-- ── F0-01: usuário comum criando perfil como admin/pro é corrigido ──
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-000000000002","role":"authenticated"}', true),
       set_config('request.jwt.claim.sub', '00000000-0000-4000-a000-000000000002', true); -- auth.uid() antigo

insert into public.profiles (id, email, nome, role, plan, pro_until, stripe_customer_id, subscription_status)
values ('00000000-0000-4000-a000-000000000002', 'teste2@bt8.test', 'Teste Dois', 'admin', 'pro',
        now() + interval '1 year', 'cus_falso', 'active');

do $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'user' and plan = 'free'
                 and pro_until is null and stripe_customer_id is null and subscription_status is null) then
    raise exception 'FALHOU: insert do próprio perfil manteve admin/pro/cobrança';
  end if;
  raise notice 'ok: insert do perfil como admin/pro vira user/free';
end $$;

-- Upsert (como o app faz) e update direto não mudam plano/papel, mas mudam o resto.
insert into public.profiles (id, email, nome, plan, role)
values ('00000000-0000-4000-a000-000000000002', 'teste2@bt8.test', 'Nome Novo', 'pro', 'admin')
on conflict (id) do update set nome = excluded.nome, plan = excluded.plan, role = excluded.role;
update public.profiles set role = 'admin', plan = 'pro', pro_until = now() + interval '1 year', cidade = 'Recife'
where id = auth.uid();

do $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'user' and plan = 'free'
                 and pro_until is null and nome = 'Nome Novo' and cidade = 'Recife') then
    raise exception 'FALHOU: upsert/update do cliente mexeu em plano/papel ou não salvou o resto';
  end if;
  raise notice 'ok: upsert/update do cliente preserva plano/papel e salva os outros campos';
end $$;

-- ── F0-02: Free salva 3 por mês; o 4º falha com mensagem clara ──
do $$
begin
  begin
    insert into public.tournaments (user_id, mode) select auth.uid(), 's8' from generate_series(1, 4);
  exception when others then
    if sqlerrm like 'Limite do plano Free atingido%' then
      raise notice 'ok: 4 torneios num insert só recusados';
      return;
    end if;
    raise;
  end;
  raise exception 'FALHOU: insert de 4 linhas de uma vez furou o limite Free';
end $$;

-- created_at no passado é ignorado (senão burlaria a conta do mês).
insert into public.tournaments (user_id, mode, created_at, client_uid)
select auth.uid(), 's8', '2020-01-01', 'c' || g from generate_series(1, 3) g;

do $$
begin
  begin
    insert into public.tournaments (user_id, mode) values (auth.uid(), 's8');
  exception when others then
    if sqlerrm like 'Limite do plano Free atingido%' then
      raise notice 'ok: 4º torneio Free recusado: %', sqlerrm;
      return;
    end if;
    raise;
  end;
  raise exception 'FALHOU: 4º torneio do mês no Free foi aceito';
end $$;

-- Upsert por client_uid, no formato que o PostgREST gera para
-- upsert(..., { onConflict: 'user_id,client_uid' }): torneio existente atualiza mesmo no limite.
insert into public.tournaments (user_id, client_uid, mode, title)
values (auth.uid(), 'c1', 's8', 'Atualizado')
on conflict (user_id, client_uid) do update
set user_id = excluded.user_id, client_uid = excluded.client_uid, mode = excluded.mode, title = excluded.title
returning id;

do $$
begin
  if (select count(*) from public.tournaments where user_id = auth.uid()) <> 3
     or not exists (select 1 from public.tournaments where user_id = auth.uid() and client_uid = 'c1' and title = 'Atualizado') then
    raise exception 'FALHOU: upsert de torneio existente não atualizou ou duplicou';
  end if;
  raise notice 'ok: upsert de torneio existente atualiza no limite do Free, sem duplicar';

  begin
    insert into public.tournaments (user_id, client_uid, mode) values (auth.uid(), 'c9', 's8')
    on conflict (user_id, client_uid) do update set mode = excluded.mode;
  exception when others then
    if sqlerrm like 'Limite do plano Free atingido%' then
      raise notice 'ok: upsert de torneio novo no limite é recusado';
      return;
    end if;
    raise;
  end;
  raise exception 'FALHOU: upsert com client_uid novo furou o limite Free';
end $$;

do $$
begin
  update public.tournaments set created_at = '2020-01-01' where user_id = auth.uid();
  if exists (select 1 from public.tournaments where user_id = auth.uid() and created_at < now() - interval '1 day') then
    raise exception 'FALHOU: cliente conseguiu mudar created_at do torneio';
  end if;
  raise notice 'ok: cliente não muda created_at';
end $$;

-- Tamanho máximo de players.
do $$
begin
  begin
    update public.tournaments set players = jsonb_build_array(repeat('x', 200000)) where user_id = auth.uid();
  exception when check_violation then
    raise notice 'ok: players acima do limite recusado';
    return;
  end;
  raise exception 'FALHOU: players gigante aceito';
end $$;

-- ── app_events: cliente só grava eventos do front ──
insert into public.app_events (user_id, event_type, metadata, created_at)
values (auth.uid(), 'tournament_created', '{"format":"s8"}', '2999-01-01');

do $$
begin
  if exists (select 1 from public.app_events where user_id = auth.uid() and created_at > now()) then
    raise exception 'FALHOU: created_at do cliente no futuro foi mantido';
  end if;
  raise notice 'ok: created_at do evento do cliente vira now()';

  begin
    insert into public.app_events (user_id, event_type) values ('00000000-0000-4000-a000-000000000001', 'tournament_created');
    raise exception 'FALHOU: cliente gravou evento em nome de outro usuário';
  exception when insufficient_privilege then
    raise notice 'ok: cliente não grava evento com user_id de outro';
  end;
end $$;

do $$
declare
  tipo text;
begin
  foreach tipo in array array['evento_inventado', 'payment_completed'] loop
    begin
      insert into public.app_events (user_id, event_type) values (auth.uid(), tipo);
      raise exception 'FALHOU: cliente gravou evento %', tipo;
    exception when insufficient_privilege or check_violation then
      raise notice 'ok: cliente não grava %', tipo;
    end;
  end loop;
  begin
    insert into public.app_events (user_id, event_type, metadata)
    values (auth.uid(), 'client_error', jsonb_build_object('message', repeat('x', 5000)));
    raise exception 'FALHOU: cliente gravou metadata gigante';
  exception when insufficient_privilege or check_violation then
    raise notice 'ok: metadata gigante do cliente recusado';
  end;
end $$;

reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true),
       set_config('request.jwt.claim.sub', '', true);
insert into public.app_events (event_type, metadata) values ('client_error', '{"kind":"error","message":"teste"}');
do $$
declare
  tipo text;
begin
  foreach tipo in array array['lixo', 'payment_completed', 'stripe_event_processed'] loop
    begin
      insert into public.app_events (event_type, metadata) values (tipo, '{"event_id":"evt_anon"}');
      raise exception 'FALHOU: anon gravou %', tipo;
    exception when insufficient_privilege or check_violation then
      raise notice 'ok: anon não grava %', tipo;
    end;
  end loop;
end $$;
reset role;

-- ── Service role (Functions) continua ativando Pro e gravando eventos do backend ──
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

update public.profiles
set plan = 'pro', pro_until = now() + interval '30 days', stripe_customer_id = 'cus_teste', subscription_status = 'active'
where id = '00000000-0000-4000-a000-000000000002';

insert into public.app_events (user_id, event_type, metadata)
values ('00000000-0000-4000-a000-000000000002', 'payment_completed', '{"plan_type":"one_time_30d"}'),
       (null, 'stripe_event_processed', '{"event_id":"evt_teste_002"}');

do $$
begin
  if not exists (select 1 from public.profiles where id = '00000000-0000-4000-a000-000000000002'
                 and plan = 'pro' and stripe_customer_id = 'cus_teste') then
    raise exception 'FALHOU: service role não ativou o Pro';
  end if;
  raise notice 'ok: service role ativa o Pro';

  begin
    insert into public.app_events (event_type, metadata) values ('stripe_event_processed', '{"event_id":"evt_teste_002"}');
    raise exception 'FALHOU: reserva repetida do webhook aceita';
  exception when unique_violation then
    raise notice 'ok: reserva repetida do evento do Stripe dá unique_violation';
  end;

  begin
    insert into public.app_events (event_type) values ('lixo');
    raise exception 'FALHOU: service role gravou evento fora da lista';
  exception when check_violation then
    raise notice 'ok: CHECK de event_type vale também para o backend';
  end;
end $$;
reset role;

-- ── Agora Pro, o mesmo usuário salva o 4º torneio ──
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-000000000002","role":"authenticated"}', true),
       set_config('request.jwt.claim.sub', '00000000-0000-4000-a000-000000000002', true); -- auth.uid() antigo
insert into public.tournaments (user_id, mode) values (auth.uid(), 's8'), (auth.uid(), 'df');
do $$
begin
  if (select count(*) from public.tournaments where user_id = auth.uid()) <> 5 then
    raise exception 'FALHOU: Pro não salvou além do limite Free';
  end if;
  raise notice 'ok: Pro salva sem limite';
end $$;
reset role;

-- ── Controle de migrações ──
do $$
begin
  if (select count(*) from private.schema_migrations where version in ('001', '002')) <> 2 then
    raise exception 'FALHOU: private.schema_migrations sem 001/002';
  end if;
  raise notice 'ok: schema_migrations registra 001 e 002';
end $$;

\echo 'TODOS OS TESTES DA 002 PASSARAM'
rollback;
