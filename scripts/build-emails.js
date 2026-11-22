// Gera os modelos de e-mail do Supabase Auth em public/email/*.html.
// Rodar `npm run emails` depois de editar este arquivo e commitar o resultado.
// O Supabase do VPS lê os modelos de https://bt8.com.br/email/<nome>.html
// (ver docs/SUPABASE_VPS.md); o staging local lê os mesmos arquivos via supabase/config.toml.
// Variáveis entre {{ }} são do Go template do Supabase Auth, não deste script.
const fs = require('fs');
const path = require('path');

const SITE = 'https://bt8.com.br';
const LOGO = `${SITE}/logo-bt8.png`;
const SUPPORT = 'suporte@bt8.com.br';
const OUT = path.resolve(__dirname, '..', 'public', 'email');

const C = {
  dark: '#080f18',
  page: '#eef1f5',
  card: '#ffffff',
  text: '#1d2733',
  muted: '#5b6878',
  line: '#e3e8ee',
  yellow: '#f4c026',
  blue: '#1a7fc4'
};
const FONT = "'Barlow', 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

function button(label, href) {
  return `
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:28px 0 8px">
  <tr>
    <td align="center" bgcolor="${C.yellow}" style="border-radius:10px">
      <a href="${href}" target="_blank" style="display:inline-block;padding:15px 30px;font-family:${FONT};font-size:16px;font-weight:700;color:${C.dark};text-decoration:none;border-radius:10px">${label}</a>
    </td>
  </tr>
</table>`;
}

function fallbackLink(href) {
  return `<p style="margin:16px 0 0;font-size:13px;line-height:20px;color:${C.muted}">Se o botão não funcionar, copie e cole este endereço no navegador:<br><a href="${href}" style="color:${C.blue};word-break:break-all">${href}</a></p>`;
}

function code(token) {
  return `<p style="margin:24px 0 8px;font-family:'Courier New',monospace;font-size:32px;font-weight:700;letter-spacing:8px;color:${C.dark}">${token}</p>`;
}

function p(html) {
  return `<p style="margin:0 0 14px;font-size:16px;line-height:25px;color:${C.text}">${html}</p>`;
}

function note(html) {
  return `<p style="margin:24px 0 0;padding-top:18px;border-top:1px solid ${C.line};font-size:13px;line-height:20px;color:${C.muted}">${html}</p>`;
}

