# Skill: Supabase — BT8

## Conexão

O front lê a configuração de `window.BT8_ENV` (gerado no build em `dist/js/env.js`):

```js
const BT8_ENV = window.BT8_ENV || {};
const SUPA_URL = BT8_ENV.SUPABASE_URL || 'https://srrbnjgixizsjxobvsma.supabase.co';
const SUPA_KEY = BT8_ENV.SUPABASE_ANON_KEY || 'sb_publishable_...'; // ver src/js/auth.js
```

> Produção = `srrbnjgixizsjxobvsma` (confirmado em 2026-10-24). O antigo `znifpitysqfbepjymtmg` não é mais usado. Branch Deploys apontam para o mesmo projeto — não há staging separado.

Service role **só** nas Netlify Functions (`BT8_SUPABASE_SERVICE_ROLE_KEY`), nunca no front nem no repositório (que é público).

Schema completo: `supabase/migrations/001_paid_mvp_staging.sql`.

## Tabelas

### profiles
| Coluna | Tipo | Obs |
|--------|------|-----|
| id | uuid PK | = auth.uid() |
| email | text | |
| nome | text | |
| telefone | text | |
| data_nascimento | date | |
| sexo | text | 'M','F','O' |
| cidade | text | |
| estado | text | |
| avatar_url | text | |
| provider | text | 'google', 'email' |
| plan | text | 'free' \| 'pro' — só backend altera |
| role | text | 'user' \| 'admin' — só backend altera |
| pro_until | timestamptz | fim do Pro |
| stripe_customer_id | text | |
| subscription_status | text | |
| created_at / updated_at | timestamptz | |

> ⚠️ SEMPRE usar nomes de coluna em português em `profiles`. Nunca `user_id`, `name`, `phone`, `birth`, `gender`, `city`.

### tournaments
`id, user_id, mode, category, title, players jsonb, standings jsonb, state jsonb, created_at, updated_at`

### subscriptions
`id, user_id, stripe_customer_id, stripe_subscription_id, stripe_payment_intent_id, plan_type ('recurring'|'one_time_30d'), status, price_id, current_period_end, metadata, created_at, updated_at`

### guest_usage (somente backend)
`id, guest_id, ip_hash, user_agent_hash, month_key, tournaments_created, first_seen_at, last_seen_at`

### app_events
| Coluna | Tipo | Obs |
|--------|------|-----|
| id | uuid PK | auto |
| user_id | uuid | auth.uid() ou null |
| guest_id | text | visitante |
| event_type | text | ex: 'tournament_created' |
| metadata | jsonb | { format, category, players, plan } |
| created_at | timestamptz | |

> A tabela legada `events` (`details` em vez de `metadata`) só é usada como fallback em `trackEvent`.

## Padrões de uso

### Buscar perfil
```js
const { data } = await SUPA
  .from('profiles')
  .select('*')
  .eq('id', SUPA_USER.id)
  .maybeSingle();
```

### Salvar perfil
```js
await SUPA.from('profiles').upsert(payload, { onConflict: 'id' });
// payload: id, nome, telefone, data_nascimento, sexo, cidade, estado, avatar_url
// Não enviar plan/role/pro_until — o trigger profiles_protect_billing_fields bloqueia.
```

### Registrar evento
Usar sempre `trackEvent(type, details)` (`src/js/app.js`), que grava em `app_events`:
```js
await SUPA.from('app_events').insert({
  user_id: SUPA_USER?.id || null,
  event_type: 'tournament_created',
  metadata: { format: APP.mode, players: APP.players.length },
  created_at: new Date().toISOString()
});
// guest_id existe na tabela, mas trackEvent ainda não o preenche.
```

## Triggers
- `on_auth_user_created` (em `auth.users`) → `private.handle_new_user()` insere em `profiles (id, email, nome, provider)`.
- `profiles_protect_billing_fields` → impede alteração de campos de plano pelo usuário.
- `*_touch_updated_at` → atualiza `updated_at`.

## RLS
```sql
-- admin
private.is_admin()  -- profiles.role = 'admin' para auth.uid()

-- profiles: próprio registro (update limitado) ou admin lê
-- tournaments: CRUD do próprio user_id; admin lê
-- subscriptions: usuário lê as próprias; admin lê; escrita só via backend
-- app_events: insert com user_id null ou = auth.uid(); select só admin
-- guest_usage: sem policies (só service role)
```

## Diagnóstico de login Google
Se o cadastro via Google voltar a falhar com `Database error saving new user`:
```sql
select trigger_name, event_manipulation, action_statement
from information_schema.triggers
where event_object_table = 'users' or event_object_table = 'profiles';
```
O trigger correto é `on_auth_user_created` → `private.handle_new_user()`. Qualquer trigger antigo usando `NEW.user_id`, `name` etc. deve ser removido.
