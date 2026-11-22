-- Testes da migração 004 (Módulo Arena). Rodar num banco com 001, 002 e 004 aplicadas.
-- Tudo numa transação com ROLLBACK no fim: não deixa dados. Qualquer falha aborta (FALHOU: ...).
-- Staging local:
--   docker exec -i supabase_db_bt8 psql -U postgres -d postgres -X -q -o /dev/null -v ON_ERROR_STOP=1 -f - < supabase/tests/004_arena_test.sql
-- (as linhas "ok: ..." saem no stderr como NOTICE)
\set ON_ERROR_STOP 1
begin;

-- ── Auxiliar: espera erro com o hint (ou SQLSTATE) informado ──
create schema teste;
grant usage on schema teste to anon, authenticated, service_role;
create function teste.espera_erro(p_sql text, p_esperado text, p_nome text) returns void language plpgsql as $$
declare h text; st text;
begin
  begin
    execute p_sql;
  exception when others then
    get stacked diagnostics h = pg_exception_hint, st = returned_sqlstate;
    if h = p_esperado or st = p_esperado then raise notice 'ok: %', p_nome; return; end if;
    raise exception 'FALHOU: % (esperado %, veio hint=% sqlstate=% %)', p_nome, p_esperado, h, st, sqlerrm;
  end;
  raise exception 'FALHOU: % (esperado erro %, passou)', p_nome, p_esperado;
end $$;
create function teste.ok(p_cond boolean, p_nome text) returns void language plpgsql as $$
begin
  if p_cond is not true then raise exception 'FALHOU: %', p_nome; end if;
  raise notice 'ok: %', p_nome;
end $$;
grant execute on all functions in schema teste to anon, authenticated, service_role;

-- ── Usuários: dono A, gestor A, árbitro A, scout A, scout B, dono B ──
insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select ('00000000-0000-4000-b000-00000000000' || n)::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated',
       'authenticated', 'arena' || n || '@bt8.test', '{"provider":"email"}', '{}', now(), now()
from generate_series(1, 6) n;

insert into public.arenas (id, nome, slug, owner_id) values
  ('aaaaaaaa-0000-4000-8000-00000000000a', 'Arena A', 'arena-a', '00000000-0000-4000-b000-000000000001'),
  ('aaaaaaaa-0000-4000-8000-00000000000b', 'Arena B', 'arena-b', '00000000-0000-4000-b000-000000000006');
insert into public.arena_members (arena_id, user_id, nome, papel) values
  ('aaaaaaaa-0000-4000-8000-00000000000a', '00000000-0000-4000-b000-000000000001', 'Dono A', 'dono'),
  ('aaaaaaaa-0000-4000-8000-00000000000a', '00000000-0000-4000-b000-000000000002', 'Gestor A', 'gestor'),
  ('aaaaaaaa-0000-4000-8000-00000000000a', '00000000-0000-4000-b000-000000000003', 'Árbitro A', 'arbitro'),
  ('aaaaaaaa-0000-4000-8000-00000000000a', '00000000-0000-4000-b000-000000000004', 'Scout A', 'scout'),
  ('aaaaaaaa-0000-4000-8000-00000000000b', '00000000-0000-4000-b000-000000000005', 'Scout B', 'scout'),
  ('aaaaaaaa-0000-4000-8000-00000000000b', '00000000-0000-4000-b000-000000000006', 'Dono B', 'dono');

insert into public.courts (id, arena_id, nome, ordem) values
  ('cccccccc-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-00000000000a', 'Quadra 1', 1),
  ('cccccccc-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-00000000000a', 'Quadra 2', 2),
  ('cccccccc-0000-4000-8000-0000000000b1', 'aaaaaaaa-0000-4000-8000-00000000000b', 'Quadra B', 1);

insert into public.championships (id, arena_id, titulo, slug, status, inscricao_token, regras) values
  ('eeeeeeee-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-00000000000a', 'Open A', 'open-a',
   'em_andamento', 'token-open-a-0000000001', '{"tolerancia_wo_min": 10}'),
  ('eeeeeeee-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-00000000000a', 'Inscrições A', 'insc-a',
   'inscricoes', 'token-insc-a-0000000002', '{}'),
  ('eeeeeeee-0000-4000-8000-0000000000b1', 'aaaaaaaa-0000-4000-8000-00000000000b', 'Open B', 'open-b',
   'em_andamento', 'token-open-b-00000000b1', '{}');
