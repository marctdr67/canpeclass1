
const $=(s,p=document)=>p.querySelector(s), $$=(s,p=document)=>[...p.querySelectorAll(s)];
const state={user:null,dashboard:null,tasks:[],exams:[],classes:[],section:"dashboard",taskFilter:"totes",taskSearch:"",aiMode:"DUBTE",weekOffset:0};
const esc=v=>String(v??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]));
const api=async(url,opts={})=>{
  const r=await fetch(url,{headers:{"Content-Type":"application/json",...(opts.headers||{})},...opts});
  let d={}; try{d=await r.json()}catch{}
  if(!r.ok) throw new Error(d.error||"No s'ha pogut completar l'operaciÃ³.");
  return d;
};
const toast=(msg,error=false)=>{const el=document.createElement("div");el.className="toast"+(error?" error":"");el.textContent=msg;$("#toast-root").appendChild(el);setTimeout(()=>el.remove(),3200)};
const initials=n=>(n||"M").trim().slice(0,1).toUpperCase();
const fmtDate=v=>{if(!v)return "Sense data"; const d=new Date(String(v).includes("T")?v+"":v+"T12:00:00"); return isNaN(d)?"Sense data":d.toLocaleDateString("ca-ES",{day:"numeric",month:"short"})};
const fullDate=v=>{if(!v)return "â€”";const d=new Date(v+"T12:00:00");return isNaN(d)?"â€”":d.toLocaleDateString("ca-ES",{weekday:"long",day:"numeric",month:"long"})};
const daysUntil=v=>{if(!v)return 999;const a=new Date();a.setHours(0,0,0,0);const b=new Date(v+"T00:00:00");return Math.ceil((b-a)/86400000)};
function showToastFromError(e){toast(e.message||"S'ha produÃ¯t un error.",true)}
function navigate(section){
  state.section=section;
  $$(".section").forEach(x=>x.classList.toggle("active",x.id==="section-"+section));
  $$(".nav-item").forEach(x=>x.classList.toggle("active",x.dataset.section===section));
  const names={dashboard:["Tauler","Avui"],tasks:["Tasques","OrganitzaciÃ³"],exams:["ExÃ mens","PreparaciÃ³"],planner:["Planificador","Ritme"],classes:["Classes","Aula"],ai:["IA d'estudi","Assistent"],progress:["ProgrÃ©s","EvoluciÃ³"],profile:["Perfil","Compte"]};
  $("#top-context").textContent=names[section]?.[0]||"MiniClassroom";$("#top-title").textContent=names[section]?.[1]||"";
  if(section==="tasks")renderTasks(); if(section==="exams")renderExams(); if(section==="classes")loadClasses(); if(section==="planner")renderPlanner(); if(section==="progress")loadProgress();
  window.scrollTo({top:0,behavior:"smooth"});
}
function bindNav(){ $$("[data-section]").forEach(b=>b.addEventListener("click",()=>navigate(b.dataset.section))); }
function setUser(u){
  state.user=u;
  const n=u.username||"Alumne";$("#side-name").textContent=n;$("#top-name").textContent=n;$("#side-avatar").textContent=initials(n);$("#top-avatar").textContent=initials(n);
  $("#profile-name").textContent=n;$("#profile-email").textContent=u.email;$("#profile-role").textContent=u.role==="professor"?"Professor":"Alumne";$("#profile-avatar").textContent=initials(n);
  $("#greeting").innerHTML=u.role==="professor"?"La teva aula,<br><span>organitzada i al teu ritme.</span>":"El teu estudi,<br><span>clar i al teu ritme.</span>";
  $("#side-role").textContent=u.role==="professor"?"Professor":"Alumne";
  if(u.role==="professor"){
    $$(".nav-item[data-section='tasks'],.nav-item[data-section='exams'],.nav-item[data-section='planner'],.nav-item[data-section='ai'],.nav-item[data-section='progress']").forEach(x=>x.classList.add("hidden"));
    $("#recalc-ai").classList.add("hidden");
  }
}
async function boot(){
  try{
    const d=await api("/api/me");
    if(d.user){$("#auth-view").classList.add("hidden");$("#app-view").classList.remove("hidden");setUser(d.user);await loadDashboard();return}
  }catch{}
  $("#auth-view").classList.remove("hidden");$("#app-view").classList.add("hidden");
}
async function loadDashboard(){
  const d=await api("/api/dashboard");state.dashboard=d;state.tasks=d.tasks||[];state.exams=d.exams||[];state.classes=d.classes||[];
  $("#stat-pending").textContent=d.pending_count||0;$("#stat-urgent").textContent=d.urgent_count||0;$("#stat-progress").textContent=(d.progress||0)+"%";
  const done=state.tasks.filter(t=>t.status==="completada").length;$("#stat-completed").textContent=`${done} completades`;$("#stat-exams").textContent=(state.exams||[]).filter(e=>daysUntil(e.exam_date)>=0).length;$("#stat-study").textContent=`${d.study?.completed||0} / ${d.study?.planned||0} min`;
  renderDashboardLists();renderTomorrow();renderRecommendations(false);
}
function renderDashboardLists(){
  const pending=state.tasks.filter(t=>t.status!=="completada").slice(0,4), box=$("#dashboard-tasks");
  box.innerHTML=pending.length?pending.map(t=>`<div class="mini-list-item" style="display:flex;justify-content:space-between;gap:10px;padding:10px 0;border-bottom:1px solid #1a1d23"><div><b style="font-size:10px">${esc(t.name)}</b><small style="display:block;color:#777c87;font-size:9px;margin-top:3px">${esc(t.subject)} Â· ${fmtDate(t.due_date)}</small></div><span class="pill">${esc(t.status)}</span></div>`).join(""):`<div class="empty-state"><span>âœ“</span><b>No tens tasques pendents.</b><small>Quan n'afegeixis, MiniClassroom t'ajudarÃ  a ordenar-les.</small></div>`;
  const exams=state.exams.filter(e=>daysUntil(e.exam_date)>=0).slice(0,3), eb=$("#dashboard-exams");
  eb.innerHTML=exams.length?exams.map(e=>`<div style="padding:11px 0;border-bottom:1px solid #1a1d23"><b style="font-size:10px">${esc(e.subject)}</b><small style="display:block;color:#8d91a0;font-size:9px;margin-top:3px">${fullDate(e.exam_date)} Â· ${Math.max(0,daysUntil(e.exam_date))} dies</small></div>`).join(""):`<div class="empty-state"><span>â–¡</span><b>No hi ha exÃ mens.</b><small>Afegeix-ne un per comenÃ§ar a preparar-lo.</small></div>`;
}
function renderTomorrow(){
  const d=new Date();d.setDate(d.getDate()+1);$("#tomorrow-label").textContent=d.toLocaleDateString("ca-ES",{weekday:"long",day:"numeric",month:"long"});
  const iso=d.toISOString().slice(0,10), tasks=state.tasks.filter(t=>t.due_date===iso), exams=state.exams.filter(e=>e.exam_date===iso);
  const box=$("#tomorrow-content");
  if(tasks.length||exams.length) box.innerHTML=`<span class="calendar-icon">!</span><div><strong>${tasks.length+exams.length} element${tasks.length+exams.length===1?"":"s"} per demÃ .</strong><small>${[...tasks.map(t=>t.name),...exams.map(e=>"Examen de "+e.subject)].slice(0,3).map(esc).join(" Â· ")}</small></div>`;
}
async function renderRecommendations(force=true){
  if(state.user?.role==="professor")return;
  try{
    const d=await api("/api/ai/recommendations"), r=d.recommendations?.[0];
    $("#recommendation-box").innerHTML=r?`<span class="reco-orb">âœ¦</span><div><strong>${esc(r.action)} â€” ${esc(r.title)}</strong><small>${esc(r.reason)}</small></div>`:`<span class="reco-orb">âœ“</span><div><strong>No tens res urgent.</strong><small>Continua amb una sessiÃ³ curta de repÃ s per mantenir el ritme.</small></div>`;
    if(force)toast("Prioritats actualitzades amb IA.");
  }catch(e){if(force)showToastFromError(e)}
}
function renderTasks(){
  let list=state.tasks.filter(t=>state.taskFilter==="totes"||t.status===state.taskFilter);
  if(state.taskSearch)list=list.filter(t=>(t.name+" "+t.subject).toLowerCase().includes(state.taskSearch.toLowerCase()));
  const box=$("#tasks-list");
  if(!list.length){box.innerHTML=`<div class="card empty-state" style="min-height:260px"><span>âœ“</span><b>No hi ha tasques en aquesta vista.</b><small>Afegir una tasca et permetrÃ  comenÃ§ar a planificar millor.</small></div>`;return}
  box.innerHTML=list.map(t=>{
    const done=t.status==="completada";
    return `<div class="task-row">
      <button class="check ${done?"done":""}" data-complete="${t.id}" title="Completar">${done?"âœ“":""}</button>
      <div class="task-main"><b>${esc(t.name)}</b><small>${esc(t.description||"Sense descripciÃ³")}</small></div>
      <div class="task-subject">${esc(t.subject)}</div><div class="task-meta"><small>${fmtDate(t.due_date)}</small><small>${t.estimated_minutes||30} min</small></div>
      <select class="status-select" data-status="${t.id}"><option ${t.status==="pendent"?"selected":""} value="pendent">Pendent</option><option ${t.status==="en procÃ©s"?"selected":""} value="en procÃ©s">En procÃ©s</option><option ${done?"selected":""} value="completada">Completada</option></select>
      <div class="row-actions"><button data-edit="${t.id}">âœŽ</button><button data-delete="${t.id}">Ã—</button></div>
    </div>`;
  }).join("");
  $$("[data-complete]").forEach(b=>b.onclick=async()=>{try{await api(`/api/tasks/${b.dataset.complete}`,{method:"PATCH",body:JSON.stringify({status:"completada"})});await loadDashboard();toast("Tasca completada.");renderTasks()}catch(e){showToastFromError(e)}});
  $$("[data-status]").forEach(s=>s.onchange=async()=>{try{await api(`/api/tasks/${s.dataset.status}`,{method:"PATCH",body:JSON.stringify({status:s.value})});await loadDashboard();renderTasks()}catch(e){showToastFromError(e)}});
  $$("[data-delete]").forEach(b=>b.onclick=async()=>{if(!confirm("Vols eliminar aquesta tasca?"))return;try{await api(`/api/tasks/${b.dataset.delete}`,{method:"DELETE"});await loadDashboard();renderTasks();toast("Tasca eliminada.")}catch(e){showToastFromError(e)}});
  $$("[data-edit]").forEach(b=>b.onclick=()=>openTaskModal(state.tasks.find(t=>String(t.id)===b.dataset.edit)));
}
function openTaskModal(task=null){
  const root=$("#modal-root");root.innerHTML=`<div class="modal-backdrop"><div class="modal"><div class="modal-head"><h3>${task?"Editar tasca":"Nova tasca"}</h3><button class="close" data-close>Ã—</button></div><form id="task-form" class="form-grid two">
  <label>Nom<input name="name" required value="${esc(task?.name||"")}"></label><label>Assignatura<input name="subject" required value="${esc(task?.subject||"")}"></label>
  <label>Data d'entrega<input type="date" name="due_date" value="${esc(task?.due_date||"")}"></label><label>Temps estimat (min)<input type="number" min="5" max="1440" name="estimated_minutes" value="${task?.estimated_minutes||30}"></label>
  <label>Dificultat<select name="difficulty"><option value="1" ${task?.difficulty==1?"selected":""}>Baixa</option><option value="2" ${!task||task?.difficulty==2?"selected":""}>Mitjana</option><option value="3" ${task?.difficulty==3?"selected":""}>Alta</option></select></label><label>Estat<select name="status"><option ${!task||task?.status==="pendent"?"selected":""}>pendent</option><option ${task?.status==="en procÃ©s"?"selected":""}>en procÃ©s</option><option ${task?.status==="completada"?"selected":""}>completada</option></select></label>
  <label style="grid-column:1/-1">DescripciÃ³<textarea name="description" placeholder="QuÃ¨ has de fer?">${esc(task?.description||"")}</textarea></label>
  <div class="modal-actions" style="grid-column:1/-1"><button type="button" class="btn" data-close>CancelÂ·lar</button><button class="btn primary">Guardar tasca</button></div></form></div></div>`;
  $$("[data-close]",root).forEach(x=>x.onclick=()=>root.innerHTML="");
  $("#task-form").onsubmit=async e=>{e.preventDefault();const fd=new FormData(e.target);const data=Object.fromEntries(fd.entries());data.estimated_minutes=Number(data.estimated_minutes);data.difficulty=Number(data.difficulty);try{if(task)await api(`/api/tasks/${task.id}`,{method:"PATCH",body:JSON.stringify(data)});else await api("/api/tasks",{method:"POST",body:JSON.stringify(data)});root.innerHTML="";await loadDashboard();renderTasks();toast(task?"Tasca actualitzada.":"Tasca creada.")}catch(err){showToastFromError(err)}};
}
function renderExams(){
  const box=$("#exams-list");if(!state.exams.length){box.innerHTML=`<div class="card empty-state" style="grid-column:1/-1;min-height:260px"><span>â–¡</span><b>Encara no tens exÃ mens.</b><small>Afegeix la primera data i prepara-la amb temps.</small></div>`;return}
  box.innerHTML=state.exams.map(e=>{const d=daysUntil(e.exam_date);return `<div class="exam-card card ${d<=3?"urgent":""}"><div class="exam-accent"></div><p class="eyebrow">${esc(e.subject)}</p><h3>${fullDate(e.exam_date)}</h3><div class="exam-date">${d<0?"Passat":d===0?"Avui":d===1?"DemÃ ":`D'aquÃ­ a ${d} dies`}</div><div class="exam-days">${Math.max(0,d)}<span style="font-size:11px;color:#6f7480"> dies</span></div><small>${esc(e.syllabus||"Sense temari indicat")}<br>Dificultat ${e.difficulty}/3 Â· ${e.study_minutes} min de preparaciÃ³</small><div class="exam-actions"><button class="delete-link" data-exam-delete="${e.id}">Eliminar</button></div></div>`}).join("");
  $$("[data-exam-delete]").forEach(b=>b.onclick=async()=>{if(!confirm("Vols eliminar aquest examen?"))return;try{await api(`/api/exams/${b.dataset.examDelete}`,{method:"DELETE"});await loadDashboard();renderExams();toast("Examen eliminat.")}catch(e){showToastFromError(e)}});
}
function openExamModal(){
 const root=$("#modal-root");root.innerHTML=`<div class="modal-backdrop"><div class="modal"><div class="modal-head"><h3>Nou examen</h3><button class="close" data-close>Ã—</button></div><form id="exam-form" class="form-grid two">
 <label>Assignatura<input name="subject" required></label><label>Data<input name="exam_date" type="date" required></label>
 <label>Dificultat<select name="difficulty"><option value="1">Baixa</option><option value="2" selected>Mitjana</option><option value="3">Alta</option></select></label><label>Temps de preparaciÃ³ (min)<input type="number" name="study_minutes" value="120" min="15"></label>
 <label style="grid-column:1/-1">Temari<textarea name="syllabus" placeholder="CapÃ­tols, conceptes, exercicis..."></textarea></label>
 <div class="modal-actions" style="grid-column:1/-1"><button type="button" class="btn" data-close>CancelÂ·lar</button><button class="btn primary">Afegir examen</button></div></form></div></div>`;
 $$("[data-close]",root).forEach(x=>x.onclick=()=>root.innerHTML="");$("#exam-form").onsubmit=async e=>{e.preventDefault();const data=Object.fromEntries(new FormData(e.target).entries());data.difficulty=Number(data.difficulty);data.study_minutes=Number(data.study_minutes);try{await api("/api/exams",{method:"POST",body:JSON.stringify(data)});root.innerHTML="";await loadDashboard();renderExams();toast("Examen afegit.")}catch(err){showToastFromError(err)}}
}
async function loadClasses(){try{const d=await api("/api/classes");state.classes=d.classes||[];renderClasses()}catch(e){showToastFromError(e)}}
function renderClasses(){
 const actions=$("#class-actions");actions.innerHTML=state.user.role==="professor"?`<button class="btn primary" id="new-class">ï¼‹ Crear classe</button>`:`<button class="btn primary" id="join-class">ï¼‹ Unir-me amb un codi</button>`;
 if(state.user.role==="professor")$("#new-class").onclick=()=>openClassCreate();else $("#join-class").onclick=()=>openJoinModal();
 const box=$("#classes-list");$("#class-detail").classList.add("hidden");box.classList.remove("hidden");
 if(!state.classes.length){box.innerHTML=`<div class="card empty-state" style="grid-column:1/-1;min-height:260px"><span>âŒ˜</span><b>Encara no tens classes.</b><small>${state.user.role==="professor"?"Crea la primera classe i comparteix el codi.":"Demana el codi de 6 carÃ cters al teu professor."}</small></div>`;return}
 box.innerHTML=state.classes.map(c=>`<div class="class-card card"><p class="eyebrow">${c.membership==="professor"?"LA TEVA CLASSE":"CLASSE"}</p><h3>${esc(c.name)}</h3><span class="class-code">${esc(c.code)}</span><div class="class-meta"><span>${c.membership==="professor"?"Tu ets el professor":"Professor: "+esc(c.teacher)}</span><span>${c.student_count||0} alumnes</span></div><button class="btn secondary" data-open-class="${c.id}">Entrar a la classe â†’</button></div>`).join("");
 $$("[data-open-class]").forEach(b=>b.onclick=()=>openClassDetail(b.dataset.openClass));
}
function openClassCreate(){
 const root=$("#modal-root");root.innerHTML=`<div class="modal-backdrop"><div class="modal"><div class="modal-head"><h3>Crear una classe</h3><button class="close" data-close>Ã—</button></div><form id="class-form" class="form-grid"><label>Nom de la classe<input name="name" placeholder="2n Batx Â· FÃ­sica" required></label><p class="muted" style="font-size:9px">Generarem automÃ ticament un codi Ãºnic de 6 carÃ cters.</p><div class="modal-actions"><button type="button" class="btn" data-close>CancelÂ·lar</button><button class="btn primary">Crear classe</button></div></form></div></div>`;
 $$("[data-close]",root).forEach(x=>x.onclick=()=>root.innerHTML="");$("#class-form").onsubmit=async e=>{e.preventDefault();try{const d=await api("/api/classes",{method:"POST",body:JSON.stringify(Object.fromEntries(new FormData(e.target).entries()))});root.innerHTML="";await loadClasses();toast(`Classe creada Â· codi ${d.code}`)}catch(err){showToastFromError(err)}}
}
function openJoinModal(){
 const root=$("#modal-root");root.innerHTML=`<div class="modal-backdrop"><div class="modal"><div class="modal-head"><h3>Unir-me a una classe</h3><button class="close" data-close>Ã—</button></div><form id="join-form" class="form-grid"><label>Codi de la classe<input name="code" maxlength="6" style="text-transform:uppercase;font:700 18px monospace;letter-spacing:.16em;text-align:center" placeholder="195BT1" required></label><p class="muted" style="font-size:9px">El codi ha de tenir exactament 6 lletres o nÃºmeros.</p><div class="modal-actions"><button type="button" class="btn" data-close>CancelÂ·lar</button><button class="btn primary">Unir-me</button></div></form></div></div>`;
 $$("[data-close]",root).forEach(x=>x.onclick=()=>root.innerHTML="");$("#join-form").onsubmit=async e=>{e.preventDefault();const data=Object.fromEntries(new FormData(e.target).entries());data.code=data.code.toUpperCase();try{const d=await api("/api/classes/join",{method:"POST",body:JSON.stringify(data)});root.innerHTML="";await loadClasses();toast(`T'has unit a ${d.class.name}.`)}catch(err){showToastFromError(err)}}
}
async function openClassDetail(id){
 try{
  const d=await api(`/api/classes/${id}`);const c=d.class;$("#classes-list").classList.add("hidden");const box=$("#class-detail");box.classList.remove("hidden");
  box.innerHTML=`<div class="class-banner card"><div><button class="link-btn" id="back-classes">â† Tornar a classes</button><p class="eyebrow" style="margin-top:15px">AULA</p><h3>${esc(c.name)}</h3><p class="muted" style="font-size:10px">Professor: ${esc(c.teacher)}</p></div><div><span class="class-code big">${esc(c.code)}</span></div></div>
  <div class="content-grid"><div><div class="card" style="padding:16px"><div class="card-head"><h3>Contingut de la classe</h3>${d.can_manage?'<button class="btn primary" id="new-content">ï¼‹ Publicar</button>':''}</div><div id="class-content-list" style="margin-top:10px">${d.content?.length?d.content.map(x=>`<div class="content-item card"><span class="content-type">${esc(x.content_type)}</span><h4>${esc(x.title)}</h4><p>${esc(x.body||"")}</p><small style="display:block;color:#646975;font-size:8px;margin-top:8px">${x.due_date?"Entrega: "+fmtDate(x.due_date):x.event_date?"Data: "+fmtDate(x.event_date):""}</small></div>`).join(""):'<div class="empty-state" style="min-height:190px"><span>âœ¦</span><b>Encara no hi ha publicacions.</b><small>Quan el professor publiqui informaciÃ³, apareixerÃ  aquÃ­.</small></div>'}</div></div></div>
  <div><div class="card student-list"><p class="eyebrow">MEMBRES</p><h3 style="font:700 14px Manrope;margin:0 0 8px">${d.students?.length||0} alumnes</h3>${d.students?.length?d.students.map(s=>`<div class="student-row"><span>${esc(s.username)}</span><span style="color:#656a75">${fmtDate(s.joined_at)}</span></div>`).join(""):'<p class="muted" style="font-size:9px">Encara no hi ha alumnes.</p>'}</div></div></div>`;
  $("#back-classes").onclick=()=>{box.classList.add("hidden");$("#classes-list").classList.remove("hidden")};
  if(d.can_manage)$("#new-content").onclick=()=>openContentModal(id);
 }catch(e){showToastFromError(e)}
}
function openContentModal(classId){
 const root=$("#modal-root");root.innerHTML=`<div class="modal-backdrop"><div class="modal"><div class="modal-head"><h3>Publicar a la classe</h3><button class="close" data-close>Ã—</button></div><form id="content-form" class="form-grid two">
 <label>Tipus<select name="content_type"><option value="deures">Deures</option><option value="examen">Examen</option><option value="avis">AvÃ­s</option></select></label><label>TÃ­tol<input name="title" required placeholder="Treball de laboratori"></label>
 <label style="grid-column:1/-1">Text<textarea name="body" placeholder="Instruccions, informaciÃ³, recordatoris..."></textarea></label>
 <label>Data d'entrega<input type="date" name="due_date"></label><label>Data de l'esdeveniment<input type="date" name="event_date"></label>
 <div class="modal-actions" style="grid-column:1/-1"><button type="button" class="btn" data-close>CancelÂ·lar</button><button class="btn primary">Publicar</button></div></form></div></div>`;
 $$("[data-close]",root).forEach(x=>x.onclick=()=>root.innerHTML="");$("#content-form").onsubmit=async e=>{e.preventDefault();try{await api(`/api/classes/${classId}/content`,{method:"POST",body:JSON.stringify(Object.fromEntries(new FormData(e.target).entries()))});root.innerHTML="";openClassDetail(classId);toast("PublicaciÃ³ creada.")}catch(err){showToastFromError(err)}}
}
function weekStart(){const d=new Date();d.setDate(d.getDate()-((d.getDay()+6)%7)+state.weekOffset*7);d.setHours(0,0,0,0);return d}
function renderPlanner(){
 const start=weekStart(), names=["Dl","Dt","Dc","Dj","Dv","Ds","Dg"], grid=$("#week-grid"), items=[];
 state.tasks.forEach(t=>{if(t.due_date)items.push({date:t.due_date,type:"task",title:t.name,sub:`${t.estimated_minutes||30} min`})});
 state.exams.forEach(e=>{items.push({date:e.exam_date,type:"exam",title:"Examen Â· "+e.subject,sub:"PreparaciÃ³"})});
 grid.innerHTML=names.map((n,i)=>{const d=new Date(start);d.setDate(start.getDate()+i);const iso=d.toISOString().slice(0,10);const today=iso===new Date().toISOString().slice(0,10);const its=items.filter(x=>x.date===iso);return `<div class="day-col"><div class="day-head ${today?"today":""}"><small>${n}</small><b>${d.getDate()}</b></div><div class="day-items">${its.map(x=>`<div class="plan-item ${x.type}">${esc(x.title)}<small>${esc(x.sub)}</small></div>`).join("")}</div></div>`}).join("");
 $("#week-title").textContent=state.weekOffset===0?"Aquesta setmana":state.weekOffset>0?`D'aquÃ­ a ${state.weekOffset} setmana${state.weekOffset>1?"es":""}`:`Fa ${Math.abs(state.weekOffset)} setmana${Math.abs(state.weekOffset)>1?"es":""}`;
 renderPlanSessions();
}
function renderPlanSessions(){
 const pending=state.tasks.filter(t=>t.status!=="completada").sort((a,b)=>daysUntil(a.due_date)-daysUntil(b.due_date)).slice(0,5);
 $("#plan-sessions").innerHTML=pending.length?pending.map(t=>`<div class="session-item"><b>${esc(t.name)}</b><small>${esc(t.subject)} Â· proposta de ${Math.min(50,Math.max(25,t.estimated_minutes||30))} min Â· ${fmtDate(t.due_date)}</small></div>`).join(""):'<div class="empty-state" style="min-height:150px"><span>âœ“</span><b>Cap sessiÃ³ pendent.</b><small>Gaudeix del marge.</small></div>';
}
async function generatePlan(){try{await renderRecommendations(false);navigate("planner");toast("Pla adaptat segons les teves prioritats.");}catch(e){showToastFromError(e)}}
async function loadProgress(){
 try{const d=await api("/api/progress");const t=d.tasks||{},s=d.study||{};const pct=t.total?Math.round(t.completed*100/t.total):0;$("#progress-number").textContent=pct+"%";$("#progress-bar").style.width=pct+"%";$("#progress-caption").textContent=`${t.completed||0} de ${t.total||0} tasques`;
 const planned=Number(s.planned||0),completed=Number(s.completed||0),sp=planned?Math.min(100,Math.round(completed*100/planned)):0;$("#study-number").textContent=completed+" min";$("#study-bar").style.width=sp+"%";$("#study-caption").textContent=`${completed} min completats de ${planned} planificats`;
 const week=d.week||[], map={};week.forEach(x=>map[String(x.session_date).slice(5)]=Number(x.minutes||0));const days=["Dl","Dt","Dc","Dj","Dv","Ds","Dg"];const vals=days.map((n,i)=>{const dt=new Date();dt.setDate(dt.getDate()-((dt.getDay()+6)%7)+(i));return {n, v:map[dt.toISOString().slice(5,10)]||0}});const max=Math.max(30,...vals.map(x=>x.v));$("#progress-chart").innerHTML=vals.map(x=>`<div class="bar-col"><div class="bar" style="height:${Math.max(3,x.v/max*100)}%"></div><small>${x.n}</small></div>`).join("");
 $("#test-history").innerHTML=d.tests?.length?d.tests.map(x=>`<div class="test-row"><span>${esc(x.topic)}</span><span class="test-score">${x.score}/${x.total}</span></div>`).join(""):'<p class="muted" style="font-size:10px">Encara no has completat cap test.</p>';
 }catch(e){showToastFromError(e)}
}
function addChat(role,text){const el=document.createElement("div");el.className="chat-bubble "+role;el.innerHTML=`<span class="bubble-icon">${role==="ai"?"âœ¦":"â—"}</span><div><b>${role==="ai"?"MiniClassroom IA":"Tu"}</b><p>${esc(text)}</p></div>`;$("#chat-log").appendChild(el);$("#chat-log").scrollTop=$("#chat-log").scrollHeight}
async function sendAI(){
 const input=$("#ai-input"),msg=input.value.trim();if(!msg)return;input.value="";addChat("user",msg);const loading=document.createElement("div");loading.className="chat-bubble ai";loading.innerHTML='<span class="bubble-icon">âœ¦</span><div><b>MiniClassroom IA</b><p>Estic pensant...</p></div>';$("#chat-log").appendChild(loading);
 try{const d=await api("/api/ai",{method:"POST",body:JSON.stringify({mode:state.aiMode,message:msg})});loading.remove();addChat("ai",d.answer||"No he pogut generar una resposta.")}catch(e){loading.remove();showToastFromError(e)}}
async function openTest(){
 const root=$("#modal-root");root.innerHTML=`<div class="modal-backdrop"><div class="modal"><div class="modal-head"><h3>Crear un test</h3><button class="close" data-close>Ã—</button></div><form id="test-start" class="form-grid"><label>Tema<input name="topic" required placeholder="RevoluciÃ³ Industrial"></label><div class="modal-actions"><button type="button" class="btn" data-close>CancelÂ·lar</button><button class="btn primary">Generar 5 preguntes</button></div></form></div></div>`;
 $$("[data-close]",root).forEach(x=>x.onclick=()=>root.innerHTML="");$("#test-start").onsubmit=async e=>{e.preventDefault();const topic=new FormData(e.target).get("topic");try{const d=await api("/api/ai/test",{method:"POST",body:JSON.stringify({topic})});renderTestModal(d)}catch(err){showToastFromError(err)}}
}
function renderTestModal(test){
 const root=$("#modal-root"),questions=test.questions||[];root.innerHTML=`<div class="modal-backdrop"><div class="modal"><div class="modal-head"><h3>Test Â· ${esc(test.topic)}</h3><button class="close" data-close>Ã—</button></div><div id="test-questions">${questions.map((q,i)=>`<div class="test-question" data-q="${i}"><p>${i+1}. ${esc(q.question)}</p>${q.options.map((o,j)=>`<button class="test-option" data-opt="${i}-${j}">${String.fromCharCode(65+j)} Â· ${esc(o)}</button>`).join("")}</div>`).join("")}</div><div class="modal-actions"><button class="btn primary" id="grade-test">Corregir test</button></div></div></div>`;
 $$("[data-close]",root).forEach(x=>x.onclick=()=>root.innerHTML="");
 const answers={};$$("[data-opt]",root).forEach(b=>b.onclick=()=>{const [qi,oi]=b.dataset.opt.split("-").map(Number);answers[qi]=oi;$$(`[data-q="${qi}"] .test-option`,root).forEach(x=>x.classList.remove("selected"));b.classList.add("selected")});
 $("#grade-test").onclick=async()=>{let score=0;questions.forEach((q,i)=>{if(answers[i]===q.answer)score++});questions.forEach((q,i)=>{$$(`[data-q="${i}"] .test-option`,root).forEach((b,j)=>{if(j===q.answer)b.classList.add("selected");});});$("#grade-test").disabled=true;$("#grade-test").textContent="Resultat";const res=document.createElement("div");res.className="test-result";res.innerHTML=`<strong>${score}/${questions.length}</strong><p>Has encertat ${score} de ${questions.length} preguntes.</p><button class="btn primary" id="save-test-result">Guardar resultat</button>`;root.querySelector(".modal").appendChild(res);$("#save-test-result").onclick=async()=>{try{await api("/api/test-results",{method:"POST",body:JSON.stringify({topic:test.topic,score,total:questions.length})});toast("Resultat guardat al teu progrÃ©s.");root.innerHTML="";}catch(e){showToastFromError(e)}}};
}
function openReco(){navigate("dashboard");renderRecommendations(true)}
function bindAuth(){
 $$(".auth-tab").forEach(b=>b.onclick=()=>{$$(".auth-tab").forEach(x=>x.classList.remove("active"));b.classList.add("active");const reg=b.dataset.auth==="register";$("#login-form").classList.toggle("hidden",reg);$("#register-form").classList.toggle("hidden",!reg);$("#auth-message").textContent=""});
 $("#login-form").onsubmit=async e=>{e.preventDefault();$("#auth-message").textContent="";try{const d=await api("/api/login",{method:"POST",body:JSON.stringify(Object.fromEntries(new FormData(e.target).entries()))});setUser(d.user);$("#auth-view").classList.add("hidden");$("#app-view").classList.remove("hidden");await loadDashboard();toast("Benvingut/da a MiniClassroom.")}catch(err){$("#auth-message").textContent=err.message}};
 $("#register-form").onsubmit=async e=>{e.preventDefault();try{await api("/api/register",{method:"POST",body:JSON.stringify(Object.fromEntries(new FormData(e.target).entries()))});const d=await api("/api/me");setUser(d.user);$("#auth-view").classList.add("hidden");$("#app-view").classList.remove("hidden");await loadDashboard();toast("Compte creat correctament.")}catch(err){$("#auth-message").textContent=err.message}};
}
function bindUI(){
 bindNav();bindAuth();
 $("#logout-btn").onclick=async()=>{await api("/api/logout",{method:"POST"});location.reload()};
 $("#new-task").onclick=()=>openTaskModal();$("#new-exam").onclick=()=>openExamModal();$("#quick-add").onclick=()=>openTaskModal();$("#quick-ai").onclick=()=>navigate("ai");$("#recalc-ai").onclick=()=>renderRecommendations(true);$("#open-reco").onclick=openReco;$("#open-test").onclick=openTest;$("#generate-plan").onclick=generatePlan;
 $("#prev-week").onclick=()=>{state.weekOffset--;renderPlanner()};$("#next-week").onclick=()=>{state.weekOffset++;renderPlanner()};$("#add-session").onclick=()=>toast("Les sessions es creen a partir del teu pla; afegeix una tasca o examen per comenÃ§ar.");
 $("#task-search").oninput=e=>{state.taskSearch=e.target.value;renderTasks()};$$("[data-filter]").forEach(b=>b.onclick=()=>{$$("[data-filter]").forEach(x=>x.classList.remove("active"));b.classList.add("active");state.taskFilter=b.dataset.filter;renderTasks()});
 $$("[data-mode]").forEach(b=>b.onclick=()=>{$$("[data-mode]").forEach(x=>x.classList.remove("active"));b.classList.add("active");state.aiMode=b.dataset.mode;$("#ai-input").placeholder=state.aiMode==="RESUMIR"?"Enganxa el text que vols resumir...":"Escriu una pregunta..."});
 $("#ai-form").onsubmit=e=>{e.preventDefault();sendAI()};$("#ai-input").addEventListener("keydown",e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();sendAI()}});
}
bindUI();boot();
