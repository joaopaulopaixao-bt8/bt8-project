// POST /.netlify/functions/arena-pagamento — o gestor confere o pagamento de uma dupla.
// Authorization: Bearer <token do Supabase>; só dono/gestor ativo da arena da dupla, ou admin do BT8.
// Body: { team_id, acao: "confirmar" | "recusar" | "desfazer" | "ver", motivo? }.
// "ver" devolve uma URL assinada (5 min) do comprovante. Regras em transicaoPagamento (lib/arena.js).
// Contrato: docs/ARENA.md, seção 5.
const {
  json, supabaseEnv, sbFetch, usuarioDoToken, uuidValido, transicaoPagamento, contextoDupla, podeGerirArena, respostaDeErro
} = require('./lib/arena');
const { enviarModelo, emailsAtletas, semAtrasar } = require('./lib/email');

const COLUNAS = 'id,status,pagamento,pago_em,comprovante_status,comprovante_motivo,comprovante_path,comprovante_enviado_em';

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return json(204, {});
  if (event.httpMethod !== 'POST') return json(405, { error: 'Método não permitido.' });
  const env = supabaseEnv();
  if (!env.url || !env.serviceKey) return json(500, { error: 'Serviço indisponível no momento.' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (e) { return json(400, { error: 'JSON inválido.' }); }
  if (!uuidValido(body.team_id)) return json(400, { error: 'Dupla inválida.' });

  try {
    const user = await usuarioDoToken(env, event);
    if (!user) return json(401, { error: 'Entre de novo para continuar.' });
    const ctx = await contextoDupla(env, body.team_id);
    if (!ctx) return json(404, { error: 'Dupla não encontrada.' });
    if (!(await podeGerirArena(env, user.id, ctx.arena_id))) return json(403, { error: 'Só o dono ou gestor da arena confere pagamentos.' });

    if (body.acao === 'ver') {
      const path = ctx.comprovante_path;
      if (!path || !path.startsWith(`${ctx.team_id}/`)) return json(404, { error: 'Esta dupla não enviou comprovante.' });
      const s = await sbFetch(env, `storage/v1/object/sign/comprovantes/${path}`, {
        method: 'POST', body: JSON.stringify({ expiresIn: 300 })
      });
      const assinado = s?.signedURL || s?.signedUrl;
      if (!assinado) throw new Error('URL assinada ausente');
      return json(200, { ok: true, url: `${env.url}/storage/v1${assinado.startsWith('/') ? '' : '/'}${assinado}`, expira_em_s: 300 });
    }

    const [team] = await sbFetch(env, `rest/v1/teams?select=${COLUNAS}&id=eq.${encodeURIComponent(ctx.team_id)}&limit=1`);
    const t = transicaoPagamento(team, body.acao, body.motivo);
    if (t.erro) return json(400, { error: t.erro });
    // Condicional ao estado lido: dois cliques ou dois gestores ao mesmo tempo não aplicam (nem mandam e-mail) duas vezes.
    const mesmoEstado = ['status', 'pagamento', 'comprovante_status'].map(c => `&${c}=eq.${encodeURIComponent(team[c])}`).join('');
    const [novo] = await sbFetch(env, `rest/v1/teams?id=eq.${encodeURIComponent(ctx.team_id)}${mesmoEstado}&select=${COLUNAS}`, {
      method: 'PATCH', headers: { prefer: 'return=representation' }, body: JSON.stringify(t.patch)
    });
    if (!novo) return json(409, { error: 'A dupla mudou enquanto você conferia. Recarregue e tente de novo.' });

    const modelo = { confirmar: 'pagamentoConfirmado', recusar: 'comprovanteRecusado' }[body.acao];
    if (modelo) await semAtrasar(enviarModelo(modelo, { ...ctx, ...t.patch }, emailsAtletas(ctx), 'arena-pagamento-email'), 'arena-pagamento-email');
    const { comprovante_path, ...publico } = novo;
    return json(200, { ok: true, team: { ...publico, tem_comprovante: !!comprovante_path } });
  } catch (e) {
    return respostaDeErro('arena-pagamento', e, 'Não foi possível atualizar o pagamento.');
  }
};
