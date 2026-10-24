# BT8 - Staging local (Supabase no Docker)

Ambiente de teste que roda inteiro no seu PC: um Supabase local (Postgres + Auth) em Docker e o app servido pelo Netlify CLI com as Functions. Nada aqui toca o banco de producao.

Usado porque o plano free do Supabase nao tem vaga para um projeto de staging na nuvem e os Branch Deploys do Netlify apontam para o banco de producao (`srrbnjgixizsjxobvsma`).

## Pre-requisitos

- Docker Desktop aberto e rodando.
- Node.js (o Supabase CLI roda via `npx`, versao fixada `2.120.0`, sem instalar nada no projeto).
- Netlify CLI (`netlify --version`). Se nao tiver: `npm install -g netlify-cli`.

## Uso diario

```bash
npm run db:start     # sobe o Supabase local (1a vez baixa as imagens Docker, demora alguns minutos)
npm run dev:local    # builda apontando para o banco local e abre o app em http://localhost:8888
```

Para desligar:

```bash
npm run db:stop      # para os containers (os dados ficam guardados)
```

## Banco local

| O que | Onde |
|-------|------|
| API | http://127.0.0.1:55321 |
| Studio (painel, SQL Editor, Table Editor) | http://127.0.0.1:55323 |
| E-mails de teste (cadastro, recuperar senha) | http://127.0.0.1:55324 |
| Postgres direto | `postgresql://postgres:postgres@127.0.0.1:55322/postgres` |

`npm run db:status` mostra URLs e chaves locais.

Na primeira subida, o Supabase aplica `supabase/migrations/*` e depois `supabase/seed.sql`.

### Usuarios de teste (criados pelo `seed.sql`)

| E-mail | Senha | Perfil |
|--------|-------|--------|
| admin@bt8.test | bt8-local-123 | Admin, plano Pro |
| usuario@bt8.test | bt8-local-123 | Free |

Para testar o painel admin, entre em http://localhost:8888/admin com o usuario admin.

### Zerar o banco

```bash
npm run db:reset     # apaga tudo, reaplica as migracoes e o seed
```

Use sempre que mudar uma migracao.

## Como testar uma migracao nova

1. Criar o arquivo em `supabase/migrations/` com prefixo numerico maior que o ultimo (ex.: `002_minha_mudanca.sql`).
2. `npm run db:reset` e conferir se aplica sem erro.
3. `npm run dev:local` e testar o fluxo no app.
4. So depois aplicar o mesmo SQL no Supabase de producao (SQL Editor), com backup antes.

## Limitacoes do ambiente local

- **Login com Google** nao funciona no local (exigiria configurar um OAuth client proprio). Teste com e-mail/senha.
- **Stripe** fica desligado por padrao. Para testar checkout/webhook com chaves de teste, exporte `BT8_STRIPE_SECRET_KEY` (`sk_test_...`), `BT8_STRIPE_PRO_MONTHLY_PRICE_ID` e `BT8_STRIPE_PRO_30D_PRICE_ID` antes do `npm run dev:local`, e use `stripe listen --forward-to localhost:8888/.netlify/functions/stripe-webhook` para o webhook.
- O `dev:local` usa `netlify dev --offline`: **nao** puxa variaveis do site Netlify, para nunca carregar a service role de producao.
- Storage, Realtime e Edge Functions do Supabase ficam desligados (o app nao usa).
- Os Branch Deploys do Netlify continuam apontando para producao — nao use branch deploy para testar mudanca de banco.
