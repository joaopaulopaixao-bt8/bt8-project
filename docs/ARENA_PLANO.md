# Plano do Módulo Arena: campeonato de 11 e 12/12/2026 (versão final)

Arquiteto-chefe. Base: origin/main de 22/11/2026. O `npm test` roda `node --test "tests/*.test.js"`, e o build do Netlify executa `npm test && npm run build`. Na main ainda não existe a migração 003 (ela está no PR #12, que não foi mesclado). A migração da arena se chama **004** e **não depende da 003**.

---

## O que mudou após a crítica

**Aceitei:**
1. **Scout marca só games, não ponto a ponto.** Ele usa +1/−1 game por dupla, tie-break como placar numérico e o botão "Encerrar 6x4". O ponto a ponto sai do MVP. Com isso o scoring.js fica mais simples e a fila offline também: ela passa a guardar só o último placar, e não uma lista de eventos.
2. **"Puxar o próximo apto" substitui a fila fixa por quadra.** Existe uma fila global com prioridade, cobrindo todas as categorias. Quando uma quadra libera, o app sugere o primeiro jogo em que os 4 atletas estão presentes, livres e descansados. A Mesa confirma ou escolhe outro jogo. O `distribuirQuadras` sai do plano.
3. **Novo status `suspensa`** (guarda o placar parcial e volta à fila com prioridade máxima, podendo retomar em qualquer quadra) e **botão "Pausar evento"** (mostra "PAUSA – CHUVA" no telão e congela as previsões).
4. **Conta de capacidade em 24/11 com os números reais**, mais um **preset B de emergência** (até 4 games, tie-break no 4x4), já testado. Com placar por games, ele custa só um parâmetro.
5. **Correção de placar:** é livre até o grupo ser fechado. "Fechar grupo" exige confirmação do diretor de prova e marca o fim do prazo de protesto. No mata-mata existe o "forçar", que marca a partida seguinte com "origem alterada, revisar" em vez de recusar a correção.
6. **Trocar um atleta da dupla** até o primeiro jogo dela (o `team_id` continua o mesmo) e **"Substituir dupla"** desistente que ainda não jogou. A inscrição atrasada vai para a espera e só entra por substituição.
7. **Desistência e WO configuráveis por campeonato:** "anular todos os jogos" ou "manter os feitos e WO no restante", e também "WO conta 6x0 no saldo: sim/não". Os testes cobrem grupos de 3 e de 4.
8. **Melhores 2ºs** como cruzamento padrão quando o número de grupos não é 2, 4 ou 8, porque evita byes e rodadas extras. O dono confirma em 24/11, e só o modelo escolhido é implementado.
9. **Mesa e árbitro têm a palavra final.** Uma correção da Mesa aumenta a versão. O scout então vê "Placar ajustado pela Mesa: 4x3" e a fila local dele para aquela partida é descartada. Push em partida encerrada é recusado.
10. **`device_id` e "Assumir partida":** o push de um aparelho que perdeu a partida é recusado e a fila dele é descartada. O reserva sempre começa pelo placar do servidor.
11. **Duas chamadas públicas:** `arena_live` (quadras em jogo e chamadas, payload pequeno) e `arena_public` (estrutura, com `estrutura_version`, que só sobe quando uma partida termina ou o sorteio muda).
12. **A 004 vai para produção cedo (27/11), sem depender do PR #12.** O demo de 29/11 roda num Branch Deploy contra produção, com uma arena "TESTE" apagada depois.
13. **Sem convite/claim.** O gestor cria a conta do scout ou do árbitro já confirmada, por uma Function com service role, e o vínculo é gravado na hora. O refresh do token depois de 2 h offline entra no ensaio.
14. **Regulamento até 24/11:** foto do regulamento real ou, se não houver, uma página escrita pelo BT8, aprovada e publicada pela arena antes de abrir as inscrições.
15. **Cortes já agora:** ponto a ponto, card PNG (o pódio fica só em texto), métricas em `app_events` (saem por SQL depois do evento), chave gráfica no telão (vira lista), promoção da espera e importação com prévia sofisticada (vira colar uma dupla por linha). Passam a ser **3 agentes**.

**Recusei ou ajustei:**
- **"Encerrar dia":** recusado. No modelo de puxar o próximo apto não existe fila presa a um dia. O que não for jogado na sexta continua na fila global no sábado, e jogos `suspensa` já têm prioridade máxima.
- **Ponto a ponto "por flag, se ficar estável no ensaio":** recusado. Não há tempo para fazer e estabilizar dois modos. Fica para depois de 12/12.
- **004 em produção em 26/11:** ajustado para **sexta 27/11**. Quatro dias é o mínimo para escrever as tabelas, a RLS, as RPCs e o teste SQL com revisão. Ajustes posteriores entram numa **005**, nunca depois de 09/12.
- **Implementar só um modelo de desistência:** recusado. As duas opções são funções puras de poucas linhas no motor, testáveis, e o regulamento só chega em 24/11. Já para o cruzamento só um modelo é implementado, como a crítica sugeriu.

---

## 1. Resumo em 5 linhas

1. O Módulo Arena é uma conta de arena separada do Free/Pro pessoal. Nela gestor, árbitros e scouts trabalham sobre o mesmo campeonato, em tabelas próprias, com uma linha por partida e todas as mudanças de partida feitas por RPC.
2. Em 11 e 12/12 a arena terá: categorias de duplas, inscrição por link ou por lista colada, grupos de 3 ou 4 com cabeças de chave, desempate configurável, mata-mata automático (1ºA x 2ºB ou melhores 2ºs) e uma fila global em que a Mesa puxa o próximo jogo apto para cada quadra que libera.
3. O scout marca **games** no celular (1 set até 6 e tie-break a 7 no 6x6, ou o preset B de emergência), com fila offline que guarda só o último placar e "Assumir partida" para trocar de aparelho.
4. O telão e a página pública são só leitura, atualizados por polling sem Realtime. A Mesa de Controle chama, suspende, pausa, aplica WO, corrige, fecha grupo e gera o mata-mata.
5. Sem cobrança neste primeiro campeonato: a arena fica no plano "Arena Fundadora" gratuito, criado pelo admin do BT8.

---

## 2. Escopo

### MVP de dezembro (lista fechada)
1. Arena criada pelo admin do BT8, com o gestor definido pelo e-mail. A conta é criada ou vinculada na hora.
2. Equipe criada pelo gestor (nome, e-mail, senha inicial e papel: gestor, árbitro ou scout), já confirmada e vinculada.
3. Quadras da arena.
4. Campeonato com categorias de nome livre, limite de duplas e preset de jogo (A ou B de emergência), além das regras de desistência, WO no saldo e cruzamento.
5. Inscrição por link público, sem conta, com LGPD, honeypot, limite por IP e status `espera` quando a categoria lota.
6. Colar lista (uma dupla por linha, "Nome1 / Nome2", com telefones opcionais) e cadastro manual.
7. Painel de inscritos: editar, trocar atleta, mudar de categoria, cancelar, marcar Pix pago e abrir wa.me.
8. Sorteio dos grupos com semente salva, cabeças de chave e ajuste manual antes de publicar.
9. Jogos de grupo na ordem circular e classificação com o desempate oficial e as regras de WO e desistência configuradas.
10. Fechar grupo (o fim do prazo de protesto) e mata-mata de 4, 8 ou 16 com o cruzamento escolhido. O avanço é automático, e há correção com "forçar".
11. Trocar um atleta ou substituir a dupla depois do sorteio, até o primeiro jogo dela.
12. Check-in por atleta.
13. Mesa de Controle: próximo apto, chamar, iniciar, suspender, pausar evento, WO, lançar ou corrigir placar com motivo.
14. Scout por games: fila offline, "Assumir partida", indicador de rede e aviso quando a Mesa ajusta o placar.
15. Telão: quadras ao vivo, chamadas, rodízio com a classificação dos grupos e o mata-mata em lista, faixa de pausa e campeões em texto.
16. Página pública `/c/<slug>` com busca "meu nome", grupos, mata-mata em lista e resultados.
17. Exportação JSON/CSV e impressão de súmulas, grupos e chave em branco (plano B).
18. Conta de capacidade (tela e cálculo do motor).

### Fica para depois
- Ponto a ponto (sacador, ponto decisivo, troca de lado) e estatísticas de ponto.
- Cobrança da arena (Stripe por `arena_id`) e onboarding self-service.
- Melhor de 3 sets, jogo de 3º lugar, consolação, eliminatória pura e dupla eliminação.
- Validação de idade, nível ou gênero; ranking da arena; seed automático.
- Pagamento online da inscrição e QR Pix gerado.
- Convite com confirmação do parceiro, "procuro parceiro" e promoção automática da espera.
- Card PNG do campeão, pódio gráfico, chave gráfica, patrocinadores e overlay para OBS (este sobe de prioridade se houver live).
- Métricas em `app_events` (em dezembro, saem por SQL de `match_events`).
- Realtime no VPS, notificação por WhatsApp ou push, check-in por QR.
- Várias unidades por arena, papel de recepção.

---

## 3. Papéis e permissões

| Papel | Como entra | Pode | Não pode |
|---|---|---|---|
| Admin BT8 (`profiles.role='admin'`) | login atual | criar arena, definir plano e gestor, tudo nas arenas | — |
| Dono/Gestor | login + `arena_members.papel in ('dono','gestor')` | quadras, campeonatos, categorias, inscritos, sorteio, Mesa, corrigir (inclusive com "forçar"), fechar grupo, pausar, criar a equipe, trocar o token do link | promover-se a dono, mexer no plano |
| Árbitro | login + papel `arbitro` | tudo o que o scout pode, mais chamar, iniciar, suspender, WO, corrigir placar antes de fechar o grupo e check-in, em qualquer quadra | sorteio, inscrições, equipe, fechar grupo, "forçar" |
| Scout | login + papel `scout`; com esse papel apenas, o app abre direto em `/scout` | ver as partidas da arena, assumir partida, marcar games, encerrar (com confirmação) | qualquer escrita fora de `match_take`, `match_score_push` e `match_finish`; arenas alheias |
| Atleta | sem login | inscrever dupla pelo link, ver a página pública | ver telefone de terceiros |
| Público / Telão | sem login, pelo slug | ler nomes, placares, grupos, chave e chamadas | qualquer escrita; telefone e e-mail nunca aparecem |

Árbitro "sem app": um membro `arbitro` só com o nome, sem conta, usado para registro.

---

## 4. Fluxos principais

### 4.1 Arena, equipe e campeonato
1. O admin, em `/admin` (Function `admin-arena` com service role), cria a arena (nome, cidade, plano `fundadora`, `ativo_ate=2027-03-31`) e o gestor. Se o e-mail já tem conta, ela é vinculada; se não, a conta é criada já confirmada.
2. O gestor entra e o menu mostra "Minha arena". Ele cadastra as quadras, cria o campeonato (título, datas, horários, pausa de almoço, tolerância de WO, Pix opcional, WhatsApp, regras de desistência, WO no saldo, cruzamento e preset) e as categorias.
3. O gestor cria a equipe em "Equipe > Adicionar" (Function `arena-member`, que confere se quem chama é gestor da arena): nome, e-mail, senha inicial e papel. O vínculo é gravado na hora, e o gestor entrega o login ao scout pessoalmente.
4. A tela de regras mostra o regulamento resumido (desempate, WO, desistência, cruzamento), que é publicado na página pública antes de abrir as inscrições.

### 4.2 Inscrições
1. O gestor muda o status para `inscricoes` e copia o link `bt8.com.br/inscricao/<token>`.
2. O atleta escolhe a categoria (com as vagas restantes), informa nome e WhatsApp dele e do parceiro e marca o aceite da LGPD.
3. A Function `arena-register` valida e chama `private.arena_inscrever`, com advisory lock por categoria. A dupla entra como `confirmada`, `pendente` (quando há pagamento) ou `espera` (quando a categoria está cheia).
4. Confirmação: situação, Pix copia-e-cola e botão "Enviar comprovante" (wa.me da arena).
5. Em paralelo, o gestor cola a lista que já tem, uma dupla por linha. O app aponta linhas inválidas e duplicadas e grava com `origem='importacao'`.
6. O gestor marca os pagamentos, cancela duplas e fecha as inscrições até **08/12**.

### 4.3 Capacidade, grupos e chave
1. **Conta de capacidade** (motor `capacidade()`; a mesma tela roda em 24/11 com os números reais): total de jogos = soma, por categoria, dos jogos de grupo e do mata-mata. A capacidade por dia é quadras × horas úteis × 60 / (duração média + 5). Se a sobra for menor que 15%, aparece alerta vermelho com as opções: mais quadras, grupos de 3, preset B nos grupos ou começar mais cedo.
2. O gestor marca as cabeças de chave e toca em "Sortear". São `ceil(n/4)` grupos de 3 ou 4, montados em serpentina. A semente fica salva.
3. O gestor pode mover uma dupla e depois publica. `category_publish_draw` grava os grupos, os jogos de grupo e as partidas do mata-mata com as vagas ("1º Grupo A", "Melhor 2º nº1"), tudo atômico e só se nenhuma partida tiver começado. Refazer o sorteio é uma ação explícita, permitida antes do primeiro placar.

### 4.4 Fila global e "próximo apto"
1. Cada partida tem uma `prioridade`: suspensa primeiro, depois a fase (os jogos de grupo antes do mata-mata da mesma categoria), a rodada e por fim a ordem de publicação, intercalando categorias e grupos.
2. Quando uma quadra libera, a Mesa toca em "Próximo jogo". O motor `proximoApto(fila, presença, emJogo, descanso)` sugere o primeiro jogo com os 4 atletas presentes, nenhum em quadra e todos com o descanso mínimo cumprido. Se faltar algo, ele mostra o motivo ("Fulano jogando na Q3"). A Mesa confirma ou escolhe outro jogo da lista.
3. Previsão por partida ("~14h20"): uma estimativa simples pela posição na fila global dividida pelas quadras ativas, multiplicada pela duração média (35 + 5 min, ou a média real do dia depois de 5 jogos), pulando as pausas. Com o evento pausado, a previsão aparece congelada.

### 4.5 Dia do evento
1. **Credenciamento:** busca por nome e toggle por atleta. A dupla só fica apta com os dois presentes.
2. **Chamada:** `match_call(match, court)` grava a quadra e o `chamada_em`, e o telão mostra "CHAMADA: Quadra 2 – X x Y". A contagem de tolerância de WO começa na Mesa.
3. **Scout:** abre a quadra e toca em "Assumir partida" (grava o `device_id`). Marca +1/−1 game, e em 6x6 abre o campo de tie-break. Cada toque aplica o placar na hora e guarda o último snapshot na fila local. `match_score_push` envia com a versão esperada.
4. **Telão e página pública:** `arena_live(slug)` a cada 4 s no telão e 15 s na página (só com a aba visível). `arena_public(slug, estrutura_version)` a cada 30 s, respondendo `{changed:false}` quando nada mudou.
5. **WO:** a contagem fica vermelha quando a tolerância acaba. A Mesa ou o árbitro aplica o WO, nunca de forma automática.
6. **Suspender:** `match_suspend` (chuva, quadra interditada, atendimento médico) guarda o placar e devolve o jogo à fila com prioridade máxima. **Pausar evento:** `championship_pause(motivo)`, que mostra a faixa no telão.
7. **Fim de jogo:** o motor detecta o fim (6x≤4, 7x5, 7x6) e o scout confirma "6x4?". `match_finish` grava, e no mata-mata o vencedor entra na partida seguinte. A quadra fica livre para o próximo apto.
8. **Fechar grupo:** quando todos os jogos do grupo terminam, aparece "Grupo C pronto: fechar?". O gestor confirma junto com o diretor de prova (`group_close`), e se um empate precisar de sorteio, ele é registrado ali. Fechados todos os grupos da categoria, um toque em "Gerar mata-mata" (`category_seed_knockout`) preenche as vagas.
9. **Correção:** antes de fechar o grupo, `match_set_result` é livre (gestor ou árbitro, com motivo). No mata-mata, se a partida seguinte ainda não começou, o slot dela é limpo e preenchido de novo. Se já começou, só o gestor pode corrigir, com "forçar", e a partida seguinte ganha `alerta_origem=true` ("origem alterada, revisar"). Tudo fica em `match_events`.
10. **Troca e substituição:** `team_swap_athlete` e `team_substitute`, só enquanto a dupla não tiver jogado.
11. **Plano B permanente:** a Mesa lança o placar final de qualquer partida com `match_set_result`, sem depender do scout.

### 4.6 Encerramento
1. Final encerrada: o telão mostra em texto o campeão, o vice e os 3ºs da categoria.
2. O gestor exporta JSON/CSV, e o status muda para `encerrado`.
3. Depois do evento: SQL das métricas a partir de `match_events`, entrevista de 15 min com o gestor e NPS de 1 pergunta.

---

## 5. Regras de formato e pontuação (configuráveis por campeonato ou categoria)

| Item | Padrão do MVP | Configurável |
|---|---|---|
| Inscrição | duplas fixas; cada categoria é uma chave independente | o atleta pode estar em várias categorias, com aviso de conflito |
| Grupos | `g = ceil(n/4)`, tamanhos 3 ou 4 (8→4,4; 9→3,3,3; 10→4,3,3; 11→4,4,3; 13→4,3,3,3). Com menos de 6 duplas: grupo único e final entre 1º e 2º | tamanho preferido; mover dupla antes de publicar |
| Ordem no grupo de 4 | R1 1x4, 2x3; R2 1x3, 4x2; R3 1x2, 3x4 | — |
| Ordem no grupo de 3 | 2x3, 1x3, 1x2 | — |
| Classificados | 1º e 2º | 1 ou 2 por grupo |
| Desempate no grupo | 1) vitórias; 2) entre 2 duplas: confronto direto; 3) entre 3 ou mais: saldo de games entre as empatadas → saldo de games no grupo → games pró → sorteio registrado. Se o empate cair para 2 duplas, volta ao confronto direto | ordem visível na tela de grupos e no regulamento |
| Desistência no meio do grupo | **"anular todos os jogos da dupla"** | ou "manter os feitos e WO no restante" |
| WO no saldo | **WO conta 6x0** | ou "WO fora do saldo" (só a vitória conta) |
| WO duplo | partida anulada | — |
| Comparação entre grupos (melhor 2º) | aproveitamento (vitórias/jogos) → saldo médio por jogo → games pró por jogo → sorteio | — |
| Cruzamento | 2 grupos: 1A x 2B, 1B x 2A. 4 grupos: 1A x 2B, 1C x 2D, 1D x 2C, 1B x 2A. 8 grupos: chave de 16 pela ordem padrão de seeds. **3, 5, 6 ou 7 grupos: os 1ºs mais os melhores 2ºs** completam 4 ou 8 vagas (3→SF de 4; 5, 6 e 7→QF de 8). Os 1ºs são semeados pela comparação entre grupos, e há troca para evitar duelo do mesmo grupo antes da semi | alternativa "byes" só se o regulamento exigir (decisão em 24/11; só um modelo é implementado) |
| Jogo, preset A | 1 set até 6, tie-break a 7 (diferença de 2) no 6x6, em todas as fases. Placares válidos: 6x0–6x4, 7x5, 7x6 com o tie-break registrado | — |
| Jogo, preset B (emergência) | 1 set até 4, tie-break a 7 no 4x4. Válidos: 4x0–4x2, 5x3, 5x4 com o tie-break | acionável por categoria e por fase, antes da fase começar |
| Ponto decisivo | regra de quadra, sem registro no app (o scout só marca games) | — |
| 3º lugar | não há jogo; os dois semifinalistas ficam em 3º | — |
| WO por ausência | 6x0 com `wo=true` depois da tolerância (padrão 10 min) | tolerância |
| Desistência durante o jogo | completa o set para o vencedor, com a marca "desist." | — |
| Descanso mínimo | 15 min entre jogos do mesmo atleta (o "próximo apto" respeita; a Mesa pode furar) | sim |
| Fechar grupo | depois dele o placar vale como está (fim do prazo de protesto, que entra no regulamento) | — |

