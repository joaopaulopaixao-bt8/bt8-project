# Módulo Arena: contrato do backend

Fonte da verdade do plano: [`docs/ARENA_PLANO.md`](ARENA_PLANO.md). Este arquivo é o **contrato** entre o backend (A1), o motor/scout/telão/público (A2) e o painel da arena (A3). Mudança de assinatura ou de payload só entra aqui primeiro, num PR revisado pelos três.

Migração: `supabase/migrations/004_arena.sql` (idempotente, registrada em `private.schema_migrations`, não depende da 003). Teste: `supabase/tests/004_arena_test.sql`.

## 1. Convenções

- Todas as RPCs ficam em `public`, são `security definer` com `search_path` fixo e são chamadas pelo PostgREST: `POST /rest/v1/rpc/<nome>` com JSON de argumentos **nomeados** (`{"p_match": "..."}`), ou `supabase.rpc('<nome>', {...})`.
- Todas devolvem `jsonb`. Sucesso: `{"ok": true, ...}`.
- **Recusa de regra de negócio** vira erro do PostgREST (HTTP 400) com `message` em português (mostrar ao usuário) e `hint` com um código estável (usar no código):

| `hint` | Quando |
|---|---|
| `sem_permissao` | o usuário não tem o papel exigido nesta arena (errcode 42501) |
| `nao_encontrado` | partida, dupla, grupo, categoria ou campeonato inexistente |
| `status_invalido` | a ação não vale no status atual da partida/campeonato |
| `placar_invalido` | placar fora do preset, fora dos limites ou vencedor que não bate |
| `grupo_fechado` | correção depois de `group_close` |
| `proxima_iniciada` | correção no mata-mata com a partida seguinte já iniciada, sem `p_forcar` |
| `dupla_ja_jogou` | troca/substituição depois do primeiro jogo da dupla |
| `sorteio_iniciado` | publicar/refazer sorteio com partida já começada |
| `grupos_abertos` | gerar mata-mata com grupo ainda aberto |
| `motivo_obrigatorio` | correção, suspensão ou WO sem motivo |
| `dados_invalidos` | payload malformado |

- Exceção: `match_score_push` e `match_finish` **não** dão erro para conflito, outro aparelho ou partida encerrada; devolvem `{"ok": false, "erro": ...}` (ver 4.2), para a fila offline do scout tratar tudo num caminho só.
- Objeto **partida** (`match`) devolvido pelas RPCs de partida:

```json
{ "id": "uuid", "category_id": "uuid", "fase": "grupo", "group_id": "uuid|null", "rodada": 1, "slot": 1,
  "team_a": "uuid|null", "team_b": "uuid|null", "court_id": "uuid|null", "status": "em_jogo",
  "games_a": 3, "games_b": 2, "tb_a": null, "tb_b": null, "vencedor": "uuid|null",
  "wo": false, "desistencia": false, "alerta_origem": false, "scout_device": "uuid|null",
  "chamada_em": "ts|null", "iniciada_em": "ts|null", "encerrada_em": "ts|null", "version": 7 }
```

## 2. Status

| Entidade | Valores |
|---|---|
| `arenas.status` | `ativa`, `suspensa` |
| `arena_members.papel` | `dono`, `gestor`, `arbitro`, `scout` |
| `championships.status` | `rascunho` → `inscricoes` → `em_andamento` → `encerrado` (só `rascunho` fica fora da página pública) |
| `teams.status` | `pendente` (aguardando pagamento), `confirmada`, `espera` (categoria lotada), `cancelada` |
| `teams.pagamento` | `nao_se_aplica`, `pendente`, `pago` |
| `teams.origem` | `link`, `importacao`, `manual` |
| `matches.fase` | `grupo`, `r16`, `qf`, `sf`, `final` |
| `matches.status` | `agendada` → `chamada` → `em_jogo` → `encerrada`; `suspensa` (volta à fila com prioridade máxima); `wo` (WO simples, tem vencedor); `anulada` (WO duplo) |

Transições de partida:

```
agendada ──match_call──> chamada ──match_start / 1º push──> em_jogo ──match_finish──> encerrada
   │                      │  ▲                                  │
   │                      │  └──────match_call (retoma)─── suspensa <──match_suspend──┘ (também de chamada)
   └── match_wo / match_set_result (de qualquer status não final) ──> wo | anulada | encerrada
```

Fila global (para o "próximo apto"): partidas `agendada` ou `suspensa` com as duas duplas definidas, ordenadas por `status = 'suspensa'` primeiro e depois `prioridade` crescente. A `prioridade` vem do motor no `category_publish_draw`.

