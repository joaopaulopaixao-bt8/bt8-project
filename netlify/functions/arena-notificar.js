// POST /.netlify/functions/arena-notificar — depois de publicar o sorteio, o gestor avisa as duplas da
// categoria por e-mail ("tabela publicada", com grupo e primeiro jogo). Cada dupla recebe uma vez:
// teams.tabela_email_em é marcado só depois de pelo menos um envio aceito, e volta a null quando o sorteio é
// refeito (trigger da 006). Quem falhou fica sem marca e entra na próxima tentativa.
// Authorization: Bearer; só dono/gestor ativo da arena, ou admin. Body: { category_id }. Contrato: docs/ARENA.md, seção 5.
const { json, supabaseEnv, sbFetch, usuarioDoToken, uuidValido, contextoDupla, podeGerirArena, respostaDeErro } = require('./lib/arena');
const { enviarModelo, emailsAtletas } = require('./lib/email');
const { logError } = require('./lib/_log');

const SIMULTANEOS = 5;
const ORCAMENTO_MS = 7000; // a Function do Netlify tem 10 s: o que sobrar fica para o próximo clique

// Uma dupla: 'enviada' | 'sem_email' | 'falhou'.
async function avisarDupla(env, t) {
  try {
    const ctx = await contextoDupla(env, t.id);
    const para = emailsAtletas(ctx);
    if (!para.length) return 'sem_email';
    const st = await sbFetch(env, 'rest/v1/rpc/arena_inscricao_status', {
      method: 'POST', body: JSON.stringify({ p_token: ctx.token })
    });
    const primeiro = (st?.jogos || []).find(j => ['agendada', 'chamada', 'suspensa'].includes(j.status));
    const n = await enviarModelo('tabelaPublicada', { ...ctx, grupo: st?.grupo?.nome, primeiro }, para, 'arena-notificar-email');
    if (!n) return 'falhou';
    await sbFetch(env, `rest/v1/teams?id=eq.${encodeURIComponent(t.id)}`, {
      method: 'PATCH', headers: { prefer: 'return=minimal' }, body: JSON.stringify({ tabela_email_em: new Date().toISOString() })
    });
    return 'enviada';
  } catch (e) {
    logError('arena-notificar-dupla', e);
    return 'falhou';
  }
}

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
    if (!process.env.RESEND_API_KEY) return json(503, { error: 'O envio de e-mails não está configurado no BT8. Nenhuma dupla foi marcada como avisada.' });

    // Duplas sorteadas (em algum grupo) que ainda não foram avisadas desta tabela.
    const teams = await sbFetch(env, `rest/v1/teams?select=id,group_teams!inner(group_id)` +
      `&category_id=eq.${encodeURIComponent(cat.id)}&status=in.(confirmada,pendente)&tabela_email_em=is.null`);
    const conta = { enviada: 0, sem_email: 0, falhou: 0 };
    const t0 = Date.now();
    let feitas = 0;
    for (let i = 0; i < teams.length && Date.now() - t0 < ORCAMENTO_MS; i += SIMULTANEOS) {
      const lote = await Promise.all(teams.slice(i, i + SIMULTANEOS).map(t => avisarDupla(env, t)));
      lote.forEach(r => conta[r]++);
      feitas += lote.length;
    }
    const faltam = teams.length - feitas;
    const partes = [`${conta.enviada} dupla(s) avisada(s)`];
    if (conta.sem_email) partes.push(`${conta.sem_email} sem e-mail cadastrado`);
    if (conta.falhou) partes.push(`${conta.falhou} com falha no envio`);
    if (faltam) partes.push(`${faltam} ainda na fila`);
    if (conta.falhou || faltam) partes.push('clique de novo para continuar: quem já recebeu não recebe outra vez');
    return json(200, {
      ok: true, avisadas: conta.enviada, sem_email: conta.sem_email, falhas: conta.falhou, faltam,
      mensagem: teams.length ? partes.join(', ') + '.' : 'Nenhuma dupla nova para avisar.'
    });
  } catch (e) {
    return respostaDeErro('arena-notificar', e, 'Não foi possível avisar as duplas.');
  }
};
