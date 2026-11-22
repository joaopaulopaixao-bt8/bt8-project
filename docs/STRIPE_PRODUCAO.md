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
  - Versão da API: `2025-02-24.acacia` (a mesma fixada em `netlify/functions/lib/stripe.js`). **Obrigatório nos dois endpoints, o de teste e o de produção**: o webhook lê `charge.invoice` e `invoice.subscription` para saber se um reembolso ou uma disputa é do mensal, e esses campos mudam de lugar em versões mais novas. Com outra versão, reembolso do mensal seria tratado como se fosse do 30 dias. Para conferir: Webhooks → endpoint → "Versão da API".
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

## 3b. Fim das retentativas de cobrança

- [ ] Em **Configurações → Faturamento → Assinaturas e e-mails → Gerenciar pagamentos com falha** (recuperação de receita), em "Se todas as tentativas falharem", escolher **cancelar a assinatura** (ou, no mínimo, **marcar como não paga**). Nunca deixar "manter a assinatura como vencida" (`past_due`).
  Enquanto a assinatura está `past_due`, o código mantém o Pro só por **3 dias** depois do início do período cuja cobrança falhou (`PAST_DUE_GRACE_DAYS` em `lib/stripe.js`). Mas, se ela ficar `past_due` para sempre, o Stripe continua tentando e o registro fica pendurado. Cancelada, chega o `customer.subscription.deleted` e tudo se resolve.

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
- **Evento repetido**: antes de processar, o webhook **reserva** o `event.id` gravando `stripe_event_processed` em `app_events`. Se a reserva bater no índice único (entrega simultânea), ele sai sem processar. Se o processamento falhar, a reserva é apagada e o webhook responde 500, para o Stripe reenviar.
- **Nunca reduz Pro que outro pagamento garante**: toda mudança de plano calcula `pro_until = max(fim deste registro, maior fim entre os outros registros do usuário que ainda dão Pro)`. Contam os status `active`, `trialing`, `past_due`, `cancel_at_period_end` e `paid` com `current_period_end` no futuro. Exemplo: cancelou o mensal (fim em D) e comprou o 30 dias (fim em D+30); o `customer.subscription.deleted` em D mantém o Pro até D+30.
- **30 dias soma**: o passe vai de `max(pro_until atual, agora)` até 30 dias depois, e esse intervalo fica no registro (`metadata.granted_start`/`granted_end`). Com mensal ativo, a compra do 30 dias é recusada (409). Com o mensal já com cancelamento agendado, a compra é aceita e soma depois do fim do mensal.
- **Mensal**: o plano segue o status da assinatura (`active`, `trialing` e `past_due` = Pro; `past_due` só por 3 dias). O `current_period_end` gravado no registro é até quando aquela assinatura dá Pro (em `past_due`, o fim da carência).
- **Reembolso total ou disputa**: no 30 dias, tira só o que sobrava daquele passe, `max(0, fim - max(início, agora))`, e puxa para trás os passes comprados depois dele. Um passe antigo já vencido não tira nada. No mensal, cancela a assinatura no Stripe e tira o Pro, exceto o que outro registro ainda garante. Reembolso parcial só registra o evento.
- **Checkout abandonado**: `checkout.session.expired` marca o registro `checkout_started` como `expired`.
- **Cliente desconhecido**: se o `customer` não estiver em nenhum perfil, o webhook procura pelo `metadata.user_id` do objeto e depois pelo `user_id` gravado no cliente do Stripe.
- **Perfil não encontrado**: se a atualização do perfil não atinge nenhuma linha, o webhook responde 500 (e o Stripe reenvia) em vez de 200.
- **Cancelar assinatura que sumiu do Stripe**: só é encerrada localmente quando o registro foi gravado no mesmo modo (teste/real) da chave atual (`metadata.livemode`). Se não bater, ou se o registro for antigo e não tiver `livemode`, o app devolve erro e registra `subscription_cancel_mode_mismatch`; a limpeza é a SQL do passo 5.

## Migração necessária: índice da reserva de eventos

A reserva do `event.id` não precisa de coluna nova (usa `app_events.metadata->>'event_id'`), mas só fica à prova de entregas simultâneas com este índice único. Sem ele, o código continua funcionando, com a consulta prévia como única proteção. Entra na migração 002:

```sql
create unique index if not exists app_events_stripe_event_uidx
on public.app_events ((metadata->>'event_id'))
where event_type = 'stripe_event_processed';
```

Com o índice, a segunda reserva recebe do PostgREST `409` (código `23505`), e o webhook trata isso como evento repetido.
