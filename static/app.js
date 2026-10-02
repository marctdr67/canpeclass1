const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];

const state = {
  user: null,
  section: "dashboard",
  tasks: [],
  exams: [],
  classes: [],
  currentClass: null,
  aiMode: "DUBTE",
  taskFilter: "totes",
  taskSearch: "",
  weekOffset: 0,
  calendarOffset: 0,
};

function escapeHtml(value = "") {
  return String(value).replace(/[&<>'"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c]));
}

function initials(name = "U") {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  return (parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : parts[0]?.[0] || "U").toUpperCase();
}

function fmtDate(value, options = {}) {
  if (!value) return "—";
  const d = new Date(`${String(value).slice(0,10)}T12:00:00`);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("ca-ES", {day:"2-digit", month:"short", ...options}).format(d);
}

function fullDate(value) {
  if (!value) return "—";
  const d = new Date(`${String(value).slice(0,10)}T12:00:00`);
  return Number.isNaN(d.getTime()) ? "—" : new Intl.DateTimeFormat("ca-ES", {weekday:"long",day:"numeric",month:"long",year:"numeric"}).format(d);
}

function daysUntil(value) {
  if (!value) return 999;
  const a = new Date();
  const b = new Date(`${String(value).slice(0,10)}T12:00:00`);
  a.setHours(0,0,0,0);
  return Math.round((b-a)/86400000);
}

function toast(message, error = false, success = false) {
  let root = $("#toast-root");
  if (!root) return;
  let stack = $(".toast-stack", root);
  if (!stack) { stack = document.createElement("div"); stack.className = "toast-stack"; root.appendChild(stack); }
  const el = document.createElement("div");
  el.className = `toast ${error ? "error" : success ? "success" : ""}`;
  el.textContent = message;
  stack.appendChild(el);
  setTimeout(() => el.remove(), 3600);
}

function showError(error) {
  toast(error?.message || "No s'ha pogut completar l'operació.", true);
}

async function api(path, options = {}) {
  const config = {credentials:"same-origin", headers:{"Content-Type":"application/json", ...(options.headers || {})}, ...options};
  if (config.body && typeof config.body !== "string") config.body = JSON.stringify(config.body);
  const response = await fetch(path, config);
  const text = await response.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = {error: text || "Resposta no vàlida."}; }
  if (!response.ok || data.ok === false) throw new Error(data.error || `Error ${response.status}`);
  return data;
}

function setUser(user) {
  state.user = user;
  const name = user?.name || user?.username || "Usuari";
  const role = user?.role === "professor" ? "Professor" : "Alumne";
  ["#side-name","#top-name","#profile-name"].forEach(id => { if ($(id)) $(id).textContent = name; });
  ["#side-avatar","#top-avatar","#profile-avatar"].forEach(id => { if ($(id)) $(id).textContent = initials(name); });
  if ($("#side-role")) $("#side-role").textContent = role;
  if ($("#top-role")) $("#top-role").textContent = role;
  if ($("#profile-role")) $("#profile-role").textContent = role;
  if ($("#profile-email")) $("#profile-email").textContent = user?.email || "—";
  if ($("#profile-name-input")) $("#profile-name-input").value = name;
  if ($("#profile-email-input")) $("#profile-email-input").value = user?.email || "";
  if ($("#greeting")) {
    $("#greeting").innerHTML = role === "Professor" ? "La teva aula,<br><span>organitzada i al teu ritme.</span>" : "El teu estudi,<br><span>clar i al teu ritme.</span>";
  }
  const studentSections = ["tasks","exams","planner","ai","progress"];
  studentSections.forEach(section => {
    $$(`.nav-item[data-section="${section}"]`).forEach(el => el.classList.toggle("hidden", role === "Professor"));
  });
}

function navigate(section) {
  const allowed = ["dashboard","calendar","tasks","exams","planner","classes","ai","progress","profile"];
  if (!allowed.includes(section)) section = "dashboard";
  state.section = section;
  $$(".section").forEach(el => el.classList.remove("active"));
  $(`#section-${section}`)?.classList.add("active");
  $$(".nav-item[data-section]").forEach(el => el.classList.toggle("active", el.dataset.section === section));
  if ($("#top-context")) $("#top-context").textContent = section;
  if (section === "tasks") renderTasks();
  if (section === "exams") renderExams();
  if (section === "classes") loadClasses();
  if (section === "planner") renderPlanner();
  if (section === "progress") loadProgress();
  if (section === "calendar") renderCalendar();
  if (section === "profile") loadProfileFields();
  $(".sidebar")?.classList.remove("open");
  window.scrollTo({top:0, behavior:"smooth"});
}

function bindNavigation() {
  // Navegació directa i robusta: cada element amb data-section
  // rep el seu propi controlador. Això evita conflictes amb altres
  // listeners o elements dinàmics de la interfície.
  $$('[data-section]').forEach((element) => {
    if (element.dataset.navigationBound === '1') return;

    element.dataset.navigationBound = '1';
    if (element.tagName === 'BUTTON') element.type = 'button';

    element.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const section = element.dataset.section;
      if (section) navigate(section);
    });
  });

  // Delegació com a reserva per a botons creats posteriorment.
  if (!document.body.dataset.navigationDelegated) {
    document.body.dataset.navigationDelegated = '1';
    document.body.addEventListener('click', (event) => {
      const element = event.target.closest('[data-section]');
      if (!element || element.dataset.navigationBound === '1') return;
      event.preventDefault();
      const section = element.dataset.section;
      if (section) navigate(section);
    });
  }
}

