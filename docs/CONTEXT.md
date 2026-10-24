# BT8 — Beach Tennis Tournament Manager
## Contexto completo para Claude Code

> Última revisão: 2026-10-24 — reflete o código da `main` em `9c3fa43` (30/04/2026), após o merge do MVP pago.

---

## O que é o BT8

PWA (Progressive Web App) de gerenciamento de torneios de beach tennis, com planos Free/Pro pagos via Stripe. O frontend roda no navegador (HTML/CSS/JS vanilla); a lógica sensível (limites de visitante, checkout, webhook, admin, exclusão de conta) roda em **Netlify Functions**. Hospedado em **https://bt8.com.br** via **Netlify**. Banco e autenticação via **Supabase**.

---

## Stack atual

| Camada | Tecnologia |
|--------|-----------|
| Frontend | `src/index.html` + `src/css/*` + `src/js/*` + `src/img/*` |
| PWA | `public/manifest.json` + `public/sw.js` (Service Worker) |
| Build | `npm run build` → `scripts/build-netlify.js` (gera `dist/` e `dist/js/env.js`) |
| Hosting | Netlify conectado ao GitHub (`netlify.toml`, publish `dist`) |
| Backend | Netlify Functions em `netlify/functions/` |
| Auth | Supabase Auth (Google OAuth + Email/Senha + Recuperação de senha) |
| Banco | Supabase (PostgreSQL) — schema em `supabase/migrations/001_paid_mvp_staging.sql` |
| Pagamentos | Stripe (Checkout + Webhook) |
| Share card | Canvas API → PNG 1080×1920px |

### Arquivos JS (`src/js/`)

| Arquivo | Responsabilidade |
|---------|-----------------|
| `env.js` | Config pública (`window.BT8_ENV`) — sobrescrito no build |
| `config.js` | Constantes globais (inclui `ADMIN_EMAIL`) |
| `auth.js` | Cliente Supabase, login Google/email, retorno OAuth, landing de login |
| `access.js` | Planos (visitante/Free/Pro/Admin), limites, checkout, modal de planos |
| `app.js` | Navegação, menu, perfil, exclusão de conta, `trackEvent`, Admin |
| `tournament.js` | Geração e execução dos torneios, ranking |
| `history.js` | Salvar/listar/abrir torneios do usuário |
| `share.js` | Card PNG de compartilhamento |
| `landing-commercial.js` | Landing comercial (`/bt8`) |
| `legal-pages.js` | Termos, privacidade, direitos do sistema |

---

## Ambientes e Supabase

A configuração pública vem de `window.BT8_ENV`, gerado no build a partir das variáveis do Netlify:

| Variável | Uso |
|----------|-----|
| `BT8_APP_ENV` | `production` / `staging` |
| `BT8_SUPABASE_URL` | URL do projeto Supabase |
| `BT8_SUPABASE_ANON_KEY` | Publishable/anon key (pública) |
| `BT8_STRIPE_PUBLISHABLE_KEY` | Opcional no front |

Fallback no código (`src/js/env.js`, `src/js/auth.js`, `scripts/build-netlify.js`): projeto **`srrbnjgixizsjxobvsma`** (`https://srrbnjgixizsjxobvsma.supabase.co`). O commit `9c3fa43` passou a usá-lo como fallback de produção.

> ✅ **Produção confirmada (2026-10-24)**: o bt8.com.br usa o projeto **`srrbnjgixizsjxobvsma`**. Ele nasceu como `bt8-staging` durante o MVP pago e foi promovido a produção. O projeto antigo `znifpitysqfbepjymtmg` não é mais usado pelo código.
>
> Consequência: hoje os Branch Deploys também apontam para esse mesmo projeto (ver `netlify.toml`), ou seja, **não há banco de staging separado** — testes em branch gravam no banco de produção.

`netlify.toml` força o projeto `srrbnjgixizsjxobvsma` nos contextos `branch-deploy` e `mvp-pago`.

### Tabelas (ver `supabase/migrations/001_paid_mvp_staging.sql`)

