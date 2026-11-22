// POST /.netlify/functions/arena-member — o dono/gestor cria ou atualiza a equipe (gestor, árbitro, scout).
// Conta criada já confirmada e vínculo gravado na hora. Contrato: docs/ARENA.md, seção 5.
const { logError } = require('./lib/_log');
const { json, validarMembro, supabaseEnv, sbFetch, usuarioDoToken, ehAdmin, obterOuCriarUsuario } = require('./lib/arena');

async function podeGerir(env, arenaId, userId) {
  const rows = await sbFetch(env,
    `rest/v1/arena_members?select=papel&arena_id=eq.${arenaId}&user_id=eq.${userId}&ativo=is.true&limit=1`);
  return ['dono', 'gestor'].includes(rows?.[0]?.papel) || ehAdmin(env, userId);
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return json(204, {});
  if (event.httpMethod !== 'POST') return json(405, { error: 'Método não permitido.' });
  const env = supabaseEnv();
  if (!env.url || !env.serviceKey) return json(500, { error: 'Serviço de equipe não configurado.' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (e) { return json(400, { error: 'JSON inválido.' }); }

  try {
    const user = await usuarioDoToken(env, event);
    if (!user) return json(401, { error: 'Entre de novo para continuar.' });
    const v = validarMembro(body);
    if (v.erro) return json(400, { error: v.erro });
    if (!(await podeGerir(env, v.arena_id, user.id))) return json(403, { error: 'Só o dono ou o gestor da arena mexe na equipe.' });

    if (v.acao === 'atualizar') {
      const [alvo] = await sbFetch(env,
        `rest/v1/arena_members?select=id,user_id,papel&id=eq.${v.member_id}&arena_id=eq.${v.arena_id}&limit=1`);
      if (!alvo) return json(404, { error: 'Membro não encontrado.' });
      if (alvo.papel === 'dono') return json(403, { error: 'O dono da arena não pode ser alterado aqui.' });
      if (alvo.user_id === user.id && (v.patch.papel || v.patch.ativo === false)) {
        return json(403, { error: 'Ninguém muda o próprio papel.' });
      }
      const [member] = await sbFetch(env, `rest/v1/arena_members?id=eq.${alvo.id}`, {
        method: 'PATCH', headers: { prefer: 'return=representation' }, body: JSON.stringify(v.patch)
      });
      return json(200, { ok: true, member });
    }

    let userId = null;
    let criada = false;
    if (!v.sem_conta) {
      ({ userId, criada } = await obterOuCriarUsuario(env, v.pessoa));
      const ja = await sbFetch(env, `rest/v1/arena_members?select=id&arena_id=eq.${v.arena_id}&user_id=eq.${userId}&limit=1`);
      if (ja?.length) return json(409, { error: 'Essa pessoa já faz parte da equipe.' });
    }
    const [member] = await sbFetch(env, 'rest/v1/arena_members', {
      method: 'POST',
      headers: { prefer: 'return=representation' },
      body: JSON.stringify({ arena_id: v.arena_id, user_id: userId, email: v.pessoa.email || null, nome: v.pessoa.nome, papel: v.papel })
    });
    return json(201, { ok: true, member, conta_criada: criada });
  } catch (e) {
    if (e.code === '23505') return json(409, { error: 'Essa pessoa já faz parte da equipe.' });
    if (e.status === 400 || e.status === 422) return json(400, { error: e.message });
    logError('arena-member', e);
    return json(500, { error: 'Não foi possível salvar a equipe.' });
  }
};