/* AUTH */
function bindAuth() {
  $$(".auth-tab").forEach(button => {
    button.addEventListener("click", () => {
      const register = button.dataset.auth === "register";
      $$(".auth-tab").forEach(tab => tab.classList.toggle("active", tab === button));
      $("#login-form")?.classList.toggle("hidden", register);
      $("#register-form")?.classList.toggle("hidden", !register);
      if ($("#auth-message")) $("#auth-message").textContent = "";
    });
  });

  $("#login-form")?.addEventListener("submit", async event => {
    event.preventDefault();
    const button = $("button[type=submit]", event.currentTarget);
    button?.setAttribute("disabled", "disabled");
    try {
      const data = await api("/api/login", {method:"POST", body:Object.fromEntries(new FormData(event.currentTarget).entries())});
      setUser(data.user);
      $("#auth-view")?.classList.add("hidden");
      $("#app-view")?.classList.remove("hidden");
      await loadDashboard();
      navigate("dashboard");
      toast("Benvingut/da a MiniClassroom.", false, true);
      event.currentTarget.reset();
    } catch (error) {
      if ($("#auth-message")) $("#auth-message").textContent = error.message;
    } finally { button?.removeAttribute("disabled"); }
  });

  $("#register-form")?.addEventListener("submit", async event => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget).entries());
    try {
      const result = await api("/api/register", {method:"POST", body:data});
      setUser(result.user);
      $("#auth-view")?.classList.add("hidden");
      $("#app-view")?.classList.remove("hidden");
      await loadDashboard();
      navigate("dashboard");
      toast("Compte creat correctament.", false, true);
      event.currentTarget.reset();
    } catch (error) {
      if ($("#auth-message")) $("#auth-message").textContent = error.message;
    }
  });
}

/* DASHBOARD */
async function loadDashboard() {
  const data = await api("/api/dashboard");
  state.tasks = data.tasks || [];
  state.exams = data.exams || [];
  state.classes = data.classes || [];
  const s = data.stats || {};
  if ($("#stat-pending")) $("#stat-pending").textContent = s.pending ?? 0;
  if ($("#stat-pending-sub")) $("#stat-pending-sub").textContent = `${s.completed ?? 0} completades`;
  if ($("#stat-exams")) $("#stat-exams").textContent = s.exams ?? 0;
  if ($("#stat-progress")) $("#stat-progress").textContent = `${s.progress ?? 0}%`;
  if ($("#stat-study")) $("#stat-study").textContent = `${s.study_minutes ?? 0} min`;
  if ($("#stat-urgent")) $("#stat-urgent").textContent = s.urgent ?? 0;
  renderDashboardClasses();
  renderAgenda();
  renderRecommendations();
  renderDueList();
}

function renderDashboardClasses() {
  const root = $("#dashboard-classes");
  if (!root) return;
  if (!state.classes.length) { root.innerHTML = `<div class="empty-state"><strong>Encara no tens cap classe</strong><small>Uneix-te a una classe o crea'n una si ets professor/a.</small></div>`; return; }
  root.innerHTML = state.classes.slice(0,3).map(c => classCard(c)).join("");
  $$("[data-open-class]", root).forEach(btn => btn.addEventListener("click", () => openClassDetail(Number(btn.dataset.openClass))));
}

function classCard(c) {
  return `<article class="class-card"><div class="class-card-accent"></div><div class="class-card-body"><div class="eyebrow">CLASSE</div><h3>${escapeHtml(c.name)}</h3><p>${escapeHtml(c.teacher || c.teacher_name || "—")}</p><div class="class-meta"><span>${escapeHtml(c.code || "")}</span><span>${Number(c.student_count || 0)} alumnes</span></div></div><button class="class-card-open" type="button" data-open-class="${c.id}">Entrar a la classe →</button></article>`;
}

function renderAgenda() {
  const root = $("#agenda-list");
  if (!root) return;
  const today = new Date().toISOString().slice(0,10);
  const events = [
    ...state.tasks.filter(t => t.due_date === today).map(t => ({title:t.name, sub:t.subject || "Tasca", type:"tasca"})),
    ...state.exams.filter(e => e.exam_date === today).map(e => ({title:e.subject, sub:"Examen", type:"examen"}))
  ];
  root.innerHTML = events.length ? events.map(e => `<div class="compact-row"><i class="compact-dot"></i><div><strong>${escapeHtml(e.title)}</strong><small>${escapeHtml(e.sub)}</small></div><b>→</b></div>`).join("") : `<div class="empty-state" style="margin:10px">Cap activitat per avui.</div>`;
}

function renderDueList() {
  const root = $("#due-list");
  if (!root) return;
  const pending = state.tasks.filter(t => t.status !== "completada").sort((a,b) => String(a.due_date||"9999").localeCompare(String(b.due_date||"9999"))).slice(0,3);
  root.innerHTML = pending.length ? pending.map(t => `<div class="compact-row"><i class="compact-dot"></i><div><strong>${escapeHtml(t.name)}</strong><small>${escapeHtml(t.subject||"Tasca")} · ${fmtDate(t.due_date)}</small></div><b>${t.status === "pendent" ? "pendent" : "→"}</b></div>`).join("") : `<div class="empty-state" style="margin:10px">No tens tasques pendents.</div>`;
}

