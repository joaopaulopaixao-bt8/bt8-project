// ══════════════════════════════════════════════════
// CONFIG — Schedules, Modos, Constantes
// ══════════════════════════════════════════════════

// ══════════════════════════════════════════════════
// SCHEDULES
// ══════════════════════════════════════════════════
const SCHEDULES = {
  s4:[ {c:[{d1:[0,1],d2:[2,3]}],r:[]},{c:[{d1:[0,2],d2:[1,3]}],r:[]},{c:[{d1:[0,3],d2:[1,2]}],r:[]} ],
  s6:[ {c:[{d1:[0,1],d2:[2,3]}],r:[4,5]},{c:[{d1:[4,5],d2:[0,2]}],r:[1,3]},{c:[{d1:[1,3],d2:[0,4]}],r:[2,5]},{c:[{d1:[2,5],d2:[1,4]}],r:[0,3]},{c:[{d1:[0,5],d2:[3,4]}],r:[1,2]},{c:[{d1:[1,2],d2:[3,5]}],r:[0,4]} ],
  s8:[ {c:[{d1:[0,2],d2:[1,3]},{d1:[4,6],d2:[5,7]}]},{c:[{d1:[0,1],d2:[2,3]},{d1:[4,5],d2:[6,7]}]},{c:[{d1:[0,4],d2:[3,7]},{d1:[1,5],d2:[2,6]}]},{c:[{d1:[0,5],d2:[1,4]},{d1:[2,7],d2:[3,6]}]},{c:[{d1:[0,7],d2:[2,5]},{d1:[1,6],d2:[3,4]}]},{c:[{d1:[0,3],d2:[5,6]},{d1:[1,2],d2:[4,7]}]},{c:[{d1:[0,6],d2:[1,7]},{d1:[2,4],d2:[3,5]}]} ],
  s8x:null,
  s12:[ {c:[{d1:[0,1],d2:[7,10]},{d1:[2,4],d2:[5,9]},{d1:[3,8],d2:[6,11]}]},{c:[{d1:[1,2],d2:[8,0]},{d1:[3,5],d2:[6,10]},{d1:[4,9],d2:[7,11]}]},{c:[{d1:[2,3],d2:[9,1]},{d1:[4,6],d2:[7,0]},{d1:[5,10],d2:[8,11]}]},{c:[{d1:[3,4],d2:[10,2]},{d1:[5,7],d2:[8,1]},{d1:[6,0],d2:[9,11]}]},{c:[{d1:[4,5],d2:[0,3]},{d1:[6,8],d2:[9,2]},{d1:[7,1],d2:[10,11]}]},{c:[{d1:[5,6],d2:[1,4]},{d1:[7,9],d2:[10,3]},{d1:[8,2],d2:[0,11]}]},{c:[{d1:[6,7],d2:[2,5]},{d1:[8,10],d2:[0,4]},{d1:[9,3],d2:[1,11]}]},{c:[{d1:[7,8],d2:[3,6]},{d1:[9,0],d2:[1,5]},{d1:[10,4],d2:[2,11]}]},{c:[{d1:[8,9],d2:[4,7]},{d1:[10,1],d2:[2,6]},{d1:[0,5],d2:[3,11]}]},{c:[{d1:[9,10],d2:[5,8]},{d1:[0,2],d2:[3,7]},{d1:[1,6],d2:[4,11]}]},{c:[{d1:[10,0],d2:[6,9]},{d1:[1,3],d2:[4,8]},{d1:[2,7],d2:[5,11]}]} ],
  mista:[ {c:[{d1:[0,2],d2:[1,3]}],r:[]},{c:[{d1:[0,3],d2:[1,2]}],r:[]},{c:[{d1:[1,2],d2:[0,3]}],r:[]} ],
};

