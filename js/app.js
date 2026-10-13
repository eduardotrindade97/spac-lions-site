import {
  collection, doc, addDoc, updateDoc, onSnapshot
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db, CATS, EVENT_DATE } from "./firebase-init.js";

// ---------- state ----------
let TEAMS = [], MATCHES = [], ANNOUNCEMENTS = [], SCORERS = [], SUMULAS = [];
let filters = { cronoDay:'all', cronoCat:'all', gruposCat:CATS[0], placaresCat:'all', muralCat:'all', artCat:'all' };
let crestTargetTeamId = null;

function teamName(id, fallback){
  const t = TEAMS.find(t=>t.id===id);
  return t ? t.name : (fallback || 'A definir');
}
function escapeHtml(s){
  return (s||'').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function fmtTime(ts){
  if(!ts) return '';
  const d = new Date(ts);
  return d.toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' });
}

// ---------- navigation ----------
const MORE_TABS = ['regulamento','artilharia','times','sumula','avisos'];
function goToTab(tab){
  document.querySelectorAll('.screen').forEach(s=> s.classList.toggle('active', s.id==='screen-'+tab));
  document.querySelectorAll('.bn-btn[data-tab]').forEach(b=> b.classList.toggle('active', b.dataset.tab===tab));
  const moreBtn = document.getElementById('moreNavBtn');
  if(moreBtn) moreBtn.classList.toggle('active', MORE_TABS.includes(tab) && !['cronograma','grupos','placares','inicio'].includes(tab));
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

// ---------- countdown ----------
function renderCountdown(){
  const now = new Date();
  const diff = EVENT_DATE - now;
  const row = document.getElementById('countdownRow');
  if(diff <= 0){
    row.innerHTML = '<div class="now-pill"><b>🦁</b><span>É hoje!</span></div>';
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
  el.innerHTML = list.map(m=>{
    const dot = m.status==='ao_vivo' ? 'live' : (m.status==='encerrado' ? 'done' : 'sched');
    const scoreTxt = (m.status!=='agendado') ? `${m.scoreA??0} – ${m.scoreB??0}` : '';
    return `<div class="match-row">
      <div class="mtime">${m.horario||'--:--'}<span class="d">${m.data==='2026-12-13'?'Dom':'Sáb'}</span></div>
      <div class="mmid">
        <div class="mteams"><span class="status-dot ${dot}"></span>${teamName(m.teamAId,m.teamAName)} x ${teamName(m.teamBId,m.teamBName)}</div>
        <div class="mmeta">${m.categoria} · ${faseLabel(m.fase)}${m.campo?(' · '+m.campo):''}</div>
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

  // live strip on home
  const liveOnes = MATCHES.filter(m=>m.status==='ao_vivo');
  const strip = document.getElementById('liveStrip');
  if(liveOnes.length===0){ strip.style.display='none'; }
  else {
    strip.style.display='flex';
    const m = liveOnes[0];
    strip.innerHTML = `<span class="now-live-dot"></span> AO VIVO: ${teamName(m.teamAId,m.teamAName)} ${m.scoreA??0} – ${m.scoreB??0} ${teamName(m.teamBId,m.teamBName)}${liveOnes.length>1?` (+${liveOnes.length-1} jogo${liveOnes.length>2?'s':''})`:''}`;
  }
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
  const medals = ['🥇','🥈','🥉'];
  el.innerHTML = list.map((s,i)=>`<div class="match-row"><div class="mmid"><div class="mteams">${medals[i]||(i+1)+'.'} ${escapeHtml(s.name)}</div><div class="mmeta">${teamName(s.teamId)}</div></div><div class="mscore">${s.points||0}</div></div>`).join('');
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
      <div class="mural-crest">${t.logoUrl ? `<img src="${t.logoUrl}">` : t.name.slice(0,2).toUpperCase()}</div>
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