async function renderRecommendations() {
  const root = $("#recommendations-list");
  if (!root) return;
  try {
    const data = await api("/api/ai/recommendations");
    const items = data.recommendations || [];
    root.innerHTML = items.length ? items.map(item => `<div class="recommendation-row"><span class="recommendation-icon">${item.type === "examen" ? "▣" : "✓"}</span><div><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.reason)}</small></div></div>`).join("") : `<div class="empty-state"><strong>Tot en ordre</strong><small>No hi ha prou feina pendent per generar una prioritat.</small></div>`;
  } catch { root.innerHTML = `<div class="empty-state"><strong>Recomanacions no disponibles</strong><small>Pots continuar organitzant-te manualment.</small></div>`; }
}

/* TASKS */
function renderTasks() {
  const root = $("#tasks-list");
  if (!root) return;
  let items = [...state.tasks];
  if (state.taskFilter === "pendents") items = items.filter(t => t.status === "pendent");
  if (state.taskFilter === "proces") items = items.filter(t => t.status === "en procés");
  if (state.taskFilter === "completades") items = items.filter(t => t.status === "completada");
  if (state.taskSearch) { const q = state.taskSearch.toLowerCase(); items = items.filter(t => `${t.name} ${t.subject} ${t.description}`.toLowerCase().includes(q)); }
  items.sort((a,b) => (a.status === "completada") - (b.status === "completada") || String(a.due_date||"9999").localeCompare(String(b.due_date||"9999")));
  root.innerHTML = items.length ? items.map(taskRow).join("") : `<div class="empty-state"><strong>No hi ha tasques aquí</strong><small>Crea una tasca per començar.</small></div>`;
  $$("[data-task-complete]", root).forEach(btn => btn.addEventListener("click", () => updateTask(Number(btn.dataset.taskComplete), {status:"completada"})));
  $$("[data-task-edit]", root).forEach(btn => btn.addEventListener("click", () => openTaskModal(state.tasks.find(t => t.id === Number(btn.dataset.taskEdit)))));
  $$("[data-task-delete]", root).forEach(btn => btn.addEventListener("click", () => deleteTask(Number(btn.dataset.taskDelete))));
}

function taskRow(t) {
  const complete = t.status === "completada";
  const cls = complete ? "complete" : t.status === "en procés" ? "process" : "";
  return `<article class="item-row"><i class="item-status ${cls}"></i><div class="item-main"><strong>${escapeHtml(t.name)}</strong><p>${escapeHtml(t.subject||"Sense assignatura")} · ${t.description ? escapeHtml(t.description) : "Sense descripció"}</p><div class="item-meta"><span>${t.due_date ? `Entrega ${fmtDate(t.due_date)}` : "Sense data"}</span><span>${t.estimated_minutes || 0} min</span><span>${escapeHtml(t.difficulty || "mitjana")}</span><span>${escapeHtml(t.status || "pendent")}</span></div></div><div class="row-actions">${!complete ? `<button class="small-btn" title="Completar" data-task-complete="${t.id}" type="button">✓</button>` : ""}<button class="small-btn" title="Editar" data-task-edit="${t.id}" type="button">✎</button><button class="small-btn" title="Eliminar" data-task-delete="${t.id}" type="button">×</button></div></article>`;
}

async function updateTask(id, patch) {
  try { await api(`/api/tasks/${id}`, {method:"PATCH", body:patch}); await refreshData(); toast("Tasca actualitzada.",false,true); }
  catch(e){showError(e);}
}
async function deleteTask(id) {
  if (!confirm("Vols eliminar aquesta tasca?")) return;
  try { await api(`/api/tasks/${id}`, {method:"DELETE"}); await refreshData(); toast("Tasca eliminada.",false,true); } catch(e){showError(e);}
}

/* EXAMS */
function renderExams() {
  const root = $("#exams-list");
  if (!root) return;
  const items = [...state.exams].sort((a,b)=>String(a.exam_date).localeCompare(String(b.exam_date)));
  root.innerHTML = items.length ? items.map(examCard).join("") : `<div class="empty-state"><strong>Encara no tens exàmens</strong><small>Afegeix la primera data per començar a planificar.</small></div>`;
  $$("[data-exam-edit]",root).forEach(b=>b.onclick=()=>openExamModal(state.exams.find(e=>e.id===Number(b.dataset.examEdit))));
  $$("[data-exam-delete]",root).forEach(b=>b.onclick=()=>deleteExam(Number(b.dataset.examDelete)));
}
function examCard(e){
  const days=daysUntil(e.exam_date); const near=days<=3 && days>=0;
  return `<article class="exam-card ${near?"near":""}"><div class="exam-date">${near?"PROPER":"EXAMEN"} · ${fmtDate(e.exam_date,{year:"numeric"})}</div><h3>${escapeHtml(e.subject)}</h3><p>${escapeHtml(e.syllabus||"Sense temari indicat.")}</p><div class="exam-badges"><span>${escapeHtml(e.difficulty||"mitjana")}</span><span>${e.study_minutes||0} min d'estudi</span><span>${days<0?"Passat":days===0?"Avui":`En ${days} dies`}</span></div><div class="row-actions" style="margin-top:13px"><button class="small-btn" data-exam-edit="${e.id}" type="button">✎</button><button class="small-btn" data-exam-delete="${e.id}" type="button">×</button></div></article>`;
}
async function deleteExam(id){if(!confirm("Vols eliminar aquest examen?"))return;try{await api(`/api/exams/${id}`,{method:"DELETE"});await refreshData();toast("Examen eliminat.",false,true)}catch(e){showError(e)}}

