// ══════════════════════════════════════════════════
// ADMIN 360 — rota /admin, login de admin e painel.
// Os dados vêm da Function admin-dashboard, que valida role = 'admin' no servidor.
// Métricas definidas em docs/ADMIN_METRICAS.md.
// ══════════════════════════════════════════════════

Object.assign(ICON_PATHS, {
  grid: '<rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/>',
  wallet: '<path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1"/><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"/>',
  activity: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  arrowLeft: '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>'
});

// ── Rota /admin e login ───────────────────────────
function isAdminRoute() {
  return window.location.pathname.replace(/\/+$/, '') === '/admin';
}

function openAdminRoute() {
  closeUserMenu();
  if (!isAdminRoute()) window.history.pushState({}, '', '/admin');
  if (SUPA_USER) openAdmin();
  else showAdminRouteLogin();
}

function ensureAdminRouteShell() {
  let shell = document.getElementById('admin-route-shell');
  if (!shell) {
    shell = document.createElement('div');
    shell.id = 'admin-route-shell';
    document.body.appendChild(shell);
  }
  shell.style.display = 'flex';
  return shell;
}

function adminRouteCard(title, body, actions = '') {
  return `
    <div class="adm-card">
      <div class="adm-card-brand">BT8 ADMIN</div>
      <div class="adm-card-sub">Acesso exclusivo de administradores</div>
      <div class="adm-card-title">${title}</div>
      <div class="adm-card-body">${body}</div>
      ${actions}
    </div>`;
}

function showAdminRouteLoading() {
  ensureAdminRouteShell().innerHTML = adminRouteCard('Carregando painel', 'Validando sua sessão administrativa...');
}

function showAdminRouteLogin() {
  const shell = ensureAdminRouteShell();
  const lastEmail = localStorage.getItem('bt8-admin-email') || '';
  shell.innerHTML = adminRouteCard(
    'Entrar como Admin',
    'Use o login da conta marcada como Admin para abrir o painel de controle.',
    `
      <label class="adm-label" for="admin-login-email">E-mail</label>
      <input id="admin-login-email" class="adm-input" type="email" autocomplete="email" value="${escapeHtml(lastEmail)}">
      <label class="adm-label" for="admin-login-password">Senha</label>
      <div class="password-wrap" style="margin-bottom:14px;">
        <input id="admin-login-password" class="password-input adm-input" style="margin:0;padding-right:48px;" type="password" autocomplete="current-password" onkeydown="if(event.key==='Enter')adminRouteLogin()">
        <button class="password-toggle" type="button" aria-label="Mostrar senha" onclick="togglePasswordVisibility('admin-login-password', this)">${icon('eye')}</button>
      </div>
      <button class="adm-btn-primary" onclick="adminRouteLogin()">ENTRAR COMO ADMIN</button>
      <div id="admin-route-msg" class="adm-msg"></div>
      <button class="adm-btn-link" onclick="window.location.href='/'">Voltar ao app</button>
    `
  );
  const email = document.getElementById('admin-login-email');
  const password = document.getElementById('admin-login-password');
  if (lastEmail && password) password.focus();
  else if (email) email.focus();
}

async function adminRouteLogin() {
  const msg = document.getElementById('admin-route-msg');
  const email = document.getElementById('admin-login-email')?.value.trim();
  const password = document.getElementById('admin-login-password')?.value;
  if (msg) msg.textContent = '';
  if (!email || !password) {
    if (msg) msg.textContent = 'Informe e-mail e senha.';
    return;
  }
  if (!SUPA) {
    if (msg) msg.textContent = 'Supabase ainda não carregou. Tente novamente.';
    return;
  }
  if (msg) {
    msg.style.color = 'var(--muted2)';
    msg.textContent = 'Validando acesso...';
  }
  const { error } = await SUPA.auth.signInWithPassword({ email, password });
  if (error) {
    if (msg) {
      msg.style.color = '#f87171';
      msg.textContent = typeof translateAuthError === 'function' ? translateAuthError(error.message) : 'E-mail ou senha incorretos';
    }
    return;
  }
  localStorage.setItem('bt8-admin-email', email);
  showAdminRouteLoading();
}

function showAdminRouteDenied() {
  ensureAdminRouteShell().innerHTML = adminRouteCard(
    'Acesso restrito',
    'Esta conta não está marcada como Admin. Saia desta conta ou volte para o app normal.',
    `
      <button class="adm-btn-primary" onclick="logoutUser()">SAIR DA CONTA</button>
      <button class="adm-btn-link" onclick="window.location.href='/'">Voltar ao app</button>
    `
  );
}

