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
  weekOffset: 0
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
  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      ...(opts.headers || {})
    },
    ...opts
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
  state.user = user;

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

  if ($("#profile-role"))
    $("#profile-role").textContent =
      user.role === "professor"
        ? "Professor"
        : "Alumne";

  if ($("#profile-avatar"))
    $("#profile-avatar").textContent =
      initials(name);

  if ($("#greeting")) {
    $("#greeting").innerHTML =
      user.role === "professor"
        ? "La teva aula,<br><span>organitzada i al teu ritme.</span>"
        : "El teu estudi,<br><span>clar i al teu ritme.</span>";
  }

  if ($("#side-role")) {
    $("#side-role").textContent =
      user.role === "professor"
        ? "Professor"
        : "Alumne";
  }

  if (user.role === "professor") {
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
    state.user?.role ===
    "professor"
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

    if ($("#recommendation-box")) {
      $("#recommendation-box").innerHTML =
        recommendation
          ? `
            <span class="reco-orb">
              ✦
            </span>

            <div>
              <strong>
                ${esc(
                  recommendation.action
                )}
                —
                ${esc(
                  recommendation.title
                )}
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

          <label style="grid-column:1/-1">
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
              ${task ? "Guardar canvis" : "Crear tasca"}
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
        await api(
          task
            ? `/api/tasks/${task.id}`
            : "/api/tasks",
          {
            method:
              task
                ? "PATCH"
                : "POST",

            body:
              JSON.stringify(
                data
              )
          }
        );

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

          <h3>
            Nou examen
          </h3>

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

            body:
              JSON.stringify(
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
      await api(
        "/api/classes"
      );

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
    state.user.role ===
    "professor"
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
    state.user.role ===
    "professor"
  ) {

    $("#new-class").onclick =
      () =>
        openClassCreate();

  } else {

    $("#join-class").onclick =
      () =>
        openJoinModal();

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

        <span>
          ⌘
        </span>

        <b>
          Encara no tens classes.
        </b>

        <small>
          ${
            state.user.role === "professor"
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

              body:
                JSON.stringify(
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

              body:
                JSON.stringify(
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
   DETALL DE LA CLASSE — AULA TIPUS CLASSROOM
============================================================ */

async function openClassDetail(classId) {
  const box =
    $("#classes-list");

  const detail =
    $("#class-detail");

  if (!detail) return;

  const classroom =
    state.classes.find(
      (item) =>
        String(item.id) ===
        String(classId)
    );

  if (!classroom) {
    toast(
      "No s'ha trobat la classe.",
      true
    );
    return;
  }

  box?.classList.add(
    "hidden"
  );

  detail.classList.remove(
    "hidden"
  );

  detail.innerHTML = `
    <div class="classroom-detail">

      <div class="classroom-cover">

        <div class="classroom-cover-pattern"></div>

        <div class="classroom-cover-content">

          <div>
            <span class="eyebrow">
              AULA DIGITAL
            </span>

            <h1>
              ${esc(
                classroom.name
              )}
            </h1>

            <p>
              ${esc(
                classroom.teacher_name ||
                classroom.teacher ||
                "Professor"
              )}
            </p>
          </div>

          <div class="class-code-large">

            <span>
              Codi de la classe
            </span>

            <strong>
              ${esc(
                classroom.code
              )}
            </strong>

          </div>

        </div>

      </div>

      <div class="classroom-tabs">

        <button
          class="classroom-tab active"
          data-class-tab="stream"
        >
          Tauler
        </button>

        <button
          class="classroom-tab"
          data-class-tab="work"
        >
          Treball de classe
        </button>

        <button
          class="classroom-tab"
          data-class-tab="people"
        >
          Persones
        </button>

        <button
          class="classroom-tab"
          data-class-tab="grades"
        >
          Qualificacions
        </button>

      </div>

      <div
        class="classroom-body"
        id="classroom-body"
      >

        <div class="classroom-loading">
          <span class="loading-dot"></span>
          Carregant l'aula...
        </div>

      </div>

    </div>
  `;

  const body =
    $("#classroom-body");

  try {

    const data =
      await api(
        `/api/classes/${classId}`
      );

    renderClassroomTab(
      classroom,
      data,
      "stream"
    );

    $$(".classroom-tab", detail)
      .forEach(
        (tab) => {

          tab.onclick = () => {

            $$(".classroom-tab", detail)
              .forEach(
                (item) =>
                  item.classList.remove(
                    "active"
                  )
              );

            tab.classList.add(
              "active"
            );

            renderClassroomTab(
              classroom,
              data,
              tab.dataset.classTab
            );

          };

        }
      );

  } catch (error) {

    body.innerHTML = `
      <div class="card empty-state">

        <span>!</span>

        <b>
          No s'ha pogut carregar l'aula.
        </b>

        <small>
          ${esc(
            error.message ||
            "Error intern del servidor."
          )}
        </small>

        <button
          class="btn secondary"
          id="back-to-classes"
        >
          Tornar a les classes
        </button>

      </div>
    `;

    $("#back-to-classes").onclick =
      () => {
        detail.classList.add(
          "hidden"
        );

        box?.classList.remove(
          "hidden"
        );
      };
  }
}


/* ============================================================
   RENDER DE LES PESTANYES DE LA CLASSE
============================================================ */

function renderClassroomTab(
  classroom,
  data,
  tab
) {

  const body =
    $("#classroom-body");

  if (!body) return;

  const announcements =
    data.announcements ||
    data.posts ||
    data.class_content ||
    [];

  const work =
    data.work ||
    data.assignments ||
    data.tasks ||
    [];

  const students =
    data.students ||
    data.members ||
    [];

  const grades =
    data.grades ||
    [];

  if (tab === "stream") {

    renderClassroomStream(
      classroom,
      announcements,
      data
    );

    return;
  }

  if (tab === "work") {

    renderClassroomWork(
      classroom,
      work,
      data
    );

    return;
  }

  if (tab === "people") {

    renderClassroomPeople(
      classroom,
      students,
      data
    );

    return;
  }

  if (tab === "grades") {

    renderClassroomGrades(
      classroom,
      grades,
      data
    );

    return;
  }
}


/* ============================================================
   TAULER
============================================================ */

function renderClassroomStream(
  classroom,
  announcements,
  data
) {

  const body =
    $("#classroom-body");

  const isProfessor =
    state.user?.role ===
      "professor" &&
    String(
      classroom.teacher_id ||
      classroom.teacherId ||
      ""
    ) ===
      String(
        state.user?.id || ""
      );

  body.innerHTML = `

    <div class="classroom-layout">

      <aside class="classroom-aside">

        <div class="class-info-card card">

          <span class="eyebrow">
            INFORMACIÓ
          </span>

          <h3>
            ${esc(
              classroom.name
            )}
          </h3>

          <div class="info-row">

            <span>
              Professor
            </span>

            <strong>
              ${esc(
                classroom.teacher_name ||
                classroom.teacher ||
                "—"
              )}
            </strong>

          </div>

          <div class="info-row">

            <span>
              Codi
            </span>

            <strong
              class="mono"
            >
              ${esc(
                classroom.code
              )}
            </strong>

          </div>

          <div class="info-row">

            <span>
              Alumnes
            </span>

            <strong>
              ${
                classroom.student_count ||
                studentsCount(data) ||
                0
              }
            </strong>

          </div>

        </div>

        <div class="card class-side-note">

          <span class="eyebrow">
            MINIASSISTENT
          </span>

          <p>
            ${isProfessor
              ? "Publica avisos i materials perquè l'aula estigui sempre actualitzada."
              : "Consulta les tasques i avisos de la classe des d'un mateix lloc."
            }
          </p>

        </div>

      </aside>

      <main class="classroom-stream">

        ${
          isProfessor
            ? `
              <div class="stream-composer card">

                <div class="composer-avatar">
                  ${initials(
                    state.user?.name
                  )}
                </div>

                <button
                  class="composer-button"
                  id="new-class-content"
                >
                  Publica un anunci o material...
                </button>

              </div>
            `
            : ""
        }

        ${
          announcements.length
            ? announcements
                .map(
                  (item) =>
                    renderAnnouncement(
                      item
                    )
                )
                .join("")
            : `
              <div class="card empty-state">

                <span>◌</span>

                <b>
                  Encara no hi ha activitat.
                </b>

                <small>
                  ${
                    isProfessor
                      ? "Publica el primer anunci per començar l'activitat de la classe."
                      : "Quan el professor publiqui alguna cosa, apareixerà aquí."
                  }
                </small>

              </div>
            `
        }

      </main>

    </div>
  `;

  if (
    $("#new-class-content")
  ) {
    $("#new-class-content").onclick =
      () =>
        openContentModal(
          classroom.id
        );
  }
}


/* ============================================================
   ANUNCIS I MATERIALS
============================================================ */

function renderAnnouncement(
  item
) {

  const kind =
    String(
      item.kind ||
      item.type ||
      "announcement"
    ).toLowerCase();

  let label =
    "ANUNCI";

  if (
    kind === "homework" ||
    kind === "tasca"
  ) {
    label = "TASCA";
  }

  if (
    kind === "exam" ||
    kind === "examen"
  ) {
    label = "EXAMEN";
  }

  if (
    kind === "material"
  ) {
    label = "MATERIAL";
  }

  return `
    <article
      class="class-post card"
    >

      <div class="class-post-head">

        <div class="post-avatar">
          ${initials(
            item.author_name ||
            item.teacher_name ||
            "M"
          )}
        </div>

        <div>

          <strong>
            ${esc(
              item.author_name ||
              item.teacher_name ||
              "Professor"
            )}
          </strong>

          <small>
            ${fmtDate(
              item.created_at ||
              item.date ||
              item.event_date
            )}
          </small>

        </div>

        <span class="post-kind">
          ${label}
        </span>

      </div>

      <div class="class-post-content">

        <h3>
          ${esc(
            item.title ||
            item.name ||
            "Sense títol"
          )}
        </h3>

        ${
          item.body ||
          item.description
            ? `
              <p>
                ${esc(
                  item.body ||
                  item.description
                )}
              </p>
            `
            : ""
        }

        ${
          item.event_date
            ? `
              <div class="post-date">
                <span>◷</span>

                ${fullDate(
                  item.event_date
                )}
              </div>
            `
            : ""
        }

        ${
          item.due_date
            ? `
              <div class="post-date">
                <span>◷</span>

                Entrega:
                ${fullDate(
                  item.due_date
                )}
              </div>
            `
            : ""
        }

      </div>

    </article>
  `;
}

function studentsCount(
  data
) {

  return (
    data?.students?.length ||
    data?.members?.length ||
    0
  );
}


/* ============================================================
   TREBALL DE CLASSE
============================================================ */

function renderClassroomWork(
  classroom,
  work,
  data
) {

  const body =
    $("#classroom-body");

  const isProfessor =
    state.user?.role ===
    "professor";

  const assignments =
    work.filter(
      (item) => {

        const kind =
          String(
            item.kind ||
            item.type ||
            ""
          ).toLowerCase();

        return (
          kind === "homework" ||
          kind === "tasca" ||
          kind === "task" ||
          !kind
        );
      }
    );

  const exams =
    work.filter(
      (item) => {

        const kind =
          String(
            item.kind ||
            item.type ||
            ""
          ).toLowerCase();

        return (
          kind === "exam" ||
          kind === "examen"
        );
      }
    );

  body.innerHTML = `

    <div class="class-work-layout">

      <div class="class-work-main">

        <div class="section-heading">

          <div>

            <span class="eyebrow">
              TREBALL DE CLASSE
            </span>

            <h2>
              Tasques i activitats
            </h2>

          </div>

          ${
            isProfessor
              ? `
                <button
                  class="btn primary"
                  id="new-class-work"
                >
                  ＋ Afegir
                </button>
              `
              : ""
          }

        </div>

        <div class="class-work-list">

          ${
            assignments.length
              ? assignments
                  .map(
                    (item) =>
                      renderWorkItem(
                        item,
                        "tasca"
                      )
                  )
                  .join("")
              : `
                <div class="card empty-state">

                  <span>□</span>

                  <b>
                    No hi ha tasques.
                  </b>

                  <small>
                    Les activitats que publiqui
                    el professor apareixeran aquí.
                  </small>

                </div>
              `
          }

        </div>

        <div
          class="section-heading"
          style="margin-top:28px"
        >

          <div>

            <span class="eyebrow">
              EXÀMENS
            </span>

            <h2>
              Preparació
            </h2>

          </div>

        </div>

        <div class="class-work-list">

          ${
            exams.length
              ? exams
                  .map(
                    (item) =>
                      renderWorkItem(
                        item,
                        "examen"
                      )
                  )
                  .join("")
              : `
                <div class="card empty-state">

                  <span>□</span>

                  <b>
                    No hi ha exàmens publicats.
                  </b>

                </div>
              `
          }

        </div>

      </div>

      <aside class="class-work-aside">

        <div class="card">

          <span class="eyebrow">
            ORGANITZACIÓ
          </span>

          <h3>
            Aquesta classe
          </h3>

          <div class="info-row">

            <span>
              Activitats
            </span>

            <strong>
              ${assignments.length}
            </strong>

          </div>

          <div class="info-row">

            <span>
              Exàmens
            </span>

            <strong>
              ${exams.length}
            </strong>

          </div>

        </div>

      </aside>

    </div>
  `;

  if (
    $("#new-class-work")
  ) {
    $("#new-class-work").onclick =
      () =>
        openContentModal(
          classroom.id,
          "homework"
        );
  }
}

function renderWorkItem(
  item,
  type
) {

  const title =
    item.title ||
    item.name ||
    "Activitat";

  const date =
    item.due_date ||
    item.event_date ||
    item.exam_date;

  return `
    <article
      class="work-item card"
    >

      <div class="work-item-icon">
        ${
          type === "examen"
            ? "E"
            : "T"
        }
      </div>

      <div class="work-item-main">

        <span class="eyebrow">
          ${
            type === "examen"
              ? "EXAMEN"
              : "TASCA"
          }
        </span>

        <h3>
          ${esc(title)}
        </h3>

        ${
          item.body ||
          item.description
            ? `
              <p>
                ${esc(
                  item.body ||
                  item.description
                )}
              </p>
            `
            : ""
        }

      </div>

      <div class="work-item-date">

        <small>
          ${
            type === "examen"
              ? "Data"
              : "Entrega"
          }
        </small>

        <strong>
          ${fmtDate(date)}
        </strong>

      </div>

    </article>
  `;
}


/* ============================================================
   PERSONES
============================================================ */

function renderClassroomPeople(
  classroom,
  students,
  data
) {

  const body =
    $("#classroom-body");

  const teacher =
    classroom.teacher_name ||
    classroom.teacher ||
    "Professor";

  body.innerHTML = `

    <div class="people-page">

      <div class="section-heading">

        <div>

          <span class="eyebrow">
            PERSONES
          </span>

          <h2>
            Participants de la classe
          </h2>

        </div>

      </div>

      <div class="people-group card">

        <div class="people-group-head">

          <h3>
            Professor
          </h3>

          <span>
            1
          </span>

        </div>

        <div class="person-row">

          <div class="person-avatar">
            ${initials(
              teacher
            )}
          </div>

          <div>

            <strong>
              ${esc(
                teacher
              )}
            </strong>

            <small>
              Professor de la classe
            </small>

          </div>

        </div>

      </div>

      <div class="people-group card">

        <div class="people-group-head">

          <h3>
            Alumnes
          </h3>

          <span>
            ${students.length}
          </span>

        </div>

        ${
          students.length
            ? students
                .map(
                  (student) => {

                    const name =
                      student.name ||
                      student.username ||
                      student.email ||
                      "Alumne";

                    return `
                      <div class="person-row">

                        <div class="person-avatar">
                          ${initials(name)}
                        </div>

                        <div>

                          <strong>
                            ${esc(name)}
                          </strong>

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
              <div class="empty-state">

                <span>◌</span>

                <b>
                  Encara no hi ha alumnes.
                </b>

                <small>
                  Comparteix el codi
                  ${esc(classroom.code)}
                  perquè s'hi puguin unir.
                </small>

              </div>
            `
        }

      </div>

    </div>
  `;
}


/* ============================================================
   QUALIFICACIONS
============================================================ */

function renderClassroomGrades(
  classroom,
  grades,
  data
) {

  const body =
    $("#classroom-body");

  const isProfessor =
    state.user?.role ===
    "professor";

  if (!grades.length) {

    body.innerHTML = `
      <div class="card empty-state">

        <span>◎</span>

        <b>
          Encara no hi ha qualificacions.
        </b>

        <small>
          ${
            isProfessor
              ? "Quan hi hagi activitats qualificables, les podràs gestionar des d'aquí."
              : "Les teves qualificacions apareixeran aquí quan el professor les publiqui."
          }
        </small>

      </div>
    `;

    return;
  }

  body.innerHTML = `

    <div class="grades-page">

      <div class="section-heading">

        <div>

          <span class="eyebrow">
            QUALIFICACIONS
          </span>

          <h2>
            Resultats
          </h2>

        </div>

      </div>

      <div class="card grades-table">

        <div class="grades-row grades-head">

          <span>
            Activitat
          </span>

          <span>
            Data
          </span>

          <span>
            Nota
          </span>

        </div>

        ${
          grades
            .map(
              (grade) => `
                <div class="grades-row">

                  <strong>
                    ${esc(
                      grade.title ||
                      grade.name ||
                      "Activitat"
                    )}
                  </strong>

                  <span>
                    ${fmtDate(
                      grade.date ||
                      grade.due_date
                    )}
                  </span>

                  <strong>
                    ${
                      grade.score ??
                      "—"
                    }
                  </strong>

                </div>
              `
            )
            .join("")
        }

      </div>

    </div>
  `;
}

/* ============================================================
   PUBLICAR CONTINGUT A LA CLASSE
============================================================ */

function openContentModal(classId) {
  const root = $("#modal-root");

  if (!root) return;

  root.innerHTML = `
    <div class="modal-backdrop">

      <div class="modal">

        <div class="modal-head">

          <h3>
            Publicar a la classe
          </h3>

          <button
            class="close"
            data-close
            type="button"
          >
            ×
          </button>

        </div>

        <form
          id="content-form"
          class="form-grid two"
        >

          <label>
            Tipus

            <select name="kind">

              <option value="deures">
                Deures
              </option>

              <option value="examen">
                Examen
              </option>

              <option value="avis">
                Avís
              </option>

            </select>
          </label>

          <label>
            Títol

            <input
              name="title"
              required
              placeholder="Treball de laboratori"
            >
          </label>

          <label
            style="grid-column:1/-1"
          >
            Text

            <textarea
              name="body"
              placeholder="Instruccions, informació, recordatoris..."
            ></textarea>
          </label>

          <label>
            Data de l'esdeveniment

            <input
              type="date"
              name="event_date"
            >
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
              type="submit"
              class="btn primary"
            >
              Publicar
            </button>

          </div>

        </form>

      </div>

    </div>
  `;

  $$("[data-close]", root)
    .forEach(
      (button) => {

        button.onclick = () => {
          root.innerHTML = "";
        };

      }
    );

  const form =
    $("#content-form", root);

  if (!form) return;

  form.onsubmit =
    async (event) => {

      event.preventDefault();

      try {

        const payload =
          Object.fromEntries(
            new FormData(
              event.target
            ).entries()
          );

        await api(
          `/api/classes/${classId}/content`,
          {
            method: "POST",
            body:
              JSON.stringify(
                payload
              )
          }
        );

        root.innerHTML = "";

        await openClassDetail(
          classId
        );

        toast(
          "Publicació creada."
        );

      } catch (error) {

        showToastFromError(
          error
        );

      }

    };
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

          type:
            "task",

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

        type:
          "exam",

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
                item.date ===
                iso
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

          ? `D'aquí a ${
              state.weekOffset
            } setmana${
              state.weekOffset > 1
                ? "es"
                : ""
            }`

          : `Fa ${
              Math.abs(
                state.weekOffset
              )
            } setmana${
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

    showToastFromError(
      error
    );

  }
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

    renderProgress(
      data
    );

  } catch (error) {

    showToastFromError(
      error
    );

  }
}

/* ============================================================
   PROGRÉS
============================================================ */

function renderProgress(data) {

  const tasks =
    data.tasks ||
    data.progress?.tasks ||
    {};

  const study =
    data.study ||
    data.progress?.study ||
    {};

  const tests =
    data.tests ||
    data.progress?.tests ||
    {};

  const totalTasks =
    Number(
      tasks.total ??
      data.total_tasks ??
      0
    );

  const completedTasks =
    Number(
      tasks.completed ??
      data.completed_tasks ??
      0
    );

  const taskProgress =
    totalTasks > 0
      ? Math.round(
          completedTasks /
          totalTasks *
          100
        )
      : 0;

  const studyMinutes =
    Number(
      study.minutes ??
      study.study_minutes ??
      data.study_minutes ??
      0
    );

  const testsCompleted =
    Number(
      tests.completed ??
      tests.total ??
      0
    );

  if ($("#progress-task-value")) {
    $("#progress-task-value")
      .textContent =
      taskProgress + "%";
  }

  if ($("#progress-task-detail")) {
    $("#progress-task-detail")
      .textContent =
      `${completedTasks} de ${totalTasks} tasques completades`;
  }

  if ($("#progress-study-value")) {
    $("#progress-study-value")
      .textContent =
      studyMinutes + " min";
  }

  if ($("#progress-test-value")) {
    $("#progress-test-value")
      .textContent =
      testsCompleted;
  }

  const week =
    data.weekly ||
    data.week ||
    [];

  const weekBox =
    $("#progress-week");

  if (weekBox) {

    if (
      Array.isArray(week) &&
      week.length
    ) {

      weekBox.innerHTML =
        week
          .map(
            (day) => `
              <div class="progress-day">

                <span>
                  ${esc(
                    day.label ||
                    day.day ||
                    ""
                  )}
                </span>

                <div
                  class="progress-bar"
                >
                  <i
                    style="
                      width:${Math.min(
                        100,
                        Number(
                          day.percent ||
                          day.progress ||
                          0
                        )
                      )}%
                    "
                  ></i>
                </div>

                <strong>
                  ${
                    day.minutes ??
                    day.value ??
                    0
                  }
                </strong>

              </div>
            `
          )
          .join("");

    } else {

      weekBox.innerHTML = `
        <div class="empty-state">

          <span>◷</span>

          <b>
            Encara no hi ha dades setmanals.
          </b>

          <small>
            Quan estudiïs o completis
            tasques, aquesta gràfica
            començarà a mostrar el teu ritme.
          </small>

        </div>
      `;

    }
  }

  const summary =
    $("#progress-summary");

  if (summary) {

    summary.innerHTML = `

      <div class="progress-summary-item">

        <span>
          Tasques
        </span>

        <strong>
          ${completedTasks}
          /
          ${totalTasks}
        </strong>

      </div>

      <div class="progress-summary-item">

        <span>
          Temps d'estudi
        </span>

        <strong>
          ${studyMinutes}
          min
        </strong>

      </div>

      <div class="progress-summary-item">

        <span>
          Tests
        </span>

        <strong>
          ${testsCompleted}
        </strong>

      </div>

    `;

  }
}


/* ============================================================
   IA D'ESTUDI — XAT
============================================================ */

function setAiMode(mode) {

  state.aiMode =
    mode;

  $$("[data-ai-mode]")
    .forEach(
      (button) => {

        button.classList.toggle(
          "active",
          button.dataset.aiMode ===
            mode
        );

      }
    );

  const labels = {

    DUBTE:
      "Pregunta'm qualsevol dubte.",

    EXPLICAR:
      "Escriu el tema que vols entendre.",

    ESTUDIAR:
      "Digues què has d'estudiar.",

    RESUMIR:
      "Enganxa el text que vols resumir.",

    TEST:
      "Indica el tema del test."

  };

  if ($("#ai-input")) {

    $("#ai-input").placeholder =
      labels[mode] ||
      labels.DUBTE;

  }
}

function addAiMessage(
  role,
  content
) {

  const box =
    $("#ai-messages");

  if (!box) return;

  const element =
    document.createElement(
      "div"
    );

  element.className =
    `ai-message ${role}`;

  element.innerHTML = `

    <div class="ai-message-avatar">
      ${
        role === "user"
          ? initials(
              state.user?.name
            )
          : "✦"
      }
    </div>

    <div class="ai-message-content">
      ${formatAiText(
        content
      )}
    </div>

  `;

  box.appendChild(
    element
  );

  box.scrollTop =
    box.scrollHeight;
}

function formatAiText(
  text
) {

  let value =
    esc(text || "");

  value =
    value.replace(
      /\*\*(.*?)\*\*/g,
      "<strong>$1</strong>"
    );

  value =
    value.replace(
      /\n/g,
      "<br>"
    );

  return value;
}

async function sendAiMessage() {

  const input =
    $("#ai-input");

  if (!input) return;

  const message =
    input.value.trim();

  if (!message) return;

  addAiMessage(
    "user",
    message
  );

  input.value = "";

  const button =
    $("#ai-send");

  if (button) {
    button.disabled = true;
  }

  const typing =
    document.createElement(
      "div"
    );

  typing.className =
    "ai-message assistant";

  typing.innerHTML = `

    <div class="ai-message-avatar">
      ✦
    </div>

    <div
      class="ai-message-content"
    >
      <span class="ai-typing">
        Pensant...
      </span>
    </div>

  `;

  const box =
    $("#ai-messages");

  box?.appendChild(
    typing
  );

  if (box) {
    box.scrollTop =
      box.scrollHeight;
  }

  try {

    const data =
      await api(
        "/api/ai",
        {
          method: "POST",

          body:
            JSON.stringify({
              mode:
                state.aiMode,

              message,

              context: {
                tasks:
                  state.tasks,

                exams:
                  state.exams,

                classes:
                  state.classes
              }
            })
        }
      );

    typing.remove();

    addAiMessage(
      "assistant",
      data.answer ||
      data.response ||
      "No he rebut cap resposta."
    );

  } catch (error) {

    typing.remove();

    addAiMessage(
      "assistant",
      "No he pogut processar la consulta. Torna-ho a provar."
    );

    showToastFromError(
      error
    );

  } finally {

    if (button) {
      button.disabled = false;
    }

  }
}


/* ============================================================
   TESTS GENERATS PER IA
============================================================ */

async function generateTest() {

  const topicInput =
    $("#test-topic");

  const topic =
    topicInput?.value.trim() ||
    "";

  if (!topic) {

    toast(
      "Escriu un tema per generar el test.",
      true
    );

    topicInput?.focus();

    return;
  }

  const container =
    $("#test-container");

  if (!container) return;

  container.innerHTML = `

    <div class="card empty-state">

      <span>
        ✦
      </span>

      <b>
        Preparant el test...
      </b>

      <small>
        La IA està creant 5 preguntes
        sobre ${esc(topic)}.
      </small>

    </div>

  `;

  try {

    const data =
      await api(
        "/api/ai/test",
        {
          method: "POST",

          body:
            JSON.stringify({
              topic,

              subject:
                $("#test-subject")
                  ?.value || "",

              difficulty:
                $("#test-difficulty")
                  ?.value ||
                "mitjana"
            })
        }
      );

    const questions =
      data.questions ||
      data.test?.questions ||
      [];

    renderTest(
      questions,
      topic
    );

  } catch (error) {

    container.innerHTML = `

      <div class="card empty-state">

        <span>!</span>

        <b>
          No s'ha pogut generar el test.
        </b>

        <small>
          ${esc(
            error.message ||
            "Error intern."
          )}
        </small>

      </div>

    `;

    showToastFromError(
      error
    );
  }
}

function renderTest(
  questions,
  topic
) {

  const container =
    $("#test-container");

  if (!container) return;

  if (!questions.length) {

    container.innerHTML = `
      <div class="card empty-state">

        <span>□</span>

        <b>
          No s'han generat preguntes.
        </b>

        <small>
          Prova amb un altre tema.
        </small>

      </div>
    `;

    return;
  }

  container.innerHTML = `

    <form
      id="test-form"
      class="test-form"
    >

      <div class="test-header">

        <div>

          <span class="eyebrow">
            TEST IA
          </span>

          <h2>
            ${esc(topic)}
          </h2>

        </div>

        <span>
          ${questions.length}
          preguntes
        </span>

      </div>

      ${questions
        .map(
          (question, index) => {

            const options =
              question.options ||
              question.answers ||
              [];

            return `

              <article
                class="test-question card"
              >

                <div
                  class="question-number"
                >
                  ${index + 1}
                </div>

                <h3>
                  ${esc(
                    question.question ||
                    question.text ||
                    ""
                  )}
                </h3>

                <div
                  class="question-options"
                >

                  ${options
                    .map(
                      (option, optionIndex) => {

                        const letter =
                          String.fromCharCode(
                            65 +
                            optionIndex
                          );

                        const value =
                          typeof option ===
                          "string"
                            ? option
                            : option.text ||
                              option.answer ||
                              "";

                        return `

                          <label
                            class="test-option"
                          >

                            <input
                              type="radio"
                              name="q-${index}"
                              value="${esc(
                                letter
                              )}"
                              required
                            >

                            <span
                              class="option-letter"
                            >
                              ${letter}
                            </span>

                            <span>
                              ${esc(
                                value
                              )}
                            </span>

                          </label>

                        `;

                      }
                    )
                    .join("")}

                </div>

              </article>

            `;

          }
        )
        .join("")}

      <div
        class="test-submit"
      >

        <button
          class="btn primary"
          type="submit"
        >
          Corregir test
        </button>

      </div>

    </form>
  `;

  $("#test-form").onsubmit =
    async (event) => {

      event.preventDefault();

      const form =
        new FormData(
          event.target
        );

      const answers =
        questions.map(
          (_, index) =>
            form.get(
              `q-${index}`
            )
        );

      try {

        const result =
          await api(
            "/api/test-results",
            {
              method: "POST",

              body:
                JSON.stringify({
                  topic,
                  answers,
                  questions
                })
            }
          );

        renderTestResult(
          result,
          questions
        );

      } catch (error) {

        /*
         * Compatibilitat amb versions
         * anteriors del backend.
         */
        try {

          const result =
            await api(
              "/api/tests/result",
              {
                method: "POST",

                body:
                  JSON.stringify({
                    topic,
                    answers,
                    questions
                  })
              }
            );

          renderTestResult(
            result,
            questions
          );

        } catch (secondError) {

          showToastFromError(
            secondError
          );

        }

      }

    };
}

function renderTestResult(
  result,
  questions
) {

  const container =
    $("#test-container");

  if (!container) return;

  const score =
    Number(
      result.score ??
      result.correct ??
      0
    );

  const total =
    Number(
      result.total ??
      questions.length
    );

  const percent =
    total
      ? Math.round(
          score /
          total *
          100
        )
      : 0;

  container.innerHTML = `

    <div class="test-result card">

      <span class="eyebrow">
        RESULTAT
      </span>

      <div class="test-score">
        ${percent}%
      </div>

      <h2>
        ${score}
        de
        ${total}
        correctes
      </h2>

      <p>
        ${
          result.message ||
          (
            percent >= 80
              ? "Molt bé. Continua practicant per consolidar-ho."
              : percent >= 50
                ? "Bon punt de partida. Repassa els conceptes que han costat més."
                : "Val la pena tornar a repassar el tema abans de fer un altre test."
          )
        }
      </p>

      <button
        class="btn secondary"
        id="new-test"
      >
        Fer un altre test
      </button>

    </div>

  `;

  $("#new-test").onclick =
    () => {

      container.innerHTML = "";

      $("#test-topic")
        ?.focus();

    };
}


/* ============================================================
   PERFIL
============================================================ */

function renderProfile() {

  if (!state.user) return;

  const name =
    state.user.name ||
    state.user.username ||
    "Alumne";

  if ($("#profile-name"))
    $("#profile-name")
      .textContent = name;

  if ($("#profile-email"))
    $("#profile-email")
      .textContent =
      state.user.email || "";

  if ($("#profile-role"))
    $("#profile-role")
      .textContent =
      state.user.role ===
      "professor"
        ? "Professor"
        : "Alumne";

  if ($("#profile-avatar"))
    $("#profile-avatar")
      .textContent =
      initials(name);

  if ($("#profile-created"))
    $("#profile-created")
      .textContent =
      state.user.created_at
        ? fmtDate(
            state.user.created_at
          )
        : "—";
}


/* ============================================================
   CALENDARI
============================================================ */

function renderCalendar() {

  const box =
    $("#calendar-grid");

  if (!box) return;

  const now =
    new Date();

  const year =
    now.getFullYear();

  const month =
    now.getMonth();

  const first =
    new Date(
      year,
      month,
      1
    );

  const last =
    new Date(
      year,
      month + 1,
      0
    );

  const startDay =
    (
      first.getDay() +
      6
    ) % 7;

  const total =
    last.getDate();

  const today =
    now.getDate();

  let html = "";

  for (
    let i = 0;
    i < startDay;
    i++
  ) {

    html += `
      <div class="calendar-cell muted">
      </div>
    `;

  }

  for (
    let day = 1;
    day <= total;
    day++
  ) {

    const iso =
      `${year}-${String(
        month + 1
      ).padStart(2, "0")}-${String(
        day
      ).padStart(2, "0")}`;

    const dayTasks =
      state.tasks.filter(
        (task) =>
          task.due_date ===
          iso
      );

    const dayExams =
      state.exams.filter(
        (exam) =>
          exam.exam_date ===
          iso
      );

    html += `

      <div
        class="calendar-cell ${
          day === today
            ? "today"
            : ""
        }"
      >

        <span>
          ${day}
        </span>

        ${
          dayTasks.length
            ? `
              <i
                class="calendar-task-dot"
                title="${
                  dayTasks.length
                } tasques"
              >
                ${dayTasks.length}
              </i>
            `
            : ""
        }

        ${
          dayExams.length
            ? `
              <i
                class="calendar-exam-dot"
                title="${
                  dayExams.length
                } exàmens"
              >
                E
              </i>
            `
            : ""
        }

      </div>

    `;

  }

  box.innerHTML =
    html;

  if ($("#calendar-month")) {

    $("#calendar-month")
      .textContent =
      now.toLocaleDateString(
        "ca-ES",
        {
          month: "long",
          year: "numeric"
        }
      );

  }
}

