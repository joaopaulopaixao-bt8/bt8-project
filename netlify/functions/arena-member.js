// POST /.netlify/functions/arena-member — o dono/gestor cria ou atualiza a equipe (gestor, árbitro, scout).
// Conta criada já confirmada e vínculo gravado na hora. Contrato: docs/ARENA.md, seção 5.
// A resposta é a mesma com ou sem conta prévia e não traz user_id (não revela quem tem conta no BT8).
const {
  json, validarMembro, supabaseEnv, sbFetch, usuarioDoToken, ehAdmin, obterOuCriarUsuario, apagarUsuario,
  arenaAtiva, respostaDeErro, erroPublico
} = require('./lib/arena');

const CAMPOS = 'id,arena_id,nome,email,papel,ativo';

async function podeGerir(env, arenaId, userId) {
  if (await ehAdmin(env, userId)) return true;
  const rows = await sbFetch(env,
    `rest/v1/arena_members?select=papel&arena_id=eq.${arenaId}&user_id=eq.${userId}&ativo=is.true&limit=1`);
  if (!['dono', 'gestor'].includes(rows?.[0]?.papel)) return false;
  if (!(await arenaAtiva(env, arenaId))) throw erroPublico(403, 'Arena suspensa ou com o plano vencido. Fale com o BT8.');
  return true;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return json(204, {});
  if (event.httpMethod !== 'POST') return json(405, { error: 'Método não permitido.' });
  const env = supabaseEnv();
  if (!env.url || !env.serviceKey) return json(500, { error: 'Serviço de equipe não configurado.' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (e) { return json(400, { error: 'JSON inválido.' }); }

  let conta = null;
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
      const [member] = await sbFetch(env, `rest/v1/arena_members?id=eq.${alvo.id}&select=${CAMPOS}`, {
        method: 'PATCH', headers: { prefer: 'return=representation' }, body: JSON.stringify(v.patch)
      });
      return json(200, { ok: true, member });
    }

    let userId = null;
    if (!v.sem_conta) {
      conta = await obterOuCriarUsuario(env, v.pessoa);
      userId = conta.userId;
      const ja = await sbFetch(env, `rest/v1/arena_members?select=id&arena_id=eq.${v.arena_id}&user_id=eq.${userId}&limit=1`);
      if (ja?.length) throw erroPublico(409, 'Essa pessoa já faz parte da equipe.');
    }
    const [member] = await sbFetch(env, `rest/v1/arena_members?select=${CAMPOS}`, {
      method: 'POST',
      headers: { prefer: 'return=representation' },
      body: JSON.stringify({ arena_id: v.arena_id, user_id: userId, email: v.pessoa.email || null, nome: v.pessoa.nome, papel: v.papel })
    });
    return json(201, {
      ok: true, member,
      mensagem: v.sem_conta ? 'Árbitro cadastrado (sem acesso ao app).'
        : 'Membro adicionado. Ele entra com este e-mail e a senha inicial (se já tinha conta no BT8, usa a senha dele).'
    });
  } catch (e) {
    if (conta?.criada) await apagarUsuario(env, conta.userId);
    if (e.code === '23505') return json(409, { error: 'Essa pessoa já faz parte da equipe.' });
    return respostaDeErro('arena-member', e, 'Não foi possível salvar a equipe.');
  }
};