## 3. Tabelas (leitura direta pelo PostgREST)

Membros ativos da arena (qualquer papel) e o admin do BT8 leem tudo da arena por `select`. `anon` não tem acesso a nenhuma tabela.

| Tabela | Colunas | Escrita direta (dono/gestor) |
|---|---|---|
| `arenas` | id, nome, slug, cidade, estado, owner_id, status, plano (`fundadora`), ativo_ate, whatsapp | nenhuma (só `admin-arena`) |
| `arena_members` | id, arena_id, user_id, email, nome, papel, ativo | nenhuma (só `admin-arena` e `arena-member`) |
| `courts` | id, arena_id, nome, ordem, ativa | sim |
| `championships` | id, arena_id, titulo, slug, data_inicio, data_fim, status, inscricao_token, inscricoes_ate, regras, pausado, pausa_motivo, pausado_em, live_version, estrutura_version | sim, menos `live_version`, `estrutura_version`, `pausado`, `pausa_motivo`, `pausado_em`, `arena_id` (o banco preserva) |
| `categories` | id, championship_id, nome, genero, max_duplas, formato, inscricoes_abertas, sorteio_semente, ordem | sim (`sorteio_semente` é gravada pelo sorteio) |
| `athletes` | id, arena_id, nome, telefone (E.164 ou null), email, user_id, consentimento_em, consentimento_versao | sim |
| `teams` | id, category_id, athlete1_id, athlete2_id, status, pagamento, pago_em, seed, origem, presente1, presente2, desistente_em, observacao | sim; depois do sorteio publicado, `athlete1_id`, `athlete2_id` e `category_id` só mudam por RPC |
| `category_groups` | id, category_id, nome, ordem, fechado_em, fechado_por, sorteio_desempate | nenhuma (RPC) |
| `group_teams` | group_id, team_id | nenhuma (RPC) |
| `matches` | ver objeto partida + championship_id, origem_a, origem_b, next_match_id, next_slot, prioridade, scout_user, updated_by, updated_at | nenhuma (RPC) |
| `match_events` | id, championship_id, match_id, team_id, client_event_id, tipo, dados, user_id, motivo, created_at | nenhuma (RPC) |

Regras que o banco garante: atleta não pode estar em duas duplas ativas (não canceladas) da mesma categoria; `athlete1_id <> athlete2_id`; telefone único por arena; o dono da arena não é rebaixado, desativado nem apagado; só `arenas.owner_id` pode ter papel `dono`.

`championships.estrutura_version` sobe sozinho quando o gestor altera campeonato, categoria, dupla, atleta ou quadra (e nas RPCs marcadas com \*). `live_version` sobe em toda RPC de partida.

### `championships.regras` (jsonb, até 32 KB; o banco só guarda, o padrão é aplicado pelo front/motor)

```json
{ "dias": [{ "data": "2026-12-11", "inicio": "08:00", "fim": "20:00", "pausas": [{ "inicio": "12:00", "fim": "13:00" }] }],
  "tolerancia_wo_min": 10, "descanso_min": 15, "duracao_media_min": 35, "intervalo_min": 5,
  "desistencia_modo": "anular",        // ou "manter_wo"
  "wo_conta_saldo": true,
  "cruzamento": "melhores2",           // ou "byes"
  "preset": "A",                       // "A" (até 6) ou "B" (até 4)
  "pix": { "chave": "...", "favorecido": "...", "valor": 120.00 },   // ou null: inscrição sem pagamento
  "whatsapp": "+5581999999999",
  "regulamento": "texto publicado na página pública" }
```

### `categories.formato` (jsonb, até 4 KB)

`{ "tam_grupo": 4, "classificam": 2, "preset_grupo": "A", "preset_mata": "A" }`. `match_finish` e `match_set_result` validam o placar pelo preset da fase (`preset_grupo` para `grupo`, `preset_mata` para o resto; padrão `A`).

Presets: **A** = 6x0 a 6x4, 7x5, 7x6 com tie-break; **B** = 4x0 a 4x2, 5x3, 5x4 com tie-break. Tie-break válido: vencedor com 7 ou mais e diferença de 2 ou mais. WO = alvo x 0 (6x0 no A, 4x0 no B).

## 4. RPCs

Papéis: **G** = dono ou gestor; **Á** = árbitro, gestor ou dono; **S** = scout, árbitro, gestor ou dono. O admin do BT8 passa em todas. \* = aumenta também `estrutura_version`.

