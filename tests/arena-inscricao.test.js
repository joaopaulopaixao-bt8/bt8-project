// Lógica pura da inscrição com acompanhamento (006): comprovante, pagamento e e-mails.
const test = require('node:test');
const assert = require('node:assert/strict');
const { detectarArquivo, validarComprovante, transicaoPagamento, validarInscricao, ARENA_LGPD_VERSAO, COMPROVANTE_MAX_BYTES } =
  require('../netlify/functions/lib/arena');
const { modelos, destinatarios, enviarEmail, enviarModelo, semAtrasar, esc } = require('../netlify/functions/lib/email');

const TOKEN = '3f2b8c1e-9a4d-4e6f-8b2a-1c3d5e7f9a0b';
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16)]);
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(16)]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 '), Buffer.alloc(8)]);
const PDF = Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n');

test('detectarArquivo reconhece pela assinatura, não pelo nome', () => {
  assert.equal(detectarArquivo(PNG).mime, 'image/png');
  assert.equal(detectarArquivo(JPG).ext, 'jpg');
  assert.equal(detectarArquivo(WEBP).mime, 'image/webp');
  assert.equal(detectarArquivo(PDF).mime, 'application/pdf');
  assert.equal(detectarArquivo(Buffer.from('<html><script>alert(1)</script></html>')), null);
  assert.equal(detectarArquivo(Buffer.from('GIF89a........')), null);
  assert.equal(detectarArquivo(Buffer.alloc(3)), null);
});

test('validarComprovante: token, base64, tamanho e tipo', () => {
  const ok = validarComprovante({ token: TOKEN, arquivo: 'data:image/png;base64,' + PNG.toString('base64') });
  assert.equal(ok.tipo.ext, 'png');
  assert.equal(ok.buf.length, PNG.length);
  assert.match(validarComprovante({ token: 'abc', arquivo: PNG.toString('base64') }).erro, /inválido/);
  assert.match(validarComprovante({ token: TOKEN }).erro, /Escolha/);
  assert.match(validarComprovante({ token: TOKEN, arquivo: 'não é base64!' }).erro, /inválido/);
  // HTML com mime de imagem no data URL: recusado pelo conteúdo.
  assert.match(validarComprovante({ token: TOKEN, arquivo: 'data:image/png;base64,' + Buffer.from('<svg onload=x>').toString('base64') }).erro, /JPG, PNG/);
  const grande = Buffer.concat([PDF, Buffer.alloc(COMPROVANTE_MAX_BYTES)]);
  assert.match(validarComprovante({ token: TOKEN, arquivo: grande.toString('base64') }).erro, /grande/);
});

test('transicaoPagamento: confirmar, recusar e desfazer', () => {
  const pendente = { status: 'pendente', pagamento: 'pendente', comprovante_status: 'enviado', comprovante_path: 'x/1.png' };
  const agora = '2026-11-22T12:00:00.000Z';
  assert.deepEqual(transicaoPagamento(pendente, 'confirmar', null, agora).patch,
    { pagamento: 'pago', pago_em: agora, status: 'confirmada', comprovante_status: 'aceito', comprovante_motivo: null });
  // Sem comprovante (pagou em dinheiro): confirma e não inventa comprovante aceito.
  assert.equal(transicaoPagamento({ ...pendente, comprovante_status: 'nenhum', comprovante_path: null }, 'confirmar').patch.comprovante_status, 'nenhum');
  // Lista de espera não paga antes de ganhar a vaga.
  assert.match(transicaoPagamento({ ...pendente, status: 'espera' }, 'confirmar').erro, /espera/);
  assert.match(transicaoPagamento({ ...pendente, pagamento: 'pago' }, 'confirmar').erro, /já está/);

  assert.deepEqual(transicaoPagamento(pendente, 'recusar', '  valor   errado ').patch, { comprovante_status: 'recusado', comprovante_motivo: 'valor errado' });
  assert.match(transicaoPagamento(pendente, 'recusar', '').erro, /motivo/);
  assert.match(transicaoPagamento({ ...pendente, comprovante_status: 'nenhum' }, 'recusar', 'sem').erro, /aguardando/);

  const pago = { status: 'confirmada', pagamento: 'pago', comprovante_status: 'aceito', comprovante_path: 'x/1.png' };
  assert.deepEqual(transicaoPagamento(pago, 'desfazer').patch, { pagamento: 'pendente', pago_em: null, status: 'pendente', comprovante_status: 'enviado' });
  assert.deepEqual(transicaoPagamento({ ...pendente, comprovante_status: 'recusado' }, 'desfazer').patch, { comprovante_status: 'enviado', comprovante_motivo: null });
  assert.match(transicaoPagamento(pendente, 'desfazer').erro, /Nada/);
  assert.match(transicaoPagamento({ ...pendente, status: 'cancelada' }, 'confirmar').erro, /cancelada/);
  assert.match(transicaoPagamento(pendente, 'apagar').erro, /inválida/);
});

