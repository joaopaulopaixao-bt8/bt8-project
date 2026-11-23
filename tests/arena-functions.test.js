// Lógica pura das Functions do Módulo Arena (netlify/functions/lib/arena.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const A = require('../netlify/functions/lib/arena');

const CAT = '11111111-2222-4333-8444-555555555555';
const base = () => ({
  token: 'abcdef0123456789abcd', categoria_id: CAT, lgpd: true, lgpd_versao: A.ARENA_LGPD_VERSAO, website: '',
  atleta1: { nome: '  Ana   Souza ', telefone: '(81) 99999-0000' },
  atleta2: { nome: 'Bia Lima', telefone: '81988887777' }
});

test('normalizarTelefone: formatos brasileiros e internacionais', () => {
  assert.equal(A.normalizarTelefone('(81) 99999-0000'), '+5581999990000');
  assert.equal(A.normalizarTelefone('8133334444'), '+558133334444');
  assert.equal(A.normalizarTelefone('55 81 99999 0000'), '+5581999990000');
  assert.equal(A.normalizarTelefone('081999990000'), '+5581999990000');
  assert.equal(A.normalizarTelefone('+351 912 345 678'), '+351912345678');
  for (const ruim of ['', '123', '999990000', '+0123456789', 'abc', null, '+1234567890123456']) {
    assert.equal(A.normalizarTelefone(ruim), null, String(ruim));
  }
});

test('validarInscricao: caso válido normaliza nome e telefone', () => {
  const r = A.validarInscricao(base());
  assert.equal(r.erro, undefined);
  assert.equal(r.token, 'abcdef0123456789abcd');
  assert.deepEqual(r.dados, {
    category_id: CAT, consentimento_versao: A.ARENA_LGPD_VERSAO,
    atleta1: { nome: 'Ana Souza', telefone: '+5581999990000' },
    atleta2: { nome: 'Bia Lima', telefone: '+5581988887777' }
  });
});

test('validarInscricao: honeypot preenchido é robô', () => {
  assert.deepEqual(A.validarInscricao({ ...base(), website: 'http://spam' }), { honeypot: true });
});

test('validarInscricao: recusas', () => {
  const casos = [
    [{ lgpd: false }, /aceitar/],
    [{ lgpd_versao: '2020-01-01' }, /termo/],
    [{ token: 'curto' }, /Link/],
    [{ categoria_id: 'x' }, /categoria/],
    [{ atleta1: { nome: 'A', telefone: '81999990000' } }, /nome do atleta 1/],
    [{ atleta2: { nome: 'Bia', telefone: '123' } }, /atleta 2 inválido/],
    [{ atleta2: { nome: 'Bia', telefone: '81 99999-0000' } }, /diferentes/]
  ];
  for (const [patch, re] of casos) assert.match(A.validarInscricao({ ...base(), ...patch }).erro || '', re, JSON.stringify(patch));
  assert.ok(A.validarInscricao(null).erro);
});

test('statusDaRecusa', () => {
  assert.equal(A.statusDaRecusa('limite'), 429);
  assert.equal(A.statusDaRecusa('nao_encontrado'), 404);
  assert.equal(A.statusDaRecusa('atleta_ja_inscrito'), 400);
  assert.equal(A.statusDaRecusa(undefined), 400);
});

test('validarArena: padrões e recusas', () => {
  const ok = A.validarArena({ arena: { nome: 'Arena X', slug: 'Arena-X', estado: 'pe' },
    gestor: { nome: 'Fulano', email: 'G@X.COM', senha: '12345678' } });
  assert.equal(ok.arena.slug, 'arena-x');
  assert.equal(ok.arena.estado, 'PE');
  assert.equal(ok.arena.plano, 'fundadora');
  assert.equal(ok.arena.ativo_ate, '2027-03-31');
  assert.equal(ok.gestor.email, 'g@x.com');
  assert.match(A.validarArena({ arena: { nome: 'X', slug: 'a b' }, gestor: {} }).erro, /Slug/);
  assert.match(A.validarArena({ arena: { nome: 'X', slug: 'ab' }, gestor: { nome: 'Fu', email: 'x' } }).erro, /E-mail/);
  assert.match(A.validarArena({ arena: { nome: 'X', slug: 'ab' }, gestor: { nome: 'Fu', email: 'a@b.co', senha: '123' } }).erro, /senha/);
});

