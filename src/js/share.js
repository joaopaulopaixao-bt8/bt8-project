// ── SHARE ─────────────────────────────────────────────────
// Pré-carregar logo uma vez com crossOrigin para evitar canvas taint
let _logoReady = null;
function loadLogo() {
  if (_logoReady) return _logoReady;
  _logoReady = new Promise((resolve, reject) => {
    const img = new Image();
    // crossOrigin NÃO necessário para data: URIs, mas forçamos carregamento completo
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = document.querySelector('#screen-home img.logo-main').src;
  });
  return _logoReady;
}

// Canvas pronto? Guarda a promise aqui
let _canvasReady = null;

function openShare(){
  document.getElementById('share-modal').classList.add('open');
  // Botões ficam desabilitados enquanto gera
  document.getElementById('btn-dl').disabled = true;
  document.getElementById('btn-share').disabled = true;
  document.getElementById('btn-dl').textContent = '⏳ Gerando...';
  _canvasReady = generateShareCanvas().then(() => {
    document.getElementById('btn-dl').disabled = false;
    document.getElementById('btn-share').disabled = false;
    document.getElementById('btn-dl').textContent = 'Salvar Imagem';
  }).catch(err => {
    console.error('Erro ao gerar canvas:', err);
    document.getElementById('btn-dl').textContent = 'Salvar Imagem';
    document.getElementById('btn-dl').disabled = false;
    document.getElementById('btn-share').disabled = false;
  });
}

function closeShare(){
  document.getElementById('share-modal').classList.remove('open');
}

function rRect(ctx,x,y,w,h,r){
  ctx.beginPath();ctx.moveTo(x+r,y);ctx.lineTo(x+w-r,y);ctx.arcTo(x+w,y,x+w,y+r,r);
  ctx.lineTo(x+w,y+h-r);ctx.arcTo(x+w,y+h,x+w-r,y+h,r);
  ctx.lineTo(x+r,y+h);ctx.arcTo(x,y+h,x,y+h-r,r);
  ctx.lineTo(x,y+r);ctx.arcTo(x,y,x+r,y,r);ctx.closePath();
}

