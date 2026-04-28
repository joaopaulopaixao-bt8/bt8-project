# Supabase staging - SQL da Sprint 1

Execute o arquivo abaixo no projeto Supabase staging:

```text
supabase/migrations/001_paid_mvp_staging.sql
```

## Onde executar

1. Abra o Supabase.
2. Entre no projeto `bt8-staging`.
3. Va em **SQL Editor**.
4. Crie uma nova query.
5. Cole todo o conteudo do arquivo `supabase/migrations/001_paid_mvp_staging.sql`.
6. Clique em **Run**.

## O que esse SQL cria

- `profiles`
- `tournaments`
- `subscriptions`
- `guest_usage`
- `app_events`
- trigger para criar perfil ao criar usuario no Auth
- campos de plano Free/Pro
- campo `role` para Admin
- RLS basico para proteger dados por usuario
- politica admin inicial baseada em `role = admin`
- define `joaopaulopaixao@gmail.com` como admin, se esse usuario ja existir no staging

## Depois de executar

Confirme no Table Editor se existem as tabelas:

```text
profiles
tournaments
subscriptions
guest_usage
app_events
```

Depois abra `profiles` e confirme se o usuario:

```text
joaopaulopaixao@gmail.com
```

esta com:

```text
role = admin
plan = pro
```

Se aparecer algum erro no SQL Editor, copie a mensagem completa e me mande.
