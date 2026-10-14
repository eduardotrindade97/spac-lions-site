import {
  collection, doc, addDoc, updateDoc, deleteDoc, onSnapshot
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  signInWithEmailAndPassword, onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { db, auth, CATS, SLOT_MIN } from "./firebase-init.js";

// ---------- login ----------
const loginBox = document.getElementById('loginBox');
const adminShell = document.getElementById('adminShell');
document.getElementById('loginSubmit').onclick = async ()=>{
  const email = document.getElementById('loginEmail').value.trim();
  const pass = document.getElementById('loginPass').value;
  const msg = document.getElementById('loginMsg');
  msg.textContent = 'Entrando...';
  try{
    await signInWithEmailAndPassword(auth, email, pass);
  }catch(e){
    msg.textContent = 'E-mail ou senha incorretos, ou essa conta ainda não foi cadastrada no Firebase.';
  }
};
document.getElementById('logoutBtn').onclick = ()=> signOut(auth);

onAuthStateChanged(auth, user=>{
  if(user){
    loginBox.style.display = 'none';
    adminShell.style.display = 'block';
    document.getElementById('whoAmI').textContent = user.email;
    bootData();
  } else {
    loginBox.style.display = 'block';
    adminShell.style.display = 'none';
  }
});

// ---------- admin tab switching ----------
document.querySelectorAll('.admin-tab').forEach(btn=>{
  btn.onclick = ()=>{
    document.querySelectorAll('.admin-tab').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.admin-panel').forEach(p=> p.classList.toggle('active', p.id==='atab-'+btn.dataset.atab));
  };
});

// ---------- state ----------
let TEAMS=[], MATCHES=[], ANNOUNCEMENTS=[], SCORERS=[], SUMULAS=[], MATCH_EVENTS=[];
let adminSumStatus = 'pendente';
let selectedPlacarMatchId = null;
let booted = false;

function teamName(id, fallback){
  const t = TEAMS.find(t=>t.id===id);
  return t ? t.name : (fallback || 'A definir');
}
function escapeHtml(s){
  return (s||'').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function fmtTime(ts){
  if(!ts) return '';
  return new Date(ts).toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' });
}
function fmtHM(ts){
  if(!ts) return '--:--';
  return new Date(ts).toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit' });
}
function faseLabel(f){
  return {grupo:'Fase de grupos', quartas:'Quartas de final', semi:'Semifinal', final:'Final'}[f] || f;
}
function matchTimestamp(dataStr, horarioStr){
  if(!dataStr || !horarioStr) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(horarioStr).trim());
  if(!m) return null;
  const d = new Date(dataStr+'T00:00:00-03:00');
  d.setHours(parseInt(m[1],10), parseInt(m[2],10), 0, 0);
  return d.getTime();
}
function matchLabel(m){
  const tag = m.status==='ao_vivo' ? ' · AO VIVO' : (m.status==='encerrado' ? ' · encerrado' : '');
  return `${teamName(m.teamAId,m.teamAName)} x ${teamName(m.teamBId,m.teamBName)} — ${m.categoria} · ${m.data==='2026-12-13'?'Dom':'Sáb'} ${m.horario||''}${m.campo?(' · '+m.campo):''}${tag}`;
}

function bootData(){
  if(booted) return;
  booted = true;
  onSnapshot(collection(db,'teams'), snap=>{ TEAMS = snap.docs.map(d=>({id:d.id, ...d.data()})); renderAdminLists(); });
  onSnapshot(collection(db,'matches'), snap=>{ MATCHES = snap.docs.map(d=>({id:d.id, ...d.data()})); renderAdminLists(); });
  onSnapshot(collection(db,'announcements'), snap=>{ ANNOUNCEMENTS = snap.docs.map(d=>({id:d.id, ...d.data()})); renderAdminLists(); });
  onSnapshot(collection(db,'scorers'), snap=>{ SCORERS = snap.docs.map(d=>({id:d.id, ...d.data()})); renderAdminLists(); });
  onSnapshot(collection(db,'sumulas'), snap=>{ SUMULAS = snap.docs.map(d=>({id:d.id, ...d.data()})); renderAdminLists(); });
  onSnapshot(collection(db,'matchEvents'), snap=>{ MATCH_EVENTS = snap.docs.map(d=>({id:d.id, ...d.data()})); renderAdminLists(); });
}

// ---------- TIMES ----------
document.getElementById('btnAddTeam').onclick = async ()=>{
  const name = document.getElementById('fTeamName').value.trim();
  if(!name) return;
  await addDoc(collection(db,'teams'), {
    name, categoria: document.getElementById('fTeamCat').value,
    grupo: document.getElementById('fTeamGrupo').value.trim() || null,
    confirmado: true, logoUrl: null
  });
  document.getElementById('fTeamName').value = '';
  document.getElementById('fTeamGrupo').value = '';
};

// ---------- JOGOS ----------
function fillTeamSelects(){
  const a = document.getElementById('fMatchTeamA'), b = document.getElementById('fMatchTeamB');
  const cat = document.getElementById('fMatchCat').value;
  const opts = TEAMS.filter(t=>t.categoria===cat).map(t=>`<option value="${t.id}">${t.name}</option>`).join('');
  a.innerHTML = opts; b.innerHTML = opts;
}
document.getElementById('fMatchCat').addEventListener('change', fillTeamSelects);

// Sugere o próximo horário livre no campo escolhido: pega o último jogo
// cadastrado nesse campo/dia e soma 17min (14min de jogo + 1:30 intervalo +
// 1:30 entrada em campo/kickoff). Só preenche se o campo horário estiver vazio.
function suggestHorario(){
  const campo = document.getElementById('fMatchCampo').value;
  const data = document.getElementById('fMatchData').value;
  const horarioInput = document.getElementById('fMatchHorario');
  if(horarioInput.value.trim()) return;
  const sameSlot = MATCHES.filter(m=>m.campo===campo && m.data===data && m.horario)
    .sort((a,b)=>String(a.horario).localeCompare(String(b.horario)));
  if(sameSlot.length===0) return;
  const last = sameSlot[sameSlot.length-1];
  const ts = matchTimestamp(last.data, last.horario);
  if(ts==null) return;
  horarioInput.value = fmtHM(ts + SLOT_MIN*60000);
}
document.getElementById('fMatchCampo').addEventListener('change', suggestHorario);
document.getElementById('fMatchData').addEventListener('change', suggestHorario);

document.getElementById('btnAddMatch').onclick = async ()=>{
  const teamAId = document.getElementById('fMatchTeamA').value;
  const teamBId = document.getElementById('fMatchTeamB').value;
  if(!teamAId || !teamBId || teamAId===teamBId) return;
  await addDoc(collection(db,'matches'), {
    categoria: document.getElementById('fMatchCat').value,
    fase: document.getElementById('fMatchFase').value,
    teamAId, teamBId,
    data: document.getElementById('fMatchData').value,
    horario: document.getElementById('fMatchHorario').value.trim(),
    campo: document.getElementById('fMatchCampo').value,
    status: 'agendado', scoreA: null, scoreB: null
  });
  // Mantém campo/data selecionados (facilita cadastrar vários jogos seguidos
  // no mesmo campo) e limpa o horário pra já sugerir o próximo slot de 17min.
  document.getElementById('fMatchHorario').value = '';
};

// Gera os confrontos de pontos corridos (todos x todos) dentro de cada grupo
// da categoria selecionada, a partir do campo "grupo" cadastrado em Times.
// Nunca duplica um confronto que já existe (mesma categoria/fase/dupla de
// times) — pode rodar de novo depois de ajustar os grupos que só cria o que
// falta. Horário e campo saem em branco: dá pra editar tudo livremente na
// lista de jogos logo abaixo.
document.getElementById('btnGenGroupMatches').onclick = async ()=>{
  const cat = document.getElementById('fMatchCat').value;
  const teams = TEAMS.filter(t=>t.categoria===cat);
  if(teams.length<2){ alert('Cadastre pelo menos 2 times dessa categoria em "Times" primeiro.'); return; }
  const byGroup = {};
  teams.forEach(t=>{ const g = t.grupo || 'Único'; (byGroup[g] = byGroup[g] || []).push(t); });
  const existingPairs = new Set(
    MATCHES.filter(m=>m.categoria===cat && m.fase==='grupo')
      .map(m=> [m.teamAId,m.teamBId].sort().join('|'))
  );
  const toCreate = [];
  Object.values(byGroup).forEach(list=>{
    for(let i=0;i<list.length;i++) for(let j=i+1;j<list.length;j++){
      const key = [list[i].id,list[j].id].sort().join('|');
      if(!existingPairs.has(key)) toCreate.push({teamAId:list[i].id, teamBId:list[j].id});
    }
  });
  if(toCreate.length===0){ alert('Nenhum confronto novo pra gerar: ou já existem todos os jogos da fase de grupos dessa categoria, ou falta time cadastrado.'); return; }
  if(!confirm(`Gerar ${toCreate.length} jogo(s) de fase de grupos pra ${cat}, um confronto por dupla dentro de cada grupo (times sem grupo definido jogam entre si)? Horário e campo ficam em branco pra você organizar.`)) return;
  for(const pair of toCreate){
    await addDoc(collection(db,'matches'), {
      categoria: cat, fase:'grupo', teamAId:pair.teamAId, teamBId:pair.teamBId,
      data:'2026-12-12', horario:'', campo:'', status:'agendado', scoreA:null, scoreB:null
    });
  }
};

// ---------- ARTILHEIROS ----------
function fillScorerTeamSelect(){
  const sel = document.getElementById('fScorerTeam');
  sel.innerHTML = TEAMS.slice().sort((a,b)=>a.name.localeCompare(b.name)).map(t=>`<option value="${t.id}">${t.name} (${t.categoria})</option>`).join('');
}
document.getElementById('btnAddScorer').onclick = async ()=>{
  const name = document.getElementById('fScorerName').value.trim();
  const teamId = document.getElementById('fScorerTeam').value;
  if(!name || !teamId) return;
  await addDoc(collection(db,'scorers'), { name, teamId, points: 0 });
  document.getElementById('fScorerName').value = '';
};

// ---------- AVISOS ----------
document.getElementById('btnAddAnn').onclick = async ()=>{
  const text = document.getElementById('fAnnText').value.trim();
  if(!text) return;
  await addDoc(collection(db,'announcements'), { text, createdAt: Date.now() });
  document.getElementById('fAnnText').value = '';
};

// ---------- PLACAR AO VIVO ----------
const SCORE_TYPES = [
  { id:'try', label:'Try', pontos:5 },
  { id:'conversao', label:'Conversão', pontos:2 },
  { id:'penal_try', label:'Penal Try', pontos:5 },
  { id:'drop', label:'Drop Kick', pontos:3 }
];
function scoreTypeInfo(tipo){
  return SCORE_TYPES.find(t=>t.id===tipo) || { id:tipo, label:tipo==='penal' ? 'Penal' : tipo, pontos:0 };
}
// aceita "Nome Completo — 12", "Nome Completo - 12", "Nome Completo #12" etc.
function parseAtleta(raw){
  const s = (raw||'').trim();
  const m = s.match(/^(.*?)\s*(?:[—–-]|#)\s*(\d{1,3})\s*$/);
  if(m) return { name: m[1].trim(), number: m[2] };
  return { name: s, number: '' };
}
let pendingScoreType = { A:null, B:null };
function getApprovedRoster(teamId, matchData){
  const subs = SUMULAS.filter(s=> s.teamId===teamId && s.status==='aprovada');
  if(subs.length===0) return null;
  let pick = subs.find(s=>s.data===matchData);
  if(!pick) pick = subs.slice().sort((a,b)=>(b.createdAt||0)-(a.createdAt||0))[0];
  return pick.atletas || [];
}
async function findOrCreateScorerId(name, teamId){
  const existing = SCORERS.find(x=>x.teamId===teamId && x.name===name);
  if(existing) return existing.id;
  const ref = await addDoc(collection(db,'scorers'), { name, teamId, points: 0 });
  return ref.id;
}
async function scorePoint(matchId, teamSide, playerName, tipo, pontos){
  const m = MATCHES.find(x=>x.id===matchId);
  if(!m) return;
  const teamId = teamSide==='A' ? m.teamAId : m.teamBId;
  const scorerId = await findOrCreateScorerId(playerName, teamId);
  const scorer = SCORERS.find(x=>x.id===scorerId);
  await updateDoc(doc(db,'scorers',scorerId), { points: (scorer?.points||0) + pontos });
  const scoreField = teamSide==='A' ? 'scoreA' : 'scoreB';
  const newScore = (m[scoreField]||0) + pontos;
  const patch = { [scoreField]: newScore };
  if(m.status==='agendado'){ patch.status = 'ao_vivo'; if(!m.startedAt) patch.startedAt = Date.now(); }
  await updateDoc(doc(db,'matches',matchId), patch);
  await addDoc(collection(db,'matchEvents'), {
    matchId, teamSide, teamId, playerName, tipo, pontos, scorerId, createdAt: Date.now()
  });
}
async function undoPlacarEvent(eventId){
  const ev = MATCH_EVENTS.find(x=>x.id===eventId);
  if(!ev) return;
  const scorer = SCORERS.find(x=>x.id===ev.scorerId);
  if(scorer) await updateDoc(doc(db,'scorers',ev.scorerId), { points: Math.max(0,(scorer.points||0) - ev.pontos) });
  const m = MATCHES.find(x=>x.id===ev.matchId);
  if(m){
    const scoreField = ev.teamSide==='A' ? 'scoreA' : 'scoreB';
    await updateDoc(doc(db,'matches',ev.matchId), { [scoreField]: Math.max(0,(m[scoreField]||0) - ev.pontos) });
  }
  await deleteDoc(doc(db,'matchEvents',eventId));
}
function fillPlacarMatchSelect(){
  const sel = document.getElementById('fPlacarMatch');
  const sorted = MATCHES.slice().sort((a,b)=>(a.data||'').localeCompare(b.data||'')||(a.horario||'').localeCompare(b.horario||''));
  if(sorted.length===0){ sel.innerHTML = '<option value="">Nenhum jogo cadastrado</option>'; selectedPlacarMatchId = null; return; }
  if(!selectedPlacarMatchId || !sorted.find(m=>m.id===selectedPlacarMatchId)) selectedPlacarMatchId = sorted[0].id;
  sel.innerHTML = sorted.map(m=>`<option value="${m.id}" ${m.id===selectedPlacarMatchId?'selected':''}>${matchLabel(m)}</option>`).join('');
}
document.getElementById('fPlacarMatch').addEventListener('change', e=>{
  selectedPlacarMatchId = e.target.value;
  pendingScoreType = { A:null, B:null };
  renderAdminPlacar();
});
function renderAdminPlacar(){
  fillPlacarMatchSelect();
  const m = MATCHES.find(x=>x.id===selectedPlacarMatchId);
  const scoreboard = document.getElementById('placarScoreboard');
  const rosterA = document.getElementById('placarRosterA');
  const rosterB = document.getElementById('placarRosterB');
  const headA = document.getElementById('placarColHeadA');
  const headB = document.getElementById('placarColHeadB');
  const eventsEl = document.getElementById('placarEvents');
  if(!m){
    scoreboard.innerHTML = ''; rosterA.innerHTML=''; rosterB.innerHTML='';
    headA.textContent='Time A'; headB.textContent='Time B';
    eventsEl.innerHTML = '<p class="no-roster">Cadastre um jogo na aba Jogos primeiro.</p>';
    return;
  }
  const nameA = teamName(m.teamAId,m.teamAName), nameB = teamName(m.teamBId,m.teamBName);
  headA.textContent = nameA; headB.textContent = nameB;
  let startHtml = '';
  if(m.status==='agendado'){
    startHtml = `<div class="start-box">
      <div class="start-info">Previsto para ${m.horario||'--:--'}${m.campo?(' · '+m.campo):''}. Dê START quando o jogo realmente começar — assim o atraso é calculado pros próximos jogos do campo.</div>
      <button class="btn" id="btnStartMatch">Iniciar jogo (START)</button>
    </div>`;
  } else if(m.status==='ao_vivo' && m.startedAt){
    const schedTs = matchTimestamp(m.data, m.horario);
    const delayMin = schedTs!=null ? Math.round((m.startedAt-schedTs)/60000) : null;
    startHtml = `<div class="start-box start-box-live">Começou às <b>${fmtHM(m.startedAt)}</b>${(delayMin!==null && delayMin>0) ? ` · atraso de ~${delayMin}min` : ''}</div>`;
  }
  scoreboard.innerHTML = `${startHtml}<div class="scoreboard">
    <div class="side"><b>${escapeHtml(nameA)}</b><div class="sc">${m.scoreA??0}</div></div>
    <div class="vs">x</div>
    <div class="side"><b>${escapeHtml(nameB)}</b><div class="sc">${m.scoreB??0}</div></div></div>`;
  const startBtn = document.getElementById('btnStartMatch');
  if(startBtn) startBtn.onclick = ()=> updateDoc(doc(db,'matches',m.id), { status:'ao_vivo', startedAt: Date.now() });
  function rosterHtml(teamId, teamSide){
    const roster = getApprovedRoster(teamId, m.data);
    if(roster===null){
      const pending = SUMULAS.filter(s=>s.teamId===teamId && (s.status||'pendente')==='pendente')
        .sort((a,b)=>(b.createdAt||0)-(a.createdAt||0))[0];
      if(pending){
        return `<p class="no-roster">Súmula enviada, mas ainda não aprovada (${(pending.atletas||[]).length} atletas).</p>
        <button class="btn-ghost" data-approve-roster="${pending.id}">Aprovar súmula agora</button>`;
      }
      return '<p class="no-roster">Nenhuma súmula enviada ainda pra esse time. Peça pro time enviar pelo site, ou lance manualmente em Artilheiros.</p>';
    }
    if(roster.length===0) return '<p class="no-roster">Súmula aprovada sem atletas listados.</p>';
    const activeType = pendingScoreType[teamSide];
    if(!activeType){
      // passo 1: escolher o tipo de pontuação
      return `<div class="score-types">
        ${SCORE_TYPES.map(t=>`<button class="score-type-btn" data-pick-type="${teamSide}|${t.id}">${escapeHtml(t.label)}<span>+${t.pontos}</span></button>`).join('')}
      </div>`;
    }
    const info = scoreTypeInfo(activeType);
    // passo 2: escolher o jogador que pontuou
    return `<div class="score-players">
      <div class="score-players-head">
        <span>${escapeHtml(info.label)} · +${info.pontos}</span>
        <button class="btn-ghost" data-back-type="${teamSide}">voltar</button>
      </div>
      ${roster.map(atleta=>{
        const { name, number } = parseAtleta(atleta);
        return `<button class="player-row player-row-btn" data-score="${teamSide}|${encodeURIComponent(atleta)}|${info.id}|${info.pontos}">
          ${number ? `<span class="pnum">${escapeHtml(number)}</span>` : ''}
          <span class="pname">${escapeHtml(name)}</span>
        </button>`;
      }).join('')}
    </div>`;
  }
  rosterA.innerHTML = rosterHtml(m.teamAId,'A');
  rosterB.innerHTML = rosterHtml(m.teamBId,'B');
  [rosterA, rosterB].forEach(el=>{
    el.querySelectorAll('[data-approve-roster]').forEach(b=>{
      b.onclick = ()=> updateDoc(doc(db,'sumulas',b.dataset.approveRoster), {status:'aprovada'});
    });
    el.querySelectorAll('[data-pick-type]').forEach(b=>{
      b.onclick = ()=>{
        const [side, tipo] = b.dataset.pickType.split('|');
        pendingScoreType[side] = tipo;
        renderAdminPlacar();
      };
    });
    el.querySelectorAll('[data-back-type]').forEach(b=>{
      b.onclick = ()=>{
        pendingScoreType[b.dataset.backType] = null;
        renderAdminPlacar();
      };
    });
    el.querySelectorAll('[data-score]').forEach(b=>{
      b.onclick = async ()=>{
        const [side, encName, tipo, pts] = b.dataset.score.split('|');
        const { name } = parseAtleta(decodeURIComponent(encName));
        pendingScoreType[side] = null;
        await scorePoint(m.id, side, name, tipo, parseInt(pts));
        renderAdminPlacar();
      };
    });
  });
  const evs = MATCH_EVENTS.filter(e=>e.matchId===m.id).sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));
  if(evs.length===0){ eventsEl.innerHTML = '<p class="no-roster">Nenhum lançamento ainda.</p>'; }
  else {
    eventsEl.innerHTML = evs.map(e=>{
      const side = e.teamSide==='A' ? nameA : nameB;
      const tipoLabel = scoreTypeInfo(e.tipo).label;
      return `<div class="event-item"><span>+${e.pontos} · ${escapeHtml(e.playerName)} (${escapeHtml(side)}) — ${tipoLabel}</span><button class="icon-btn danger" data-undo="${e.id}">desfazer</button></div>`;
    }).join('');
    eventsEl.querySelectorAll('[data-undo]').forEach(b=> b.onclick = ()=> undoPlacarEvent(b.dataset.undo));
  }
}

// ---------- SÚMULAS ----------
function renderAdminSumulas(){
  const pendingCount = SUMULAS.filter(s=>(s.status||'pendente')==='pendente').length;
  const badge = document.getElementById('sumPendingBadge');
  if(badge){ badge.style.display = pendingCount>0 ? 'inline-flex' : 'none'; badge.textContent = pendingCount; }
  const filterEl = document.getElementById('adminSumFilter');
  filterEl.innerHTML = '';
  [['pendente','Pendentes'],['aprovada','Aprovadas'],['all','Todas']].forEach(([v,l])=>{
    const chip = document.createElement('button');
    chip.className = 'pill'+(adminSumStatus===v?' active':'');
    chip.textContent = l;
    chip.onclick = ()=>{ adminSumStatus=v; renderAdminSumulas(); };
    filterEl.appendChild(chip);
  });
  let list = SUMULAS.slice();
  if(adminSumStatus!=='all') list = list.filter(s=>(s.status||'pendente')===adminSumStatus);
  list.sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));
  const el = document.getElementById('adminSumulaList');
  if(list.length===0){ el.innerHTML = '<p class="empty">Nenhuma súmula nesse filtro.</p>'; return; }
  el.innerHTML = list.map(s=>{
    const badge = s.status==='aprovada' ? '<span class="badge badge-good">APROVADA</span>' : '<span class="badge badge-warn">PENDENTE</span>';
    const atletasTxt = (s.atletas||[]).map((a,i)=>`${i+1}. ${a}`).join('\n');
    return `<div class="sum-item">
      <div class="sum-head" data-toggle="${s.id}"><b>${teamName(s.teamId)}</b><span>${s.data==='2026-12-13'?'Dom 13/12':'Sáb 12/12'} · ${fmtTime(s.createdAt)} ${badge}</span></div>
      <div class="sum-body" id="sumbody-${s.id}">Responsável: ${escapeHtml(s.responsavel||'')}${s.telefone?(' · '+escapeHtml(s.telefone)):''}\n\nAtletas relacionados:\n${escapeHtml(atletasTxt)}
      <div class="sum-actions">
        ${s.status==='aprovada' ? `<button class="btn-ghost" data-reopen="${s.id}">Reabrir</button>` : `<button class="btn" data-approve="${s.id}">Aprovar</button>`}
        <button class="btn-ghost" data-del="${s.id}">Excluir</button>
      </div></div>
    </div>`;
  }).join('');
  el.querySelectorAll('[data-toggle]').forEach(h=> h.onclick = ()=> document.getElementById('sumbody-'+h.dataset.toggle).classList.toggle('open'));
  el.querySelectorAll('[data-approve]').forEach(b=> b.onclick = ()=> updateDoc(doc(db,'sumulas',b.dataset.approve), {status:'aprovada'}));
  el.querySelectorAll('[data-reopen]').forEach(b=> b.onclick = ()=> updateDoc(doc(db,'sumulas',b.dataset.reopen), {status:'pendente'}));
  el.querySelectorAll('[data-del]').forEach(b=> b.onclick = ()=> deleteDoc(doc(db,'sumulas',b.dataset.del)));
}

