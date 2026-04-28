# BT8 - MVP Pago

Plano pratico de implementacao para transformar o BT8 atual em um app monetizavel sem interromper a versao em producao.

## Estrategia de ambiente

### Producao
- Branch: `main`
- Site Netlify atual: continua funcionando como esta hoje.
- Supabase atual: dados reais dos usuarios.
- Stripe: modo producao somente na virada final.

### Desenvolvimento / Staging
- Branch: `mvp-pago`
- Netlify: usar Deploy Preview ou um site separado de teste.
- Stripe: usar sempre o modo teste ate a validacao final.
- Supabase: recomendado criar um projeto separado de staging.

Nao implementar regras de pagamento direto na `main`. Todo o MVP pago nasce na branch `mvp-pago`, e so vai para producao depois de validado.

## Premissas do MVP

- Visitante sem login pode gerar 1 torneio por mes.
- No segundo torneio sem login, deve ser convidado a entrar no plano Free.
- Usuario Free logado pode salvar historico limitado: 3 torneios por mes no staging.
- Usuario Pro recorrente paga R$ 6,90/mes.
- Usuario Pro 30 dias paga R$ 14,90 uma unica vez e volta para Free depois de 30 dias.
- Historico nunca e apagado quando o Pro expira; apenas fica com acesso limitado ate reativar o Pro.
- Admin precisa acompanhar usuarios, assinaturas, receita, torneios e eventos desde o inicio.

## Modelo de acesso

### Visitante
- Pode testar sem cadastro.
- Limite: 1 torneio por mes.
- Nao salva historico.
- Nao ve historico.
- Ao atingir o limite, ve convite para entrar gratis.

### Free
- Precisa estar logado.
- Pode salvar historico limitado.
- Pode criar torneios dentro do limite Free.
- Ao atingir limite, ve convite para Pro.

### Pro recorrente
- R$ 6,90/mes.
- Recorrencia mensal.
- Pode cancelar quando quiser.
- Ao cancelar, para apenas a proxima cobranca e mantem Pro ativo ate o fim do periodo pago.
- Historico completo.
- Torneios ilimitados.

### Pro 30 dias
- R$ 14,90.
- Pagamento unico.
- Libera Pro por 30 dias.
- Pode assinar o mensal antes do vencimento; a primeira cobranca mensal fica agendada para o fim dos 30 dias.
- Depois volta automaticamente para Free.
- Historico criado durante o periodo Pro continua salvo.

## Sprint 0 - Preparacao segura

Objetivo: preparar a branch e o ambiente de testes sem afetar producao.

Tarefas:
- [x] Criar branch `mvp-pago` no GitHub.
- [x] Fazer checkout local da branch `mvp-pago`.
- [x] Separar configuracao publica de ambiente em `src/js/env.js`.
- [x] Fazer o build do Netlify gerar `dist/js/env.js` com variaveis da branch.
- [x] Criar guia manual de configuracao em `docs/STAGING_SETUP.md`.
- [x] Forcar contexto `branch-deploy` e branch `mvp-pago` para usar Supabase staging.
- [ ] Confirmar Deploy Preview da branch no Netlify.
- [x] Criar ou escolher projeto Supabase de staging.
- [ ] Configurar Stripe em modo teste.
- [ ] Levantar variaveis necessarias de ambiente.
- [ ] Validar build atual da branch antes de qualquer mudanca funcional.

Entrega:
- Branch de trabalho pronta.
- Producao preservada na `main`.
- Checklist de ambiente definido.

## Sprint 1 - Auditoria de seguranca e base de planos

Objetivo: garantir que permissao e plano nao dependam apenas do JavaScript publico.

Tarefas:
- [ ] Auditar tabelas atuais do Supabase.
- [x] Confirmar RLS em `profiles`, `tournaments` e `app_events` no SQL de staging.
- [ ] Garantir que usuario so le/escreve seus proprios torneios.
- [ ] Criar/ajustar campos em `profiles`:
  - `plan`
  - `role`
  - `pro_until`
  - `stripe_customer_id`
  - `subscription_status`
  - `updated_at`
