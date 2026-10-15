import {
  collection, doc, addDoc, updateDoc, onSnapshot
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db, CATS, EVENT_DATE, SLOT_MIN } from "./firebase-init.js";

// ---------- state ----------
const FIELDS = ['Grand Stand', 'Campo 2'];
let TEAMS = [], MATCHES = [], ANNOUNCEMENTS = [], SCORERS = [], SUMULAS = [];
let filters = { cronoDay:'all', cronoCat:'all', gruposCat:CATS[0], placaresCat:'all', muralCat:'all', artCat:'all', camposField:FIELDS[0], camposDay:'all' };
let crestTargetTeamId = null;

function crestHtml(team){
  if(!team) return '';
  if(team.logoUrl) return `<img src="${team.logoUrl}">`;
  return escapeHtml((team.name||'').slice(0,2).toUpperCase());
}

function teamName(id, fallback){
  const t = TEAMS.find(t=>t.id===id);
  return t ? t.name : (fallback || 'A definir');
}
function escapeHtml(s){
  return (s||'').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
// Nome de exibição do campo (o valor salvo no banco continua "Grand Stand"/"Campo 2" pra não quebrar jogos já cadastrados).
const CAMPO_NAMES = { 'Grand Stand':{name:'Main Ground', sub:'Campo 1'}, 'Campo 2':{name:'Lions Field', sub:'Campo 2'} };
// Valores antigos/digitados à mão ("Campo 1", "campo 1", "Grandstand"...) viram o valor canônico.
function normalizeCampo(campo){
  const k = String(campo||'').trim().toLowerCase().replace(/\s+/g,'');
  if(['campo1','grandstand','grandground','mainground'].includes(k)) return 'Grand Stand';
  if(['campo2','lionsfield'].includes(k)) return 'Campo 2';
  return campo||'';
}
function campoLabel(campo){
  const c = CAMPO_NAMES[normalizeCampo(campo)];
  return c ? `${c.name} (${c.sub})` : (campo||'');
}
// versão em HTML: nome do campo em destaque, "(Campo N)" menor e discreto ao lado.
function campoLabelHtml(campo){
  const c = CAMPO_NAMES[normalizeCampo(campo)];
  if(!c) return escapeHtml(campo||'');
  return `${escapeHtml(c.name)} <span class="campo-sub">(${escapeHtml(c.sub)})</span>`;
}
function fmtTime(ts){
  if(!ts) return '';
  const d = new Date(ts);
  return d.toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' });
}
function fmtHM(ts){
  if(!ts) return '--:--';
  return new Date(ts).toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit' });
}
// Converte "data" (YYYY-MM-DD) + "horario" (HH:MM) cadastrados no jogo pra timestamp.
function matchTimestamp(dataStr, horarioStr){
  if(!dataStr || !horarioStr) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(horarioStr).trim());
  if(!m) return null;
  const d = new Date(dataStr+'T00:00:00-03:00');
  d.setHours(parseInt(m[1],10), parseInt(m[2],10), 0, 0);
  return d.getTime();
}
// Calcula, por campo, o atraso acumulado a partir dos jogos que já tiveram
// startedAt registrado (botão "Iniciar jogo" no admin) e projeta o horário
// previsto dos jogos seguintes que ainda não começaram naquele campo.
function computeFieldDelays(){
  const out = {};
  FIELDS.forEach(field=>{
    const list = MATCHES.filter(m=>normalizeCampo(m.campo)===field)
      .sort((a,b)=>(a.data||'').localeCompare(b.data||'')||(a.horario||'').localeCompare(b.horario||''));
    let cursorDelayMs = 0;
    list.forEach(m=>{
      const schedTs = matchTimestamp(m.data, m.horario);
      if(m.startedAt){
        const actualDelayMs = m.startedAt - (schedTs ?? m.startedAt);
        cursorDelayMs = Math.max(0, actualDelayMs);
        out[m.id] = { delayMin: Math.round(cursorDelayMs/60000), estimatedTs: m.startedAt, scheduledTs: schedTs, manual:false };
      } else if(m.horarioManual){
        // ajuste manual do organizador (sobrepõe o cálculo automático em caso de desencontro)
        const manualDelayMs = m.horarioManual - (schedTs ?? m.horarioManual);
        cursorDelayMs = Math.max(0, manualDelayMs);
        out[m.id] = { delayMin: Math.round(cursorDelayMs/60000), estimatedTs: m.horarioManual, scheduledTs: schedTs, manual:true };
      } else {
        const estimatedTs = schedTs!=null ? schedTs + cursorDelayMs : null;
        out[m.id] = { delayMin: Math.round(cursorDelayMs/60000), estimatedTs, scheduledTs: schedTs, manual:false };
      }
    });
  });
  return out;
}

