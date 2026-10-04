const $ = (s, p = document) => p.querySelector(s);
const $$ = (s, p = document) => [...p.querySelectorAll(s)];

const state = {
  user: null,
  dashboard: null,
  tasks: [],
  exams: [],
  classes: [],
  section: "dashboard",
  taskFilter: "totes",
  taskSearch: "",
  aiMode: "DUBTE",
  weekOffset: 0,
  calendarOffset: 0
};

const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (m) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    }[m])
  );

const api = async (url, opts = {}) => {
  const headers = { ...(opts.headers || {}) };
  if (!(opts.body instanceof FormData) && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(url, {
    credentials: "same-origin",
    ...opts,
    headers
  });

  let data = {};

  try {
    data = await response.json();
  } catch {}

  if (!response.ok) {
    throw new Error(
      data.error || "No s'ha pogut completar l'operació."
    );
  }

  return data;
};

const toast = (message, error = false) => {
  const root = $("#toast-root");

  if (!root) return;

  const element = document.createElement("div");

  element.className =
    "toast" + (error ? " error" : "");

  element.textContent = message;

  root.appendChild(element);

  setTimeout(() => element.remove(), 3200);
};

const initials = (name) =>
  (name || "M").trim().slice(0, 1).toUpperCase();

// MiniClassroom utilitza "teacher" a la base de dades.
// També acceptem "professor" per compatibilitat amb versions anteriors.
const isTeacherRole = (role) =>
  ["teacher", "professor"].includes(
    String(role || "").trim().toLowerCase()
  );

const isTeacher = () =>
  isTeacherRole(state.user?.role);

const fmtDate = (value) => {
  if (!value) return "Sense data";

  const date = new Date(
    String(value).includes("T")
      ? value
      : value + "T12:00:00"
  );

  if (isNaN(date)) return "Sense data";

  return date.toLocaleDateString("ca-ES", {
    day: "numeric",
    month: "short"
  });
};

const fullDate = (value) => {
  if (!value) return "—";

  const date = new Date(
    value + "T12:00:00"
  );

  if (isNaN(date)) return "—";

  return date.toLocaleDateString("ca-ES", {
    weekday: "long",
    day: "numeric",
    month: "long"
  });
};

const daysUntil = (value) => {
  if (!value) return 999;

  const today = new Date();

  today.setHours(0, 0, 0, 0);

  const target = new Date(
    value + "T00:00:00"
  );

  return Math.ceil(
    (target - today) / 86400000
  );
};

function showToastFromError(error) {
  toast(
    error?.message ||
      "S'ha produït un error.",
    true
  );
}


/* ============================================================
   NAVEGACIÓ
============================================================ */

function navigate(section) {
  state.section = section;

  $$(".section").forEach((element) => {
    element.classList.toggle(
      "active",
      element.id === "section-" + section
    );
  });

  $$(".nav-item").forEach((element) => {
    element.classList.toggle(
      "active",
      element.dataset.section === section
    );
  });

  const names = {
    dashboard: ["Tauler", "Avui"],
    tasks: ["Tasques", "Organització"],
    exams: ["Exàmens", "Preparació"],
    planner: ["Planificador", "Ritme"],
    classes: ["Classes", "Aula"],
    ai: ["IA d'estudi", "Assistent"],
    progress: ["Progrés", "Evolució"],
    profile: ["Perfil", "Compte"]
  };

  if ($("#top-context")) {
    $("#top-context").textContent =
      names[section]?.[0] ||
      "MiniClassroom";
  }

  if ($("#top-title")) {
    $("#top-title").textContent =
      names[section]?.[1] || "";
  }

  if (section === "tasks") {
    renderTasks();
  }

  if (section === "exams") {
    renderExams();
  }

  if (section === "classes") {
    loadClasses();
  }

  if (section === "planner") {
    renderPlanner();
  }

  if (section === "progress") {
    loadProgress();
  }

  if (section === "calendar") {
    renderCalendar();
  }

  window.scrollTo({
    top: 0,
    behavior: "smooth"
  });
}

function bindNav() {
  $$("[data-section]").forEach((button) => {
    button.addEventListener(
      "click",
      () => navigate(button.dataset.section)
    );
  });
}


/* ============================================================
   USUARI
============================================================ */

function setUser(user) {
  state.user = {
    ...user,
    role: isTeacherRole(user?.role)
      ? "teacher"
      : "alumne"
  };

  user = state.user;

  const name =
    user.name ||
    user.username ||
    "Alumne";

  if ($("#side-name"))
    $("#side-name").textContent = name;

  if ($("#top-name"))
    $("#top-name").textContent = name;

  if ($("#side-avatar"))
    $("#side-avatar").textContent =
      initials(name);

  if ($("#top-avatar"))
    $("#top-avatar").textContent =
      initials(name);

  if ($("#profile-name"))
    $("#profile-name").textContent = name;

  if ($("#profile-email"))
    $("#profile-email").textContent =
      user.email || "";

  if ($("#profile-email-readonly"))
    $("#profile-email-readonly").textContent =
      user.email || "—";

  if ($("#profile-name-input"))
    $("#profile-name-input").value = name;

  if ($("#profile-role"))
    $("#profile-role").textContent =
      isTeacherRole(user.role)
        ? "Professor"
        : "Alumne";

  if ($("#top-role"))
    $("#top-role").textContent =
      isTeacherRole(user.role)
        ? "Professor"
        : "Alumne";

  if ($("#profile-avatar"))
    $("#profile-avatar").textContent =
      initials(name);

  if ($("#greeting")) {
    $("#greeting").innerHTML =
      isTeacherRole(user.role)
        ? "La teva aula,<br><span>organitzada i al teu ritme.</span>"
        : "El teu estudi,<br><span>clar i al teu ritme.</span>";
  }

  if ($("#side-role")) {
    $("#side-role").textContent =
      isTeacherRole(user.role)
        ? "Professor"
        : "Alumne";
  }

  if (isTeacherRole(user.role)) {
    $$(
      ".nav-item[data-section='tasks'], " +
      ".nav-item[data-section='exams'], " +
      ".nav-item[data-section='planner'], " +
      ".nav-item[data-section='ai'], " +
      ".nav-item[data-section='progress']"
    ).forEach((element) => {
      element.classList.add("hidden");
    });

    if ($("#recalc-ai")) {
      $("#recalc-ai").classList.add("hidden");
    }
  }
}


/* ============================================================
   INICI
============================================================ */

async function boot() {
  document.body.classList.add(
    "app-booting"
  );

  try {
    const data = await api("/api/me");

    if (data.user) {
      $("#auth-view")?.classList.add(
        "hidden"
      );

      $("#app-view")?.classList.remove(
        "hidden"
      );

      setUser(data.user);

      /*
       * Mostrem l'aplicació abans de carregar
       * totes les dades secundàries.
       * Això evita el retard visual.
       */
      document.body.classList.remove(
        "app-booting"
      );

      await loadDashboard();

      return;
    }
  } catch {}

  $("#auth-view")?.classList.remove(
    "hidden"
  );

  $("#app-view")?.classList.add(
    "hidden"
  );

  document.body.classList.remove(
    "app-booting"
  );
}


/* ============================================================
   DASHBOARD
============================================================ */

async function loadDashboard() {
  try {
    const data =
      await api("/api/dashboard");

    state.dashboard = data;

    state.tasks =
      data.tasks || [];

    state.exams =
      data.exams || [];

    state.classes =
      data.classes || [];

    if ($("#stat-pending"))
      $("#stat-pending").textContent =
        data.pending_count || 0;

    if ($("#stat-urgent"))
      $("#stat-urgent").textContent =
        data.urgent_count || 0;

    if ($("#stat-progress"))
      $("#stat-progress").textContent =
        (data.progress || 0) + "%";

    const completed =
      state.tasks.filter(
        (task) =>
          task.status ===
          "completada"
      ).length;

    if ($("#stat-completed")) {
      $("#stat-completed").textContent =
        `${completed} completades`;
    }

    if ($("#stat-exams")) {
      $("#stat-exams").textContent =
        state.exams.filter(
          (exam) =>
            daysUntil(
              exam.exam_date
            ) >= 0
        ).length;
    }

    const completedMinutes =
      data.study?.completed_minutes ??
      data.study_minutes ??
      0;

    const plannedMinutes =
      data.study?.planned_minutes ??
      data.planned_minutes ??
      0;

    if ($("#stat-study")) {
      $("#stat-study").textContent =
        `${completedMinutes} / ${plannedMinutes} min`;
    }

    renderDashboardLists();
    renderDashboardClasses();
    renderDashboardSide();

    renderTomorrow();

    /*
     * La recomanació d'IA es carrega
     * després de pintar la pantalla.
     */
    setTimeout(
      () => renderRecommendations(false),
      50
    );

  } catch (error) {
    showToastFromError(error);
  }
}

function renderDashboardLists() {
  const pending =
    state.tasks
      .filter(
        (task) =>
          task.status !==
          "completada"
      )
      .slice(0, 4);

  const taskBox =
    $("#dashboard-tasks");

  if (taskBox) {
    taskBox.innerHTML =
      pending.length
        ? pending
            .map(
              (task) => `
                <div
                  class="mini-list-item"
                  style="
                    display:flex;
                    justify-content:space-between;
                    gap:10px;
                    padding:10px 0;
                    border-bottom:1px solid #1a1d23
                  "
                >
                  <div>
                    <b style="font-size:10px">
                      ${esc(task.name)}
                    </b>

                    <small
                      style="
                        display:block;
                        color:#777c87;
                        font-size:9px;
                        margin-top:3px
                      "
                    >
                      ${esc(task.subject || "")}
                      ·
                      ${fmtDate(task.due_date)}
                    </small>
                  </div>

                  <span class="pill">
                    ${esc(task.status)}
                  </span>
                </div>
              `
            )
            .join("")
        : `
          <div class="empty-state">
            <span>✓</span>
            <b>No tens tasques pendents.</b>
            <small>
              Quan n'afegeixis,
              MiniClassroom t'ajudarà
              a ordenar-les.
            </small>
          </div>
        `;
  }

  const exams =
    state.exams
      .filter(
        (exam) =>
          daysUntil(
            exam.exam_date
          ) >= 0
      )
      .slice(0, 3);

  const examBox =
    $("#dashboard-exams");

  if (examBox) {
    examBox.innerHTML =
      exams.length
        ? exams
            .map(
              (exam) => `
                <div
                  style="
                    padding:11px 0;
                    border-bottom:1px solid #1a1d23
                  "
                >
                  <b style="font-size:10px">
                    ${esc(exam.subject)}
                  </b>

                  <small
                    style="
                      display:block;
                      color:#8d91a0;
                      font-size:9px;
                      margin-top:3px
                    "
                  >
                    ${fullDate(exam.exam_date)}
                    ·
                    ${Math.max(
                      0,
                      daysUntil(
                        exam.exam_date
                      )
                    )}
                    dies
                  </small>
                </div>
              `
            )
            .join("")
        : `
          <div class="empty-state">
            <span>□</span>
            <b>No hi ha exàmens.</b>
            <small>
              Afegeix-ne un per començar
              a preparar-lo.
            </small>
          </div>
        `;
  }
}

function renderDashboardSide() {
  const due = $("#due-list");
  if (due) {
    const upcoming = (state.tasks || [])
      .filter((task) => task.status !== "completada" && task.due_date)
      .sort((a,b) => String(a.due_date).localeCompare(String(b.due_date)))
      .slice(0, 4);
    due.innerHTML = upcoming.length ? upcoming.map((task) => `
      <div class="compact-item">
        <div><b>${esc(task.name)}</b><small>${esc(task.subject || "")}</small></div>
        <span>${fmtDate(task.due_date)}</span>
      </div>
    `).join("") : `<p class="muted">No tens entregues pendents.</p>`;
  }

  const agenda = $("#agenda-list");
  if (agenda) {
    const items = [
      ...(state.tasks || []).filter((x) => x.due_date).map((x) => ({date:x.due_date,title:x.name,type:"Tasca"})),
      ...(state.exams || []).filter((x) => x.exam_date).map((x) => ({date:x.exam_date,title:`Examen · ${x.subject}`,type:"Examen"}))
    ].sort((a,b) => String(a.date).localeCompare(String(b.date))).slice(0,4);
    agenda.innerHTML = items.length ? items.map((item) => `
      <div class="compact-item"><div><b>${esc(item.title)}</b><small>${esc(item.type)}</small></div><span>${fmtDate(item.date)}</span></div>
    `).join("") : `<p class="muted">No hi ha dates properes.</p>`;
  }
}


function renderDashboardClasses() {
  const box = $("#dashboard-classes");
  if (!box) return;

  const classes = state.classes || [];
  if (!classes.length) {
    box.innerHTML = `<div class="empty-state"><span>▦</span><b>Encara no tens classes.</b><small>Quan t'uneixis a una classe, apareixerà aquí.</small></div>`;
    return;
  }

  box.innerHTML = classes.slice(0, 3).map((classroom) => `
    <article class="class-card card">
      <p class="eyebrow">CLASSE</p>
      <h3>${esc(classroom.name)}</h3>
      <span class="class-code">${esc(classroom.code || "")}</span>
      <div class="class-meta">
        <span>${esc(classroom.teacher_name || classroom.teacher || "Professor")}</span>
        <span>${classroom.student_count || 0} alumnes</span>
      </div>
      <button class="btn secondary" type="button" data-dashboard-class="${classroom.id}">Entrar a la classe →</button>
    </article>
  `).join("");

  $$('[data-dashboard-class]').forEach((button) => {
    button.onclick = async () => {
      navigate("classes");
      await loadClasses();
      await openClassDetail(button.dataset.dashboardClass);
    };
  });
}


function renderTomorrow() {
  const tomorrow =
    new Date();

  tomorrow.setDate(
    tomorrow.getDate() + 1
  );

  const label =
    tomorrow.toLocaleDateString(
      "ca-ES",
      {
        weekday: "long",
        day: "numeric",
        month: "long"
      }
    );

  if ($("#tomorrow-label")) {
    $("#tomorrow-label").textContent =
      label;
  }

  const iso =
    tomorrow
      .toISOString()
      .slice(0, 10);

  const tasks =
    state.tasks.filter(
      (task) =>
        task.due_date === iso
    );

  const exams =
    state.exams.filter(
      (exam) =>
        exam.exam_date === iso
    );

  const box =
    $("#tomorrow-content");

  if (!box) return;

  if (tasks.length || exams.length) {
    box.innerHTML = `
      <span class="calendar-icon">!</span>

      <div>
        <strong>
          ${tasks.length + exams.length}
          element${tasks.length + exams.length === 1 ? "" : "s"}
          per demà.
        </strong>

        <small>
          ${
            [
              ...tasks.map(
                (task) => task.name
              ),
              ...exams.map(
                (exam) =>
                  "Examen de " +
                  exam.subject
              )
            ]
              .slice(0, 3)
              .map(esc)
              .join(" · ")
          }
        </small>
      </div>
    `;
  }
}


/* ============================================================
   IA
============================================================ */

async function renderRecommendations(
  force = true
) {
  if (
    isTeacher()
  ) {
    return;
  }

  try {
    const data =
      await api(
        "/api/ai/recommendations"
      );

    const recommendation =
      data.recommendations?.[0];

    if ($("#recommendations-list")) {
      $("#recommendations-list").innerHTML =
        recommendation
          ? `
            <span class="reco-orb">
              ✦
            </span>

            <div>
              <strong>
                Prioritza
                —
                ${esc(recommendation.title || "Tasca") }
              </strong>

              <small>
                ${esc(
                  recommendation.reason
                )}
              </small>
            </div>
          `
          : `
            <span class="reco-orb">
              ✓
            </span>

            <div>
              <strong>
                No tens res urgent.
              </strong>

              <small>
                Continua amb una sessió curta
                de repàs per mantenir el ritme.
              </small>
            </div>
          `;
    }

    if (force) {
      toast(
        "Prioritats actualitzades amb IA."
      );
    }

  } catch (error) {
    if (force) {
      showToastFromError(error);
    }
  }
}


/* ============================================================
   TASQUES
============================================================ */

function renderTasks() {
  let list =
    state.tasks.filter(
      (task) =>
        state.taskFilter === "totes" ||
        task.status ===
          state.taskFilter
    );

  if (state.taskSearch) {
    list = list.filter(
      (task) =>
        (
          task.name +
          " " +
          (task.subject || "")
        )
          .toLowerCase()
          .includes(
            state.taskSearch
              .toLowerCase()
          )
    );
  }

  const box =
    $("#tasks-list");

  if (!box) return;

  if (!list.length) {
    box.innerHTML = `
      <div
        class="card empty-state"
        style="min-height:260px"
      >
        <span>✓</span>
        <b>
          No hi ha tasques en aquesta vista.
        </b>
        <small>
          Afegir una tasca et permetrà
          començar a planificar millor.
        </small>
      </div>
    `;

    return;
  }

  box.innerHTML =
    list
      .map((task) => {
        const done =
          task.status ===
          "completada";

        return `
          <div class="task-row">

            <button
              class="check ${done ? "done" : ""}"
              data-complete="${task.id}"
              title="Completar"
            >
              ${done ? "✓" : ""}
            </button>

            <div class="task-main">
              <b>
                ${esc(task.name)}
              </b>

              <small>
                ${esc(
                  task.description ||
                  "Sense descripció"
                )}
              </small>
            </div>

            <div class="task-subject">
              ${esc(
                task.subject || ""
              )}
            </div>

            <div class="task-meta">
              <small>
                ${fmtDate(
                  task.due_date
                )}
              </small>

              <small>
                ${task.estimated_minutes || 30}
                min
              </small>
            </div>

            <select
              class="status-select"
              data-status="${task.id}"
            >
              <option
                value="pendent"
                ${task.status === "pendent" ? "selected" : ""}
              >
                Pendent
              </option>

              <option
                value="en procés"
                ${task.status === "en procés" ? "selected" : ""}
              >
                En procés
              </option>

              <option
                value="completada"
                ${done ? "selected" : ""}
              >
                Completada
              </option>
            </select>

            <div class="row-actions">
              <button
                data-edit="${task.id}"
              >
                ✎
              </button>

              <button
                data-delete="${task.id}"
              >
                ×
              </button>
            </div>

          </div>
        `;
      })
      .join("");

  $$("[data-complete]").forEach(
    (button) => {
      button.onclick = async () => {
        try {
          await api(
            `/api/tasks/${button.dataset.complete}`,
            {
              method: "PATCH",
              body: JSON.stringify({
                status:
                  "completada"
              })
            }
          );

          await loadDashboard();

          renderTasks();

          toast(
            "Tasca completada."
          );

        } catch (error) {
          showToastFromError(error);
        }
      };
    }
  );

  $$("[data-status]").forEach(
    (select) => {
      select.onchange = async () => {
        try {
          await api(
            `/api/tasks/${select.dataset.status}`,
            {
              method: "PATCH",
              body: JSON.stringify({
                status:
                  select.value
              })
            }
          );

          await loadDashboard();

          renderTasks();

        } catch (error) {
          showToastFromError(error);
        }
      };
    }
  );

  $$("[data-delete]").forEach(
    (button) => {
      button.onclick = async () => {
        if (
          !confirm(
            "Vols eliminar aquesta tasca?"
          )
        ) {
          return;
        }

        try {
          await api(
            `/api/tasks/${button.dataset.delete}`,
            {
              method: "DELETE"
            }
          );

          await loadDashboard();

          renderTasks();

          toast(
            "Tasca eliminada."
          );

        } catch (error) {
          showToastFromError(error);
        }
      };
    }
  );

  $$("[data-edit]").forEach(
    (button) => {
      button.onclick = () =>
        openTaskModal(
          state.tasks.find(
            (task) =>
              String(task.id) ===
              button.dataset.edit
          )
        );
    }
  );
}

function openTaskModal(task = null) {
  const root =
    $("#modal-root");

  root.innerHTML = `
    <div class="modal-backdrop">

      <div class="modal">

        <div class="modal-head">
          <h3>
            ${task ? "Editar tasca" : "Nova tasca"}
          </h3>

          <button
            class="close"
            data-close
          >
            ×
          </button>
        </div>

        <form
          id="task-form"
          class="form-grid two"
        >

          <label>
            Nom
            <input
              name="name"
              required
              value="${esc(
                task?.name || ""
              )}"
            >
          </label>

          <label>
            Assignatura
            <input
              name="subject"
              required
              value="${esc(
                task?.subject || ""
              )}"
            >
          </label>

          <label>
            Data d'entrega
            <input
              type="date"
              name="due_date"
              value="${esc(
                task?.due_date || ""
              )}"
            >
          </label>

          <label>
            Temps estimat (min)
            <input
              type="number"
              min="5"
              max="1440"
              name="estimated_minutes"
              value="${task?.estimated_minutes || 30}"
            >
          </label>

          <label>
            Dificultat

            <select name="difficulty">
              <option
                value="baixa"
                ${task?.difficulty === "baixa" ? "selected" : ""}
              >
                Baixa
              </option>

              <option
                value="mitjana"
                ${!task || task?.difficulty === "mitjana" ? "selected" : ""}
              >
                Mitjana
              </option>

              <option
                value="alta"
                ${task?.difficulty === "alta" ? "selected" : ""}
              >
                Alta
              </option>
            </select>
          </label>

          <label>
            Estat

            <select name="status">
              <option
                value="pendent"
                ${!task || task?.status === "pendent" ? "selected" : ""}
              >
                Pendent
              </option>

              <option
                value="en procés"
                ${task?.status === "en procés" ? "selected" : ""}
              >
                En procés
              </option>

              <option
                value="completada"
                ${task?.status === "completada" ? "selected" : ""}
              >
                Completada
              </option>
            </select>
          </label>

          <label
            style="grid-column:1/-1"
          >
            Descripció

            <textarea
              name="description"
              placeholder="Què has de fer?"
            >${esc(
              task?.description || ""
            )}</textarea>
          </label>

          <div
            class="modal-actions"
            style="grid-column:1/-1"
          >

            <button
              type="button"
              class="btn"
              data-close
            >
              Cancel·lar
            </button>

            <button
              class="btn primary"
            >
              Guardar tasca
            </button>

          </div>

        </form>

      </div>

    </div>
  `;

  $$("[data-close]", root)
    .forEach(
      (button) => {
        button.onclick =
          () =>
            root.innerHTML = "";
      }
    );

  $("#task-form").onsubmit =
    async (event) => {
      event.preventDefault();

      const data =
        Object.fromEntries(
          new FormData(
            event.target
          ).entries()
        );

      data.estimated_minutes =
        Number(
          data.estimated_minutes
        );

      try {
        if (task) {
          await api(
            `/api/tasks/${task.id}`,
            {
              method: "PATCH",
              body: JSON.stringify(
                data
              )
            }
          );
        } else {
          await api(
            "/api/tasks",
            {
              method: "POST",
              body: JSON.stringify(
                data
              )
            }
          );
        }

        root.innerHTML = "";

        await loadDashboard();

        renderTasks();

        toast(
          task
            ? "Tasca actualitzada."
            : "Tasca creada."
        );

      } catch (error) {
        showToastFromError(error);
      }
    };
}


/* ============================================================
   EXÀMENS
============================================================ */

function renderExams() {
  const box =
    $("#exams-list");

  if (!box) return;

  if (!state.exams.length) {
    box.innerHTML = `
      <div
        class="card empty-state"
        style="
          grid-column:1/-1;
          min-height:260px
        "
      >
        <span>□</span>
        <b>
          Encara no tens exàmens.
        </b>
        <small>
          Afegeix la primera data
          i prepara-la amb temps.
        </small>
      </div>
    `;

    return;
  }

  box.innerHTML =
    state.exams
      .map((exam) => {
        const days =
          daysUntil(
            exam.exam_date
          );

        return `
          <div
            class="exam-card card ${
              days <= 3
                ? "urgent"
                : ""
            }"
          >

            <div class="exam-accent"></div>

            <p class="eyebrow">
              ${esc(exam.subject)}
            </p>

            <h3>
              ${fullDate(
                exam.exam_date
              )}
            </h3>

            <div class="exam-date">
              ${
                days < 0
                  ? "Passat"
                  : days === 0
                    ? "Avui"
                    : days === 1
                      ? "Demà"
                      : `D'aquí a ${days} dies`
              }
            </div>

            <div class="exam-days">
              ${Math.max(0, days)}
              <span
                style="
                  font-size:11px;
                  color:#6f7480
                "
              >
                dies
              </span>
            </div>

            <small>
              ${esc(
                exam.syllabus ||
                "Sense temari indicat"
              )}

              <br>

              Dificultat:
              ${esc(
                exam.difficulty ||
                "mitjana"
              )}
              ·
              ${exam.study_minutes || 0}
              min de preparació
            </small>

            <div class="exam-actions">
              <button
                class="delete-link"
                data-exam-delete="${exam.id}"
              >
                Eliminar
              </button>
            </div>

          </div>
        `;
      })
      .join("");

  $$("[data-exam-delete]")
    .forEach(
      (button) => {
        button.onclick =
          async () => {
            if (
              !confirm(
                "Vols eliminar aquest examen?"
              )
            ) {
              return;
            }

            try {
              await api(
                `/api/exams/${button.dataset.examDelete}`,
                {
                  method: "DELETE"
                }
              );

              await loadDashboard();

              renderExams();

              toast(
                "Examen eliminat."
              );

            } catch (error) {
              showToastFromError(
                error
              );
            }
          };
      }
    );
}

function openExamModal() {
  const root =
    $("#modal-root");

  root.innerHTML = `
    <div class="modal-backdrop">

      <div class="modal">

        <div class="modal-head">
          <h3>Nou examen</h3>

          <button
            class="close"
            data-close
          >
            ×
          </button>
        </div>

        <form
          id="exam-form"
          class="form-grid two"
        >

          <label>
            Assignatura
            <input
              name="subject"
              required
            >
          </label>

          <label>
            Data
            <input
              name="exam_date"
              type="date"
              required
            >
          </label>

          <label>
            Dificultat

            <select name="difficulty">

              <option value="baixa">
                Baixa
              </option>

              <option
                value="mitjana"
                selected
              >
                Mitjana
              </option>

              <option value="alta">
                Alta
              </option>

            </select>
          </label>

          <label>
            Temps de preparació (min)

            <input
              type="number"
              name="study_minutes"
              value="120"
              min="15"
            >
          </label>

          <label
            style="grid-column:1/-1"
          >
            Temari

            <textarea
              name="syllabus"
              placeholder="Capítols, conceptes, exercicis..."
            ></textarea>
          </label>

          <div
            class="modal-actions"
            style="grid-column:1/-1"
          >

            <button
              type="button"
              class="btn"
              data-close
            >
              Cancel·lar
            </button>

            <button
              class="btn primary"
            >
              Afegir examen
            </button>

          </div>

        </form>

      </div>

    </div>
  `;

  $$("[data-close]", root)
    .forEach(
      (button) => {
        button.onclick =
          () =>
            root.innerHTML = "";
      }
    );

  $("#exam-form").onsubmit =
    async (event) => {
      event.preventDefault();

      const data =
        Object.fromEntries(
          new FormData(
            event.target
          ).entries()
        );

      data.study_minutes =
        Number(
          data.study_minutes
        );

      try {
        await api(
          "/api/exams",
          {
            method: "POST",
            body: JSON.stringify(
              data
            )
          }
        );

        root.innerHTML = "";

        await loadDashboard();

        renderExams();

        toast(
          "Examen afegit."
        );

      } catch (error) {
        showToastFromError(error);
      }
    };
}


/* ============================================================
   CLASSES
============================================================ */

async function loadClasses() {
  try {
    const data =
      await api("/api/classes");

    state.classes =
      data.classes || [];

    renderClasses();

  } catch (error) {
    showToastFromError(error);
  }
}

function renderClasses() {
  const actions =
    $("#class-actions");

  if (!actions) return;

  if (
    isTeacher()
  ) {
    actions.innerHTML = `
      <button
        class="btn primary"
        id="new-class"
      >
        ＋ Crear classe
      </button>
    `;
  } else {
    actions.innerHTML = `
      <button
        class="btn primary"
        id="join-class"
      >
        ＋ Unir-me amb un codi
      </button>
    `;
  }

  if (
    isTeacher()
  ) {
    $("#new-class").onclick =
      () => openClassCreate();
  } else {
    $("#join-class").onclick =
      () => openJoinModal();
  }

  const box =
    $("#classes-list");

  const detail =
    $("#class-detail");

  detail?.classList.add(
    "hidden"
  );

  box?.classList.remove(
    "hidden"
  );

  if (!state.classes.length) {
    box.innerHTML = `
      <div
        class="card empty-state"
        style="
          grid-column:1/-1;
          min-height:260px
        "
      >
        <span>⌘</span>

        <b>
          Encara no tens classes.
        </b>

        <small>
          ${
            isTeacher()
              ? "Crea la primera classe i comparteix el codi."
              : "Demana el codi de 6 caràcters al teu professor."
          }
        </small>
      </div>
    `;

    return;
  }

  box.innerHTML =
    state.classes
      .map(
        (classroom) => `
          <div class="class-card card">

            <p class="eyebrow">
              ${
                classroom.membership ===
                "professor"
                  ? "LA TEVA CLASSE"
                  : "CLASSE"
              }
            </p>

            <h3>
              ${esc(
                classroom.name
              )}
            </h3>

            <span class="class-code">
              ${esc(
                classroom.code
              )}
            </span>

            <div class="class-meta">

              <span>
                ${
                  classroom.membership ===
                  "professor"
                    ? "Tu ets el professor"
                    : "Professor: " +
                      esc(
                        classroom.teacher_name ||
                        classroom.teacher ||
                        "Professor"
                      )
                }
              </span>

              <span>
                ${
                  classroom.student_count ||
                  0
                }
                alumnes
              </span>

            </div>

            <button
              class="btn secondary"
              data-open-class="${classroom.id}"
            >
              Entrar a la classe →
            </button>

          </div>
        `
      )
      .join("");

  $$("[data-open-class]")
    .forEach(
      (button) => {
        button.onclick = () =>
          openClassDetail(
            button.dataset.openClass
          );
      }
    );
}


/* ============================================================
   CREAR CLASSE
============================================================ */

function openClassCreate() {
  const root =
    $("#modal-root");

  root.innerHTML = `
    <div class="modal-backdrop">

      <div class="modal">

        <div class="modal-head">
          <h3>
            Crear una classe
          </h3>

          <button
            class="close"
            data-close
          >
            ×
          </button>
        </div>

        <form
          id="class-form"
          class="form-grid"
        >

          <label>
            Nom de la classe

            <input
              name="name"
              placeholder="2n Batx · Física"
              required
            >
          </label>

          <p
            class="muted"
            style="font-size:9px"
          >
            Generarem automàticament
            un codi únic de 6 caràcters.
          </p>

          <div class="modal-actions">

            <button
              type="button"
              class="btn"
              data-close
            >
              Cancel·lar
            </button>

            <button
              class="btn primary"
            >
              Crear classe
            </button>

          </div>

        </form>

      </div>

    </div>
  `;

  $$("[data-close]", root)
    .forEach(
      (button) => {
        button.onclick =
          () =>
            root.innerHTML = "";
      }
    );

  $("#class-form").onsubmit =
    async (event) => {
      event.preventDefault();

      try {
        const data =
          await api(
            "/api/classes",
            {
              method: "POST",
              body: JSON.stringify(
                Object.fromEntries(
                  new FormData(
                    event.target
                  ).entries()
                )
              )
            }
          );

        root.innerHTML = "";

        await loadClasses();

        toast(
          `Classe creada · codi ${
            data.class?.code ||
            data.code ||
            ""
          }`
        );

      } catch (error) {
        showToastFromError(error);
      }
    };
}


/* ============================================================
   UNIR-SE A UNA CLASSE
============================================================ */

function openJoinModal() {
  const root =
    $("#modal-root");

  root.innerHTML = `
    <div class="modal-backdrop">

      <div class="modal">

        <div class="modal-head">

          <h3>
            Unir-me a una classe
          </h3>

          <button
            class="close"
            data-close
          >
            ×
          </button>

        </div>

        <form
          id="join-form"
          class="form-grid"
        >

          <label>
            Codi de la classe

            <input
              name="code"
              maxlength="6"
              style="
                text-transform:uppercase;
                font:700 18px monospace;
                letter-spacing:.16em;
                text-align:center
              "
              placeholder="Q4R62Q"
              required
            >
          </label>

          <p
            class="muted"
            style="font-size:9px"
          >
            El codi ha de tenir
            exactament 6 lletres o números.
          </p>

          <div class="modal-actions">

            <button
              type="button"
              class="btn"
              data-close
            >
              Cancel·lar
            </button>

            <button
              class="btn primary"
            >
              Unir-me
            </button>

          </div>

        </form>

      </div>

    </div>
  `;

  $$("[data-close]", root)
    .forEach(
      (button) => {
        button.onclick =
          () =>
            root.innerHTML = "";
      }
    );

  $("#join-form").onsubmit =
    async (event) => {
      event.preventDefault();

      const data =
        Object.fromEntries(
          new FormData(
            event.target
          ).entries()
        );

      data.code =
        data.code
          .toUpperCase()
          .trim();

      try {
        const result =
          await api(
            "/api/classes/join",
            {
              method: "POST",
              body: JSON.stringify(
                data
              )
            }
          );

        root.innerHTML = "";

        await loadClasses();

        toast(
          `T'has unit a ${
            result.class.name
          }.`
        );

      } catch (error) {
        showToastFromError(error);
      }
    };
}





/* ============================================================
   PUBLICAR CONTINGUT A LA CLASSE
============================================================ */
/* ============================================================
   AULA COMPLETA
============================================================ */

async function openClassDetail(classId) {
  try {
    const data = await api(`/api/classes/${classId}`);
    const classroom = data.class;

    const box = $("#class-detail");

    if (!box || !classroom) {
      throw new Error("No s'ha pogut carregar la classe.");
    }

    $("#classes-list")?.classList.add("hidden");
    $("#class-actions")?.classList.add("hidden");

    box.classList.remove("hidden");

    const content = data.content || [];
    const students = data.students || [];
    const materials = data.materials || [];

    const teacherId = Number(classroom.teacher_id);
    const currentUserId = Number(state.user?.id);

    const canManage =
      isTeacher() &&
      teacherId === currentUserId;

    const announcements = content.filter((item) => {
      const type = String(
        item.content_type ||
        item.kind ||
        ""
      ).toLowerCase();

      return type === "avis" || type === "avís";
    });

    const work = content.filter((item) => {
      const type = String(
        item.content_type ||
        item.kind ||
        ""
      ).toLowerCase();

      return type !== "avis" && type !== "avís";
    });

    const teacherName =
      classroom.teacher_name ||
      classroom.teacher ||
      "Professor";

    const renderWorkType = (item) => {
      const type = String(
        item.content_type ||
        item.kind ||
        "activitat"
      ).toLowerCase();

      if (type === "deures") return "DEURES";
      if (type === "examen") return "EXAMEN";
      if (type === "avis" || type === "avís") return "AVÍS";

      return "ACTIVITAT";
    };

    box.innerHTML = `
      <div class="classroom-shell">

        <!-- CAPÇALERA DE LA CLASSE -->

        <div class="classroom-banner">

          <div class="classroom-banner-main">

            <button
              class="classroom-back"
              id="back-classes"
              type="button"
            >
              ← Tornar a Classes
            </button>

            <div class="classroom-kicker">
              AULA DIGITAL
            </div>

            <h2>
              ${esc(classroom.name)}
            </h2>

            <p>
              ${esc(teacherName)}
              · Codi
              <strong>
                ${esc(classroom.code)}
              </strong>
            </p>

          </div>

          <div class="classroom-banner-side">

            <span>
              CODI DE LA CLASSE
            </span>

            <strong>
              ${esc(classroom.code)}
            </strong>

            <button
              class="btn secondary"
              id="copy-class-code"
              type="button"
            >
              Copiar codi
            </button>

          </div>

        </div>


        <!-- NAVEGACIÓ DE LA CLASSE -->

        <nav class="classroom-tabs">

          <button
            class="class-tab active"
            data-tab="stream"
            type="button"
          >
            Tauler
          </button>

          <button
            class="class-tab"
            data-tab="work"
            type="button"
          >
            Treball de classe
          </button>

          <button
            class="class-tab"
            data-tab="people"
            type="button"
          >
            Persones
          </button>

          <button
            class="class-tab"
            data-tab="grades"
            type="button"
          >
            Qualificacions
          </button>

        </nav>


        <!-- CONTINGUT -->

        <div class="classroom-grid">

          <!-- COLUMNA ESQUERRA -->

          <aside class="classroom-aside">

            <div class="classroom-card">

              <h4>
                Informació de la classe
              </h4>

              <div class="class-info-row">
                <span>Professor</span>
                <strong>
                  ${esc(teacherName)}
                </strong>
              </div>

              <div class="class-info-row">
                <span>Alumnes</span>
                <strong>
                  ${students.length}
                </strong>
              </div>

            </div>


            <div class="classroom-card">

              <h4>
                Pròximes entregues
              </h4>

              ${
                work.length
                  ? work
                      .slice()
                      .sort((a, b) => {
                        if (!a.event_date) return 1;
                        if (!b.event_date) return -1;

                        return String(a.event_date)
                          .localeCompare(
                            String(b.event_date)
                          );
                      })
                      .slice(0, 5)
                      .map(
                        (item) => `
                          <div class="upcoming-item">

                            <b>
                              ${esc(item.title)}
                            </b>

                            <small>
                              ${
                                item.event_date
                                  ? fmtDate(item.event_date)
                                  : "Sense data"
                              }
                            </small>

                          </div>
                        `
                      )
                      .join("")
                  : `
                    <small class="muted">
                      No hi ha cap entrega pròxima.
                    </small>
                  `
              }

            </div>

            <div class="classroom-card material-card">
              <div class="material-card-head">
                <div>
                  <h4>Materials</h4>
                  <small class="muted">PDFs compartits pel professor</small>
                </div>
                ${
                  canManage
                    ? `<button class="small-btn" id="upload-material" type="button">＋</button>`
                    : ""
                }
              </div>

              <div class="material-list">
                ${
                  materials.length
                    ? materials.map((item) => `
                        <div class="material-item">
                          <a href="/api/materials/${item.id}" target="_blank" rel="noopener">
                            <span class="material-icon">PDF</span>
                            <span class="material-text">
                              <b>${esc(item.title)}</b>
                              <small>${esc(item.file_name)}</small>
                            </span>
                          </a>
                          ${canManage ? `<button class="material-delete" data-delete-material="${item.id}" type="button" title="Eliminar">×</button>` : ""}
                        </div>
                      `).join("")
                    : `<small class="muted">Encara no hi ha PDFs.</small>`
                }
              </div>
            </div>

          </aside>


          <!-- COLUMNA PRINCIPAL -->

          <main class="classroom-main">


            <!-- TAULER -->

            <section
              class="class-pane active"
              data-pane="stream"
            >

              ${
                canManage
                  ? `
                    <button
                      class="btn primary classroom-publish"
                      id="new-content"
                      type="button"
                    >
                      ＋ Nova publicació
                    </button>
                  `
                  : ""
              }


              <div class="stream-list">

                ${
                  announcements.length
                    ? announcements
                        .map(
                          (item) => `
                            <article class="class-post">

                              <div class="post-avatar">
                                ${initials(
                                  item.author_name ||
                                  teacherName
                                )}
                              </div>

                              <div class="class-post-body">

                                <div class="post-meta">

                                  <b>
                                    ${esc(
                                      item.author_name ||
                                      teacherName
                                    )}
                                  </b>

                                  <span>
                                    ${fmtDate(
                                      item.created_at
                                    )}
                                  </span>

                                </div>

                                <h3>
                                  ${esc(item.title)}
                                </h3>

                                ${
                                  item.body
                                    ? `
                                      <p>
                                        ${esc(item.body)}
                                      </p>
                                    `
                                    : ""
                                }

                                ${
                                  item.event_date
                                    ? `
                                      <div class="post-date">
                                        📅
                                        ${fmtDate(
                                          item.event_date
                                        )}
                                      </div>
                                    `
                                    : ""
                                }

                              </div>

                            </article>
                          `
                        )
                        .join("")
                    : `
                      <div class="class-empty">

                        <div class="class-empty-icon">
                          ✦
                        </div>

                        <strong>
                          Encara no hi ha anuncis
                        </strong>

                        <span>
                          ${
                            canManage
                              ? "Publica un avís per mantenir la classe informada."
                              : "Quan el professor publiqui alguna cosa, apareixerà aquí."
                          }
                        </span>

                      </div>
                    `
                }

              </div>

            </section>


            <!-- TREBALL DE CLASSE -->

            <section
              class="class-pane"
              data-pane="work"
            >

              <div class="class-pane-heading">

                <div>
                  <div class="classroom-kicker">
                    ACTIVITATS
                  </div>

                  <h3>
                    Treball de classe
                  </h3>

                  <p>
                    Deures, exàmens i activitats de la classe.
                  </p>
                </div>

                <span class="class-count">
                  ${work.length}
                </span>

              </div>


              <div class="work-list">

                ${
                  work.length
                    ? work
                        .map(
                          (item) => `
                            <article class="work-card">

                              <div class="work-card-top">

                                <span class="work-type">
                                  ${renderWorkType(item)}
                                </span>

                                ${
                                  item.event_date
                                    ? `
                                      <span class="work-date">
                                        ${fmtDate(
                                          item.event_date
                                        )}
                                      </span>
                                    `
                                    : ""
                                }

                              </div>

                              <h3>
                                ${esc(item.title)}
                              </h3>

                              ${
                                item.body
                                  ? `
                                    <p>
                                      ${esc(item.body)}
                                    </p>
                                  `
                                  : `
                                    <p class="muted">
                                      Sense instruccions addicionals.
                                    </p>
                                  `
                              }

                              <div class="work-card-footer">

                                <span>
                                  ${
                                    renderWorkType(item)
                                      .toLowerCase()
                                  }
                                </span>

                                ${
                                  item.event_date
                                    ? `
                                      <strong>
                                        ${fmtDate(
                                          item.event_date
                                        )}
                                      </strong>
                                    `
                                    : `
                                      <span>
                                        Sense data
                                      </span>
                                    `
                                }

                              </div>

                            </article>
                          `
                        )
                        .join("")
                    : `
                      <div class="class-empty">

                        <div class="class-empty-icon">
                          ✓
                        </div>

                        <strong>
                          No hi ha treball de classe
                        </strong>

                        <span>
                          Els deures i activitats publicats pel professor apareixeran aquí.
                        </span>

                      </div>
                    `
                }

              </div>

            </section>


            <!-- PERSONES -->

            <section
              class="class-pane"
              data-pane="people"
            >

              <div class="class-pane-heading">

                <div>
                  <div class="classroom-kicker">
                    CLASSE
                  </div>

                  <h3>
                    Persones
                  </h3>

                  <p>
                    Professorat i alumnes de la classe.
                  </p>
                </div>

              </div>


              <div class="people-card">

                <h3>
                  Professor
                </h3>

                <div class="person-row">

                  <span class="post-avatar">
                    ${initials(teacherName)}
                  </span>

                  <div>
                    <b>
                      ${esc(teacherName)}
                    </b>

                    <small>
                      Professor
                    </small>
                  </div>

                </div>


                <h3>
                  Alumnes · ${students.length}
                </h3>

                ${
                  students.length
                    ? students
                        .map(
                          (student) => {
                            const studentName =
                              student.name ||
                              student.username ||
                              "Alumne";

                            return `
                              <div class="person-row">

                                <span class="post-avatar small">
                                  ${initials(studentName)}
                                </span>

                                <div>
                                  <b>
                                    ${esc(studentName)}
                                  </b>

                                  <small>
                                    Alumne
                                  </small>
                                </div>

                              </div>
                            `;
                          }
                        )
                        .join("")
                    : `
                      <div class="people-empty">
                        Encara no hi ha alumnes a la classe.
                      </div>
                    `
                }

              </div>

            </section>


            <!-- QUALIFICACIONS -->

            <section
              class="class-pane"
              data-pane="grades"
            >

              <div class="class-pane-heading">

                <div>
                  <div class="classroom-kicker">
                    AVALUACIÓ
                  </div>

                  <h3>
                    Qualificacions
                  </h3>

                  <p>
                    Seguiment del treball i les activitats de la classe.
                  </p>
                </div>

              </div>


              <div class="grades-card">

                <div class="grades-icon">
                  ▥
                </div>

                <h3>
                  Encara no hi ha qualificacions
                </h3>

                <p>
                  Quan la classe tingui activitats qualificades,
                  les qualificacions apareixeran aquí.
                </p>

              </div>

            </section>

          </main>

        </div>

      </div>
    `;


    /* ========================================================
       TORNAR A CLASSES
    ======================================================== */

    $("#back-classes").onclick = () => {

      box.classList.add("hidden");

      $("#classes-list")
        ?.classList.remove("hidden");

      $("#class-actions")
        ?.classList.remove("hidden");

      window.scrollTo({
        top: 0,
        behavior: "smooth"
      });

    };


    /* ========================================================
       PESTANYES
    ======================================================== */

    $$(".class-tab", box).forEach((button) => {

      button.onclick = () => {

        $$(".class-tab", box).forEach((tab) => {
          tab.classList.toggle(
            "active",
            tab === button
          );
        });

        $$(".class-pane", box).forEach((pane) => {
          pane.classList.toggle(
            "active",
            pane.dataset.pane ===
            button.dataset.tab
          );
        });

      };

    });


    /* ========================================================
       COPIAR CODI
    ======================================================== */

    const copyButton =
      $("#copy-class-code");

    if (copyButton) {

      copyButton.onclick = async () => {

        try {

          await navigator.clipboard.writeText(
            classroom.code
          );

          toast("Codi copiat.");

        } catch {

          toast(
            "Codi: " +
            classroom.code
          );

        }

      };

    }


    const uploadButton = $("#upload-material");
    if (uploadButton) {
      uploadButton.onclick = () => openMaterialUpload(classId);
    }

    $$('[data-delete-material]', box).forEach((button) => {
      button.onclick = async () => {
        if (!confirm("Vols eliminar aquest PDF?")) return;
        try {
          await api(`/api/classes/${classId}/materials/${button.dataset.deleteMaterial}`, { method: "DELETE" });
          await openClassDetail(classId);
          toast("Material eliminat.");
        } catch (error) {
          showToastFromError(error);
        }
      };
    });

    /* ========================================================
       PUBLICAR CONTINGUT
    ======================================================== */

    if (
      canManage &&
      $("#new-content")
    ) {

      $("#new-content").onclick = () =>
        openContentModal(classId);

    }

  } catch (error) {

    showToastFromError(error);

  }
}

/* ============================================================
   PUBLICAR CONTINGUT A LA CLASSE
============================================================ */

function openMaterialUpload(classId) {
  const root = $("#modal-root");
  if (!root) return;

  root.innerHTML = `
    <div class="modal-backdrop">
      <div class="modal">
        <div class="modal-head">
          <h3>Afegir material PDF</h3>
          <button class="close" data-close type="button">×</button>
        </div>
        <form id="material-form" class="form-grid">
          <label>
            Títol
            <input name="title" placeholder="Apunts de derivades">
          </label>
          <label>
            PDF
            <input name="file" type="file" accept="application/pdf,.pdf" required>
          </label>
          <small class="muted">Mida màxima: 4 MB.</small>
          <div class="modal-actions">
            <button type="button" class="btn" data-close>Cancel·lar</button>
            <button class="btn primary" type="submit">Pujar PDF</button>
          </div>
        </form>
      </div>
    </div>
  `;

  $$('[data-close]', root).forEach((button) => {
    button.onclick = () => { root.innerHTML = ""; };
  });

  $("#material-form", root).onsubmit = async (event) => {
    event.preventDefault();
    const formData = new FormData(event.target);
    try {
      await api(`/api/classes/${classId}/materials`, {
        method: "POST",
        body: formData
      });
      root.innerHTML = "";
      await openClassDetail(classId);
      toast("PDF afegit a la classe.");
    } catch (error) {
      showToastFromError(error);
    }
  };
}


function openContentModal(classId) {
  const root = $("#modal-root");
  if (!root) return;

  root.innerHTML = `
    <div class="modal-backdrop">
      <div class="modal">
        <div class="modal-head">
          <h3>Publicar a la classe</h3>
          <button class="close" data-close type="button">×</button>
        </div>

        <form id="content-form" class="form-grid two">
          <label>
            Tipus
            <select name="kind">
              <option value="deures">Deures</option>
              <option value="examen">Examen</option>
              <option value="avis">Avís</option>
            </select>
          </label>

          <label>
            Títol
            <input name="title" required placeholder="Treball de laboratori">
          </label>

          <label style="grid-column:1/-1">
            Text
            <textarea name="body" placeholder="Instruccions, informació, recordatoris..."></textarea>
          </label>

          <label>
            Data de l'esdeveniment
            <input type="date" name="event_date">
          </label>

          <div class="modal-actions" style="grid-column:1/-1">
            <button type="button" class="btn" data-close>Cancel·lar</button>
            <button type="submit" class="btn primary">Publicar</button>
          </div>
        </form>
      </div>
    </div>
  `;

  $$('[data-close]', root).forEach((button) => {
    button.onclick = () => { root.innerHTML = ''; };
  });

  const form = $('#content-form', root);
  if (!form) return;

  form.onsubmit = async (event) => {
    event.preventDefault();
    try {
      const payload = Object.fromEntries(new FormData(event.target).entries());
      await api(`/api/classes/${classId}/content`, {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      root.innerHTML = '';
      await openClassDetail(classId);
      toast('Publicació creada.');
    } catch (error) {
      showToastFromError(error);
    }
  };
}


/* ============================================================
   CALENDARI
============================================================ */

function renderCalendar() {
  const grid = $("#calendar-grid");
  if (!grid) return;

  const base = new Date();
  base.setDate(1);
  base.setHours(0,0,0,0);
  base.setMonth(base.getMonth() + state.calendarOffset);

  const year = base.getFullYear();
  const month = base.getMonth();
  const monthName = base.toLocaleDateString("ca-ES", { month: "long", year: "numeric" });
  if ($("#calendar-month")) {
    $("#calendar-month").textContent = monthName.charAt(0).toUpperCase() + monthName.slice(1);
  }

  const firstDay = new Date(year, month, 1);
  const startOffset = (firstDay.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = [];

  for (let i = 0; i < startOffset; i++) cells.push(`<div class="calendar-cell muted-cell"></div>`);

  for (let day = 1; day <= daysInMonth; day++) {
    const date = new Date(year, month, day);
    const iso = date.toISOString().slice(0, 10);
    const today = iso === new Date().toISOString().slice(0, 10);
    const tasks = state.tasks.filter((x) => x.due_date === iso);
    const exams = state.exams.filter((x) => x.exam_date === iso);

    cells.push(`
      <div class="calendar-cell ${today ? "today" : ""}">
        <div class="calendar-day">${day}</div>
        ${tasks.slice(0,3).map((x) => `<div class="calendar-event task">${esc(x.name)}</div>`).join("")}
        ${exams.slice(0,2).map((x) => `<div class="calendar-event exam">Examen · ${esc(x.subject)}</div>`).join("")}
      </div>
    `);
  }

  grid.innerHTML = cells.join("");
}


/* ============================================================
   PLANIFICADOR
============================================================ */

function weekStart() {
  const date =
    new Date();

  date.setDate(
    date.getDate() -
      (
        (date.getDay() + 6) %
        7
      ) +
      state.weekOffset * 7
  );

  date.setHours(
    0,
    0,
    0,
    0
  );

  return date;
}

function renderPlanner() {
  const start =
    weekStart();

  const names = [
    "Dl",
    "Dt",
    "Dc",
    "Dj",
    "Dv",
    "Ds",
    "Dg"
  ];

  const grid =
    $("#week-grid");

  if (!grid) return;

  const items = [];

  state.tasks.forEach(
    (task) => {
      if (task.due_date) {
        items.push({
          date:
            task.due_date,
          type: "task",
          title:
            task.name,
          sub:
            `${task.estimated_minutes || 30} min`
        });
      }
    }
  );

  state.exams.forEach(
    (exam) => {
      items.push({
        date:
          exam.exam_date,
        type: "exam",
        title:
          "Examen · " +
          exam.subject,
        sub:
          "Preparació"
      });
    }
  );

  grid.innerHTML =
    names
      .map(
        (name, index) => {

          const date =
            new Date(start);

          date.setDate(
            start.getDate() +
            index
          );

          const iso =
            date
              .toISOString()
              .slice(0, 10);

          const today =
            iso ===
            new Date()
              .toISOString()
              .slice(0, 10);

          const dayItems =
            items.filter(
              (item) =>
                item.date === iso
            );

          return `
            <div class="day-col">

              <div
                class="day-head ${
                  today
                    ? "today"
                    : ""
                }"
              >

                <small>
                  ${name}
                </small>

                <b>
                  ${date.getDate()}
                </b>

              </div>

              <div class="day-items">

                ${dayItems
                  .map(
                    (item) => `
                      <div
                        class="plan-item ${item.type}"
                      >
                        ${esc(
                          item.title
                        )}

                        <small>
                          ${esc(
                            item.sub
                          )}
                        </small>
                      </div>
                    `
                  )
                  .join("")}

              </div>

            </div>
          `;
        }
      )
      .join("");

  if ($("#week-title")) {
    $("#week-title").textContent =
      state.weekOffset === 0
        ? "Aquesta setmana"
        : state.weekOffset > 0
          ? `D'aquí a ${state.weekOffset} setmana${
              state.weekOffset > 1
                ? "es"
                : ""
            }`
          : `Fa ${Math.abs(
              state.weekOffset
            )} setmana${
              Math.abs(
                state.weekOffset
              ) > 1
                ? "es"
                : ""
            }`;
  }

  renderPlanSessions();
}

function renderPlanSessions() {
  const box =
    $("#plan-sessions");

  if (!box) return;

  const pending =
    state.tasks
      .filter(
        (task) =>
          task.status !==
          "completada"
      )
      .sort(
        (a, b) =>
          daysUntil(
            a.due_date
          ) -
          daysUntil(
            b.due_date
          )
      )
      .slice(0, 5);

  box.innerHTML =
    pending.length
      ? pending
          .map(
            (task) => `
              <div class="session-item">

                <b>
                  ${esc(
                    task.name
                  )}
                </b>

                <small>
                  ${esc(
                    task.subject || ""
                  )}

                  · proposta de
                  ${Math.min(
                    50,
                    Math.max(
                      25,
                      task.estimated_minutes ||
                      30
                    )
                  )}
                  min

                  ·
                  ${fmtDate(
                    task.due_date
                  )}
                </small>

              </div>
            `
          )
          .join("")
      : `
        <div
          class="empty-state"
          style="min-height:150px"
        >
          <span>✓</span>
          <b>
            Cap sessió pendent.
          </b>
          <small>
            Gaudeix del marge.
          </small>
        </div>
      `;
}

async function generatePlan() {
  try {
    await renderRecommendations(
      false
    );

    navigate(
      "planner"
    );

    toast(
      "Pla adaptat segons les teves prioritats."
    );

  } catch (error) {
    showToastFromError(error);
  }
}


function openStudySessionModal() {
  const root = $("#modal-root");
  if (!root) return;

  const pending = state.tasks.filter((x) => x.status !== "completada");
  const exams = state.exams;

  root.innerHTML = `
    <div class="modal-backdrop">
      <div class="modal">
        <div class="modal-head">
          <h3>Afegir sessió d'estudi</h3>
          <button class="close" data-close type="button">×</button>
        </div>
        <form id="study-session-form" class="form-grid two">
          <label>Data<input name="session_date" type="date" value="${new Date().toISOString().slice(0,10)}" required></label>
          <label>Minuts planificats<input name="planned_minutes" type="number" min="5" max="480" value="30" required></label>
          <label>Minuts completats<input name="completed_minutes" type="number" min="0" max="480" value="0"></label>
          <label>Tasca relacionada<select name="task_id"><option value="">Sense tasca</option>${pending.map((x) => `<option value="${x.id}">${esc(x.name)}</option>`).join("")}</select></label>
          <label>Examen relacionat<select name="exam_id"><option value="">Sense examen</option>${exams.map((x) => `<option value="${x.id}">${esc(x.subject)}</option>`).join("")}</select></label>
          <label style="grid-column:1/-1">Notes<textarea name="notes" placeholder="Què estudiaràs o què has aconseguit?"></textarea></label>
          <div class="modal-actions" style="grid-column:1/-1">
            <button type="button" class="btn" data-close>Cancel·lar</button>
            <button class="btn primary" type="submit">Guardar sessió</button>
          </div>
        </form>
      </div>
    </div>
  `;

  $$('[data-close]', root).forEach((button) => button.onclick = () => { root.innerHTML = ""; });
  $("#study-session-form", root).onsubmit = async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.target).entries());
    data.planned_minutes = Number(data.planned_minutes);
    data.completed_minutes = Number(data.completed_minutes);
    if (!data.task_id) data.task_id = null;
    if (!data.exam_id) data.exam_id = null;
    try {
      await api("/api/study-sessions", { method: "POST", body: JSON.stringify(data) });
      root.innerHTML = "";
      await loadProgress();
      renderPlanner();
      toast("Sessió d'estudi guardada.");
    } catch (error) {
      showToastFromError(error);
    }
  };
}


/* ============================================================
   PROGRÉS
============================================================ */

async function loadProgress() {
  try {
    const data =
      await api(
        "/api/progress"
      );

    const tasks =
      data.tasks || {};

    const study =
      data.study || {};

    const percentage =
      tasks.total
        ? Math.round(
            tasks.completed *
            100 /
            tasks.total
          )
        : 0;

    if ($("#progress-number"))
      $("#progress-number").textContent =
        percentage + "%";

    if ($("#progress-bar"))
      $("#progress-bar").style.width =
        percentage + "%";

    if ($("#progress-caption"))
      $("#progress-caption").textContent =
        `${tasks.completed || 0} de ${
          tasks.total || 0
        } tasques`;

    if ($("#progress-tasks"))
      $("#progress-tasks").textContent =
        `${tasks.completed || 0} / ${tasks.total || 0}`;

    if ($("#progress-tests"))
      $("#progress-tests").textContent =
        `${data.tests?.average || 0}%`;

    const planned =
      Number(
        study.planned_minutes ??
        data.planned_minutes ??
        0
      );

    const completed =
      Number(
        study.completed_minutes ??
        data.study_minutes ??
        0
      );

    const studyPercentage =
      planned
        ? Math.min(
            100,
            Math.round(
              completed *
              100 /
              planned
            )
          )
        : 0;

    if ($("#study-number"))
      $("#study-number").textContent =
        completed + " min";

    if ($("#study-bar"))
      $("#study-bar").style.width =
        studyPercentage + "%";

    if ($("#study-caption"))
      $("#study-caption").textContent =
        `${completed} min completats de ${planned} planificats`;

    if ($("#progress-study"))
      $("#progress-study").textContent =
        `${completed} min`;

    const week =
      data.week || [];

    const map = {};

    week.forEach(
      (item) => {
        map[
          String(
            item.session_date
          ).slice(5)
        ] =
          Number(
            item.completed_minutes ??
            item.minutes ??
            0
          );
      }
    );

    const names = [
      "Dl",
      "Dt",
      "Dc",
      "Dj",
      "Dv",
      "Ds",
      "Dg"
    ];

    const values =
      names.map(
        (name, index) => {

          const date =
            new Date();

          date.setDate(
            date.getDate() -
              (
                (date.getDay() + 6) %
                7
              ) +
              index
          );

          return {
            name,
            value:
              map[
                date
                  .toISOString()
                  .slice(5, 10)
              ] || 0
          };
        }
      );

    const max =
      Math.max(
        30,
        ...values.map(
          (item) =>
            item.value
        )
      );

    if ($("#progress-chart")) {
      $("#progress-chart").innerHTML =
        values
          .map(
            (item) => `
              <div class="bar-col">

                <div
                  class="bar"
                  style="
                    height:${Math.max(
                      3,
                      item.value /
                      max *
                      100
                    )}%
                  "
                ></div>

                <small>
                  ${item.name}
                </small>

              </div>
            `
          )
          .join("");
    }

    const tests =
      data.test_history ||
      [];

    if ($("#test-history")) {
      $("#test-history").innerHTML =
        tests.length
          ? tests
              .map(
                (test) => `
                  <div class="test-row">
                    <span>
                      ${esc(
                        test.topic ||
                        test.subject ||
                        "Test"
                      )}
                    </span>

                    <span class="test-score">
                      ${test.score}/${test.total}
                    </span>
                  </div>
                `
              )
              .join("")
          : `
            <p
              class="muted"
              style="font-size:10px"
            >
              Encara no has completat
              cap test.
            </p>
          `;
    }

  } catch (error) {
    showToastFromError(error);
  }
}


/* ============================================================
   IA CHAT
============================================================ */

function addChat(
  role,
  text
) {
  const element =
    document.createElement(
      "div"
    );

  element.className =
    "chat-bubble " +
    role;

  element.innerHTML = `
    <span class="bubble-icon">
      ${
        role === "ai"
          ? "✦"
          : "●"
      }
    </span>

    <div>

      <b>
        ${
          role === "ai"
            ? "MiniClassroom IA"
            : "Tu"
        }
      </b>

      <p>
        ${esc(text)}
      </p>

    </div>
  `;

  $("#ai-messages")?.appendChild(
    element
  );

  if ($("#ai-messages")) {
    $("#ai-messages").scrollTop =
      $("#ai-messages").scrollHeight;
  }
}

async function sendAI() {
  const input =
    $("#ai-input");

  if (!input) return;

  const message =
    input.value.trim();

  if (!message) return;

  input.value = "";

  addChat(
    "user",
    message
  );

  const loading =
    document.createElement(
      "div"
    );

  loading.className =
    "chat-bubble ai";

  loading.innerHTML = `
    <span class="bubble-icon">
      ✦
    </span>

    <div>
      <b>
        MiniClassroom IA
      </b>

      <p>
        Estic pensant...
      </p>
    </div>
  `;

  $("#ai-messages")?.appendChild(
    loading
  );

  try {
    const data =
      await api(
        "/api/ai",
        {
          method: "POST",
          body: JSON.stringify({
            mode: state.aiMode,
            message
          })
        }
      );

    loading.remove();

    addChat(
      "ai",
      data.answer ||
        "No he pogut generar una resposta."
    );

  } catch (error) {
    loading.remove();
    addChat(
      "ai",
      `No he pogut respondre: ${error.message || "error desconegut"}`
    );
    showToastFromError(error);
  }
}


/* ============================================================
   TEST IA
============================================================ */

async function openTest() {
  const root =
    $("#modal-root");

  root.innerHTML = `
    <div class="modal-backdrop">

      <div class="modal">

        <div class="modal-head">

          <h3>
            Crear un test
          </h3>

          <button
            class="close"
            data-close
          >
            ×
          </button>

        </div>

        <form
          id="test-start"
          class="form-grid"
        >

          <label>
            Tema

            <input
              name="topic"
              required
              placeholder="Revolució Industrial"
            >
          </label>

          <div class="modal-actions">

            <button
              type="button"
              class="btn"
              data-close
            >
              Cancel·lar
            </button>

            <button
              class="btn primary"
            >
              Generar 5 preguntes
            </button>

          </div>

        </form>

      </div>

    </div>
  `;

  $$("[data-close]", root)
    .forEach(
      (button) => {
        button.onclick =
          () =>
            root.innerHTML = "";
      }
    );

  $("#test-start").onsubmit =
    async (event) => {
      event.preventDefault();

      const topic =
        new FormData(
          event.target
        ).get("topic");

      try {
        const data =
          await api(
            "/api/ai/test",
            {
              method: "POST",
              body: JSON.stringify({
                topic
              })
            }
          );

        renderTestModal(
          data.test
        );

      } catch (error) {
        showToastFromError(
          error
        );
      }
    };
}

function renderTestModal(
  test
) {
  const root =
    $("#modal-root");

  const questions =
    test.questions || [];

  root.innerHTML = `
    <div class="modal-backdrop">

      <div class="modal">

        <div class="modal-head">

          <h3>
            Test ·
            ${esc(
              test.topic
            )}
          </h3>

          <button
            class="close"
            data-close
          >
            ×
          </button>

        </div>

        <div id="test-questions">

          ${questions
            .map(
              (question, index) => `
                <div
                  class="test-question"
                  data-q="${index}"
                >

                  <p>
                    ${index + 1}.
                    ${esc(
                      question.question
                    )}
                  </p>

                  ${question.options
                    .map(
                      (option, optionIndex) => `
                        <button
                          class="test-option"
                          data-opt="${index}-${optionIndex}"
                        >
                          ${
                            String.fromCharCode(
                              65 +
                              optionIndex
                            )
                          }
                          ·
                          ${esc(option)}
                        </button>
                      `
                    )
                    .join("")}

                </div>
              `
            )
            .join("")}

        </div>

        <div class="modal-actions">

          <button
            class="btn primary"
            id="grade-test"
          >
            Corregir test
          </button>

        </div>

      </div>

    </div>
  `;

  $$("[data-close]", root)
    .forEach(
      (button) => {
        button.onclick =
          () =>
            root.innerHTML = "";
      }
    );

  const answers = {};

  $$("[data-opt]", root)
    .forEach(
      (button) => {
        button.onclick =
          () => {

            const [
              questionIndex,
              optionIndex
            ] =
              button.dataset.opt
                .split("-")
                .map(Number);

            answers[
              questionIndex
            ] =
              optionIndex;

            $$(
              `[data-q="${questionIndex}"] .test-option`,
              root
            ).forEach(
              (option) =>
                option.classList.remove(
                  "selected"
                )
            );

            button.classList.add(
              "selected"
            );
          };
      }
    );

  $("#grade-test").onclick =
    async () => {

      let score = 0;

      questions.forEach(
        (question, index) => {
          if (
            answers[index] ===
            question.answer
          ) {
            score++;
          }
        }
      );

      questions.forEach(
        (question, index) => {

          $$(
            `[data-q="${index}"] .test-option`,
            root
          ).forEach(
            (button, optionIndex) => {

              if (
                optionIndex ===
                question.answer
              ) {
                button.classList.add(
                  "selected"
                );
              }

            }
          );
        }
      );

      $("#grade-test").disabled =
        true;

      $("#grade-test").textContent =
        "Resultat";

      const result =
        document.createElement(
          "div"
        );

      result.className =
        "test-result";

      result.innerHTML = `
        <strong>
          ${score}/${questions.length}
        </strong>

        <p>
          Has encertat
          ${score}
          de
          ${questions.length}
          preguntes.
        </p>

        <button
          class="btn primary"
          id="save-test-result"
        >
          Guardar resultat
        </button>
      `;

      root
        .querySelector(
          ".modal"
        )
        .appendChild(result);

      $("#save-test-result").onclick =
        async () => {

          try {
            await api(
              "/api/test-results",
              {
                method: "POST",
                body: JSON.stringify({
                  topic:
                    test.topic,
                  score,
                  total:
                    questions.length
                })
              }
            );

            toast(
              "Resultat guardat al teu progrés."
            );

            root.innerHTML = "";

          } catch (error) {
            showToastFromError(
              error
            );
          }
        };
    };
}


/* ============================================================
   RECOMANACIONS
============================================================ */

function openReco() {
  navigate(
    "dashboard"
  );

  renderRecommendations(
    true
  );
}


/* ============================================================
   AUTENTICACIÓ
============================================================ */

function bindAuth() {

  $$(".auth-tab")
    .forEach(
      (button) => {

        button.onclick =
          () => {

            $$(".auth-tab")
              .forEach(
                (tab) =>
                  tab.classList.remove(
                    "active"
                  )
              );

            button.classList.add(
              "active"
            );

            const register =
              button.dataset.auth ===
              "register";

            $("#login-form")
              ?.classList.toggle(
                "hidden",
                register
              );

            $("#register-form")
              ?.classList.toggle(
                "hidden",
                !register
              );

            if ($("#auth-message")) {
              $("#auth-message").textContent =
                "";
            }
          };
      }
    );

  $("#login-form").onsubmit =
    async (event) => {

      event.preventDefault();

      if ($("#auth-message")) {
        $("#auth-message").textContent =
          "";
      }

      try {
        const data =
          await api(
            "/api/login",
            {
              method: "POST",
              body: JSON.stringify(
                Object.fromEntries(
                  new FormData(
                    event.target
                  ).entries()
                )
              )
            }
          );

        setUser(
          data.user
        );

        $("#auth-view")
          ?.classList.add(
            "hidden"
          );

        $("#app-view")
          ?.classList.remove(
            "hidden"
          );

        await loadDashboard();

        toast(
          "Benvingut/da a MiniClassroom."
        );

      } catch (error) {

        if ($("#auth-message")) {
          $("#auth-message").textContent =
            error.message;
        }
      }
    };

  $("#register-form").onsubmit =
    async (event) => {

      event.preventDefault();

      try {

        await api(
          "/api/register",
          {
            method: "POST",
            body: JSON.stringify(
              Object.fromEntries(
                new FormData(
                  event.target
                ).entries()
              )
            )
          }
        );

        const data =
          await api(
            "/api/me"
          );

        setUser(
          data.user
        );

        $("#auth-view")
          ?.classList.add(
            "hidden"
          );

        $("#app-view")
          ?.classList.remove(
            "hidden"
          );

        await loadDashboard();

        toast(
          "Compte creat correctament."
        );

      } catch (error) {

        if ($("#auth-message")) {
          $("#auth-message").textContent =
            error.message;
        }
      }
    };
}


/* ============================================================
   INTERFÍCIE
============================================================ */

function bindUI() {

  bindNav();

  bindAuth();

  if ($("#logout-btn")) {
    $("#logout-btn").onclick =
      async () => {

        try {
          await api(
            "/api/logout",
            {
              method: "POST"
            }
          );
        } finally {
          location.reload();
        }
      };
  }

  if ($("#profile-form")) {
    $("#profile-form").onsubmit = async (event) => {
      event.preventDefault();
      try {
        const data = Object.fromEntries(new FormData(event.target).entries());
        const result = await api("/api/profile", {
          method: "PUT",
          body: JSON.stringify({ name: data.name })
        });
        setUser(result.user);
        toast("Perfil actualitzat.");
      } catch (error) {
        showToastFromError(error);
      }
    };
  }

  if ($("#new-task")) {
    $("#new-task").onclick =
      () =>
        openTaskModal();
  }

  if ($("#new-exam")) {
    $("#new-exam").onclick =
      () =>
        openExamModal();
  }

  if ($("#quick-add")) {
    $("#quick-add").onclick =
      () =>
        openTaskModal();
  }

  if ($("#quick-ai")) {
    $("#quick-ai").onclick =
      () =>
        navigate("ai");
  }

  if ($("#recalc-ai")) {
    $("#recalc-ai").onclick =
      () =>
        renderRecommendations(
          true
        );
  }

  if ($("#open-reco")) {
    $("#open-reco").onclick =
      openReco;
  }

  if ($("#open-test")) {
    $("#open-test").onclick =
      openTest;
  }

  if ($("#generate-plan")) {
    $("#generate-plan").onclick =
      generatePlan;
  }

  if ($("#prev-week")) {
    $("#prev-week").onclick =
      () => {
        state.weekOffset--;
        renderPlanner();
      };
  }

  if ($("#next-week")) {
    $("#next-week").onclick =
      () => {
        state.weekOffset++;
        renderPlanner();
      };
  }

  if ($("#add-session")) {
    $("#add-session").onclick = openStudySessionModal;
  }

  if ($("#calendar-prev")) {
    $("#calendar-prev").onclick = () => { state.calendarOffset--; renderCalendar(); };
  }

  if ($("#calendar-next")) {
    $("#calendar-next").onclick = () => { state.calendarOffset++; renderCalendar(); };
  }

  if ($("#task-search")) {
    $("#task-search").oninput =
      (event) => {
        state.taskSearch =
          event.target.value;

        renderTasks();
      };
  }

  $$("[data-filter]")
    .forEach(
      (button) => {

        button.onclick =
          () => {

            $$("[data-filter]")
              .forEach(
                (item) =>
                  item.classList.remove(
                    "active"
                  )
              );

            button.classList.add(
              "active"
            );

            state.taskFilter =
              button.dataset.filter;

            renderTasks();
          };
      }
    );

  $$("[data-ai-mode]")
    .forEach(
      (button) => {

        button.onclick =
          () => {

            $$("[data-ai-mode]")
              .forEach(
                (item) =>
                  item.classList.remove(
                    "active"
                  )
              );

            button.classList.add(
              "active"
            );

            state.aiMode =
              button.dataset.aiMode;

            if ($("#ai-input")) {
              $("#ai-input").placeholder =
                state.aiMode ===
                "RESUMIR"
                  ? "Enganxa el text que vols resumir..."
                  : "Escriu una pregunta...";
            }
          };
      }
    );

  $$('[data-ai-tool]').forEach((button) => {
    button.onclick = () => {
      const mode = String(button.dataset.aiTool || "EXPLICAR").toUpperCase();
      navigate("ai");
      state.aiMode = mode;
      $$('[data-ai-mode]').forEach((item) => item.classList.toggle("active", item.dataset.aiMode === mode));
      if (mode === "TEST") openTest();
    };
  });

  if ($("#ai-form")) {
    $("#ai-form").onsubmit =
      (event) => {
        event.preventDefault();
        sendAI();
      };
  }

  if ($("#ai-input")) {
    $("#ai-input").addEventListener(
      "keydown",
      (event) => {

        if (
          event.key ===
            "Enter" &&
          !event.shiftKey
        ) {
          event.preventDefault();
          sendAI();
        }
      }
    );
  }
}


/* ============================================================
   ARRANCADA
============================================================ */

window.addEventListener(
  "DOMContentLoaded",
  () => {
    bindUI();
    boot();
  }
);