**Conflitos resolvidos:**
- Confronto direto antes do saldo, como nos regulamentos estaduais e da FPT.
- **Não reaproveitar `buildEliminatoria`** (tournament.js:610). É código morto e com 2 ou mais byes faz "null" avançar. A chave é reescrita em `championship.js`.
- Final em 1 set.

---

## 6. Modelo de dados e tempo real

A migração é `supabase/migrations/004_arena.sql`, no padrão da 002: idempotente, registrada em `private.schema_migrations`, com `touch_updated_at` e CHECK de tamanho `NOT VALID` em jsonb. Ela **não toca** `profiles`, `tournaments`, `app_events` nem os planos (o trigger `enforce_tournament_limits` e o limite de 1 MB bloqueariam a arena). Antes de aplicar, confirmar com `db-migrate.sh --dry-run` que aplicar a 004 antes da 003 funciona. Se o script exigir ordem, a 003 entra junto ou a arena é renumerada antes de subir.

| Tabela | Colunas principais |
|---|---|
| `arenas` | id, nome, slug, cidade, estado, owner_id, status ('ativa','suspensa'), plano default 'fundadora', ativo_ate, whatsapp |
| `arena_members` | id, arena_id, user_id null, email null, nome, papel ('dono','gestor','arbitro','scout'), ativo; unique(arena_id, user_id) |
| `courts` | id, arena_id, nome, ordem, ativa |
| `championships` | id, arena_id, titulo, slug unique, data_inicio, data_fim, status ('rascunho','inscricoes','em_andamento','encerrado'), inscricao_token unique (renovável), inscricoes_ate, regras jsonb (horários, pausas, tolerancia_wo, descanso, pix, duracao_media, desistencia_modo, wo_conta_saldo, cruzamento), pausado bool, pausa_motivo, live_version bigint, estrutura_version bigint, sorteio_semente |
| `categories` | id, championship_id, nome, genero (só aviso), max_duplas, formato jsonb {tam_grupo, classificam, preset_grupo, preset_mata}, inscricoes_abertas |
| `athletes` | id, arena_id, nome, telefone (E.164, null na importação), email null, user_id null, consentimento_em, consentimento_versao; unique parcial (arena_id, telefone) |
| `teams` | id, category_id, athlete1_id, athlete2_id, status ('pendente','confirmada','espera','cancelada'), pagamento ('nao_se_aplica','pendente','pago'), pago_em, seed, origem ('link','importacao','manual'), presente1, presente2, desistente_em; check(athlete1_id<>athlete2_id); atleta único por categoria (trigger) |
| `category_groups` | id, category_id, nome ('A'), ordem, fechado_em, fechado_por, sorteio_desempate jsonb |
| `group_teams` | group_id, team_id (PK composta) |
| `matches` | id, championship_id, category_id, fase ('grupo','r16','qf','sf','final'), group_id null, rodada, slot, team_a, team_b, origem_a/origem_b jsonb ({grupo,pos} \| {melhor2,n} \| {match}), next_match_id, next_slot, prioridade int, court_id null, status ('agendada','chamada','em_jogo','suspensa','encerrada','wo','anulada'), games_a, games_b, tb_a, tb_b, vencedor, wo, desistencia, alerta_origem bool, scout_device uuid, scout_user, chamada_em, iniciada_em, encerrada_em, version int, updated_by |
| `match_events` | id bigserial, championship_id, match_id null, team_id null, client_event_id uuid null, tipo ('placar','inicio','fim','wo','correcao','forcar','chamar','suspender','assumir','troca_atleta','substituicao','fechar_grupo','pausa'), dados jsonb, user_id, motivo, created_at; unique(match_id, client_event_id) |
| `private.arena_rate` | ip_hash, janela, n |