/* ============================================================
   FILTRES DE TASQUES
============================================================ */

function bindTaskFilters() {

  $$("[data-task-filter]")
    .forEach(
      (button) => {

        button.onclick = () => {

          state.taskFilter =
            button.dataset.taskFilter;

          $$("[data-task-filter]")
            .forEach(
              (item) =>
                item.classList.toggle(
                  "active",
                  item.dataset.taskFilter ===
                    state.taskFilter
                )
            );

          renderTasks();

        };

      }
    );

  const search =
    $("#task-search");

  if (search) {

    search.oninput = () => {

      state.taskSearch =
        search.value;

      renderTasks();

    };

  }
}


/* ============================================================
   CERCA GLOBAL
============================================================ */

function bindGlobalSearch() {

  const input =
    $("#global-search");

  if (!input) return;

  input.addEventListener(
    "keydown",
    (event) => {

      if (
        event.key !==
        "Enter"
      ) {
        return;
      }

      const query =
        input.value
          .trim()
          .toLowerCase();

      if (!query) return;

      const task =
        state.tasks.find(
          (item) =>
            (
              item.name +
              " " +
              (item.subject || "")
            )
              .toLowerCase()
              .includes(query)
        );

      if (task) {

        navigate(
          "tasks"
        );

        state.taskSearch =
          query;

        const search =
          $("#task-search");

        if (search) {
          search.value =
            query;
        }

        renderTasks();

        return;
      }

      const exam =
        state.exams.find(
          (item) =>
            (
              item.subject +
              " " +
              (item.syllabus || "")
            )
              .toLowerCase()
              .includes(query)
        );

      if (exam) {

        navigate(
          "exams"
        );

        return;
      }

      const classroom =
        state.classes.find(
          (item) =>
            (
              item.name +
              " " +
              item.code
            )
              .toLowerCase()
              .includes(query)
        );

      if (classroom) {

        navigate(
          "classes"
        );

        setTimeout(
          () =>
            openClassDetail(
              classroom.id
            ),
          100
        );

        return;
      }

      toast(
        "No he trobat cap resultat."
      );

    }
  );
}


