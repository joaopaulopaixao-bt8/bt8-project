// Painel da arena (Minha arena, campeonato, inscritos, sorteio, grupos e chave). Agente A3.

// shortcut: sempre false até o backend da arena (migração 004) existir; depois consulta arena_members.
function isArenaMember() {
  return false;
}

function openMinhaArena() {
  closeUserMenu();
  goTo('screen-arena');
}
