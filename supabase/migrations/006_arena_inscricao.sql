-- BT8 - 006: inscrição da Arena com link de acompanhamento, comprovante no sistema e e-mails.
-- Contrato: docs/ARENA.md (seções 4.6, 4.7 e 5). Depende da 004. Idempotente. Aplicar numa transação só:
--   psql -v ON_ERROR_STOP=1 --single-transaction -f 006_arena_inscricao.sql
-- Teste: supabase/tests/006_arena_inscricao_test.sql.
--
-- Segurança:
-- - acompanhamento_token é o "login" da dupla na página /acompanhar/<token>. Nunca sai em arena_public,
--   arena_live nem arena_inscricao_info, e o select de teams não tem a coluna (grant por coluna): dono e
--   gestor obtêm ou trocam o link pela RPC arena_team_link.
-- - Token, comprovante e marca de e-mail não são alterados pelo cliente (trigger): só RPC e service role.
-- - Bucket "comprovantes" privado e sem policies: só a service role (Functions) lê e grava.

-- ══ Colunas ═════════════════════════════════════════════════════════

-- E-mail opcional do atleta (a coluna já existe desde a 004): formato conferido só nas linhas novas.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'athletes_email_formato') then
    alter table public.athletes add constraint athletes_email_formato
      check (email is null or email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') not valid;
  end if;
end $$;

alter table public.teams add column if not exists acompanhamento_token uuid not null default gen_random_uuid();
alter table public.teams add column if not exists comprovante_path text check (char_length(comprovante_path) <= 200);
alter table public.teams add column if not exists comprovante_enviado_em timestamptz;
alter table public.teams add column if not exists comprovante_status text not null default 'nenhum';
alter table public.teams add column if not exists comprovante_motivo text check (char_length(comprovante_motivo) <= 280);
alter table public.teams add column if not exists comprovante_envios int not null default 0;
alter table public.teams add column if not exists tabela_email_em timestamptz;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'teams_comprovante_status_chk') then
    alter table public.teams add constraint teams_comprovante_status_chk
      check (comprovante_status in ('nenhum', 'enviado', 'aceito', 'recusado'));
  end if;
end $$;
create unique index if not exists teams_acompanhamento_token_uidx on public.teams (acompanhamento_token);

-- Cliente (anon/authenticated) não escolhe nem muda token, comprovante e marca de e-mail.
-- Invoker de propósito, como team_guard: RPC security definer e service role passam.
create or replace function private.team_inscricao_guard()
returns trigger
language plpgsql
set search_path = public, private, pg_temp
as $$
begin
  if current_user in ('anon', 'authenticated') then
    if tg_op = 'INSERT' then
      new.acompanhamento_token := gen_random_uuid();
      new.comprovante_path := null;
      new.comprovante_enviado_em := null;
      new.comprovante_status := 'nenhum';
      new.comprovante_motivo := null;
      new.comprovante_envios := 0;
      new.tabela_email_em := null;
    else
      new.acompanhamento_token := old.acompanhamento_token;
      new.comprovante_path := old.comprovante_path;
      new.comprovante_enviado_em := old.comprovante_enviado_em;
      new.comprovante_status := old.comprovante_status;
      new.comprovante_motivo := old.comprovante_motivo;
      new.comprovante_envios := old.comprovante_envios;
      new.tabela_email_em := old.tabela_email_em;
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists teams_inscricao_guard on public.teams;
create trigger teams_inscricao_guard before insert or update on public.teams
for each row execute function private.team_inscricao_guard();

-- ══ Inscrição pública: aceita e-mail e devolve o token ══════════════
-- Mesma função da 004 (assinatura igual); muda: e-mail opcional por atleta e "token" na resposta.
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
  v_camp uuid;
  ocupadas int;
  st text;
  pg text;
  tid uuid;
  tok uuid;
  tem_pix boolean;
  i int;
  atl jsonb;
  aid uuid;
  v_email text;
  v_msg text;
  v_hint text;