// Retorna Promise que resolve quando canvas estiver pintado
// Formato 9:16 — pódio no topo + tabela completa com sets de desempate
async function generateShareCanvas(){
  const m=APP.mode;
  const stand=getStandings();
  const fn=APP.matches.find(x=>x.phase==='final');
  const champ=fn?simWinner(fn):null;
  const label=MODE_INFO[m].label;
  const date=new Date().toLocaleDateString('pt-BR');
  const isSoma=IS_SOMA[m];
  const isDupla=IS_DUPLA_FIXA[m];

  // 9:16 — ideal para stories / WhatsApp
  const W=1080, H=1920;
  const PAD=52;
  const canvas=document.getElementById('share-canvas');
  canvas.width=W; canvas.height=H;
  const ctx=canvas.getContext('2d');
  const logo=await loadLogo();

  // ─── BACKGROUND ───────────────────────────────────────────
  const bg=ctx.createLinearGradient(0,0,0,H);
  bg.addColorStop(0,'#08121e'); bg.addColorStop(0.5,'#0a1828'); bg.addColorStop(1,'#060d16');
  ctx.fillStyle=bg; ctx.fillRect(0,0,W,H);

  const gTop=ctx.createRadialGradient(W/2,0,0,W/2,0,W*0.9);
  gTop.addColorStop(0,'rgba(26,127,196,0.30)'); gTop.addColorStop(1,'transparent');
  ctx.fillStyle=gTop; ctx.fillRect(0,0,W,H*0.6);

  const gMid=ctx.createRadialGradient(W*0.8,H*0.4,0,W*0.8,H*0.4,W*0.55);
  gMid.addColorStop(0,'rgba(244,192,38,0.09)'); gMid.addColorStop(1,'transparent');
  ctx.fillStyle=gMid; ctx.fillRect(0,0,W,H);

  // grain
  ctx.save(); ctx.globalAlpha=0.016;
  for(let i=0;i<3000;i++){
    ctx.fillStyle='#fff';
    ctx.fillRect(Math.random()*W,Math.random()*H,1.3,1.3);
  }
  ctx.restore();

  // ─── TOPO — barra gradiente ────────────────────────────────
  const tb=ctx.createLinearGradient(0,0,W,0);
  tb.addColorStop(0,'#1a7fc4'); tb.addColorStop(0.6,'#2d9cbe'); tb.addColorStop(1,'#f4c026');
  ctx.fillStyle=tb; ctx.fillRect(0,0,W,10);
  const ts=ctx.createLinearGradient(0,10,W,10);
  ts.addColorStop(0,'rgba(26,127,196,0.18)'); ts.addColorStop(1,'rgba(244,192,38,0.18)');
  ctx.fillStyle=ts; ctx.fillRect(0,10,W,32);

  // ─── LOGO ─────────────────────────────────────────────────
  const lH=118, lW=lH*(logo.naturalWidth/logo.naturalHeight);
  ctx.save(); ctx.shadowColor='rgba(26,127,196,0.55)'; ctx.shadowBlur=50;
  ctx.drawImage(logo,(W-lW)/2,56,lW,lH); ctx.restore();

  // ─── MODALIDADE + DATA ────────────────────────────────────
  ctx.textAlign='center';
  ctx.fillStyle='#f4c026';
  ctx.font='bold 48px sans-serif';
  ctx.fillText(label.toUpperCase(), W/2, 238);

  ctx.fillStyle='rgba(122,168,196,0.75)';
  ctx.font='30px sans-serif';
  ctx.fillText(date, W/2, 280);

  // linha decorativa
  const divG=ctx.createLinearGradient(PAD*2,0,W-PAD*2,0);
  divG.addColorStop(0,'transparent'); divG.addColorStop(0.25,'rgba(26,127,196,0.55)');
  divG.addColorStop(0.5,'rgba(244,192,38,0.75)'); divG.addColorStop(0.75,'rgba(26,127,196,0.55)');
  divG.addColorStop(1,'transparent');
  ctx.strokeStyle=divG; ctx.lineWidth=2;
  ctx.beginPath(); ctx.moveTo(PAD*2,306); ctx.lineTo(W-PAD*2,306); ctx.stroke();

  // ─── PÓDIO ────────────────────────────────────────────────
  const PODIUM_TOP=320;
  const PODIUM_H=380;
  const BASE_Y=PODIUM_TOP+PODIUM_H;
  const COL_W=(W-PAD*2)/3;
  const top3=stand.slice(0,3);

  // ordem visual: 2º, 1º, 3º
  const COLS=[
    {idx:1, barH:210, color:'#b0c8d4', glow:'rgba(176,200,212,0.22)',
     fill:['rgba(176,200,212,0.22)','rgba(176,200,212,0.04)'], border:'rgba(176,200,212,0.5)', medal:'🥈', rank:'2º'},
    {idx:0, barH:300, color:'#ffd84d', glow:'rgba(244,192,38,0.32)',
     fill:['rgba(244,192,38,0.32)','rgba(244,192,38,0.04)'], border:'rgba(244,192,38,0.75)', medal:'🥇', rank:'1º'},
    {idx:2, barH:140, color:'#c8955a', glow:'rgba(200,149,90,0.18)',
     fill:['rgba(200,149,90,0.18)','rgba(200,149,90,0.03)'], border:'rgba(200,149,90,0.5)', medal:'🥉', rank:'3º'},
  ];

  COLS.forEach((cfg,ci)=>{
    const p=top3[cfg.idx];
    if(!p) return;
    const bX=PAD + ci*COL_W + 18;
    const bW=COL_W - 36;
    const bTop=BASE_Y - cfg.barH;

    // glow radial atrás da barra
    const gGlow=ctx.createRadialGradient(bX+bW/2,BASE_Y,0,bX+bW/2,BASE_Y,bW*0.9);
    gGlow.addColorStop(0,cfg.glow); gGlow.addColorStop(1,'transparent');
    ctx.fillStyle=gGlow; ctx.fillRect(bX-20,BASE_Y-60,bW+40,80);

    // barra com gradiente
    const bGrad=ctx.createLinearGradient(0,bTop,0,BASE_Y);
    bGrad.addColorStop(0,cfg.fill[0]); bGrad.addColorStop(1,cfg.fill[1]);
    ctx.fillStyle=bGrad; rRect(ctx,bX,bTop,bW,cfg.barH,16); ctx.fill();

    // borda
    ctx.strokeStyle=cfg.border; ctx.lineWidth=2;
    rRect(ctx,bX,bTop,bW,cfg.barH,16); ctx.stroke();

    // posição dentro da barra
    ctx.fillStyle=cfg.color; ctx.textAlign='center';
    ctx.font=`bold ${cfg.idx===0?60:50}px sans-serif`;
    ctx.fillText(cfg.rank, bX+bW/2, bTop+cfg.barH*0.40+20);

    // medal
    ctx.font=`${cfg.idx===0?56:46}px sans-serif`;
    ctx.fillText(cfg.medal, bX+bW/2, bTop+cfg.barH*0.78+14);

    // nome ACIMA da barra
    ctx.fillStyle=cfg.color;
    ctx.font=`bold ${cfg.idx===0?38:30}px sans-serif`;
    let nome=p.name;
    while(ctx.measureText(nome).width>bW+10&&nome.length>2) nome=nome.slice(0,-1);
    if(nome!==p.name) nome=nome.slice(0,-1)+'…';
    ctx.fillText(nome, bX+bW/2, bTop-30);

    // score + sets abaixo do nome
    ctx.fillStyle='rgba(255,255,255,0.5)';
    ctx.font='23px sans-serif';
    let sub;
    if(isSoma) sub=`${p.games} games`;
    else if(isDupla) sub=`${p.v} vitórias · ${p.gp||0} sets`;
    else sub=`${p.pts} pts · ${p.sets_w||0} sets`;
    ctx.fillText(sub, bX+bW/2, bTop-6);
  });

  // ─── TABELA ───────────────────────────────────────────────
  const TY=BASE_Y+46;
  const TW=W-PAD*2;
  const ROW_H=74;

  // label tabela
  ctx.textAlign='left'; ctx.fillStyle='rgba(122,168,196,0.65)';
  ctx.font='bold 25px sans-serif';
  ctx.fillText('CLASSIFICAÇÃO FINAL', PAD, TY);

  ctx.strokeStyle='rgba(45,156,190,0.25)'; ctx.lineWidth=1;
  ctx.beginPath(); ctx.moveTo(PAD,TY+12); ctx.lineTo(W-PAD,TY+12); ctx.stroke();

  // cabeçalho
  const THY=TY+20; const THH=42;
  const thG=ctx.createLinearGradient(PAD,THY,PAD+TW,THY);
  thG.addColorStop(0,'rgba(26,127,196,0.28)'); thG.addColorStop(1,'rgba(26,127,196,0.07)');
  ctx.fillStyle=thG; rRect(ctx,PAD,THY,TW,THH,8); ctx.fill();

  ctx.fillStyle='rgba(122,168,196,0.85)'; ctx.font='bold 21px sans-serif';
  ctx.textAlign='left'; ctx.fillText('JOGADOR', PAD+60, THY+29);

  // colunas
  const COLS_X={sets:W-PAD-290, pts:W-PAD-130};
  ctx.textAlign='center';
  if(!isSoma){
    ctx.fillText('SALDO', COLS_X.sets+50, THY+29);
    ctx.fillText(isDupla?'V':'PTS', COLS_X.pts+50, THY+29);
  } else {
    ctx.fillText('GAMES', COLS_X.pts, THY+29);
  }

  // linhas
  const medals=['🥇','🥈','🥉'];
  const rowBorder=['rgba(255,212,77,0.6)','rgba(176,200,212,0.5)','rgba(200,149,90,0.5)'];
  const rowBg=['rgba(244,192,38,0.07)','rgba(176,200,212,0.05)','rgba(200,149,90,0.05)'];
  const nameCol=['#ffd84d','#c8d8e0','#c8955a','#d0e8f5'];

  stand.forEach((p,i)=>{
    const ry=THY+THH+6+i*ROW_H;

    // fundo da linha
    if(i<3){
      ctx.fillStyle=rowBg[i];
      rRect(ctx,PAD,ry,TW,ROW_H-5,8); ctx.fill();
      ctx.fillStyle=rowBorder[i];
      rRect(ctx,PAD,ry,5,ROW_H-5,2); ctx.fill();
    } else {
      ctx.fillStyle=i%2===0?'rgba(255,255,255,0.03)':'rgba(255,255,255,0.015)';
      rRect(ctx,PAD,ry,TW,ROW_H-5,8); ctx.fill();
    }

    // medalha / posição
    ctx.textAlign='left';
    if(i<3){
      ctx.font='38px sans-serif';
      ctx.fillText(medals[i], PAD+12, ry+50);
    } else {
      ctx.fillStyle='rgba(122,168,196,0.55)';
      ctx.font='bold 27px sans-serif';
      ctx.fillText(`${i+1}º`, PAD+14, ry+47);
    }

    // nome
    ctx.fillStyle=nameCol[i]||'#8ab8cc';
    ctx.font=`${i<3?'bold ':''} ${i===0?36:i<3?30:28}px sans-serif`;
    let nome=p.name;
    const maxNW=COLS_X.sets-PAD-76;
    while(ctx.measureText(nome).width>maxNW&&nome.length>2) nome=nome.slice(0,-1);
    if(nome!==p.name) nome=nome.slice(0,-1)+'…';
    ctx.fillText(nome, PAD+66, ry+42);

    // sub-linha: jogos e vitórias
    ctx.fillStyle='rgba(122,168,196,0.5)'; ctx.font='21px sans-serif';
    ctx.fillText(`${p.j} jogos · ${p.v||0} vitórias`, PAD+66, ry+64);

    // coluna SALDO (sets ganhos - sets perdidos)
    if(!isSoma){
      const saldo=p.saldo!==undefined?p.saldo:(p.sets_w!==undefined?(p.sets_w-p.sets_l):(p.gp-p.gc));
      const saldoStr=saldo>0?('+'+saldo):String(saldo);
      ctx.textAlign='center';
      // Verde para positivo, vermelho para negativo, cinza para zero
      ctx.fillStyle=saldo>0?'#4ade80':saldo<0?'#f87171':'#7aa8c4';
      ctx.font=`bold ${i<3?32:27}px sans-serif`;
      ctx.fillText(saldoStr, COLS_X.sets+50, ry+40);
      const sStr=saldo>=0?`+${saldo}`:String(saldo);
      ctx.fillStyle=saldo>0?'rgba(74,222,128,0.75)':saldo<0?'rgba(248,113,113,0.75)':'rgba(122,168,196,0.45)';
      ctx.font='20px sans-serif';
      ctx.fillText(sStr, COLS_X.sets+50, ry+63);
    }

    // coluna PTS / GAMES
    ctx.textAlign='center';
    const sv=isSoma?p.games:(p.pts!==undefined?p.pts:p.v);
    ctx.fillStyle=i===0?'#ffd84d':isSoma?'#f4c026':'#2d9cbe';
    ctx.font=`bold ${i<3?36:28}px sans-serif`;
    ctx.fillText(String(sv), COLS_X.pts+50, ry+47);

    // divisor
    ctx.strokeStyle='rgba(255,255,255,0.04)'; ctx.lineWidth=1;
    ctx.beginPath();
    ctx.moveTo(PAD+10,ry+ROW_H-5); ctx.lineTo(W-PAD-10,ry+ROW_H-5);
    ctx.stroke();
  });

  // legenda de colunas
  if(!isSoma){
    const legY=THY+THH+6+stand.length*ROW_H+16;
    ctx.textAlign='center'; ctx.fillStyle='rgba(122,168,196,0.35)';
    ctx.font='20px sans-serif';
    ctx.fillText('Sets = desempate por sets ganhos · Saldo (+/-) = ganhos − sofridos', W/2, legY);
  }

  // ─── FOOTER ───────────────────────────────────────────────
  const FY=H-80;
  const fdG=ctx.createLinearGradient(PAD,FY,W-PAD,FY);
  fdG.addColorStop(0,'transparent'); fdG.addColorStop(0.3,'rgba(26,127,196,0.3)');
  fdG.addColorStop(0.7,'rgba(244,192,38,0.3)'); fdG.addColorStop(1,'transparent');
  ctx.strokeStyle=fdG; ctx.lineWidth=1;
  ctx.beginPath(); ctx.moveTo(PAD,FY); ctx.lineTo(W-PAD,FY); ctx.stroke();

  // mini logo + texto
  const mH=44, mW=mH*(logo.naturalWidth/logo.naturalHeight);
  ctx.drawImage(logo,(W-mW)/2-72,FY+14,mW,mH);
  ctx.fillStyle='rgba(122,168,196,0.5)'; ctx.font='bold 28px sans-serif';
  ctx.textAlign='left';
  ctx.fillText('Beach Tennis', (W+mW)/2-66, FY+40);

  // barra inferior
  const bb=ctx.createLinearGradient(0,H-10,W,H-10);
  bb.addColorStop(0,'#1a7fc4'); bb.addColorStop(1,'#f4c026');
  ctx.fillStyle=bb; ctx.fillRect(0,H-10,W,10);
}