insert into public.categories (id, championship_id, nome, max_duplas) values
  ('ca000000-0000-4000-8000-000000000001', 'eeeeeeee-0000-4000-8000-000000000001', 'Masculino B', 16),
  ('ca000000-0000-4000-8000-000000000002', 'eeeeeeee-0000-4000-8000-000000000002', 'Mista', 1),
  ('ca000000-0000-4000-8000-0000000000b1', 'eeeeeeee-0000-4000-8000-0000000000b1', 'Livre B', 16);

insert into public.athletes (id, arena_id, nome, telefone)
select ('a7000000-0000-4000-8000-00000000000' || n)::uuid, 'aaaaaaaa-0000-4000-8000-00000000000a',
       'Atleta ' || n, '+558199990000' || n
from generate_series(1, 9) n;
insert into public.athletes (id, arena_id, nome, telefone) values
  ('a7000000-0000-4000-8000-0000000000b1', 'aaaaaaaa-0000-4000-8000-00000000000b', 'Atleta B1', '+5581988880001'),
  ('a7000000-0000-4000-8000-0000000000b2', 'aaaaaaaa-0000-4000-8000-00000000000b', 'Atleta B2', '+5581988880002');

insert into public.teams (id, category_id, athlete1_id, athlete2_id) values
  ('7e000000-0000-4000-8000-000000000001', 'ca000000-0000-4000-8000-000000000001', 'a7000000-0000-4000-8000-000000000001', 'a7000000-0000-4000-8000-000000000002'),
  ('7e000000-0000-4000-8000-000000000002', 'ca000000-0000-4000-8000-000000000001', 'a7000000-0000-4000-8000-000000000003', 'a7000000-0000-4000-8000-000000000004'),
  ('7e000000-0000-4000-8000-000000000003', 'ca000000-0000-4000-8000-000000000001', 'a7000000-0000-4000-8000-000000000005', 'a7000000-0000-4000-8000-000000000006'),
  ('7e000000-0000-4000-8000-000000000004', 'ca000000-0000-4000-8000-000000000001', 'a7000000-0000-4000-8000-000000000007', 'a7000000-0000-4000-8000-000000000008'),
  ('7e000000-0000-4000-8000-0000000000b1', 'ca000000-0000-4000-8000-0000000000b1', 'a7000000-0000-4000-8000-0000000000b1', 'a7000000-0000-4000-8000-0000000000b2');

select teste.espera_erro($q$insert into public.teams (category_id, athlete1_id, athlete2_id) values
  ('ca000000-0000-4000-8000-000000000001', 'a7000000-0000-4000-8000-000000000001', 'a7000000-0000-4000-8000-000000000009')$q$,
  'atleta_ja_inscrito', 'atleta não entra em duas duplas da mesma categoria');

-- Partida da arena B (inserida direto pelo postgres) para o teste de arena alheia.
insert into public.category_groups (id, category_id, nome) values
  ('9b000000-0000-4000-8000-0000000000b1', 'ca000000-0000-4000-8000-0000000000b1', 'A');
insert into public.matches (id, championship_id, category_id, fase, group_id, team_a, team_b, status) values
  ('3b000000-0000-4000-8000-0000000000b1', 'eeeeeeee-0000-4000-8000-0000000000b1', 'ca000000-0000-4000-8000-0000000000b1',
   'grupo', '9b000000-0000-4000-8000-0000000000b1', '7e000000-0000-4000-8000-0000000000b1', null, 'chamada');

-- ── Papéis (claims do PostgREST) ──
\set como_gestor 'reset role; select set_config(''request.jwt.claims'', ''{"sub":"00000000-0000-4000-b000-000000000002","role":"authenticated"}'', true); set local role authenticated;'
\set como_arbitro 'reset role; select set_config(''request.jwt.claims'', ''{"sub":"00000000-0000-4000-b000-000000000003","role":"authenticated"}'', true); set local role authenticated;'
\set como_scout 'reset role; select set_config(''request.jwt.claims'', ''{"sub":"00000000-0000-4000-b000-000000000004","role":"authenticated"}'', true); set local role authenticated;'
\set como_anon 'reset role; select set_config(''request.jwt.claims'', ''{"role":"anon"}'', true); set local role anon;'
\set como_service 'reset role; select set_config(''request.jwt.claims'', ''{"role":"service_role"}'', true); set local role service_role;'

