# Skill: Supabase — BT8

## Conexão
```js
const SUPA_URL = 'https://znifpitysqfbepjymtmg.supabase.co';
const SUPA_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'; // ver index.html
```

## Tabelas

### profiles
| Coluna | Tipo | Obs |
|--------|------|-----|
| id | uuid PK | = auth.uid() |
| nome | text | |
| email | text | |
| telefone | text | |
| data_nascimento | date | |
| sexo | text | 'M','F','O' |
| cidade | text | |
| estado | text | |
| avatar_url | text | |
| provider | text | |
| created_at | timestamptz | |
| updated_at | timestamptz | |

> ⚠️ SEMPRE usar nomes de coluna em português. Nunca `user_id`, `name`, `phone`, `birth`, `gender`, `city`.

### events
| Coluna | Tipo | Obs |
|--------|------|-----|
| id | uuid PK | auto |
| user_id | uuid | auth.uid() |
| event_type | text | ex: 'tournament_created' |
| details | jsonb | { format, category, players } |
| created_at | timestamptz | |

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
```

### Registrar evento
```js
await SUPA.from('events').insert({
  user_id: SUPA_USER?.id || null,
  event_type: 'tournament_created',
  details: { format: APP.mode, players: APP.players.length },
  created_at: new Date().toISOString()
});
```

## RLS (Row Level Security)
```sql
-- profiles: usuário só acessa o próprio registro
create policy "self" on profiles for all using (auth.uid() = id);

-- events: qualquer um pode inserir, só admin lê
create policy "insert" on events for insert with check (true);
create policy "admin_read" on events for select using (auth.email() = 'joaopaulopaixao@gmail.com');
```

## Problema de trigger (pendente)
Login com Google falha com `Database error saving new user`.
Investigar:
```sql
select trigger_name, event_manipulation, action_statement
from information_schema.triggers
where event_object_table = 'users' or event_object_table = 'profiles';
```
Provável causa: trigger com `NEW.user_id` em vez de `NEW.id`, ou `NEW.name` em vez de `NEW.nome`.