- [ ] Criar tabela `subscriptions`.
- [x] Criar tabela `app_events` e padronizar o front para gravar nela com fallback legado.
- [x] Criar SQL versionado da Sprint 1 em `supabase/migrations/001_paid_mvp_staging.sql`.
- [x] Criar funcao central no front para calcular acesso: visitante, Free, Pro ativo, Pro expirado e Admin.

Entrega:
- Estrutura Free/Pro/Admin pronta.
- Base segura para salvar limites e assinaturas.

## Sprint 2 - Limites de visitante e Free

Objetivo: transformar o teste sem cadastro em entrada controlada para login.

Tarefas:
- [x] Criar tabela `guest_usage`.
- [x] Criar funcao backend para validar limite de visitante.
- [x] Identificar visitante por `guest_id` local + hash de IP + hash de user agent.
- [x] Nao armazenar IP puro.
- [x] Antes de gerar torneio sem login, validar se ainda pode usar o teste mensal.
- [x] Ao bloquear visitante, mostrar mensagem:
  - "Seu teste gratis deste mes ja foi usado. Entre gratis para continuar criando torneios no BT8."
- [x] Aplicar limite Free logado no salvamento/historico.
- [x] Criar mensagens de upgrade para Free.

Entrega:
- Visitante limitado a 1 torneio por mes.
- Free logado funcionando com limite.
- Pro ainda pode ser simulado manualmente no banco para teste.

## Sprint 3 - Eventos e BI

Objetivo: registrar eventos importantes para o Admin e decisao de negocio.

Eventos minimos:
- `guest_tournament_created`
- `guest_limit_reached`
- `signup_started`
- `signup_completed`
- `login_completed`
- `free_tournament_saved`
- `free_limit_reached`
- `upgrade_clicked`
- `checkout_started`
- `payment_completed`
- `subscription_cancelled`
- `pro_expired`
- `tournament_created`
- `tournament_finished`
- `ranking_image_downloaded`
- `ranking_shared`

Tarefas:
- [x] Padronizar `trackEvent`.
- [x] Registrar eventos iniciais de visitante, Free e Pro.
- [x] Registrar eventos de cadastro e login por e-mail.
- [x] Registrar modalidade e quantidade de participantes quando criar torneio.
- [x] Registrar finalizacao de torneio.
- [x] Registrar download/compartilhamento do ranking.

Entrega:
- Dados suficientes para dashboard admin inicial.

## Sprint 4 - Stripe em modo teste

Objetivo: criar fluxo de pagamento sem dinheiro real.

Produtos Stripe teste:
- BT8 Pro Mensal: R$ 6,90 recorrente mensal.
- BT8 Pro 30 Dias: R$ 14,90 pagamento unico.

Tarefas:
- [ ] Criar produtos/precos no Stripe test.
- [x] Criar funcao backend para iniciar checkout.
- [x] Agendar mensalidade apos vencimento do Pro 30 dias usando `billing_cycle_anchor` ate `pro_until`.
- [x] Criar funcao backend para cancelar recorrencia mensal no fim do periodo.
- [x] Criar webhook Stripe.
- [x] Validar eventos:
  - `checkout.session.completed`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
  - `invoice.payment_succeeded`
  - `invoice.payment_failed`
- [x] Atualizar Supabase somente via webhook/backend.
- [x] Nunca ativar Pro diretamente no front.

Entrega:
- Checkout testavel.
- Plano Pro ativado por confirmacao real do Stripe.

## Sprint 5 - Experiencia de upgrade

Objetivo: fazer o usuario entender o valor do Pro no momento certo.

