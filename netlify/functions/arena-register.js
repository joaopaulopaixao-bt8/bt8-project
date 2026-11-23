// POST /.netlify/functions/arena-register — inscrição pública de dupla pelo link /inscricao/<token>.
// Honeypot, limite por hash de IP, LGPD versionada; a RPC arena_inscrever faz o advisory lock por categoria.
// Contrato: docs/ARENA.md, seções 4.7 e 5. Não logar o corpo (nomes e telefones).
const { logError } = require('./lib/_log');
const { json, validarInscricao, statusDaRecusa, hashIp, clientIp, supabaseEnv, sbFetch, contextoDupla } = require('./lib/arena');
const { enviarModelo, emailsAtletas } = require('./lib/email');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return json(204, {});
  if (event.httpMethod !== 'POST') return json(405, { error: 'Método não permitido.' });
  const env = supabaseEnv();
  const secret = process.env.BT8_GUEST_USAGE_HASH_SECRET || process.env.GUEST_USAGE_HASH_SECRET;
  if (!env.url || !env.serviceKey || !secret) return json(500, { error: 'Inscrições indisponíveis no momento.' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (e) { return json(400, { error: 'Dados inválidos.' }); }

  const v = validarInscricao(body);
  if (v.honeypot) return json(200, { ok: true, status: 'confirmada' }); // robô: falso sucesso, nada gravado
  if (v.erro) return json(400, { error: v.erro });

  try {
    const r = await sbFetch(env, 'rest/v1/rpc/arena_inscrever', {
      method: 'POST',
      body: JSON.stringify({
        p_token: v.token,
        p_ip_hash: hashIp(secret, clientIp(event.headers)),
        p_dados: v.dados,
        p_limite_hora: Number(process.env.BT8_ARENA_INSCRICOES_POR_HORA) || 10
      })
    });
    if (!r?.ok) return json(statusDaRecusa(r?.erro), { error: r?.mensagem || 'Não foi possível concluir a inscrição.', erro: r?.erro });
    await avisarInscricao(env, r.team_id);
    return json(200, r);
  } catch (e) {
    logError('arena-register', e);
    return json(500, { error: 'Não foi possível concluir a inscrição. Tente de novo.' });
  }
};

// "Inscrição recebida" para os atletas com e-mail e "nova inscrição" para dono/gestores. Só depois de
// uma inscrição gravada (já passou pelo limite por IP), então não vira disparador de e-mail. Nunca lança.
async function avisarInscricao(env, teamId) {
  try {
    const ctx = await contextoDupla(env, teamId);
    if (!ctx) return;
    await enviarModelo('inscricaoRecebida', ctx, emailsAtletas(ctx), 'arena-register-email');
    await enviarModelo('novaInscricao', ctx, ctx.gestores, 'arena-register-email');
  } catch (e) {
    logError('arena-register-email', e);
  }
}