/* ============================================================
   ACCIONS RÀPIDES
============================================================ */

function bindQuickActions() {

  $$("[data-action]")
    .forEach(
      (button) => {

        button.onclick = () => {

          const action =
            button.dataset.action;

          if (
            action ===
            "new-task"
          ) {

            openTaskModal();

            return;
          }

          if (
            action ===
            "new-exam"
          ) {

            openExamModal();

            return;
          }

          if (
            action ===
            "open-ai"
          ) {

            navigate(
              "ai"
            );

            $("#ai-input")
              ?.focus();

            return;
          }

          if (
            action ===
            "generate-test"
          ) {

            navigate(
              "ai"
            );

            setTimeout(
              () => {

                $(
                  "[data-ai-tool='test']"
                )?.click();

              },
              100
            );

            return;
          }

          if (
            action ===
            "new-class"
          ) {

            if (
              state.user?.role ===
              "professor"
            ) {

              navigate(
                "classes"
              );

              setTimeout(
                openClassCreate,
                100
              );

            } else {

              navigate(
                "classes"
              );

              setTimeout(
                openJoinModal,
                100
              );

            }

          }

        };

      }
    );
}


/* ============================================================
   MODALS I BOTONS GLOBALS
============================================================ */

function bindGlobalButtons() {

  $("#new-task-button")?.addEventListener(
    "click",
    () =>
      openTaskModal()
  );

  $("#new-exam-button")?.addEventListener(
    "click",
    () =>
      openExamModal()
  );

  $("#add-task")?.addEventListener(
    "click",
    () =>
      openTaskModal()
  );

  $("#add-exam")?.addEventListener(
    "click",
    () =>
      openExamModal()
  );

  $("#new-task-dashboard")?.addEventListener(
    "click",
    () =>
      openTaskModal()
  );

  $("#new-exam-dashboard")?.addEventListener(
    "click",
    () =>
      openExamModal()
  );

  $("#open-ai-dashboard")?.addEventListener(
    "click",
    () => {

      navigate(
        "ai"
      );

      $("#ai-input")
        ?.focus();

    }
  );

  $("#recalc-ai")?.addEventListener(
    "click",
    () =>
      renderRecommendations(
        true
      )
  );

  $("#generate-plan")?.addEventListener(
    "click",
    () =>
      generatePlan()
  );

  $("#planner-prev")?.addEventListener(
    "click",
    () => {

      state.weekOffset--;

      renderPlanner();

    }
  );

  $("#planner-next")?.addEventListener(
    "click",
    () => {

      state.weekOffset++;

      renderPlanner();

    }
  );

  $("#planner-today")?.addEventListener(
    "click",
    () => {

      state.weekOffset = 0;

      renderPlanner();

    }
  );

  $("#calendar-prev")?.addEventListener(
    "click",
    () =>
      toast(
        "El calendari mensual es mostrarà segons la vista seleccionada."
      )
  );

  $("#calendar-next")?.addEventListener(
    "click",
    () =>
      toast(
        "El calendari mensual es mostrarà segons la vista seleccionada."
      )
  );

  $("#calendar-today")?.addEventListener(
    "click",
    () =>
      renderCalendar()
  );

}


