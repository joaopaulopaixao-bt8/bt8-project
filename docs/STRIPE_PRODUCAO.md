# Stripe: virada do modo teste para o modo real

Checklist para ligar a cobrança de verdade do BT8 Pro. Siga na ordem. Tudo que diz "painel" é feito pelo dono no Stripe (https://dashboard.stripe.com) com o seletor **Modo de teste desligado**.

## 1. Antes de começar

- [ ] Conta Stripe verificada (dados da empresa, conta bancária, documento) e **pagamentos ativados** no modo real.
- [ ] Em **Configurações → Detalhes públicos**, preencher a URL dos termos de serviço: `https://bt8.com.br/termos-de-uso` e a da política de privacidade: `https://bt8.com.br/politica-de-privacidade`.
  O checkout usa `consent_collection[terms_of_service]=required` e o Stripe **recusa criar a sessão** se essa URL não estiver configurada. Isso vale para o modo teste também.
- [ ] Em **Configurações → Branding**, conferir nome, logo e cor que aparecem no checkout.

## 2. Produtos e preços (modo real)

Os IDs do modo teste não existem no modo real: é preciso criar tudo de novo.

- [ ] Produto **BT8 Pro** com dois preços em BRL:
  - mensal recorrente (`price_...`): vai em `BT8_STRIPE_PRO_MONTHLY_PRICE_ID`
  - pagamento único de 30 dias (`price_...`): vai em `BT8_STRIPE_PRO_30D_PRICE_ID`
- [ ] Conferir que os valores batem com os anunciados na landing e no app.

## 3. Endpoint do webhook (modo real)

- [ ] **Desenvolvedores → Webhooks → Adicionar endpoint**
  - URL: `https://bt8.com.br/.netlify/functions/stripe-webhook`
  - Versão da API: `2025-02-24.acacia` (a mesma fixada em `netlify/functions/lib/stripe.js`)
  - Eventos, exatamente estes 9 (é a lista `HANDLED_EVENTS` de `netlify/functions/stripe-webhook.js`; um teste garante que esta lista e o código batem):
    - `checkout.session.completed`
    - `checkout.session.async_payment_succeeded`
    - `checkout.session.async_payment_failed`
    - `checkout.session.expired`
    - `customer.subscription.updated`
    - `customer.subscription.deleted`
    - `invoice.payment_failed`
    - `charge.refunded`
    - `charge.dispute.created`
- [ ] Copiar o **segredo de assinatura** (`whsec_...`) do endpoint novo.

## 4. Variáveis no Netlify (contexto de produção)

Em **Site configuration → Environment variables**, só no contexto **Production**. Nunca commitar esses valores (o repositório é público).

| Variável | Valor |
|---|---|
| `BT8_STRIPE_SECRET_KEY` | `sk_live_...` (Desenvolvedores → Chaves de API) |
| `BT8_STRIPE_WEBHOOK_SECRET` | `whsec_...` do endpoint do passo 3 |
| `BT8_STRIPE_PRO_MONTHLY_PRICE_ID` | preço mensal real |
| `BT8_STRIPE_PRO_30D_PRICE_ID` | preço de 30 dias real |
| `BT8_ALLOWED_ORIGINS` | opcional: domínios extras, separados por vírgula, que podem abrir o checkout. `bt8.com.br`, `www.bt8.com.br`, o staging `mvp-pago` e `localhost:8888` já estão no código, e o Netlify injeta `URL` e `DEPLOY_PRIME_URL` sozinho |

Os contextos de staging/branch deploy continuam com as chaves `sk_test_...`.

- [ ] Depois de salvar, **fazer um novo deploy** de produção (variáveis só valem em deploys novos).

## 5. Limpar os IDs do modo teste (rodar uma vez)

Clientes e assinaturas criados no modo teste não existem no modo real. O código já se recupera sozinho (recria o cliente quando o Stripe responde `resource_missing`, e encerra a assinatura de teste quando o usuário tenta cancelá-la), mas o certo é limpar antes de abrir as vendas. Rodar no SQL do Supabase de produção, **uma vez**, logo depois do deploy do passo 4:

```sql
begin;

-- Pro que veio de pagamento de teste deixa de valer.
update public.profiles p
set plan = 'free', pro_until = null, subscription_status = null, updated_at = now()
where p.role <> 'admin'
  and p.plan = 'pro'
  and exists (select 1 from public.subscriptions s where s.user_id = p.id);

-- Clientes de teste: o checkout cria um cliente real na próxima compra.
update public.profiles set stripe_customer_id = null, updated_at = now()
where stripe_customer_id is not null;

-- Histórico de teste fica guardado, mas marcado e sem IDs que colidam com os reais.
update public.subscriptions
set status = 'test_mode',
    metadata = metadata || jsonb_build_object(
      'test_mode', true,
      'test_subscription_id', stripe_subscription_id,
      'test_payment_intent_id', stripe_payment_intent_id
    ),
    stripe_customer_id = null,
    stripe_subscription_id = null,
    stripe_payment_intent_id = null,
    updated_at = now();

commit;
```

Antes do `commit`, confira as contagens que o Supabase mostra. Se alguém recebeu Pro de cortesia sem pagamento (sem linha em `subscriptions`), a primeira query não mexe nessa pessoa.

## 6. Teste com dinheiro de verdade

- [ ] Com uma conta comum (não admin), comprar o **30 dias** com cartão real.
  - O app mostra Pro e o prazo de 30 dias.
  - No Supabase: `profiles.plan = 'pro'`, `subscriptions.status = 'paid'`.
  - No painel: **Webhooks → endpoint → eventos** com resposta 200.
- [ ] **Reembolsar** esse pagamento pelo painel (Pagamentos → Reembolsar → valor total).
  - O Pro volta ao que era antes da compra; `subscriptions.status = 'refunded'`.
- [ ] Assinar o **mensal** com cartão real e conferir o Pro até o fim do período.
- [ ] Cancelar pelo app: `subscription_status = 'cancel_at_period_end'`, Pro mantido até o fim do período.
- [ ] Reembolsar a fatura do mensal: a assinatura é cancelada no Stripe e o Pro sai na hora.

## Como o código trata cada caso

- **Só libera Pro com dinheiro confirmado**: `payment_status` precisa ser `paid` ou `no_payment_required`. Se não for, o registro fica `payment_pending` e o Pro sai em `checkout.session.async_payment_succeeded`. Por enquanto o checkout aceita só cartão (`payment_method_types[0]=card`); liberar boleto/Pix é tirar essa linha de `create-checkout.js` depois de testar o fluxo assíncrono.
- **Evento repetido**: cada `event.id` processado fica gravado em `app_events` (`event_type = 'stripe_event_processed'`) e é ignorado na segunda vez.
- **30 dias soma**: `pro_until = max(pro_until atual, agora) + 30 dias`. Com mensal ativo, a compra do 30 dias é recusada (409).
- **Mensal**: o plano segue o status da assinatura (`active`, `trialing` e `past_due` = Pro).
- **Reembolso total ou disputa**: no 30 dias, tira 30 dias do `pro_until`; no mensal, cancela a assinatura no Stripe e tira o Pro. Reembolso parcial só registra o evento.
- **Checkout abandonado**: `checkout.session.expired` marca o registro `checkout_started` como `expired`.

## Pendente: índice para idempotência sob concorrência

Hoje a checagem de `event.id` é "consulta e depois grava". Se o Stripe entregar o mesmo evento duas vezes **ao mesmo tempo** (raro), as duas podem passar. Para fechar isso de vez, a sessão que cuida das migrações pode criar este índice; nenhum código precisa mudar:

```sql
create unique index if not exists app_events_stripe_event_uidx
on public.app_events ((metadata->>'event_id'))
where event_type = 'stripe_event_processed';
```