// ---------- navigation ----------
const MORE_TABS = ['regulamento','artilharia','times','sumula','avisos','campos','mapa'];
// o card de contagem/placar ao vivo só faz sentido na home e nas telas de jogos/placar
const NOW_CARD_TABS = ['inicio','placares','campos'];
function goToTab(tab){
  document.querySelectorAll('.screen').forEach(s=> s.classList.toggle('active', s.id==='screen-'+tab));
  document.querySelectorAll('.bn-btn[data-tab]').forEach(b=> b.classList.toggle('active', b.dataset.tab===tab));
  const moreBtn = document.getElementById('moreNavBtn');
  if(moreBtn) moreBtn.classList.toggle('active', MORE_TABS.includes(tab) && !['cronograma','grupos','placares','inicio'].includes(tab));
  const nowCard = document.getElementById('nowCard');
  document.body.classList.toggle('on-map', tab==='mapa');
  if(nowCard) nowCard.style.display = NOW_CARD_TABS.includes(tab) ? '' : 'none';
  window.scrollTo({top:0});
}
document.querySelectorAll('.bn-btn[data-tab]').forEach(btn=>{
  btn.addEventListener('click', ()=> goToTab(btn.dataset.tab));
});
document.getElementById('moreNavBtn').addEventListener('click', ()=> document.getElementById('moreSheet').classList.add('open'));
document.getElementById('moreClose').addEventListener('click', ()=> document.getElementById('moreSheet').classList.remove('open'));
document.querySelectorAll('[data-goto]').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    goToTab(btn.dataset.goto);
    document.getElementById('moreSheet').classList.remove('open');
  });
});
// ---------- mapa do clube: toca num campo e vai direto pros jogos ao vivo dele ----------
document.querySelectorAll('.map-hotspot').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    filters.camposField = btn.dataset.campo;
    renderAll();
    goToTab('campos');
  });
});