Índices: `matches(championship_id, status, prioridade)`, `matches(court_id)`, `teams(category_id, status)`, `athletes(arena_id)`.

**RLS e funções**
- Auxiliares em `private` (security definer stable): `arena_tem_papel(arena, papeis[])` (dá acesso também a quem passa em `is_admin()`), `arena_do_campeonato` e `arena_da_partida`.
- Leitura de tudo para qualquer membro da arena. Escrita direta em `courts`, `championships` (exceto as colunas de versão e pausa), `categories`, `athletes` e `teams` (antes do sorteio) só para dono ou gestor.
- **`matches`, `category_groups`, `group_teams` e `match_events`: nenhuma escrita direta.** Tudo passa por RPC.
- `arena_members`: escrita só pelas Functions `admin-arena` e `arena-member` (service role, que confere o papel de quem chama). Um trigger impede rebaixar o dono e mudar o próprio papel.
- **Nenhuma política para `anon`.**
- RPCs `security definer`. Todas conferem o papel, gravam em `match_events` e aumentam `live_version`; as marcadas com * aumentam também `estrutura_version`:
  - `match_take(match, device_id)`: scout ou árbitro assume a partida.
  - `match_score_push(match, expected_version, client_event_id, device_id, games_a, games_b, tb_a, tb_b)`: recusa se `device_id` ≠ `scout_device` ("outro aparelho assumiu") ou se a partida estiver encerrada; ignora `client_event_id` repetido; se a versão não bater, devolve `{conflict, version, placar, por}`. O banco valida limites e formato, não a regra do jogo.
  - `match_finish(match, version, vencedor)`*: valida o placar contra o preset (em SQL simples) e propaga para a partida seguinte.
  - `match_call(match, court)`, `match_start(match)`, `match_suspend(match, motivo)`, `match_wo(match, lado \| 'duplo', motivo)`*.
  - `match_set_result(match, games, tb, wo, motivo, forcar)`*: o gestor e o árbitro corrigem antes de `fechado_em`; depois do fechamento, nada. No mata-mata, com a seguinte já iniciada, só o gestor com `forcar=true`, o que marca `alerta_origem`.
  - `team_swap_athlete(team, posição, atleta)` e `team_substitute(team_antigo, team_novo)`: só se a dupla não tem partida iniciada.
  - `category_publish_draw(category, payload)`*, `group_close(group, sorteio)`*, `category_seed_knockout(category, slots)`*, `championship_pause(champ, motivo \| null)`.
  - `arena_live(slug)` (grant para anon): quadras com a partida em jogo ou chamada, placar, pausa e `live_version`.
  - `arena_public(slug, since_estrutura)` (grant para anon): grupos, classificação, mata-mata, resultados, fila com previsão e regulamento, ou `{changed:false}`. Nunca devolve telefone ou e-mail.