/* ============================================================
   IA — MODES
============================================================ */

function bindAiModes() {

  $$("[data-ai-mode]")
    .forEach(
      (button) => {

        button.addEventListener(
          "click",
          () =>
            setAiMode(
              button.dataset.aiMode
            )
        );

      }
    );

  $$("[data-ai-tool]")
    .forEach(
      (button) => {

        button.addEventListener(
          "click",
          () => {

            $$(
              "[data-ai-tool]"
            )
              .forEach(
                (item) =>
                  item.classList.toggle(
                    "active",
                    item === button
                  )
              );

            const tool =
              button.dataset.aiTool;

            const chat =
              $("#ai-chat");

            const test =
              $("#ai-test");

            if (tool === "test") {

              chat?.classList.add(
                "hidden"
              );

              test?.classList.remove(
                "hidden"
              );

              return;
            }

            test?.classList.add(
              "hidden"
            );

            chat?.classList.remove(
              "hidden"
            );

            setAiMode(
              tool === "explain"
                ? "EXPLICAR"
                : tool === "study"
                  ? "ESTUDIAR"
                  : tool === "summary"
                    ? "RESUMIR"
                    : "DUBTE"
            );

          }
        );

      }
    );

  setAiMode(
    "DUBTE"
  );
}


/* ============================================================
   FORMULARI D'IA
============================================================ */