// ---------- mapa do clube: zoom e pan (arrastar, beliscar, roda do mouse, duplo toque) ----------
(function(){
  const stage = document.getElementById('mapStage');
  const canvas = document.getElementById('mapCanvas');
  const img = document.getElementById('mapImg');
  if(!stage || !canvas || !img) return;

  let scale = 1, fitScale = 1, minScale = 1, maxScale = 5;
  let tx = 0, ty = 0, naturalW = 0, naturalH = 0;

  function clamp(v,a,b){ return Math.max(a, Math.min(b, v)); }

  function constrain(){
    const sw = stage.clientWidth, sh = stage.clientHeight;
    const cw = naturalW*scale, ch = naturalH*scale;
    tx = cw <= sw ? (sw-cw)/2 : clamp(tx, sw-cw, 0);
    ty = ch <= sh ? (sh-ch)/2 : clamp(ty, sh-ch, 0);
  }
  function apply(){
    canvas.style.transform = `translate(${tx}px,${ty}px) scale(${scale})`;
  }
  function setScale(next, originX, originY){
    next = clamp(next, minScale, maxScale);
    const factor = next/scale;
    tx = originX - (originX-tx)*factor;
    ty = originY - (originY-ty)*factor;
    scale = next;
    constrain();
    apply();
  }
  // ponto de interesse inicial: o centro dos dois campos (em % da imagem)
  const FOCUS = { x:0.575, y:0.50 };
  function computeLimits(){
    const sw = stage.clientWidth, sh = stage.clientHeight;
    // "cover": a imagem sempre preenche o palco, sem faixas vazias nas bordas
    fitScale = Math.max(sw/naturalW, sh/naturalH);
    minScale = fitScale;
    maxScale = Math.max(fitScale*4, 1.6);
  }
  function reset(){
    computeLimits();
    // abre já um pouco aproximado, centrado nos campos, pra ficar legível no celular
    scale = minScale;
    tx = stage.clientWidth/2  - FOCUS.x*naturalW*scale;
    ty = stage.clientHeight/2 - FOCUS.y*naturalH*scale;
    constrain();
    apply();
  }
  function init(){
    naturalW = img.naturalWidth; naturalH = img.naturalHeight;
    if(!naturalW || !naturalH) return;
    canvas.style.width = naturalW+'px';
    canvas.style.height = naturalH+'px';
    reset();
  }
  if(img.complete && img.naturalWidth) init(); else img.addEventListener('load', init);
  // a tela do mapa começa escondida (display:none) até o usuário navegar até ela,
  // então o cálculo de fitScale acima roda com o palco com largura zero. Um
  // ResizeObserver no palco recalcula assim que ele ganha tamanho real (ao ficar
  // visível) e também em qualquer resize/mudança de orientação depois disso.
  let sized = false;
  function trySize(){
    if(!naturalW || stage.clientWidth<=0) return;
    if(!sized){ sized = true; reset(); return; }
    // já inicializado (ex.: barra do navegador mobile mudou a altura): mantém a posição do usuário
    const prevMin = minScale; computeLimits();
    scale = clamp(scale*(minScale/prevMin), minScale, maxScale);
    constrain(); apply();
  }
  if('ResizeObserver' in window){
    new ResizeObserver(trySize).observe(stage);
  } else {
    window.addEventListener('resize', trySize);
  }

  // arrastar (mouse e toque) e beliscar, via Pointer Events.
  // só vira "arrastar de verdade" (e captura o pointer) depois de um movimento mínimo,
  // assim um toque simples num campo continua dando o click normal no hotspot.
  const DRAG_THRESHOLD = 6;
  const pointers = new Map();
  let dragging = false, captured = false, downX = 0, downY = 0, lastX = 0, lastY = 0, downOnButton = false;
  let pinchStartDist = 0, pinchStartScale = 1, pinchMid = {x:0,y:0};
  let lastTapAt = 0;

  const navEl = document.querySelector('.bottom-nav');
  if(navEl) document.documentElement.style.setProperty('--navh', (navEl.offsetHeight - parseFloat(getComputedStyle(navEl).paddingBottom||0)) + 'px');
  const hint = document.getElementById('mapHint');
  function hideHint(){ if(hint) hint.classList.add('hide'); }
  stage.addEventListener('pointerdown', e=>{
    if(!naturalW) return;
    pointers.set(e.pointerId, {x:e.clientX, y:e.clientY});
    if(pointers.size===1){
      downX = lastX = e.clientX; downY = lastY = e.clientY;
      dragging = false; captured = false;
      // guarda se o toque começou num botão (zoom +/-/centralizar, ou um hotspot de
      // campo): se o usuário só tocar e soltar, deixamos o click nativo do botão
      // acontecer normalmente (sem entrar na lógica de duplo-toque pra zoom, senão um
      // toque rápido no botão de centralizar contaria como "tap" e disparava zoom à
      // toa). Mas se o toque virar um arrasto de verdade (passar do limiar abaixo),
      // ele vira pan mesmo tendo começado em cima de um hotspot — graças ao
      // setPointerCapture no pointermove, que redireciona o alvo do pointerup e por
      // tabela cancela o click nativo do botão, então arrastar a partir de um campo
      // nunca é confundido com um toque nele.
      downOnButton = !!e.target.closest('button');
    } else if(pointers.size===2){
      dragging = false;
      if(!captured){ stage.setPointerCapture(e.pointerId); captured = true; stage.classList.add('is-dragging'); }
      const pts = [...pointers.values()];
      pinchStartDist = Math.hypot(pts[0].x-pts[1].x, pts[0].y-pts[1].y);
      pinchStartScale = scale;
      const rect = stage.getBoundingClientRect();
      pinchMid = { x:(pts[0].x+pts[1].x)/2 - rect.left, y:(pts[0].y+pts[1].y)/2 - rect.top };
    }
  });
  stage.addEventListener('pointermove', e=>{
    if(!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, {x:e.clientX, y:e.clientY});
    if(pointers.size===2 && pinchStartDist>0){
      const pts = [...pointers.values()];
      const dist = Math.hypot(pts[0].x-pts[1].x, pts[0].y-pts[1].y);
      setScale(pinchStartScale*(dist/pinchStartDist), pinchMid.x, pinchMid.y);
    } else if(pointers.size===1){
      if(!dragging){
        if(Math.hypot(e.clientX-downX, e.clientY-downY) < DRAG_THRESHOLD) return;
        dragging = true; hideHint();
        if(!captured){ stage.setPointerCapture(e.pointerId); captured = true; }
        stage.classList.add('is-dragging');
      }
      const dx = e.clientX-lastX, dy = e.clientY-lastY;
      lastX = e.clientX; lastY = e.clientY;
      tx += dx; ty += dy;
      constrain(); apply();
    }
  });
  function endPointer(e){
    pointers.delete(e.pointerId);
    if(pointers.size<2) pinchStartDist = 0;
    if(pointers.size===0){ dragging = false; captured = false; stage.classList.remove('is-dragging'); }
  }
  stage.addEventListener('pointerup', e=>{
    if(!dragging && !pinchStartDist && pointers.size===1 && !downOnButton){
      const now = Date.now();
      if(now-lastTapAt < 300){
        const rect = stage.getBoundingClientRect();
        setScale(scale>fitScale*1.9 ? fitScale : fitScale*2.8, e.clientX-rect.left, e.clientY-rect.top);
      }
      lastTapAt = now;
    }
    endPointer(e);
  });
  stage.addEventListener('pointercancel', endPointer);

  // roda do mouse (desktop)
  stage.addEventListener('wheel', e=>{
    if(!naturalW) return;
    e.preventDefault(); hideHint();
    const rect = stage.getBoundingClientRect();
    const ox = e.clientX-rect.left, oy = e.clientY-rect.top;
    setScale(scale*Math.exp(-e.deltaY*(e.ctrlKey?0.01:0.0016)), ox, oy);
  }, { passive:false });

  document.getElementById('mapZoomIn')?.addEventListener('click', ()=> setScale(scale*1.4, stage.clientWidth/2, stage.clientHeight/2));
  document.getElementById('mapZoomOut')?.addEventListener('click', ()=> setScale(scale/1.4, stage.clientWidth/2, stage.clientHeight/2));
  document.getElementById('mapZoomReset')?.addEventListener('click', reset);
})();