-- ── Sorteio publicado pelo gestor: grupo de 4 + semifinais e final ──
:como_gestor
select public.category_publish_draw('ca000000-0000-4000-8000-000000000001', $j${
  "semente": "teste-1",
  "grupos": [{"nome": "A", "ordem": 1, "duplas": ["7e000000-0000-4000-8000-000000000001", "7e000000-0000-4000-8000-000000000002",
                                                   "7e000000-0000-4000-8000-000000000003", "7e000000-0000-4000-8000-000000000004"]}],
  "partidas": [
    {"ref": "A1", "fase": "grupo", "grupo": "A", "rodada": 1, "slot": 1, "team_a": "7e000000-0000-4000-8000-000000000001", "team_b": "7e000000-0000-4000-8000-000000000004", "prioridade": 1},
    {"ref": "A2", "fase": "grupo", "grupo": "A", "rodada": 1, "slot": 2, "team_a": "7e000000-0000-4000-8000-000000000002", "team_b": "7e000000-0000-4000-8000-000000000003", "prioridade": 2},
    {"ref": "A3", "fase": "grupo", "grupo": "A", "rodada": 2, "slot": 1, "team_a": "7e000000-0000-4000-8000-000000000001", "team_b": "7e000000-0000-4000-8000-000000000003", "prioridade": 3},
    {"ref": "A4", "fase": "grupo", "grupo": "A", "rodada": 2, "slot": 2, "team_a": "7e000000-0000-4000-8000-000000000004", "team_b": "7e000000-0000-4000-8000-000000000002", "prioridade": 4},
    {"ref": "A5", "fase": "grupo", "grupo": "A", "rodada": 3, "slot": 1, "team_a": "7e000000-0000-4000-8000-000000000001", "team_b": "7e000000-0000-4000-8000-000000000002", "prioridade": 5},
    {"ref": "A6", "fase": "grupo", "grupo": "A", "rodada": 3, "slot": 2, "team_a": "7e000000-0000-4000-8000-000000000003", "team_b": "7e000000-0000-4000-8000-000000000004", "prioridade": 6},
    {"ref": "SF1", "fase": "sf", "slot": 1, "origem_a": {"grupo": "A", "pos": 1}, "origem_b": {"melhor2": 1}, "next_ref": "F", "next_slot": "a", "prioridade": 100},
    {"ref": "SF2", "fase": "sf", "slot": 2, "origem_a": {"melhor1": 2}, "origem_b": {"grupo": "A", "pos": 3}, "next_ref": "F", "next_slot": "b", "prioridade": 101},
    {"ref": "F", "fase": "final", "slot": 1, "origem_a": {"match": "SF1"}, "origem_b": {"match_ref": "SF2"}, "prioridade": 200}
  ]}$j$::jsonb);
select teste.ok((select count(*) = 9 from public.matches where category_id = 'ca000000-0000-4000-8000-000000000001'),
  'sorteio publicado grava 9 partidas');
select teste.ok((select (origem_a ->> 'match')::uuid = (select id from public.matches where slot = 1 and fase = 'sf'
                   and category_id = 'ca000000-0000-4000-8000-000000000001')
                 from public.matches where fase = 'final' and category_id = 'ca000000-0000-4000-8000-000000000001'),
  'origem {match: ref} vira uuid');
select id as m_a1 from public.matches where category_id = 'ca000000-0000-4000-8000-000000000001' and fase = 'grupo' and rodada = 1 and slot = 1 \gset
select id as m_a6 from public.matches where category_id = 'ca000000-0000-4000-8000-000000000001' and fase = 'grupo' and rodada = 3 and slot = 2 \gset
select id as m_sf1 from public.matches where category_id = 'ca000000-0000-4000-8000-000000000001' and fase = 'sf' and slot = 1 \gset
select id as m_sf2 from public.matches where category_id = 'ca000000-0000-4000-8000-000000000001' and fase = 'sf' and slot = 2 \gset
select id as m_f from public.matches where category_id = 'ca000000-0000-4000-8000-000000000001' and fase = 'final' \gset
select id as g_a from public.category_groups where category_id = 'ca000000-0000-4000-8000-000000000001' \gset

-- Troca de atleta antes do primeiro jogo: permitida.
select public.team_swap_athlete('7e000000-0000-4000-8000-000000000004', 2, 'a7000000-0000-4000-8000-000000000009');
select teste.ok((select athlete2_id = 'a7000000-0000-4000-8000-000000000009' from public.teams
                 where id = '7e000000-0000-4000-8000-000000000004'), 'troca de atleta antes do primeiro jogo');

