-- Testes da migração 006. Rodar num banco com 001 a 006 aplicadas. ROLLBACK no fim.
--   docker exec -i supabase_db_bt8 psql -U postgres -d postgres -X -q -o /dev/null -v ON_ERROR_STOP=1 -f - < supabase/tests/006_arena_inscricao_test.sql
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
create table teste.vars (k text primary key, v text);
grant all on teste.vars to anon, authenticated, service_role;

insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
  ('00000000-0000-4000-d000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'dono006@arena.test', '{"provider":"email"}', '{}', now(), now());
insert into public.arenas (id, nome, slug, owner_id, whatsapp) values
  ('aaaaaaaa-0000-4000-8000-000000000006', 'Arena 006', 'arena-006', '00000000-0000-4000-d000-000000000001', '+5581999990006');
insert into public.arena_members (arena_id, user_id, email, nome, papel) values
  ('aaaaaaaa-0000-4000-8000-000000000006', '00000000-0000-4000-d000-000000000001', 'dono006@arena.test', 'Dono', 'dono');
insert into public.championships (id, arena_id, titulo, slug, status, inscricao_token, regras) values
  ('eeeeeeee-0000-4000-8000-000000000006', 'aaaaaaaa-0000-4000-8000-000000000006', 'Open 006', 'open-006', 'inscricoes',
   'token-insc-006-00000001', '{"pix": {"chave": "pix@arena006.test", "favorecido": "Arena 006", "valor": 100}}');
insert into public.categories (id, championship_id, nome, max_duplas) values
  ('ca000000-0000-4000-8000-000000000006', 'eeeeeeee-0000-4000-8000-000000000006', 'Mista', 8);

-- ── arena_inscrever: e-mail opcional, validado, e token na resposta ──
set local role service_role;
insert into teste.vars select 'r1', public.arena_inscrever('token-insc-006-00000001', 'ip-006', $j${"category_id": "ca000000-0000-4000-8000-000000000006",
  "consentimento_versao": "2026-11-22b", "atleta1": {"nome": "Ana Seis", "telefone": "+5581966660001", "email": "Ana@Seis.test"},
  "atleta2": {"nome": "Bia Seis", "telefone": "+5581966660002"}}$j$)::text;
select teste.ok((select (v::jsonb ->> 'status') = 'pendente' and (v::jsonb ->> 'token') ~ '^[0-9a-f-]{36}$' from teste.vars where k = 'r1'),
  'inscrição com Pix fica pendente e devolve o token');
select teste.ok((select email = 'ana@seis.test' from public.athletes where telefone = '+5581966660001'), 'e-mail gravado em minúsculas');
select teste.ok((select email is null from public.athletes where telefone = '+5581966660002'), 'sem e-mail continua aceito');
select teste.ok(public.arena_inscrever('token-insc-006-00000001', 'ip-006', $j${"category_id": "ca000000-0000-4000-8000-000000000006",
  "consentimento_versao": "2026-11-22b", "atleta1": {"nome": "Cris Seis", "telefone": "+5581966660003", "email": "cris@"},
  "atleta2": {"nome": "Duda Seis", "telefone": "+5581966660004"}}$j$) ->> 'erro' = 'dados_invalidos', 'e-mail inválido é recusado');
reset role;

-- ── arena_inscricao_status: público, sem dados sensíveis ──
set local role anon;
select teste.ok((select (public.arena_inscricao_status(v::jsonb ->> 'token') ->> 'ok')::boolean from teste.vars where k = 'r1'),
  'anon lê a situação pelo token');
select teste.ok((select x::text !~ '\+5581966' and x::text !~ '@seis' and x::text !~ (v::jsonb ->> 'token')
                 and x -> 'pix' ->> 'chave' = 'pix@arena006.test' and x -> 'comprovante' ->> 'status' = 'nenhum'
                 from teste.vars, lateral (select public.arena_inscricao_status(v::jsonb ->> 'token') x) s where k = 'r1'),
  'status traz Pix e comprovante, sem telefone, e-mail nem token');
select teste.ok(public.arena_inscricao_status('nao-e-uuid') ->> 'erro' = 'nao_encontrado'
                and public.arena_inscricao_status(gen_random_uuid()::text) ->> 'erro' = 'nao_encontrado', 'token inválido');
select teste.ok(public.arena_public('open-006')::text !~ (select v::jsonb ->> 'token' from teste.vars where k = 'r1'),
  'arena_public não expõe o token de acompanhamento');
select teste.espera_erro($q$select public.arena_comprovante_reservar(gen_random_uuid()::text)$q$, '42501', 'anon não reserva comprovante');
select teste.espera_erro($q$select public.arena_inscricao_contexto(gen_random_uuid())$q$, '42501', 'anon não lê o contexto');
reset role;

-- ── Reserva de comprovante: até 5 por dupla ──
set local role service_role;
select teste.ok((select (public.arena_comprovante_reservar(v::jsonb ->> 'token', 2) ->> 'ok')::boolean from teste.vars where k = 'r1'), 'reserva 1');
select teste.ok((select (public.arena_comprovante_reservar(v::jsonb ->> 'token', 2) ->> 'ok')::boolean from teste.vars where k = 'r1'), 'reserva 2');
select teste.ok((select public.arena_comprovante_reservar(v::jsonb ->> 'token', 2) ->> 'erro' = 'limite' from teste.vars where k = 'r1'), 'limite de envios');
select teste.ok((select (public.arena_inscricao_contexto((v::jsonb ->> 'team_id')::uuid) -> 'gestores') ? 'dono006@arena.test'
                 from teste.vars where k = 'r1'), 'contexto traz o e-mail do dono');
reset role;

-- ── O gestor (authenticated) não muda token nem comprovante ──
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-d000-000000000001","role":"authenticated"}', true);
update public.teams set acompanhamento_token = gen_random_uuid(), comprovante_status = 'aceito', comprovante_path = 'outra/arena.pdf',
  observacao = 'ok' where id = (select (v::jsonb ->> 'team_id')::uuid from teste.vars where k = 'r1');
reset role;
select teste.ok((select acompanhamento_token::text = (select v::jsonb ->> 'token' from teste.vars where k = 'r1')
                 and comprovante_status = 'nenhum' and comprovante_path is null and observacao = 'ok'
                 from public.teams where id = (select (v::jsonb ->> 'team_id')::uuid from teste.vars where k = 'r1')),
  'cliente não altera token nem comprovante (o resto salva)');

-- ── Token fora do select de teams; dono/gestor pega e troca pela RPC ──
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-d000-000000000001","role":"authenticated"}', true);
select teste.espera_erro('select acompanhamento_token from public.teams', '42501', 'select de teams não lê o token');
select teste.ok((select count(*) > 0 from public.teams), 'o resto de teams continua legível');
select teste.ok((select public.arena_team_link((v::jsonb ->> 'team_id')::uuid) ->> 'token' = v::jsonb ->> 'token' from teste.vars where k = 'r1'),
  'arena_team_link devolve o token ao dono');
select teste.ok((select public.arena_team_link((v::jsonb ->> 'team_id')::uuid, true) ->> 'token' <> v::jsonb ->> 'token' from teste.vars where k = 'r1'),
  'arena_team_link com p_novo troca o token');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-d000-0000000000ff","role":"authenticated"}', true);
select teste.espera_erro($q$select public.arena_team_link((select (v::jsonb ->> 'team_id')::uuid from teste.vars where k = 'r1'))$q$,
  'sem_permissao', 'quem não é da arena não pega o link');
reset role;

-- ── Inscrição pública não sobrescreve e-mail já cadastrado ──
update public.teams set status = 'cancelada' where id = (select (v::jsonb ->> 'team_id')::uuid from teste.vars where k = 'r1');
set local role service_role;
select teste.ok(public.arena_inscrever('token-insc-006-00000001', 'ip-006b', $j${"category_id": "ca000000-0000-4000-8000-000000000006",
  "consentimento_versao": "2026-11-22b", "atleta1": {"nome": "Ana Seis", "telefone": "+5581966660001", "email": "atacante@mal.test"},
  "atleta2": {"nome": "Bia Seis", "telefone": "+5581966660002", "email": "bia@seis.test"}}$j$) ->> 'ok' = 'true', 'reinscrição aceita');
reset role;
select teste.ok((select email = 'ana@seis.test' from public.athletes where telefone = '+5581966660001'), 'e-mail existente não é trocado');
select teste.ok((select email = 'bia@seis.test' from public.athletes where telefone = '+5581966660002'), 'e-mail vazio é preenchido');

-- ── Lista de espera: sem Pix e sem comprovante ──
insert into public.categories (id, championship_id, nome, max_duplas) values
  ('ca000000-0000-4000-8000-000000000007', 'eeeeeeee-0000-4000-8000-000000000006', 'Lotada', 1);
set local role service_role;
select public.arena_inscrever('token-insc-006-00000001', 'ip-006c', $j${"category_id": "ca000000-0000-4000-8000-000000000007",
  "consentimento_versao": "2026-11-22b", "atleta1": {"nome": "Eva Sete", "telefone": "+5581966670001"},
  "atleta2": {"nome": "Fê Sete", "telefone": "+5581966670002"}}$j$);
insert into teste.vars select 'r2', public.arena_inscrever('token-insc-006-00000001', 'ip-006c', $j${"category_id": "ca000000-0000-4000-8000-000000000007",
  "consentimento_versao": "2026-11-22b", "atleta1": {"nome": "Gabi Sete", "telefone": "+5581966670003"},
  "atleta2": {"nome": "Helô Sete", "telefone": "+5581966670004"}}$j$)::text;
select teste.ok((select v::jsonb ->> 'status' = 'espera' from teste.vars where k = 'r2'), 'categoria lotada vai para espera');
select teste.ok((select public.arena_inscricao_status(v::jsonb ->> 'token') -> 'pix' = 'null'::jsonb from teste.vars where k = 'r2'),
  'espera não mostra Pix');
select teste.ok((select public.arena_comprovante_reservar(v::jsonb ->> 'token') ->> 'erro' = 'status_invalido' from teste.vars where k = 'r2'),
  'espera não envia comprovante');
reset role;

-- ── Sorteio refeito libera novo e-mail de tabela ──
update public.teams set tabela_email_em = now() where id = (select (v::jsonb ->> 'team_id')::uuid from teste.vars where k = 'r2');
insert into public.category_groups (id, category_id, nome) values ('c9000000-0000-4000-8000-000000000007', 'ca000000-0000-4000-8000-000000000007', 'A');
insert into public.group_teams (group_id, team_id) select 'c9000000-0000-4000-8000-000000000007', (v::jsonb ->> 'team_id')::uuid from teste.vars where k = 'r2';
select teste.ok((select tabela_email_em is null from public.teams where id = (select (v::jsonb ->> 'team_id')::uuid from teste.vars where k = 'r2')),
  'entrar num grupo limpa a marca de e-mail de tabela');

-- ── Limite por campeonato: 60 tentativas por hora, de qualquer IP ──
set local role service_role;
do $$ begin
  for i in 1..60 loop
    perform public.arena_inscrever('token-insc-006-00000001', 'ip-loop-' || i, '{"category_id": "ca000000-0000-4000-8000-0000000000ff"}');
  end loop;
end $$;
select teste.ok(public.arena_inscrever('token-insc-006-00000001', 'ip-novo', '{}') ->> 'erro' = 'limite', 'limite por campeonato');
reset role;

rollback;
