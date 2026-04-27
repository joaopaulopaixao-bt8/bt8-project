# BT8 — Instruções para Claude Code

Leia **docs/CONTEXT.md** antes de qualquer coisa. Ele contém toda a arquitetura, banco de dados, modos de torneio e problemas conhecidos do projeto.

## Regras importantes

1. **O app atual está modularizado** — `src/index.html`, `src/css/*`, `src/js/*` e `src/img/*`.
2. **Não quebrar o deploy estático** — qualquer arquivo referenciado pelo `index.html` precisa entrar na pasta enviada ao Netlify.
3. **Tabela `profiles` usa colunas em português**: `id, nome, telefone, data_nascimento, sexo, cidade, estado`. Nunca usar `user_id`, `name`, `phone`, `birth`, `gender`, `city`.
4. **Supabase Key está no próprio index.html** — não remover, não commitar em repo público.
5. **Deploy**: copiar todo `src/` para `dist/`, copiar todo `public/` para `dist/`, e arrastar `dist/` no Netlify.

## Problema prioritário a resolver

Login com Google retorna `Database error saving new user`. Investigar e corrigir o trigger na tabela `profiles` do Supabase:

```sql
select trigger_name, event_manipulation, action_statement
from information_schema.triggers
where event_object_table = 'users' or event_object_table = 'profiles';
```

O trigger provavelmente usa colunas com nomes errados (`user_id` em vez de `id`, etc.).

## Skills disponíveis

Veja `.claude/skills/` para orientações de design e criação de arquivos.