- `shortcut: o banco confia no placar enviado por scout autenticado da arena e valida só limites e o placar final do preset; recalcular a partir de match_events se o placar puder vir de fora da arena.`

**Tempo real: polling, não Realtime.** O Realtime está desligado no `docker-compose.bt8.yml`, e ligá-lo exige container, JWT, publication e websocket pelo Caddy, num VPS compartilhado, a 19 dias do evento. Conta corrigida: o `arena_live` traz no máximo umas 8 linhas (cerca de 2 KB), e o `arena_public` só traz a estrutura quando uma partida termina, umas 6 a 8 vezes por hora. No pico: 2 telões a cada 4 s, cerca de 50 celulares a cada 15 s e 6 a 8 scouts. São uns 5 req/s de `arena_live`, todos pequenos, o que é carga desprezível para o PostgREST. O plano B, se a página pública crescer, é uma Function `live` com `Netlify-CDN-Cache-Control: s-maxage=3` na frente do `arena_live`. O Realtime fica para depois de 12/12.

---

## 7. Telas

**Celular ou notebook da arena (gestor, árbitro)**
- *Minha arena*: campeonatos, quadras, equipe ("Adicionar": nome, e-mail, senha inicial, papel).
- *Campeonato*: dados, regras (horários, pausas, tolerância, Pix, desistência, WO no saldo, cruzamento, preset), regulamento resumido, categorias, "copiar link" e "trocar token".
- *Conta de capacidade*: jogos totais × capacidade por dia, sobra em % e alerta.
- *Inscritos* (aba por categoria): contadores, lista com ações (editar, trocar atleta, mudar de categoria, cancelar, pago, wa.me), "+ Inscrever dupla" e "Colar lista".
- *Sorteio*: cabeças de chave, sortear, mover dupla, publicar e refazer.
- *Grupos e chave*: classificação ao vivo com o desempate visível, "Fechar grupo" (confirmação dupla) e "Gerar mata-mata". Mata-mata em lista, com as partidas marcadas com alerta de origem.
- *Mesa de Controle* (notebook ou tablet, polling de 5 s): uma coluna por quadra com o jogo atual (placar, tempo, alerta acima de 1,5× a média, aparelho do scout) e o botão "Próximo jogo" (sugestão mais alternativas, com motivo de inaptidão). Faixa de alertas: tolerância de WO, quadra sem atualização há 10 min, grupo pronto, origem alterada. Botões "Pausar evento" e "Suspender". Ações a no máximo 2 toques.
- *Credenciamento*: busca, toggle por atleta e o contador "14/16 completas".
- *Exportar / Imprimir*: JSON/CSV e `@media print` (súmulas, grupos, chave em branco).
- *Admin BT8* (`/admin`): criar arena e o gestor.