// ---------- countdown ----------
function renderCountdown(){
  const now = new Date();
  const diff = EVENT_DATE - now;
  const row = document.getElementById('countdownRow');
  if(diff <= 0){
    row.innerHTML = '<div class="now-pill" style="flex:none;padding:12px 22px;"><b>É hoje!</b><span>Bora</span></div>';
    return;
  }
  const days = Math.floor(diff/86400000);
  const hrs = Math.floor((diff%86400000)/3600000);
  row.innerHTML = `<div class="now-pill"><b>${days}</b><span>dias</span></div><div class="now-pill"><b>${hrs}</b><span>horas</span></div>`;
}
renderCountdown();
setInterval(renderCountdown, 60000);

// ---------- filter pills ----------
function buildPillRow(el, options, key, allLabel){
  el.innerHTML = '';
  const opts = allLabel ? [{v:'all',l:allLabel}, ...options.map(o=>({v:o,l:o}))] : options.map(o=>({v:o,l:o}));
  opts.forEach(o=>{
    const chip = document.createElement('button');
    chip.className = 'pill' + (filters[key]===o.v ? ' active':'');
    chip.textContent = o.l;
    chip.onclick = ()=>{ filters[key]=o.v; renderAll(); };
    el.appendChild(chip);
  });
}

function faseLabel(f){
  return {grupo:'Fase de grupos', quartas:'Quartas de final', semi:'Semifinal', final:'Final'}[f] || f;
}

// ---------- CRONOGRAMA ----------
function renderCronograma(){
  buildPillRow(document.getElementById('cronoDayFilter'), ['2026-12-12','2026-12-13'], 'cronoDay', 'Todos os dias');
  document.querySelectorAll('#cronoDayFilter .pill').forEach((chip,i)=>{
    if(i>0) chip.textContent = i===1 ? 'Sáb 12/12' : 'Dom 13/12';
  });
  buildPillRow(document.getElementById('cronoCatFilter'), CATS, 'cronoCat', 'Todas as categorias');

  let list = MATCHES.slice();
  if(filters.cronoDay!=='all') list = list.filter(m=>m.data===filters.cronoDay);
  if(filters.cronoCat!=='all') list = list.filter(m=>m.categoria===filters.cronoCat);
  list.sort((a,b)=>(a.data||'').localeCompare(b.data||'')||(a.horario||'').localeCompare(b.horario||''));

  const el = document.getElementById('cronoList');
  if(list.length===0){ el.innerHTML = '<p class="empty">Nenhum jogo cadastrado ainda.</p>'; return; }
  const delays = computeFieldDelays();
  el.innerHTML = list.map(m=>{
    const dot = m.status==='ao_vivo' ? 'live' : (m.status==='encerrado' ? 'done' : 'sched');
    const scoreTxt = (m.status!=='agendado') ? `${m.scoreA??0} – ${m.scoreB??0}` : '';
    const d = delays[m.id];
    const delayTag = (m.status==='agendado' && d && d.delayMin>0) ? ` <span class="delay-tag">atraso ~${d.delayMin}min</span>` : '';
    return `<div class="match-row">
      <div class="mtime">${m.horario||'--:--'}<span class="d">${m.data==='2026-12-13'?'Dom':'Sáb'}</span></div>
      <div class="mmid">
        <div class="mteams"><span class="status-dot ${dot}"></span>${teamName(m.teamAId,m.teamAName)} x ${teamName(m.teamBId,m.teamBName)}</div>
        <div class="mmeta">${m.categoria} · ${faseLabel(m.fase)}${m.campo?(' · '+campoLabelHtml(m.campo)):''}${delayTag}</div>
      </div>
      <div class="mscore">${scoreTxt}</div>
    </div>`;
  }).join('');
}