function bindAiForm() {

  const form =
    $("#ai-form");

  if (!form) return;

  form.onsubmit =
    async (event) => {

      event.preventDefault();

      await sendAiMessage();

    };

  const input =
    $("#ai-input");

  if (input) {

    input.addEventListener(
      "keydown",
      (event) => {

        if (
          event.key ===
            "Enter" &&
          !event.shiftKey
        ) {

          event.preventDefault();

          form.requestSubmit();

        }

      }
    );

  }

  $("#test-generate")
    ?.addEventListener(
      "click",
      () =>
        generateTest()
    );

}


/* ============================================================
   LOGOUT
============================================================ */

async function logout() {

  try {

    await api(
      "/api/logout",
      {
        method: "POST"
      }
    );

  } catch {}

  state.user =
    null;

  state.tasks =
    [];

  state.exams =
    [];

  state.classes =
    [];

  $("#app-view")
    ?.classList.add(
      "hidden"
    );

  $("#auth-view")
    ?.classList.remove(
      "hidden"
    );

  toast(
    "Sessió tancada."
  );

}

function bindLogout() {

  $$(
    "#logout, #logout-button, [data-logout]"
  )
    .forEach(
      (button) => {

        button.onclick =
          () =>
            logout();

      }
    );

}


/* ============================================================
   LOGIN
============================================================ */