const MODE_INFO = {
  s4:  { label:'Super 4',       icon:'ball', desc:'4 jogadores · Duplas rotativas · 3 rodadas · 6/6 pares cobertos · Ninguém descansa', stats:['4 jogadores','3 rodadas','6/6 pares','0 descanso'] },
  s6:  { label:'Super 6',       icon:'ball', desc:'6 jogadores · 1 quadra por rodada · Cada jogador descansa 2x · 12/15 pares cobertos', stats:['6 jogadores','6 rodadas','12/15 pares','Descansa 2x'] },
  s8:  { label:'Super 8',       icon:'ball', desc:'8 jogadores · 2 quadras simultâneas · 7 rodadas · Todos os 28 pares cobertos · Ninguém descansa', stats:['8 jogadores','7 rodadas','28/28 pares','2 quadras/rodada'] },
  s8x: { label:'Super 8 Soma X',icon:'plus', desc:'Mesma dinâmica do Super 8, mas o ranking é feito pela soma total de games ganhos, não por vitórias', stats:['8 jogadores','7 rodadas','28/28 pares','Ranking por games'] },
  s12: { label:'Super 12',      icon:'ball', desc:'12 jogadores · 3 quadras simultâneas · 11 rodadas · Todos os 66 pares cobertos · Ninguém descansa', stats:['12 jogadores','11 rodadas','66/66 pares','3 quadras/rodada'] },
  mista:{ label:'Super Mista',icon:'users', desc:'Duplas mistas rotativas · Cada homem joga com cada mulher 1x · N ímpar gera bye rotativo · Ranking individual', stats:['NxN jogadores','Duplas rotativas','Ranking indiv.','H+M obrigatório'] },
  df:  { label:'Duplas Fixas',icon:'users', desc:'Você forma as duplas manualmente · Mínimo 3 duplas · Número ímpar gera bye rotativo · Round Robin completo', stats:['3+ duplas','Round Robin','Bye automático','Você forma'] },
  dm:  { label:'Duplas Mistas',icon:'users', desc:'Cada dupla obrigatoriamente 1 Homem + 1 Mulher · Cadastro manual · Round Robin completo', stats:['3+ duplas','Mistas','Round Robin','1H + 1M'] },
  da:  { label:'Duplas Aleatórias',icon:'dices', desc:'Cadastre jogadores individualmente · Sorteio automático de duplas · Precisa ter número par de participantes', stats:['6+ jogadores','Sorteio','Participantes pares','Automático'] },
};
const MAX_PLAYERS = { s4:4,s6:6,s8:8,s8x:8,s12:12 }; // mista: sem máximo fixo
const IS_SOMA = { s8x:true };
const IS_DUPLA_FIXA  = { df:true, dm:true, da:true };
const IS_MISTA_DUPLA = { dm:true };
const IS_ALEATORIO   = { da:true };
const IS_ELIMINATORIO = {}; // definido dinamicamente ao gerar
const IS_MISTA_ROTATIVA = { mista:true }; // super mista dinâmica: H+M rotativos, ranking individual


// Escapa texto digitado pelo usuário (nomes de jogadores, duplas, perfil) antes de ir para innerHTML.
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}

// Ícones de traço (desenhos do lucide.dev, ISC; "ball" é próprio). Herdam cor e tamanho do texto.
const ICON_PATHS = {
  ball: '<circle cx="12" cy="12" r="10"/><path d="M5.6 4.9c3.2 3.4 3.2 10.8 0 14.2"/><path d="M18.4 4.9c-3.2 3.4-3.2 10.8 0 14.2"/>',
  user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  dices: '<rect width="12" height="12" x="2" y="10" rx="2"/><path d="m17.92 14 3.5-3.5a2.24 2.24 0 0 0 0-3l-5-4.92a2.24 2.24 0 0 0-3 0L10 6"/><path d="M6 18h.01"/><path d="M10 14h.01"/><path d="M15 6h.01"/><path d="M18 9h.01"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  eye: '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.53 13.53 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><path d="m2 2 20 20"/>',
  zap: '<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/>',
  pencil: '<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>',
  share: '<path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><path d="m16 6-4-4-4 4"/><path d="M12 2v13"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
  check: '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.07"/><path d="m22 4-10 10.01-3-3"/>',
  alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  trophy: '<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>',
  award: '<circle cx="12" cy="8" r="6"/><path d="M15.48 12.89 17 22l-5-3-5 3 1.52-9.11"/>',
  star: '<path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  repeat: '<path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>',
  refresh: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
  moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
  lock: '<rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  mail: '<rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>'
};
function icon(name) {
  return `<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_PATHS[name]}</svg>`;
}

const ADMIN_EMAIL ='joaopaulopaixao@gmail.com'; // Altere conforme necessário