// ---------- GRUPOS ----------
function computeStandings(categoria){
  const teams = TEAMS.filter(t=>t.categoria===categoria);
  const groupMatches = MATCHES.filter(m=>m.categoria===categoria && m.fase==='grupo' && m.status==='encerrado');
  const groups = {};
  teams.forEach(t=>{
    const g = t.grupo || 'Único';
    if(!groups[g]) groups[g] = {};
    groups[g][t.id] = { id:t.id, name:t.name, pts:0, v:0, e:0, d:0, pf:0, pc:0 };
  });
  groupMatches.forEach(m=>{
    const tA = teams.find(t=>t.id===m.teamAId), tB = teams.find(t=>t.id===m.teamBId);
    if(!tA || !tB) return;
    const gA = tA.grupo || 'Único';
    const rowA = groups[gA] && groups[gA][tA.id], rowB = groups[gA] && groups[gA][tB.id];
    if(!rowA || !rowB) return;
    rowA.pf += m.scoreA||0; rowA.pc += m.scoreB||0;
    rowB.pf += m.scoreB||0; rowB.pc += m.scoreA||0;
    if(m.scoreA>m.scoreB){ rowA.v++; rowA.pts+=3; rowB.d++; }
    else if(m.scoreB>m.scoreA){ rowB.v++; rowB.pts+=3; rowA.d++; }
    else { rowA.e++; rowB.e++; rowA.pts++; rowB.pts++; }
  });
  const out = {};
  Object.keys(groups).forEach(g=>{
    out[g] = Object.values(groups[g]).sort((a,b)=> b.pts-a.pts || (b.pf-b.pc)-(a.pf-a.pc));
  });
  return out;
}
function renderGrupos(){
  buildPillRow(document.getElementById('gruposCatFilter'), CATS, 'gruposCat', null);
  const cat = filters.gruposCat;
  const standings = computeStandings(cat);
  const area = document.getElementById('standingsArea');
  const groupKeys = Object.keys(standings);
  if(groupKeys.length===0 || groupKeys.every(g=>standings[g].length===0)){
    area.innerHTML = '<p class="empty">Nenhum time cadastrado nessa categoria ainda.</p>';
  } else {
    area.innerHTML = groupKeys.map(g=>`
      <h2 style="font-size:13px;margin:14px 0 8px;color:var(--dim);">Grupo ${g}</h2>
      <table class="std">
        <tr><th>Time</th><th class="num">P</th><th class="num">V</th><th class="num">E</th><th class="num">D</th><th class="num">Saldo</th></tr>
        ${standings[g].map(r=>`<tr><td class="team">${escapeHtml(r.name)}</td><td class="num">${r.pts}</td><td class="num">${r.v}</td><td class="num">${r.e}</td><td class="num">${r.d}</td><td class="num">${r.pf-r.pc}</td></tr>`).join('')}
      </table>`).join('');
  }
  const bracket = MATCHES.filter(m=>m.categoria===cat && m.fase!=='grupo').sort((a,b)=>
    ['quartas','semi','final'].indexOf(a.fase)-['quartas','semi','final'].indexOf(b.fase));
  const bEl = document.getElementById('bracketArea');
  if(bracket.length===0){ bEl.innerHTML = '<p class="empty">Mata-mata ainda não definido.</p>'; return; }
  bEl.innerHTML = `<div class="rowlist">${bracket.map(m=>{
    const scoreTxt = (m.status!=='agendado') ? `${m.scoreA??0} – ${m.scoreB??0}` : (m.horario||'');
    return `<div class="match-row"><div class="mmid"><div class="mteams">${teamName(m.teamAId,m.teamAName)} x ${teamName(m.teamBId,m.teamBName)}</div><div class="mmeta">${faseLabel(m.fase)}</div></div><div class="mscore">${scoreTxt}</div></div>`;
  }).join('')}</div>`;
}

// ---------- PLACARES ----------
function renderPlacares(){
  buildPillRow(document.getElementById('placaresCatFilter'), CATS, 'placaresCat', 'Todas as categorias');
  let list = MATCHES.filter(m=>m.status!=='agendado');
  if(filters.placaresCat!=='all') list = list.filter(m=>m.categoria===filters.placaresCat);
  list.sort((a,b)=>(b.status==='ao_vivo')-(a.status==='ao_vivo') || (b.data||'').localeCompare(a.data||''));
  const el = document.getElementById('placaresList');
  if(list.length===0){ el.innerHTML = '<p class="empty">Nenhum resultado ainda.</p>'; return; }
  el.innerHTML = list.map(m=>{
    const dot = m.status==='ao_vivo' ? 'live' : 'done';
    const tag = m.status==='ao_vivo' ? '<span class="badge badge-live">AO VIVO</span>' : '<span class="badge badge-good">ENCERRADO</span>';
    return `<div class="match-row">
      <div class="mmid">
        <div class="mteams"><span class="status-dot ${dot}"></span>${teamName(m.teamAId,m.teamAName)} x ${teamName(m.teamBId,m.teamBName)}</div>
        <div class="mmeta">${m.categoria} · ${faseLabel(m.fase)} ${tag}</div>
      </div>
      <div class="mscore">${m.scoreA??0} – ${m.scoreB??0}</div>
    </div>`;
  }).join('');

  renderHomeLive();
}

