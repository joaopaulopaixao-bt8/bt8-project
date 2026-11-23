// POST /.netlify/functions/arena-comprovante — a dupla envia o comprovante do Pix pela página /acompanhar/<token>.
// Público (o token de acompanhamento é a credencial). JPG/PNG/WEBP/PDF até 4 MB, tipo conferido pela assinatura.
// Grava no bucket privado "comprovantes" (service role) e avisa a arena por e-mail. Até 5 envios por dupla.
// Contrato: docs/ARENA.md, seção 5. Não logar o corpo.
const { logError } = require('./lib/_log');
const { json, supabaseEnv, sbFetch, validarComprovante, contextoDupla, statusDaRecusa, COMPROVANTE_ENVIOS } = require('./lib/arena');
const { enviarModelo, semAtrasar } = require('./lib/email');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return json(204, {});
  if (event.httpMethod !== 'POST') return json(405, { error: 'Método não permitido.' });
  const env = supabaseEnv();
  if (!env.url || !env.serviceKey) return json(500, { error: 'Envio de comprovante indisponível no momento.' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (e) { return json(400, { error: 'Dados inválidos.' }); }
  const v = validarComprovante(body);
  if (v.erro) return json(400, { error: v.erro });

  try {
    // Reserva antes do upload: o limite vale mesmo se o upload falhar depois.
    const r = await sbFetch(env, 'rest/v1/rpc/arena_comprovante_reservar', {
      method: 'POST', body: JSON.stringify({ p_token: v.token, p_limite: COMPROVANTE_ENVIOS })
    });
    if (!r?.ok) return json(statusDaRecusa(r?.erro), { error: r?.mensagem || 'Não foi possível enviar.', erro: r?.erro });

    const path = `${r.team_id}/${Date.now()}.${v.tipo.ext}`;
    await sbFetch(env, `storage/v1/object/comprovantes/${path}`, {
      method: 'POST', body: v.buf, headers: { 'content-type': v.tipo.mime, 'x-upsert': 'false' }
    });
    const agora = new Date().toISOString();
    // Condicional: se a arena confirmou o pagamento durante o upload, não grava e apaga o arquivo novo.
    const gravado = await sbFetch(env, `rest/v1/teams?id=eq.${encodeURIComponent(r.team_id)}` +
      '&status=eq.pendente&pagamento=eq.pendente&comprovante_status=neq.aceito&select=id', {
      method: 'PATCH', headers: { prefer: 'return=representation' },
      body: JSON.stringify({ comprovante_path: path, comprovante_enviado_em: agora, comprovante_status: 'enviado', comprovante_motivo: null })
    });
    if (!gravado?.length) {
      await sbFetch(env, `storage/v1/object/comprovantes/${path}`, { method: 'DELETE' }).catch(e => logError('arena-comprovante-apagar', e));
      return json(409, { error: 'O pagamento desta inscrição já foi conferido pela arena. Atualize a página.' });
    }
    // Só o último comprovante fica guardado (menos dado pessoal parado no bucket).
    if (r.path_anterior && r.path_anterior.startsWith(`${r.team_id}/`)) {
      await sbFetch(env, `storage/v1/object/comprovantes/${r.path_anterior}`, { method: 'DELETE' })
        .catch(e => logError('arena-comprovante-apagar', e));
    }
    await semAtrasar((async () => {
      const ctx = await contextoDupla(env, r.team_id);
      if (ctx) await enviarModelo('comprovanteEnviado', ctx, ctx.gestores, 'arena-comprovante-email');
    })(), 'arena-comprovante-email');
    return json(200, { ok: true, comprovante: { status: 'enviado', enviado_em: agora } });
  } catch (e) {
    logError('arena-comprovante', e);
    return json(500, { error: 'Não foi possível enviar o comprovante. Tente de novo.' });
  }
};