**Celular do scout** (`/scout`)
- Lista de quadras com a partida chamada ou em jogo, e o botão "Assumir partida".
- Tela de jogo em retrato: as duas duplas com os games grandes, botões enormes de "+1 game" e "−1" menor embaixo. Em 6x6 (ou 4x4) abre o tie-break com +1/−1 por dupla. Indicador de rede: verde "enviado", âmbar "pendente", vermelho "sem rede há Xs". Wake Lock ativo.
- Tela de conflito: "Placar ajustado pela Mesa: 4x3. Continuar daqui". Tela "Outro aparelho assumiu esta partida".
- Fim: "Confirmar 6x4?" e depois volta à lista. Erro 401 mostra "Entre de novo" e mantém o placar pendente.

**Telão** (`/telao/<slug>`, sem login, TV 1920x1080)
- Grade 2x2 de quadras (com páginas acima de 4): "QUADRA 2 · Masculino B · Grupo C", duplas a 5 vh, games a 9 vh, "TIE-BREAK 5-4", selo AO VIVO, CHAMADA ou LIVRE.
- Rodapé com chamadas e próximos jogos. A cada 3 ciclos, 15 s de classificação de um grupo ou do mata-mata em lista. Campeões em texto ao fim de cada categoria. Faixa "PAUSA – <motivo>".
- "Atualizado há X s", com faixa amarela depois de 30 s. Recarrega a cada 2 h e quando sai versão nova. Botão de tela cheia, fundo escuro e alto contraste.

