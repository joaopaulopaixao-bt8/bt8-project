-- BT8 - 004: Módulo Arena (campeonatos de arena com Mesa, scout, telão e página pública)
-- Contrato (assinaturas e payloads): docs/ARENA.md. Plano: docs/ARENA_PLANO.md, seção 6.
-- Idempotente: pode ser reaplicada. Não depende da 003 e não toca profiles, tournaments,
-- app_events nem os planos. Aplicar numa transação só:
--   psql -v ON_ERROR_STOP=1 --single-transaction -f 004_arena.sql
-- Teste: supabase/tests/004_arena_test.sql.
--
-- Segurança:
-- - anon não tem nenhuma política nem privilégio nas tabelas; o público só lê pelas RPCs
--   arena_live, arena_public e arena_inscricao_info, que nunca devolvem telefone ou e-mail.
-- - matches, category_groups, group_teams e match_events não têm escrita direta: tudo por RPC.
-- - arenas e arena_members só são escritas pelas Functions (service role).
-- - "Cliente" = roles anon/authenticated. As RPCs security definer rodam como o dono (postgres)
--   e passam pelas travas dos triggers, como na 002.

create schema if not exists private;

create table if not exists private.schema_migrations (
  version text primary key,
  name text not null,
  applied_at timestamptz not null default now()
);

-- ══ Tabelas ═════════════════════════════════════════════════════════

