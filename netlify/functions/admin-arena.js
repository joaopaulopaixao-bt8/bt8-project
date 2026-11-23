// POST /.netlify/functions/admin-arena — o admin do BT8 cria a arena e o gestor (dono).
// Contrato: docs/ARENA.md, seção 5. Só profiles.role = 'admin'. Arena + dono numa RPC (arena_criar, 005).
const {
  json, validarArena, supabaseEnv, sbFetch, usuarioDoToken, ehAdmin, obterOuCriarUsuario, apagarUsuario,
  respostaDeErro, erroPublico
} = require('./lib/arena');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return json(204, {});
  if (event.httpMethod !== 'POST') return json(405, { error: 'Método não permitido.' });
  const env = supabaseEnv();
  if (!env.url || !env.serviceKey) return json(500, { error: 'Serviço de arenas não configurado.' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (e) { return json(400, { error: 'JSON inválido.' }); }

  let conta = null;
  try {
    const user = await usuarioDoToken(env, event);
    if (!user) return json(401, { error: 'Entre de novo para continuar.' });
    if (!(await ehAdmin(env, user.id))) return json(403, { error: 'Só o admin do BT8 cria arenas.' });

    const v = validarArena(body);
    if (v.erro) return json(400, { error: v.erro });

    // Slug antes de criar a conta, para não deixar conta órfã no caso comum.
    const existe = await sbFetch(env, `rest/v1/arenas?select=id&slug=eq.${encodeURIComponent(v.arena.slug)}&limit=1`);
    if (existe?.length) throw erroPublico(409, 'Já existe uma arena com esse slug.');

    conta = await obterOuCriarUsuario(env, v.gestor);
    const r = await sbFetch(env, 'rest/v1/rpc/arena_criar', {
      method: 'POST',
      body: JSON.stringify({ p_arena: v.arena, p_owner: conta.userId, p_nome: v.gestor.nome, p_email: v.gestor.email })
    });
    return json(201, {
      ok: true, arena: r.arena, gestor: { email: v.gestor.email },
      mensagem: 'Arena criada. O gestor entra com este e-mail e a senha inicial (se já tinha conta no BT8, usa a senha dele).'
    });
  } catch (e) {
    if (conta?.criada) await apagarUsuario(env, conta.userId);
    if (e.code === '23505') return json(409, { error: 'Já existe uma arena com esse slug.' });
    return respostaDeErro('admin-arena', e, 'Não foi possível criar a arena.');
  }
};
