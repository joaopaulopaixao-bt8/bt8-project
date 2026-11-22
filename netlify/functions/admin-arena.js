// POST /.netlify/functions/admin-arena — o admin do BT8 cria a arena e o gestor (dono).
// Contrato: docs/ARENA.md, seção 5. Só profiles.role = 'admin'.
const { logError } = require('./lib/_log');
const { json, validarArena, supabaseEnv, sbFetch, usuarioDoToken, ehAdmin, obterOuCriarUsuario } = require('./lib/arena');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return json(204, {});
  if (event.httpMethod !== 'POST') return json(405, { error: 'Método não permitido.' });
  const env = supabaseEnv();
  if (!env.url || !env.serviceKey) return json(500, { error: 'Serviço de arenas não configurado.' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (e) { return json(400, { error: 'JSON inválido.' }); }

  try {
    const user = await usuarioDoToken(env, event);
    if (!user) return json(401, { error: 'Entre de novo para continuar.' });
    if (!(await ehAdmin(env, user.id))) return json(403, { error: 'Só o admin do BT8 cria arenas.' });

    const v = validarArena(body);
    if (v.erro) return json(400, { error: v.erro });

    // Slug antes de criar a conta, para não deixar conta órfã.
    const existe = await sbFetch(env, `rest/v1/arenas?select=id&slug=eq.${encodeURIComponent(v.arena.slug)}&limit=1`);
    if (existe?.length) return json(409, { error: 'Já existe uma arena com esse slug.' });

    const { userId, criada } = await obterOuCriarUsuario(env, v.gestor);
    const [arena] = await sbFetch(env, 'rest/v1/arenas', {
      method: 'POST',
      headers: { prefer: 'return=representation' },
      body: JSON.stringify({ ...v.arena, owner_id: userId })
    });
    await sbFetch(env, 'rest/v1/arena_members', {
      method: 'POST',
      headers: { prefer: 'return=minimal' },
      body: JSON.stringify({ arena_id: arena.id, user_id: userId, email: v.gestor.email, nome: v.gestor.nome, papel: 'dono' })
    });
    return json(201, { ok: true, arena, gestor: { user_id: userId, email: v.gestor.email, conta_criada: criada } });
  } catch (e) {
    if (e.code === '23505') return json(409, { error: 'Já existe uma arena com esse slug.' });
    if (e.status === 400 || e.status === 422) return json(400, { error: e.message });
    logError('admin-arena', e);
    return json(500, { error: 'Não foi possível criar a arena.' });
  }
};