### 4.1 `match_take(p_match uuid, p_device uuid)` — S

Assume a partida neste aparelho (grava `scout_device`, `scout_user`; `version` + 1). Vale em `agendada`, `chamada`, `em_jogo`. Devolve `{"ok": true, "match": {...}}`. O aparelho que perdeu a partida passa a receber `erro: "outro_aparelho"` e deve descartar a fila local dela. O reserva sempre começa pelo placar do servidor (o `match` devolvido).

### 4.2 `match_score_push(p_match uuid, p_expected_version int, p_client_event_id uuid, p_device uuid, p_games_a int, p_games_b int, p_tb_a int, p_tb_b int)` — S

Envia o **snapshot completo** do placar (não um delta). `p_tb_a`/`p_tb_b` são `null` fora do tie-break. Limites do banco: games 0 a 7, tie-break 0 a 50. O primeiro push numa partida `chamada` passa ela para `em_jogo`.

Respostas:

```json
{ "ok": true, "match": {...} }                                   // gravado, version + 1
{ "ok": true, "duplicado": true, "match": {...} }                // client_event_id já recebido: nada muda
{ "ok": false, "erro": "conflito", "version": 9,
  "placar": { "games_a": 4, "games_b": 3, "tb_a": null, "tb_b": null },
  "por": "mesa", "match": {...} }                                // versão esperada ≠ atual; "por": "mesa" ou "scout"
{ "ok": false, "erro": "outro_aparelho", "match": {...} }        // p_device ≠ scout_device (ou ninguém assumiu)
{ "ok": false, "erro": "partida_encerrada", "match": {...} }     // encerrada, wo ou anulada
{ "ok": false, "erro": "partida_indisponivel", "match": {...} }  // agendada ou suspensa: precisa ser chamada de novo
```

No `conflito` com `por: "mesa"`, o scout mostra "Placar ajustado pela Mesa: 4x3" e continua a partir do `match` devolvido.

### 4.3 `match_finish(p_match uuid, p_version int, p_vencedor text, p_device uuid default null)` — S \*

`p_vencedor` = `'a'` ou `'b'`. Valida o placar atual contra o preset da fase e se o vencedor bate. Grava `encerrada` e, no mata-mata, coloca o vencedor no slot da partida seguinte. Se quem chama só tem papel de scout, `p_device` precisa ser o `scout_device`. Respostas: `{"ok": true, "match": {...}}` ou as mesmas recusas `{"ok": false, "erro": "conflito" | "outro_aparelho" | "partida_encerrada" | "partida_indisponivel"}` do push. Placar inválido dá erro `placar_invalido`.

### 4.4 Mesa

| RPC | Papel | Efeito |
|---|---|---|
| `match_call(p_match uuid, p_court uuid)` | Á | `agendada`/`suspensa`/`chamada` → `chamada`, grava quadra e `chamada_em`. Exige as duas duplas. Não recusa quadra ocupada (a Mesa pode chamar o próximo antes do anterior acabar). |
| `match_start(p_match uuid)` | Á | `chamada` → `em_jogo`, grava `iniciada_em`. |
| `match_suspend(p_match uuid, p_motivo text)` | Á | `chamada`/`em_jogo` → `suspensa`; guarda o placar, solta a quadra e o aparelho. Volta à fila com prioridade máxima. |
| `match_wo(p_match uuid, p_ausente text, p_motivo text)` \* | Á | `p_ausente` = `'a'`, `'b'` ou `'duplo'` (quem **não** compareceu). Simples: `wo`, placar alvo x 0 para o presente, propaga no mata-mata. Duplo: `anulada`, sem vencedor. Recusa em grupo fechado. |
| `match_set_result(p_match uuid, p_games_a int, p_games_b int, p_tb_a int, p_tb_b int, p_wo boolean, p_motivo text, p_forcar boolean default false)` \* | Á (forçar: G) | Lança ou corrige o placar final de qualquer partida (plano B). Motivo obrigatório. Grupo fechado: recusa (`grupo_fechado`). Mata-mata: se a seguinte não começou, troca o slot dela; se começou, só G com `p_forcar = true`, que troca o slot e marca `alerta_origem = true` na seguinte (não propaga em cascata). Grava `correcao` ou `forcar` em `match_events` com `{antes, depois}`. |
| `team_checkin(p_team uuid, p_posicao int, p_presente boolean)` | Á | Marca `presente1`/`presente2` (posição 1 ou 2). |
| `championship_pause(p_championship uuid, p_motivo text)` | G | Com motivo: pausa o evento (telão mostra "PAUSA – motivo"). Com `null`: retoma. |