**Link público**
- `/inscricao/<token>`: formulário mínimo e confirmação com Pix e wa.me.
- `/c/<slug>`: busca "meu nome" (jogos, previsão, resultados), grupos, mata-mata em lista, campeões e regulamento. Rodapé "Feito com BT8".

Todo nome entra no HTML só por `escapeHtml()` ou `textContent`.

---

## 8. Plano de entrega

### 3 agentes, sem pisar nos mesmos arquivos

| Agente | Dono exclusivo de | Entrega |
|---|---|---|
| **A1 Backend** (caminho crítico) | `supabase/migrations/004_arena.sql`, `supabase/tests/004_arena_test.sql`, `netlify/functions/arena-register.js`, `admin-arena.js`, `arena-member.js`, `netlify.toml`, `src/js/legal-pages.js`, `docs/ARENA.md`, `scripts/simular-campeonato.js` | contrato no dia 1 (payloads das RPCs, `arena_live` e `arena_public`); tabelas, RLS e RPCs; Functions; rotas `/scout`, `/telao/*`, `/c/*`, `/inscricao/*`; texto da LGPD; simulação |
| **A2 Motor, depois Ao vivo** | `src/js/championship.js`, `src/js/scoring.js`, `tests/championship.test.js`, `tests/scoring.test.js`; depois `src/js/scout.js`, `telao.js`, `publico.js`, `src/css/telao.css` | Motor puro (UMD, sem DOM): `montarGrupos` (mulberry32), `jogosDoGrupo`, `classificarGrupo` (h2h, mini-tabela, desistência e WO configuráveis), `compararEntreGrupos`, `gerarChave` (2/4/8 grupos e melhores 2ºs), `avancar/limpar`, `validarPlacar(preset A/B)`, `proximoApto`, `preverHorarios`, `capacidade`, `parseListaInscritos`; `scoring.js` por games (+1/−1, tie-break, fim, `paraPlacarFinal`). Depois: scout com fila offline (localStorage com try/catch, só o último placar por partida, reenvio no `online`, no `visibilitychange` e a cada 5 s; 401 não descarta), telão, página pública e formulário de inscrição |
| **A3 Painel da arena** | `src/js/arena.js`, `src/js/arena-mesa.js`, `src/css/arena.css` + **commit de esqueleto** em `src/index.html` e `src/js/app.js` | Dia 1: esqueleto com seções vazias, `<script>` de todos os módulos novos e detecção de rota. Depois disso ninguém edita esses dois arquivos sem combinar. Em seguida: arena, equipe, quadras, campeonato, capacidade, inscritos, colar lista, sorteio, grupos e chave, Mesa, credenciamento, exportar e imprimir |

Cada PR é revisado e passa por `npm test` antes do merge. O contrato em `docs/ARENA.md` é revisado pelos três antes de codar.

### Cronograma (hoje é domingo, 22/11)

**Segunda 23 e terça 24/11:** perguntas enviadas ao dono (seção 11), com o pedido da foto do regulamento. A1 publica o contrato. A3 faz o esqueleto. A2 começa o motor pela `capacidade()`, e **a conta de capacidade com os números reais sai na terça 24/11**. Se a sobra for menor que 15%, a decisão com a arena é tomada na mesma semana.

**Semana de 23/11: base**
- A1: 004 no staging local com o teste SQL passando; `arena-register` e `arena-member` com teste. **Sexta 27/11: 004 em produção**, com `backup.sh` antes e `--dry-run`. As tabelas ficam vazias e protegidas pela RLS.
- A2: `championship.js` e `scoring.js` com testes (6 a 32 duplas; empate duplo, triplo e total; as duas regras de desistência; WO dentro e fora do saldo; melhores 2ºs com 3, 5, 6 e 7 grupos; sem duelo do mesmo grupo; correção que limpa o slot; preset A e B; `proximoApto` com atleta em duas categorias). Até quinta 26/11.
- A3: arena, equipe, quadras, campeonato, categorias, inscritos, colar lista, sorteio publicando.
- **Marco de demo, domingo 29/11:** o dono, no celular, num Branch Deploy apontado para produção, com a arena "TESTE": cria o campeonato e um scout, cola 16 duplas, sorteia, publica, vê grupos e chave, e o scout marca games numa partida que aparece no telão. A arena TESTE é apagada depois.

**Semana de 30/11: dia do evento**
- A3: Mesa (próximo apto, chamar, suspender, pausar, WO, corrigir com "forçar"), credenciamento, fechar grupo, gerar mata-mata, troca e substituição, exportar e imprimir.
- A2: scout completo (fila offline, conflito, assumir), telão com rodízio, página pública e formulário de inscrição.
- A1: ajustes como **005** se necessário, simulação (3 categorias, 6 quadras, 6 scouts virtuais, 10% de envios duplicados, 5% fora de ordem, 1 troca de aparelho, 1 correção forçada, 1 suspensão) e as consultas de métricas.
- **Link real de inscrição aberto até quarta 02/12** (ou lista importada).
- **Marco sábado 05/12:** simulação completa em produção (arena TESTE, apagada depois), teste de carga de 20 min de madrugada (com o OK do dono), teste com Slow 3G e modo avião em Android e iPhone, e refresh de token depois de 2 h offline.