async function getCanvasDataURL() {
  if (_canvasReady) await _canvasReady;
  return document.getElementById('share-canvas').toDataURL('image/png');
}

async function getCanvasBlob() {
  if (_canvasReady) await _canvasReady;
  return new Promise(resolve =>
    document.getElementById('share-canvas').toBlob(resolve, 'image/png')
  );
}

async function downloadPNG(){
  const btn = document.getElementById('btn-dl');
  btn.disabled = true; btn.textContent = '⏳...';
  try {
    const dataURL = await getCanvasDataURL();
    const m=APP.mode;
    const label=(MODE_INFO[m]?.label||'ranking').replace(/\s/g,'-');
    const link=document.createElement('a');
    link.download=`BT8-${label}-ranking.png`;
    link.href=dataURL;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  } catch(e){ console.error(e); alert('Erro ao gerar PNG'); }
  btn.disabled = false; btn.textContent = '⬇ Salvar PNG';
}

async function nativeShare(){
  const btn = document.getElementById('btn-share');
  btn.disabled = true; btn.textContent = '⏳...';
  try {
    const blob = await getCanvasBlob();
    const m=APP.mode;
    const label=(MODE_INFO[m]?.label||'ranking').replace(/\s/g,'-');
    const file=new File([blob],`BT8-${label}-ranking.png`,{type:'image/png'});
    if(navigator.canShare&&navigator.canShare({files:[file]})){
      await navigator.share({title:'BT8 — Ranking',text:`Resultado do torneio ${MODE_INFO[m]?.label||''} 🏖️`,files:[file]});
    } else {
      // Fallback: download direto
      await downloadPNG();
    }
  } catch(e){
    if(e.name!=='AbortError') { console.error(e); await downloadPNG(); }
  }
  btn.disabled = false; btn.textContent = 'Compartilhar';
}