// Placar ao vivo em destaque na home: quando há jogo rolando, esse espaço
// vira o telão (emblema, placar, bolinha vermelha piscando) e some com a
// contagem regressiva — que deixa de fazer sentido com o evento já rolando.
function renderHomeLive(){
  const liveOnes = MATCHES.filter(m=>m.status==='ao_vivo');
  const strip = document.getElementById('liveStrip');
  const countdown = document.getElementById('countdownRow');
  if(liveOnes.length===0){
    strip.style.display='none'; strip.innerHTML='';
    countdown.style.display='flex';
    return;
  }
  countdown.style.display='none';
  strip.style.display='flex';
  strip.innerHTML = liveOnes.map(m=>{
    const tA = TEAMS.find(t=>t.id===m.teamAId), tB = TEAMS.find(t=>t.id===m.teamBId);
    return `<div class="live-chip">
      <div class="lc-top"><span class="now-live-dot"></span><span class="lc-field">${m.campo ? campoLabelHtml(m.campo) : 'Ao vivo'}</span></div>
      <div class="lc-vs">
        <div class="lc-team"><div class="lc-crest">${crestHtml(tA)}</div><span>${teamName(m.teamAId,m.teamAName)}</span></div>
        <div class="lc-score">${m.scoreA??0}<span>–</span>${m.scoreB??0}</div>
        <div class="lc-team"><div class="lc-crest">${crestHtml(tB)}</div><span>${teamName(m.teamBId,m.teamBName)}</span></div>
      </div>
    </div>`;
  }).join('');
}

// ---------- CAMPOS (visão por campo, estilo telão) ----------
function renderCampos(){
  buildPillRow(document.getElementById('camposFieldFilter'), FIELDS, 'camposField', null);
  document.querySelectorAll('#camposFieldFilter .pill').forEach(chip=>{ chip.innerHTML = campoLabelHtml(chip.textContent); });
  buildPillRow(document.getElementById('camposDayFilter'), ['2026-12-12','2026-12-13'], 'camposDay', 'Todos os dias');
  document.querySelectorAll('#camposDayFilter .pill').forEach((chip,i)=>{
    if(i>0) chip.textContent = i===1 ? 'Sáb 12/12' : 'Dom 13/12';
  });

  let list = MATCHES.filter(m=>normalizeCampo(m.campo)===filters.camposField);
  if(filters.camposDay!=='all') list = list.filter(m=>m.data===filters.camposDay);
  list.sort((a,b)=>(a.data||'').localeCompare(b.data||'')||(a.horario||'').localeCompare(b.horario||''));

  const board = document.getElementById('camposBoard');
  if(list.length===0){ board.innerHTML = '<p class="empty">Nenhum jogo cadastrado nesse campo ainda.</p>'; return; }

  const delays = computeFieldDelays();
  let lastDay = null;
  const parts = [];
  list.forEach(m=>{
    if(m.data !== lastDay){
      lastDay = m.data;
      parts.push(`<div class="field-day-label">${m.data==='2026-12-13'?'Domingo 13/12':'Sábado 12/12'}</div>`);
    }
    const tA = TEAMS.find(t=>t.id===m.teamAId), tB = TEAMS.find(t=>t.id===m.teamBId);
    const isFuture = m.status==='agendado';
    const scoreHtml = isFuture
      ? `<div class="fmc-score is-future">0<span>x</span>0</div>`
      : `<div class="fmc-score">${m.scoreA??0}<span>–</span>${m.scoreB??0}</div>`;
    const statusTxt = m.status==='ao_vivo' ? 'AO VIVO' : (m.status==='encerrado' ? 'Encerrado' : 'Agendado');
    const dot = m.status==='ao_vivo' ? 'live' : (m.status==='encerrado' ? 'done' : 'sched');
    const d = delays[m.id];
    let timeLine = m.horario||'--:--';
    let delayLine = '';
    if(m.status==='ao_vivo' && m.startedAt){
      timeLine = `Começou às ${fmtHM(m.startedAt)}`;
      if(d && d.delayMin>0) delayLine = `<div class="fmc-delay">atraso de ~${d.delayMin}min em relação ao previsto</div>`;
    } else if(isFuture && d && d.delayMin>0 && d.estimatedTs){
      timeLine = `${m.horario||'--:--'} <span class="fmc-strike">prev.</span> ${fmtHM(d.estimatedTs)}`;
      delayLine = `<div class="fmc-delay">atraso de ~${d.delayMin}min no campo${d.manual?' (ajustado pela organização)':''}</div>`;
    }
    parts.push(`
      <div class="field-match-card${m.status==='ao_vivo'?' is-live':''}">
        <div class="fmc-top"><span class="fmc-time">${timeLine}</span><span class="badge ${m.status==='ao_vivo'?'badge-live':(m.status==='encerrado'?'badge-good':'badge-warn')}">${statusTxt}</span></div>
        <div class="fmc-vs">
          <div class="fmc-team"><div class="fmc-crest">${crestHtml(tA)}</div><div class="fmc-tname">${teamName(m.teamAId,m.teamAName)}</div></div>
          ${scoreHtml}
          <div class="fmc-team"><div class="fmc-crest">${crestHtml(tB)}</div><div class="fmc-tname">${teamName(m.teamBId,m.teamBName)}</div></div>
        </div>
        <div class="fmc-meta"><span class="status-dot ${dot}"></span>${m.categoria} · ${faseLabel(m.fase)}</div>
        ${delayLine}
      </div>`);
  });
  board.innerHTML = parts.join('');
}