Todas devolvem `{"ok": true, "match": {...}}` (ou `{"ok": true, "team": {...}}` / `{"ok": true, "pausado": bool}`).

### 4.5 Duplas, sorteio e chave (G)

**`team_swap_athlete(p_team uuid, p_posicao int, p_athlete uuid)`** \* — troca o atleta 1 ou 2 da dupla (o `team_id` não muda). Recusa (`dupla_ja_jogou`) se a dupla tem partida iniciada, suspensa ou encerrada.

**`team_substitute(p_team_antigo uuid, p_team_novo uuid)`** \* — a dupla nova (mesma categoria, fora de qualquer grupo, normalmente `espera`) entra no lugar da antiga em `group_teams` e nas partidas; a antiga vira `cancelada`, a nova `confirmada`. Mesma recusa.

**`category_publish_draw(p_category uuid, p_payload jsonb)`** \* — grava grupos, jogos de grupo e o mata-mata com as vagas, numa transação. Se já havia sorteio e nenhuma partida da categoria começou, apaga e regrava (refazer). Recusa `sorteio_iniciado` se alguma partida tem placar ou saiu de `agendada`.

```json
{ "semente": "texto da semente (mulberry32)",
  "grupos": [ { "nome": "A", "ordem": 1, "duplas": ["team-uuid", "team-uuid", "team-uuid", "team-uuid"] } ],
  "partidas": [
    { "ref": "A1", "fase": "grupo", "grupo": "A", "rodada": 1, "slot": 1,
      "team_a": "team-uuid", "team_b": "team-uuid", "prioridade": 10 },
    { "ref": "QF1", "fase": "qf", "rodada": 1, "slot": 1,
      "origem_a": { "grupo": "A", "pos": 1 }, "origem_b": { "grupo": "B", "pos": 2 },
      "next_ref": "SF1", "next_slot": "a", "prioridade": 1000 },
    { "ref": "SF1", "fase": "sf", "rodada": 1, "slot": 1,
      "origem_a": { "match_ref": "QF1" }, "origem_b": { "match_ref": "QF2" },
      "next_ref": "F", "next_slot": "a", "prioridade": 2000 },
    { "ref": "F", "fase": "final", "rodada": 1, "slot": 1,
      "origem_a": { "match_ref": "SF1" }, "origem_b": { "match_ref": "SF2" }, "prioridade": 3000 }
  ] }
```

Regras: as duplas dos grupos são da categoria, não estão `cancelada` nem `espera`, e cada uma aparece em um grupo só. Partida de grupo tem `team_a` e `team_b` do mesmo grupo. Partidas de mata-mata nascem sem duplas. `origem` é guardada como veio, com `match_ref` trocado por `{"match": "<uuid>"}`. Formatos de origem: `{grupo, pos}`, `{melhor2: n}`, `{match}`. Devolve `{"ok": true, "grupos": n, "partidas": n}`.

**`group_close(p_group uuid, p_sorteio jsonb default null)`** \* — exige todas as partidas do grupo em `encerrada`, `wo` ou `anulada`. Grava `fechado_em`, `fechado_por` e o sorteio de desempate (`{"ordem": ["team-uuid", ...], "observacao": "..."}`), se houve. Depois disso nenhuma correção no grupo.

**`category_seed_knockout(p_category uuid, p_slots jsonb)`** \* — exige todos os grupos da categoria fechados. `p_slots` = `[{"match": "uuid", "slot": "a", "team": "team-uuid"}, ...]`, calculado pelo motor (`gerarChave`). Só preenche partidas de mata-mata ainda não iniciadas. Devolve `{"ok": true, "preenchidos": n}`.

### 4.6 Públicas (anon e authenticated)

**`arena_live(p_slug text, p_since bigint default null)`** — telão (4 s) e página pública (15 s, só com a aba visível). `p_slug` é o slug do **campeonato**. Se `p_since = live_version`, devolve só `{"ok": true, "changed": false, "live_version": n, "estrutura_version": n}`.