function bindLogin() {

  const form =
    $("#login-form");

  if (!form) return;

  form.onsubmit =
    async (event) => {

      event.preventDefault();

      const button =
        form.querySelector(
          "button[type='submit']"
        );

      if (button) {
        button.disabled =
          true;
      }

      const data =
        Object.fromEntries(
          new FormData(
            form
          ).entries()
        );

      try {

        const result =
          await api(
            "/api/login",
            {
              method: "POST",

              body:
                JSON.stringify(
                  data
                )
            }
          );

        if (result.user) {

          $("#auth-view")
            ?.classList.add(
              "hidden"
            );

          $("#app-view")
            ?.classList.remove(
              "hidden"
            );

          setUser(
            result.user
          );

          await loadDashboard();

          navigate(
            "dashboard"
          );

          form.reset();

        } else {

          toast(
            "No s'ha pogut iniciar sessió.",
            true
          );

        }

      } catch (error) {

        showToastFromError(
          error
        );

      } finally {

        if (button) {
          button.disabled =
            false;
        }

      }

    };
}


/* ============================================================
   REGISTRE
============================================================ */

function bindRegister() {

  const form =
    $("#register-form");

  if (!form) return;

  form.onsubmit =
    async (event) => {

      event.preventDefault();

      const data =
        Object.fromEntries(
          new FormData(
            form
          ).entries()
        );

      if (
        data.password !==
        data.password_confirm
      ) {

        toast(
          "Les contrasenyes no coincideixen.",
          true
        );

        return;
      }

      try {

        const result =
          await api(
            "/api/register",
            {
              method: "POST",

              body:
                JSON.stringify(
                  data
                )
            }
          );

        toast(
          result.message ||
          "Compte creat correctament."
        );

        form.reset();

        /*
         * Si el backend inicia sessió
         * automàticament després del registre.
         */
        if (result.user) {

          $("#auth-view")
            ?.classList.add(
              "hidden"
            );

          $("#app-view")
            ?.classList.remove(
              "hidden"
            );

          setUser(
            result.user
          );

          await loadDashboard();

          navigate(
            "dashboard"
          );

          return;
        }

        /*
         * Si no inicia sessió,
         * tornem al formulari de login.
         */
        $("#show-login")
          ?.click();

      } catch (error) {

        showToastFromError(
          error
        );

      }

    };
}


/* ============================================================
   CANVI LOGIN / REGISTRE
============================================================ */

function bindAuthSwitch() {

  $("#show-register")
    ?.addEventListener(
      "click",
      () => {

        $("#login-panel")
          ?.classList.add(
            "hidden"
          );

        $("#register-panel")
          ?.classList.remove(
            "hidden"
          );

      }
    );

  $("#show-login")
    ?.addEventListener(
      "click",
      () => {

        $("#register-panel")
          ?.classList.add(
            "hidden"
          );

        $("#login-panel")
          ?.classList.remove(
            "hidden"
          );

      }
    );

}
/* ============================================================
   UI MÒBIL
============================================================ */

function bindMobileMenu() {

  const button =
    $("#mobile-menu");

  const sidebar =
    $(".sidebar");

  if (
    !button ||
    !sidebar
  ) {
    return;
  }

  button.onclick = () => {

    sidebar.classList.toggle(
      "mobile-open"
    );

  };

  $$(".nav-item")
    .forEach(
      (item) => {

        item.addEventListener(
          "click",
          () => {

            sidebar.classList.remove(
              "mobile-open"
            );

          }
        );

      }
    );
}


/* ============================================================
   PERFIL / COMPTE
============================================================ */

function bindProfile() {

  const profileButton =
    $("#profile-button");

  if (profileButton) {

    profileButton.onclick =
      () =>
        navigate(
          "profile"
        );

  }

  const avatar =
    $("#top-avatar");

  if (avatar) {

    avatar.onclick =
      () =>
        navigate(
          "profile"
        );

  }

  const profileEdit =
    $("#profile-edit");

  if (profileEdit) {

    profileEdit.onclick =
      () => {

        toast(
          "La informació del perfil es gestiona des del compte."
        );

      };

  }

}


/* ============================================================
   NOTIFICACIONS
============================================================ */

