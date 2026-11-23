// E-mails transacionais da Arena pelo Resend (HTTP API). Env: RESEND_API_KEY (escopo Functions).
// Sem a chave: loga e segue. Falha de e-mail NUNCA derruba inscrição ou pagamento (enviarEmail não lança).
// Os modelos são funções puras (testadas em tests/arena-inscricao.test.js); todo dado de usuário passa por esc().
const { logError } = require('./_log');

const REMETENTE = 'BT8 <noreply@bt8.com.br>'; // mesmo do Auth (docs/SUPABASE_VPS.md)
const SUPORTE = 'suporte@bt8.com.br';
const C = { dark: '#080f18', page: '#eef1f5', card: '#ffffff', text: '#1d2733', muted: '#5b6878', line: '#e3e8ee', yellow: '#f4c026' };
const FONT = "'Barlow', 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

const esc = v => String(v ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);

// Endereço público do site (Netlify define URL no build/Functions).
const siteUrl = () => String(process.env.URL || 'https://bt8.com.br').replace(/\/+$/, '');
const linkAcompanhar = token => `${siteUrl()}/acompanhar/${encodeURIComponent(token)}`;

const p = html => `<p style="margin:0 0 14px;font-size:16px;line-height:25px;color:${C.text}">${html}</p>`;
const botao = (rotulo, href) => `<p style="margin:24px 0 8px"><a href="${esc(href)}" target="_blank" style="display:inline-block;padding:14px 28px;background:${C.yellow};border-radius:10px;font-family:${FONT};font-size:16px;font-weight:700;color:${C.dark};text-decoration:none">${esc(rotulo)}</a></p>
<p style="margin:8px 0 0;font-size:13px;line-height:20px;color:${C.muted}">Se o botão não funcionar, copie este endereço:<br><span style="word-break:break-all">${esc(href)}</span></p>`;

function layout(titulo, corpo) {
  return `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(titulo)}</title></head>
<body style="margin:0;padding:0;background:${C.page};font-family:${FONT}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.page}"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px">
<tr><td style="background:${C.dark};border-radius:14px 14px 0 0;padding:18px 28px"><img src="https://bt8.com.br/logo-bt8.png" alt="BT8" height="32" style="display:block;border:0"></td></tr>
<tr><td style="background:${C.card};border-radius:0 0 14px 14px;padding:28px">
<h1 style="margin:0 0 18px;font-size:22px;line-height:30px;color:${C.text}">${esc(titulo)}</h1>
${corpo}
</td></tr>
<tr><td style="padding:18px 8px;font-size:12px;line-height:18px;color:${C.muted};text-align:center">E-mail automático do BT8 enviado em nome da arena organizadora. Dúvidas: <a href="mailto:${SUPORTE}" style="color:${C.muted}">${SUPORTE}</a></td></tr>
</table></td></tr></table></body></html>`;
}

const reais = v => `R$ ${Number(v || 0).toFixed(2).replace('.', ',')}`;
const blocoPix = pix => (pix?.chave
  ? p(`Pix${pix.valor ? ` de <b>${esc(reais(pix.valor))}</b>` : ''} para ${esc(pix.favorecido || 'a arena')}:<br><b style="font-family:'Courier New',monospace">${esc(pix.chave)}</b>`)
  : '');
const cab = ctx => p(`<b>${esc(ctx.dupla)}</b> · ${esc(ctx.categoria)}<br>${esc(ctx.campeonato)} · ${esc(ctx.arena)}`);