-- Ninguém faz UPDATE direto em matches; gestor não mexe em live_version.
select teste.espera_erro(format('update public.matches set games_a = 5 where id = %L', :'m_a1'), '42501',
  'UPDATE direto em matches é recusado');
select live_version as lv0 from public.championships where id = 'eeeeeeee-0000-4000-8000-000000000001' \gset
update public.championships set titulo = 'Open A 2026', live_version = 999 where id = 'eeeeeeee-0000-4000-8000-000000000001';
select teste.ok((select live_version = :lv0 and titulo = 'Open A 2026' from public.championships
                 where id = 'eeeeeeee-0000-4000-8000-000000000001'), 'gestor edita o campeonato sem mexer na versão');

-- Gestor não vira dono (sem escrita em arena_members) nem pela Function (service role, trigger).
select teste.espera_erro($q$update public.arena_members set papel = 'dono' where user_id = '00000000-0000-4000-b000-000000000002'$q$,
  '42501', 'gestor não se promove a dono pelo cliente');
:como_service
select teste.espera_erro($q$update public.arena_members set papel = 'dono' where user_id = '00000000-0000-4000-b000-000000000002'$q$,
  'sem_permissao', 'service role não promove gestor a dono');
select teste.espera_erro($q$update public.arena_members set papel = 'gestor' where user_id = '00000000-0000-4000-b000-000000000001'$q$,
  'sem_permissao', 'dono não é rebaixado');

-- ── Mesa chama, scout assume e marca ──
:como_arbitro
select public.match_call(:'m_a1', 'cccccccc-0000-4000-8000-000000000001');
:como_scout
select (public.match_take(:'m_a1', 'dddddddd-0000-4000-8000-000000000001') -> 'match' ->> 'version')::int as v \gset
select (public.match_score_push(:'m_a1', :v, 'e0000000-0000-4000-8000-000000000001', 'dddddddd-0000-4000-8000-000000000001', 1, 0) -> 'match' ->> 'version')::int as v1 \gset
select teste.ok(:v1 = :v + 1, 'push grava e aumenta a versão');
select teste.ok((public.match_score_push(:'m_a1', :v, 'e0000000-0000-4000-8000-000000000001', 'dddddddd-0000-4000-8000-000000000001', 1, 0) ->> 'duplicado')::boolean,
  'client_event_id repetido devolve duplicado');
select teste.ok((select count(*) = 1 from public.match_events where client_event_id = 'e0000000-0000-4000-8000-000000000001'),
  'client_event_id repetido não duplica o evento');
select teste.ok(public.match_score_push(:'m_a1', :v, 'e0000000-0000-4000-8000-000000000002', 'dddddddd-0000-4000-8000-000000000001', 2, 0) ->> 'erro' = 'conflito',
  'versão velha dá conflito');
select teste.ok(public.match_score_push(:'m_a1', :v1, 'e0000000-0000-4000-8000-000000000003', 'dddddddd-0000-4000-8000-000000000002', 2, 0) ->> 'erro' = 'outro_aparelho',
  'outro device_id é recusado');
select (public.match_score_push(:'m_a1', :v1, 'e0000000-0000-4000-8000-000000000004', 'dddddddd-0000-4000-8000-000000000001', 6, 5) -> 'match' ->> 'version')::int as v2 \gset
select teste.espera_erro(format('select public.match_finish(%L, %s, %L, %L)', :'m_a1', :v2, 'a', 'dddddddd-0000-4000-8000-000000000001'),
  'placar_invalido', 'match_finish recusa 6x5');
select (public.match_score_push(:'m_a1', :v2, 'e0000000-0000-4000-8000-000000000005', 'dddddddd-0000-4000-8000-000000000001', 6, 2) -> 'match' ->> 'version')::int as v3 \gset
select teste.ok((public.match_finish(:'m_a1', :v3, 'a', 'dddddddd-0000-4000-8000-000000000001') -> 'match' ->> 'status') = 'encerrada',
  'match_finish encerra');
select teste.ok(public.match_score_push(:'m_a1', :v3 + 1, 'e0000000-0000-4000-8000-000000000006', 'dddddddd-0000-4000-8000-000000000001', 6, 3) ->> 'erro' = 'partida_encerrada',
  'push em partida encerrada é recusado');
