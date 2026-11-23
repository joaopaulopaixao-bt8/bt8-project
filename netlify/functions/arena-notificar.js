// POST /.netlify/functions/arena-notificar — depois de publicar o sorteio, o gestor avisa as duplas da
// categoria por e-mail ("tabela publicada", com grupo e primeiro jogo). Idempotente: cada dupla recebe uma vez
// (teams.tabela_email_em). Authorization: Bearer; só dono/gestor ativo da arena, ou admin. Body: { category_id }.
// Contrato: docs/ARENA.md, seção 5.
const { json, supabaseEnv, sbFetch, usuarioDoToken, uuidValido, contextoDupla, podeGerirArena, respostaDeErro } = require('./lib/arena');
const { enviarModelo, emailsAtletas } = require('./lib/email');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return json(204, {});
  if (event.httpMethod !== 'POST') return json(405, { error: 'Método não permitido.' });
  const env = supabaseEnv();
  if (!env.url || !env.serviceKey) return json(500, { error: 'Serviço indisponível no momento.' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (e) { return json(400, { error: 'JSON inválido.' }); }
  if (!uuidValido(body.category_id)) return json(400, { error: 'Categoria inválida.' });

  try {
    const user = await usuarioDoToken(env, event);
    if (!user) return json(401, { error: 'Entre de novo para continuar.' });
    const [cat] = await sbFetch(env, `rest/v1/categories?select=id,championships(arena_id)&id=eq.${encodeURIComponent(body.category_id)}&limit=1`);
    if (!cat) return json(404, { error: 'Categoria não encontrada.' });
    if (!(await podeGerirArena(env, user.id, cat.championships?.arena_id))) return json(403, { error: 'Só o dono ou gestor da arena avisa as duplas.' });

    // Duplas sorteadas (em algum grupo) que ainda não foram avisadas.
    const teams = await sbFetch(env, `rest/v1/teams?select=id,acompanhamento_token,group_teams!inner(group_id)` +
      `&category_id=eq.${encodeURIComponent(cat.id)}&status=in.(confirmada,pendente)&tabela_email_em=is.null`);
    if (!teams?.length) return json(200, { ok: true, avisadas: 0, emails: 0, mensagem: 'Nenhuma dupla nova para avisar.' });

    let emails = 0;
    for (const t of teams) {
      // Marca antes de enviar: se a Function cair no meio, ninguém recebe duas vezes.
      await sbFetch(env, `rest/v1/teams?id=eq.${encodeURIComponent(t.id)}`, {
        method: 'PATCH', headers: { prefer: 'return=minimal' }, body: JSON.stringify({ tabela_email_em: new Date().toISOString() })
      });
      const ctx = await contextoDupla(env, t.id);
      const st = await sbFetch(env, 'rest/v1/rpc/arena_inscricao_status', {
        method: 'POST', body: JSON.stringify({ p_token: t.acompanhamento_token })
      });
      const primeiro = (st?.jogos || []).find(j => ['agendada', 'chamada', 'suspensa'].includes(j.status));
      emails += await enviarModelo('tabelaPublicada', { ...ctx, grupo: st?.grupo?.nome, primeiro }, emailsAtletas(ctx), 'arena-notificar-email');
    }
    return json(200, { ok: true, avisadas: teams.length, emails, mensagem: `${teams.length} dupla(s) avisada(s), ${emails} e-mail(s) enviado(s).` });
  } catch (e) {
    return respostaDeErro('arena-notificar', e, 'Não foi possível avisar as duplas.');
  }
};
