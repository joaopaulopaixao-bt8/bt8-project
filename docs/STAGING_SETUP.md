# BT8 - Configuracao manual do ambiente de teste

Este guia lista o que precisa ser configurado manualmente para desenvolver o MVP pago sem afetar o sistema atual em producao.

## 1. Netlify - Branch `mvp-pago`

Objetivo: fazer a branch `mvp-pago` gerar uma URL de teste separada da producao.

### O que conferir no Netlify

No painel do site BT8 no Netlify, confira:

- O site esta conectado ao repositorio GitHub `bt8-project`.
- A branch de producao continua sendo `main`.
- A branch `mvp-pago` gera um deploy separado, como Branch Deploy ou Deploy Preview.

### Variaveis publicas de build

Configurar no Netlify com escopo de Build para a branch/ambiente de teste:

```text
BT8_APP_ENV=staging
BT8_SUPABASE_URL=URL_DO_SUPABASE_STAGING
BT8_SUPABASE_ANON_KEY=CHAVE_PUBLICA_DO_SUPABASE_STAGING
BT8_STRIPE_PUBLISHABLE_KEY=pk_test_...
```

Essas variaveis viram `dist/js/env.js` durante o build. Elas sao publicas no navegador.

### Variaveis secretas futuras

Ainda nao usadas nesta etapa, mas serao necessarias quando criarmos as Netlify Functions:

```text
BT8_SUPABASE_SERVICE_ROLE_KEY=sb_secret_... ou service_role legacy
BT8_STRIPE_SECRET_KEY=sk_test_...
BT8_STRIPE_WEBHOOK_SECRET=whsec_...
BT8_GUEST_USAGE_HASH_SECRET=uma_frase_secreta_longa
```

Essas variaveis nunca devem aparecer em `src/`, `public/`, `dist/` ou no GitHub.

### O que voce precisa me mandar do Netlify

- URL do deploy da branch `mvp-pago`.
- Confirmacao se a branch `main` continua como producao.
- Se o build da branch passou ou falhou.
- Se falhar, me mande o trecho do log de erro.

## 2. Supabase staging

Objetivo: ter um banco de teste para criar tabelas, policies e usuarios de teste sem arriscar os dados reais.

### Recomendado

Criar um novo projeto Supabase apenas para staging.

Nome sugerido:

```text
bt8-staging
```

Regiao:

```text
South America, se disponivel, ou a regiao mais proxima usada no projeto atual.
```

### Dados que voce precisa buscar no Supabase staging

No projeto staging, procure em Project Settings / API Keys ou Connect:

```text
Project URL
Publishable key ou anon key
Secret key ou service_role key
```

Para o front, precisamos de:

```text
BT8_SUPABASE_URL
BT8_SUPABASE_ANON_KEY
```

Para backend/funcoes, depois precisaremos de:

```text
BT8_SUPABASE_SERVICE_ROLE_KEY
```

### O que nao enviar em local publico

Pode me mandar aqui no chat se quiser que eu oriente a configuracao, mas nao vamos commitar:

- Secret key.
- Service role key.
- Senhas.
- Webhook secrets.

### Configuracao de Auth no Supabase staging

Precisaremos configurar:

- Email/senha habilitado.
- Google OAuth habilitado, se quisermos testar login com Google no staging.
- URL do deploy staging permitida em redirect URLs.
- URL local, se formos testar localmente.

URLs que provavelmente entram em Redirect URLs:

```text
https://URL-DA-BRANCH-MVP-PAGO.netlify.app
http://localhost:8888
http://127.0.0.1:8888
```

### O que voce precisa me mandar do Supabase

- Project URL do staging.
- Publishable key ou anon key do staging.
- Confirmacao se criou projeto separado ou se prefere usar o projeto atual.
- Se quiser testar Google no staging: confirmar se ja tem OAuth configurado.

## 3. Stripe em modo teste

Objetivo: criar os produtos e chaves de teste, sem cobranca real.

### Modo correto

Usar sempre o modo teste/sandbox enquanto estivermos na branch `mvp-pago`.

Chaves esperadas:

```text
pk_test_...
sk_test_...
```

Nunca usar `pk_live_` ou `sk_live_` nesta fase.

### Produtos de teste

Criar dois produtos/precos:

#### BT8 Pro Mensal

```text
Nome: BT8 Pro Mensal
Preco: R$ 6,90
Tipo: recorrente
Intervalo: mensal
```

#### BT8 Pro 30 Dias

```text
Nome: BT8 Pro 30 Dias
Preco: R$ 14,90
Tipo: pagamento unico
```

### Dados que vamos precisar depois

Depois que os produtos forem criados, precisamos guardar:

```text
STRIPE_PRO_MONTHLY_PRICE_ID=price_...
STRIPE_PRO_30D_PRICE_ID=price_...
BT8_STRIPE_PUBLISHABLE_KEY=pk_test_...
BT8_STRIPE_SECRET_KEY=sk_test_...
```

O webhook secret so existe depois que criarmos o endpoint de webhook.

### O que voce precisa me mandar do Stripe

- Publishable key de teste `pk_test_...`
- Confirmacao de que criou os dois produtos.
- Price ID do Pro Mensal.
- Price ID do Pro 30 Dias.

Nao mande no chat se nao quiser:

- Secret key `sk_test_...`

Ela pode ser configurada diretamente no Netlify depois.

## 4. Segredo para limite de visitante

Vamos precisar de uma string secreta para transformar IP/user agent em hash.

Exemplo de formato:

```text
BT8_GUEST_USAGE_HASH_SECRET=frase-longa-aleatoria-com-mais-de-32-caracteres
```

Essa chave fica apenas no backend. Ela impede que o IP seja salvo puro e ajuda a criar uma identificacao consistente do visitante.

## 5. Ordem recomendada agora

1. Confirmar deploy da branch `mvp-pago` no Netlify.
2. Criar Supabase staging.
3. Colocar `BT8_SUPABASE_URL` e `BT8_SUPABASE_ANON_KEY` do staging no Netlify para a branch de teste.
4. Criar produtos Stripe em modo teste.
5. Colocar `BT8_STRIPE_PUBLISHABLE_KEY` no Netlify.
6. Rodar novo deploy da branch.
7. Me mandar a URL do deploy de teste e os dados publicos necessarios.

## Referencias oficiais

- Netlify environment variables: https://docs.netlify.com/build/environment-variables/overview/
- Supabase API keys: https://supabase.com/docs/guides/getting-started/api-keys
- Stripe API keys: https://docs.stripe.com/keys