begin
  delete from private.arena_rate where janela < now() - interval '2 days';
  insert into private.arena_rate (ip_hash, janela, n) values (coalesce(p_ip_hash, 'sem-ip'), date_trunc('hour', now()), 1)
  on conflict (ip_hash, janela) do update set n = private.arena_rate.n + 1
  returning n into tentativas;
  if tentativas > p_limite_hora then
    return jsonb_build_object('ok', false, 'erro', 'limite', 'mensagem', 'Muitas tentativas deste endereço. Tente de novo mais tarde.');
  end if;
  -- Limite por campeonato (60 tentativas por hora, de qualquer IP): segura robô com muitos IPs e o disparo de e-mails.
  select id into v_camp from public.championships where inscricao_token = p_token;
  if v_camp is not null then
    insert into private.arena_rate (ip_hash, janela, n) values ('camp:' || v_camp, date_trunc('hour', now()), 1)
    on conflict (ip_hash, janela) do update set n = private.arena_rate.n + 1
    returning n into tentativas;
    if tentativas > 60 then
      return jsonb_build_object('ok', false, 'erro', 'limite', 'mensagem', 'Muitas inscrições neste campeonato agora. Tente de novo em alguns minutos.');
    end if;
  end if;

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

  perform pg_advisory_xact_lock(hashtextextended('bt8_arena_cat:' || k.id::text, 0));

  for i in 1..2 loop
    atl := p_dados -> ('atleta' || i);
    if char_length(trim(coalesce(atl ->> 'nome', ''))) not between 2 and 80
       or coalesce(atl ->> 'telefone', '') !~ '^\+[1-9][0-9]{7,14}$' then
      perform private.arena_erro('dados_invalidos', 'Nome e WhatsApp dos dois atletas são obrigatórios.');
    end if;
    v_email := lower(nullif(trim(coalesce(atl ->> 'email', '')), ''));
    if v_email is not null and (char_length(v_email) > 254 or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') then
      perform private.arena_erro('dados_invalidos', format('E-mail do atleta %s inválido.', i));
    end if;
    select id into aid from public.athletes where arena_id = c.arena_id and telefone = atl ->> 'telefone';
    if aid is null then
      insert into public.athletes (arena_id, nome, telefone, email, consentimento_em, consentimento_versao)
      values (c.arena_id, trim(atl ->> 'nome'), atl ->> 'telefone', v_email, now(), left(p_dados ->> 'consentimento_versao', 20))
      returning id into aid;
    else
      update public.athletes set consentimento_em = now(), consentimento_versao = left(p_dados ->> 'consentimento_versao', 20),
        email = coalesce(email, v_email) -- inscrição pública só preenche e-mail vazio: não desvia os avisos de quem já tem
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
  values (k.id, a1, a2, st, pg, 'link') returning id, acompanhamento_token into tid, tok;

  return jsonb_build_object('ok', true, 'team_id', tid, 'token', tok, 'status', st, 'pagamento', pg, 'categoria', k.nome,
    'pix', case when tem_pix then c.regras -> 'pix' end,
    'whatsapp', coalesce(c.regras ->> 'whatsapp', (select whatsapp from public.arenas where id = c.arena_id)));
  exception when sqlstate 'P0001' or unique_violation then
    get stacked diagnostics v_msg = message_text, v_hint = pg_exception_hint;
    return jsonb_build_object('ok', false, 'erro', coalesce(nullif(v_hint, ''), 'dados_invalidos'),
      'mensagem', case when v_hint = '' then 'Não foi possível concluir a inscrição. Confira os dados.' else v_msg end);
  end;
end;
$$;

-- ══ Acompanhamento público (/acompanhar/<token>) ════════════════════
-- Só o necessário para a dupla: nunca telefone, e-mail, user_id, caminho do comprovante nem o token do link.
create or replace function public.arena_inscricao_status(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, private, pg_temp
as $$
declare
  t public.teams;
  k public.categories;
  c public.championships;
  a public.arenas;
  g public.category_groups;
begin
  if coalesce(p_token, '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return jsonb_build_object('ok', false, 'erro', 'nao_encontrado');
  end if;
  select * into t from public.teams where acompanhamento_token = p_token::uuid;
  if not found then return jsonb_build_object('ok', false, 'erro', 'nao_encontrado'); end if;
  select * into k from public.categories where id = t.category_id;
  select * into c from public.championships where id = k.championship_id;
  select * into a from public.arenas where id = c.arena_id;
  select g2.* into g from public.category_groups g2 join public.group_teams gt on gt.group_id = g2.id where gt.team_id = t.id;
  return jsonb_build_object(
    'ok', true,
    'arena', jsonb_build_object('nome', a.nome, 'cidade', a.cidade, 'estado', a.estado),
    'championship', jsonb_build_object('titulo', c.titulo, 'slug', c.slug, 'status', c.status,
      'data_inicio', c.data_inicio, 'data_fim', c.data_fim),
    'categoria', jsonb_build_object('nome', k.nome),
    'dupla', (select jsonb_build_object('id', t.id, 'nome', a1.nome || ' / ' || a2.nome, 'atleta1', a1.nome, 'atleta2', a2.nome)
              from public.athletes a1, public.athletes a2 where a1.id = t.athlete1_id and a2.id = t.athlete2_id),
    'status', t.status, 'pagamento', t.pagamento, 'pago_em', t.pago_em,
    'pix', case when t.pagamento = 'pendente' and t.status = 'pendente' and jsonb_typeof(c.regras -> 'pix') = 'object'
                then c.regras -> 'pix' end,
    'whatsapp', coalesce(c.regras ->> 'whatsapp', a.whatsapp),
    'comprovante', jsonb_build_object('status', t.comprovante_status, 'motivo', t.comprovante_motivo,
      'enviado_em', t.comprovante_enviado_em, 'envios_restantes', greatest(5 - t.comprovante_envios, 0)),
    'grupo', case when g.id is null then null else jsonb_build_object('nome', g.nome, 'fechado', g.fechado_em is not null) end,
    'jogos', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', m.id, 'fase', m.fase, 'rodada', m.rodada, 'status', m.status,
        'adversario', private.nome_dupla(case when m.team_a = t.id then m.team_b else m.team_a end),
        'quadra', q.nome, 'chamada_em', m.chamada_em, 'iniciada_em', m.iniciada_em, 'encerrada_em', m.encerrada_em,
        'games_nos', case when m.team_a = t.id then m.games_a else m.games_b end,
        'games_eles', case when m.team_a = t.id then m.games_b else m.games_a end,
        'tb_nos', case when m.team_a = t.id then m.tb_a else m.tb_b end,
        'tb_eles', case when m.team_a = t.id then m.tb_b else m.tb_a end,
        'resultado', case when m.vencedor is null then null when m.vencedor = t.id then 'vitoria' else 'derrota' end,
        'wo', m.wo) order by m.prioridade, m.rodada, m.slot)
      from public.matches m left join public.courts q on q.id = m.court_id
      where m.team_a = t.id or m.team_b = t.id), '[]'::jsonb));