function closeAdminModal() {
  document.getElementById('admin-panel')?.remove();
  if (isAdminRoute()) window.location.href = '/';
}

// ── Formatação ────────────────────────────────────
const ADM_MONEY = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const admMoney = cents => ADM_MONEY.format(Number(cents || 0) / 100);
const admDate = value => value
  ? new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' }).format(new Date(value))
  : '–';
const admDateTime = value => value
  ? new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(value))
  : '–';
const ADM_PLAN_LABEL = { recurring: 'Pro mensal', one_time_30d: 'Pro 30 dias', pro: 'Pro', free: 'Free', admin: 'Admin' };
const ADM_STATUS_LABEL = {
  active: 'ativa', past_due: 'cobrança recusada', paid: 'paga', canceled: 'cancelada', refunded: 'reembolsada',
  disputed: 'contestada', cancel_at_period_end: 'cancela no fim do período', trialing: 'em teste', payment_pending: 'pagamento pendente', payment_failed: 'pagamento falhou', expired: 'expirada',
  checkout_started: 'checkout iniciado', superseded: 'substituída', admin_blocked: 'bloqueada (admin)', pending: 'pendente'
};
const ADM_EVENT_LABEL = {
  payment_completed: 'Pagamento confirmado', payment_refunded: 'Reembolso', payment_disputed: 'Contestação',
  subscription_cancelled: 'Assinatura cancelada', invoice_payment_failed: 'Cobrança recusada',
  checkout_payment_failed: 'Pagamento do checkout falhou'
};
const admEst = flag => flag ? '<span class="adm-tag">estimado</span>' : '';

function admDelta(cur, prev, suffix = 'vs. período anterior') {
  if (!prev) return `<span class="adm-delta">sem base anterior</span>`;
  const pct = Math.round(((cur - prev) / prev) * 100);
  const cls = pct > 0 ? 'up' : pct < 0 ? 'down' : '';
  return `<span class="adm-delta ${cls}">${pct > 0 ? '+' : ''}${pct}% ${suffix}</span>`;
}

function admSection(title, body, extra = '') {
  return `<section class="adm-section"><header class="adm-section-head"><h3>${title}</h3>${extra}</header>${body}</section>`;
}

const admEmpty = text => `<div class="adm-empty">${text}</div>`;

// ── Estado e carregamento ─────────────────────────
const ADMIN = { tab: 'overview', period: 'mes', data: null, customers: null, search: '', customer: null };

// Abas novas (Funil, Uso, Suporte) entram aqui com { id, label, icon, render }.
const ADMIN_TABS = [
  { id: 'overview', label: 'Visão geral', icon: 'grid', render: renderAdminOverview },
  { id: 'revenue', label: 'Receita', icon: 'wallet', render: renderAdminRevenue },
  { id: 'customers', label: 'Clientes', icon: 'users', render: renderAdminCustomers },
  { id: 'health', label: 'Saúde técnica', icon: 'activity', render: renderAdminHealth }
];