function renderNotifications() {

  const button =
    $("#notifications-button");

  const panel =
    $("#notifications-panel");

  if (
    !button ||
    !panel
  ) {
    return;
  }

  const notifications = [];

  const urgentTasks =
    state.tasks.filter(
      (task) =>
        task.status !==
          "completada" &&
        daysUntil(
          task.due_date
        ) <= 2 &&
        daysUntil(
          task.due_date
        ) >= 0
    );

  urgentTasks.forEach(
    (task) => {

      notifications.push({

        title:
          "Entrega propera",

        text:
          `${task.name} · ${fmtDate(
            task.due_date
          )}`,

        type:
          "task"

      });

    }
  );

  const upcomingExams =
    state.exams.filter(
      (exam) =>
        daysUntil(
          exam.exam_date
        ) <= 7 &&
        daysUntil(
          exam.exam_date
        ) >= 0
    );

  upcomingExams.forEach(
    (exam) => {

      notifications.push({

        title:
          "Examen proper",

        text:
          `${exam.subject} · ${fmtDate(
            exam.exam_date
          )}`,

        type:
          "exam"

      });

    }
  );

  if (!notifications.length) {

    panel.innerHTML = `

      <div class="notification-empty">

        <span>✓</span>

        <b>
          Tot al dia
        </b>

        <small>
          No tens avisos nous.
        </small>

      </div>

    `;

  } else {

    panel.innerHTML =
      notifications
        .slice(0, 8)
        .map(
          (item) => `

            <div
              class="notification-item"
            >

              <div
                class="notification-icon ${item.type}"
              >
                ${
                  item.type ===
                  "exam"
                    ? "E"
                    : "T"
                }
              </div>

              <div>

                <strong>
                  ${esc(
                    item.title
                  )}
                </strong>

                <small>
                  ${esc(
                    item.text
                  )}
                </small>

              </div>

            </div>

          `
        )
        .join("");

  }

}

function bindNotifications() {

  const button =
    $("#notifications-button");

  const panel =
    $("#notifications-panel");

  if (
    !button ||
    !panel
  ) {
    return;
  }

  button.onclick =
    (event) => {

      event.stopPropagation();

      panel.classList.toggle(
        "hidden"
      );

      if (
        !panel.classList.contains(
          "hidden"
        )
      ) {
        renderNotifications();
      }

    };

  document.addEventListener(
    "click",
    (event) => {

      if (
        !panel.contains(
          event.target
        ) &&
        event.target !== button
      ) {

        panel.classList.add(
          "hidden"
        );

      }

    }
  );

}


/* ============================================================
   MODAL GLOBAL
============================================================ */

function bindModalRoot() {

  const root =
    $("#modal-root");

  if (!root) return;

  root.addEventListener(
    "click",
    (event) => {

      if (
        event.target.classList.contains(
          "modal-backdrop"
        )
      ) {

        root.innerHTML = "";

      }

    }
  );

  document.addEventListener(
    "keydown",
    (event) => {

      if (
        event.key ===
        "Escape"
      ) {

        root.innerHTML = "";

      }

    }
  );

}


/* ============================================================
   TECLAT RÀPID
============================================================ */

function bindKeyboardShortcuts() {

  document.addEventListener(
    "keydown",
    (event) => {

      if (
        event.metaKey ||
        event.ctrlKey ||
        event.altKey
      ) {
        return;
      }

      const active =
        document.activeElement;

      const typing =
        active &&
        (
          active.tagName ===
            "INPUT" ||
          active.tagName ===
            "TEXTAREA" ||
          active.tagName ===
            "SELECT"
        );

      if (typing) {
        return;
      }

      if (
        event.key ===
        "t"
      ) {

        navigate(
          "tasks"
        );

      }

      if (
        event.key ===
        "e"
      ) {

        navigate(
          "exams"
        );

      }

      if (
        event.key ===
        "c"
      ) {

        navigate(
          "classes"
        );

      }

      if (
        event.key ===
        "a"
      ) {

        navigate(
          "ai"
        );

      }

    }
  );

}


/* ============================================================
   BOTONS DEL DASHBOARD
============================================================ */

function bindDashboardButtons() {

  const tasksButton =
    $("#dashboard-see-tasks");

  if (tasksButton) {

    tasksButton.onclick =
      () =>
        navigate(
          "tasks"
        );

  }

  const aiButton =
    $("#dashboard-open-ai");

  if (aiButton) {

    aiButton.onclick =
      () => {

        navigate(
          "ai"
        );

        setTimeout(
          () =>
            $("#ai-input")
              ?.focus(),
          100
        );

      };

  }

  const plannerButton =
    $("#dashboard-open-planner");

  if (plannerButton) {

    plannerButton.onclick =
      () =>
        navigate(
          "planner"
        );

  }

  const classesButton =
    $("#dashboard-open-classes");

  if (classesButton) {

    classesButton.onclick =
      () =>
        navigate(
          "classes"
        );

  }

}


/* ============================================================
   CLASSES — ACTUALITZACIÓ DESPRÉS DE CREAR / UNIR-SE
============================================================ */

async function refreshClasses() {

  try {

    await loadClasses();

  } catch (error) {

    showToastFromError(
      error
    );

  }

}


/* ============================================================
   REFRESCAR DADES
============================================================ */

async function refreshAll() {

  try {

    const me =
      await api(
        "/api/me"
      );

    if (me.user) {

      setUser(
        me.user
      );

    }

    await loadDashboard();

    if (
      state.section ===
      "classes"
    ) {

      await loadClasses();

    }

    if (
      state.section ===
      "progress"
    ) {

      await loadProgress();

    }

    renderNotifications();

  } catch (error) {

    showToastFromError(
      error
    );

  }

}


/* ============================================================
   DETECCIÓ DE PÀGINA / SECCIÓ INICIAL
============================================================ */

function detectInitialSection() {

  const hash =
    window.location.hash
      .replace(
        "#",
        ""
      )
      .trim();

  const valid = [
    "dashboard",
    "tasks",
    "exams",
    "planner",
    "classes",
    "ai",
    "progress",
    "profile"
  ];

  if (
    valid.includes(
      hash
    )
  ) {

    state.section =
      hash;

  } else {

    state.section =
      "dashboard";

  }

}


/* ============================================================
   HASH DE NAVEGACIÓ
============================================================ */

function bindHashNavigation() {

  window.addEventListener(
    "hashchange",
    () => {

      const hash =
        window.location.hash
          .replace(
            "#",
            ""
          );

      const valid = [
        "dashboard",
        "tasks",
        "exams",
        "planner",
        "classes",
        "ai",
        "progress",
        "profile"
      ];

      if (
        valid.includes(
          hash
        )
      ) {

        navigate(
          hash
        );

      }

    }
  );

}


/* ============================================================
   SOBRECÀRREGA DE NAVIGATE PER ACTUALITZAR HASH
============================================================ */

const originalNavigate =
  navigate;

navigate = function(section) {

  originalNavigate(
    section
  );

  try {

    history.replaceState(
      null,
      "",
      "#" + section
    );

  } catch {}

};


/* ============================================================
   BOTONS DE NAVEGACIÓ DE PLANIFICADOR
============================================================ */

function bindPlannerControls() {

  $("#planner-add-session")
    ?.addEventListener(
      "click",
      () => {

        toast(
          "Les sessions es poden adaptar a partir de les teves tasques i exàmens."
        );

      }
    );

  $("#planner-regenerate")
    ?.addEventListener(
      "click",
      () =>
        generatePlan()
    );

}


/* ============================================================
   BOTONS DE CALENDARI
============================================================ */

function bindCalendarControls() {

  $("#open-calendar")
    ?.addEventListener(
      "click",
      () =>
        navigate(
          "dashboard"
        )
    );

  $("#calendar-refresh")
    ?.addEventListener(
      "click",
      () =>
        refreshAll()
    );

}


/* ============================================================
   ACTUALITZACIÓ AUTOMÀTICA SUAU
============================================================ */

let refreshTimer = null;

function startRefreshTimer() {

  if (refreshTimer) {

    clearInterval(
      refreshTimer
    );

  }

  refreshTimer =
    setInterval(
      async () => {

        if (
          document.hidden
        ) {
          return;
        }

        try {

          const me =
            await api(
              "/api/me"
            );

          if (
            me.user
          ) {

            await loadDashboard();

            if (
              state.section ===
              "classes"
            ) {

              await loadClasses();

            }

          }

        } catch {}

      },
      120000
    );

}