```json
{ "ok": true, "changed": true, "server_time": "ts",
  "championship": { "id": "uuid", "titulo": "...", "slug": "...", "status": "em_andamento",
                    "pausado": false, "pausa_motivo": null, "live_version": 42, "estrutura_version": 7 },
  "quadras": [ { "id": "uuid", "nome": "Quadra 1", "ordem": 1, "ativa": true } ],
  "partidas": [ { "id": "uuid", "court_id": "uuid", "status": "em_jogo", "categoria": "Masculino B",
                  "fase": "grupo", "grupo": "C", "rodada": 2,
                  "team_a": { "id": "uuid", "nome": "Ana / Bia" }, "team_b": { "id": "uuid", "nome": "Cris / Duda" },
                  "games_a": 4, "games_b": 3, "tb_a": null, "tb_b": null,
                  "chamada_em": "ts", "iniciada_em": "ts", "version": 12 } ] }
```

`partidas` traz só `chamada` e `em_jogo`. Campeonato inexistente, em `rascunho` ou arena suspensa: `{"ok": false, "erro": "nao_encontrado"}`.

**`arena_public(p_slug text, p_since_estrutura bigint default null)`** — página pública e rodízio do telão (30 s). Se `p_since_estrutura = estrutura_version`: `{"ok": true, "changed": false, ...versões}`. Senão:

```json
{ "ok": true, "changed": true,
  "arena": { "nome": "...", "cidade": "...", "estado": "PE" },
  "championship": { "id", "titulo", "slug", "status", "data_inicio", "data_fim", "inscricoes_ate",
                    "pausado", "pausa_motivo", "live_version", "estrutura_version",
                    "regras": { "dias", "tolerancia_wo_min", "descanso_min", "duracao_media_min", "intervalo_min",
                                "desistencia_modo", "wo_conta_saldo", "cruzamento", "preset", "regulamento" } },
  "quadras": [ { "id", "nome", "ordem", "ativa" } ],
  "categorias": [ { "id", "nome", "genero", "max_duplas", "formato", "ordem" } ],
  "duplas": [ { "id", "category_id", "nome": "Ana / Bia", "atleta1": "Ana", "atleta2": "Bia",
                "status": "confirmada", "seed": 1, "desistente": false } ],
  "grupos": [ { "id", "category_id", "nome": "A", "ordem": 1, "fechado": true, "duplas": ["uuid"], "sorteio_desempate": null } ],
  "partidas": [ { "id", "category_id", "fase", "group_id", "rodada", "slot", "team_a", "team_b",
                  "origem_a", "origem_b", "next_match_id", "next_slot", "prioridade", "court_id", "status",
                  "games_a", "games_b", "tb_a", "tb_b", "vencedor", "wo", "desistencia",
                  "chamada_em", "iniciada_em", "encerrada_em" } ] }
```

`duplas` traz só `confirmada` e `pendente`. **Classificação, desempate, previsão de horário e campeões são calculados no cliente pelo motor (`championship.js`) a partir de `partidas`**; o banco não duplica a regra. Nunca há telefone, e-mail, `user_id`, token de inscrição nem Pix nesta resposta (o teste SQL confere).

**`arena_inscricao_info(p_token text)`** — formulário `/inscricao/<token>`:

```json
{ "ok": true, "arena": { "nome": "..." },
  "championship": { "titulo", "slug", "data_inicio", "data_fim", "inscricoes_ate", "status",
                    "aberto": true, "pix": { "chave", "favorecido", "valor" } | null, "whatsapp": "+55..." },
  "categorias": [ { "id", "nome", "genero", "max_duplas", "inscritas": 10, "vagas": 6, "inscricoes_abertas": true } ] }
```

`aberto` = status `inscricoes` e antes de `inscricoes_ate`. Token inválido: `{"ok": false, "erro": "nao_encontrado"}`.

### 4.7 Só service role

**`arena_inscrever(p_token text, p_ip_hash text, p_dados jsonb, p_limite_hora int default 10)`** — usada só pela Function `arena-register`. Limite por hash de IP por hora, advisory lock por categoria, atleta reaproveitado pelo telefone na arena. Status final: `espera` se a categoria lotou (`confirmada + pendente >= max_duplas`), senão `pendente` se o campeonato tem Pix, senão `confirmada`.

## 5. Netlify Functions

Todas: `POST`, JSON, CORS igual às atuais, erros `{"error": "mensagem em português"}`. Admin e membro exigem `Authorization: Bearer <access_token do Supabase>`.

### `POST /.netlify/functions/admin-arena` (só `profiles.role = 'admin'`)

```json
{ "arena": { "nome": "Arena X", "slug": "arena-x", "cidade": "Recife", "estado": "PE",
             "whatsapp": "+5581...", "plano": "fundadora", "ativo_ate": "2027-03-31" },
  "gestor": { "nome": "Fulano", "email": "gestor@x.com", "senha": "senha-inicial" } }
```