/* MODALS */
function openModal(title, body, onSubmit) {
  const root=$("#modal-root"); if(!root)return;
  root.innerHTML=`<div class="modal-backdrop" data-close-modal><div class="modal" role="dialog" aria-modal="true"><div class="modal-header"><h2>${title}</h2><button class="modal-close" data-close-modal type="button">×</button></div><div class="modal-body">${body}</div><div class="modal-footer"><button class="btn btn-outline" data-close-modal type="button">Cancel·lar</button><button class="btn btn-yellow" id="modal-submit" type="button">Guardar</button></div></div></div>`;
  $$("[data-close-modal]",root).forEach(el=>el.addEventListener("click",()=>{root.innerHTML=""}));
  $("#modal-submit",root).onclick=async()=>{try{const result=await onSubmit(root);if(result!==false)root.innerHTML=""}catch(e){showError(e)}};
}
function openTaskModal(task=null){
  const t=task||{};
  openModal(task?"Editar tasca":"Nova tasca",`<form id="task-modal-form" class="form-grid"><label>Nom<input name="name" value="${escapeHtml(t.name||"")}" required></label><label>Assignatura<input name="subject" value="${escapeHtml(t.subject||"")}"></label><label>Data d'entrega<input name="due_date" type="date" value="${escapeHtml(t.due_date||"")}"></label><label>Temps estimat (min)<input name="estimated_minutes" type="number" min="1" value="${t.estimated_minutes||30}"></label><label>Dificultat<select name="difficulty"><option ${t.difficulty==="baixa"?"selected":""}>baixa</option><option ${!t.difficulty||t.difficulty==="mitjana"?"selected":""}>mitjana</option><option ${t.difficulty==="alta"?"selected":""}>alta</option></select></label><label>Estat<select name="status"><option value="pendent" ${!t.status||t.status==="pendent"?"selected":""}>pendent</option><option value="en procés" ${t.status==="en procés"?"selected":""}>en procés</option><option value="completada" ${t.status==="completada"?"selected":""}>completada</option></select></label><label style="grid-column:1/-1">Descripció<textarea name="description">${escapeHtml(t.description||"")}</textarea></label></form>`,async root=>{const data=Object.fromEntries(new FormData($("#task-modal-form",root)).entries()); if(task) await api(`/api/tasks/${task.id}`,{method:"PATCH",body:data}); else await api("/api/tasks",{method:"POST",body:data}); await refreshData();toast(task?"Tasca actualitzada.":"Tasca creada.",false,true);});
}
function openExamModal(exam=null){
  const e=exam||{};
  openModal(exam?"Editar examen":"Nou examen",`<form id="exam-modal-form" class="form-grid"><label>Assignatura<input name="subject" value="${escapeHtml(e.subject||"")}" required></label><label>Data<input name="exam_date" type="date" value="${escapeHtml(e.exam_date||"")}" required></label><label>Dificultat<select name="difficulty"><option ${e.difficulty==="baixa"?"selected":""}>baixa</option><option ${!e.difficulty||e.difficulty==="mitjana"?"selected":""}>mitjana</option><option ${e.difficulty==="alta"?"selected":""}>alta</option></select></label><label>Temps d'estudi (min)<input name="study_minutes" type="number" min="0" value="${e.study_minutes||120}"></label><label style="grid-column:1/-1">Temari<textarea name="syllabus">${escapeHtml(e.syllabus||"")}</textarea></label></form>`,async root=>{const data=Object.fromEntries(new FormData($("#exam-modal-form",root)).entries());if(exam)await api(`/api/exams/${exam.id}`,{method:"PATCH",body:data});else await api("/api/exams",{method:"POST",body:data});await refreshData();toast(exam?"Examen actualitzat.":"Examen creat.",false,true);});
}
function openCreateClassModal(){
  openModal("Crear classe",`<form id="class-form" class="form-grid"><label>Nom de la classe<input name="name" placeholder="Ex. Química 2on bachi" required></label><label>Assignatura<input name="subject" placeholder="Ex. Química"></label></form>`,async root=>{const data=Object.fromEntries(new FormData($("#class-form",root)).entries());await api("/api/classes",{method:"POST",body:data});await loadClasses();toast("Classe creada correctament.",false,true);});
}
function openJoinClassModal(){
  openModal("Unir-se a una classe",`<form id="join-form"><label class="form-grid full">Codi de classe<input name="code" maxlength="6" style="text-transform:uppercase" placeholder="Q4R62Q" required></label></form>`,async root=>{const data=Object.fromEntries(new FormData($("#join-form",root)).entries());await api("/api/classes/join",{method:"POST",body:data});await loadClasses();toast("T'has unit a la classe.",false,true);});
}
function openContentModal(classId){
  openModal("Publicar a la classe",`<form id="content-form" class="form-grid"><label>Tipus<select name="kind"><option value="avis">Avís</option><option value="tasca">Deures</option><option value="examen">Examen</option><option value="material">Material</option></select></label><label>Títol<input name="title" required></label><label style="grid-column:1/-1">Descripció<textarea name="body"></textarea></label><label>Data<input name="event_date" type="date"></label></form>`,async root=>{const data=Object.fromEntries(new FormData($("#content-form",root)).entries());await api(`/api/classes/${classId}/content`,{method:"POST",body:data});await openClassDetail(classId);toast("Publicació creada.",false,true);});
}

