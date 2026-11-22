// Log estruturado para as Functions (uma linha JSON por erro no log do Netlify).
// Uso: const { logError } = require('./lib/_log'); logError('stripe-webhook', err, { event: event.type });
// Não passe dados pessoais em `extra` (e-mail, telefone, tokens).
function logError(context, error, extra) {
  console.error(JSON.stringify({
    level: 'error',
    context,
    message: error?.message || String(error),
    code: error?.code || error?.status || undefined,
    stack: error?.stack ? String(error.stack).split('\n').slice(0, 6).join('\n') : undefined,
    ...(extra || {}),
    time: new Date().toISOString()
  }));
}

module.exports = { logError };