Se o e-mail já tem conta, vincula (a senha é ignorada); senão cria a conta já confirmada (senha obrigatória, 8+ caracteres). Grava a arena com `owner_id` e o membro `dono`. Resposta `201 {"ok": true, "arena": {...}, "gestor": {"user_id", "email", "conta_criada": true}}`. Erros: 401, 403, 400 (dados), 409 (slug já existe).

### `POST /.netlify/functions/arena-member` (dono ou gestor da arena, ou admin)

Criar:

```json
{ "acao": "criar", "arena_id": "uuid", "nome": "Scout Q1", "email": "scout1@x.com", "senha": "senha-inicial",
  "papel": "scout" }
```

`papel` = `gestor`, `arbitro` ou `scout` (nunca `dono`). Árbitro sem app: `{"acao": "criar", "arena_id", "nome", "papel": "arbitro", "sem_conta": true}` (sem e-mail e senha). E-mail com conta existente é vinculado; senão a conta nasce confirmada. Resposta `201 {"ok": true, "member": {...}, "conta_criada": bool}`; `409` se já é da equipe.

Atualizar: `{"acao": "atualizar", "arena_id", "member_id", "papel"?, "ativo"?, "nome"?}`. Recusa mexer no dono e no próprio papel.

### `POST /.netlify/functions/arena-register` (público, sem login)

```json
{ "token": "inscricao_token", "categoria_id": "uuid",
  "atleta1": { "nome": "Ana Souza", "telefone": "(81) 99999-0000" },
  "atleta2": { "nome": "Bia Lima", "telefone": "81988887777" },
  "lgpd": true, "lgpd_versao": "2026-11-22", "website": "" }
```

`website` é o honeypot (campo escondido; preenchido = robô, recebe um falso sucesso). Telefone é normalizado para E.164 (`+55` quando vier com DDD). `lgpd_versao` precisa ser a versão atual (`BT8_ARENA_LGPD_VERSAO` em `src/js/legal-pages.js`, mesma de `netlify/functions/lib/arena.js`). Resposta `200 {"ok": true, "team_id", "status": "confirmada|pendente|espera", "pagamento", "categoria", "pix", "whatsapp"}`. Erros: 400 (dados, inscrições fechadas, atleta já inscrito na categoria), 429 (muitas tentativas), 404 (token).

## 6. Rotas do front (`netlify.toml` → `/index.html`)

| Rota | Quem | Dono da tela |
|---|---|---|
| `/arena`, `/arena/*` | gestor, árbitro | A3 |
| `/scout`, `/scout/*` | scout (o app abre direto aqui quando o único papel é `scout`) | A2 |
| `/telao/<slug>` | TV, sem login | A2 |
| `/c/<slug>` | público, sem login | A2 |
| `/inscricao/<token>` | atleta, sem login | A2 |
| `/admin` (já existe) | admin BT8 (criar arena) | A3 |

## 7. LGPD da inscrição

Texto e versão em `src/js/legal-pages.js`: `BT8_ARENA_LGPD_VERSAO` e `arenaLgpdHtml(nomeArena)` (HTML pronto, nomes já escapados). O formulário mostra o texto, exige o aceite e envia `lgpd_versao`. O banco guarda `consentimento_em` e `consentimento_versao` em `athletes`.

## 8. Operação

- Aplicar no staging local: `docker exec -i supabase_db_bt8 psql -U postgres -d postgres -v ON_ERROR_STOP=1 --single-transaction -f - < supabase/migrations/004_arena.sql`, depois o teste: `... -f - < supabase/tests/004_arena_test.sql`.
- Simulação completa (seção 8 do plano) contra o staging local: `node scripts/simular-campeonato.js` (`--manter` deixa a arena para ver o telão; `--semente=N` repete a mesma sequência). Precisa do motor em `src/js/championship.js`. Fora de localhost só com `--remoto`, para a arena TESTE.
- Apagar uma arena de teste (como `postgres`, apaga tudo em cascata): `delete from public.arenas where slug = 'teste';`
- Métricas depois do evento: SQL sobre `match_events` (tipos: `placar`, `inicio`, `fim`, `wo`, `correcao`, `forcar`, `chamar`, `suspender`, `assumir`, `troca_atleta`, `substituicao`, `fechar_grupo`, `pausa`, `sorteio`, `mata_mata`, `checkin`).