/* CLASSES */
async function loadClasses(){
  try{const data=await api("/api/classes");state.classes=data.classes||[];renderClassActions();renderClasses();}catch(e){showError(e)}
}
function renderClassActions(){
  const root=$("#class-actions"); if(!root)return;
  root.innerHTML=state.user?.role==="professor"?`<button id="create-class" class="btn btn-yellow" type="button">+ Crear classe</button>`:`<button id="join-class" class="btn btn-outline" type="button">+ Unir-se a una classe</button>`;
  $("#create-class")?.addEventListener("click",openCreateClassModal);$("#join-class")?.addEventListener("click",openJoinClassModal);
}
function renderClasses(){
  const root=$("#classes-list");if(!root)return;
  if(!state.classes.length){root.innerHTML=`<div class="empty-state"><strong>No tens classes encara</strong><small>${state.user?.role==="professor"?"Crea la teva primera classe.":"Demana el codi al professor i uneix-te a una classe."}</small></div>`;return;}
  root.innerHTML=state.classes.map(classCard).join("");
  $$('[data-open-class]',root).forEach(b=>b.onclick=()=>openClassDetail(Number(b.dataset.openClass)));
}
async function openClassDetail(classId){
  try{
    const data=await api(`/api/classes/${classId}`);state.currentClass=data;
    $("#classes-list-view")?.classList.add("hidden");const root=$("#class-detail");root.classList.remove("hidden");
    const c=data.class; const teacher=!!data.can_manage;
    root.innerHTML=`<div class="classroom"><div class="classroom-cover"><div class="classroom-cover-content"><div class="eyebrow light">AULA DIGITAL</div><h1>${escapeHtml(c.name)}</h1><p>${escapeHtml(c.subject||"")} · ${escapeHtml(c.teacher||c.teacher_name||"—")}</p><span class="class-code">Codi <strong>${escapeHtml(c.code)}</strong> · ${Number(c.student_count||0)} alumnes</span></div></div><div class="classroom-tabs"><button class="classroom-tab active" data-class-tab="stream" type="button">Tauler</button><button class="classroom-tab" data-class-tab="work" type="button">Treball de classe</button><button class="classroom-tab" data-class-tab="people" type="button">Persones</button><button class="classroom-tab" data-class-tab="grades" type="button">Qualificacions</button></div><div id="classroom-content"></div></div>`;
    $$('[data-class-tab]',root).forEach(b=>b.onclick=()=>{ $$('[data-class-tab]',root).forEach(x=>x.classList.toggle("active",x===b));renderClassTab(b.dataset.classTab,data); });
    renderClassTab("stream",data);
  }catch(e){showError(e)}
}
function renderClassTab(tab,data){
  const root=$("#classroom-content");if(!root)return;const c=data.class;const content=data.content||[];
  if(tab==="stream"){
    const composer=data.can_manage?`<div class="class-post"><div class="post-head"><span class="post-avatar">${initials(state.user.name)}</span><div><strong>Publica a la classe</strong><small>Afegeix un avís, deures, examen o material.</small></div></div><button id="class-publish" class="btn btn-blue" style="margin-top:12px" type="button">+ Nova publicació</button></div>`:"";
    const posts=content.length?content.map(item=>`<article class="class-post"><div class="post-head"><span class="post-avatar">${initials(item.author_name||c.teacher||"P")}</span><div><strong>${escapeHtml(item.author_name||c.teacher||"Professor")}</strong><small>${escapeHtml(item.kind||"avis")} · ${fullDate(item.created_at)}</small></div></div><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.body||"")}</p>${item.event_date?`<div class="item-meta"><span>Data: ${fmtDate(item.event_date)}</span></div>`:""}</article>`).join(""): `<div class="empty-state"><strong>Encara no hi ha activitat</strong><small>Quan el professor publiqui alguna cosa, apareixerà aquí.</small></div>`;
    root.innerHTML=`<div class="classroom-body"><div class="stream">${composer}${posts}</div><aside class="classroom-info"><div class="info-card"><h3>Informació de la classe</h3><p><strong>Codi:</strong> ${escapeHtml(c.code)}</p><p><strong>Professor:</strong> ${escapeHtml(c.teacher||c.teacher_name||"—")}</p><p><strong>Alumnes:</strong> ${Number(c.student_count||0)}</p></div><div class="info-card"><h3>Proper</h3><p>${nextClassContent(content)}</p></div></aside></div>`;
    $("#class-publish")?.addEventListener("click",()=>openContentModal(c.id));
  } else if(tab==="work"){
    const work=content.filter(x=>["tasca","examen","material"].includes(x.kind));
    root.innerHTML=`<div class="stream">${work.length?work.map(item=>`<article class="work-card"><span class="work-icon">${item.kind==="examen"?"▣":item.kind==="material"?"▤":"✓"}</span><div><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.kind)} · ${item.event_date?`Data ${fmtDate(item.event_date)}`:"Sense data"}</small><p style="margin:5px 0 0;color:#80919b;font-size:9px">${escapeHtml(item.body||"")}</p></div></article>`).join(""): `<div class="empty-state"><strong>No hi ha treball de classe</strong><small>El contingut acadèmic publicat apareixerà aquí.</small></div>`}</div>`;
  } else if(tab==="people"){
    const students=data.students||[];root.innerHTML=`<div class="stream"><div class="panel" style="padding:15px"><div class="eyebrow">PROFESSOR</div><div class="person-row" style="margin-top:10px"><span class="avatar">${initials(c.teacher||"P")}</span><div><strong>${escapeHtml(c.teacher||c.teacher_name||"Professor")}</strong><small>Professor</small></div></div></div><div class="panel" style="padding:15px"><div class="eyebrow">ALUMNES · ${students.length || Number(c.student_count||0)}</div><div class="people-list" style="margin-top:10px">${students.length?students.map(s=>`<div class="person-row"><span class="avatar">${initials(s.name)}</span><div><strong>${escapeHtml(s.name)}</strong><small>${escapeHtml(s.email)}</small></div></div>`).join(""): `<div class="grade-empty">La llista d'alumnes només és visible al professor.</div>`}</div></div></div>`;
  } else {
    root.innerHTML=`<div class="grade-empty">Les qualificacions encara no formen part de les dades actuals de MiniClassroom.<br><small>La pestanya queda preparada per incorporar-les sense alterar l'estructura actual de Supabase.</small></div>`;
  }
}
function nextClassContent(content){const dates=content.filter(x=>x.event_date).sort((a,b)=>String(a.event_date).localeCompare(String(b.event_date)));return dates[0]?`${escapeHtml(dates[0].title)} · ${fmtDate(dates[0].event_date)}`:"No hi ha dates pròximes."}

