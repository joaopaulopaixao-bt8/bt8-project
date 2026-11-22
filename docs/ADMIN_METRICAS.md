# Painel Admin 360 — métricas

Rota `/admin`. O front (`src/js/admin.js`) chama a Function `admin-dashboard`, que confere `profiles.role = 'admin'` no servidor e depois chama as funções agregadas da migração `supabase/migrations/003_admin_dashboard.sql` (`admin_dashboard`, `admin_customers`, `admin_customer`). Essas funções são `SECURITY DEFINER` e só a service role pode executá-las: anon e usuários logados recebem "permission denied".

Fuso de "dia" e "mês": `America/Sao_Paulo`. Admins ficam fora de todas as contagens de clientes.

## Definições

| Métrica | Definição |
|---|---|
| Pro ativo | `profiles.plan = 'pro'` e `pro_until` nulo ou no futuro, sem contar `role = 'admin'`. |
| MRR | Soma do valor mensal das assinaturas recorrentes com status `active` ou `past_due` (só a última assinatura de cada usuário). |
| Receita (do período / do mês) | Pagamentos confirmados no período (`app_events.event_type = 'payment_completed'`) menos reembolsos no período (`payment_refunded`). |
| Pro vencendo | `pro_until` nos próximos 7 dias e sem recorrente `active`/`past_due`. |
| Cobrança recusada | `profiles.subscription_status = 'past_due'` (gravado pelo webhook em `invoice.payment_failed`). |
| Erro novo | Mensagem de `client_error` que apareceu nas últimas 24 h e não apareceu nos 30 dias anteriores. |
| Novos x cancelados | Pagamentos confirmados no período x eventos `subscription_cancelled` no período. |
| Variação | Período atual contra o mesmo trecho do período anterior (mês: dia 1 até hoje contra dia 1 até o mesmo dia do mês anterior). |

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
docker exec -i supabase_db_bt8 psql -U postgres -d postgres < supabase/migrations/003_admin_dashboard.sql   # se o banco já existia
docker exec -i supabase_db_bt8 psql -U postgres -d postgres < supabase/seed_admin_demo.sql                 # 40 clientes fictícios
npm run dev:local
```

Entrar em http://localhost:8888/admin com `admin@bt8.test` / `bt8-local-123`. O seed só roda no banco local (recusa se achar o admin de produção ou não achar o `admin@bt8.test`).

## Abas novas

Funil, Uso e Suporte entram em `ADMIN_TABS` (`src/js/admin.js`) com `{ id, label, icon, render }`.
