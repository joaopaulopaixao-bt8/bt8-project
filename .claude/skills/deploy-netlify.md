# Skill: Deploy BT8 no Netlify

## Fluxo padrão (Git)

O site Netlify está conectado ao repositório GitHub `bt8-project`.

- Push na `main` → build de produção em **bt8.com.br**.
- Push em outra branch → Branch Deploy de teste (ex.: `https://mvp-pago--bt8torneio.netlify.app`).

Configuração em `netlify.toml`:

```toml
[build]
  command = "npm run build"   # node scripts/build-netlify.js
  publish = "dist"

[functions]
  directory = "netlify/functions"
```

O build:
1. Apaga e recria `dist/`.
2. Copia todo `src/` e todo `public/` para `dist/`.
3. Gera `dist/js/env.js` a partir de `BT8_APP_ENV`, `BT8_SUPABASE_URL`, `BT8_SUPABASE_ANON_KEY`, `BT8_STRIPE_PUBLISHABLE_KEY`.

## Testar o build localmente

```bash
npm run build
```

Depois de publicar, conferir `https://<site>/js/env.js` para ver qual ambiente/Supabase está ativo.

## Deploy manual (só emergência)

```bash
npm run build
```

Arrastar a pasta `dist/` inteira no painel do Netlify. **Atenção**: deploy por drag-and-drop não publica as Netlify Functions (checkout, webhook, limite de visitante, admin, exclusão de conta) — use só para correção rápida de front.

Nunca enviar apenas `index.html` + arquivos de `public/`: o app precisa de `css/`, `js/` e `img/`.

## Variáveis no Netlify

Build (públicas): `BT8_APP_ENV`, `BT8_SUPABASE_URL`, `BT8_SUPABASE_ANON_KEY`, `BT8_STRIPE_PUBLISHABLE_KEY`.

Functions (secretas, nunca no repositório): `BT8_SUPABASE_SERVICE_ROLE_KEY`, `BT8_STRIPE_SECRET_KEY`, `BT8_STRIPE_WEBHOOK_SECRET`, `BT8_GUEST_USAGE_HASH_SECRET`, `BT8_STRIPE_PRO_MONTHLY_PRICE_ID`, `BT8_STRIPE_PRO_30D_PRICE_ID`.

## Observações
- Rotas SPA (`/admin`, `/bt8`, `/reset-password`, páginas legais) estão em `netlify.toml` e `public/_redirects`.
- O Service Worker (`public/sw.js`) faz cache do app — ao mudar arquivos estáticos, conferir se a versão do cache precisa ser atualizada.