/* CALENDAR */
function renderCalendar(){
  const root=$("#calendar-grid"), label=$("#calendar-month");if(!root)return;
  const now=new Date();const first=new Date(now.getFullYear(),now.getMonth()+state.calendarOffset,1);const last=new Date(first.getFullYear(),first.getMonth()+1,0);const start=(first.getDay()+6)%7;const days=last.getDate();
  label.textContent=new Intl.DateTimeFormat("ca-ES",{month:"long",year:"numeric"}).format(first);
  const cells=[];for(let i=0;i<start;i++)cells.push(`<div class="calendar-cell muted"></div>`);
  for(let day=1;day<=days;day++){const d=new Date(first.getFullYear(),first.getMonth(),day);const iso=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(day).padStart(2,"0")}`;const today=iso===new Date().toISOString().slice(0,10);const tasks=state.tasks.filter(t=>t.due_date===iso);const exams=state.exams.filter(e=>e.exam_date===iso);cells.push(`<div class="calendar-cell ${today?"today":""}"><div class="calendar-day">${day}</div>${tasks.map(t=>`<span class="calendar-event">✓ ${escapeHtml(t.name)}</span>`).join("")}${exams.map(e=>`<span class="calendar-event exam">▣ ${escapeHtml(e.subject)}</span>`).join("")}</div>`)}
  root.innerHTML=cells.join("");
}

/* PLANNER */
function renderPlanner(){
  const root=$("#week-grid"), sessions=$("#plan-sessions");if(!root)return;
  const base=new Date();base.setHours(0,0,0,0);base.setDate(base.getDate()-((base.getDay()+6)%7)+state.weekOffset*7);
  const days=[];for(let i=0;i<7;i++){const d=new Date(base);d.setDate(base.getDate()+i);days.push(d)}
  $("#planner-week-label").textContent=`${fmtDate(days[0].toISOString())} — ${fmtDate(days[6].toISOString())}`;
  root.innerHTML=days.map(d=>{const iso=d.toISOString().slice(0,10);const tasks=state.tasks.filter(t=>t.due_date===iso);const exams=state.exams.filter(e=>e.exam_date===iso);return `<div class="week-day"><div class="week-day-head"><small>${new Intl.DateTimeFormat("ca-ES",{weekday:"short"}).format(d)}</small><strong>${d.getDate()}</strong></div><div class="week-day-body">${tasks.map(t=>`<div class="plan-item"><strong>✓ ${escapeHtml(t.name)}</strong><small>${t.estimated_minutes||30} min</small></div>`).join("")}${exams.map(e=>`<div class="plan-item exam"><strong>▣ ${escapeHtml(e.subject)}</strong><small>Examen</small></div>`).join("")}</div></div>`}).join("");
  const all=[...state.tasks.filter(t=>t.status!=="completada").slice(0,5)];sessions.innerHTML=all.length?all.map(t=>`<div class="compact-row"><i class="compact-dot"></i><div><strong>${escapeHtml(t.name)}</strong><small>${t.estimated_minutes||30} min · ${fmtDate(t.due_date)}</small></div></div>`).join(""): `<div class="empty-state" style="margin:10px">No hi ha sessions proposades.</div>`;
}

/* AI */
function bindAI(){
  $$('[data-ai-mode]').forEach(b=>b.onclick=()=>setAiMode(b.dataset.aiMode));
  $$('[data-ai-tool]').forEach(b=>b.onclick=()=>{navigate("ai");setAiMode(b.dataset.aiTool)});
  $("#open-test")?.addEventListener("click",()=>{navigate("ai");openTestModal()});
  $("#open-reco-ai")?.addEventListener("click",()=>{navigate("dashboard");renderRecommendations()});
  $("#ai-form")?.addEventListener("submit",sendAI);
  $("#ai-input")?.addEventListener("keydown",e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();$("#ai-form").requestSubmit()}});
}
function setAiMode(mode){state.aiMode=mode;$$('[data-ai-mode]').forEach(b=>b.classList.toggle("active",b.dataset.aiMode===mode));if(mode==="TEST")openTestModal();else $("#ai-input")?.focus()}
function appendChat(role,text){const root=$("#ai-messages");if(!root)return;const el=document.createElement("div");el.className=`chat-bubble ${role}`;el.innerHTML=role==="user"?`<div><b>Tu</b><p>${escapeHtml(text)}</p></div>`:`<span>✦</span><div><b>MiniClassroom IA</b><p>${escapeHtml(text)}</p></div>`;root.appendChild(el);root.scrollTop=root.scrollHeight}
async function sendAI(e){e.preventDefault();const input=$("#ai-input");const message=input.value.trim();if(!message)return;appendChat("user",message);input.value="";try{const data=await api("/api/ai",{method:"POST",body:{mode:state.aiMode,message}});appendChat("ai",data.answer)}catch(err){appendChat("ai",err.message)}}
function openTestModal(){
  openModal("Crear un test",`<form id="test-form" class="form-grid full"><label>Tema<input name="topic" placeholder="Ex. derivades, Guerra Freda, cèl·lula..." required></label></form><div id="test-result" style="margin-top:15px"></div>`,async root=>{const topic=$("input[name=topic]",root).value.trim();const data=await api("/api/ai/test",{method:"POST",body:{topic}});renderTest(data,root); return false});
  // Change modal save button into generate button; the result can be graded inside modal.
  const submit=$("#modal-submit"); if(submit) submit.textContent="Generar test";
}
function renderTest(data,root){
  const questions=data.questions||[];const area=$("#test-result",root);if(!questions.length){area.innerHTML=`<div class="empty-state">No s'ha pogut generar el test.</div>`;return}
  area.innerHTML=`<div class="test-panel">${questions.map((q,i)=>`<div class="test-question" data-question="${i}"><strong>${i+1}. ${escapeHtml(q.question)}</strong><div class="test-options">${q.options.map((o,j)=>`<button type="button" class="test-option" data-answer="${j}">${String.fromCharCode(65+j)}. ${escapeHtml(o)}</button>`).join("")}</div></div>`).join("")}<button id="grade-test" class="btn btn-yellow" type="button">Corregir test</button><div id="test-score" style="margin-top:12px"></div></div>`;
  questions.forEach((q,i)=>$$(`[data-question="${i}"] .test-option`,area).forEach(b=>b.onclick=()=>{ $$(`[data-question="${i}"] .test-option`,area).forEach(x=>x.classList.remove("selected"));b.classList.add("selected")}));
  $("#grade-test",area).onclick=async()=>{let score=0;questions.forEach((q,i)=>{const selected=$(".selected",$(`[data-question="${i}"]`,area));const answer=Number(selected?.dataset.answer);if(answer===q.answer){score++;selected?.classList.add("correct")}else{selected?.classList.add("wrong");$$(`[data-question="${i}"] .test-option`,area)[q.answer]?.classList.add("correct")}});$("#test-score",area).innerHTML=`<strong>Resultat: ${score}/${questions.length}</strong>`;try{await api("/api/test-results",{method:"POST",body:{topic:data.topic,score,total:questions.length,subject:data.topic}});toast("Resultat guardat al teu progrés.",false,true)}catch(e){showError(e)}};
}

