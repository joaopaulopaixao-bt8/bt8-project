-- Testes da migração 005. Rodar num banco com 001, 002, 004 e 005 aplicadas. ROLLBACK no fim.
--   docker exec -i supabase_db_bt8 psql -U postgres -d postgres -X -q -o /dev/null -v ON_ERROR_STOP=1 -f - < supabase/tests/005_arena_contas_test.sql
\set ON_ERROR_STOP 1
begin;

create schema teste;
grant usage on schema teste to anon, authenticated, service_role;
create function teste.ok(p_cond boolean, p_nome text) returns void language plpgsql as $$
begin
  if p_cond is not true then raise exception 'FALHOU: %', p_nome; end if;
  raise notice 'ok: %', p_nome;
end $$;
create function teste.espera_erro(p_sql text, p_esperado text, p_nome text) returns void language plpgsql as $$
declare h text; st text;
begin
  begin execute p_sql;
  exception when others then
    get stacked diagnostics h = pg_exception_hint, st = returned_sqlstate;
    if h = p_esperado or st = p_esperado then raise notice 'ok: %', p_nome; return; end if;
    raise exception 'FALHOU: % (esperado %, veio % % %)', p_nome, p_esperado, h, st, sqlerrm;
  end;
  raise exception 'FALHOU: % (passou)', p_nome;
end $$;
grant execute on all functions in schema teste to anon, authenticated, service_role;

-- Cadastro continua criando o perfil com o e-mail do Auth (handle_new_user).
insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
  ('00000000-0000-4000-c000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'gestor@arenanova.test', '{"provider":"email"}', '{"full_name":"Gestor"}', now(), now()),
  ('00000000-0000-4000-c000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'atacante@bt8.test', '{"provider":"google"}', '{"full_name":"Atacante"}', now(), now());
select teste.ok((select email = 'atacante@bt8.test' and provider = 'google' from public.profiles
                 where id = '00000000-0000-4000-c000-000000000002'), 'cadastro (Google) cria o perfil com o e-mail do Auth');

-- ── Ataque: o atacante troca o próprio profiles.email para o do gestor ──
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-c000-000000000002","role":"authenticated"}', true);
update public.profiles set email = 'gestor@arenanova.test', cidade = 'Recife' where id = auth.uid();
select teste.ok((select email = 'atacante@bt8.test' and cidade = 'Recife' from public.profiles where id = auth.uid()),
  'cliente não muda profiles.email (os outros campos salvam)');
-- Upsert do perfil como o front faz (manda o e-mail do Auth) continua funcionando.
insert into public.profiles (id, email, nome) values ('00000000-0000-4000-c000-000000000002', 'outro@x.test', 'Novo Nome')
on conflict (id) do update set email = excluded.email, nome = excluded.nome;
select teste.ok((select email = 'atacante@bt8.test' and nome = 'Novo Nome' from public.profiles where id = auth.uid()),
  'upsert do perfil salva o nome e mantém o e-mail do Auth');
select teste.espera_erro($q$select public.arena_conta_por_email('gestor@arenanova.test')$q$, '42501',
  'authenticated não chama arena_conta_por_email');
select teste.ok(private.email_da_conta('00000000-0000-4000-c000-000000000001') is null, 'email_da_conta não revela e-mail alheio');
reset role;

-- Mesmo que o perfil seja adulterado direto no banco, a busca usa auth.users.
update public.profiles set email = 'gestor@arenanova.test' where id = '00000000-0000-4000-c000-000000000002';
set local role service_role;
select teste.ok(public.arena_conta_por_email(' Gestor@ArenaNova.test ') = '00000000-0000-4000-c000-000000000001',
  'arena_conta_por_email acha a conta certa pelo auth.users (ignora o perfil trocado)');
select teste.ok(public.arena_conta_por_email('ninguem@x.test') is null, 'e-mail sem conta devolve null');

-- ── arena_criar: arena e dono juntos; slug repetido não deixa nada pela metade ──
select teste.ok((public.arena_criar('{"nome":"Arena Nova","slug":"arena-nova-005","ativo_ate":"2027-03-31"}',
                 '00000000-0000-4000-c000-000000000001', 'Gestor', 'gestor@arenanova.test') -> 'arena' ->> 'plano') = 'fundadora',
  'arena_criar cria a arena');
select teste.ok((select count(*) = 1 from public.arena_members m join public.arenas a on a.id = m.arena_id
                 where a.slug = 'arena-nova-005' and m.papel = 'dono' and m.user_id = '00000000-0000-4000-c000-000000000001'),
  'arena_criar grava o dono');
select teste.espera_erro($q$select public.arena_criar('{"nome":"X","slug":"arena-nova-005"}', '00000000-0000-4000-c000-000000000002', 'X', 'x@x.test')$q$,
  '23505', 'slug repetido dá 23505');
select teste.espera_erro($q$select public.arena_criar('{"nome":"X","slug":"outra-005"}', '00000000-0000-4000-c000-0000000000ff', 'X', 'x@x.test')$q$,
  'nao_encontrado', 'arena_criar recusa conta inexistente');
reset role;
set local role authenticated;
select teste.espera_erro($q$select public.arena_criar('{"nome":"X","slug":"outra-005"}', auth.uid(), 'X', 'x@x.test')$q$,
  '42501', 'authenticated não chama arena_criar');
reset role;

-- Troca de e-mail no Auth acompanha no perfil.
update auth.users set email = 'gestor2@arenanova.test' where id = '00000000-0000-4000-c000-000000000001';
select teste.ok((select email = 'gestor2@arenanova.test' from public.profiles where id = '00000000-0000-4000-c000-000000000001'),
  'troca de e-mail no Auth atualiza o perfil');

rollback;
