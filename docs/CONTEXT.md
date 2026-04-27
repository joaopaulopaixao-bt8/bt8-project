# BT8 — Beach Tennis Tournament Manager
## Contexto completo para Claude Code

---

## O que é o BT8

PWA (Progressive Web App) de gerenciamento de torneios de beach tennis. Roda 100% no navegador, sem backend próprio. Hospedado em **https://bt8.com.br** via **Netlify**. Banco de dados e autenticação via **Supabase**.

---

## Stack atual

| Camada | Tecnologia |
|--------|-----------|
| Frontend | HTML (`src/index.html`) + CSS/JS modular em `src/css` e `src/js` |
| PWA | `public/manifest.json` + `public/sw.js` (Service Worker) |
| Hosting | Netlify (deploy por zip ou drag-and-drop) |
| Auth | Supabase Auth (Google OAuth + Email/Senha) |
| Banco | Supabase (PostgreSQL) |
| Share card | Canvas API → PNG 1080×1920px |

> ⚠️ A documentação antiga citava arquivo único, mas o app atual está modularizado: `src/index.html`, `src/css/*`, `src/js/*` e imagens em `src/img/*`.

---

## Supabase

- **URL**: `https://znifpitysqfbepjymtmg.supabase.co`
- **Anon Key**: salva diretamente no index.html (variáveis `SUPA_URL` e `SUPA_KEY`)
- **Auth configurado**: Google OAuth + Email/Senha + Recuperação de senha
- **Redirect URL**: `https://bt8.com.br`

### Tabelas existentes no banco

#### `profiles` (já existia, estrutura em português)
```sql
id              uuid PRIMARY KEY  -- = auth.uid()
nome            text
email           text
telefone        text
data_nascimento date
sexo            text              -- 'M' | 'F' | 'O'
cidade          text
estado          text
avatar_url      text
provider        text
created_at      timestamptz
updated_at      timestamptz
```

#### `events` (criada nas etapas recentes)
```sql
id          uuid DEFAULT gen_random_uuid() PRIMARY KEY
user_id     uuid
event_type  text   -- ex: 'tournament_created', 'tournament_finished'
details     jsonb  -- { format, category, players }
created_at  timestamptz
```

### RLS (Row Level Security)
```sql
-- profiles
create policy "self" on profiles for all using (auth.uid() = id);

-- events
create policy "insert" on events for insert with check (true);
create policy "admin_read" on events for select using (auth.email() = 'joaopaulopaixao@gmail.com');
```

> ⚠️ **Problema pendente**: Login com Google retorna erro `Database error saving new user`. Provavelmente existe um trigger antigo na tabela `profiles` que usa colunas com nomes diferentes. Investigar com:
> ```sql
> select trigger_name, event_manipulation, action_statement
> from information_schema.triggers
> where event_object_table = 'users' or event_object_table = 'profiles';
> ```

---

## Telas do app (screens)

| ID | Nome | Descrição |
|----|------|-----------|
| `screen-home` | Home | Topbar com logo, botão de usuário, botão novo torneio |
| `screen-tipo` | Tipo | Seleção de categoria (Individual / Duplas) |
| `screen-config` | Configurar | Cadastro de jogadores/duplas, seleção de formato |
| `screen-torneio` | Torneio | Rodadas, placar, ranking ao vivo |
| `screen-resultado` | Resultado Final | Pódio, ranking completo |

### Modais
- **Modal Auth** (`#auth-modal`): Login Google + Email/Senha + Recuperação de senha
- **Modal Perfil** (`#profile-modal`): Edição de perfil do usuário logado
- **Modal Share** (`#share-modal`): Geração e compartilhamento do card PNG
- **Modal Admin** (criado dinamicamente): Dashboard com totais do Supabase

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
  // ... outros campos dependendo do modo
}
```

---

## Funções principais (JS)

### Autenticação
- `initSupabase()` — inicializa cliente Supabase
- `handleAuthStateChange(user)` — callback de login/logout
- `loginWithGoogle()` — OAuth popup
- `doLogin()` / `doSignup()` / `doForgot()` — email/senha
- `logoutUser()` — limpa sessão

### Perfil (Etapa 2)
- `openProfileModal()` — abre modal e chama `loadProfile()`
- `loadProfile()` — busca perfil no Supabase (tabela `profiles`, campo `id`)
- `saveProfile()` — upsert no Supabase com colunas: `id, nome, telefone, data_nascimento, sexo, cidade, estado`
- `closeProfileModal()`

### Rastreamento (Etapa 3)
- `trackEvent(type, details)` — insere em `events` de forma silenciosa
- Chamada em `gerarTorneio()` com `{ format, category, players }`

### Admin (Etapa 4)
- `openAdmin()` — só para `joaopaulopaixao@gmail.com`
- Mostra painel com total de perfis, total de eventos, últimos 20 eventos

### Torneio
- `gerarTorneio()` — ponto de entrada principal
- `buildMatches()` / `buildMatchesRRComBye()` / `buildMistaRotativa()` / `buildEliminatoria()`
- `renderTorneioScreen()` / `renderRotativoRounds()` / `renderDuplaFixaRounds()` / `renderEliminatoriaRounds()`
- `confirmScore(id)` / `confirmDupla(id)` / `confirmFinal(id)`
- `applyRoundLock()` / `applyRoundLockElim()` — desbloqueio sequencial de rodadas
- `calcIndivStandings()` / `calcSomaStandings()` / `calcDuplaStandings()` / `getStandings()`
- `verResultadoFinal()` — abre tela de resultado

### Share Card
- `generateShareCanvas()` — gera PNG 1080×1920px via Canvas API
- `downloadPNG()` / `nativeShare()` / `openShare()`

---

## Deploy (Netlify)

1. Copiar todo o conteúdo de `src/` para uma pasta `dist/`
2. Copiar todo o conteúdo de `public/` para a mesma `dist/`
3. Arrastar a pasta `dist/` no painel do Netlify em **bt8.com.br**
3. Não há build process — arquivos estáticos puros

### `_headers`
Contém headers de cache e segurança para o Netlify.

### `_redirects`
Redirecionamentos (SPA fallback).

---

## Problemas conhecidos / pendentes

1. **Login Google falhando** — erro `Database error saving new user`. Investigar triggers da tabela `profiles` no Supabase. Provavelmente há um trigger `on insert` em `auth.users` que tenta inserir em `profiles` usando colunas com nomes diferentes (`user_id` em vez de `id`, `name` em vez de `nome`, etc.).

2. **Deploy antigo pode quebrar a tela principal** — o comando antigo empacotava só `index.html` e arquivos de `public/`, mas o app atual precisa também de `css/`, `js/` e `img/`.

3. **Email admin hardcoded** — `joaopaulopaixao@gmail.com` está fixo no JS. Considerar mover para variável de ambiente ou tabela do Supabase.

---

## Roadmap futuro (rebuild planejado)

Quando sair do arquivo único para stack completa:

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
