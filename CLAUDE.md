# BT8 — Instruções para Claude Code

Leia **docs/CONTEXT.md** antes de qualquer coisa. Ele contém toda a arquitetura, banco de dados, planos, Netlify Functions, modos de torneio e problemas conhecidos do projeto.

## Regras importantes

1. **O app está modularizado** — `src/index.html`, `src/css/*`, `src/js/*` e `src/img/*`. Backend em `netlify/functions/*`. Schema em `supabase/migrations/*`.
2. **Não quebrar o build** — `npm run build` (`scripts/build-netlify.js`) copia `src/` e `public/` para `dist/` e gera `dist/js/env.js`. Qualquer arquivo novo referenciado pelo `index.html` precisa estar em `src/` ou `public/`.
3. **Tabela `profiles` usa colunas em português**: `id, nome, email, telefone, data_nascimento, sexo, cidade, estado, avatar_url, provider` + campos de plano `plan, role, pro_until, stripe_customer_id, subscription_status`. Nunca usar `user_id`, `name`, `phone`, `birth`, `gender`, `city` em `profiles` (as outras tabelas usam `user_id`).
4. **Chaves** — no front só entram chaves públicas (Supabase publishable/anon, Stripe `pk_`), via `window.BT8_ENV` (`src/js/env.js`, sobrescrito no build). O repositório GitHub é **público**: nunca commitar service role, `sk_`, `whsec_` nem `GUEST_USAGE_HASH_SECRET` — essas ficam só nas variáveis do Netlify (escopo Functions).
5. **Plano Pro só é ativado pelo backend** (webhook Stripe). Nunca liberar Pro ou Admin direto no front. Admin = `profiles.role = 'admin'`.
6. **Deploy**: push na `main` dispara o build de produção no Netlify (conectado ao GitHub). Outras branches viram Branch Deploy de teste. Drag-and-drop de `dist/` só em emergência (as Functions não sobem por esse caminho).

## Pendências prioritárias

1. **Supabase de produção = self-hosted no VPS** (`https://api.bt8.com.br`, pasta `/opt/bt8`, desde 2026-10-25). O projeto Cloud `srrbnjgixizsjxobvsma` foi pausado e abandonado. Operação, backups e migrações: `docs/SUPABASE_VPS.md`. Branch Deploys apontam para o mesmo banco — testar migrações e fluxos no **staging local** (`npm run db:start` + `npm run dev:local`, ver `docs/STAGING_LOCAL.md`).
2. **Validar login com Google em produção** — o trigger `private.handle_new_user()` da migração já usa as colunas certas e o retorno OAuth foi corrigido no front (commits de 30/04/2026). Falta confirmar com um cadastro novo. Se o erro `Database error saving new user` voltar, investigar:

```sql
select trigger_name, event_manipulation, action_statement
from information_schema.triggers
where event_object_table = 'users' or event_object_table = 'profiles';
```

3. **Testes restantes da Sprint 7 e checklist da Sprint 8** — ver `docs/MVP_PAGO_IMPLEMENTACAO.md`.

## Skills disponíveis

Veja `.claude/skills/` para orientações de design, Supabase e deploy.