select teste.espera_erro($q$select public.match_take('3b000000-0000-4000-8000-0000000000b1', 'dddddddd-0000-4000-8000-000000000001')$q$,
  'sem_permissao', 'scout da arena A não escreve na B');
select teste.espera_erro(format('select public.match_set_result(%L, 6, 0, null, null, false, %L)', :'m_a6', 'x'),
  'sem_permissao', 'scout não lança placar pela Mesa');

-- ── Troca depois do primeiro jogo, resto do grupo pela Mesa, WO, fechar grupo ──
:como_gestor
select teste.espera_erro($q$select public.team_swap_athlete('7e000000-0000-4000-8000-000000000001', 1, 'a7000000-0000-4000-8000-000000000009')$q$,
  'dupla_ja_jogou', 'team_swap_athlete recusado depois do primeiro jogo');
:como_arbitro
select public.match_set_result(id, 6, 3, null, null, false, 'súmula') from public.matches
where group_id = :'g_a' and status = 'agendada' and id <> :'m_a6';
select teste.espera_erro(format('select public.match_wo(%L, %L, %L)', :'m_a6', 'b', ''), 'motivo_obrigatorio', 'WO exige motivo');
select teste.ok((public.match_wo(:'m_a6', 'b', 'não compareceu') -> 'match' ->> 'games_a') = '6', 'WO grava 6x0');
select teste.espera_erro(format('select public.group_close(%L)', :'g_a'), 'sem_permissao', 'árbitro não fecha grupo');
:como_gestor
select public.group_close(:'g_a');
:como_arbitro
select teste.espera_erro(format('select public.match_set_result(%L, 6, 4, null, null, false, %L)', :'m_a1', 'protesto'),
  'grupo_fechado', 'correção depois de group_close é recusada');

-- ── Mata-mata: semear, match_finish propaga, "forçar" marca alerta_origem ──
:como_gestor
select public.category_seed_knockout('ca000000-0000-4000-8000-000000000001', format(
  '[{"match":"%1$s","slot":"a","team":"7e000000-0000-4000-8000-000000000001"},{"match":"%1$s","slot":"b","team":"7e000000-0000-4000-8000-000000000004"},
    {"match":"%2$s","slot":"a","team":"7e000000-0000-4000-8000-000000000002"},{"match":"%2$s","slot":"b","team":"7e000000-0000-4000-8000-000000000003"}]',
  :'m_sf1', :'m_sf2')::jsonb);
:como_arbitro
select public.match_call(:'m_sf1', 'cccccccc-0000-4000-8000-000000000001');
:como_scout
select (public.match_take(:'m_sf1', 'dddddddd-0000-4000-8000-000000000001') -> 'match' ->> 'version')::int as s1 \gset
select (public.match_score_push(:'m_sf1', :s1, gen_random_uuid(), 'dddddddd-0000-4000-8000-000000000001', 7, 6, 7, 4) -> 'match' ->> 'version')::int as s2 \gset
select public.match_finish(:'m_sf1', :s2, 'a', 'dddddddd-0000-4000-8000-000000000001');
select teste.ok((select team_a = '7e000000-0000-4000-8000-000000000001' from public.matches where id = :'m_f'),
  'match_finish propaga o vencedor para a final');
:como_arbitro
select public.match_set_result(:'m_sf2', 6, 4, null, null, false, 'súmula');
select public.match_call(:'m_f', 'cccccccc-0000-4000-8000-000000000002');
select public.match_start(:'m_f');
select teste.espera_erro(format('select public.match_set_result(%L, 6, 7, 3, 7, false, %L)', :'m_sf1', 'erro de súmula'),
  'proxima_iniciada', 'correção com a seguinte iniciada exige forçar');
select teste.espera_erro(format('select public.match_set_result(%L, 6, 7, 3, 7, false, %L, true)', :'m_sf1', 'erro de súmula'),
  'sem_permissao', 'árbitro não força');
:como_gestor
select public.match_set_result(:'m_sf1', 6, 7, 3, 7, false, 'erro de súmula', true);
select teste.ok((select alerta_origem and team_a = '7e000000-0000-4000-8000-000000000004' from public.matches where id = :'m_f'),
  '"forçar" troca o slot e marca alerta_origem');
select teste.ok((select count(*) = 1 from public.match_events where match_id = :'m_sf1' and tipo = 'forcar'),
  'forçar fica em match_events');