create table if not exists public.arenas (
  id uuid primary key default gen_random_uuid(),
  nome text not null check (char_length(nome) between 1 and 120),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,59}$'),
  cidade text check (char_length(cidade) <= 80),
  estado text check (char_length(estado) <= 2),
  owner_id uuid references auth.users(id) on delete set null,
  status text not null default 'ativa' check (status in ('ativa', 'suspensa')),
  plano text not null default 'fundadora' check (char_length(plano) <= 40),
  ativo_ate date,
  whatsapp text check (char_length(whatsapp) <= 20),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.arena_members (
  id uuid primary key default gen_random_uuid(),
  arena_id uuid not null references public.arenas(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  email text check (char_length(email) <= 254),
  nome text not null check (char_length(nome) between 1 and 120),
  papel text not null check (papel in ('dono', 'gestor', 'arbitro', 'scout')),
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (arena_id, user_id)
);

create table if not exists public.courts (
  id uuid primary key default gen_random_uuid(),
  arena_id uuid not null references public.arenas(id) on delete cascade,
  nome text not null check (char_length(nome) between 1 and 60),
  ordem int not null default 0,
  ativa boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.championships (
  id uuid primary key default gen_random_uuid(),
  arena_id uuid not null references public.arenas(id) on delete cascade,
  titulo text not null check (char_length(titulo) between 1 and 120),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,79}$'),
  data_inicio date,
  data_fim date,
  status text not null default 'rascunho' check (status in ('rascunho', 'inscricoes', 'em_andamento', 'encerrado')),
  inscricao_token text not null unique default replace(gen_random_uuid()::text, '-', '')
    check (char_length(inscricao_token) between 16 and 64),
  inscricoes_ate timestamptz,
  regras jsonb not null default '{}'::jsonb check (octet_length(regras::text) <= 32768),
  pausado boolean not null default false,
  pausa_motivo text check (char_length(pausa_motivo) <= 120),
  pausado_em timestamptz,
  live_version bigint not null default 0,
  estrutura_version bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  championship_id uuid not null references public.championships(id) on delete cascade,
  nome text not null check (char_length(nome) between 1 and 60),
  genero text check (char_length(genero) <= 20),
  max_duplas int not null default 16 check (max_duplas between 1 and 128),
  formato jsonb not null default '{}'::jsonb check (octet_length(formato::text) <= 4096),
  inscricoes_abertas boolean not null default true,
  sorteio_semente text check (char_length(sorteio_semente) <= 80),
  ordem int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.athletes (
  id uuid primary key default gen_random_uuid(),
  arena_id uuid not null references public.arenas(id) on delete cascade,
  nome text not null check (char_length(nome) between 1 and 80),
  telefone text check (telefone ~ '^\+[1-9][0-9]{7,14}$'),
  email text check (char_length(email) <= 254),
  user_id uuid references auth.users(id) on delete set null,
  consentimento_em timestamptz,
  consentimento_versao text check (char_length(consentimento_versao) <= 20),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists athletes_arena_telefone_uidx
on public.athletes (arena_id, telefone) where telefone is not null;
create index if not exists athletes_arena_idx on public.athletes (arena_id);

-- FKs sem cascata são "deferrable initially deferred": apagar a arena/categoria em cascata só é
-- conferido no commit (senão o atleta é apagado antes da dupla que aponta para ele).
create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.categories(id) on delete cascade,
  athlete1_id uuid not null references public.athletes(id) deferrable initially deferred,
  athlete2_id uuid not null references public.athletes(id) deferrable initially deferred,
  status text not null default 'confirmada' check (status in ('pendente', 'confirmada', 'espera', 'cancelada')),
  pagamento text not null default 'nao_se_aplica' check (pagamento in ('nao_se_aplica', 'pendente', 'pago')),
  pago_em timestamptz,
  seed int check (seed between 1 and 64),
  origem text not null default 'manual' check (origem in ('link', 'importacao', 'manual')),
  presente1 boolean not null default false,
  presente2 boolean not null default false,
  desistente_em timestamptz,
  observacao text check (char_length(observacao) <= 280),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (athlete1_id <> athlete2_id)
);
create index if not exists teams_category_status_idx on public.teams (category_id, status);
create index if not exists teams_athlete1_idx on public.teams (athlete1_id);
create index if not exists teams_athlete2_idx on public.teams (athlete2_id);

create table if not exists public.category_groups (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.categories(id) on delete cascade,
  nome text not null check (char_length(nome) between 1 and 10),
  ordem int not null default 0,
  fechado_em timestamptz,
  fechado_por uuid,
  sorteio_desempate jsonb check (octet_length(sorteio_desempate::text) <= 4096),
  created_at timestamptz not null default now(),
  unique (category_id, nome)
);

create table if not exists public.group_teams (
  group_id uuid not null references public.category_groups(id) on delete cascade,
  team_id uuid not null references public.teams(id) deferrable initially deferred,
  primary key (group_id, team_id)
);
create index if not exists group_teams_team_idx on public.group_teams (team_id);

create table if not exists public.matches (
  id uuid primary key default gen_random_uuid(),
  championship_id uuid not null references public.championships(id) on delete cascade,
  category_id uuid not null references public.categories(id) on delete cascade,
  fase text not null check (fase in ('grupo', 'r16', 'qf', 'sf', 'final')),
  group_id uuid references public.category_groups(id) on delete cascade,
  rodada int not null default 1,
  slot int not null default 1,
  team_a uuid references public.teams(id) deferrable initially deferred,
  team_b uuid references public.teams(id) deferrable initially deferred,
  origem_a jsonb check (octet_length(origem_a::text) <= 512),
  origem_b jsonb check (octet_length(origem_b::text) <= 512),
  next_match_id uuid references public.matches(id) deferrable initially deferred,
  next_slot text check (next_slot in ('a', 'b')),
  prioridade int not null default 0,
  court_id uuid references public.courts(id) deferrable initially deferred,
  status text not null default 'agendada'
    check (status in ('agendada', 'chamada', 'em_jogo', 'suspensa', 'encerrada', 'wo', 'anulada')),
  games_a int not null default 0 check (games_a between 0 and 7),
  games_b int not null default 0 check (games_b between 0 and 7),
  tb_a int check (tb_a between 0 and 50),
  tb_b int check (tb_b between 0 and 50),
  vencedor uuid references public.teams(id) deferrable initially deferred,
  wo boolean not null default false,
  desistencia boolean not null default false,
  alerta_origem boolean not null default false,
  scout_device uuid,
  scout_user uuid,
  chamada_em timestamptz,
  iniciada_em timestamptz,
  encerrada_em timestamptz,
  version int not null default 0,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((fase = 'grupo') = (group_id is not null)),
  check (team_a is null or team_b is null or team_a <> team_b)
);
create index if not exists matches_champ_status_prio_idx on public.matches (championship_id, status, prioridade);
create index if not exists matches_court_idx on public.matches (court_id);
create index if not exists matches_category_idx on public.matches (category_id);
create index if not exists matches_group_idx on public.matches (group_id);
create index if not exists matches_team_a_idx on public.matches (team_a);
create index if not exists matches_team_b_idx on public.matches (team_b);
create index if not exists matches_next_idx on public.matches (next_match_id);

create table if not exists public.match_events (
  id bigserial primary key,
  championship_id uuid not null references public.championships(id) on delete cascade,
  match_id uuid references public.matches(id) on delete cascade,
  team_id uuid references public.teams(id) on delete cascade,
  client_event_id uuid,
  tipo text not null check (tipo in (
    'placar', 'inicio', 'fim', 'wo', 'correcao', 'forcar', 'chamar', 'suspender', 'assumir',
    'troca_atleta', 'substituicao', 'fechar_grupo', 'pausa', 'sorteio', 'mata_mata', 'checkin')),
  dados jsonb not null default '{}'::jsonb check (octet_length(dados::text) <= 16384),
  user_id uuid,
  motivo text check (char_length(motivo) <= 280),
  created_at timestamptz not null default now(),
  unique (match_id, client_event_id)
);
create index if not exists match_events_champ_idx on public.match_events (championship_id, created_at);

create table if not exists private.arena_rate (
  ip_hash text not null,
  janela timestamptz not null,
  n int not null default 0,
  primary key (ip_hash, janela)
);
revoke all on private.arena_rate from public, anon, authenticated;

-- ══ updated_at ══════════════════════════════════════════════════════
do $$
declare t text;
begin
  foreach t in array array['arenas', 'arena_members', 'courts', 'championships', 'categories', 'athletes', 'teams', 'matches']
  loop
    execute format('drop trigger if exists %1$s_touch_updated_at on public.%1$s', t);
    execute format('create trigger %1$s_touch_updated_at before update on public.%1$s
                    for each row execute function public.touch_updated_at()', t);
  end loop;
end $$;

-- ══ Auxiliares (private) ════════════════════════════════════════════

create or replace function private.arena_tem_papel(p_arena uuid, p_papeis text[])
returns boolean
language sql
stable
security definer
set search_path = public, private, pg_temp
as $$
  select private.is_admin() or exists (
    select 1 from public.arena_members m
    where m.arena_id = p_arena and m.user_id = auth.uid() and m.ativo and m.papel = any(p_papeis)
  );
$$;

create or replace function private.arena_do_campeonato(p_championship uuid)
returns uuid
language sql
stable
security definer
set search_path = public, private, pg_temp
as $$ select arena_id from public.championships where id = p_championship; $$;

create or replace function private.arena_da_categoria(p_category uuid)
returns uuid
language sql
stable
security definer
set search_path = public, private, pg_temp
as $$
  select c.arena_id from public.categories k join public.championships c on c.id = k.championship_id
  where k.id = p_category;
$$;

create or replace function private.arena_do_grupo(p_group uuid)
returns uuid
language sql
stable
security definer
set search_path = public, private, pg_temp
as $$ select private.arena_da_categoria(category_id) from public.category_groups where id = p_group; $$;

create or replace function private.arena_da_partida(p_match uuid)
returns uuid
language sql
stable
security definer
set search_path = public, private, pg_temp
as $$
  select c.arena_id from public.matches m join public.championships c on c.id = m.championship_id
  where m.id = p_match;
$$;

revoke all on function private.arena_tem_papel(uuid, text[]) from public, anon;
revoke all on function private.arena_do_campeonato(uuid) from public, anon;
revoke all on function private.arena_da_categoria(uuid) from public, anon;
revoke all on function private.arena_do_grupo(uuid) from public, anon;
revoke all on function private.arena_da_partida(uuid) from public, anon;
grant execute on function private.arena_tem_papel(uuid, text[]) to authenticated;
grant execute on function private.arena_do_campeonato(uuid) to authenticated;
grant execute on function private.arena_da_categoria(uuid) to authenticated;
grant execute on function private.arena_do_grupo(uuid) to authenticated;
grant execute on function private.arena_da_partida(uuid) to authenticated;

-- Erro de regra de negócio: message em português, hint = código estável do contrato.
create or replace function private.arena_erro(p_hint text, p_msg text)
returns void
language plpgsql
as $$
begin
  raise exception '%', p_msg using errcode = case p_hint when 'sem_permissao' then '42501' else 'P0001' end, hint = p_hint;
end;
$$;

create or replace function private.arena_exigir(p_arena uuid, p_papeis text[])
returns void
language plpgsql
stable
security definer
set search_path = public, private, pg_temp
as $$
begin
  if p_arena is null then
    perform private.arena_erro('nao_encontrado', 'Registro não encontrado.');
  end if;
  if not private.arena_tem_papel(p_arena, p_papeis) then
    perform private.arena_erro('sem_permissao', 'Sem permissão para esta ação nesta arena.');
  end if;
end;
$$;

create or replace function private.arena_bump(p_championship uuid, p_estrutura boolean)
returns void
language sql
security definer
set search_path = public, private, pg_temp
as $$
  update public.championships
  set live_version = live_version + 1,
      estrutura_version = estrutura_version + case when p_estrutura then 1 else 0 end
  where id = p_championship;
$$;

create or replace function private.arena_log(
  p_championship uuid, p_match uuid, p_team uuid, p_tipo text, p_dados jsonb, p_motivo text, p_client_event uuid default null)
returns void
language sql
security definer
set search_path = public, private, pg_temp
as $$
  insert into public.match_events (championship_id, match_id, team_id, client_event_id, tipo, dados, user_id, motivo)
  values (p_championship, p_match, p_team, p_client_event, p_tipo, coalesce(p_dados, '{}'::jsonb), auth.uid(), left(p_motivo, 280));
$$;

create or replace function private.match_json(m public.matches)
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'id', m.id, 'category_id', m.category_id, 'fase', m.fase, 'group_id', m.group_id, 'rodada', m.rodada,
    'slot', m.slot, 'team_a', m.team_a, 'team_b', m.team_b, 'court_id', m.court_id, 'status', m.status,
    'games_a', m.games_a, 'games_b', m.games_b, 'tb_a', m.tb_a, 'tb_b', m.tb_b, 'vencedor', m.vencedor,
    'wo', m.wo, 'desistencia', m.desistencia, 'alerta_origem', m.alerta_origem, 'scout_device', m.scout_device,
    'chamada_em', m.chamada_em, 'iniciada_em', m.iniciada_em, 'encerrada_em', m.encerrada_em, 'version', m.version);
$$;

-- Preset da fase: 'A' (até 6) ou 'B' (até 4). Alvo = 6 ou 4.
create or replace function private.match_alvo(m public.matches)
returns int
language sql
stable
security definer
set search_path = public, private, pg_temp
as $$
  select case when coalesce(k.formato ->> case when m.fase = 'grupo' then 'preset_grupo' else 'preset_mata' end, 'A') = 'B'
              then 4 else 6 end
  from public.categories k where k.id = m.category_id;
$$;

-- Placar final válido para o alvo N (6 no preset A, 4 no B): N x 0..N-2; N+1 x N-1 (em N-1 x N-1 segue
-- até N+1 x N-1); N+1 x N com tie-break. Regra do dono: tie-break a 7; em 6x6 nos pontos, vence quem
-- fizer 8 primeiro (sem vantagem de 2 infinita). Tie-break válido: 7-0 a 7-5, 8-6 e 8-7.
create or replace function private.placar_valido(p_alvo int, ga int, gb int, ta int, tb int)
returns boolean
language sql
immutable
as $$
  select case
    when ga is null or gb is null or ga = gb then false
    when greatest(ga, gb) = p_alvo and least(ga, gb) <= p_alvo - 2 then ta is null and tb is null
    when greatest(ga, gb) = p_alvo + 1 and least(ga, gb) = p_alvo - 1 then ta is null and tb is null
    when greatest(ga, gb) = p_alvo + 1 and least(ga, gb) = p_alvo then
      ta is not null and tb is not null
      and case when ga > gb then (ta = 7 and tb between 0 and 5) or (ta = 8 and tb in (6, 7))
               else (tb = 7 and ta between 0 and 5) or (tb = 8 and ta in (6, 7)) end
    else false
  end;
$$;

-- A dupla já entrou em quadra (iniciada, suspensa ou encerrada)?
create or replace function private.dupla_ja_jogou(p_team uuid)
returns boolean
language sql
stable
security definer
set search_path = public, private, pg_temp
as $$
  select exists (
    select 1 from public.matches m
    where (m.team_a = p_team or m.team_b = p_team)
      and (m.iniciada_em is not null or m.status in ('em_jogo', 'suspensa', 'encerrada', 'wo', 'anulada'))
  );
$$;

-- Coloca o vencedor no slot da partida seguinte. Seguinte já iniciada: só com p_forcar (marca alerta_origem).
create or replace function private.match_propagar(m public.matches, p_forcar boolean)
returns void
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare n public.matches;
begin
  if m.next_match_id is null or m.next_slot is null then return; end if;
  select * into n from public.matches where id = m.next_match_id for update;
  if (case m.next_slot when 'a' then n.team_a else n.team_b end) is not distinct from m.vencedor then return; end if;
  if n.status in ('encerrada', 'wo', 'anulada') then
    perform private.arena_erro('proxima_encerrada',
      'A partida seguinte já terminou com a dupla antiga. Corrija ou anule a partida seguinte antes.');
  end if;
  if n.status not in ('agendada', 'chamada') or n.iniciada_em is not null then
    if not p_forcar then
      perform private.arena_erro('proxima_iniciada',
        'A partida seguinte já começou. Só o gestor pode corrigir, marcando "forçar".');
    end if;
    update public.matches set alerta_origem = true where id = n.id;
  end if;
  if m.next_slot = 'a' then
    update public.matches set team_a = m.vencedor, version = version + 1, updated_by = auth.uid() where id = n.id;
  else
    update public.matches set team_b = m.vencedor, version = version + 1, updated_by = auth.uid() where id = n.id;
  end if;
end;
$$;

-- ══ Travas de escrita direta (cliente) ══════════════════════════════

-- Campeonato: versões, pausa e arena só mudam por RPC; qualquer edição do gestor muda a estrutura.
create or replace function private.championship_guard()
returns trigger
language plpgsql
set search_path = public, private, pg_temp
as $$
begin
  if current_user not in ('anon', 'authenticated') then return new; end if;
  if tg_op = 'INSERT' then
    new.live_version := 0; new.estrutura_version := 0;
    new.pausado := false; new.pausa_motivo := null; new.pausado_em := null;
  else
    new.arena_id := old.arena_id;
    new.live_version := old.live_version;
    new.estrutura_version := old.estrutura_version + 1;
    new.pausado := old.pausado; new.pausa_motivo := old.pausa_motivo; new.pausado_em := old.pausado_em;
  end if;
  return new;
end;
$$;
drop trigger if exists championships_guard on public.championships;
create trigger championships_guard before insert or update on public.championships
for each row execute function private.championship_guard();

-- Edição em categoria, dupla, atleta ou quadra muda a estrutura pública (arena_public).
create or replace function private.arena_touch_estrutura()
returns trigger
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare r record := coalesce(new, old);
begin
  if tg_table_name = 'categories' then
    update public.championships set estrutura_version = estrutura_version + 1 where id = r.championship_id;
  elsif tg_table_name = 'teams' then
    update public.championships set estrutura_version = estrutura_version + 1
    where id = (select championship_id from public.categories where id = r.category_id);
  else -- athletes, courts
    update public.championships set estrutura_version = estrutura_version + 1
    where arena_id = r.arena_id and status <> 'encerrado';
  end if;
  return null;
end;
$$;
do $$
declare t text;
begin
  foreach t in array array['categories', 'teams', 'athletes', 'courts']
  loop
    execute format('drop trigger if exists %1$s_touch_estrutura on public.%1$s', t);
    execute format('create trigger %1$s_touch_estrutura after insert or update or delete on public.%1$s
                    for each row execute function private.arena_touch_estrutura()', t);
  end loop;
end $$;

-- Invoker de propósito (como em championship_guard): dentro de uma RPC security definer o
-- current_user é postgres e a trava de cliente não se aplica.
-- Dupla: atleta único por categoria (entre duplas não canceladas); depois do sorteio, atletas e
-- categoria só mudam por team_swap_athlete / team_substitute.
create or replace function private.team_guard()
returns trigger
language plpgsql
set search_path = public, private, pg_temp
as $$
begin
  if (select arena_id from public.athletes where id = new.athlete1_id) is distinct from private.arena_da_categoria(new.category_id)
     or (select arena_id from public.athletes where id = new.athlete2_id) is distinct from private.arena_da_categoria(new.category_id) then
    perform private.arena_erro('dados_invalidos', 'Atleta de outra arena.');
  end if;
  if new.status <> 'cancelada' and exists (
    select 1 from public.teams t
    where t.category_id = new.category_id and t.id <> new.id and t.status <> 'cancelada'
      and (t.athlete1_id in (new.athlete1_id, new.athlete2_id) or t.athlete2_id in (new.athlete1_id, new.athlete2_id))
  ) then
    perform private.arena_erro('atleta_ja_inscrito', 'Atleta já inscrito em outra dupla desta categoria.');
  end if;
  if tg_op = 'UPDATE' and current_user in ('anon', 'authenticated')
     and (new.athlete1_id, new.athlete2_id, new.category_id) is distinct from (old.athlete1_id, old.athlete2_id, old.category_id)
     and exists (select 1 from public.group_teams where team_id = old.id) then
    perform private.arena_erro('dados_invalidos',
      'Dupla já sorteada: use "Trocar atleta" ou "Substituir dupla".');
  end if;
  return new;
end;
$$;
drop trigger if exists teams_guard on public.teams;
create trigger teams_guard before insert or update on public.teams
for each row execute function private.team_guard();

-- Equipe: só o owner_id da arena é dono; o dono não é rebaixado, desativado nem apagado
-- (exceto pelo postgres, ex.: apagar a arena TESTE); ninguém muda o próprio papel.
create or replace function private.arena_member_guard()
returns trigger
language plpgsql
set search_path = public, private, pg_temp
as $$
begin
  if current_user = 'postgres' then
    return coalesce(new, old);
  end if;
  if tg_op in ('UPDATE', 'DELETE') and old.papel = 'dono'
     and (tg_op = 'DELETE' or new.papel <> 'dono' or not new.ativo or new.user_id is distinct from old.user_id) then
    perform private.arena_erro('sem_permissao', 'O dono da arena não pode ser removido nem rebaixado.');
  end if;
  if tg_op in ('INSERT', 'UPDATE') and new.papel = 'dono'
     and new.user_id is distinct from (select owner_id from public.arenas where id = new.arena_id) then
    perform private.arena_erro('sem_permissao', 'Só o dono cadastrado da arena tem o papel de dono.');
  end if;
  if tg_op = 'UPDATE' and auth.uid() is not null and old.user_id = auth.uid() and new.papel <> old.papel then
    perform private.arena_erro('sem_permissao', 'Ninguém muda o próprio papel.');
  end if;
  return coalesce(new, old);
end;
$$;
drop trigger if exists arena_members_guard on public.arena_members;
create trigger arena_members_guard before insert or update or delete on public.arena_members
for each row execute function private.arena_member_guard();

-- ══ RLS ═════════════════════════════════════════════════════════════
alter table public.arenas enable row level security;
alter table public.arena_members enable row level security;
alter table public.courts enable row level security;
alter table public.championships enable row level security;
alter table public.categories enable row level security;
alter table public.athletes enable row level security;
alter table public.teams enable row level security;
alter table public.category_groups enable row level security;
alter table public.group_teams enable row level security;
alter table public.matches enable row level security;
alter table public.match_events enable row level security;

revoke all on public.arenas, public.arena_members, public.courts, public.championships, public.categories,
  public.athletes, public.teams, public.category_groups, public.group_teams, public.matches, public.match_events
from anon, authenticated;
revoke all on sequence public.match_events_id_seq from anon, authenticated;
grant select on public.arenas, public.arena_members, public.category_groups, public.group_teams,
  public.matches, public.match_events to authenticated;
grant select, insert, update, delete on public.courts, public.championships, public.categories,
  public.athletes, public.teams to authenticated;

drop policy if exists arenas_select on public.arenas;
create policy arenas_select on public.arenas for select to authenticated
using (private.arena_tem_papel(id, '{dono,gestor,arbitro,scout}'));

-- LGPD: e-mails da equipe e telefones dos atletas só para dono, gestor e árbitro. O scout vê só a
-- própria linha da equipe (para saber a arena e o papel) e nenhum atleta: ele trabalha com
-- arena_live e as RPCs, que trazem os nomes.
drop policy if exists arena_members_select on public.arena_members;
create policy arena_members_select on public.arena_members for select to authenticated
using (user_id = auth.uid() or private.arena_tem_papel(arena_id, '{dono,gestor,arbitro}'));

-- Tabelas com arena_id direto: leitura para membros (atletas: sem scout), escrita para dono/gestor.
do $$
declare t text;
begin
  foreach t in array array['courts', 'championships', 'athletes']
  loop
    execute format('drop policy if exists %1$s_select on public.%1$s', t);
    execute format('create policy %1$s_select on public.%1$s for select to authenticated
                    using (private.arena_tem_papel(arena_id, %2$L))', t,
                   case when t = 'athletes' then '{dono,gestor,arbitro}' else '{dono,gestor,arbitro,scout}' end);
    execute format('drop policy if exists %1$s_write on public.%1$s', t);
    execute format('create policy %1$s_write on public.%1$s for all to authenticated
                    using (private.arena_tem_papel(arena_id, ''{dono,gestor}''))
                    with check (private.arena_tem_papel(arena_id, ''{dono,gestor}''))', t);
  end loop;
end $$;

drop policy if exists categories_select on public.categories;
create policy categories_select on public.categories for select to authenticated
using (private.arena_tem_papel(private.arena_do_campeonato(championship_id), '{dono,gestor,arbitro,scout}'));
drop policy if exists categories_write on public.categories;
create policy categories_write on public.categories for all to authenticated
using (private.arena_tem_papel(private.arena_do_campeonato(championship_id), '{dono,gestor}'))
with check (private.arena_tem_papel(private.arena_do_campeonato(championship_id), '{dono,gestor}'));

drop policy if exists teams_select on public.teams;
create policy teams_select on public.teams for select to authenticated
using (private.arena_tem_papel(private.arena_da_categoria(category_id), '{dono,gestor,arbitro,scout}'));
drop policy if exists teams_write on public.teams;
create policy teams_write on public.teams for all to authenticated
using (private.arena_tem_papel(private.arena_da_categoria(category_id), '{dono,gestor}'))
with check (private.arena_tem_papel(private.arena_da_categoria(category_id), '{dono,gestor}'));

drop policy if exists category_groups_select on public.category_groups;
create policy category_groups_select on public.category_groups for select to authenticated
using (private.arena_tem_papel(private.arena_da_categoria(category_id), '{dono,gestor,arbitro,scout}'));

drop policy if exists group_teams_select on public.group_teams;
create policy group_teams_select on public.group_teams for select to authenticated
using (private.arena_tem_papel(private.arena_do_grupo(group_id), '{dono,gestor,arbitro,scout}'));

drop policy if exists matches_select on public.matches;
create policy matches_select on public.matches for select to authenticated
using (private.arena_tem_papel(private.arena_do_campeonato(championship_id), '{dono,gestor,arbitro,scout}'));

drop policy if exists match_events_select on public.match_events;
create policy match_events_select on public.match_events for select to authenticated
using (private.arena_tem_papel(private.arena_do_campeonato(championship_id), '{dono,gestor,arbitro,scout}'));

-- ══ RPCs de partida ═════════════════════════════════════════════════
-- Papéis: S = scout+, Á = árbitro+, G = dono/gestor. Sempre: trava a linha, confere o papel,
-- grava em match_events e aumenta live_version (e estrutura_version quando muda resultado).

create or replace function private.match_lock(p_match uuid, p_papeis text[])
returns public.matches
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare m public.matches;
begin
  select * into m from public.matches where id = p_match for update;
  if not found then perform private.arena_erro('nao_encontrado', 'Partida não encontrada.'); end if;
  perform private.arena_exigir(private.arena_do_campeonato(m.championship_id), p_papeis);
  return m;
end;
$$;

create or replace function public.match_take(p_match uuid, p_device uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare m public.matches;
begin
  m := private.match_lock(p_match, '{dono,gestor,arbitro,scout}');
  if p_device is null then perform private.arena_erro('dados_invalidos', 'Aparelho não identificado.'); end if;
  if m.status not in ('agendada', 'chamada', 'em_jogo') then
    perform private.arena_erro('status_invalido', 'Esta partida não está disponível para assumir.');
  end if;
  update public.matches set scout_device = p_device, scout_user = auth.uid(), version = version + 1, updated_by = auth.uid()
  where id = m.id returning * into m;
  perform private.arena_log(m.championship_id, m.id, null, 'assumir', jsonb_build_object('device', p_device), null);
  perform private.arena_bump(m.championship_id, false);
  return jsonb_build_object('ok', true, 'match', private.match_json(m));
end;
$$;

-- Recusas esperadas pela fila offline do scout (não lançam erro).
create or replace function private.push_recusa(m public.matches, p_device uuid, p_version int, p_checar_device boolean)
returns jsonb
language sql
stable
as $$
  select case
    when m.status in ('encerrada', 'wo', 'anulada') then
      jsonb_build_object('ok', false, 'erro', 'partida_encerrada', 'match', private.match_json(m))
    when p_checar_device and (m.scout_device is null or m.scout_device is distinct from p_device) then
      jsonb_build_object('ok', false, 'erro', 'outro_aparelho', 'match', private.match_json(m))
    when m.status not in ('chamada', 'em_jogo') then
      jsonb_build_object('ok', false, 'erro', 'partida_indisponivel', 'match', private.match_json(m))
    when p_version is distinct from m.version then
      jsonb_build_object('ok', false, 'erro', 'conflito', 'conflict', true, 'version', m.version,
        'placar', jsonb_build_object('games_a', m.games_a, 'games_b', m.games_b, 'tb_a', m.tb_a, 'tb_b', m.tb_b),
        'por', case when m.updated_by is not distinct from m.scout_user then 'scout' else 'mesa' end,
        'match', private.match_json(m))
  end;
$$;

create or replace function public.match_score_push(
  p_match uuid, p_expected_version int, p_client_event_id uuid, p_device uuid,
  p_games_a int, p_games_b int, p_tb_a int default null, p_tb_b int default null)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  m public.matches;
  recusa jsonb;
begin
  m := private.match_lock(p_match, '{dono,gestor,arbitro,scout}');
  if p_client_event_id is not null and exists (
    select 1 from public.match_events where match_id = m.id and client_event_id = p_client_event_id
  ) then
    return jsonb_build_object('ok', true, 'duplicado', true, 'match', private.match_json(m));
  end if;
  recusa := private.push_recusa(m, p_device, p_expected_version, true);
  if recusa is not null then return recusa; end if;
  if p_games_a is null or p_games_b is null or p_games_a not between 0 and 7 or p_games_b not between 0 and 7
     or coalesce(p_tb_a, 0) not between 0 and 50 or coalesce(p_tb_b, 0) not between 0 and 50 then
    perform private.arena_erro('placar_invalido', 'Placar fora dos limites.');
  end if;
  update public.matches
  set games_a = p_games_a, games_b = p_games_b, tb_a = p_tb_a, tb_b = p_tb_b,
      status = 'em_jogo', iniciada_em = coalesce(iniciada_em, now()),
      version = version + 1, updated_by = auth.uid()
  where id = m.id returning * into m;
  perform private.arena_log(m.championship_id, m.id, null, 'placar',
    jsonb_build_object('games_a', p_games_a, 'games_b', p_games_b, 'tb_a', p_tb_a, 'tb_b', p_tb_b,
                       'version', m.version, 'device', p_device), null, p_client_event_id);
  perform private.arena_bump(m.championship_id, false);
  return jsonb_build_object('ok', true, 'match', private.match_json(m));
end;
$$;

create or replace function public.match_finish(p_match uuid, p_version int, p_vencedor text, p_device uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  m public.matches;
  recusa jsonb;
  so_scout boolean;
begin
  m := private.match_lock(p_match, '{dono,gestor,arbitro,scout}');
  so_scout := not private.arena_tem_papel(private.arena_do_campeonato(m.championship_id), '{dono,gestor,arbitro}');
  -- A Mesa (árbitro+) encerra sem ter assumido: a checagem de aparelho vale só para quem é só scout.
  recusa := private.push_recusa(m, p_device, p_version, so_scout);
  if recusa is not null then return recusa; end if;
  -- O vencedor sai do placar gravado; p_vencedor (opcional) só confere o que o scout confirmou.
  if not private.placar_valido(private.match_alvo(m), m.games_a, m.games_b, m.tb_a, m.tb_b)
     or (p_vencedor is not null and p_vencedor is distinct from case when m.games_a > m.games_b then 'a' else 'b' end) then
    perform private.arena_erro('placar_invalido', 'Placar final inválido para este formato de jogo.');
  end if;
  update public.matches
  set status = 'encerrada', encerrada_em = now(), iniciada_em = coalesce(iniciada_em, now()),
      vencedor = case when games_a > games_b then team_a else team_b end,
      version = version + 1, updated_by = auth.uid()
  where id = m.id returning * into m;
  perform private.match_propagar(m, false);
  perform private.arena_log(m.championship_id, m.id, m.vencedor, 'fim',
    jsonb_build_object('games_a', m.games_a, 'games_b', m.games_b, 'tb_a', m.tb_a, 'tb_b', m.tb_b, 'vencedor', case when m.games_a > m.games_b then 'a' else 'b' end), null);
  perform private.arena_bump(m.championship_id, true);
  return jsonb_build_object('ok', true, 'match', private.match_json(m));
end;
$$;

create or replace function public.match_call(p_match uuid, p_court uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare m public.matches;
begin
  m := private.match_lock(p_match, '{dono,gestor,arbitro}');
  if m.status not in ('agendada', 'suspensa', 'chamada') then
    perform private.arena_erro('status_invalido', 'Só partidas agendadas, suspensas ou chamadas podem ser chamadas.');
  end if;
  if m.team_a is null or m.team_b is null then
    perform private.arena_erro('status_invalido', 'A partida ainda não tem as duas duplas.');
  end if;
  if not exists (select 1 from public.courts c where c.id = p_court
                 and c.arena_id = private.arena_do_campeonato(m.championship_id)) then
    perform private.arena_erro('nao_encontrado', 'Quadra não encontrada nesta arena.');
  end if;
  update public.matches set status = 'chamada', court_id = p_court, chamada_em = now(),
    version = version + 1, updated_by = auth.uid()
  where id = m.id returning * into m;
  perform private.arena_log(m.championship_id, m.id, null, 'chamar', jsonb_build_object('court_id', p_court), null);
  perform private.arena_bump(m.championship_id, false);
  return jsonb_build_object('ok', true, 'match', private.match_json(m));
end;
$$;

create or replace function public.match_start(p_match uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare m public.matches;
begin
  m := private.match_lock(p_match, '{dono,gestor,arbitro}');
  if m.status <> 'chamada' then
    perform private.arena_erro('status_invalido', 'Só partidas chamadas podem ser iniciadas.');
  end if;
  update public.matches set status = 'em_jogo', iniciada_em = coalesce(iniciada_em, now()),
    version = version + 1, updated_by = auth.uid()
  where id = m.id returning * into m;
  perform private.arena_log(m.championship_id, m.id, null, 'inicio', '{}', null);
  perform private.arena_bump(m.championship_id, false);
  return jsonb_build_object('ok', true, 'match', private.match_json(m));
end;
$$;

create or replace function public.match_suspend(p_match uuid, p_motivo text)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare m public.matches;
begin
  m := private.match_lock(p_match, '{dono,gestor,arbitro}');
  if nullif(trim(p_motivo), '') is null then
    perform private.arena_erro('motivo_obrigatorio', 'Informe o motivo da suspensão.');
  end if;
  if m.status not in ('chamada', 'em_jogo') then
    perform private.arena_erro('status_invalido', 'Só partidas chamadas ou em jogo podem ser suspensas.');
  end if;
  update public.matches set status = 'suspensa', court_id = null, scout_device = null,
    version = version + 1, updated_by = auth.uid()
  where id = m.id returning * into m;
  perform private.arena_log(m.championship_id, m.id, null, 'suspender',
    jsonb_build_object('games_a', m.games_a, 'games_b', m.games_b, 'tb_a', m.tb_a, 'tb_b', m.tb_b), p_motivo);
  perform private.arena_bump(m.championship_id, false);
  return jsonb_build_object('ok', true, 'match', private.match_json(m));
end;
$$;

create or replace function private.grupo_fechado(m public.matches)
returns boolean
language sql
stable
security definer
set search_path = public, private, pg_temp
as $$ select exists (select 1 from public.category_groups g where g.id = m.group_id and g.fechado_em is not null); $$;

create or replace function public.match_wo(p_match uuid, p_ausente text, p_motivo text)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  m public.matches;
  alvo int;
begin
  m := private.match_lock(p_match, '{dono,gestor,arbitro}');
  if nullif(trim(p_motivo), '') is null then
    perform private.arena_erro('motivo_obrigatorio', 'Informe o motivo do WO.');
  end if;
  if p_ausente not in ('a', 'b', 'duplo') then
    perform private.arena_erro('dados_invalidos', 'Ausente deve ser a, b ou duplo.');
  end if;
  if private.grupo_fechado(m) then
    perform private.arena_erro('grupo_fechado', 'Grupo já fechado: o placar não muda mais.');
  end if;
  if m.status in ('encerrada', 'wo', 'anulada') then
    perform private.arena_erro('status_invalido', 'Partida já encerrada. Use a correção de placar.');
  end if;
  if m.team_a is null or m.team_b is null then
    perform private.arena_erro('status_invalido', 'A partida ainda não tem as duas duplas.');
  end if;
  alvo := private.match_alvo(m);
  update public.matches
  set status = case when p_ausente = 'duplo' then 'anulada' else 'wo' end, wo = true,
      games_a = case p_ausente when 'b' then alvo else 0 end,
      games_b = case p_ausente when 'a' then alvo else 0 end,
      tb_a = null, tb_b = null,
      vencedor = case p_ausente when 'a' then team_b when 'b' then team_a end,
      encerrada_em = now(), version = version + 1, updated_by = auth.uid()
  where id = m.id returning * into m;
  if m.vencedor is not null then perform private.match_propagar(m, false); end if;
  perform private.arena_log(m.championship_id, m.id, m.vencedor, 'wo', jsonb_build_object('ausente', p_ausente), p_motivo);
  perform private.arena_bump(m.championship_id, true);
  return jsonb_build_object('ok', true, 'match', private.match_json(m));
end;
$$;

create or replace function public.match_set_result(
  p_match uuid, p_games_a int, p_games_b int, p_tb_a int, p_tb_b int, p_wo boolean, p_motivo text,
  p_forcar boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  m public.matches;
  antes jsonb;
  alvo int;
  arena uuid;
begin
  m := private.match_lock(p_match, '{dono,gestor,arbitro}');
  arena := private.arena_do_campeonato(m.championship_id);
  if coalesce(p_forcar, false) and not private.arena_tem_papel(arena, '{dono,gestor}') then
    perform private.arena_erro('sem_permissao', 'Só o gestor pode corrigir com "forçar".');
  end if;
  if nullif(trim(p_motivo), '') is null then
    perform private.arena_erro('motivo_obrigatorio', 'Informe o motivo da correção.');
  end if;
  if private.grupo_fechado(m) then
    perform private.arena_erro('grupo_fechado', 'Grupo já fechado: o placar não muda mais.');
  end if;
  if m.team_a is null or m.team_b is null then
    perform private.arena_erro('status_invalido', 'A partida ainda não tem as duas duplas.');
  end if;
  alvo := private.match_alvo(m);
  if coalesce(p_wo, false) then
    if not ((p_games_a = alvo and p_games_b = 0) or (p_games_a = 0 and p_games_b = alvo)) or p_tb_a is not null or p_tb_b is not null then
      perform private.arena_erro('placar_invalido', format('WO é %s x 0.', alvo));
    end if;
  elsif not private.placar_valido(alvo, p_games_a, p_games_b, p_tb_a, p_tb_b) then
    perform private.arena_erro('placar_invalido', 'Placar final inválido para este formato de jogo.');
  end if;
  antes := private.match_json(m);
  update public.matches
  set games_a = p_games_a, games_b = p_games_b, tb_a = p_tb_a, tb_b = p_tb_b,
      wo = coalesce(p_wo, false), status = case when coalesce(p_wo, false) then 'wo' else 'encerrada' end,
      vencedor = case when p_games_a > p_games_b then team_a else team_b end,
      iniciada_em = coalesce(iniciada_em, now()), encerrada_em = coalesce(encerrada_em, now()),
      version = version + 1, updated_by = auth.uid()
  where id = m.id returning * into m;
  perform private.match_propagar(m, coalesce(p_forcar, false));
  perform private.arena_log(m.championship_id, m.id, m.vencedor,
    case when coalesce(p_forcar, false) then 'forcar' else 'correcao' end,
    jsonb_build_object('antes', antes, 'depois', private.match_json(m)), p_motivo);
  perform private.arena_bump(m.championship_id, true);
  return jsonb_build_object('ok', true, 'match', private.match_json(m));
end;
$$;

-- ══ RPCs de dupla ═══════════════════════════════════════════════════

create or replace function private.team_lock(p_team uuid, p_papeis text[])
returns public.teams
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare t public.teams;
begin
  select * into t from public.teams where id = p_team for update;
  if not found then perform private.arena_erro('nao_encontrado', 'Dupla não encontrada.'); end if;
  perform private.arena_exigir(private.arena_da_categoria(t.category_id), p_papeis);
  return t;
end;
$$;

create or replace function private.team_json(t public.teams)
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object('id', t.id, 'category_id', t.category_id, 'athlete1_id', t.athlete1_id,
    'athlete2_id', t.athlete2_id, 'status', t.status, 'pagamento', t.pagamento, 'presente1', t.presente1,
    'presente2', t.presente2, 'seed', t.seed);
$$;

create or replace function public.team_checkin(p_team uuid, p_posicao int, p_presente boolean)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  t public.teams;
  champ uuid;
begin
  t := private.team_lock(p_team, '{dono,gestor,arbitro}');
  if p_posicao not in (1, 2) then perform private.arena_erro('dados_invalidos', 'Posição deve ser 1 ou 2.'); end if;
  update public.teams
  set presente1 = case when p_posicao = 1 then coalesce(p_presente, false) else presente1 end,
      presente2 = case when p_posicao = 2 then coalesce(p_presente, false) else presente2 end
  where id = t.id returning * into t;
  select championship_id into champ from public.categories where id = t.category_id;
  perform private.arena_log(champ, null, t.id, 'checkin', jsonb_build_object('posicao', p_posicao, 'presente', p_presente), null);
  perform private.arena_bump(champ, false);
  return jsonb_build_object('ok', true, 'team', private.team_json(t));
end;
$$;

create or replace function public.team_swap_athlete(p_team uuid, p_posicao int, p_athlete uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  t public.teams;
  champ uuid;
  antigo uuid;
begin
  t := private.team_lock(p_team, '{dono,gestor}');
  if p_posicao not in (1, 2) then perform private.arena_erro('dados_invalidos', 'Posição deve ser 1 ou 2.'); end if;
  if private.dupla_ja_jogou(t.id) then
    perform private.arena_erro('dupla_ja_jogou', 'A dupla já jogou: a troca de atleta não é mais permitida.');
  end if;
  antigo := case when p_posicao = 1 then t.athlete1_id else t.athlete2_id end;
  update public.teams
  set athlete1_id = case when p_posicao = 1 then p_athlete else athlete1_id end,
      athlete2_id = case when p_posicao = 2 then p_athlete else athlete2_id end,
      presente1 = case when p_posicao = 1 then false else presente1 end,
      presente2 = case when p_posicao = 2 then false else presente2 end
  where id = t.id returning * into t;
  select championship_id into champ from public.categories where id = t.category_id;
  perform private.arena_log(champ, null, t.id, 'troca_atleta',
    jsonb_build_object('posicao', p_posicao, 'de', antigo, 'para', p_athlete), null);
  perform private.arena_bump(champ, true);
  return jsonb_build_object('ok', true, 'team', private.team_json(t));
end;
$$;

create or replace function public.team_substitute(p_team_antigo uuid, p_team_novo uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  velho public.teams;
  novo public.teams;
  champ uuid;
begin
  velho := private.team_lock(p_team_antigo, '{dono,gestor}');
  novo := private.team_lock(p_team_novo, '{dono,gestor}');
  if novo.category_id <> velho.category_id or novo.id = velho.id or novo.status = 'cancelada'
     or exists (select 1 from public.group_teams where team_id = novo.id) then
    perform private.arena_erro('dados_invalidos', 'A dupla nova precisa ser da mesma categoria e estar fora dos grupos.');
  end if;
  if private.dupla_ja_jogou(velho.id) then
    perform private.arena_erro('dupla_ja_jogou', 'A dupla já jogou: a substituição não é mais permitida.');
  end if;
  update public.teams set status = 'cancelada' where id = velho.id;
  update public.teams set status = 'confirmada' where id = novo.id returning * into novo;
  update public.group_teams set team_id = novo.id where team_id = velho.id;
  update public.matches set team_a = novo.id, version = version + 1, updated_by = auth.uid() where team_a = velho.id;
  update public.matches set team_b = novo.id, version = version + 1, updated_by = auth.uid() where team_b = velho.id;
  select championship_id into champ from public.categories where id = novo.category_id;
  perform private.arena_log(champ, null, novo.id, 'substituicao', jsonb_build_object('de', velho.id, 'para', novo.id), null);
  perform private.arena_bump(champ, true);
  return jsonb_build_object('ok', true, 'team', private.team_json(novo));
end;
$$;

-- ══ RPCs de sorteio, grupo e chave ══════════════════════════════════

create or replace function public.category_publish_draw(p_category uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  k public.categories;
  champ uuid;
  g jsonb;
  p jsonb;
  gid uuid;
  mid uuid;
  grupos jsonb := '{}'::jsonb;   -- nome -> group_id
  refs jsonb := '{}'::jsonb;     -- ref -> match_id
  n_partidas int := 0;
  oa jsonb;
  ob jsonb;
begin
  select * into k from public.categories where id = p_category for update;
  if not found then perform private.arena_erro('nao_encontrado', 'Categoria não encontrada.'); end if;
  champ := k.championship_id;
  perform private.arena_exigir(private.arena_do_campeonato(champ), '{dono,gestor}');
  if jsonb_typeof(p_payload -> 'grupos') <> 'array' or jsonb_typeof(p_payload -> 'partidas') <> 'array'
     or jsonb_array_length(p_payload -> 'grupos') = 0 or octet_length(p_payload::text) > 262144 then
    perform private.arena_erro('dados_invalidos', 'Sorteio sem grupos ou partidas.');
  end if;
  if exists (select 1 from public.matches where category_id = k.id
             and (status <> 'agendada' or iniciada_em is not null or games_a > 0 or games_b > 0)) then
    perform private.arena_erro('sorteio_iniciado', 'Já há partida começada nesta categoria: o sorteio não pode ser refeito.');
  end if;

  -- Refazer: apaga o sorteio anterior (nenhuma partida começou).
  delete from public.matches where category_id = k.id;
  delete from public.category_groups where category_id = k.id;

  for g in select * from jsonb_array_elements(p_payload -> 'grupos') loop
    insert into public.category_groups (category_id, nome, ordem)
    values (k.id, g ->> 'nome', coalesce((g ->> 'ordem')::int, 0)) returning id into gid;
    grupos := grupos || jsonb_build_object(g ->> 'nome', gid);
    insert into public.group_teams (group_id, team_id)
    select gid, d::uuid from jsonb_array_elements_text(g -> 'duplas') d;
  end loop;
  if exists (
    select 1 from public.group_teams gt join public.category_groups cg on cg.id = gt.group_id
    left join public.teams t on t.id = gt.team_id
    where cg.category_id = k.id and (t.category_id is distinct from k.id or t.status in ('cancelada', 'espera'))
  ) or exists (
    select 1 from public.group_teams gt join public.category_groups cg on cg.id = gt.group_id
    where cg.category_id = k.id group by gt.team_id having count(*) > 1
  ) then
    perform private.arena_erro('dados_invalidos', 'Dupla de outra categoria, cancelada, em espera ou em dois grupos.');
  end if;

  for p in select * from jsonb_array_elements(p_payload -> 'partidas') loop
    if jsonb_typeof(coalesce(p -> 'origem_a', '{}')) <> 'object' or jsonb_typeof(coalesce(p -> 'origem_b', '{}')) <> 'object' then
      perform private.arena_erro('dados_invalidos', 'Origem de partida inválida.');
    end if;
    gid := case when p ->> 'fase' = 'grupo' then (grupos ->> (p ->> 'grupo'))::uuid end;
    if p ->> 'fase' = 'grupo' and (gid is null
       or not exists (select 1 from public.group_teams where group_id = gid and team_id = (p ->> 'team_a')::uuid)
       or not exists (select 1 from public.group_teams where group_id = gid and team_id = (p ->> 'team_b')::uuid)) then
      perform private.arena_erro('dados_invalidos', format('Partida %s com dupla fora do grupo.', p ->> 'ref'));
    end if;
    insert into public.matches (championship_id, category_id, fase, group_id, rodada, slot, team_a, team_b,
                                origem_a, origem_b, prioridade, updated_by)
    values (champ, k.id, p ->> 'fase', gid, coalesce((p ->> 'rodada')::int, 1), coalesce((p ->> 'slot')::int, 1),
            case when p ->> 'fase' = 'grupo' then (p ->> 'team_a')::uuid end,
            case when p ->> 'fase' = 'grupo' then (p ->> 'team_b')::uuid end,
            p -> 'origem_a', p -> 'origem_b', coalesce((p ->> 'prioridade')::int, 0), auth.uid())
    returning id into mid;
    if p ->> 'ref' is null or refs ? (p ->> 'ref') then
      perform private.arena_erro('dados_invalidos', 'Toda partida precisa de um ref único.');
    end if;
    refs := refs || jsonb_build_object(p ->> 'ref', mid);
    n_partidas := n_partidas + 1;
  end loop;

  -- Liga next_ref e troca origem {match_ref} por {match: uuid}.
  for p in select * from jsonb_array_elements(p_payload -> 'partidas') loop
    oa := p -> 'origem_a'; ob := p -> 'origem_b';
    -- Origens aceitas: {grupo, pos}, {melhor1: n}, {melhor2: n}, {match: ref|uuid}, {match_ref: ref}.
    if oa ? 'match_ref' then oa := jsonb_build_object('match', refs -> (oa ->> 'match_ref'));
    elsif refs ? (oa ->> 'match') then oa := jsonb_build_object('match', refs -> (oa ->> 'match')); end if;
    if ob ? 'match_ref' then ob := jsonb_build_object('match', refs -> (ob ->> 'match_ref'));
    elsif refs ? (ob ->> 'match') then ob := jsonb_build_object('match', refs -> (ob ->> 'match')); end if;
    if p ->> 'next_ref' is not null and not refs ? (p ->> 'next_ref') then
      perform private.arena_erro('dados_invalidos', format('next_ref %s não existe.', p ->> 'next_ref'));
    end if;
    update public.matches
    set next_match_id = (refs ->> (p ->> 'next_ref'))::uuid, next_slot = p ->> 'next_slot', origem_a = oa, origem_b = ob
    where id = (refs ->> (p ->> 'ref'))::uuid;
  end loop;

  update public.categories set sorteio_semente = left(p_payload ->> 'semente', 80) where id = k.id;
  perform private.arena_log(champ, null, null, 'sorteio',
    jsonb_build_object('category_id', k.id, 'semente', p_payload ->> 'semente',
                       'grupos', jsonb_array_length(p_payload -> 'grupos'), 'partidas', n_partidas), null);
  perform private.arena_bump(champ, true);
  return jsonb_build_object('ok', true, 'grupos', jsonb_array_length(p_payload -> 'grupos'), 'partidas', n_partidas);
end;
$$;

create or replace function public.group_close(p_group uuid, p_sorteio jsonb default null)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  g public.category_groups;
  champ uuid;
begin
  select * into g from public.category_groups where id = p_group for update;
  if not found then perform private.arena_erro('nao_encontrado', 'Grupo não encontrado.'); end if;
  perform private.arena_exigir(private.arena_da_categoria(g.category_id), '{dono,gestor}');
  if g.fechado_em is not null then
    perform private.arena_erro('grupo_fechado', 'Grupo já fechado.');
  end if;
  if exists (select 1 from public.matches where group_id = g.id and status not in ('encerrada', 'wo', 'anulada')) then
    perform private.arena_erro('status_invalido', 'Ainda há partidas do grupo sem resultado.');
  end if;
  update public.category_groups set fechado_em = now(), fechado_por = auth.uid(), sorteio_desempate = p_sorteio
  where id = g.id;
  select championship_id into champ from public.categories where id = g.category_id;
  perform private.arena_log(champ, null, null, 'fechar_grupo',
    jsonb_build_object('group_id', g.id, 'nome', g.nome, 'sorteio', p_sorteio), null);
  perform private.arena_bump(champ, true);
  return jsonb_build_object('ok', true, 'group_id', g.id, 'fechado', true);
end;
$$;

create or replace function public.category_seed_knockout(p_category uuid, p_slots jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  k public.categories;
  s jsonb;
  n int := 0;
  m public.matches;
begin
  select * into k from public.categories where id = p_category for update;
  if not found then perform private.arena_erro('nao_encontrado', 'Categoria não encontrada.'); end if;
  perform private.arena_exigir(private.arena_do_campeonato(k.championship_id), '{dono,gestor}');
  if exists (select 1 from public.category_groups where category_id = k.id and fechado_em is null) then
    perform private.arena_erro('grupos_abertos', 'Feche todos os grupos antes de gerar o mata-mata.');
  end if;
  if jsonb_typeof(p_slots) <> 'array' then
    perform private.arena_erro('dados_invalidos', 'Slots inválidos.');
  end if;
  -- Slot: {match, slot, team, origem?}. Só a 1ª rodada (origem de grupo/melhores), nunca vaga {match}.
  -- "origem" vem do preencherChave quando ele troca vagas para evitar duelo do mesmo grupo.
  for s in select * from jsonb_array_elements(p_slots) loop
    select * into m from public.matches where id = (s ->> 'match')::uuid and category_id = k.id for update;
    if not found or m.fase = 'grupo' or m.status <> 'agendada' or m.iniciada_em is not null or s ->> 'slot' not in ('a', 'b')
       or (case when s ->> 'slot' = 'a' then m.origem_a else m.origem_b end) ? 'match'
       or (s ? 'origem' and (jsonb_typeof(s -> 'origem') <> 'object' or s -> 'origem' ? 'match' or s -> 'origem' ? 'match_ref'))
       or not exists (select 1 from public.group_teams gt join public.category_groups cg on cg.id = gt.group_id
                      where cg.category_id = k.id and gt.team_id = (s ->> 'team')::uuid) then
      perform private.arena_erro('dados_invalidos', 'Slot de mata-mata inválido, vaga de outra partida ou partida já iniciada.');
    end if;
    if s ->> 'slot' = 'a' then
      update public.matches set team_a = (s ->> 'team')::uuid, origem_a = coalesce(s -> 'origem', origem_a),
        version = version + 1, updated_by = auth.uid() where id = m.id;
    else
      update public.matches set team_b = (s ->> 'team')::uuid, origem_b = coalesce(s -> 'origem', origem_b),
        version = version + 1, updated_by = auth.uid() where id = m.id;
    end if;
    n := n + 1;
  end loop;
  -- Mesma dupla em duas vagas da 1ª rodada (do pedido ou somada ao que já estava preenchido).
  if exists (
    select t from public.matches x
    cross join lateral (values (x.team_a, x.origem_a), (x.team_b, x.origem_b)) v(t, o)
    where x.category_id = k.id and x.fase <> 'grupo' and v.t is not null and not coalesce(v.o ? 'match', false)
    group by t having count(*) > 1
  ) then
    perform private.arena_erro('dados_invalidos', 'A mesma dupla aparece em duas vagas do mata-mata.');
  end if;
  perform private.arena_log(k.championship_id, null, null, 'mata_mata', jsonb_build_object('category_id', k.id, 'slots', p_slots), null);
  perform private.arena_bump(k.championship_id, true);
  return jsonb_build_object('ok', true, 'preenchidos', n);
end;
$$;

create or replace function public.championship_pause(p_championship uuid, p_motivo text)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare pausar boolean := nullif(trim(p_motivo), '') is not null;
begin
  perform private.arena_exigir(private.arena_do_campeonato(p_championship), '{dono,gestor}');
  update public.championships
  set pausado = pausar, pausa_motivo = case when pausar then left(trim(p_motivo), 120) end,
      pausado_em = case when pausar then now() end
  where id = p_championship;
  perform private.arena_log(p_championship, null, null, 'pausa', jsonb_build_object('pausado', pausar), p_motivo);
  perform private.arena_bump(p_championship, false);
  return jsonb_build_object('ok', true, 'pausado', pausar);
end;
$$;

-- ══ RPCs públicas (anon) ════════════════════════════════════════════
-- Só nomes, placares e estrutura. Nunca telefone, e-mail, user_id, token nem Pix.

create or replace function private.campeonato_publico(p_slug text)
returns public.championships
language sql
stable
security definer
set search_path = public, private, pg_temp
as $$
  select c.* from public.championships c join public.arenas a on a.id = c.arena_id
  where c.slug = p_slug and c.status <> 'rascunho' and a.status = 'ativa';
$$;

create or replace function private.nome_dupla(p_team uuid)
returns text
language sql
stable
security definer
set search_path = public, private, pg_temp
as $$
  select a1.nome || ' / ' || a2.nome from public.teams t
  join public.athletes a1 on a1.id = t.athlete1_id join public.athletes a2 on a2.id = t.athlete2_id
  where t.id = p_team;
$$;

create or replace function public.arena_live(p_slug text, p_since bigint default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, private, pg_temp
as $$
declare c public.championships;
begin
  c := private.campeonato_publico(p_slug);
  if c.id is null then return jsonb_build_object('ok', false, 'erro', 'nao_encontrado'); end if;
  if p_since is not null and p_since = c.live_version then
    return jsonb_build_object('ok', true, 'changed', false, 'live_version', c.live_version, 'estrutura_version', c.estrutura_version);
  end if;
  return jsonb_build_object(
    'ok', true, 'changed', true, 'server_time', now(),
    'championship', jsonb_build_object('id', c.id, 'titulo', c.titulo, 'slug', c.slug, 'status', c.status,
      'pausado', c.pausado, 'pausa_motivo', c.pausa_motivo, 'live_version', c.live_version,
      'estrutura_version', c.estrutura_version),
    'quadras', coalesce((select jsonb_agg(jsonb_build_object('id', q.id, 'nome', q.nome, 'ordem', q.ordem, 'ativa', q.ativa)
                         order by q.ordem, q.nome) from public.courts q where q.arena_id = c.arena_id), '[]'::jsonb),
    'partidas', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', m.id, 'court_id', m.court_id, 'status', m.status, 'categoria', k.nome, 'fase', m.fase,
        'grupo', g.nome, 'rodada', m.rodada,
        'team_a', jsonb_build_object('id', m.team_a, 'nome', private.nome_dupla(m.team_a)),
        'team_b', jsonb_build_object('id', m.team_b, 'nome', private.nome_dupla(m.team_b)),
        'games_a', m.games_a, 'games_b', m.games_b, 'tb_a', m.tb_a, 'tb_b', m.tb_b,
        'chamada_em', m.chamada_em, 'iniciada_em', m.iniciada_em, 'version', m.version) order by m.chamada_em)
      from public.matches m join public.categories k on k.id = m.category_id
      left join public.category_groups g on g.id = m.group_id
      where m.championship_id = c.id and m.status in ('chamada', 'em_jogo')), '[]'::jsonb));
end;
$$;

create or replace function public.arena_public(p_slug text, p_since_estrutura bigint default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, private, pg_temp
as $$
declare c public.championships;
begin
  c := private.campeonato_publico(p_slug);
  if c.id is null then return jsonb_build_object('ok', false, 'erro', 'nao_encontrado'); end if;
  if p_since_estrutura is not null and p_since_estrutura = c.estrutura_version then
    return jsonb_build_object('ok', true, 'changed', false, 'live_version', c.live_version, 'estrutura_version', c.estrutura_version);
  end if;
  return jsonb_build_object(
    'ok', true, 'changed', true,
    'arena', (select jsonb_build_object('nome', a.nome, 'cidade', a.cidade, 'estado', a.estado)
              from public.arenas a where a.id = c.arena_id),
    'championship', jsonb_build_object('id', c.id, 'titulo', c.titulo, 'slug', c.slug, 'status', c.status,
      'data_inicio', c.data_inicio, 'data_fim', c.data_fim, 'inscricoes_ate', c.inscricoes_ate,
      'pausado', c.pausado, 'pausa_motivo', c.pausa_motivo, 'live_version', c.live_version,
      'estrutura_version', c.estrutura_version,
      'regras', jsonb_strip_nulls(jsonb_build_object(
        'dias', c.regras -> 'dias', 'tolerancia_wo_min', c.regras -> 'tolerancia_wo_min',
        'descanso_min', c.regras -> 'descanso_min', 'duracao_media_min', c.regras -> 'duracao_media_min',
        'intervalo_min', c.regras -> 'intervalo_min', 'desistencia_modo', c.regras -> 'desistencia_modo',
        'wo_conta_saldo', c.regras -> 'wo_conta_saldo', 'cruzamento', c.regras -> 'cruzamento',
        'preset', c.regras -> 'preset', 'regulamento', c.regras -> 'regulamento'))),
    'quadras', coalesce((select jsonb_agg(jsonb_build_object('id', q.id, 'nome', q.nome, 'ordem', q.ordem, 'ativa', q.ativa)
                         order by q.ordem, q.nome) from public.courts q where q.arena_id = c.arena_id), '[]'::jsonb),
    'categorias', coalesce((select jsonb_agg(jsonb_build_object('id', k.id, 'nome', k.nome, 'genero', k.genero,
                            'max_duplas', k.max_duplas, 'formato', k.formato, 'ordem', k.ordem) order by k.ordem, k.nome)
                            from public.categories k where k.championship_id = c.id), '[]'::jsonb),
    'duplas', coalesce((
      select jsonb_agg(jsonb_build_object('id', t.id, 'category_id', t.category_id,
        'nome', a1.nome || ' / ' || a2.nome, 'atleta1', a1.nome, 'atleta2', a2.nome,
        'status', t.status, 'seed', t.seed, 'desistente', t.desistente_em is not null) order by t.created_at)
      from public.teams t join public.categories k on k.id = t.category_id
      join public.athletes a1 on a1.id = t.athlete1_id join public.athletes a2 on a2.id = t.athlete2_id
      where k.championship_id = c.id and t.status in ('confirmada', 'pendente')), '[]'::jsonb),
    'grupos', coalesce((
      select jsonb_agg(jsonb_build_object('id', g.id, 'category_id', g.category_id, 'nome', g.nome, 'ordem', g.ordem,
        'fechado', g.fechado_em is not null, 'sorteio_desempate', g.sorteio_desempate,
        'duplas', coalesce((select jsonb_agg(gt.team_id) from public.group_teams gt where gt.group_id = g.id), '[]'::jsonb))
        order by g.ordem, g.nome)
      from public.category_groups g join public.categories k on k.id = g.category_id
      where k.championship_id = c.id), '[]'::jsonb),
    'partidas', coalesce((
      select jsonb_agg(jsonb_build_object('id', m.id, 'category_id', m.category_id, 'fase', m.fase,
        'group_id', m.group_id, 'rodada', m.rodada, 'slot', m.slot, 'team_a', m.team_a, 'team_b', m.team_b,
        'origem_a', m.origem_a, 'origem_b', m.origem_b, 'next_match_id', m.next_match_id, 'next_slot', m.next_slot,
        'prioridade', m.prioridade, 'court_id', m.court_id, 'status', m.status, 'games_a', m.games_a,
        'games_b', m.games_b, 'tb_a', m.tb_a, 'tb_b', m.tb_b, 'vencedor', m.vencedor, 'wo', m.wo,
        'desistencia', m.desistencia, 'chamada_em', m.chamada_em, 'iniciada_em', m.iniciada_em,
        'encerrada_em', m.encerrada_em) order by m.prioridade, m.rodada, m.slot)
      from public.matches m where m.championship_id = c.id), '[]'::jsonb));
end;
$$;

create or replace function public.arena_inscricao_info(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, private, pg_temp
as $$
declare
  c public.championships;
  a public.arenas;
begin
  select * into c from public.championships where inscricao_token = p_token and status <> 'rascunho';
  if not found then return jsonb_build_object('ok', false, 'erro', 'nao_encontrado'); end if;
  select * into a from public.arenas where id = c.arena_id;
  if a.status <> 'ativa' then return jsonb_build_object('ok', false, 'erro', 'nao_encontrado'); end if;
  return jsonb_build_object(
    'ok', true,
    'arena', jsonb_build_object('nome', a.nome),
    'championship', jsonb_build_object('titulo', c.titulo, 'slug', c.slug, 'data_inicio', c.data_inicio,
      'data_fim', c.data_fim, 'inscricoes_ate', c.inscricoes_ate, 'status', c.status,
      'aberto', c.status = 'inscricoes' and (c.inscricoes_ate is null or c.inscricoes_ate > now()),
      'pix', case when jsonb_typeof(c.regras -> 'pix') = 'object' then c.regras -> 'pix' end,
      'whatsapp', coalesce(c.regras ->> 'whatsapp', a.whatsapp)),
    'categorias', coalesce((
      select jsonb_agg(jsonb_build_object('id', k.id, 'nome', k.nome, 'genero', k.genero, 'max_duplas', k.max_duplas,
        'inscritas', x.n, 'vagas', greatest(k.max_duplas - x.n, 0), 'inscricoes_abertas', k.inscricoes_abertas)
        order by k.ordem, k.nome)
      from public.categories k
      cross join lateral (select count(*)::int n from public.teams t
                          where t.category_id = k.id and t.status in ('confirmada', 'pendente')) x
      where k.championship_id = c.id), '[]'::jsonb));
end;
$$;

-- ══ Inscrição pública (só service role, pela Function arena-register) ══

create or replace function public.arena_inscrever(p_token text, p_ip_hash text, p_dados jsonb, p_limite_hora int default 10)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  c public.championships;
  k public.categories;
  a1 uuid;
  a2 uuid;
  tentativas int;
  ocupadas int;
  st text;
  pg text;
  tid uuid;
  tem_pix boolean;
  i int;
  atl jsonb;
  aid uuid;
  v_msg text;
  v_hint text;
begin
  -- Limite por hash de IP (janela de 1 hora). Limpa janelas antigas de passagem.
  delete from private.arena_rate where janela < now() - interval '2 days';
  insert into private.arena_rate (ip_hash, janela, n) values (coalesce(p_ip_hash, 'sem-ip'), date_trunc('hour', now()), 1)
  on conflict (ip_hash, janela) do update set n = private.arena_rate.n + 1
  returning n into tentativas;
  if tentativas > p_limite_hora then
    return jsonb_build_object('ok', false, 'erro', 'limite', 'mensagem', 'Muitas tentativas deste endereço. Tente de novo mais tarde.');
  end if;

  -- Bloco com exceção = subtransação: a recusa desfaz a inscrição, mas não a contagem acima.
  begin
  select * into c from public.championships where inscricao_token = p_token;
  if not found or c.status = 'rascunho' then
    perform private.arena_erro('nao_encontrado', 'Link de inscrição inválido.');
  end if;
  if c.status <> 'inscricoes' or (c.inscricoes_ate is not null and c.inscricoes_ate <= now())
     or (select status from public.arenas where id = c.arena_id) <> 'ativa' then
    perform private.arena_erro('status_invalido', 'As inscrições deste campeonato estão fechadas.');
  end if;
  select * into k from public.categories where id = nullif(p_dados ->> 'category_id', '')::uuid and championship_id = c.id;
  if not found then perform private.arena_erro('nao_encontrado', 'Categoria não encontrada.'); end if;
  if not k.inscricoes_abertas then
    perform private.arena_erro('status_invalido', 'As inscrições desta categoria estão fechadas.');
  end if;

  -- Uma inscrição por vez na categoria: a contagem de vagas não fura.
  perform pg_advisory_xact_lock(hashtextextended('bt8_arena_cat:' || k.id::text, 0));

  for i in 1..2 loop
    atl := p_dados -> ('atleta' || i);
    if char_length(trim(coalesce(atl ->> 'nome', ''))) not between 2 and 80
       or coalesce(atl ->> 'telefone', '') !~ '^\+[1-9][0-9]{7,14}$' then
      perform private.arena_erro('dados_invalidos', 'Nome e WhatsApp dos dois atletas são obrigatórios.');
    end if;
    select id into aid from public.athletes where arena_id = c.arena_id and telefone = atl ->> 'telefone';
    if aid is null then
      insert into public.athletes (arena_id, nome, telefone, consentimento_em, consentimento_versao)
      values (c.arena_id, trim(atl ->> 'nome'), atl ->> 'telefone', now(), left(p_dados ->> 'consentimento_versao', 20))
      returning id into aid;
    else
      update public.athletes set consentimento_em = now(), consentimento_versao = left(p_dados ->> 'consentimento_versao', 20)
      where id = aid;
    end if;
    if i = 1 then a1 := aid; else a2 := aid; end if;
  end loop;
  if a1 = a2 then perform private.arena_erro('dados_invalidos', 'Os dois atletas precisam ter WhatsApp diferentes.'); end if;

  select count(*) into ocupadas from public.teams where category_id = k.id and status in ('confirmada', 'pendente');
  tem_pix := jsonb_typeof(c.regras -> 'pix') = 'object';
  st := case when ocupadas >= k.max_duplas then 'espera' when tem_pix then 'pendente' else 'confirmada' end;
  pg := case when tem_pix then 'pendente' else 'nao_se_aplica' end;
  insert into public.teams (category_id, athlete1_id, athlete2_id, status, pagamento, origem)
  values (k.id, a1, a2, st, pg, 'link') returning id into tid;

  return jsonb_build_object('ok', true, 'team_id', tid, 'status', st, 'pagamento', pg, 'categoria', k.nome,
    'pix', case when tem_pix then c.regras -> 'pix' end,
    'whatsapp', coalesce(c.regras ->> 'whatsapp', (select whatsapp from public.arenas where id = c.arena_id)));
  exception when sqlstate 'P0001' or unique_violation then
    get stacked diagnostics v_msg = message_text, v_hint = pg_exception_hint;
    return jsonb_build_object('ok', false, 'erro', coalesce(nullif(v_hint, ''), 'dados_invalidos'),
      'mensagem', case when v_hint = '' then 'Não foi possível concluir a inscrição. Confira os dados.' else v_msg end);
  end;
end;
$$;

-- ══ Grants das funções ══════════════════════════════════════════════
-- O Supabase dá EXECUTE a anon/authenticated por padrão em funções novas: revogar e conceder explicitamente.
do $$
declare f text;
begin
  foreach f in array array[
    'private.arena_erro(text, text)', 'private.arena_exigir(uuid, text[])', 'private.arena_bump(uuid, boolean)',
    'private.arena_log(uuid, uuid, uuid, text, jsonb, text, uuid)', 'private.match_json(public.matches)',
    'private.match_alvo(public.matches)', 'private.placar_valido(int, int, int, int, int)',
    'private.dupla_ja_jogou(uuid)', 'private.match_propagar(public.matches, boolean)',
    'private.championship_guard()', 'private.arena_touch_estrutura()', 'private.team_guard()',
    'private.arena_member_guard()', 'private.match_lock(uuid, text[])', 'private.push_recusa(public.matches, uuid, int, boolean)',
    'private.grupo_fechado(public.matches)', 'private.team_lock(uuid, text[])', 'private.team_json(public.teams)',
    'private.campeonato_publico(text)', 'private.nome_dupla(uuid)',
    'public.arena_inscrever(text, text, jsonb, int)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;

  foreach f in array array[
    'public.match_take(uuid, uuid)', 'public.match_score_push(uuid, int, uuid, uuid, int, int, int, int)',
    'public.match_finish(uuid, int, text, uuid)', 'public.match_call(uuid, uuid)', 'public.match_start(uuid)',
    'public.match_suspend(uuid, text)', 'public.match_wo(uuid, text, text)',
    'public.match_set_result(uuid, int, int, int, int, boolean, text, boolean)',
    'public.team_checkin(uuid, int, boolean)', 'public.team_swap_athlete(uuid, int, uuid)',
    'public.team_substitute(uuid, uuid)', 'public.category_publish_draw(uuid, jsonb)',
    'public.group_close(uuid, jsonb)', 'public.category_seed_knockout(uuid, jsonb)',
    'public.championship_pause(uuid, text)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;

  foreach f in array array[
    'public.arena_live(text, bigint)', 'public.arena_public(text, bigint)', 'public.arena_inscricao_info(text)'
  ] loop
    execute format('revoke all on function %s from public', f);
    execute format('grant execute on function %s to anon, authenticated', f);
  end loop;
end $$;
grant execute on function public.arena_inscrever(text, text, jsonb, int) to service_role;
-- Triggers invoker (team_guard, arena_member_guard) chamam estes como o próprio cliente/Function.
grant usage on schema private to service_role;
grant execute on function private.arena_erro(text, text) to authenticated, service_role;
grant execute on function private.arena_da_categoria(uuid) to service_role;

-- ══ Registro ════════════════════════════════════════════════════════
insert into private.schema_migrations (version, name) values ('004', '004_arena.sql')
on conflict (version) do nothing;