// ---------- ARTILHARIA ----------
function renderArtilharia(){
  buildPillRow(document.getElementById('artCatFilter'), CATS, 'artCat', 'Todas as categorias');
  let list = SCORERS.slice();
  if(filters.artCat!=='all'){
    const teamIds = TEAMS.filter(t=>t.categoria===filters.artCat).map(t=>t.id);
    list = list.filter(s=>teamIds.includes(s.teamId));
  }
  list.sort((a,b)=>(b.points||0)-(a.points||0));
  const el = document.getElementById('artList');
  if(list.length===0){ el.innerHTML = '<p class="empty">Nenhum ponto registrado ainda.</p>'; return; }
  el.innerHTML = list.map((s,i)=>{
    const rankClass = i===0?'r1':i===1?'r2':i===2?'r3':'rn';
    return `<div class="match-row"><div class="mmid"><div class="mteams"><span class="rank-badge ${rankClass}">${i+1}</span>${escapeHtml(s.name)}</div><div class="mmeta">${teamName(s.teamId)}</div></div><div class="mscore">${s.points||0}</div></div>`;
  }).join('');
}

// ---------- MURAL ----------
function renderMural(){
  buildPillRow(document.getElementById('muralCatFilter'), CATS, 'muralCat', 'Todas as categorias');
  let list = TEAMS.slice();
  if(filters.muralCat!=='all') list = list.filter(t=>t.categoria===filters.muralCat);
  list.sort((a,b)=>a.name.localeCompare(b.name));
  const el = document.getElementById('muralGrid');
  if(list.length===0){ el.innerHTML = '<p class="empty">Nenhum time cadastrado ainda.</p>'; return; }
  el.innerHTML = list.map(t=>`
    <div class="mural-card">
      <div class="mural-crest">${crestHtml(t)}</div>
      <div class="mural-name">${escapeHtml(t.name)}</div>
      <div class="mural-cat">${t.categoria}</div>
      <button class="mural-upload" data-upload-crest="${t.id}">${t.logoUrl ? 'trocar escudo' : 'enviar escudo'}</button>
    </div>`).join('');
  el.querySelectorAll('[data-upload-crest]').forEach(b=>{
    b.onclick = ()=> openCrestSheet(b.dataset.uploadCrest);
  });
}

// ---------- crest upload (sem Firebase Storage: comprime e guarda no Firestore) ----------
const crestSheet = document.getElementById('crestSheet');
function openCrestSheet(teamId){
  crestTargetTeamId = teamId;
  document.getElementById('crestTeamLabel').textContent = 'Time: ' + teamName(teamId);
  document.getElementById('crestMsg').textContent = '';
  document.getElementById('crestFile').value = '';
  crestSheet.classList.add('open');
}
document.getElementById('crestClose').onclick = ()=> crestSheet.classList.remove('open');