#### `profiles` (colunas em português)
```sql
id                  uuid PK references auth.users(id)  -- = auth.uid()
email, nome, telefone, data_nascimento date, sexo ('M'|'F'|'O'),
cidade, estado, avatar_url, provider
plan                text  'free' | 'pro'      (default 'free')
role                text  'user' | 'admin'    (default 'user')
pro_until           timestamptz
stripe_customer_id  text
subscription_status text
created_at, updated_at
```

#### `tournaments`
`id, user_id, mode, category, title, players jsonb, standings jsonb, state jsonb, created_at, updated_at`

#### `subscriptions`
`id, user_id, stripe_customer_id, stripe_subscription_id, stripe_payment_intent_id, plan_type ('recurring'|'one_time_30d'), status, price_id, current_period_end, metadata jsonb, created_at, updated_at`

#### `guest_usage` (somente backend, sem policies)
`id, guest_id, ip_hash, user_agent_hash, month_key, tournaments_created, first_seen_at, last_seen_at`

#### `app_events`
`id, user_id, guest_id, event_type, metadata jsonb, created_at`

### Triggers e funções
- `private.handle_new_user()` + trigger `on_auth_user_created` em `auth.users`: insere em `profiles (id, email, nome, provider)` usando as colunas corretas em português.
- `profiles_protect_billing_fields`: impede o usuário de alterar `plan`, `role`, `pro_until` etc. pelo front.
- `touch_updated_at` em `profiles`, `tournaments`, `subscriptions`.
- `private.is_admin()`: `profiles.role = 'admin'` para `auth.uid()`.

### RLS
- `profiles`: usuário lê/edita o próprio registro (campos limitados); admin lê todos.
- `tournaments`: CRUD apenas do próprio usuário; admin lê.
- `subscriptions`: usuário lê as próprias; admin lê todas. Escrita só via backend.
- `app_events`: qualquer um insere (`user_id` nulo ou = `auth.uid()`); só admin lê.
- `guest_usage`: sem policies — acesso apenas com service role.

---

## Netlify Functions (`netlify/functions/`)

| Função | O que faz |
|--------|-----------|
| `guest-usage` | Valida/registra o limite mensal do visitante (hash de IP/UA, sem IP puro) |
| `create-checkout` | Cria sessão Stripe (Pro Mensal ou Pro 30 Dias; agenda mensal após `pro_until`) |
| `stripe-webhook` | Recebe eventos do Stripe e atualiza `profiles`/`subscriptions` |
| `manage-subscription` | Cancela a recorrência no fim do período |
| `admin-dashboard` | Dados do painel Admin (valida `role = admin` com service role) |
| `delete-account` | Exclui a conta do usuário (e dados/assinatura vinculados) |

Variáveis secretas (escopo Functions, nunca no front/GitHub): `BT8_SUPABASE_SERVICE_ROLE_KEY`, `BT8_STRIPE_SECRET_KEY`, `BT8_STRIPE_WEBHOOK_SECRET`, `BT8_GUEST_USAGE_HASH_SECRET`, `BT8_STRIPE_PRO_MONTHLY_PRICE_ID`, `BT8_STRIPE_PRO_30D_PRICE_ID` (opcional `BT8_STRIPE_API_VERSION`). As funções também aceitam os nomes sem o prefixo `BT8_`.

---

## Planos e acesso (`src/js/access.js`)

| Perfil | Regra |
|--------|-------|
| Visitante | 1 torneio/mês sem login (validado por `guest-usage`), não salva histórico |
| Free | Logado, salva até `FREE_MONTHLY_TOURNAMENT_LIMIT = 3` torneios/mês |
| Pro Mensal | R$ 6,90/mês recorrente, ilimitado; cancelamento mantém Pro até o fim do período |
| Pro 30 Dias | R$ 14,90 pagamento único; volta para Free depois; histórico permanece |
| Admin | `profiles.role = 'admin'` (fallback no front: `ADMIN_EMAIL`); checkout bloqueado |

O plano só é ativado pelo webhook/backend — nunca diretamente no front.

---

## Rotas

Definidas em `netlify.toml` (todas servem `index.html`) e detectadas via JS:

