# Painel Admin 360 — métricas

Rota `/admin`. O front (`src/js/admin.js`) chama a Function `admin-dashboard`, que confere `profiles.role = 'admin'` no servidor e depois chama as funções agregadas da migração `supabase/migrations/003_admin_dashboard.sql` (`admin_dashboard`, `admin_customers`, `admin_customer`). Essas funções são `SECURITY DEFINER` e só a service role pode executá-las: anon e usuários logados recebem "permission denied".

Fuso de "dia" e "mês": `America/Sao_Paulo`. Admins ficam fora de todas as contagens de clientes.

## Definições

| Métrica | Definição |
|---|---|
| Pro ativo | `profiles.plan = 'pro'` e `pro_until` nulo ou no futuro, sem contar `role = 'admin'`. |
| MRR | Soma do valor mensal das assinaturas recorrentes com `stripe_subscription_id` e status `active`, `past_due` ou `cancel_at_period_end` (uma por usuário). `cancel_at_period_end` entra porque o período já foi pago; o painel mostra quantas cancelam no fim. `trialing` não entra (ainda não pagou). `checkout_started` e outras linhas sem assinatura Stripe são ignoradas. |
| Receita (do período / do mês) | Pagamentos confirmados no período (`app_events.event_type = 'payment_completed'`) menos reembolsos no período (`payment_refunded`). |
| Pro vencendo | `pro_until` nos próximos 7 dias e sem recorrente `active`/`past_due`/`trialing` (quem marcou `cancel_at_period_end` aparece). |
| Cobrança recusada | `profiles.subscription_status = 'past_due'` (gravado pelo webhook em `invoice.payment_failed`). |
| Erro novo | Mensagem de `client_error` que apareceu nas últimas 24 h e não apareceu nos 30 dias anteriores. |
| Novos x cancelados | Pessoas distintas com pagamento confirmado no período x pessoas distintas com `subscription_cancelled` no período. |
| Visitantes no limite (semana) | Linhas de `guest_usage` (escrita só pela Function `guest-usage`) com o torneio grátis usado e atividade nos últimos 7 dias. Não usa `app_events`, que o cliente pode inflar. |
| Cobrança recusada "desde" | Data do último `invoice_payment_failed`/`checkout_payment_failed` confiável do cliente. |
| Último evento do webhook | Último `stripe_event_processed` concluído (a reserva `status = 'processing'` do webhook não conta). |
| Variação | Período atual contra o mesmo trecho do período anterior (mês: dia 1 até hoje contra dia 1 até o mesmo dia do mês anterior). |

## Confiança nos eventos

Qualquer visitante consegue gravar em `app_events` (política da 001). A migração **002** (frente do banco) restringe eventos de dinheiro e webhook à service role e força `created_at = now()`; **a 003 depende dela**. Mesmo assim, a 003 se defende sozinha:

- Todo número lido de `metadata` passa por `private.admin_int()` (só 1 a 9 dígitos; o resto vira nulo). Um `amount_cents: "x"` não derruba o painel.
- `private.admin_event_trusted()` só aceita um evento de dinheiro se ele bater com uma linha de `subscriptions` (que só o backend grava): `payment_completed` e `checkout_payment_failed` pelo `checkout_session_id` e pelo usuário; `payment_refunded` e `payment_disputed` pelo `revoked_charge_id`; `subscription_cancelled` pelo `stripe_subscription_id`; `invoice_payment_failed` exige `invoice_id` `in_...` e uma recorrente do usuário. O plano usado no cálculo vem da assinatura, não do evento.
- Pagamento e reembolso repetidos (mesmo checkout, mesma cobrança) contam uma vez.
- `stripe_webhook_failed` e `stripe_event_processed` só têm checagem de formato (sem usuário, `type`/`event_id` válidos); contra falsificação deles vale a 002.
- `client_error` nunca entra em contador de dinheiro, uso ou webhook; só na lista de erros.

## Valor cobrado: estimado até o webhook gravar o valor

O webhook (PR #9) grava `payment_completed` só com `plan_type`. Enquanto o evento não trouxer o valor, o painel usa o preço de tabela (R$ 6,90 mensal, R$ 14,90 Pro 30 dias) e mostra a etiqueta **estimado**.

O SQL já lê o valor real quando ele existir. Para sair do "estimado", o webhook precisa gravar:

- `payment_completed`: `metadata.amount_cents` = `session.amount_total` (centavos, já com desconto/cupom).
- `payment_refunded`: `metadata.amount_cents` = `charge.amount_refunded`.
- Renovações mensais: tratar `invoice.paid` e gravar `payment_completed` com `plan_type = 'recurring'` e `amount_cents = invoice.amount_paid`. Hoje só a primeira cobrança (checkout) entra na receita.
- MRR: gravar `amount_cents` no `metadata` da assinatura recorrente (preço mensal vigente).
- Falhas do próprio webhook: gravar `app_events` com `event_type = 'stripe_webhook_failed'` (`metadata.type`, `metadata.error`) quando o handler devolver 500. A aba Saúde técnica já lista esse evento.

## Sem fonte de dados ainda ("não configurado")

- **Uptime**: falta um monitor externo checando `bt8.com.br` e `api.bt8.com.br` e gravando o resultado.
- **Backup**: falta o script de backup do VPS registrar data, tamanho e resultado de cada execução.

## Erros do app (`client_error`)

Agrupados por `metadata.message`; mostra também o `metadata.source` mais recente. O evento vem do `src/js/monitor.js` (frente de build).

## Testar no staging local

```bash
npm run db:start
docker exec -i supabase_db_bt8 psql -U postgres -d postgres -v ON_ERROR_STOP=1 --single-transaction < supabase/migrations/003_admin_dashboard.sql   # se o banco já existia
docker exec -i supabase_db_bt8 psql -U postgres -d postgres -v ambiente=local < supabase/seed_admin_demo.sql   # 40 clientes fictícios
npm run dev:local
```

Entrar em http://localhost:8888/admin com `admin@bt8.test` / `bt8-local-123`. O seed só roda com `-v ambiente=local`, para no primeiro erro (`ON_ERROR_STOP`, tudo numa transação) e recusa o banco se não achar o `admin@bt8.test` do seed local ou se achar qualquer e-mail fora de `.test`. As contas demo não têm senha: não dá para entrar com elas em lugar nenhum.

## Ordem de deploy em produção

A 003 se registra em `private.schema_migrations` (tabela criada pela 002).

A 003 só acrescenta (funções e índices), então vai **antes** do merge, depois da 002:

```bash
# no VPS, com backup feito antes (docs/SUPABASE_VPS.md)
psql -v ON_ERROR_STOP=1 --single-transaction -f supabase/migrations/003_admin_dashboard.sql
psql -c "NOTIFY pgrst, 'reload schema';"
```

Se a Function nova subir antes da 003, o painel mostra "Painel em atualização: falta instalar as funções do banco" (HTTP 503), sem quebrar.

## Abas novas

Funil, Uso e Suporte entram em `ADMIN_TABS` (`src/js/admin.js`) com `{ id, label, icon, render }`.