Tarefas:
- [x] Criar tela/modal de planos.
- [x] Exibir plano atual no menu, Meu Perfil e modal de planos.
- [x] Adicionar CTA para Pro/no cadastro no limite de visitante.
- [x] Adicionar CTA para Pro no limite Free.
- [x] Adicionar aviso para Pro expirado.
- [ ] Ajustar landing com secao de precos.
- [x] Explicar que o historico nao e perdido quando o Pro expira.

Entrega:
- Fluxo comercial completo dentro do app.

## Sprint 6 - Admin MVP

Objetivo: painel de controle para operacao, vendas e indicadores.

Telas:
- Visao geral.
- Usuarios.
- Assinaturas.
- Torneios / uso.

Indicadores minimos:
- Usuarios totais.
- Novos usuarios no mes.
- Free ativos.
- Pro recorrentes ativos.
- Pro 30 dias ativos.
- Pro expirados.
- Receita estimada mensal.
- Receita dos ultimos 30 dias.
- Torneios criados no mes.
- Torneios sem login.
- Bloqueios por limite visitante.
- Bloqueios por limite Free.
- Modalidades mais usadas.

Seguranca:
- Admin validado por `role = admin`.
- Regra real no banco/backend, nao apenas `email === ADMIN_EMAIL` no front.
- Usuario comum nao pode ler dados administrativos.

Entrega:
- Voce consegue acompanhar crescimento, uso e receita desde o primeiro dia.

## Sprint 7 - Testes de ponta a ponta

Cenarios obrigatorios:
- [ ] Visitante cria primeiro torneio.
- [ ] Visitante tenta criar segundo torneio no mes e e bloqueado.
- [ ] Visitante cria conta Free.
- [ ] Free salva torneio dentro do limite.
- [ ] Free bate limite e ve upgrade.
- [ ] Free assina Pro recorrente em modo teste.
- [ ] Free compra Pro 30 dias em modo teste.
- [ ] Pro 30 dias agenda Pro mensal antes do vencimento, com cobranca so no vencimento.
- [ ] Pro recorrente cancela recorrencia e continua Pro ate o fim do periodo.
- [ ] Pro 30 dias expira.
- [ ] Historico Pro continua salvo apos expirar.
- [ ] Usuario comum nao acessa Admin.
- [ ] Admin ve usuarios, assinaturas, torneios e eventos.
- [ ] Usuario nao acessa torneio de outro usuario.

Entrega:
- MVP pago validado em staging.

## Sprint 8 - Virada para producao

Tarefas:
- [ ] Backup do Supabase producao.
- [ ] Configurar variaveis reais no Netlify.
- [ ] Configurar produtos reais no Stripe.
- [ ] Configurar webhook real no Stripe.
- [ ] Aplicar migracoes no Supabase producao.
- [ ] Merge `mvp-pago` -> `main`.
- [ ] Deploy.
- [ ] Teste real de pagamento.
- [ ] Conferir Admin depois do pagamento.

Plano de volta:
- Manter commit anterior da `main` identificado.
- Se houver problema critico, reverter deploy no Netlify ou reverter merge.

## Variaveis previstas

Frontend publico:
- `BT8_APP_ENV`
- `BT8_SUPABASE_URL`
- `BT8_SUPABASE_ANON_KEY`
- `BT8_STRIPE_PUBLISHABLE_KEY`, se necessario no front.

Backend / Netlify Functions / Edge Functions:
- `SUPABASE_SERVICE_ROLE_KEY`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `GUEST_USAGE_HASH_SECRET`

Nunca expor no front:
- `SUPABASE_SERVICE_ROLE_KEY`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `GUEST_USAGE_HASH_SECRET`

## Decisoes tecnicas iniciais

- Preferir Netlify Functions para Stripe checkout, webhook e limite de visitante, porque o app ja esta no Netlify.
- Manter o frontend atual em HTML/CSS/JS neste MVP.
- Evitar reescrever o app em framework agora.
- Centralizar regras de plano em poucos arquivos novos para reduzir risco.
- Subir para producao somente depois do fluxo completo validado em staging.