test('validarMembro: papéis, árbitro sem conta e atualização', () => {
  const arena_id = CAT;
  assert.match(A.validarMembro({ arena_id, papel: 'dono', nome: 'X Y', email: 'a@b.co' }).erro, /Papel/);
  assert.equal(A.validarMembro({ arena_id, papel: 'scout', nome: 'Scout Q1', email: 'S@B.CO', senha: '12345678' }).pessoa.email, 's@b.co');
  assert.equal(A.validarMembro({ arena_id, papel: 'arbitro', nome: 'Juiz', sem_conta: true }).sem_conta, true);
  assert.match(A.validarMembro({ arena_id, papel: 'scout', nome: 'Juiz', sem_conta: true }).erro, /árbitro/);
  assert.deepEqual(A.validarMembro({ acao: 'atualizar', arena_id, member_id: CAT, ativo: false }).patch, { ativo: false });
  assert.match(A.validarMembro({ acao: 'atualizar', arena_id, member_id: CAT, papel: 'dono' }).erro, /Papel/);
  assert.match(A.validarMembro({ acao: 'atualizar', arena_id, member_id: CAT }).erro, /Nada/);
  assert.match(A.validarMembro({ arena_id: 'x', papel: 'scout' }).erro, /Arena/);
});

test('dataValida: só datas que existem', () => {
  assert.ok(A.dataValida('2027-03-31'));
  assert.ok(A.dataValida('2028-02-29'));
  for (const ruim of ['2027-02-31', '2027-02-29', '2027-13-01', '27-03-31', '', null]) assert.equal(A.dataValida(ruim), false, String(ruim));
  assert.match(A.validarArena({ arena: { nome: 'X', slug: 'ab', ativo_ate: '2027-02-31' },
    gestor: { nome: 'Fu', email: 'a@b.co', senha: '12345678' } }).erro, /ativo até/);
});

test('validarPessoa exige senha sempre (não revela se o e-mail tem conta)', () => {
  assert.match(A.validarPessoa({ nome: 'Fulano', email: 'a@b.co' }).erro, /senha/);
  assert.equal(A.validarPessoa({ nome: 'Fulano', email: 'A@B.CO', senha: '12345678' }).email, 'a@b.co');
});

test('respostaDeErro: só repassa mensagem própria ou recusa de negócio', () => {
  const logs = [];
  const orig = console.error;
  console.error = m => logs.push(m);
  try {
    const interno = Object.assign(new Error('duplicate key value violates unique constraint'), { status: 500 });
    const r1 = A.respostaDeErro('teste', interno, 'Mensagem genérica.');
    assert.equal(r1.statusCode, 500);
    assert.equal(JSON.parse(r1.body).error, 'Mensagem genérica.');
    assert.equal(logs.length, 1);
    const r2 = A.respostaDeErro('teste', A.erroPublico(409, 'Já existe.'), 'x');
    assert.deepEqual([r2.statusCode, JSON.parse(r2.body).error], [409, 'Já existe.']);
    const negocio = Object.assign(new Error('Conta do gestor não encontrada.'), { code: 'P0001', hint: 'nao_encontrado' });
    assert.equal(JSON.parse(A.respostaDeErro('teste', negocio, 'x').body).erro, 'nao_encontrado');
    const semHint = Object.assign(new Error('User already registered'), { code: 'email_exists', status: 422 });
    assert.equal(JSON.parse(A.respostaDeErro('teste', semHint, 'Genérica.').body).error, 'Genérica.');
  } finally {
    console.error = orig;
  }
});

test('hojeSaoPaulo usa o dia de Brasília, não UTC', () => {
  assert.equal(A.hojeSaoPaulo(new Date('2026-12-01T02:30:00Z')), '2026-11-30'); // 23h30 do dia 30 em SP
  assert.equal(A.hojeSaoPaulo(new Date('2026-12-01T03:30:00Z')), '2026-12-01');
});

test('validarNovaSenha: regras da tela de troca obrigatória', () => {
  assert.equal(A.validarNovaSenha('senha123').senha, 'senha123');
  for (const ruim of ['curta1', 'somenteletras', '12345678', 'a1'.repeat(40), null]) assert.ok(A.validarNovaSenha(ruim).erro, String(ruim));
});

test('hashIp não expõe o IP e depende do segredo', () => {
  const h = A.hashIp('s1', '1.2.3.4');
  assert.match(h, /^[0-9a-f]{64}$/);
  assert.notEqual(h, A.hashIp('s2', '1.2.3.4'));
  assert.equal(A.clientIp({ 'x-forwarded-for': '9.9.9.9, 1.1.1.1' }), '9.9.9.9');
});

test('versão da LGPD igual no front (legal-pages.js) e na Function', () => {
  const src = fs.readFileSync(path.join(__dirname, '../src/js/legal-pages.js'), 'utf8');
  assert.equal(src.match(/BT8_ARENA_LGPD_VERSAO = '([^']+)'/)[1], A.ARENA_LGPD_VERSAO);
});