/* ============================================================
   FORMULARI DE PERFIL
============================================================ */

function bindProfileForm() {

  const form =
    $("#profile-form");

  if (!form) return;

  form.onsubmit =
    async (event) => {

      event.preventDefault();

      const data =
        Object.fromEntries(
          new FormData(
            form
          ).entries()
        );

      try {

        const result =
          await api(
            "/api/profile",
            {
              method: "PUT",

              body:
                JSON.stringify(
                  data
                )
            }
          );

        if (result.user) {

          setUser(
            result.user
          );

        }

        toast(
          "Perfil actualitzat."
        );

      } catch (error) {

        /*
         * Si encara no existeix
         * l'endpoint de perfil,
         * no bloquegem la resta de l'app.
         */
        showToastFromError(
          error
        );

      }

    };

}


/* ============================================================
   ESTAT VISUAL DE CÀRREGA
============================================================ */

function setLoading(
  selector,
  loading,
  text = "Carregant..."
) {

  const element =
    $(selector);

  if (!element) return;

  if (loading) {

    element.dataset.previousText =
      element.textContent;

    element.disabled =
      true;

    element.textContent =
      text;

  } else {

    element.disabled =
      false;

    if (
      element.dataset.previousText
    ) {

      element.textContent =
        element.dataset.previousText;

    }

  }

}


/* ============================================================
   INICIALITZACIÓ DE L'APP
============================================================ */

async function initApp() {

  detectInitialSection();

  bindNav();

  bindLogin();

  bindRegister();

  bindAuthSwitch();

  bindLogout();

  bindTaskFilters();

  bindAiModes();

  bindAiForm();

  bindGlobalButtons();

  bindQuickActions();

  bindMobileMenu();

  bindProfile();

  bindNotifications();

  bindModalRoot();

  bindKeyboardShortcuts();

  bindDashboardButtons();

  bindPlannerControls();

  bindCalendarControls();

  bindGlobalSearch();

  bindProfileForm();

  bindHashNavigation();

  renderCalendar();

  renderProfile();

  /*
   * Comprovem si ja hi ha una sessió.
   */
  await boot();

  /*
   * Un cop l'app ja és carregada,
   * mostrem la secció inicial.
   */
  if (
    state.user
  ) {

    navigate(
      state.section
    );

    renderProfile();

    renderCalendar();

    renderNotifications();

  }

  startRefreshTimer();

}


/* ============================================================
   INICI
============================================================ */

if (
  document.readyState ===
  "loading"
) {

  document.addEventListener(
    "DOMContentLoaded",
    initApp
  );

} else {

  initApp();

}

/* ============================================================
   FINAL — UTILITATS DE COMPATIBILITAT
============================================================ */

/*
 * Alguns elements de versions anteriors de MiniClassroom
 * poden existir o no segons la versió de l'index.html.
 * Aquest bloc els connecta sense donar errors si no existeixen.
 */

function bindOptionalButtons() {

  const optionalActions = {

    "open-tasks":
      () => navigate("tasks"),

    "open-exams":
      () => navigate("exams"),

    "open-planner":
      () => navigate("planner"),

    "open-classes":
      () => navigate("classes"),

    "open-ai":
      () => navigate("ai"),

    "open-progress":
      () => navigate("progress"),

    "open-profile":
      () => navigate("profile"),

    "create-task":
      () => openTaskModal(),

    "create-exam":
      () => openExamModal(),

    "create-class":
      () => {

        navigate("classes");

        setTimeout(
          () => {

            if (
              state.user?.role ===
              "professor"
            ) {

              openClassCreate();

            } else {

              openJoinModal();

            }

          },
          100
        );

      },

    "refresh":
      () => refreshAll()

  };

  Object.entries(
    optionalActions
  ).forEach(
    ([action, handler]) => {

      $$(
        `[data-action="${action}"]`
      )
        .forEach(
          (button) => {

            button.addEventListener(
              "click",
              handler
            );

          }
        );

    }
  );

}


/* ============================================================
   ENLLAÇOS DIRECTES DE LA SIDEBAR
============================================================ */

function bindSidebar() {

  const items =
    $$(".nav-item");

  items.forEach(
    (item) => {

      item.addEventListener(
        "click",
        () => {

          const section =
            item.dataset.section;

          if (!section) {
            return;
          }

          navigate(
            section
          );

        }
      );

    }
  );

}


/* ============================================================
   DETECCIÓ DEL ROL
============================================================ */

function applyRoleUI() {

  if (!state.user) {
    return;
  }

  const isProfessor =
    state.user.role ===
    "professor";

  /*
   * Elements exclusius del professor.
   */
  $$("[data-role='professor']")
    .forEach(
      (element) => {

        element.classList.toggle(
          "hidden",
          !isProfessor
        );

      }
    );

  /*
   * Elements exclusius de l'alumne.
   */
  $$("[data-role='student']")
    .forEach(
      (element) => {

        element.classList.toggle(
          "hidden",
          isProfessor
        );

      }
    );

}


/* ============================================================
   ACTUALITZAR ROL DESPRÉS DEL LOGIN
============================================================ */

const originalSetUser =
  setUser;

setUser = function(user) {

  originalSetUser(
    user
  );

  applyRoleUI();

  renderProfile();

};


/* ============================================================
   CONTROL D'ERRORS GLOBALS
============================================================ */

window.addEventListener(
  "unhandledrejection",
  (event) => {

    console.error(
      "MiniClassroom:",
      event.reason
    );

  }
);

window.addEventListener(
  "error",
  (event) => {

    console.error(
      "MiniClassroom:",
      event.error ||
      event.message
    );

  }
);


/* ============================================================
   PREVENIR DOBLE ENVÍO DE FORMULARIS
============================================================ */

document.addEventListener(
  "submit",
  (event) => {

    const form =
      event.target;

    if (
      !form ||
      !form.matches(
        "form"
      )
    ) {
      return;
    }

    if (
      form.dataset.submitting ===
      "true"
    ) {

      event.preventDefault();

      return;

    }

  }
);


/* ============================================================
   ESTAT DE CONNEXIÓ
============================================================ */

function updateConnectionState() {

  const indicator =
    $("#connection-status");

  if (!indicator) {
    return;
  }

  const online =
    navigator.onLine;

  indicator.classList.toggle(
    "offline",
    !online
  );

  indicator.textContent =
    online
      ? "Connectat"
      : "Sense connexió";

}

window.addEventListener(
  "online",
  updateConnectionState
);

window.addEventListener(
  "offline",
  updateConnectionState
);


/* ============================================================
   PREPARAR COMPONENTS OPCIONALS
============================================================ */

function prepareOptionalComponents() {

  bindOptionalButtons();

  bindSidebar();

  updateConnectionState();

}


/* ============================================================
   ARRANCADA FINAL
============================================================ */

const previousInitApp =
  initApp;

initApp = async function() {

  prepareOptionalComponents();

  await previousInitApp();

  applyRoleUI();

  renderProfile();

  renderNotifications();

};


/* ============================================================
   SEGURETAT BÀSICA DE NAVEGACIÓ
============================================================ */

document.addEventListener(
  "click",
  (event) => {

    const link =
      event.target.closest(
        "a"
      );

    if (!link) {
      return;
    }

    const href =
      link.getAttribute(
        "href"
      );

    /*
     * Els enllaços interns no han
     * de provocar recàrregues innecessàries.
     */
    if (
      href &&
      href.startsWith("#")
    ) {

      event.preventDefault();

      const section =
        href
          .replace(
            "#",
            ""
          );

      navigate(
        section
      );

    }

  }
);


/* ============================================================
   FINAL
============================================================ */

/*
 * MiniClassroom
 *
 * Aplicació educativa amb:
 * - autenticació
 * - tasques
 * - exàmens
 * - planificador
 * - classes
 * - aula digital
 * - IA d'estudi
 * - tests
 * - progrés
 * - perfil
 *
 * Fi del fitxer.
 */