| Rota | Tela |
|------|------|
| `/` | Landing/app |
| `/bt8` | Landing comercial com planos |
| `/admin` | Login e painel Admin dedicados |
| `/reset-password` | Redefinição de senha |
| `/termos-de-uso`, `/politica-de-privacidade`, `/direitos-do-sistema` | Páginas legais |

`public/_redirects` tem o fallback SPA `/* /index.html 200`.

---

## Telas do app (screens)

| ID | Nome | Descrição |
|----|------|-----------|
| `screen-home` | Home | Topbar com logo, botão de usuário, botão novo torneio, histórico |
| `screen-tipo` | Tipo | Seleção de categoria (Individual / Duplas) |
| `screen-config` | Configurar | Cadastro de jogadores/duplas, seleção de formato |
| `screen-torneio` | Torneio | Rodadas, placar, ranking ao vivo |
| `screen-resultado` | Resultado Final | Pódio, ranking completo |

### Modais
- **Auth** (`#auth-modal`): Login Google + Email/Senha + Recuperação de senha
- **Perfil** (`#profile-modal`): edição de perfil, avatar, estado/cidade, exclusão de conta
- **Planos**: comparação e checkout (`openPlansModal()`)
- **Share** (`#share-modal`): geração e compartilhamento do card PNG
- **Admin** (criado dinamicamente): abas visão geral, usuários, assinaturas, torneios, eventos

---

## Modos de torneio (APP.mode)

| Código | Nome | Descrição |
|--------|------|-----------|
| `s4` | Super 4 | 4 jogadores, duplas rotativas, 3 rodadas, 0 descanso |
| `s6` | Super 6 | 6 jogadores, 1 quadra/rodada, descansa 2x |
| `s8` | Super 8 | 8 jogadores, 2 quadras, 7 rodadas, todos os pares |
| `s8x` | Super 8 Soma X | Igual S8 mas ranking por soma de games |
| `s12` | Super 12 | 12 jogadores, 3 quadras, 11 rodadas |
| `mista` | Super Mista | H+M rotativos, ranking individual |
| `df` | Duplas Fixas | Duplas manuais, Round Robin, bye automático |
| `dm` | Duplas Mistas | 1H+1M obrigatório, Round Robin |
| `da` | Duplas Aleatórias | Sorteio automático, par→RR, ímpar→chaves |

### Flags de controle
```js
const IS_DUPLA_FIXA     = { df:true, dm:true, da:true };
const IS_MISTA_DUPLA    = { dm:true };
const IS_ALEATORIO      = { da:true };
const IS_MISTA_ROTATIVA = { mista:true };
const IS_SOMA           = { s8x:true };
```

---

## Estado global do app

```js
const APP = {
  category: null,   // 'individual' | 'duplas'
  mode: null,       // 's4','s6','s8','s8x','s12','mista','df','dm','da'
  fmt: null,        // 'rr' (round robin) | 'elim' (eliminatória)
  players: [],      // array de { name, gender }
  rounds: [],       // rodadas geradas
  matches: [],      // partidas da rodada atual
  isGuest: false,   // visitante sem login
  // ... outros campos dependendo do modo
}
```

---

## Funções principais (JS)

### Autenticação (`auth.js`)
- `initSupabase()` / `handleAuthStateChange(user)`
- `loginWithGoogle()` — OAuth; no retorno, `consumeOAuthHashSession()` e `cleanSensitiveAuthHash()` restauram a sessão e limpam o token da URL, depois `enterApp()`
- `doLogin()` / `doSignup()` / `doForgot()` / `saveNewPassword()` — email/senha
- `startWithoutLogin()` — modo visitante
- `logoutUser()`

### Acesso e planos (`access.js`)
- `refreshAccess()` / `currentAccess()` / `normalizeAccess()` — calcula visitante, Free, Pro ativo, Pro expirado, Admin
- `validateGuestTournamentLimit()` / `validateFreeSaveLimit()`
- `openPlansModal()` / `startCheckout()` / `cancelRecurringSubscription()` / `handleCheckoutReturn()`