// Redimensiona pra um quadrado pequeno e comprime em JPEG — fica bem
// abaixo do limite de 1MB por documento do Firestore (geralmente poucos KB).
function compressImageToDataUrl(file, maxSize=160, quality=0.8){
  return new Promise((resolve, reject)=>{
    const img = new Image();
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = ()=>{
      img.onerror = reject;
      img.onload = ()=>{
        const side = Math.min(img.width, img.height);
        const sx = (img.width-side)/2, sy = (img.height-side)/2;
        const canvas = document.createElement('canvas');
        canvas.width = maxSize; canvas.height = maxSize;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, sx, sy, side, side, 0, 0, maxSize, maxSize);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}
document.getElementById('crestSubmit').onclick = async ()=>{
  const file = document.getElementById('crestFile').files[0];
  const msg = document.getElementById('crestMsg');
  if(!file || !crestTargetTeamId){ msg.textContent = 'Escolha uma imagem primeiro.'; return; }
  if(!file.type.startsWith('image/')){ msg.textContent = 'Escolha um arquivo de imagem.'; return; }
  if(file.size > 8*1024*1024){ msg.textContent = 'Imagem muito grande (máx. 8MB).'; return; }
  msg.textContent = 'Processando...';
  try{
    const dataUrl = await compressImageToDataUrl(file);
    await updateDoc(doc(db,'teams',crestTargetTeamId), { logoUrl: dataUrl });
    msg.textContent = 'Escudo enviado!';
    setTimeout(()=> crestSheet.classList.remove('open'), 900);
  }catch(e){
    msg.textContent = 'Erro ao processar a imagem. Tenta outra foto.';
    console.error(e);
  }
};

// ---------- AVISOS ----------
function renderAvisos(){
  const sorted = ANNOUNCEMENTS.slice().sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));
  const el = document.getElementById('annList');
  if(sorted.length===0){ el.innerHTML = '<p class="empty">Nenhum aviso publicado ainda.</p>'; }
  else { el.innerHTML = sorted.map(a=>`<div class="ann-item"><div class="ann-time">${fmtTime(a.createdAt)}</div><div class="ann-text">${escapeHtml(a.text)}</div></div>`).join(''); }
  const preview = document.getElementById('homeAnnPreview');
  if(sorted.length===0){ preview.innerHTML = '<p class="empty">Nenhum aviso por enquanto.</p>'; }
  else { preview.innerHTML = sorted.slice(0,2).map(a=>`<div class="ann-item"><div class="ann-time">${fmtTime(a.createdAt)}</div><div class="ann-text">${escapeHtml(a.text)}</div></div>`).join(''); }
}

// ---------- SÚMULA ----------
function fillSumTeamSelect(){
  const sel = document.getElementById('fSumTeam');
  if(!sel) return;
  const cur = sel.value;
  sel.innerHTML = TEAMS.slice().sort((a,b)=>a.name.localeCompare(b.name)).map(t=>`<option value="${t.id}">${t.name} (${t.categoria})</option>`).join('');
  if(cur) sel.value = cur;
}
function renderMySumulas(){
  const el = document.getElementById('mySumulasList');
  let myKeys;
  try{ myKeys = JSON.parse(localStorage.getItem('spacMySumulas')||'[]'); }catch(e){ myKeys = []; }
  const mine = SUMULAS.filter(s=>myKeys.includes(s.id));
  if(mine.length===0){ el.innerHTML = '<p class="empty">Depois de enviar, suas súmulas aparecem aqui.</p>'; return; }
  mine.sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));
  el.innerHTML = mine.map(s=>{
    const badge = s.status==='aprovada' ? '<span class="badge badge-good">APROVADA</span>' : '<span class="badge badge-warn">PENDENTE</span>';
    return `<div class="match-row"><div class="mmid"><div class="mteams">${teamName(s.teamId)}</div><div class="mmeta">${s.data==='2026-12-13'?'Dom 13/12':'Sáb 12/12'} · ${fmtTime(s.createdAt)}</div></div><div>${badge}</div></div>`;
  }).join('');
}
document.getElementById('btnSendSumula').onclick = async ()=>{
  const teamId = document.getElementById('fSumTeam').value;
  const data = document.getElementById('fSumData').value;
  const responsavel = document.getElementById('fSumResp').value.trim();
  const telefone = document.getElementById('fSumTel').value.trim();
  const atletas = document.getElementById('fSumAtletas').value.split('\n').map(s=>s.trim()).filter(Boolean);
  const msg = document.getElementById('sumulaMsg');
  if(!teamId || !responsavel || atletas.length===0){ msg.textContent = 'Preencha time, responsável e ao menos um atleta.'; return; }
  try{
    const docRef = await addDoc(collection(db,'sumulas'), {
      teamId, data, responsavel, telefone, atletas, status:'pendente', createdAt: Date.now()
    });
    try{
      const keys = JSON.parse(localStorage.getItem('spacMySumulas')||'[]');
      keys.push(docRef.id);
      localStorage.setItem('spacMySumulas', JSON.stringify(keys));
    }catch(e){}
    msg.textContent = 'Súmula enviada! A organização já recebeu.';
    document.getElementById('fSumResp').value = '';
    document.getElementById('fSumTel').value = '';
    document.getElementById('fSumAtletas').value = '';
  }catch(e){
    msg.textContent = 'Erro ao enviar. Tenta de novo em alguns segundos.';
    console.error(e);
  }
};

// ---------- master render ----------
function renderAll(){
  renderCronograma();
  renderGrupos();
  renderPlacares();
  renderCampos();
  renderArtilharia();
  renderMural();
  renderAvisos();
  fillSumTeamSelect();
  renderMySumulas();
}

// ---------- boot ----------
onSnapshot(collection(db,'teams'), snap=>{ TEAMS = snap.docs.map(d=>({id:d.id, ...d.data()})); renderAll(); });
onSnapshot(collection(db,'matches'), snap=>{ MATCHES = snap.docs.map(d=>({id:d.id, ...d.data()})); renderAll(); });
onSnapshot(collection(db,'announcements'), snap=>{ ANNOUNCEMENTS = snap.docs.map(d=>({id:d.id, ...d.data()})); renderAll(); });
onSnapshot(collection(db,'scorers'), snap=>{ SCORERS = snap.docs.map(d=>({id:d.id, ...d.data()})); renderAll(); });
onSnapshot(collection(db,'sumulas'), snap=>{ SUMULAS = snap.docs.map(d=>({id:d.id, ...d.data()})); renderAll(); });
