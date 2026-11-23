// POST /.netlify/functions/arena-trocar-senha — troca obrigatória da senha inicial (definida pelo
// gestor/admin em arena-member/admin-arena) no primeiro login. Body: { senha }. Bearer obrigatório.
// Troca a senha e limpa app_metadata.trocar_senha com a service role, numa chamada só, encerra TODAS as
// sessões antigas (quem sabia a senha inicial e já tinha entrado perde o acesso) e devolve uma sessão
// nova, aberta com a senha nova, que o front aplica com setSession (a antiga não vale mais).
const {
  json, supabaseEnv, sbFetch, usuarioDoToken, validarNovaSenha, respostaDeErro, erroPublico
} = require('./lib/arena');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return json(204, {});
  if (event.httpMethod !== 'POST') return json(405, { error: 'Método não permitido.' });
  const env = supabaseEnv();
  if (!env.url || !env.serviceKey) return json(500, { error: 'Serviço indisponível no momento.' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (e) { return json(400, { error: 'JSON inválido.' }); }

  try {
    const user = await usuarioDoToken(env, event);
    if (!user) return json(401, { error: 'Entre de novo para continuar.' });
    if (!user.app_metadata?.trocar_senha) return json(409, { error: 'Não há troca de senha pendente nesta conta.' });
    const v = validarNovaSenha(body.senha);
    if (v.erro) return json(400, { error: v.erro });

    // A nova senha não pode ser a inicial: se ela já entra, quem criou a conta ainda a conhece.
    const igual = await fetch(`${env.url}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: env.serviceKey, 'content-type': 'application/json' },
      body: JSON.stringify({ email: user.email, password: v.senha })
    });
    if (igual.ok) throw erroPublico(400, 'Escolha uma senha diferente da senha inicial.');

    await sbFetch(env, `auth/v1/admin/users/${encodeURIComponent(user.id)}`, {
      method: 'PUT',
      body: JSON.stringify({ password: v.senha, app_metadata: { trocar_senha: false } })
    });
    const token = String(event.headers?.authorization || event.headers?.Authorization || '').replace(/^Bearer\s+/i, '');
    await sbFetch(env, 'auth/v1/logout?scope=global', { method: 'POST', authorization: `Bearer ${token}` }).catch(() => {});
    const sessao = await sbFetch(env, 'auth/v1/token?grant_type=password', {
      method: 'POST', body: JSON.stringify({ email: user.email, password: v.senha })
    });
    return json(200, { ok: true, session: { access_token: sessao.access_token, refresh_token: sessao.refresh_token } });
  } catch (e) {
    return respostaDeErro('arena-trocar-senha', e, 'Não foi possível trocar a senha. Tente de novo.');
  }
};