### Perfil (`app.js`)
- `openProfileModal()` / `loadProfile()` / `saveProfile()` — upsert em `profiles` com `id, nome, telefone, data_nascimento, sexo, cidade, estado, avatar_url`
- `deleteAccount()` — chama a Function `delete-account`

### Eventos (`app.js`)
- `trackEvent(type, details)` — insere em `app_events` (`metadata`); se falhar, usa a tabela legada `events` como fallback

### Admin (`app.js`)
- `openAdmin()` / `openAdminRoute()` — exige `access.isAdmin`; dados vêm da Function `admin-dashboard`

### Histórico (`history.js`)
- `saveTournament()` / `loadHomeHistory()` / `openHistorico()` / `openTournament()` / `replayShare()`

### Torneio (`tournament.js`)
- `gerarTorneio()` — ponto de entrada principal
- `buildMatches()` / `buildMatchesRRComBye()` / `buildMistaRotativa()` / `buildEliminatoria()`
- `renderTorneioScreen()` / `renderRotativoRounds()` / `renderDuplaFixaRounds()` / `renderEliminatoriaRounds()`
- `confirmScore(id)` / `confirmDupla(id)` / `confirmFinal(id)`
- `applyRoundLock()` / `applyRoundLockElim()`
- `calcIndivStandings()` / `calcSomaStandings()` / `calcDuplaStandings()` / `getStandings()`
- `verResultadoFinal()` / `trackTournamentFinishedOnce()`

### Share Card (`share.js`)
- `generateShareCanvas()` / `downloadPNG()` / `nativeShare()` / `openShare()`

---

## Deploy (Netlify)

O site está conectado ao repositório GitHub. Push na `main` dispara o build de produção:

```bash
npm run build   # gera dist/ (src/ + public/ + dist/js/env.js)
```

- Branches diferentes da `main` geram Branch Deploy (ex.: `https://mvp-pago--bt8torneio.netlify.app`).
- Deploy manual (emergência): rodar `npm run build` localmente e arrastar `dist/` no Netlify. **Nunca** enviar só o `index.html` — o app precisa de `css/`, `js/` e `img/`.
- Netlify Functions só funcionam no deploy via Git/CLI (não no drag-and-drop).

---

## Problemas conhecidos / pendentes

1. **Sem banco de staging** — branch deploys usam o mesmo Supabase de produção (`srrbnjgixizsjxobvsma`). Criar um novo projeto de staging antes de testar mudanças de schema ou pagamentos.
2. **Login com Google** — o erro antigo `Database error saving new user` vinha de um trigger com colunas erradas. A migração atual recria `handle_new_user()` com as colunas corretas, e os commits de 30/04 corrigiram o retorno do OAuth no front. Falta confirmar em produção que o cadastro novo via Google funciona.
3. **Testes pendentes da Sprint 7** — expiração do Pro 30 dias, histórico após expirar, e bloqueio por RLS a torneio de outro usuário (ver `docs/MVP_PAGO_IMPLEMENTACAO.md`).
4. **Email admin no front** — `ADMIN_EMAIL` em `src/js/config.js` ainda é usado como fallback de UI. A permissão real é `role = 'admin'` no banco/backend.
5. **Tabela legada `events`** — ainda usada como fallback em `trackEvent`. Remover quando `app_events` estiver confirmada em produção.

---

## Roadmap futuro (rebuild planejado)

| Camada | Tecnologia |
|--------|-----------|
| Frontend | React + Vite + TailwindCSS |
| Backend | Node.js + Express + Prisma |
| Banco | PostgreSQL via Supabase |
| Hosting | Vercel (frontend) + Railway (backend) |
| Share card | Puppeteer server-side → PNG 1080×1920px |
| Auth | Supabase Auth (manter) |

Funcionalidades a adicionar no rebuild:
- Registro de jogadores com gênero (M/F/Misto/Open)
- Recomendação automática de formato
- Rodadas liberadas em blocos por quadra disponível
- Bracket de eliminação com fases coloridas
- Geração de PNG server-side via Puppeteer

---

## Dono do projeto

**João Paulo** — Spatium (agência de marketing, Nobres-MT)
Contato: joaopaulopaixao@gmail.com