async function adminFetch(params) {
  const { data: sessionData } = await SUPA.auth.getSession();
  const token = sessionData?.session?.access_token;
  if (!token) throw new Error('Sessão inválida. Faça login novamente.');
  const response = await fetch(`/.netlify/functions/admin-dashboard?${new URLSearchParams(params)}`, {
    headers: { authorization: `Bearer ${token}` }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Erro ao carregar Admin.');
  return data;
}

// Acesso: usuário precisa ter role=admin no perfil; o backend valida de novo.
async function openAdmin() {
  closeUserMenu();
  if (!SUPA || !SUPA_USER) return;
  const access = typeof currentAccess === 'function' ? currentAccess() : null;
  if (!access?.isAdmin && SUPA_USER.email !== ADMIN_EMAIL) {
    alert('Acesso restrito.');
    return;
  }
  document.getElementById('admin-panel')?.remove();
  const panel = document.createElement('div');
  panel.id = 'admin-panel';
  panel.innerHTML = `
    <div class="adm-wrap">
      <header class="adm-top">
        <div class="adm-brand">BT8 <span>ADMIN</span></div>
        <div class="adm-period" role="group" aria-label="Período">
          ${[['7d', '7 dias'], ['30d', '30 dias'], ['mes', 'Mês']].map(([id, label]) =>
            `<button data-period="${id}" onclick="setAdminPeriod('${id}')">${label}</button>`).join('')}
        </div>
        <button class="adm-icon-btn" onclick="loadAdminData()" aria-label="Atualizar">${icon('refresh')}</button>
        <button class="adm-icon-btn" onclick="closeAdminModal()" aria-label="Fechar painel">${icon('x')}</button>
      </header>
      <nav class="adm-tabs" role="tablist">
        ${ADMIN_TABS.map(t => `<button role="tab" data-tab="${t.id}" onclick="setAdminTab('${t.id}')">${icon(t.icon)}<span>${t.label}</span></button>`).join('')}
      </nav>
      <main id="admin-tab-content" class="adm-content"><div class="adm-empty">Carregando dados...</div></main>
    </div>`;
  document.body.appendChild(panel);
  const shell = document.getElementById('admin-route-shell');
  if (shell) shell.style.display = 'none';
  await loadAdminData();
}

async function loadAdminData() {
  const target = document.getElementById('admin-tab-content');
  try {
    ADMIN.data = await adminFetch({ period: ADMIN.period });
    renderAdmin();
  } catch (e) {
    if (target) target.innerHTML = `<div class="adm-error">Erro ao carregar: ${escapeHtml(e.message)}</div>`;
  }
}

function setAdminPeriod(period) {
  ADMIN.period = period;
  loadAdminData();
}

function setAdminTab(tab) {
  ADMIN.tab = tab;
  ADMIN.customer = null;
  renderAdmin();
}

function renderAdmin() {
  document.querySelectorAll('#admin-panel [data-tab]').forEach(b => b.setAttribute('aria-selected', b.dataset.tab === ADMIN.tab));
  document.querySelectorAll('#admin-panel [data-period]').forEach(b => b.classList.toggle('on', b.dataset.period === ADMIN.period));
  const target = document.getElementById('admin-tab-content');
  if (!target || !ADMIN.data) return;
  (ADMIN_TABS.find(t => t.id === ADMIN.tab) || ADMIN_TABS[0]).render(target, ADMIN.data);
}

const ADM_PERIOD_LABEL = { '7d': 'últimos 7 dias', '30d': 'últimos 30 dias', mes: 'mês até hoje' };

// ── Visão geral ───────────────────────────────────
function adminAlerts(d) {
  const n = d.needs_you || {};
  const items = [];
  if (n.declined?.length) items.push(`${n.declined.length} cobrança(s) recusada(s)`);
  if (n.new_errors?.length) items.push(`${n.new_errors.length} erro(s) novo(s) no app`);
  if (d.health?.webhook_failures?.length) items.push(`${d.health.webhook_failures.length} falha(s) no webhook Stripe`);
  if (!items.length) return '';
  return `<div class="adm-alert" role="alert">${icon('alert')}<span>${items.join(' · ')}</span></div>`;
}

function adminKpi(label, value, foot, est = false) {
  return `<div class="adm-kpi"><div class="adm-kpi-label">${label}${admEst(est)}</div><div class="adm-kpi-value">${value}</div><div class="adm-kpi-foot">${foot}</div></div>`;
}

function adminRevenueChart(daily, period) {
  // Largura real do painel, para o texto do SVG não encolher no celular.
  const W = Math.min(1060, Math.max(300, (document.getElementById('admin-tab-content')?.clientWidth || 640) - 30));
  const H = W < 500 ? 180 : 220, PL = 8, PR = 8, PT = 16, PB = 22;
  const n = daily.length;
  if (!n) return admEmpty('Sem dados no período.');
  const acc = key => {
    let sum = 0;
    return daily.map(p => (p[key] === null ? null : (sum += p[key])));
  };
  const cur = acc('cur'), prev = acc('prev');
  const max = Math.max(1, ...cur.filter(v => v !== null), ...prev.filter(v => v !== null));
  const x = i => PL + (n === 1 ? 0 : (i * (W - PL - PR)) / (n - 1));
  const y = v => PT + (H - PT - PB) * (1 - v / max);
  const path = arr => arr.map((v, i) => (v === null ? null : `${x(i).toFixed(1)},${y(v).toFixed(1)}`))
    .filter(Boolean).map((p, i) => (i ? 'L' : 'M') + p).join(' ');
  const lastCur = cur.reduce((last, v, i) => (v === null ? last : i), -1);
  const day = s => new Date(`${s}T12:00:00`).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  const ticks = [0, Math.floor((n - 1) / 2), n - 1].map(i =>
    `<text x="${x(i)}" y="${H - 6}" text-anchor="${i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}">${day(daily[i].day)}</text>`).join('');
  const prevLabel = period === 'mes' ? 'mês anterior' : 'período anterior';
  return `
    <div class="adm-legend"><span class="cur"></span>Atual <span class="prev"></span>${prevLabel} <em>acumulado por dia</em></div>
    <svg class="adm-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Receita acumulada por dia, período atual contra o anterior">
      <line x1="${PL}" x2="${W - PR}" y1="${H - PB}" y2="${H - PB}" class="axis"/>
      <text x="${PL}" y="11" class="max">${admMoney(max)}</text>
      <path d="${path(prev)}" class="prev"/>
      <path d="${path(cur)}" class="cur"/>
      ${lastCur >= 0 ? `<circle cx="${x(lastCur)}" cy="${y(cur[lastCur])}" r="3.5" class="dot"><title>${day(daily[lastCur].day)}: ${admMoney(cur[lastCur])}</title></circle>` : ''}
      ${ticks}
    </svg>`;
}

function adminNeedsYou(n) {
  const rows = [
    ...(n.declined || []).map(c => ({ kind: 'Cobrança recusada', who: c.nome || c.email, meta: `${c.email || ''} · desde ${admDate(c.since)}`, id: c.id })),
    ...(n.expiring || []).map(c => ({ kind: 'Pro vence', who: c.nome || c.email, meta: `${c.email || ''} · vence ${admDate(c.pro_until)}`, id: c.id })),
    ...(n.new_errors || []).slice(0, 3).map(e => ({ kind: 'Erro novo', who: e.message, meta: `${e.total}x desde ${admDateTime(e.first_at)}`, tab: 'health' }))
  ];
  const moreErrors = (n.new_errors || []).length - 3;
  if (moreErrors > 0) rows.push({ kind: 'Erro novo', who: `Mais ${moreErrors} erro(s) novo(s)`, meta: 'Ver todos em Saúde técnica', tab: 'health' });
  if (!rows.length) return admEmpty('Nada pendente agora.');
  return `<ul class="adm-list">${rows.map(r => `
    <li><button class="adm-row" onclick="${r.id ? `openAdminCustomer('${r.id}')` : `setAdminTab('${r.tab}')`}">
      <span class="adm-pill">${r.kind}</span>
      <span class="adm-row-main"><strong>${escapeHtml(r.who)}</strong><small>${escapeHtml(r.meta)}</small></span>
    </button></li>`).join('')}</ul>`;
}

function adminBars(rows) {
  if (!rows.length) return admEmpty('Sem uso registrado.');
  const max = Math.max(...rows.map(r => r.value), 1);
  return `<ul class="adm-bars">${rows.map(r => `
    <li><span class="adm-bar-label">${escapeHtml(r.label)}</span><span class="adm-bar-value">${r.value}</span>
    <span class="adm-bar-track"><span style="width:${(r.value / max) * 100}%"></span></span></li>`).join('')}</ul>`;
}

function renderAdminOverview(target, d) {
  const k = d.kpis || {};
  const u = d.usage_week || {};
  const usage = [
    { label: 'Torneios criados', value: u.tournaments || 0 },
    ...(u.by_mode || []).map(m => ({ label: `· ${MODE_INFO[m.mode]?.label || m.mode}`, value: m.count })),
    { label: 'Usuários com torneio', value: u.active_users || 0 },
    { label: 'Visitantes que bateram o limite', value: u.guests_at_limit || 0 },
    { label: 'Bloqueios do Free', value: u.free_limit_blocks || 0 }
  ];
  target.innerHTML = `
    ${adminAlerts(d)}
    <div class="adm-kpis">
      ${adminKpi('Receita', admMoney(k.revenue_cents), admDelta(k.revenue_cents, k.revenue_prev_cents), k.revenue_estimated)}
      ${adminKpi('MRR', admMoney(k.mrr_cents), k.mrr_cancelling ? `recorrentes ativas · ${k.mrr_cancelling} cancela(m) no fim do período` : 'recorrentes ativas', k.mrr_estimated)}
      ${adminKpi('Pro ativos', k.pro_active ?? 0, `<span class="adm-delta">+${k.pro_new || 0} novo(s) · −${k.pro_lost || 0} saída(s)</span>`)}
      ${adminKpi('Cadastros', k.signups ?? 0, admDelta(k.signups, k.signups_prev))}
    </div>
    <div class="adm-period-note">Período: ${ADM_PERIOD_LABEL[d.period] || ''}</div>
    ${admSection('Receita por dia', adminRevenueChart(d.daily || [], d.period), admEst(k.revenue_estimated))}
    <div class="adm-cols">
      ${admSection('Precisa de você', adminNeedsYou(d.needs_you || {}))}
      ${admSection('Uso da semana', adminBars(usage))}
    </div>
    ${adminFooter(d)}`;
}

function adminFooter(d) {
  return `<footer class="adm-foot">
    <span>Último backup: ${d.ops?.last_backup_at ? admDateTime(d.ops.last_backup_at) : 'não configurado'}</span>
    <span>Erros 24 h: ${d.health?.errors_24h_total ?? 0}</span>
    <span>Atualizado às ${new Date(d.generated_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>
  </footer>`;
}

// ── Receita ───────────────────────────────────────
function renderAdminRevenue(target, d) {
  const r = d.revenue || {};
  const k = d.kpis || {};
  const plans = (r.by_plan || []).map(p => `
    <tr><td>${ADM_PLAN_LABEL[p.plan_type] || p.plan_type}</td><td>${p.active}</td><td>${p.payments}</td><td>${admMoney(p.gross_cents)}</td></tr>`).join('');
  const recent = (r.recent || []).map(m => `
    <li class="adm-row static">
      <span class="adm-pill ${m.kind === 'refund' ? 'neg' : ''}">${m.kind === 'refund' ? 'Reembolso' : 'Pagamento'}</span>
      <span class="adm-row-main"><strong>${escapeHtml(m.nome || m.email || 'Sem cadastro')}</strong>
      <small>${ADM_PLAN_LABEL[m.plan_type] || '–'} · ${admDateTime(m.created_at)}</small></span>
      <span class="adm-row-num">${m.kind === 'refund' ? '−' : ''}${admMoney(m.amount_cents)}</span>
    </li>`).join('');
  const anyEstimate = r.month_estimated || k.mrr_estimated || k.revenue_estimated;
  target.innerHTML = `
    <div class="adm-kpis">
      ${adminKpi('Receita do mês', admMoney(r.month_cents), 'pagamentos − reembolsos', r.month_estimated)}
      ${adminKpi('MRR', admMoney(k.mrr_cents), `mensais ativas${k.mrr_cancelling ? ` · ${k.mrr_cancelling} cancela(m) no fim` : ''}`, k.mrr_estimated)}
      ${adminKpi('Novos x cancelados', `${r.new_count || 0} <small>x</small> ${r.cancelled_count || 0}`, ADM_PERIOD_LABEL[d.period])}
      ${adminKpi('Reembolsos', admMoney(r.refunds_cents), `${r.refunds_count || 0} reembolso(s) · ${r.disputes_count || 0} contestação(ões)`, r.refunds_count > 0 && k.revenue_estimated)}
    </div>
    ${anyEstimate ? `<div class="adm-note">${icon('alert')}<span><strong>Valores estimados.</strong> O webhook ainda não grava o valor cobrado, então o painel usa o preço de tabela (R$ 6,90 mensal, R$ 14,90 30 dias). Renovações mensais também ainda não geram evento de pagamento.</span></div>` : ''}
    ${admSection('Por plano', `<div class="adm-table-wrap"><table class="adm-table"><thead><tr><th>Plano</th><th>Ativos</th><th>Pagamentos</th><th>Bruto</th></tr></thead><tbody>${plans}</tbody></table></div>`, `<small class="adm-muted">${ADM_PERIOD_LABEL[d.period]}</small>`)}
    ${admSection('Movimentos recentes', recent ? `<ul class="adm-list">${recent}</ul>` : admEmpty('Nenhum pagamento no período.'))}
    ${adminFooter(d)}`;
}

// ── Clientes ──────────────────────────────────────
let adminSearchTimer = null;
function adminSearchInput(value) {
  ADMIN.search = value;
  clearTimeout(adminSearchTimer);
  adminSearchTimer = setTimeout(() => loadAdminCustomers(), 300);
}

async function loadAdminCustomers() {
  const list = document.getElementById('adm-customer-list');
  try {
    ADMIN.customers = (await adminFetch({ view: 'customers', q: ADMIN.search })).customers || [];
    if (list) list.innerHTML = adminCustomerRows(ADMIN.customers);
  } catch (e) {
    if (list) list.innerHTML = `<div class="adm-error">${escapeHtml(e.message)}</div>`;
  }
}

function adminCustomerRows(rows) {
  if (!rows.length) return admEmpty('Nenhum cliente encontrado.');
  return `<div class="adm-table-wrap"><table class="adm-table adm-customers">
    <thead><tr><th>Cliente</th><th>Plano</th><th>Vencimento</th><th>Último torneio</th><th>Torneios</th></tr></thead>
    <tbody>${rows.map(c => `
      <tr onclick="openAdminCustomer('${c.id}')" tabindex="0" onkeydown="if(event.key==='Enter')openAdminCustomer('${c.id}')">
        <td><strong>${escapeHtml(c.nome || '–')}</strong><small>${escapeHtml(c.email || '')}</small></td>
        <td data-label="Plano"><span class="adm-plan ${c.plan}">${ADM_PLAN_LABEL[c.plan] || c.plan}</span>${c.subscription_status === 'past_due' ? '<small class="adm-warn">cobrança recusada</small>' : ''}</td>
        <td data-label="Vencimento">${c.plan === 'free' || c.plan === 'admin' ? '–' : admDate(c.pro_until)}</td>
        <td data-label="Último torneio">${admDate(c.last_tournament_at)}</td>
        <td data-label="Torneios">${c.tournaments_total || 0}</td>
      </tr>`).join('')}</tbody></table></div>`;
}

function renderAdminCustomers(target) {
  if (ADMIN.customer) return renderAdminCustomerCard(target, ADMIN.customer);
  target.innerHTML = `
    <label class="adm-search">${icon('search')}<input type="search" placeholder="Buscar por nome ou e-mail" value="${escapeHtml(ADMIN.search)}" oninput="adminSearchInput(this.value)" aria-label="Buscar cliente"></label>
    <div id="adm-customer-list">${ADMIN.customers ? adminCustomerRows(ADMIN.customers) : admEmpty('Carregando clientes...')}</div>`;
  if (!ADMIN.customers) loadAdminCustomers();
}

async function openAdminCustomer(id) {
  ADMIN.tab = 'customers';
  const target = document.getElementById('admin-tab-content');
  document.querySelectorAll('#admin-panel [data-tab]').forEach(b => b.setAttribute('aria-selected', b.dataset.tab === 'customers'));
  if (target) target.innerHTML = admEmpty('Carregando ficha...');
  try {
    ADMIN.customer = await adminFetch({ view: 'customer', id });
    renderAdmin();
  } catch (e) {
    if (target) target.innerHTML = `<div class="adm-error">${escapeHtml(e.message)}</div>`;
  }
}

function closeAdminCustomer() {
  ADMIN.customer = null;
  renderAdmin();
}

function renderAdminCustomerCard(target, c) {
  const p = c.profile || {};
  const field = (label, value) => `<div><dt>${label}</dt><dd>${escapeHtml(value || '–')}</dd></div>`;
  const subs = (c.subscriptions || []).map(s => `
    <tr><td>${ADM_PLAN_LABEL[s.plan_type] || s.plan_type}</td><td>${ADM_STATUS_LABEL[s.status] || escapeHtml(s.status)}${s.cancel_at_period_end === true ? ' <small>(cancela no fim)</small>' : ''}</td>
    <td>${admDate(s.created_at)}</td><td>${admDate(s.current_period_end)}</td></tr>`).join('');
  const events = (c.payments || []).map(e => `
    <li class="adm-row static"><span class="adm-pill ${['payment_completed'].includes(e.event_type) ? '' : 'neg'}">${ADM_EVENT_LABEL[e.event_type] || escapeHtml(e.event_type)}</span>
    <span class="adm-row-main"><small>${admDateTime(e.created_at)}${e.metadata?.plan_type ? ' · ' + (ADM_PLAN_LABEL[e.metadata.plan_type] || '') : ''}</small></span></li>`).join('');
  target.innerHTML = `
    <button class="adm-back" onclick="closeAdminCustomer()">${icon('arrowLeft')} Clientes</button>
    <div class="adm-profile-head">
      <h2>${escapeHtml(p.nome || p.email || 'Cliente')}</h2>
      <span class="adm-plan ${p.role === 'admin' ? 'admin' : p.plan}">${p.role === 'admin' ? 'Admin' : p.plan === 'pro' ? 'Pro' : 'Free'}</span>
    </div>
    ${admSection('Dados', `<dl class="adm-fields">
      ${field('E-mail', p.email)}${field('Telefone', p.telefone)}${field('Cidade', [p.cidade, p.estado].filter(Boolean).join(' / '))}
      ${field('Login', p.provider)}${field('Cliente desde', admDate(p.created_at))}${field('Pro até', p.pro_until ? admDate(p.pro_until) : '')}
      ${field('Status Stripe', ADM_STATUS_LABEL[p.subscription_status] || p.subscription_status)}
      ${field('Torneios', `${c.tournaments?.total || 0} (último ${admDate(c.tournaments?.last_at)})`)}
    </dl>`)}
    ${admSection('Histórico de assinaturas', subs
      ? `<div class="adm-table-wrap"><table class="adm-table"><thead><tr><th>Plano</th><th>Status</th><th>Início</th><th>Fim do período</th></tr></thead><tbody>${subs}</tbody></table></div>`
      : admEmpty('Nunca assinou.'))}
    ${admSection('Pagamentos e eventos', events ? `<ul class="adm-list">${events}</ul>` : admEmpty('Nenhum evento de pagamento.'))}`;
}

// ── Saúde técnica ─────────────────────────────────
function renderAdminHealth(target, d) {
  const h = d.health || {};
  const errors = (h.errors_24h || []).map(e => `
    <li class="adm-row static"><span class="adm-count">${e.total}x</span>
    <span class="adm-row-main"><strong class="adm-mono">${escapeHtml(e.message)}</strong><small>${e.source ? escapeHtml(e.source) + ' · ' : ''}primeiro ${admDateTime(e.first_at)} · último ${admDateTime(e.last_at)}</small></span></li>`).join('');
  const failures = (h.payment_failures || []).map(f => `
    <li class="adm-row static"><span class="adm-pill neg">${ADM_EVENT_LABEL[f.event_type] || escapeHtml(f.event_type)}</span>
    <span class="adm-row-main"><strong>${escapeHtml(f.nome || f.email || 'Sem cadastro')}</strong><small>${admDateTime(f.created_at)}</small></span></li>`).join('');
  const webhook = (h.webhook_failures || []).map(f => `
    <li class="adm-row static"><span class="adm-pill neg">Falha</span>
    <span class="adm-row-main"><strong class="adm-mono">${escapeHtml(f.metadata?.type || f.metadata?.error || 'evento')}</strong><small>${admDateTime(f.created_at)}</small></span></li>`).join('');
  const notConfigured = (title, what) => `<div class="adm-off"><strong>${title}</strong><span class="adm-tag">não configurado</span><p>${what}</p></div>`;
  target.innerHTML = `
    ${admSection(`Erros do app nas últimas 24 h <span class="adm-muted">(${h.errors_24h_total || 0})</span>`,
      errors ? `<ul class="adm-list">${errors}</ul>` : admEmpty('Nenhum erro registrado nas últimas 24 h.'))}
    <div class="adm-cols">
      ${admSection('Webhook Stripe', `
        ${webhook ? `<ul class="adm-list">${webhook}</ul>` : admEmpty('Nenhuma falha registrada nos últimos 7 dias.')}
        <p class="adm-small">Último evento processado: ${admDateTime(h.webhook_last_processed)}. O webhook ainda não grava as próprias falhas (evento <code>stripe_webhook_failed</code>); até lá, confira em Stripe › Desenvolvedores › Webhooks.</p>`)}
      ${admSection('Pagamentos recusados (7 dias)', failures ? `<ul class="adm-list">${failures}</ul>` : admEmpty('Nenhum pagamento recusado.'))}
    </div>
    <div class="adm-cols">
      ${notConfigured('Uptime', 'Falta um monitor externo (ex.: UptimeRobot ou Better Stack) checando bt8.com.br e api.bt8.com.br, e gravar o resultado para o painel ler.')}
      ${notConfigured('Backup do banco', 'Falta o script de backup do VPS registrar data, tamanho e resultado de cada execução (ver docs/SUPABASE_VPS.md).')}
    </div>
    ${adminFooter(d)}`;
}
