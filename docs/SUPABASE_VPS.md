# BT8 - Supabase de producao no VPS

Desde 2026-10-25 o banco e a autenticacao do BT8 rodam num Supabase auto-hospedado (Docker) no VPS, em vez do Supabase Cloud. Motivo: o projeto Cloud (`srrbnjgixizsjxobvsma`) foi pausado por inatividade e o plano gratis nao tinha vaga para restaura-lo. Como nao havia clientes pagantes (Stripe em modo teste), o banco foi recriado do zero a partir de `supabase/migrations/`.

## Onde fica

| Item | Valor |
|------|-------|
| Servidor | VPS `212.47.66.152` (mesmo dos bots e do sistema da paroquia), acesso `ssh -i ~/.ssh/bot_dizimo_vps root@212.47.66.152` |
| Pasta | `/opt/bt8` (Supabase self-hosted oficial, versao em `/opt/bt8/.supabase-version`) |
| URL publica | `https://api.bt8.com.br` (Caddy do VPS com HTTPS -> `127.0.0.1:8100`) |
| Segredos | `/opt/bt8/.env` (chmod 600). Nunca copiar para o repositorio |
| Backups | `/opt/bt8/backups/bt8-AAAA-MM-DD.dump`, diario as 03:30 (cron do root), guarda 14 dias |

## Servicos

So o que o app usa: `db`, `auth`, `rest`, `meta`, `studio` e o gateway `api-gw`. Realtime, Storage, imgproxy, Edge Functions e o pooler ficam desligados em `docker-compose.bt8.yml`, que tambem limita a memoria de cada container e prende o gateway em `127.0.0.1:8100`. O Postgres nao fica exposto na internet.

O painel (Studio) abre em `https://api.bt8.com.br` com usuario e senha `DASHBOARD_USERNAME` / `DASHBOARD_PASSWORD` do `.env`.

## Comandos (no VPS, em /opt/bt8)

```bash
docker compose ps                      # estado dos servicos
docker compose logs -f auth            # logs de um servico
docker compose restart auth            # reiniciar um servico
/opt/bt8/backup.sh                     # backup manual
docker compose exec -T db psql -U postgres -d postgres   # SQL direto
```

Aplicar uma migracao nova (depois de testar no staging local):

```bash
scp -i ~/.ssh/bot_dizimo_vps supabase/migrations/00X_nome.sql root@212.47.66.152:/opt/bt8/
ssh -i ~/.ssh/bot_dizimo_vps root@212.47.66.152 "/opt/bt8/backup.sh && cd /opt/bt8 && docker compose exec -T db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < 00X_nome.sql"
```

Restaurar um backup:

```bash
docker exec -i supabase-db pg_restore -U supabase_admin -d postgres --clean --if-exists < /opt/bt8/backups/bt8-AAAA-MM-DD.dump
```

## Variaveis no Netlify

- `BT8_SUPABASE_URL` = `https://api.bt8.com.br` (todos os contextos).
- `BT8_SUPABASE_SERVICE_ROLE_KEY` = `SERVICE_ROLE_KEY` do `/opt/bt8/.env` (secreta, escopo Functions).
- A chave publica (publishable) fica no codigo (`src/js/env.js`, `src/js/auth.js`, `scripts/build-netlify.js`, `netlify.toml`), como antes.

## E-mails

- Envio pelo Resend (`smtp.resend.com:465`, usuario `resend`, senha = API key do Resend em `SMTP_PASS`). Remetente `BT8 <noreply@bt8.com.br>`, dominio verificado no Resend com os registros DNS no Cloudflare.
- Modelos em portugues: gerados por `npm run emails` (`scripts/build-emails.js`) em `public/email/*.html` e publicados em `https://bt8.com.br/email/<nome>.html`. O auth le cada modelo dessa URL; os assuntos ficam em `public/email/subjects.json`.
- No VPS, `docker-compose.bt8.yml` passa ao servico `auth` as variaveis `GOTRUE_MAILER_TEMPLATES_<NOME>` (URL do modelo, `${BT8_EMAIL_BASE}/<nome>.html`; `BT8_EMAIL_BASE=https://bt8.com.br/email` no `.env`; o auth recarrega os modelos sozinho), `GOTRUE_MAILER_SUBJECTS_<NOME>` (assunto) e `GOTRUE_MAILER_NOTIFICATIONS_<AVISO>_ENABLED` (avisos de senha/e-mail alterado e login vinculado/removido).
- Para mudar um texto: editar `scripts/build-emails.js`, rodar `npm run emails`, testar no staging local (Mailpit em `http://127.0.0.1:55324`), mesclar na `main` e, se mudou assunto, atualizar o compose do VPS e rodar `docker compose up -d auth`.
- Cadastro por e-mail ainda entra sem confirmacao (`ENABLE_EMAIL_AUTOCONFIRM=true`).

## Pendencias desta migracao

- Login com Google: precisa do Client ID/Secret do Google Cloud em `GOOGLE_CLIENT_ID`/`GOOGLE_SECRET` (e `GOOGLE_ENABLED=true`) no `.env` e do redirect `https://api.bt8.com.br/auth/v1/callback` cadastrado no Google Cloud.
- Usuarios do banco antigo nao foram migrados: quem tinha conta precisa se cadastrar de novo.