function layout({ title, preheader, body }) {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>${title}</title>
</head>
<body style="margin:0;padding:0;background:${C.page};-webkit-text-size-adjust:100%">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${C.page}">${preheader}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.page}">
  <tr>
    <td align="center" style="padding:24px 12px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px">
        <tr>
          <td align="center" bgcolor="${C.dark}" style="padding:26px 24px;border-radius:14px 14px 0 0">
            <a href="${SITE}" target="_blank"><img src="${LOGO}" width="150" alt="BT8" style="display:block;width:150px;max-width:150px;height:auto;border:0"></a>
          </td>
        </tr>
        <tr>
          <td bgcolor="${C.card}" style="padding:34px 32px 30px;border-radius:0 0 14px 14px;font-family:${FONT}">
            <h1 style="margin:0 0 18px;font-size:24px;line-height:31px;font-weight:700;color:${C.dark}">${title}</h1>
            ${body}
          </td>
        </tr>
        <tr>
          <td align="center" style="padding:20px 24px 8px;font-family:${FONT};font-size:12px;line-height:19px;color:${C.muted}">
            BT8 — torneios de beach tennis em minutos<br>
            <a href="${SITE}" style="color:${C.muted}">bt8.com.br</a> · Dúvidas? Escreva para <a href="mailto:${SUPPORT}" style="color:${C.muted}">${SUPPORT}</a>.
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>
`;
}

const IGNORE = 'Se não foi você que pediu, pode ignorar este e-mail com segurança.';
const NOT_YOU = `Se não foi você, <a href="${SITE}/" style="color:${C.blue}">entre no BT8</a> e use <strong>Esqueci minha senha</strong> para proteger sua conta.`;

// subject: assunto (vai para docs e para o supabase/config.toml / VPS).
const EMAILS = {
  confirmation: {
    subject: 'Confirme seu e-mail no BT8',
    title: 'Confirme seu e-mail',
    preheader: 'Falta só um passo para começar a organizar seus torneios.',
    body: p('Que bom ter você no BT8! Confirme seu e-mail para ativar sua conta e salvar seus torneios.')
      + button('Confirmar e-mail', '{{ .ConfirmationURL }}')
      + fallbackLink('{{ .ConfirmationURL }}')
      + note(`Este link vale por 1 hora. ${IGNORE}`)
  },
  recovery: {
    subject: 'Redefina sua senha do BT8',
    title: 'Redefinir sua senha',
    preheader: 'Use o link para criar uma nova senha.',
    body: p('Recebemos um pedido para redefinir a senha da conta <strong>{{ .Email }}</strong>.')
      + button('Criar nova senha', '{{ .ConfirmationURL }}')
      + fallbackLink('{{ .ConfirmationURL }}')
      + note(`Este link vale por 1 hora e só pode ser usado uma vez. ${IGNORE} Sua senha atual continua a mesma.`)
  },
  magic_link: {
    subject: 'Seu link de acesso ao BT8',
    title: 'Entrar no BT8',
    preheader: 'Clique para entrar sem senha.',
    body: p('Use o botão abaixo para entrar na sua conta <strong>{{ .Email }}</strong>.')
      + button('Entrar no BT8', '{{ .ConfirmationURL }}')
      + fallbackLink('{{ .ConfirmationURL }}')
      + note(`Este link vale por 1 hora e só pode ser usado uma vez. ${IGNORE}`)
  },
  invite: {
    subject: 'Você foi convidado para o BT8',
    title: 'Você foi convidado',
    preheader: 'Aceite o convite e crie sua conta no BT8.',
    body: p('Você recebeu um convite para usar o BT8, o jeito mais rápido de organizar torneios de beach tennis.')
      + button('Aceitar convite', '{{ .ConfirmationURL }}')
      + fallbackLink('{{ .ConfirmationURL }}')
      + note(`Se você não esperava este convite, pode ignorar este e-mail.`)
  },
  email_change: {
    subject: 'Confirme a troca de e-mail no BT8',
    title: 'Confirme seu novo e-mail',
    preheader: 'Confirme para trocar o e-mail da sua conta.',
    body: p('Recebemos um pedido para trocar o e-mail da sua conta de <strong>{{ .Email }}</strong> para <strong>{{ .NewEmail }}</strong>.')
      + button('Confirmar troca', '{{ .ConfirmationURL }}')
      + fallbackLink('{{ .ConfirmationURL }}')
      + note(`Se não foi você que pediu, ignore este e-mail: nada muda sem a confirmação. ${NOT_YOU}`)
  },
  reauthentication: {
    subject: 'Seu código de verificação do BT8',
    title: 'Código de verificação',
    preheader: 'Use este código para confirmar que é você.',
    body: p('Para continuar, digite este código no BT8:')
      + code('{{ .Token }}')
      + note(`O código vale por 1 hora. ${IGNORE}`)
  },
  password_changed_notification: {
    subject: 'Sua senha do BT8 foi alterada',
    title: 'Sua senha foi alterada',
    preheader: 'A senha da sua conta BT8 acabou de ser trocada.',
    body: p('A senha da conta <strong>{{ .Email }}</strong> foi alterada agora.')
      + p('Se foi você, está tudo certo e não precisa fazer nada.')
      + note(NOT_YOU)
  },
  email_changed_notification: {
    subject: 'O e-mail da sua conta BT8 foi alterado',
    title: 'Seu e-mail foi alterado',
    preheader: 'O e-mail de acesso da sua conta BT8 mudou.',
    body: p('O e-mail da sua conta foi alterado de <strong>{{ .OldEmail }}</strong> para <strong>{{ .Email }}</strong>.')
      + p('Se foi você, está tudo certo e não precisa fazer nada.')
      + note(`Se não foi você, sua conta pode estar em risco: escreva o quanto antes para <a href="mailto:${SUPPORT}" style="color:${C.blue}">${SUPPORT}</a>.`)
  },
  identity_linked_notification: {
    subject: 'Nova forma de login na sua conta BT8',
    title: 'Nova forma de login vinculada',
    preheader: 'Uma conta {{ .Provider }} foi vinculada ao seu BT8.',
    body: p('Uma conta <strong>{{ .Provider }}</strong> foi vinculada à sua conta BT8 (<strong>{{ .Email }}</strong>). Agora você também pode entrar por ela.')
      + p('Se foi você, está tudo certo e não precisa fazer nada.')
      + note(NOT_YOU)
  },
  identity_unlinked_notification: {
    subject: 'Forma de login removida da sua conta BT8',
    title: 'Forma de login removida',
    preheader: 'Uma conta {{ .Provider }} foi desvinculada do seu BT8.',
    body: p('A conta <strong>{{ .Provider }}</strong> foi desvinculada da sua conta BT8 (<strong>{{ .Email }}</strong>) e não serve mais para entrar.')
      + p('Se foi você, está tudo certo e não precisa fazer nada.')
      + note(NOT_YOU)
  }
};

fs.mkdirSync(OUT, { recursive: true });
for (const [name, email] of Object.entries(EMAILS)) {
  fs.writeFileSync(path.join(OUT, `${name}.html`), layout(email));
}
fs.writeFileSync(
  path.join(OUT, 'subjects.json'),
  JSON.stringify(Object.fromEntries(Object.entries(EMAILS).map(([k, v]) => [k, v.subject])), null, 2) + '\n'
);
console.log(`${Object.keys(EMAILS).length} modelos gerados em public/email`);