test('validarInscricao: e-mail opcional e validado', () => {
  const base = { token: 'a'.repeat(24), categoria_id: TOKEN, lgpd: true, lgpd_versao: ARENA_LGPD_VERSAO,
    atleta1: { nome: 'Ana Souza', telefone: '81999990000' }, atleta2: { nome: 'Bia Lima', telefone: '81988887777' } };
  assert.equal(validarInscricao(base).dados.atleta1.email, undefined);
  const com = validarInscricao({ ...base, atleta1: { ...base.atleta1, email: ' Ana@Exemplo.COM ' } });
  assert.equal(com.dados.atleta1.email, 'ana@exemplo.com');
  assert.match(validarInscricao({ ...base, atleta2: { ...base.atleta2, email: 'bia@' } }).erro, /E-mail do atleta 2/);
});

test('modelos de e-mail escapam dados do usuário', () => {
  const ctx = { dupla: '<script>x</script> / Bia', categoria: 'Fem "B"', campeonato: 'Open & Cia', arena: "Arena D'Ouro",
    status: 'pendente', token: TOKEN, pix: { chave: '<b>pix</b>', favorecido: 'Arena', valor: 120 },
    comprovante_motivo: '<img src=x onerror=alert(1)>', grupo: '<A>', primeiro: { adversario: '<i>Eva</i>', quadra: 'Q1' } };
  for (const [nome, f] of Object.entries(modelos)) {
    const { subject, html } = f(ctx);
    assert.ok(subject.length > 0, nome);
    assert.ok(!html.includes('<script>x'), `${nome}: script cru`);
    assert.ok(!html.includes('<img src=x'), `${nome}: img crua`);
    assert.ok(!html.includes('<i>Eva'), `${nome}: tag crua`);
    assert.ok(html.includes('suporte@bt8.com.br'), `${nome}: rodapé`);
    assert.ok(html.includes('lang="pt-BR"'), nome);
  }
  assert.ok(modelos.inscricaoRecebida(ctx).html.includes(`/acompanhar/${TOKEN}`));
  assert.ok(modelos.inscricaoRecebida(ctx).html.includes('R$ 120,00'));
  assert.ok(modelos.comprovanteRecusado(ctx).html.includes(esc(ctx.comprovante_motivo)));
});

test('destinatarios descarta inválidos e repetidos', () => {
  assert.deepEqual(destinatarios(['A@x.com', 'a@x.com ', null, 'ruim', 'b@y.org']), ['a@x.com', 'b@y.org']);
});

test('enviarEmail nunca lança: sem chave ou com falha de rede', async () => {
  const chave = process.env.RESEND_API_KEY;
  const fetchOriginal = global.fetch;
  const log = console.log, err = console.error;
  console.log = console.error = () => {};
  try {
    delete process.env.RESEND_API_KEY;
    assert.equal(await enviarEmail({ to: 'a@x.com', subject: 's', html: 'h' }), 0);
    process.env.RESEND_API_KEY = 'teste';
    global.fetch = async () => { throw new Error('rede'); };
    assert.equal(await enviarEmail({ to: ['a@x.com', 'b@x.com'], subject: 's', html: 'h' }), 0);
    const enviados = [];
    global.fetch = async (url, init) => { enviados.push(JSON.parse(init.body)); return { ok: true }; };
    assert.equal(await enviarModelo('novaInscricao', { dupla: 'A / B', categoria: 'C', campeonato: 'X', arena: 'Y', status: 'pendente' }, ['g@x.com']), 1);
    assert.equal(enviados[0].from, 'BT8 <noreply@bt8.com.br>');
    assert.deepEqual(enviados[0].to, ['g@x.com']);
    assert.equal(enviados[0].reply_to, 'suporte@bt8.com.br');
    assert.equal(await enviarModelo('naoExiste', {}, ['g@x.com']), 0);
  } finally {
    global.fetch = fetchOriginal;
    console.log = log; console.error = err;
    if (chave === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = chave;
  }
});

test('semAtrasar não segura a resposta além do limite e nunca lança', async () => {
  const err = console.error;
  console.error = () => {};
  try {
    const t0 = Date.now();
    await semAtrasar(new Promise(() => {}), 'teste', 50);
    assert.ok(Date.now() - t0 < 1000);
    await semAtrasar(Promise.reject(new Error('x')), 'teste', 50);
    let feito = false;
    await semAtrasar((async () => { feito = true; })(), 'teste', 50);
    assert.ok(feito);
  } finally { console.error = err; }
});

test('enviarEmail manda em paralelo com timeout por envio', async () => {
  const chave = process.env.RESEND_API_KEY, fetchOriginal = global.fetch, err = console.error;
  console.error = () => {};
  try {
    process.env.RESEND_API_KEY = 'teste';
    const sinais = [];
    let ativos = 0, pico = 0;
    global.fetch = async (url, init) => {
      sinais.push(init.signal);
      pico = Math.max(pico, ++ativos);
      await new Promise(r => setTimeout(r, 20));
      ativos--;
      return { ok: true };
    };
    assert.equal(await enviarEmail({ to: ['a@x.com', 'b@x.com', 'c@x.com'], subject: 's', html: 'h' }), 3);
    assert.equal(pico, 3);
    assert.ok(sinais.every(s => s && typeof s.aborted === 'boolean'));
  } finally {
    global.fetch = fetchOriginal; console.error = err;
    if (chave === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = chave;
  }
});