**Semana de 07/12: ensaio e congelamento**
- **Segunda 07/12:** ensaio geral na arena (seção 9).
- **Terça 08/12:** correções do ensaio, fechamento das inscrições, sorteio e publicação.
- **Quarta 09/12, 20h: congelamento.** Tag `v-campeonato-2026-12`, id do deploy bom anotado no Netlify, nenhuma migração depois disso. Hotfix só se bloquear o evento, com aprovação do dono, testes e simulação passando. PRs de Stripe e landing ficam parados até 13/12.
- **Quinta 10/12:** impressões do plano B, backup com cópia para o D:, telão montado, login conferido em cada aparelho.
- **Sexta 11 e sábado 12/12:** evento.

**Regra de corte**, aplicada em ordem se um marco atrasar mais de 2 dias:
1. Sai o link público de inscrição; a arena cola a lista e cadastra à mão.
2. Sai a página pública; ficam o telão e a impressão.
3. O telão mostra só as quadras ao vivo, sem rodízio.
4. A sugestão do "próximo apto" vira uma lista simples de jogos agendados, com o aviso de atleta em quadra.

**Nunca se corta:** Mesa lançando placar final, grupos, desempate, fechar grupo, mata-mata, suspender e exportar/imprimir.

---

## 9. Testes, ensaio, plantão e plano B

**Testes automáticos**
- `npm test` com o motor e o scoring. O build do Netlify trava se falhar.
- `supabase/tests/004_arena_test.sql` com ROLLBACK, cobrindo:
  - scout da arena A não escreve na B;
  - ninguém faz UPDATE direto em `matches`;
  - versão velha dá conflito;
  - `client_event_id` repetido não duplica;
  - outro `device_id` é recusado;
  - push em partida encerrada é recusado;
  - anon não lê `athletes`;
  - `arena_live` e `arena_public` não devolvem telefone;
  - gestor não vira dono;
  - `match_finish` propaga;
  - correção depois de `group_close` é recusada;
  - "forçar" marca `alerta_origem`;
  - `team_swap_athlete` é recusado depois do primeiro jogo da dupla.
- Simulação: no fim, nenhuma partida sem placar, classificação igual à do motor puro, e `match_events` coerente com o placar.

**Ensaio geral (segunda 07/12, na arena):** de 8 a 16 duplas, 2 categorias com 1 atleta repetido, 2 a 4 quadras, scouts reais nos aparelhos deles, telão no equipamento do dia e a Mesa no notebook. Forçar de propósito: um WO, uma suspensão retomada em outra quadra, uma pausa geral, uma correção antes e outra depois de fechar o grupo (esta recusada), um "forçar" no mata-mata, uma troca de aparelho de scout e uma queda de 4G. Medir o sinal em cada quadra. Quem não fizer o ensaio não trabalha de scout no dia.

**Plantão**
- *Diretor de prova* (arena): decide chamadas, WO, protestos e o fechamento de grupo.
- *Operador de mesa BT8* (o João, no local): notebook carregado e celular com 4G.
- *Plantão técnico remoto*, das 07h ao fim: **precisa ser outra pessoa, com nome**, acesso SSH ao VPS e ao Netlify. Faz restart, rollback do deploy (menos de 1 min) e restauração de backup.
- *Scouts*: um por quadra, mais um reserva já logado.
- Monitor externo gratuito a cada 1 min em `bt8.com.br`, `api.bt8.com.br/auth/v1/health` e no `arena_live`.
- Roteiro de 1 página por incidente: VPS fora, Netlify fora, scout sem rede ou sem bateria, telão travado, chuva.

**Dados:** `backup.sh` na véspera com cópia para fora do VPS; backup de hora em hora das 07h às 23h em 11 e 12/12; exportação JSON/CSV ao fim de cada fase; uma restauração testada no staging local antes do evento.

**Plano B**
- *Acionamento:* scouts ou telão parados por mais de 10 min sem previsão de volta.
- *Na quadra:* súmulas impressas, e a Mesa mantém uma planilha espelho com as fórmulas de classificação.
- *Quando o sistema volta:* a Mesa lança os finais com `match_set_result`.
- *Infra:* roteador 4G de outra operadora para a Mesa e o telão, power banks, suspensão de tela desligada, extensão dedicada.

---

## 10. Cobrança da Arena

- **Lançamento:** plano "Arena Fundadora", gratuito até 31/03/2027, com desconto vitalício para quem entrar até lá. Sem limite no banco. `arenas.plano` só é alterado pelo admin ou pelo backend (regra 6).
- **Depois**, com 3 ou mais arenas interessadas, um modelo híbrido:
  - (a) **por campeonato:** cerca de R$ 3 a 5 por dupla inscrita;
  - (b) **mensal "Arena":** cerca de R$ 149 a 249 com campeonatos ilimitados, marca, patrocinadores e ranking da arena, com degrau acima de 4 quadras;
  - (c) alternativa: taxa paga pelo atleta na inscrição online, o que exige PSP com split.
- **Princípios:** nunca cobrar por scout ou árbitro; a assinatura fica ligada a `arenas.id` (`subscriptions.arena_id` e `metadata.arena_id` no webhook), nunca a `profiles.plan`.
- **Atenção:** os valores são hipóteses; não achei tabela pública de preço para arenas.

---

## 11. Perguntas ao dono (com padrão recomendado)

**O mínimo até terça 24/11** (sem isso a conta de capacidade e o motor ficam no escuro): perguntas 1, 2, 5 e 11.