/* PROFILE */
function loadProfileFields(){if(!state.user)return;if($("#profile-name-input"))$("#profile-name-input").value=state.user.name||"";if($("#profile-email-input"))$("#profile-email-input").value=state.user.email||""}
function bindProfile(){
  $("#profile-form")?.addEventListener("submit",async e=>{e.preventDefault();try{const data=await api("/api/profile",{method:"PUT",body:Object.fromEntries(new FormData(e.currentTarget).entries())});setUser(data.user);toast("Perfil actualitzat.",false,true)}catch(err){showError(err)}})
}

/* GLOBAL UI */
function bindUI(){
  $("#logout-btn")?.addEventListener("click",async()=>{try{await api("/api/logout",{method:"POST"})}finally{location.reload()}});
  $("#mobile-menu")?.addEventListener("click",()=>$(".sidebar")?.classList.toggle("open"));
  $("#hero-tasks")?.addEventListener("click",()=>navigate("tasks"));
  $("#hero-ai")?.addEventListener("click",()=>navigate("ai"));
  $("#quick-ai")?.addEventListener("click",()=>navigate("ai"));
  if ($("#new-task")) {
    $("#new-task").type = "button";
    $("#new-task").onclick = (event) => {
      event.preventDefault();
      openTaskModal();
    };
  }
  if ($("#new-exam")) {
    $("#new-exam").type = "button";
    $("#new-exam").onclick = (event) => {
      event.preventDefault();
      openExamModal();
    };
  }
  $("#quick-add")?.addEventListener("click",()=>state.user?.role==="professor"?openCreateClassModal():openTaskModal());
  $("#recalc-ai")?.addEventListener("click",renderRecommendations);
  $("#calendar-prev")?.addEventListener("click",()=>{state.calendarOffset--;renderCalendar()});
  $("#calendar-next")?.addEventListener("click",()=>{state.calendarOffset++;renderCalendar()});
  $("#prev-week")?.addEventListener("click",()=>{state.weekOffset--;renderPlanner()});
  $("#next-week")?.addEventListener("click",()=>{state.weekOffset++;renderPlanner()});
  $("#generate-plan")?.addEventListener("click",()=>{navigate("planner");toast("El pla s'ha adaptat a les teves tasques i exàmens.",false,true);renderPlanner()});
  $("#add-session")?.addEventListener("click",()=>openStudySessionModal());
  $$("[data-task-filter]").forEach(b=>b.onclick=()=>{$$("[data-task-filter]").forEach(x=>x.classList.toggle("active",x===b));state.taskFilter=b.dataset.taskFilter;renderTasks()});
  $("#task-search")?.addEventListener("input",e=>{state.taskSearch=e.target.value;renderTasks()});
  $("#notification-btn")?.addEventListener("click",()=>toggleNotifications());
  $("#global-search")?.addEventListener("keydown",e=>{if(e.key==="Enter"){const q=e.target.value.trim().toLowerCase();if(!q)return;const t=state.tasks.find(x=>`${x.name} ${x.subject}`.toLowerCase().includes(q));if(t){navigate("tasks");state.taskSearch=q;$("#task-search").value=q;renderTasks()}else toast("No he trobat cap resultat local.")}});
}
function toggleNotifications(){const p=$("#notification-panel");if(!p)return;const urgent=state.tasks.filter(t=>t.status!=="completada"&&daysUntil(t.due_date)<=2);p.classList.toggle("hidden");p.innerHTML=`<strong style="font-size:11px">Notificacions</strong><p style="font-size:9px;color:#8fa0ad">${urgent.length?`Tens ${urgent.length} tasca/es properes.`:"No tens avisos urgents."}</p>`}
function openStudySessionModal(){openModal("Afegir sessió d'estudi",`<form id="study-form" class="form-grid"><label>Data<input name="session_date" type="date" value="${new Date().toISOString().slice(0,10)}"></label><label>Minuts planificats<input name="planned_minutes" type="number" min="0" value="30"></label><label>Minuts completats<input name="completed_minutes" type="number" min="0" value="0"></label><label style="grid-column:1/-1">Notes<textarea name="notes"></textarea></label></form>`,async root=>{const data=Object.fromEntries(new FormData($("#study-form",root)).entries());await api("/api/study-sessions",{method:"POST",body:data});toast("Sessió guardada.",false,true);renderPlanner()})}

