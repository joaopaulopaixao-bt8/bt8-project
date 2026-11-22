// ══════════════════════════════════════════════════
// MONITOR — captura global de erros do front
// ══════════════════════════════════════════════════
// Envia `client_error` para app_events via REST (não depende do supabase-js, que pode
// ter falhado ao carregar). Para trocar por Sentry, basta mudar report().
(function () {
  const ENV = window.BT8_ENV || {};
  const MAX_PER_SESSION = 5;
  const sent = new Set();

  function scrub(text, max) {
    return String(text || '')
      .replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, '[email]')
      .replace(/\d{6,}/g, '[num]')
      .replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, '[token]')
      .slice(0, max);
  }

  function shortSource(file, line, col) {
    if (!file) return '';
    let p = file;
    try { const u = new URL(file, location.href); p = u.origin === location.origin ? u.pathname : u.host + u.pathname; } catch (_) {}
    return `${p}:${line || 0}:${col || 0}`;
  }

  function report(kind, message, source) {
    if (!ENV.SUPABASE_URL || !ENV.SUPABASE_ANON_KEY) return;
    const msg = scrub(message, 200);
    const key = kind + msg + source;
    if (sent.has(key)) return;
    let count = 0;
    try { count = Number(sessionStorage.getItem('bt8_err_count') || 0); } catch (_) {}
    if (count >= MAX_PER_SESSION) return;
    sent.add(key);
    try { sessionStorage.setItem('bt8_err_count', String(count + 1)); } catch (_) {}

    fetch(`${ENV.SUPABASE_URL}/rest/v1/app_events`, {
      method: 'POST',
      keepalive: true,
      headers: {
        apikey: ENV.SUPABASE_ANON_KEY,
        Authorization: `Bearer ${ENV.SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal'
      },
      body: JSON.stringify({
        event_type: 'client_error',
        metadata: { kind, message: msg, source, version: ENV.VERSION || '', env: ENV.APP_ENV || '', path: location.pathname }
      })
    }).catch(() => {});
  }

  window.addEventListener('error', e => {
    // "Script error." sem arquivo = erro de outra origem, sem detalhe útil.
    if (!e.filename && /^Script error\.?$/.test(e.message || '')) return;
    report('error', e.error?.message || e.message, shortSource(e.filename, e.lineno, e.colno));
  });

  window.addEventListener('unhandledrejection', e => {
    const r = e.reason;
    const frame = String(r?.stack || '').match(/(https?:\/\/[^\s)]+):(\d+):(\d+)/);
    report('rejection', r?.message || String(r), frame ? shortSource(frame[1], frame[2], frame[3]) : '');
  });

  // supabase-js vem com defer: roda antes do DOMContentLoaded, então aqui já dá para checar.
  document.addEventListener('DOMContentLoaded', () => {
    if (window.supabase) return;
    report('supabase_load', 'supabase-js não carregou', '');
    const bar = document.createElement('div');
    bar.setAttribute('role', 'alert');
    bar.style.cssText = 'position:fixed;left:0;right:0;top:0;z-index:99999;padding:12px 16px;background:#7f1d1d;color:#fff;font:500 14px/1.4 Barlow,system-ui,sans-serif;text-align:center;';
    bar.textContent = 'Não foi possível carregar parte do BT8 (login e salvamento). Verifique sua conexão e recarregue a página. ';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = 'Recarregar';
    btn.style.cssText = 'margin-left:8px;padding:4px 12px;border:1px solid #fff;border-radius:6px;background:transparent;color:#fff;font:inherit;cursor:pointer;';
    btn.onclick = () => location.reload();
    bar.appendChild(btn);
    document.body.appendChild(bar);
  });

  window.BT8Monitor = { report };
})();