1. **Qual arena, e-mail do gestor, quantas quadras e quais horários por dia?** Padrão: 4 quadras, das 8h às 20h, almoço das 12h às 13h.
2. **Quais categorias e quantas duplas em cada?** Padrão: até 4 categorias de até 16 duplas. Atenção: esse padrão dá cerca de 124 jogos para uns 132 de capacidade, com sobra de 6%. Se for isso mesmo, decidir já entre mais quadras, grupos de 3, preset B nos grupos ou começar às 7h.
3. **Formato de jogo?** Padrão: preset A (1 set até 6, tie-break a 7 no 6x6) em todas as fases. A arena aceita o preset B (até 4) como emergência em caso de chuva?
4. **Formato do campeonato?** Padrão: grupos de 3 ou 4, passam 2, sem jogo de 3º. Com 3, 5, 6 ou 7 grupos: **melhores 2ºs** (padrão) ou byes?
5. **Regulamento:** mandar foto do regulamento real ou do último campeonato da arena. Se não existir, o BT8 escreve 1 página com as regras da seção 5 para a arena aprovar. Pontos-chave: desempate, tolerância de WO (padrão 10 min), desistência (padrão: anular todos os jogos), WO no saldo (padrão: conta 6x0) e "fechar grupo encerra o prazo de protesto".
6. **Quem define os cabeças de chave?** Padrão: o gestor, à mão.
7. **Atleta pode jogar mais de uma categoria?** Padrão: sim, com aviso, e o "próximo apto" evita choque de horário.
8. **As inscrições já estão rolando no WhatsApp?** Padrão: colar a lista como caminho principal e usar o link público como complemento. A inscrição é paga? Padrão: Pix direto para a arena, com "pago" marcado à mão; a dupla pendente segura a vaga até 08/12. Há menores de 18? Padrão: não.
9. **Scouts e árbitros:** padrão de um scout por quadra, mais um reserva, com celular próprio e conta criada pelo gestor antes do ensaio. Árbitro: um árbitro geral, com jogos autoarbitrados.
10. **Telão e rede?** Padrão: notebook por HDMI numa TV coberta, Wi-Fi da arena e roteador 4G reserva. Vai ter live? Padrão: não; se tiver, o overlay para OBS sobe de prioridade.
11. **Quem faz o plantão técnico remoto em 11 e 12/12?** Sem padrão: precisa de um nome.
12. **Demo em 29/11, ensaio na arena em 07/12 e teste de carga de madrugada na semana de 30/11?** Padrão: sim para os três.
13. **A arena aceita virar case público?** Padrão: pedir no fim do evento.

Se não houver resposta até 24/11, valem os padrões, menos a pergunta 11.

---

## 12. Riscos principais e mitigação

| Risco | Mitigação |
|---|---|
| Prazo de 19 dias | escopo já cortado (ponto a ponto, card, métricas, chave gráfica), 3 agentes em arquivos separados, 004 em produção em 27/11, marcos em 29/11 e 05/12, regra de corte, congelamento em 09/12 |
| Capacidade estourar (padrão com sobra de 6%; chuva) | conta com números reais em 24/11, decisão antecipada, preset B testado, suspender e pausar, próximo apto sem fila fixa |
| Fila pré-calculada desatualizar no primeiro atraso | modelo de puxar o próximo apto com presença, quadra e descanso; a Mesa escolhe |
| Scout perder ponto e o telão mostrar placar errado | marcação só por games, snapshot completo a cada toque, a Mesa tem a palavra final e o scout vê o ajuste |
| Religar o `buildEliminatoria` com bug de bye | proibido; chave reescrita com testes de byes, melhores 2ºs e cruzamento |
| Desempate ou WO diferente do regulamento | regulamento até 24/11, regras configuráveis e testadas, visíveis na tela e na página pública |
| Correção depois do avanço de fase | correção livre até fechar o grupo, fechamento com confirmação do diretor, "forçar" com alerta no mata-mata, log com motivo |
| Troca de parceiro ou desistência depois do sorteio | `team_swap_athlete` e `team_substitute` até o primeiro jogo, espera para os atrasados |
| Dois aparelhos ou aparelho morto reenviando lixo | `scout_device` com "Assumir partida", versão esperada, `client_event_id`, push em partida encerrada recusado |
| Polling pesado com placar mudando sempre | `arena_live` pequeno separado da estrutura com `estrutura_version`; plano B com cache CDN de 3 s |
| 4G ruim na quadra | fila local do último placar, indicador de pendência, roteador 4G, teste em modo avião, a Mesa lança o final |
| VPS compartilhado lento ou fora | carga baixa, teste de carga antes, nada novo no compose antes de 12/12, monitor externo, plantão com SSH, plano B em papel com gatilho de 10 min |
| Branch Deploys gravam no banco de produção | só a arena TESTE, apagada depois; migração testada antes no staging local; backup antes de cada migração |
| 004 antes da 003 quebrar o `db-migrate.sh` | `--dry-run` em 26/11; se exigir ordem, a 003 sobe junto ou a arena é renumerada |
| Vazamento de telefone (LGPD) | nenhuma política para anon, público só pelas duas RPCs, teste SQL, logs sem corpo de requisição, aceite versionado |
| Robô enchendo categorias | honeypot, limite por hash de IP, token renovável, fechar inscrições, cancelar pelo painel |
| Login de scout falhar às 8h | conta criada pelo gestor já confirmada, sem claim, login testado no ensaio, aparelhos já logados, reserva, 401 mantendo o pendente |
| Service worker prendendo versão antiga | recarga automática ao mudar a versão, conferida em 10/12 |
| Deploy de última hora | congelamento com tag e rollback em 1 clique |
| Ninguém no plantão remoto | o nome é exigido em 24/11; sem nome, o risco vai por escrito ao dono |

---

Não abri o código, o PR #12 nem o `db-migrate.sh`. As referências de linha (tournament.js:549 e 610) vêm dos especialistas, e a ordem 004 antes da 003 precisa ser conferida com `--dry-run`.

O que o dono precisa saber primeiro: a capacidade padrão mal cabe em 2 dias (sobra de cerca de 6%), e o plantão remoto precisa de um nome até 24/11.