// ---------- master admin render ----------
function renderAdminLists(){
  fillTeamSelects();
  fillScorerTeamSelect();

  const tEl = document.getElementById('adminTeamList');
  tEl.innerHTML = TEAMS.slice().sort((a,b)=>a.name.localeCompare(b.name)).map(t=>
    `<div class="admin-list-item"><div class="il"><b>${escapeHtml(t.name)}</b><span>${t.categoria}</span></div>
    <div class="controls">
      <input type="text" placeholder="grupo" style="width:48px;" value="${escapeHtml(t.grupo||'')}" data-grupo="${t.id}">
      <button class="icon-btn danger" data-del-team="${t.id}">remover</button>
    </div></div>`
  ).join('') || '<p class="empty">Nenhum time ainda.</p>';
  tEl.querySelectorAll('[data-del-team]').forEach(b=> b.onclick = ()=> deleteDoc(doc(db,'teams',b.dataset.delTeam)));
  tEl.querySelectorAll('[data-grupo]').forEach(inp=> inp.onchange = ()=> updateDoc(doc(db,'teams',inp.dataset.grupo), {grupo: inp.value.trim()||null}));

  const mEl = document.getElementById('adminMatchList');
  mEl.innerHTML = MATCHES.slice().sort((a,b)=>(a.data||'').localeCompare(b.data||'')||(a.horario||'').localeCompare(b.horario||'')).map(m=>
    `<div class="admin-list-item"><div class="il"><b>${teamName(m.teamAId,m.teamAName)} vs ${teamName(m.teamBId,m.teamBName)}</b><span>${m.categoria} · ${faseLabel(m.fase)}</span></div>
    <div class="controls">
      <select data-dia="${m.id}">
        <option value="2026-12-12" ${m.data==='2026-12-12'?'selected':''}>Sáb</option>
        <option value="2026-12-13" ${m.data==='2026-12-13'?'selected':''}>Dom</option>
      </select>
      <input type="text" placeholder="HH:MM" style="width:46px;" value="${escapeHtml(m.horario||'')}" data-horario="${m.id}">
      <select data-campo="${m.id}">
        <option value="Grand Stand" ${m.campo==='Grand Stand'?'selected':''}>Grand Stand</option>
        <option value="Campo 2" ${m.campo==='Campo 2'?'selected':''}>Campo 2</option>
      </select>
      <select data-status="${m.id}">
        <option value="agendado" ${m.status==='agendado'?'selected':''}>Agendado</option>
        <option value="ao_vivo" ${m.status==='ao_vivo'?'selected':''}>Ao vivo</option>
        <option value="encerrado" ${m.status==='encerrado'?'selected':''}>Encerrado</option>
      </select>
      <input type="number" placeholder="A" value="${m.scoreA??''}" data-score-a="${m.id}">
      <input type="number" placeholder="B" value="${m.scoreB??''}" data-score-b="${m.id}">
      <button class="icon-btn danger" data-del-match="${m.id}">x</button>
    </div></div>`
  ).join('') || '<p class="empty">Nenhum jogo ainda. Cadastre times com grupo em "Times" e use "Gerar confrontos" acima, ou adicione um por um.</p>';
  mEl.querySelectorAll('[data-del-match]').forEach(b=> b.onclick = ()=> deleteDoc(doc(db,'matches',b.dataset.delMatch)));
  mEl.querySelectorAll('[data-dia]').forEach(sel=> sel.onchange = ()=> updateDoc(doc(db,'matches',sel.dataset.dia), {data: sel.value}));
  mEl.querySelectorAll('[data-horario]').forEach(inp=> inp.onchange = ()=> updateDoc(doc(db,'matches',inp.dataset.horario), {horario: inp.value.trim()}));
  mEl.querySelectorAll('[data-campo]').forEach(sel=> sel.onchange = ()=> updateDoc(doc(db,'matches',sel.dataset.campo), {campo: sel.value}));
  mEl.querySelectorAll('[data-status]').forEach(sel=> sel.onchange = ()=>{
    const match = MATCHES.find(x=>x.id===sel.dataset.status);
    const patch = { status: sel.value };
    if(sel.value==='ao_vivo' && match && !match.startedAt) patch.startedAt = Date.now();
    updateDoc(doc(db,'matches',sel.dataset.status), patch);
  });
  mEl.querySelectorAll('[data-score-a]').forEach(inp=> inp.onchange = ()=> updateDoc(doc(db,'matches',inp.dataset.scoreA), {scoreA: inp.value===''?null:parseInt(inp.value)}));
  mEl.querySelectorAll('[data-score-b]').forEach(inp=> inp.onchange = ()=> updateDoc(doc(db,'matches',inp.dataset.scoreB), {scoreB: inp.value===''?null:parseInt(inp.value)}));

  const sEl = document.getElementById('adminScorerList');
  sEl.innerHTML = SCORERS.slice().sort((a,b)=>(b.points||0)-(a.points||0)).map(s=>
    `<div class="admin-list-item"><div class="il"><b>${escapeHtml(s.name)}</b><span>${teamName(s.teamId)}</span></div>
    <div class="controls">
      <button class="icon-btn" data-try="${s.id}">+5</button>
      <button class="icon-btn" data-conv="${s.id}">+2</button>
      <button class="icon-btn" data-pen="${s.id}">+3</button>
      <input type="number" value="${s.points||0}" data-points="${s.id}">
      <button class="icon-btn danger" data-del-scorer="${s.id}">x</button>
    </div></div>`
  ).join('') || '<p class="empty">Nenhum atleta ainda.</p>';
  sEl.querySelectorAll('[data-try]').forEach(b=> b.onclick = ()=>{ const s=SCORERS.find(x=>x.id===b.dataset.try); updateDoc(doc(db,'scorers',b.dataset.try), {points:(s.points||0)+5}); });
  sEl.querySelectorAll('[data-conv]').forEach(b=> b.onclick = ()=>{ const s=SCORERS.find(x=>x.id===b.dataset.conv); updateDoc(doc(db,'scorers',b.dataset.conv), {points:(s.points||0)+2}); });
  sEl.querySelectorAll('[data-pen]').forEach(b=> b.onclick = ()=>{ const s=SCORERS.find(x=>x.id===b.dataset.pen); updateDoc(doc(db,'scorers',b.dataset.pen), {points:(s.points||0)+3}); });
  sEl.querySelectorAll('[data-points]').forEach(inp=> inp.onchange = ()=> updateDoc(doc(db,'scorers',inp.dataset.points), {points: inp.value===''?0:parseInt(inp.value)}));
  sEl.querySelectorAll('[data-del-scorer]').forEach(b=> b.onclick = ()=> deleteDoc(doc(db,'scorers',b.dataset.delScorer)));

  const aEl = document.getElementById('adminAnnList');
  aEl.innerHTML = ANNOUNCEMENTS.slice().sort((a,b)=>(b.createdAt||0)-(a.createdAt||0)).map(a=>
    `<div class="admin-list-item"><div class="il"><b>${escapeHtml(a.text.slice(0,60))}</b><span>${fmtTime(a.createdAt)}</span></div><button class="icon-btn danger" data-del-ann="${a.id}">remover</button></div>`
  ).join('') || '<p class="empty">Nenhum aviso ainda.</p>';
  aEl.querySelectorAll('[data-del-ann]').forEach(b=> b.onclick = ()=> deleteDoc(doc(db,'announcements',b.dataset.delAnn)));

  renderAdminSumulas();
  renderAdminPlacar();
}
