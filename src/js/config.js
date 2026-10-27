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
  s4:  { label:'Super 4',       icon:'🎾', desc:'4 jogadores · Duplas rotativas · 3 rodadas · 6/6 pares cobertos · Ninguém descansa', stats:['4 jogadores','3 rodadas','6/6 pares','0 descanso'] },
  s6:  { label:'Super 6',       icon:'🎾', desc:'6 jogadores · 1 quadra por rodada · Cada jogador descansa 2x · 12/15 pares cobertos', stats:['6 jogadores','6 rodadas','12/15 pares','Descansa 2x'] },
  s8:  { label:'Super 8',       icon:'🎾', desc:'8 jogadores · 2 quadras simultâneas · 7 rodadas · Todos os 28 pares cobertos · Ninguém descansa', stats:['8 jogadores','7 rodadas','28/28 pares','2 quadras/rodada'] },
  s8x: { label:'Super 8 Soma X',icon:'➕', desc:'Mesma dinâmica do Super 8, mas o ranking é feito pela soma total de games ganhos, não por vitórias', stats:['8 jogadores','7 rodadas','28/28 pares','Ranking por games'] },
  s12: { label:'Super 12',      icon:'🎾', desc:'12 jogadores · 3 quadras simultâneas · 11 rodadas · Todos os 66 pares cobertos · Ninguém descansa', stats:['12 jogadores','11 rodadas','66/66 pares','3 quadras/rodada'] },
  mista:{ label:'Super Mista',icon:'⚥', desc:'Duplas mistas rotativas · Cada homem joga com cada mulher 1x · N ímpar gera bye rotativo · Ranking individual', stats:['NxN jogadores','Duplas rotativas','Ranking indiv.','H+M obrigatório'] },
  df:  { label:'Duplas Fixas',icon:'👥', desc:'Você forma as duplas manualmente · Mínimo 3 duplas · Número ímpar gera bye rotativo · Round Robin completo', stats:['3+ duplas','Round Robin','Bye automático','Você forma'] },
  dm:  { label:'Duplas Mistas',icon:'👫', desc:'Cada dupla obrigatoriamente 1 Homem + 1 Mulher · Cadastro manual · Round Robin completo', stats:['3+ duplas','Mistas','Round Robin','1H + 1M'] },
  da:  { label:'Duplas Aleatórias',icon:'🎲', desc:'Cadastre jogadores individualmente · Sorteio automático de duplas · Precisa ter número par de participantes', stats:['6+ jogadores','Sorteio','Participantes pares','Automático'] },
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

const ADMIN_EMAIL ='joaopaulopaixao@gmail.com'; // Altere conforme necessário