end;
$$;

-- ══ Só service role (Functions) ═════════════════════════════════════

-- Reserva um envio de comprovante pelo token (antes do upload): no máximo p_limite por dupla,
-- só com pagamento pendente e comprovante ainda não aceito. Recusa sem erro HTTP, como arena_inscrever.
create or replace function public.arena_comprovante_reservar(p_token text, p_limite int default 5)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare t public.teams;
begin
  if coalesce(p_token, '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return jsonb_build_object('ok', false, 'erro', 'nao_encontrado', 'mensagem', 'Link de acompanhamento inválido.');
  end if;
  select * into t from public.teams where acompanhamento_token = p_token::uuid for update;
  if not found then
    return jsonb_build_object('ok', false, 'erro', 'nao_encontrado', 'mensagem', 'Link de acompanhamento inválido.');
  end if;
  if t.status <> 'pendente' or t.pagamento <> 'pendente' or t.comprovante_status = 'aceito' then
    return jsonb_build_object('ok', false, 'erro', 'status_invalido', 'mensagem', 'Esta inscrição não está aguardando pagamento.');
  end if;
  if t.comprovante_envios >= p_limite then
    return jsonb_build_object('ok', false, 'erro', 'limite',
      'mensagem', 'Limite de envios de comprovante atingido. Fale com a arena pelo WhatsApp.');
  end if;
  update public.teams set comprovante_envios = comprovante_envios + 1 where id = t.id;
  return jsonb_build_object('ok', true, 'team_id', t.id, 'path_anterior', t.comprovante_path);
end;
$$;

-- Tudo que as Functions precisam para autorizar e montar e-mails de uma dupla (inclui e-mails: nunca
-- devolver isto ao navegador).
create or replace function public.arena_inscricao_contexto(p_team uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, private, pg_temp
as $$
  select jsonb_build_object(
    'team_id', t.id, 'token', t.acompanhamento_token, 'status', t.status, 'pagamento', t.pagamento,
    'comprovante_status', t.comprovante_status, 'comprovante_motivo', t.comprovante_motivo,
    'comprovante_path', t.comprovante_path, 'tabela_email_em', t.tabela_email_em,
    'category_id', k.id, 'categoria', k.nome, 'campeonato', c.titulo, 'slug', c.slug,
    'arena_id', a.id, 'arena', a.nome,
    'pix', case when jsonb_typeof(c.regras -> 'pix') = 'object' then c.regras -> 'pix' end,
    'whatsapp', coalesce(c.regras ->> 'whatsapp', a.whatsapp),
    'dupla', a1.nome || ' / ' || a2.nome,
    'atletas', jsonb_build_array(jsonb_build_object('nome', a1.nome, 'email', a1.email),
                                 jsonb_build_object('nome', a2.nome, 'email', a2.email)),
    'gestores', coalesce((select jsonb_agg(distinct m.email) from public.arena_members m
                          where m.arena_id = a.id and m.ativo and m.papel in ('dono', 'gestor') and m.email is not null),
                         '[]'::jsonb))
  from public.teams t
  join public.categories k on k.id = t.category_id
  join public.championships c on c.id = k.championship_id
  join public.arenas a on a.id = c.arena_id
  join public.athletes a1 on a1.id = t.athlete1_id
  join public.athletes a2 on a2.id = t.athlete2_id
  where t.id = p_team;
$$;

-- Link de acompanhamento para dono/gestor (o token não é legível pelo select de teams), com opção de
-- gerar um novo se vazou (o antigo para de funcionar na hora).
create or replace function public.arena_team_link(p_team uuid, p_novo boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare tok uuid;
begin
  perform private.arena_exigir(private.arena_da_categoria((select category_id from public.teams where id = p_team)), '{dono,gestor}');
  if p_novo then
    update public.teams set acompanhamento_token = gen_random_uuid() where id = p_team returning acompanhamento_token into tok;
  else
    select acompanhamento_token into tok from public.teams where id = p_team;
  end if;
  return jsonb_build_object('ok', true, 'token', tok);
end;
$$;

-- Sorteio refeito ou dupla substituída: a dupla volta a poder receber o e-mail de "tabela publicada".
create or replace function private.group_teams_reset_email()
returns trigger
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
begin
  update public.teams set tabela_email_em = null where id = new.team_id and tabela_email_em is not null;
  return null;
end;
$$;
drop trigger if exists group_teams_reset_email on public.group_teams;
create trigger group_teams_reset_email after insert or update of team_id on public.group_teams
for each row execute function private.group_teams_reset_email();

-- Token fora da leitura de árbitro/scout (e do painel): select por coluna, sem acompanhamento_token.
revoke select on public.teams from authenticated;
grant select (id, category_id, athlete1_id, athlete2_id, status, pagamento, pago_em, seed, origem, presente1, presente2,
  desistente_em, observacao, created_at, updated_at, comprovante_path, comprovante_enviado_em, comprovante_status,
  comprovante_motivo, comprovante_envios, tabela_email_em) on public.teams to authenticated;

-- ══ Grants ══════════════════════════════════════════════════════════
revoke all on function private.team_inscricao_guard() from public, anon, authenticated;
revoke all on function private.group_teams_reset_email() from public, anon, authenticated;
revoke all on function public.arena_team_link(uuid, boolean) from public, anon;
grant execute on function public.arena_team_link(uuid, boolean) to authenticated;
revoke all on function public.arena_inscrever(text, text, jsonb, int) from public, anon, authenticated;
revoke all on function public.arena_comprovante_reservar(text, int) from public, anon, authenticated;
revoke all on function public.arena_inscricao_contexto(uuid) from public, anon, authenticated;
revoke all on function public.arena_inscricao_status(text) from public;
grant execute on function public.arena_inscricao_status(text) to anon, authenticated;
grant execute on function public.arena_inscrever(text, text, jsonb, int) to service_role;
grant execute on function public.arena_comprovante_reservar(text, int) to service_role;
grant execute on function public.arena_inscricao_contexto(uuid) to service_role;

-- ══ Storage: bucket privado "comprovantes" ══════════════════════════
-- Sem policies: só a service role acessa. Se o Storage ainda não estiver ligado (schema ausente), a
-- migração segue e o bucket é criado depois com o mesmo insert (docs/SUPABASE_VPS.md).
do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('comprovantes', 'comprovantes', false, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
    on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
  else
    raise notice 'Schema storage ausente: bucket "comprovantes" não criado (ver docs/SUPABASE_VPS.md).';
  end if;
end $$;

-- ══ Registro ════════════════════════════════════════════════════════
insert into private.schema_migrations (version, name) values ('006', '006_arena_inscricao.sql')
on conflict (version) do nothing;