// ── Modelos: cada um devolve { subject, html } ──
const modelos = {
  inscricaoRecebida(ctx) {
    const pendente = ctx.status === 'pendente';
    const sit = { confirmada: 'Inscrição confirmada.', pendente: 'Inscrição recebida: falta o pagamento.',
      espera: 'A categoria lotou: vocês estão na lista de espera.' }[ctx.status] || 'Inscrição recebida.';
    return {
      subject: `Inscrição recebida: ${ctx.campeonato}`,
      html: layout('Inscrição recebida', cab(ctx) + p(esc(sit)) +
        (pendente ? blocoPix(ctx.pix) + p('Depois de pagar, envie o comprovante pela página de acompanhamento.') : '') +
        p('Guarde este link: nele você vê a situação da inscrição, envia o comprovante e acompanha grupo e jogos.') +
        botao('Acompanhar inscrição', linkAcompanhar(ctx.token)))
    };
  },
  novaInscricao(ctx) {
    return {
      subject: `Nova inscrição: ${ctx.dupla} (${ctx.categoria})`,
      html: layout('Nova inscrição', cab(ctx) + p(`Situação: <b>${esc(ctx.status)}</b>.`) +
        p('Veja os dados e o pagamento no painel da arena, em Inscritos.') + botao('Abrir o painel', `${siteUrl()}/arena`))
    };
  },
  comprovanteEnviado(ctx) {
    return {
      subject: `Comprovante enviado: ${ctx.dupla} (${ctx.categoria})`,
      html: layout('Comprovante de pagamento enviado', cab(ctx) +
        p('A dupla enviou o comprovante pelo sistema. Confira e confirme ou recuse o pagamento no painel, em Inscritos.') +
        botao('Abrir o painel', `${siteUrl()}/arena`))
    };
  },
  pagamentoConfirmado(ctx) {
    return {
      subject: `Pagamento confirmado: ${ctx.campeonato}`,
      html: layout('Pagamento confirmado', cab(ctx) + p('A arena confirmou o pagamento. A inscrição está garantida.') +
        botao('Acompanhar inscrição', linkAcompanhar(ctx.token)))
    };
  },
  comprovanteRecusado(ctx) {
    return {
      subject: `Comprovante recusado: ${ctx.campeonato}`,
      html: layout('Comprovante recusado', cab(ctx) +
        p(`A arena não aceitou o comprovante. Motivo: <b>${esc(ctx.comprovante_motivo || 'não informado')}</b>.`) +
        blocoPix(ctx.pix) + p('Envie um novo comprovante pela página de acompanhamento.') +
        botao('Enviar novo comprovante', linkAcompanhar(ctx.token)))
    };
  },
  // ctx.grupo = nome do grupo; ctx.primeiro = { adversario, quadra } ou null.
  tabelaPublicada(ctx) {
    const jogo = ctx.primeiro
      ? p(`Primeiro jogo: contra <b>${esc(ctx.primeiro.adversario || 'a definir')}</b>${ctx.primeiro.quadra ? `, ${esc(ctx.primeiro.quadra)}` : ''}. O horário previsto aparece na página de acompanhamento e muda conforme o andamento do evento.`)
      : '';
    return {
      subject: `Tabela publicada: ${ctx.campeonato}`,
      html: layout('Tabela publicada', cab(ctx) + (ctx.grupo ? p(`Vocês estão no <b>Grupo ${esc(ctx.grupo)}</b>.`) : '') + jogo +
        botao('Ver grupo e jogos', linkAcompanhar(ctx.token)))
    };
  }
};

// E-mails únicos e válidos (até 254 caracteres).
const destinatarios = lista => [...new Set((lista || []).map(e => String(e || '').trim().toLowerCase())
  .filter(e => e.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)))];

// Envia (um envio por destinatário, para não expor e-mails entre si). Nunca lança; devolve quantos foram.
async function enviarEmail({ to, subject, html, replyTo = SUPORTE, contexto = 'arena-email' }) {
  const lista = destinatarios(Array.isArray(to) ? to : [to]);
  if (!lista.length) return 0;
  const chave = process.env.RESEND_API_KEY;
  if (!chave) {
    console.log(JSON.stringify({ level: 'info', context: contexto, message: 'RESEND_API_KEY ausente: e-mail não enviado', qtd: lista.length }));
    return 0;
  }
  let enviados = 0;
  for (const destino of lista) {
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { authorization: `Bearer ${chave}`, 'content-type': 'application/json' },
        body: JSON.stringify({ from: REMETENTE, to: [destino], subject, html, reply_to: replyTo })
      });
      if (res.ok) enviados++;
      else logError(contexto, new Error(`Resend ${res.status}`));
    } catch (e) {
      logError(contexto, e);
    }
  }
  return enviados;
}

// Atalho: modelo + envio. Também nunca lança.
async function enviarModelo(nome, ctx, to, contexto) {
  try {
    const { subject, html } = modelos[nome](ctx);
    return await enviarEmail({ to, subject, html, contexto });
  } catch (e) {
    logError(contexto || 'arena-email', e);
    return 0;
  }
}

const emailsAtletas = ctx => (ctx?.atletas || []).map(a => a.email).filter(Boolean);

module.exports = { esc, modelos, destinatarios, enviarEmail, enviarModelo, emailsAtletas, linkAcompanhar, SUPORTE, REMETENTE };