async function loadProgress(){
  try{const data=await api("/api/progress");const p=Number(data.progress||0);if($("#progress-number"))$("#progress-number").textContent=`${p}%`;if($("#progress-ring"))$("#progress-ring").style.setProperty("--progress",p);if($("#progress-tasks"))$("#progress-tasks").textContent=`${data.completed_tasks||0} / ${data.total_tasks||0}`;if($("#progress-study"))$("#progress-study").textContent=`${data.study_minutes||0} min`;if($("#progress-tests"))$("#progress-tests").textContent=`${data.tests?.average||0}%`;if($("#progress-copy"))$("#progress-copy").textContent=p?`Has completat el ${p}% de les tasques.`:"Encara no hi ha prou dades.";renderChart(data.weekly||[]);const hist=await api("/api/tests/history");renderTestHistory(hist.results||[])}catch(e){showError(e)}
}
function renderChart(weekly){const root=$("#progress-chart");if(!root)return;const map=new Map(weekly.map(x=>[String(x.session_date).slice(0,10),Number(x.completed_minutes||0)]));const days=[];for(let i=6;i>=0;i--){const d=new Date();d.setDate(d.getDate()-i);days.push(d)}const max=Math.max(30,...days.map(d=>map.get(d.toISOString().slice(0,10))||0));root.innerHTML=days.map(d=>{const iso=d.toISOString().slice(0,10);const val=map.get(iso)||0;const h=Math.max(4,val/max*175);return `<div class="chart-bar" style="height:${h}px"><small>${d.toLocaleDateString("ca-ES",{weekday:"short"}).slice(0,2)}</small></div>`}).join("")}
function renderTestHistory(results){const root=$("#test-history");if(!root)return;root.innerHTML=results.length?results.slice(0,8).map(r=>`<div class="compact-row"><i class="compact-dot"></i><div><strong>${escapeHtml(r.subject||"Test")}</strong><small>${fmtDate(r.created_at)} · ${r.score}/${r.total}</small></div></div>`).join(""): `<div class="empty-state" style="margin:10px">Encara no has fet cap test.</div>`}

async function refreshData(){const data=await api("/api/dashboard");state.tasks=data.tasks||[];state.exams=data.exams||[];state.classes=data.classes||[];renderDashboardClasses();renderAgenda();renderDueList();renderRecommendations();if(state.section==="tasks")renderTasks();if(state.section==="exams")renderExams();if(state.section==="calendar")renderCalendar();if(state.section==="planner")renderPlanner()}

async function boot(){
  try{
    const data=await api("/api/me");
    if(data.user){setUser(data.user);$("#auth-view")?.classList.add("hidden");$("#app-view")?.classList.remove("hidden");await loadDashboard();navigate("dashboard");}
    else {throw new Error("not-authenticated")}
  }catch(e){
    if(e.message!=="not-authenticated" && !String(e.message).includes("sessió")){
      // If the DB is unavailable, keep the login visible and show a useful message.
      if($("#auth-message")) $("#auth-message").textContent="La base de dades no està disponible ara mateix.";
    }
    $("#app-view")?.classList.add("hidden");$("#auth-view")?.classList.remove("hidden");
  }finally{document.body.classList.remove("app-booting")}
}

try { bindNavigation(); } catch (error) { console.error("Navegació:", error); }
try { bindAuth(); } catch (error) { console.error("Autenticació:", error); }
try { bindUI(); } catch (error) { console.error("Interfície:", error); }
try { bindAI(); } catch (error) { console.error("IA:", error); }
try { bindProfile(); } catch (error) { console.error("Perfil:", error); }

// Reforç final dels botons principals.
$$('[data-section]').forEach((element) => {
  element.type = element.tagName === 'BUTTON' ? 'button' : element.type;
  element.onclick = (event) => {
    event.preventDefault();
    event.stopPropagation();
    navigate(element.dataset.section);
  };
});

boot();