-- ── Público: anon não lê tabelas; RPCs públicas sem telefone ──
:como_anon
select teste.espera_erro('select count(*) from public.athletes', '42501', 'anon não lê athletes');
select teste.espera_erro('select count(*) from public.matches', '42501', 'anon não lê matches');
select teste.espera_erro($q$select public.match_take('3b000000-0000-4000-8000-0000000000b1', gen_random_uuid())$q$,
  '42501', 'anon não chama RPC de partida');
select teste.ok((public.arena_live('open-a') ->> 'ok')::boolean, 'arena_live responde');
select teste.ok((select count(*) = 1 from jsonb_array_elements(public.arena_live('open-a') -> 'partidas')),
  'arena_live traz só a partida em jogo');
select teste.ok(public.arena_live('open-a')::text !~ '\+55' and public.arena_public('open-a')::text !~ '\+55',
  'arena_live e arena_public não devolvem telefone');
select teste.ok(public.arena_public('open-a')::text !~ 'token-open-a' and public.arena_public('open-a')::text !~ '@bt8',
  'arena_public não devolve token nem e-mail');
select teste.ok((public.arena_public('open-a', (public.arena_live('open-a') -> 'championship' ->> 'estrutura_version')::bigint) ->> 'changed')::boolean = false,
  'arena_public sem mudança devolve changed=false');
select teste.ok((public.arena_inscricao_info('token-insc-a-0000000002') -> 'championship' ->> 'aberto')::boolean
                and public.arena_inscricao_info('token-insc-a-0000000002')::text !~ '\+55', 'arena_inscricao_info sem telefone');
select teste.espera_erro($q$select public.arena_inscrever('token-insc-a-0000000002', 'ip', '{}')$q$, '42501',
  'anon não chama arena_inscrever');

-- ── Inscrição pela Function (service role): vaga, espera, atleta repetido e limite por IP ──
:como_service
select teste.ok(public.arena_inscrever('token-insc-a-0000000002', 'ip-1', $j${"category_id": "ca000000-0000-4000-8000-000000000002",
  "consentimento_versao": "2026-11-22", "atleta1": {"nome": "Nova Um", "telefone": "+5581977770001"},
  "atleta2": {"nome": "Nova Dois", "telefone": "+5581977770002"}}$j$, 3) ->> 'status' = 'confirmada', 'inscrição confirmada');
select teste.ok(public.arena_inscrever('token-insc-a-0000000002', 'ip-1', $j${"category_id": "ca000000-0000-4000-8000-000000000002",
  "consentimento_versao": "2026-11-22", "atleta1": {"nome": "Nova Três", "telefone": "+5581977770003"},
  "atleta2": {"nome": "Nova Quatro", "telefone": "+5581977770004"}}$j$, 3) ->> 'status' = 'espera', 'categoria lotada vai para espera');
select teste.ok(public.arena_inscrever('token-insc-a-0000000002', 'ip-1', $j${"category_id": "ca000000-0000-4000-8000-000000000002",
  "consentimento_versao": "2026-11-22", "atleta1": {"nome": "Nova Um", "telefone": "+5581977770001"},
  "atleta2": {"nome": "Nova Cinco", "telefone": "+5581977770005"}}$j$, 3) ->> 'erro' = 'atleta_ja_inscrito', 'atleta repetido na categoria é recusado');
select teste.ok(public.arena_inscrever('token-insc-a-0000000002', 'ip-1', $j${"category_id": "ca000000-0000-4000-8000-000000000002",
  "consentimento_versao": "2026-11-22", "atleta1": {"nome": "Nova Seis", "telefone": "+5581977770006"},
  "atleta2": {"nome": "Nova Sete", "telefone": "+5581977770007"}}$j$, 3) ->> 'erro' = 'limite', 'limite por IP conta também as recusas');
reset role;
select teste.ok((select consentimento_versao = '2026-11-22' from public.athletes where telefone = '+5581977770001'),
  'consentimento versionado gravado');

-- Apagar a arena (como a arena TESTE depois do demo) leva tudo em cascata.
delete from public.arenas where id = 'aaaaaaaa-0000-4000-8000-00000000000a';
set constraints all immediate;
select teste.ok(not exists (select 1 from public.matches where championship_id = 'eeeeeeee-0000-4000-8000-000000000001')
                and not exists (select 1 from public.athletes where arena_id = 'aaaaaaaa-0000-4000-8000-00000000000a'),
  'apagar a arena apaga campeonatos, partidas e atletas');

rollback;
