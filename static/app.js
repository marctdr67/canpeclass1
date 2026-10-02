/* =========================================================
   MINICLASSROOM
   App principal
   Institut Can Peixauet
========================================================= */

(() => {
  "use strict";

  /* =======================================================
     ESTAT
  ======================================================= */

  const state = {
    user: null,

    tasks: [],
    exams: [],
    classes: [],
    dashboard: null,
    progress: null,
    studySessions: [],
    testHistory: [],

    currentSection: "dashboard",
    currentClass: null,

    taskFilter: "totes",
    taskSearch: "",

    aiMode: "DUBTE",

    calendarOffset: 0,
    plannerOffset: 0,

    loading: false
  };


  /* =======================================================
     HELPERS DOM
  ======================================================= */

  const $ = (selector, root = document) =>
    root.querySelector(selector);

  const $$ = (selector, root = document) =>
    Array.from(root.querySelectorAll(selector));


  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }


  function initials(name) {
    const text = String(name || "U").trim();

    if (!text) return "U";

    return text
      .split(/\s+/)
      .slice(0, 2)
      .map(x => x[0])
      .join("")
      .toUpperCase();
  }


  function formatDate(value, options = {}) {
    if (!value) return "—";

    const date = new Date(`${String(value).slice(0, 10)}T12:00:00`);

    if (Number.isNaN(date.getTime())) {
      return String(value);
    }

    return new Intl.DateTimeFormat(
      "ca-ES",
      {
        day: "numeric",
        month: "short",
        ...options
      }
    ).format(date);
  }


  function formatLongDate(value) {
    if (!value) return "—";

    const date = new Date(`${String(value).slice(0, 10)}T12:00:00`);

    if (Number.isNaN(date.getTime())) {
      return String(value);
    }

    return new Intl.DateTimeFormat(
      "ca-ES",
      {
        weekday: "long",
        day: "numeric",
        month: "long"
      }
    ).format(date);
  }


  function daysUntil(value) {
    if (!value) return null;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);

    return Math.round(
      (date - today) / 86400000
    );
  }


  function difficultyLabel(value) {
    const normalized = String(value || "").toLowerCase();

    if (
      normalized === "alta" ||
      normalized === "3"
    ) {
      return "Alta";
    }

    if (
      normalized === "baixa" ||
      normalized === "1"
    ) {
      return "Baixa";
    }

    return "Mitjana";
  }


  function difficultyValue(value) {
    const normalized = String(value || "").toLowerCase();

    if (
      normalized === "alta" ||
      normalized === "3"
    ) {
      return "alta";
    }

    if (
      normalized === "baixa" ||
      normalized === "1"
    ) {
      return "baixa";
    }

    return "mitjana";
  }


  function statusLabel(status) {
    if (status === "completada") return "Completada";
    if (status === "en procés") return "En procés";
    return "Pendent";
  }


  function showToast(message, type = "info") {
    const root = $("#toast-root");

    if (!root) return;

    const toast = document.createElement("div");

    toast.className = `toast ${type}`;

    toast.textContent = message;

    root.appendChild(toast);

    setTimeout(() => {
      toast.remove();
    }, 3500);
  }


  function showError(error) {
    showToast(
      error?.message ||
      "S'ha produït un error.",
      "error"
    );
  }


  /* =======================================================
     API
  ======================================================= */

  async function api(
    url,
    options = {}
  ) {
    const config = {
      credentials: "same-origin",
      ...options
    };

    if (
      config.body &&
      typeof config.body !== "string"
    ) {
      config.headers = {
        "Content-Type": "application/json",
        ...(config.headers || {})
      };

      config.body = JSON.stringify(config.body);
    }

    const response = await fetch(
      url,
      config
    );

    let data = null;

    try {
      data = await response.json();
    } catch {
      data = {};
    }

    if (!response.ok || data.ok === false) {
      throw new Error(
        data.error ||
        `Error ${response.status}`
      );
    }

    return data;
  }


  /* =======================================================
     AUTENTICACIÓ
  ======================================================= */

  function showAuthMessage(message) {
    const box = $("#auth-message");

    if (box) {
      box.textContent = message || "";
    }
  }


  function setAuthTab(mode) {
    const login = $("#login-form");
    const register = $("#register-form");

    $$(".auth-tab").forEach(tab => {
      tab.classList.toggle(
        "active",
        tab.dataset.auth === mode
      );
    });

    if (login) {
      login.classList.toggle(
        "hidden",
        mode !== "login"
      );
    }

    if (register) {
      register.classList.toggle(
        "hidden",
        mode !== "register"
      );
    }

    showAuthMessage("");
  }


  async function login(event) {
    event.preventDefault();

    const form = event.currentTarget;

    const data = Object.fromEntries(
      new FormData(form).entries()
    );

    const button = $("button[type='submit']", form);

    if (button) {
      button.disabled = true;
      button.textContent = "Entrant...";
    }

    try {
      const result = await api(
        "/api/login",
        {
          method: "POST",
          body: data
        }
      );

      state.user = result.user;

      showToast(
        "Sessió iniciada correctament.",
        "success"
      );

      await bootApp();

    } catch (error) {

      showAuthMessage(error.message);

    } finally {

      if (button) {
        button.disabled = false;
        button.innerHTML = "Entrar <span>→</span>";
      }

    }
  }


  async function register(event) {
    event.preventDefault();

    const form = event.currentTarget;

    const data = Object.fromEntries(
      new FormData(form).entries()
    );

    try {

      const result = await api(
        "/api/register",
        {
          method: "POST",
          body: data
        }
      );

      state.user = result.user;

      showToast(
        "Compte creat correctament.",
        "success"
      );

      await bootApp();

    } catch (error) {

      showAuthMessage(error.message);

    }
  }


  async function logout() {
    try {
      await api(
        "/api/logout",
        {
          method: "POST"
        }
      );
    } catch {
      // Encara que falli el servidor,
      // tanquem la interfície local.
    }

    state.user = null;

    $("#app-view")?.classList.add("hidden");
    $("#auth-view")?.classList.remove("hidden");

    setAuthTab("login");

    showToast(
      "Sessió tancada.",
      "success"
    );
  }


  /* =======================================================
     USUARI
  ======================================================= */

  function setUser(user) {
    state.user = user;

    const name =
      user?.username ||
      user?.name ||
      "Usuari";

    const role =
      user?.role === "professor"
        ? "Professor"
        : "Alumne";

    const initial = initials(name);

    const ids = [
      "side-name",
      "top-name",
      "profile-name"
    ];

    ids.forEach(id => {
      const element = $(`#${id}`);

      if (element) {
        element.textContent = name;
      }
    });


    ["side-role", "top-role"].forEach(id => {
      const element = $(`#${id}`);

      if (element) {
        element.textContent = role;
      }
    });


    const email = $("#profile-email");

    if (email) {
      email.textContent = user?.email || "—";
    }


    const profileRole = $("#profile-role");

    if (profileRole) {
      profileRole.textContent = role;
    }


    [
      "#side-avatar",
      "#top-avatar",
      "#profile-avatar"
    ].forEach(selector => {
      const element = $(selector);

      if (element) {
        element.textContent = initial;
      }
    });


    applyRolePermissions();
  }


  function applyRolePermissions() {
    const professor =
      state.user?.role === "professor";

    const classActions =
      $("#class-actions");

    if (!classActions) return;

    if (professor) {

      classActions.innerHTML = `
        <button
          class="btn btn-yellow"
          id="create-class"
        >
          ＋ Crear classe
        </button>
      `;

      $("#create-class")
        ?.addEventListener(
          "click",
          openClassCreateModal
        );

    } else {

      classActions.innerHTML = `
        <button
          class="btn btn-blue"
          id="join-class"
        >
          ＋ Unir-me a una classe
        </button>
      `;

      $("#join-class")
        ?.addEventListener(
          "click",
          openJoinClassModal
        );
    }
  }


  /* =======================================================
     ARRANCADA
  ======================================================= */

  async function boot() {

    try {

      const result = await api(
        "/api/me"
      );

      state.user = result.user;

      await bootApp();

    } catch {

      $("#auth-view")?.classList.remove("hidden");
      $("#app-view")?.classList.add("hidden");

    }
  }


  async function bootApp() {

    $("#auth-view")?.classList.add("hidden");
    $("#app-view")?.classList.remove("hidden");

    setUser(state.user);

    bindApplicationEvents();

    await refreshAll();

    navigate("dashboard");
  }


  async function refreshAll() {

    try {
      await Promise.all([
        loadDashboard(),
        loadTasks(),
        loadExams(),
        loadClasses(),
        loadProgress(),
        loadStudySessions(),
        loadTestHistory()
      ]);

    } catch (error) {
      showError(error);
    }
  }


  /* =======================================================
     NAVEGACIÓ
  ======================================================= */

  function navigate(section) {

    if (!section) {
      section = "dashboard";
    }

    state.currentSection = section;

    $$(".section").forEach(item => {
      item.classList.toggle(
        "active",
        item.id === `section-${section}`
      );
    });


    $$(".nav-item").forEach(item => {
      item.classList.toggle(
        "active",
        item.dataset.section === section
      );
    });


    if (section === "dashboard") {
      loadDashboard();
    }

    if (section === "tasks") {
      loadTasks();
    }

    if (section === "exams") {
      loadExams();
    }

    if (section === "classes") {
      loadClasses();
    }

    if (section === "calendar") {
      renderCalendar();
    }

    if (section === "planner") {
      renderPlanner();
    }

    if (section === "progress") {
      loadProgress();
      loadTestHistory();
    }

    if (section === "ai") {
      focusAI();
    }


    window.scrollTo({
      top: 0,
      behavior: "smooth"
    });
  }


  /* =======================================================
     DASHBOARD
  ======================================================= */

  async function loadDashboard() {

    const data = await api(
      "/api/dashboard"
    );

    state.dashboard = data;

    state.tasks = data.tasks || state.tasks;
    state.exams = data.exams || state.exams;

    updateDashboardStats(data);

    renderDashboardTasks();

    renderDashboardExams();

    await loadClasses();

    renderAgenda();
  }


  function updateDashboardStats(data) {

    const pending =
      data.pending_count ??
      data.stats?.pending ??
      0;

    const urgent =
      data.urgent_count ??
      data.stats?.urgent ??
      0;

    const progress =
      data.progress ??
      data.stats?.progress ??
      0;

    const completed =
      data.stats?.completed ??
      0;

    const exams =
      data.stats?.exams ??
      state.exams.length;

    const studyCompleted =
      data.study?.completed ??
      data.stats?.study_minutes ??
      0;

    const studyPlanned =
      data.study?.planned ??
      0;


    $("#stat-pending").textContent = pending;

    $("#stat-completed").textContent =
      `${completed} completades`;

    $("#stat-exams").textContent = exams;

    $("#stat-progress").textContent =
      `${progress}%`;

    $("#stat-urgent").textContent = urgent;

    $("#stat-study").textContent =
      `${studyCompleted} / ${studyPlanned} min`;
  }


  function renderDashboardTasks() {

    const container =
      $("#dashboard-tasks");

    if (!container) return;

    const tasks = state.tasks
      .filter(t => t.status !== "completada")
      .sort(sortTasks)
      .slice(0, 4);


    if (!tasks.length) {

      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">✓</div>
          <strong>No tens tasques pendents.</strong>
          <small>
            Quan n'afegeixis, apareixeran aquí.
          </small>
        </div>
      `;

      return;
    }


    container.innerHTML =
      tasks.map(task => `
        <div class="compact-item">

          <span class="compact-marker">
            ✓
          </span>

          <div>
            <strong>
              ${escapeHtml(task.name)}
            </strong>

            <small>
              ${escapeHtml(task.subject || "Sense assignatura")}
              ·
              ${task.due_date
                ? escapeHtml(formatDate(task.due_date))
                : "Sense data"}
            </small>
          </div>

        </div>
      `).join("");
  }


  function renderDashboardExams() {

    const container =
      $("#dashboard-exams");

    if (!container) return;

    const exams = [...state.exams]
      .sort((a, b) =>
        String(a.exam_date)
          .localeCompare(String(b.exam_date))
      )
      .slice(0, 4);


    if (!exams.length) {

      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">▣</div>
          <strong>No hi ha exàmens.</strong>
          <small>
            Afegeix-ne un per començar a preparar-lo.
          </small>
        </div>
      `;

      return;
    }


    container.innerHTML =
      exams.map(exam => {

        const days =
          daysUntil(exam.exam_date);

        let label = formatDate(
          exam.exam_date
        );

        if (days === 0) {
          label = "Avui";
        } else if (days === 1) {
          label = "Demà";
        }

        return `
          <div class="compact-item">

            <span class="compact-marker"
                  style="
                    color:#ff656a;
                    background:rgba(237,28,36,.13)
                  ">
              ▣
            </span>

            <div>
              <strong>
                ${escapeHtml(exam.subject)}
              </strong>

              <small>
                ${escapeHtml(label)}
                ·
                ${escapeHtml(
                  difficultyLabel(exam.difficulty)
                )}
              </small>
            </div>

          </div>
        `;
      }).join("");
  }


  function renderDashboardClasses() {

    const container =
      $("#dashboard-classes");

    if (!container) return;

    const classes =
      state.classes.slice(0, 4);


    if (!classes.length) {

      container.innerHTML = `
        <div class="empty-state"
             style="grid-column:1/-1">

          <div class="empty-state-icon">
            ⌘
          </div>

          <strong>
            Encara no tens classes.
          </strong>

          <small>
            Uneix-te a una classe o crea'n una.
          </small>

        </div>
      `;

      return;
    }


    container.innerHTML =
      classes.map(renderClassCard).join("");
  }


  function renderAgenda() {

    const container =
      $("#agenda-list");

    if (!container) return;

    const todayISO =
      new Date().toISOString().slice(0, 10);

    const events = [];


    state.tasks
      .filter(t =>
        t.status !== "completada" &&
        t.due_date
      )
      .forEach(task => {

        if (
          String(task.due_date).slice(0, 10)
          === todayISO
        ) {
          events.push({
            time: "Avui",
            title: task.name,
            subtitle: task.subject || "Tasca",
            type: "task"
          });
        }

      });


    state.exams
      .filter(exam =>
        String(exam.exam_date).slice(0, 10)
        === todayISO
      )
      .forEach(exam => {

        events.push({
          time: "Avui",
          title: `Examen de ${exam.subject}`,
          subtitle: "Examen",
          type: "red"
        });

      });


    if (!events.length) {

      container.innerHTML = `
        <div class="empty-state">

          <div class="empty-state-icon">
            ✓
          </div>

          <strong>
            Avui està lliure.
          </strong>

          <small>
            No tens cap activitat registrada per avui.
          </small>

        </div>
      `;

      return;
    }


    container.innerHTML =
      events.map(event => `
        <div class="agenda-item ${event.type}">

          <span class="agenda-time">
            ${escapeHtml(event.time)}
          </span>

          <span class="agenda-dot"></span>

          <div>
            <strong>
              ${escapeHtml(event.title)}
            </strong>

            <small>
              ${escapeHtml(event.subtitle)}
            </small>
          </div>

        </div>
      `).join("");
  }


  /* =======================================================
     TASQUES
  ======================================================= */

  async function loadTasks() {

    const data =
      await api("/api/tasks");

    state.tasks =
      data.tasks || [];

    renderTasks();

    renderDashboardTasks();
  }


  function sortTasks(a, b) {

    const statusOrder = {
      "pendent": 0,
      "en procés": 1,
      "completada": 2
    };

    const statusA =
      statusOrder[a.status] ?? 3;

    const statusB =
      statusOrder[b.status] ?? 3;

    if (statusA !== statusB) {
      return statusA - statusB;
    }

    return String(a.due_date || "9999")
      .localeCompare(
        String(b.due_date || "9999")
      );
  }


  function filteredTasks() {

    return state.tasks
      .filter(task => {

        if (
          state.taskFilter !== "totes" &&
          task.status !== state.taskFilter
        ) {
          return false;
        }

        if (!state.taskSearch) {
          return true;
        }

        const text = [
          task.name,
          task.subject,
          task.description
        ]
          .join(" ")
          .toLowerCase();

        return text.includes(
          state.taskSearch.toLowerCase()
        );
      })
      .sort(sortTasks);
  }


  function renderTasks() {

    const container =
      $("#tasks-list");

    if (!container) return;

    const tasks =
      filteredTasks();


    if (!tasks.length) {

      container.innerHTML = `
        <div class="panel">

          <div class="empty-state">

            <div class="empty-state-icon">
              ✓
            </div>

            <strong>
              No hi ha tasques per mostrar.
            </strong>

            <small>
              Crea una tasca o canvia el filtre.
            </small>

          </div>

        </div>
      `;

      return;
    }


    container.innerHTML =
      tasks.map(task => {

        const completed =
          task.status === "completada";

        const due =
          task.due_date
            ? formatDate(task.due_date)
            : "Sense data";


        return `
          <div
            class="task-row ${completed ? "completed" : ""}"
            data-task-id="${task.id}"
          >

            <button
              class="task-check"
              data-action="complete-task"
              data-id="${task.id}"
              title="Canviar estat"
            >
              ${completed ? "✓" : ""}
            </button>


            <button
              class="task-info"
              data-action="edit-task"
              data-id="${task.id}"
              style="
                border:0;
                background:transparent;
                color:inherit;
                text-align:left;
                cursor:pointer
              "
            >

              <strong>
                ${escapeHtml(task.name)}
              </strong>

              <small>
                ${escapeHtml(
                  task.subject ||
                  "Sense assignatura"
                )}
                ·
                ${escapeHtml(
                  difficultyLabel(task.difficulty)
                )}
                ·
                ${escapeHtml(
                  String(
                    task.estimated_minutes || 0
                  )
                )}
                min
              </small>

            </button>


            <span class="task-date">
              ${escapeHtml(due)}
            </span>


            <span class="task-status">
              ${escapeHtml(
                statusLabel(task.status)
              )}
            </span>

          </div>
        `;
      }).join("");
  }


  async function toggleTask(task) {

    const nextStatus =
      task.status === "completada"
        ? "pendent"
        : "completada";


    try {

      await api(
        `/api/tasks/${task.id}`,
        {
          method: "PATCH",
          body: {
            status: nextStatus
          }
        }
      );

      await loadTasks();
      await loadDashboard();

      showToast(
        nextStatus === "completada"
          ? "Tasca completada."
          : "Tasca marcada com a pendent.",
        "success"
      );

    } catch (error) {

      showError(error);

    }
  }


  /* =======================================================
     MODAL GENÈRIC
  ======================================================= */

  function openModal({
    title,
    body,
    footer = ""
  }) {

    const root =
      $("#modal-root");

    if (!root) return;

    root.innerHTML = `
      <div class="modal-backdrop">

        <div class="modal">

          <div class="modal-header">

            <h2>
              ${escapeHtml(title)}
            </h2>

            <button
              class="modal-close"
              data-close-modal
            >
              ×
            </button>

          </div>

          <div class="modal-body">
            ${body}
          </div>

          ${
            footer
              ? `<div class="modal-footer">${footer}</div>`
              : ""
          }

        </div>

      </div>
    `;


    $(".modal-backdrop")
      ?.addEventListener(
        "click",
        event => {

          if (
            event.target.classList.contains(
              "modal-backdrop"
            )
          ) {
            closeModal();
          }

        }
      );


    $("[data-close-modal]")
      ?.addEventListener(
        "click",
        closeModal
      );
  }


  function closeModal() {
    const root =
      $("#modal-root");

    if (root) {
      root.innerHTML = "";
    }
  }


  /* =======================================================
     MODAL TASCA
  ======================================================= */

  function openTaskModal(task = null) {

    const editing = Boolean(task);

    const title =
      editing
        ? "Editar tasca"
        : "Nova tasca";


    openModal({
      title,

      body: `
        <form id="task-modal-form">

          <div class="form-grid">

            <div class="form-field full">
              <label>Nom de la tasca</label>

              <input
                name="name"
                required
                value="${escapeHtml(
                  task?.name || ""
                )}"
                placeholder="Ex. Exercicis de matemàtiques"
              >
            </div>


            <div class="form-field">
              <label>Assignatura</label>

              <input
                name="subject"
                value="${escapeHtml(
                  task?.subject || ""
                )}"
                placeholder="Matemàtiques"
              >
            </div>


            <div class="form-field">
              <label>Data d'entrega</label>

              <input
                name="due_date"
                type="date"
                value="${escapeHtml(
                  task?.due_date
                    ? String(task.due_date).slice(0, 10)
                    : ""
                )}"
              >
            </div>


            <div class="form-field">
              <label>Temps estimat (minuts)</label>

              <input
                name="estimated_minutes"
                type="number"
                min="1"
                value="${escapeHtml(
                  task?.estimated_minutes || 30
                )}"
              >
            </div>


            <div class="form-field">
              <label>Dificultat</label>

              <select name="difficulty">

                <option
                  value="baixa"
                  ${
                    difficultyValue(task?.difficulty)
                      === "baixa"
                      ? "selected"
                      : ""
                  }
                >
                  Baixa
                </option>

                <option
                  value="mitjana"
                  ${
                    difficultyValue(task?.difficulty)
                      === "mitjana"
                      ? "selected"
                      : ""
                  }
                >
                  Mitjana
                </option>

                <option
                  value="alta"
                  ${
                    difficultyValue(task?.difficulty)
                      === "alta"
                      ? "selected"
                      : ""
                  }
                >
                  Alta
                </option>

              </select>
            </div>


            <div class="form-field">
              <label>Estat</label>

              <select name="status">

                <option
                  value="pendent"
                  ${
                    (task?.status || "pendent")
                      === "pendent"
                      ? "selected"
                      : ""
                  }
                >
                  Pendent
                </option>

                <option
                  value="en procés"
                  ${
                    task?.status === "en procés"
                      ? "selected"
                      : ""
                  }
                >
                  En procés
                </option>

                <option
                  value="completada"
                  ${
                    task?.status === "completada"
                      ? "selected"
                      : ""
                  }
                >
                  Completada
                </option>

              </select>
            </div>


            <div class="form-field full">

              <label>Descripció</label>

              <textarea
                name="description"
                placeholder="Afegeix detalls..."
              >${escapeHtml(
                task?.description || ""
              )}</textarea>

            </div>

          </div>

        </form>
      `,

      footer: `

        ${
          editing
            ? `
              <button
                class="btn btn-outline"
                id="delete-task"
              >
                Eliminar
              </button>
            `
            : ""
        }

        <button
          class="btn btn-outline"
          data-close-modal
        >
          Cancel·lar
        </button>

        <button
          class="btn btn-blue"
          id="save-task"
        >
          ${editing ? "Guardar canvis" : "Crear tasca"}
        </button>

      `
    });


    $("#save-task")
      ?.addEventListener(
        "click",
        async () => {

          const form =
            $("#task-modal-form");

          const data =
            Object.fromEntries(
              new FormData(form).entries()
            );

          data.estimated_minutes =
            Number(data.estimated_minutes || 30);

          try {

            await api(
              editing
                ? `/api/tasks/${task.id}`
                : "/api/tasks",
              {
                method: editing
                  ? "PATCH"
                  : "POST",
                body: data
              }
            );

            closeModal();

            await loadTasks();
            await loadDashboard();

            showToast(
              editing
                ? "Tasca actualitzada."
                : "Tasca creada.",
              "success"
            );

          } catch (error) {

            showError(error);

          }

        }
      );


    $("#delete-task")
      ?.addEventListener(
        "click",
        async () => {

          if (
            !confirm(
              "Vols eliminar aquesta tasca?"
            )
          ) {
            return;
          }

          try {

            await api(
              `/api/tasks/${task.id}`,
              {
                method: "DELETE"
              }
            );

            closeModal();

            await loadTasks();
            await loadDashboard();

            showToast(
              "Tasca eliminada.",
              "success"
            );

          } catch (error) {

            showError(error);

          }

        }
      );
  }


  /* =======================================================
     EXÀMENS
  ======================================================= */

  async function loadExams() {

    const data =
      await api("/api/exams");

    state.exams =
      data.exams || [];

    renderExams();
    renderDashboardExams();
  }


  function renderExams() {

    const container =
      $("#exams-list");

    if (!container) return;


    const exams =
      [...state.exams]
        .sort((a, b) =>
          String(a.exam_date)
            .localeCompare(
              String(b.exam_date)
            )
        );


    if (!exams.length) {

      container.innerHTML = `
        <div class="panel"
             style="grid-column:1/-1">

          <div class="empty-state">

            <div class="empty-state-icon">
              ▣
            </div>

            <strong>
              No tens exàmens registrats.
            </strong>

            <small>
              Afegeix el primer examen per començar.
            </small>

          </div>

        </div>
      `;

      return;
    }


    container.innerHTML =
      exams.map(exam => {

        const days =
          daysUntil(exam.exam_date);

        let dateLabel =
          formatDate(exam.exam_date);

        if (days === 0) {
          dateLabel = "Avui";
        } else if (days === 1) {
          dateLabel = "Demà";
        }


        return `
          <article
            class="exam-card"
            data-exam-id="${exam.id}"
          >

            <div class="exam-date">

              <div>
                <strong>
                  ${escapeHtml(
                    String(exam.exam_date)
                      .slice(8, 10)
                  )}
                </strong>

                <small>
                  ${escapeHtml(
                    new Intl.DateTimeFormat(
                      "ca-ES",
                      { month: "short" }
                    ).format(
                      new Date(
                        `${String(exam.exam_date).slice(0,10)}T12:00:00`
                      )
                    )
                  )}
                </small>
              </div>

            </div>


            <h3>
              ${escapeHtml(exam.subject)}
            </h3>

            <p>
              ${escapeHtml(dateLabel)}
              ·
              ${escapeHtml(
                difficultyLabel(
                  exam.difficulty
                )
              )}
            </p>

            <p>
              ${
                exam.syllabus
                  ? escapeHtml(
                      exam.syllabus
                    )
                  : "Sense temari afegit."
              }
            </p>


            <div
              style="
                display:flex;
                gap:7px;
                margin-top:13px
              "
            >

              <button
                class="btn btn-outline"
                data-action="edit-exam"
                data-id="${exam.id}"
              >
                Editar
              </button>

              <button
                class="btn btn-outline"
                data-action="delete-exam"
                data-id="${exam.id}"
              >
                Eliminar
              </button>

            </div>

          </article>
        `;

      }).join("");
  }


  function openExamModal(exam = null) {

    const editing = Boolean(exam);

    openModal({
      title:
        editing
          ? "Editar examen"
          : "Nou examen",

      body: `
        <form id="exam-modal-form">

          <div class="form-grid">

            <div class="form-field">
              <label>Assignatura</label>

              <input
                name="subject"
                required
                value="${escapeHtml(
                  exam?.subject || ""
                )}"
                placeholder="Física"
              >
            </div>


            <div class="form-field">
              <label>Data de l'examen</label>

              <input
                name="exam_date"
                type="date"
                required
                value="${escapeHtml(
                  exam?.exam_date
                    ? String(exam.exam_date).slice(0,10)
                    : ""
                )}"
              >
            </div>


            <div class="form-field">
              <label>Dificultat</label>

              <select name="difficulty">

                <option
                  value="baixa"
                  ${
                    difficultyValue(exam?.difficulty)
                      === "baixa"
                      ? "selected"
                      : ""
                  }
                >
                  Baixa
                </option>

                <option
                  value="mitjana"
                  ${
                    difficultyValue(exam?.difficulty)
                      === "mitjana"
                      ? "selected"
                      : ""
                  }
                >
                  Mitjana
                </option>

                <option
                  value="alta"
                  ${
                    difficultyValue(exam?.difficulty)
                      === "alta"
                      ? "selected"
                      : ""
                  }
                >
                  Alta
                </option>

              </select>
            </div>


            <div class="form-field">
              <label>Temps d'estudi recomanat</label>

              <input
                name="study_minutes"
                type="number"
                min="1"
                value="${escapeHtml(
                  exam?.study_minutes || 120
                )}"
              >
            </div>


            <div class="form-field full">

              <label>Temari</label>

              <textarea
                name="syllabus"
                placeholder="Temes, capítols, conceptes..."
              >${escapeHtml(
                exam?.syllabus || ""
              )}</textarea>

            </div>

          </div>

        </form>
      `,

      footer: `

        ${
          editing
            ? `
              <button
                class="btn btn-outline"
                id="delete-exam-modal"
              >
                Eliminar
              </button>
            `
            : ""
        }

        <button
          class="btn btn-outline"
          data-close-modal
        >
          Cancel·lar
        </button>

        <button
          class="btn btn-yellow"
          id="save-exam"
        >
          ${editing ? "Guardar canvis" : "Crear examen"}
        </button>

      `
    });


    $("#save-exam")
      ?.addEventListener(
        "click",
        async () => {

          const form =
            $("#exam-modal-form");

          const data =
            Object.fromEntries(
              new FormData(form).entries()
            );

          data.study_minutes =
            Number(
              data.study_minutes || 120
            );


          try {

            await api(
              editing
                ? `/api/exams/${exam.id}`
                : "/api/exams",
              {
                method:
                  editing
                    ? "PUT"
                    : "POST",
                body: data
              }
            );

            closeModal();

            await loadExams();
            await loadDashboard();

            showToast(
              editing
                ? "Examen actualitzat."
                : "Examen creat.",
              "success"
            );

          } catch (error) {

            showError(error);

          }

        }
      );


    $("#delete-exam-modal")
      ?.addEventListener(
        "click",
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
              `/api/exams/${exam.id}`,
              {
                method: "DELETE"
              }
            );

            closeModal();

            await loadExams();
            await loadDashboard();

            showToast(
              "Examen eliminat.",
              "success"
            );

          } catch (error) {

            showError(error);

          }

        }
      );
  }


  /* =======================================================
     CLASSES
  ======================================================= */

  async function loadClasses() {

    const data =
      await api("/api/classes");

    state.classes =
      data.classes || [];

    renderClasses();
    renderDashboardClasses();
  }


  function renderClassCard(classroom) {

    const isRed =
      String(classroom.id || "")
        .endsWith("2");

    const isYellow =
      String(classroom.id || "")
        .endsWith("3");


    const teacher =
      classroom.teacher_name ||
      classroom.teacher ||
      "Professor";


    const count =
      classroom.student_count ??
      classroom.students_count ??
      null;


    return `
      <article
        class="class-card"
        data-class-id="${classroom.id}"
      >

        <div
          class="class-cover ${
            isRed
              ? "red"
              : isYellow
                ? "yellow"
                : ""
          }"
        >

          <h3>
            ${escapeHtml(
              classroom.name
            )}
          </h3>

          <small>
            ${escapeHtml(
              classroom.subject ||
              teacher
            )}
          </small>

        </div>


        <div class="class-body">

          <div class="class-meta">

            <span>
              Codi:
              <strong>
                ${escapeHtml(
                  classroom.code || "—"
                )}
              </strong>
            </span>

            ${
              count !== null
                ? `<span>${count} alumnes</span>`
                : ""
            }

          </div>

        </div>


        <div class="class-footer">

          <button
            data-action="open-class"
            data-id="${classroom.id}"
          >
            Entrar a la classe →
          </button>

        </div>

      </article>
    `;
  }


  function renderClasses() {

    const container =
      $("#classes-list");

    if (!container) return;


    if (!state.classes.length) {

      container.innerHTML = `
        <div class="panel"
             style="grid-column:1/-1">

          <div class="empty-state">

            <div class="empty-state-icon">
              ⌘
            </div>

            <strong>
              Encara no tens classes.
            </strong>

            <small>
              ${
                state.user?.role === "professor"
                  ? "Crea la teva primera classe."
                  : "Uneix-te a una classe amb el seu codi."
              }
            </small>

          </div>

        </div>
      `;

      return;
    }


    container.innerHTML =
      state.classes
        .map(renderClassCard)
        .join("");
  }


  function openClassCreateModal() {

    openModal({
      title: "Crear classe",

      body: `
        <form id="class-create-form">

          <div class="form-grid">

            <div class="form-field full">

              <label>Nom de la classe</label>

              <input
                name="name"
                required
                placeholder="Ex. Física 2n BAT"
              >

            </div>


            <div class="form-field full">

              <label>Assignatura</label>

              <input
                name="subject"
                placeholder="Física"
              >

            </div>

          </div>

        </form>
      `,

      footer: `

        <button
          class="btn btn-outline"
          data-close-modal
        >
          Cancel·lar
        </button>

        <button
          class="btn btn-yellow"
          id="save-class"
        >
          Crear classe
        </button>

      `
    });


    $("#save-class")
      ?.addEventListener(
        "click",
        async () => {

          const form =
            $("#class-create-form");

          const data =
            Object.fromEntries(
              new FormData(form).entries()
            );

          try {

            const result =
              await api(
                "/api/classes",
                {
                  method: "POST",
                  body: data
                }
              );

            closeModal();

            await loadClasses();

            showToast(
              `Classe creada. Codi: ${result.class.code}`,
              "success"
            );

          } catch (error) {

            showError(error);

          }

        }
      );
  }


  function openJoinClassModal() {

    openModal({
      title: "Unir-me a una classe",

      body: `
        <form id="join-class-form">

          <div class="form-field">

            <label>
              Codi de la classe
            </label>

            <input
              name="code"
              maxlength="6"
              minlength="6"
              required
              placeholder="Ex. 195BT1"
              style="
                text-transform:uppercase;
                letter-spacing:.15em;
                font-weight:800
              "
            >

          </div>

        </form>
      `,

      footer: `

        <button
          class="btn btn-outline"
          data-close-modal
        >
          Cancel·lar
        </button>

        <button
          class="btn btn-blue"
          id="join-class-submit"
        >
          Unir-me
        </button>

      `
    });


    $("#join-class-submit")
      ?.addEventListener(
        "click",
        async () => {

          const form =
            $("#join-class-form");

          const data =
            Object.fromEntries(
              new FormData(form).entries()
            );

          data.code =
            String(data.code || "")
              .trim()
              .toUpperCase();


          try {

            await api(
              "/api/classes/join",
              {
                method: "POST",
                body: data
              }
            );

            closeModal();

            await loadClasses();

            showToast(
              "T'has unit a la classe.",
              "success"
            );

          } catch (error) {

            showError(error);

          }

        }
      );
  }


  async function openClassDetail(classId) {

    try {

      const data =
        await api(
          `/api/classes/${classId}`
        );

      state.currentClass = data;

      renderClassDetail(data);

      $("#class-detail")
        ?.classList.remove("hidden");

      $("#class-detail")
        ?.scrollIntoView({
          behavior: "smooth",
          block: "start"
        });

    } catch (error) {

      showError(error);

    }
  }


  function renderClassDetail(data) {

    const container =
      $("#class-detail");

    if (!container) return;


    const classroom =
      data.class;

    const teacher =
      classroom.teacher_name ||
      classroom.teacher ||
      "Professor";


    const isTeacher =
      state.user?.role === "professor";


    const content =
      data.content || [];


    const students =
      data.students || [];


    container.innerHTML = `

      <div class="class-detail-header">

        <div>

          <div class="eyebrow light">
            AULA DIGITAL
          </div>

          <h2>
            ${escapeHtml(
              classroom.name
            )}
          </h2>

          <div class="class-code">
            Codi ${escapeHtml(
              classroom.code
            )}
            ·
            ${escapeHtml(teacher)}
          </div>

        </div>

      </div>


      <div
        style="
          display:grid;
          grid-template-columns:minmax(0,1fr) 280px;
          gap:16px;
          margin-top:16px
        "
      >

        <div class="panel">

          <div class="panel-head">

            <div>

              <div class="eyebrow">
                CLASSE
              </div>

              <h2>
                Activitat
              </h2>

            </div>

            ${
              isTeacher
                ? `
                  <button
                    class="btn btn-yellow"
                    id="new-class-content"
                  >
                    ＋ Publicar
                  </button>
                `
                : ""
            }

          </div>


          <div
            style="padding:10px 16px 16px"
          >

            ${
              content.length
                ? content.map(renderClassContent).join("")
                : `
                  <div class="empty-state">

                    <div class="empty-state-icon">
                      ◫
                    </div>

                    <strong>
                      Encara no hi ha activitat.
                    </strong>

                    <small>
                      ${
                        isTeacher
                          ? "Publica un avís, deures o examen."
                          : "Quan el professor publiqui contingut apareixerà aquí."
                      }
                    </small>

                  </div>
                `
            }

          </div>

        </div>


        <div class="panel">

          <div class="panel-head">

            <div>

              <div class="eyebrow">
                CLASSE
              </div>

              <h2>
                Informació
              </h2>

            </div>

          </div>


          <div
            style="padding:16px"
          >

            <p style="margin-top:0;color:var(--text-muted);font-size:12px">
              ${
                classroom.subject
                  ? escapeHtml(classroom.subject)
                  : "Sense assignatura indicada."
              }
            </p>


            <div
              style="
                padding:11px;
                background:rgba(255,255,255,.035);
                border:1px solid var(--border);
                border-radius:9px
              "
            >

              <small style="color:var(--text-muted)">
                Codi de classe
              </small>

              <strong
                style="
                  display:block;
                  margin-top:3px;
                  letter-spacing:.12em
                "
              >
                ${escapeHtml(
                  classroom.code
                )}
              </strong>

            </div>


            ${
              isTeacher
                ? `
                  <div style="margin-top:14px">

                    <div class="eyebrow">
                      ALUMNES
                    </div>

                    <div style="margin-top:8px">

                      ${
                        students.length
                          ? students.map(
                              student => `
                                <div
                                  style="
                                    display:flex;
                                    align-items:center;
                                    gap:8px;
                                    padding:8px 0;
                                    border-bottom:1px solid var(--border)
                                  "
                                >

                                  <span
                                    class="avatar"
                                    style="
                                      width:27px;
                                      height:27px;
                                      font-size:9px
                                    "
                                  >
                                    ${escapeHtml(
                                      initials(
                                        student.username ||
                                        student.name
                                      )
                                    )}
                                  </span>

                                  <span
                                    style="font-size:10px"
                                  >
                                    ${escapeHtml(
                                      student.username ||
                                      student.name ||
                                      "Alumne"
                                    )}
                                  </span>

                                </div>
                              `
                            ).join("")
                          : `
                            <small
                              style="color:var(--text-muted)"
                            >
                              Encara no hi ha alumnes.
                            </small>
                          `
                      }

                    </div>

                  </div>
                `
                : ""
            }

          </div>

        </div>

      </div>
    `;


    $("#new-class-content")
      ?.addEventListener(
        "click",
        () =>
          openClassContentModal(
            classroom.id
          )
      );
  }


  function renderClassContent(item) {

    const type =
      String(
        item.content_type ||
        item.type ||
        "avis"
      ).toLowerCase();


    let label = "Avís";

    if (
      type === "deure" ||
      type === "deures"
    ) {
      label = "Deures";
    }

    if (
      type === "examen"
    ) {
      label = "Examen";
    }


    return `
      <article
        style="
          padding:15px 4px;
          border-bottom:1px solid var(--border)
        "
      >

        <div
          style="
            display:flex;
            justify-content:space-between;
            gap:10px
          "
        >

          <div>

            <span
              class="role-badge"
              style="
                ${
                  type === "examen"
                    ? `
                      color:#ff656a;
                      background:var(--red-soft)
                    `
                    : ""
                }
              "
            >
              ${label}
            </span>

            <h3
              style="
                margin:8px 0 4px;
                font-size:14px
              "
            >
              ${escapeHtml(
                item.title
              )}
            </h3>

          </div>


          <small
            style="
              color:var(--text-muted);
              font-size:9px
            "
          >
            ${escapeHtml(
              item.created_at
                ? formatDate(
                    item.created_at
                  )
                : ""
            )}
          </small>

        </div>


        ${
          item.body
            ? `
              <p
                style="
                  margin:7px 0 0;
                  color:var(--text-muted);
                  font-size:11px;
                  white-space:pre-wrap
                "
              >
                ${escapeHtml(
                  item.body
                )}
              </p>
            `
            : ""
        }


        ${
          item.due_date
            ? `
              <small
                style="
                  display:block;
                  margin-top:8px;
                  color:var(--blue-bright);
                  font-size:9px
                "
              >
                Entrega:
                ${escapeHtml(
                  formatDate(
                    item.due_date
                  )
                )}
              </small>
            `
            : ""
        }

      </article>
    `;
  }


  function openClassContentModal(classId) {

    openModal({
      title: "Publicar a la classe",

      body: `
        <form id="content-form">

          <div class="form-grid">

            <div class="form-field">

              <label>Tipus</label>

              <select name="content_type">

                <option value="avis">
                  Avís
                </option>

                <option value="deures">
                  Deures
                </option>

                <option value="examen">
                  Examen
                </option>

              </select>

            </div>


            <div class="form-field">

              <label>Data d'entrega</label>

              <input
                name="due_date"
                type="date"
              >

            </div>


            <div class="form-field full">

              <label>Títol</label>

              <input
                name="title"
                required
                placeholder="Títol de la publicació"
              >

            </div>


            <div class="form-field full">

              <label>Descripció</label>

              <textarea
                name="body"
                placeholder="Escriu la informació..."
              ></textarea>

            </div>

          </div>

        </form>
      `,

      footer: `

        <button
          class="btn btn-outline"
          data-close-modal
        >
          Cancel·lar
        </button>

        <button
          class="btn btn-yellow"
          id="publish-content"
        >
          Publicar
        </button>

      `
    });


    $("#publish-content")
      ?.addEventListener(
        "click",
        async () => {

          const form =
            $("#content-form");

          const data =
            Object.fromEntries(
              new FormData(form).entries()
            );

          try {

            await api(
              `/api/classes/${classId}/content`,
              {
                method: "POST",
                body: data
              }
            );

            closeModal();

            await openClassDetail(
              classId
            );

            showToast(
              "Publicació creada.",
              "success"
            );

          } catch (error) {

            showError(error);

          }

        }
      );
  }


  /* =======================================================
     CALENDARI
  ======================================================= */

  function startOfWeek(date) {

    const result =
      new Date(date);

    result.setHours(
      0,
      0,
      0,
      0
    );

    const day =
      result.getDay();

    const mondayOffset =
      day === 0
        ? -6
        : 1 - day;

    result.setDate(
      result.getDate() +
      mondayOffset
    );

    return result;
  }


  function renderCalendar() {

    const grid =
      $("#calendar-grid");

    if (!grid) return;


    const base =
      startOfWeek(new Date());

    base.setDate(
      base.getDate() +
      state.calendarOffset * 7
    );


    const end =
      new Date(base);

    end.setDate(
      end.getDate() + 6
    );


    $("#calendar-title").textContent =
      `${formatDate(base, {
        day: "numeric",
        month: "short"
      })} — ${formatDate(end, {
        day: "numeric",
        month: "short",
        year: "numeric"
      })}`;


    const days = [];


    for (let i = 0; i < 7; i++) {

      const date =
        new Date(base);

      date.setDate(
        base.getDate() + i
      );

      days.push(date);

    }


    const dayNames = [
      "Dl",
      "Dt",
      "Dc",
      "Dj",
      "Dv",
      "Ds",
      "Dg"
    ];


    grid.innerHTML =
      days.map((date, index) => {

        const iso =
          date.toISOString()
            .slice(0, 10);


        const today =
          iso ===
          new Date()
            .toISOString()
            .slice(0, 10);


        const tasks =
          state.tasks.filter(
            task =>
              String(task.due_date || "")
                .slice(0, 10)
              === iso
          );


        const exams =
          state.exams.filter(
            exam =>
              String(exam.exam_date || "")
                .slice(0, 10)
              === iso
          );


        return `
          <div
            class="calendar-day ${
              today ? "today" : ""
            }"
          >

            <div class="calendar-day-name">
              ${dayNames[index]}
            </div>

            <div class="calendar-day-number">
              ${date.getDate()}
            </div>


            ${
              exams.map(
                exam => `
                  <div class="calendar-event exam">
                    Examen:
                    ${escapeHtml(
                      exam.subject
                    )}
                  </div>
                `
              ).join("")
            }


            ${
              tasks.map(
                task => `
                  <div class="calendar-event task">
                    ${escapeHtml(
                      task.name
                    )}
                  </div>
                `
              ).join("")
            }

          </div>
        `;

      }).join("");
  }


  /* =======================================================
     PLANIFICADOR
  ======================================================= */

  async function loadStudySessions() {

    try {

      const data =
        await api(
          "/api/study-sessions"
        );

      state.studySessions =
        data.sessions || [];

    } catch {
      state.studySessions = [];
    }
  }


  function renderPlanner() {

    renderPlannerWeek();

    renderPlanSessions();
  }


  function renderPlannerWeek() {

    const grid =
      $("#week-grid");

    if (!grid) return;


    const base =
      startOfWeek(new Date());

    base.setDate(
      base.getDate() +
      state.plannerOffset * 7
    );


    const end =
      new Date(base);

    end.setDate(
      end.getDate() + 6
    );


    $("#week-title").textContent =
      `${formatDate(base)} — ${formatDate(end)}`;


    const days = [];


    for (let i = 0; i < 7; i++) {

      const date =
        new Date(base);

      date.setDate(
        base.getDate() + i
      );

      days.push(date);

    }


    const names = [
      "Dl",
      "Dt",
      "Dc",
      "Dj",
      "Dv",
      "Ds",
      "Dg"
    ];


    grid.innerHTML =
      days.map(
        (date, index) => {

          const iso =
            date.toISOString()
              .slice(0, 10);


          const sessions =
            state.studySessions.filter(
              session =>
                String(
                  session.session_date || ""
                ).slice(0, 10)
                === iso
            );


          const tasks =
            state.tasks.filter(
              task =>
                String(
                  task.due_date || ""
                ).slice(0, 10)
                === iso
            );


          return `
            <div
              class="calendar-day"
            >

              <div class="calendar-day-name">
                ${names[index]}
              </div>

              <div class="calendar-day-number">
                ${date.getDate()}
              </div>

              ${
                sessions.map(
                  session => `
                    <div
                      class="calendar-event"
                    >
                      Estudi
                      ${session.minutes} min
                    </div>
                  `
                ).join("")
              }


              ${
                tasks.map(
                  task => `
                    <div
                      class="calendar-event task"
                    >
                      ${escapeHtml(
                        task.name
                      )}
                    </div>
                  `
                ).join("")
              }

            </div>
          `;
        }
      ).join("");
  }


  function renderPlanSessions() {

    const container =
      $("#plan-sessions");

    if (!container) return;


    const upcomingTasks =
      state.tasks
        .filter(
          task =>
            task.status !== "completada"
        )
        .sort(sortTasks)
        .slice(0, 5);


    if (!upcomingTasks.length) {

      container.innerHTML = `
        <div class="empty-state">

          <div class="empty-state-icon">
            ◫
          </div>

          <strong>
            Encara no hi ha sessions.
          </strong>

          <small>
            Afegeix tasques o genera un pla amb IA.
          </small>

        </div>
      `;

      return;
    }


    container.innerHTML =
      upcomingTasks.map(
        task => `
          <div class="plan-session">

            <div class="plan-session-time">
              ${
                task.due_date
                  ? formatDate(
                      task.due_date
                    )
                  : "Avui"
              }
            </div>

            <div class="plan-session-main">

              <strong>
                ${escapeHtml(
                  task.name
                )}
              </strong>

              <small>
                ${escapeHtml(
                  task.subject ||
                  "Estudi"
                )}
              </small>

            </div>

            <span class="plan-session-tag">
              ${escapeHtml(
                String(
                  task.estimated_minutes ||
                  30
                )
              )} min
            </span>

          </div>
        `
      ).join("");
  }


  async function generatePlan() {

    try {

      const data =
        await api(
          "/api/ai/recommendations"
        );


      const recommendations =
        data.recommendations || [];


      if (!recommendations.length) {

        showToast(
          "No hi ha prou tasques per generar un pla.",
          "info"
        );

        return;
      }


      const sessions =
        recommendations
          .slice(0, 5)
          .map(item => ({
            name:
              item.task?.name ||
              "Tasca",
            reason:
              item.reason ||
              "Tasca pendent."
          }));


      openModal({
        title: "Pla d'estudi recomanat",

        body: `
          <div>

            <p
              style="
                color:var(--text-muted);
                font-size:11px
              "
            >
              La priorització s'ha calculat
              a partir de les teves tasques actuals.
            </p>

            ${
              sessions.map(
                (session, index) => `
                  <div
                    style="
                      padding:12px 0;
                      border-bottom:1px solid var(--border)
                    "
                  >

                    <strong>
                      ${index + 1}.
                      ${escapeHtml(
                        session.name
                      )}
                    </strong>

                    <small
                      style="
                        display:block;
                        margin-top:4px;
                        color:var(--text-muted)
                      "
                    >
                      ${escapeHtml(
                        session.reason
                      )}
                    </small>

                  </div>
                `
              ).join("")
            }

          </div>
        `,

        footer: `
          <button
            class="btn btn-yellow"
            data-close-modal
          >
            Entès
          </button>
        `
      });


    } catch (error) {

      showError(error);

    }
  }


  function openStudySessionModal() {

    openModal({
      title: "Afegir sessió d'estudi",

      body: `
        <form id="study-session-form">

          <div class="form-grid">

            <div class="form-field">
              <label>Data</label>

              <input
                name="session_date"
                type="date"
                value="${
                  new Date()
                    .toISOString()
                    .slice(0,10)
                }"
              >
            </div>


            <div class="form-field">
              <label>Minuts</label>

              <input
                name="minutes"
                type="number"
                min="1"
                value="30"
              >
            </div>


            <div class="form-field full">

              <label>Notes</label>

              <textarea
                name="notes"
                placeholder="Què estudiaràs?"
              ></textarea>

            </div>

          </div>

        </form>
      `,

      footer: `

        <button
          class="btn btn-outline"
          data-close-modal
        >
          Cancel·lar
        </button>

        <button
          class="btn btn-blue"
          id="save-study-session"
        >
          Afegir sessió
        </button>

      `
    });


    $("#save-study-session")
      ?.addEventListener(
        "click",
        async () => {

          const form =
            $("#study-session-form");

          const data =
            Object.fromEntries(
              new FormData(form).entries()
            );

          data.minutes =
            Number(data.minutes || 0);


          try {

            await api(
              "/api/study-sessions",
              {
                method: "POST",
                body: data
              }
            );

            closeModal();

            await loadStudySessions();

            renderPlanner();

            await loadProgress();

            showToast(
              "Sessió d'estudi afegida.",
              "success"
            );

          } catch (error) {

            showError(error);

          }

        }
      );
  }


  /* =======================================================
     PROGRÉS
  ======================================================= */

  async function loadProgress() {

    try {

      const data =
        await api(
          "/api/progress"
        );

      state.progress =
        data;

      renderProgress();

    } catch (error) {

      showError(error);

    }
  }


  function renderProgress() {

    const data =
      state.progress;

    if (!data) return;


    const percentage =
      Number(data.progress || 0);

    const total =
      Number(
        data.total_tasks ||
        data.tasks?.total ||
        0
      );

    const completed =
      Number(
        data.completed_tasks ||
        data.tasks?.completed ||
        0
      );

    const study =
      Number(
        data.study_minutes ||
        data.study?.completed ||
        0
      );


    $("#progress-number").textContent =
      `${percentage}%`;

    $("#progress-bar").style.width =
      `${Math.min(100, percentage)}%`;

    $("#progress-caption").textContent =
      `${completed} de ${total} tasques`;


    $("#study-number").textContent =
      `${study} min`;

    $("#study-caption").textContent =
      `${study} minuts registrats`;

    $("#study-bar").style.width =
      `${Math.min(
        100,
        study > 0
          ? Math.min(100, study / 600 * 100)
          : 0
      )}%`;


    renderProgressChart(
      data.week ||
      data.weekly ||
      []
    );


    renderTestHistory();
  }


  function renderProgressChart(weekly) {

    const container =
      $("#progress-chart");

    if (!container) return;


    const map = {};

    weekly.forEach(item => {

      map[
        String(item.session_date)
          .slice(0,10)
      ] =
        Number(item.minutes || 0);

    });


    const days = [];

    for (let i = 6; i >= 0; i--) {

      const date =
        new Date();

      date.setDate(
        date.getDate() - i
      );

      days.push(date);

    }


    const max =
      Math.max(
        60,
        ...days.map(
          date =>
            map[
              date.toISOString()
                .slice(0,10)
            ] || 0
        )
      );


    container.innerHTML =
      days.map(date => {

        const iso =
          date.toISOString()
            .slice(0,10);

        const minutes =
          map[iso] || 0;

        const height =
          Math.max(
            3,
            Math.round(
              minutes / max * 100
            )
          );


        return `
          <div
            class="chart-bar"
            style="height:${height}%"
            title="${minutes} minuts"
          >
            <small>
              ${date.toLocaleDateString(
                "ca-ES",
                { weekday:"short" }
              )}
            </small>
          </div>
        `;

      }).join("");
  }


  async function loadTestHistory() {

    try {

      const data =
        await api(
          "/api/tests/history"
        );

      state.testHistory =
        data.results || [];

      renderTestHistory();

    } catch {
      state.testHistory = [];
    }
  }


  function renderTestHistory() {

    const container =
      $("#test-history");

    if (!container) return;


    if (!state.testHistory.length) {

      container.innerHTML = `
        <div class="empty-state">

          <div class="empty-state-icon">
            ✓
          </div>

          <strong>
            Encara no has fet cap test.
          </strong>

          <small>
            Quan facis un test, el resultat apareixerà aquí.
          </small>

        </div>
      `;

      return;
    }


    container.innerHTML =
      state.testHistory
        .slice(0, 10)
        .map(result => {

          const percentage =
            result.total
              ? Math.round(
                  result.score /
                  result.total *
                  100
                )
              : 0;


          return `
            <div
              class="compact-item"
            >

              <span class="compact-marker">
                ✓
              </span>

              <div>
                <strong>
                  ${escapeHtml(
                    result.subject ||
                    "Test"
                  )}
                </strong>

                <small>
                  ${result.score}/${result.total}
                  ·
                  ${percentage}%
                </small>
              </div>

            </div>
          `;

        })
        .join("");
  }


  /* =======================================================
     IA
  ======================================================= */

  function setAIMode(mode) {

    state.aiMode =
      String(mode || "DUBTE")
        .toUpperCase();


    $$("#ai-modes button")
      .forEach(button => {

        button.classList.toggle(
          "active",
          button.dataset.mode ===
          state.aiMode
        );

      });


    const input =
      $("#ai-input");

    if (!input) return;


    const placeholders = {

      DUBTE:
        "Escriu el teu dubte...",

      EXPLICAR:
        "Quin tema vols que t'expliqui?",

      ESTUDIAR:
        "Què vols organitzar o estudiar?",

      RESUMIR:
        "Enganxa aquí el text que vols resumir...",

      TEST:
        "Sobre quin tema vols fer el test?"
    };


    input.placeholder =
      placeholders[state.aiMode] ||
      placeholders.DUBTE;
  }


  function focusAI() {

    const input =
      $("#ai-input");

    if (input) {
      setTimeout(
        () => input.focus(),
        100
      );
    }
  }


  function addChatMessage(
    text,
    type = "ai"
  ) {

    const log =
      $("#chat-log");

    if (!log) return;


    const bubble =
      document.createElement("div");

    bubble.className =
      `chat-bubble ${type}`;


    bubble.innerHTML = `
      <span>
        ${type === "user" ? "F" : "✦"}
      </span>

      <div>

        <b>
          ${
            type === "user"
              ? escapeHtml(
                  state.user?.username ||
                  "Tu"
                )
              : "MiniClassroom IA"
          }
        </b>

        <p>
          ${escapeHtml(text)}
        </p>

      </div>
    `;


    log.appendChild(bubble);

    log.scrollTop =
      log.scrollHeight;
  }


  async function sendAIMessage(event) {

    event.preventDefault();


    const input =
      $("#ai-input");

    const message =
      String(
        input?.value || ""
      ).trim();


    if (!message) return;


    addChatMessage(
      message,
      "user"
    );


    input.value = "";


    const loading =
      document.createElement("div");

    loading.className =
      "chat-bubble ai";

    loading.innerHTML = `
      <span>✦</span>

      <div>

        <b>
          MiniClassroom IA
        </b>

        <p>
          Pensant...
        </p>

      </div>
    `;


    $("#chat-log")
      ?.appendChild(loading);


    try {

      const result =
        await api(
          "/api/ai",
          {
            method: "POST",
            body: {
              mode: state.aiMode,
              message
            }
          }
        );


      loading.remove();


      addChatMessage(
        result.answer ||
        "No he rebut cap resposta.",
        "ai"
      );


    } catch (error) {

      loading.remove();

      addChatMessage(
        error.message,
        "ai"
      );

    }
  }


  async function loadRecommendations() {

    try {

      const data =
        await api(
          "/api/ai/recommendations"
        );

      const box =
        $("#recommendation-box");

      if (!box) return;


      const recommendations =
        data.recommendations || [];


      if (!recommendations.length) {

        box.innerHTML = `
          <strong>
            No tens tasques pendents.
          </strong>

          <p
            style="
              color:var(--text-muted);
              font-size:11px
            "
          >
            Quan afegeixis feina,
            la IA podrà ajudar-te a prioritzar-la.
          </p>
        `;

        return;
      }


      box.innerHTML = `

        <div
          style="
            display:flex;
            flex-direction:column;
            gap:8px
          "
        >

          ${
            recommendations
              .slice(0, 4)
              .map(
                (item, index) => `
                  <div
                    style="
                      padding:10px;
                      background:rgba(255,255,255,.035);
                      border:1px solid var(--border);
                      border-radius:8px
                    "
                  >

                    <strong
                      style="font-size:11px"
                    >
                      ${index + 1}.
                      ${escapeHtml(
                        item.task?.name ||
                        "Tasca"
                      )}
                    </strong>

                    <small
                      style="
                        display:block;
                        margin-top:3px;
                        color:var(--text-muted);
                        font-size:9px
                      "
                    >
                      ${escapeHtml(
                        item.reason ||
                        "Tasca pendent."
                      )}
                    </small>

                  </div>
                `
              )
              .join("")
          }

        </div>
      `;


    } catch (error) {

      showError(error);

    }
  }


  /* =======================================================
     TEST IA
  ======================================================= */

  async function openTestModal() {

    openModal({
      title: "Crear un test",

      body: `

        <div id="test-setup">

          <div class="form-field">

            <label>
              Tema del test
            </label>

            <input
              id="test-topic"
              placeholder="Ex. Revolució Francesa"
              required
            >

          </div>

          <p
            style="
              color:var(--text-muted);
              font-size:11px;
              margin-bottom:0
            "
          >
            La IA generarà 5 preguntes
            amb quatre opcions cadascuna.
          </p>

        </div>

        <div
          id="test-content"
          class="hidden"
        ></div>

      `,

      footer: `

        <button
          class="btn btn-outline"
          data-close-modal
        >
          Cancel·lar
        </button>

        <button
          class="btn btn-yellow"
          id="generate-test"
        >
          ✦ Generar test
        </button>

      `
    });


    $("#generate-test")
      ?.addEventListener(
        "click",
        generateTest
      );
  }


  async function generateTest() {

    const topic =
      String(
        $("#test-topic")?.value || ""
      ).trim();


    if (!topic) {

      showToast(
        "Indica el tema del test.",
        "error"
      );

      return;
    }


    const button =
      $("#generate-test");

    if (button) {
      button.disabled = true;
      button.textContent =
        "Generant...";
    }


    try {

      const result =
        await api(
          "/api/ai/test",
          {
            method: "POST",
            body: { topic }
          }
        );


      renderTestQuestions(
        result
      );


    } catch (error) {

      showError(error);

    } finally {

      if (button) {
        button.disabled = false;
        button.textContent =
          "✦ Generar test";
      }

    }
  }


  function renderTestQuestions(result) {

    const setup =
      $("#test-setup");

    const content =
      $("#test-content");

    if (!content) return;


    setup?.classList.add("hidden");

    content.classList.remove("hidden");


    const questions =
      result.questions || [];


    content.innerHTML = `

      <div
        id="test-questions"
      >

        ${
          questions.map(
            (question, index) => {

              const options =
                question.options ||
                question.respostes ||
                [];

              return `
                <div
                  class="panel"
                  style="
                    margin-bottom:10px;
                    padding:14px
                  "
                >

                  <strong
                    style="font-size:12px"
                  >
                    ${index + 1}.
                    ${escapeHtml(
                      question.question ||
                      question.pregunta ||
                      ""
                    )}
                  </strong>


                  <div
                    style="
                      display:grid;
                      gap:6px;
                      margin-top:10px
                    "
                  >

                    ${
                      options.map(
                        (option, optionIndex) => {

                          const letter =
                            ["A","B","C","D"]
                              [optionIndex] ||
                            String(
                              optionIndex + 1
                            );


                          const text =
                            typeof option === "string"
                              ? option
                              : (
                                  option.text ||
                                  option.answer ||
                                  ""
                                );


                          return `
                            <label
                              style="
                                display:flex;
                                gap:8px;
                                align-items:center;
                                padding:8px;
                                background:rgba(255,255,255,.025);
                                border:1px solid var(--border);
                                border-radius:7px;
                                cursor:pointer
                              "
                            >

                              <input
                                type="radio"
                                name="question-${index}"
                                value="${optionIndex}"
                              >

                              <span
                                style="
                                  color:var(--text-muted);
                                  font-size:10px
                                "
                              >
                                ${letter}
                              </span>

                              <span
                                style="font-size:10px"
                              >
                                ${escapeHtml(text)}
                              </span>

                            </label>
                          `;

                        }
                      ).join("")
                    }

                  </div>

                </div>
              `;

            }
          ).join("")
        }

      </div>


      <div
        id="test-result"
        class="hidden"
      ></div>

    `;


    const footer =
      $(".modal-footer");

    if (footer) {

      footer.innerHTML = `

        <button
          class="btn btn-outline"
          data-close-modal
        >
          Tancar
        </button>

        <button
          class="btn btn-yellow"
          id="grade-test"
        >
          Corregir test
        </button>

      `;

      $("#grade-test")
        ?.addEventListener(
          "click",
          () =>
            gradeTest(
              result
            )
        );
    }
  }


  async function gradeTest(result) {

    const questions =
      result.questions || [];


    let score = 0;

    const answers = [];


    questions.forEach(
      (question, index) => {

        const selected =
          document.querySelector(
            `input[name="question-${index}"]:checked`
          );


        const value =
          selected
            ? Number(selected.value)
            : null;


        answers.push(value);


        const correct =
          Number(
            question.correct_answer ??
            question.correct ??
            question.answer ??
            -1
          );


        if (
          value !== null &&
          value === correct
        ) {
          score++;
        }

      }
    );


    const topic =
      result.topic ||
      "Test";


    try {

      await api(
        "/api/test-results",
        {
          method: "POST",
          body: {
            subject: topic,
            score,
            total: questions.length || 5
          }
        }
      );


      const resultBox =
        $("#test-result");

      if (resultBox) {

        resultBox.classList.remove(
          "hidden"
        );

        resultBox.innerHTML = `

          <div
            style="
              padding:18px;
              text-align:center;
              background:var(--blue-soft);
              border:1px solid rgba(18,150,212,.2);
              border-radius:12px
            "
          >

            <div class="eyebrow">
              RESULTAT
            </div>

            <strong
              style="
                display:block;
                margin:5px 0;
                font-size:32px
              "
            >
              ${score}/${questions.length || 5}
            </strong>

            <p
              style="
                margin:0;
                color:var(--text-muted);
                font-size:11px
              "
            >
              ${
                score === questions.length
                  ? "Perfecte!"
                  : score >= 3
                    ? "Bon treball."
                    : "Continua practicant."
              }
            </p>

          </div>
        `;

      }


      const footer =
        $(".modal-footer");

      if (footer) {

        const gradeButton =
          $("#grade-test");

        gradeButton?.remove();

      }


      await loadTestHistory();

      showToast(
        "Resultat guardat.",
        "success"
      );


    } catch (error) {

      showError(error);

    }
  }


  /* =======================================================
     CERCA
  ======================================================= */

  function performSearch(query) {

    const value =
      String(query || "")
        .trim()
        .toLowerCase();


    if (!value) return;


    const task =
      state.tasks.find(item =>
        [
          item.name,
          item.subject,
          item.description
        ]
          .join(" ")
          .toLowerCase()
          .includes(value)
      );


    if (task) {

      navigate("tasks");

      const search =
        $("#task-search");

      if (search) {
        search.value = query;

        state.taskSearch =
          query;

        renderTasks();
      }

      return;
    }


    const exam =
      state.exams.find(item =>
        [
          item.subject,
          item.syllabus
        ]
          .join(" ")
          .toLowerCase()
          .includes(value)
      );


    if (exam) {

      navigate("exams");

      return;
    }


    const classroom =
      state.classes.find(item =>
        [
          item.name,
          item.subject,
          item.code
        ]
          .join(" ")
          .toLowerCase()
          .includes(value)
      );


    if (classroom) {

      navigate("classes");

      openClassDetail(
        classroom.id
      );

      return;
    }


    showToast(
      "No he trobat cap resultat.",
      "info"
    );
  }


  /* =======================================================
     NOTIFICACIONS
  ======================================================= */

  function renderNotifications() {

    const panel =
      $("#notification-panel");

    if (!panel) return;


    const urgent =
      state.tasks.filter(task => {

        if (
          task.status === "completada" ||
          !task.due_date
        ) {
          return false;
        }

        const days =
          daysUntil(task.due_date);

        return days !== null &&
          days <= 2;

      });


    const exams =
      state.exams.filter(exam => {

        const days =
          daysUntil(exam.exam_date);

        return days !== null &&
          days >= 0 &&
          days <= 5;

      });


    const items = [];


    urgent.forEach(task => {

      items.push(`
        <div class="floating-panel-item">

          <strong>
            Tasca propera
          </strong>

          <small>
            ${escapeHtml(
              task.name
            )}
            ·
            ${escapeHtml(
              formatDate(
                task.due_date
              )
            )}
          </small>

        </div>
      `);

    });


    exams.forEach(exam => {

      items.push(`
        <div class="floating-panel-item">

          <strong>
            Examen proper
          </strong>

          <small>
            ${escapeHtml(
              exam.subject
            )}
            ·
            ${escapeHtml(
              formatDate(
                exam.exam_date
              )
            )}
          </small>

        </div>
      `);

    });


    if (!items.length) {

      panel.innerHTML = `
        <div class="floating-panel-item">

          <strong>
            No tens notificacions.
          </strong>

          <small>
            Quan hi hagi alguna data important,
            apareixerà aquí.
          </small>

        </div>
      `;

    } else {

      panel.innerHTML =
        items.slice(0, 8).join("");

    }
  }


  /* =======================================================
     QUICK ADD
  ======================================================= */

  function openQuickAdd() {

    const professor =
      state.user?.role === "professor";


    openModal({
      title: "Afegir",

      body: `

        <div
          style="
            display:grid;
            gap:8px
          "
        >

          <button
            class="tool-card"
            id="quick-task"
          >

            <span>✓</span>

            <div>
              <b>Nova tasca</b>
              <small>
                Afegeix feina pendent.
              </small>
            </div>

            →

          </button>


          <button
            class="tool-card"
            id="quick-exam"
          >

            <span>▣</span>

            <div>
              <b>Nou examen</b>
              <small>
                Registra una data d'examen.
              </small>
            </div>

            →

          </button>


          <button
            class="tool-card"
            id="quick-session"
          >

            <span>◫</span>

            <div>
              <b>Sessió d'estudi</b>
              <small>
                Registra temps d'estudi.
              </small>
            </div>

            →

          </button>


          ${
            professor
              ? `
                <button
                  class="tool-card"
                  id="quick-class"
                >

                  <span>⌘</span>

                  <div>
                    <b>Crear classe</b>
                    <small>
                      Crea un espai per als alumnes.
                    </small>
                  </div>

                  →

                </button>
              `
              : ""
          }

        </div>

      `
    });


    $("#quick-task")
      ?.addEventListener(
        "click",
        () => {
          closeModal();
          openTaskModal();
        }
      );


    $("#quick-exam")
      ?.addEventListener(
        "click",
        () => {
          closeModal();
          openExamModal();
        }
      );


    $("#quick-session")
      ?.addEventListener(
        "click",
        () => {
          closeModal();
          openStudySessionModal();
        }
      );


    $("#quick-class")
      ?.addEventListener(
        "click",
        () => {
          closeModal();
          openClassCreateModal();
        }
      );
  }


  /* =======================================================
     EVENTS
  ======================================================= */

  function bindApplicationEvents() {

    /* Navegació */

    $$(".nav-item")
      .forEach(button => {

        button.addEventListener(
          "click",
          () =>
            navigate(
              button.dataset.section
            )
        );

      });


    $$("[data-section]")
      .forEach(button => {

        if (
          button.classList.contains(
            "nav-item"
          )
        ) {
          return;
        }

        button.addEventListener(
          "click",
          () =>
            navigate(
              button.dataset.section
            )
        );

      });


    /* Auth */

    $$(".auth-tab")
      .forEach(button => {

        button.addEventListener(
          "click",
          () =>
            setAuthTab(
              button.dataset.auth
            )
        );

      });


    $("#login-form")
      ?.addEventListener(
        "submit",
        login
      );


    $("#register-form")
      ?.addEventListener(
        "submit",
        register
      );


    $("#logout-btn")
      ?.addEventListener(
        "click",
        logout
      );


    /* Accions */

    $("#new-task")
      ?.addEventListener(
        "click",
        () =>
          openTaskModal()
      );


    $("#new-exam")
      ?.addEventListener(
        "click",
        () =>
          openExamModal()
      );


    $("#quick-add")
      ?.addEventListener(
        "click",
        openQuickAdd
      );


    $("#quick-ai")
      ?.addEventListener(
        "click",
        () => navigate("ai")
      );


    /* Tasques */

    $$("#task-filter button")
      .forEach(button => {

        button.addEventListener(
          "click",
          () => {

            state.taskFilter =
              button.dataset.filter;

            $$("#task-filter button")
              .forEach(item =>
                item.classList.toggle(
                  "active",
                  item === button
                )
              );

            renderTasks();

          }
        );

      });


    $("#task-search")
      ?.addEventListener(
        "input",
        event => {

          state.taskSearch =
            event.target.value;

          renderTasks();

        }
      );


    $("#tasks-list")
      ?.addEventListener(
        "click",
        event => {

          const button =
            event.target.closest(
              "[data-action]"
            );

          if (!button) return;

          const id =
            Number(button.dataset.id);

          const task =
            state.tasks.find(
              item => item.id === id
            );

          if (!task) return;


          if (
            button.dataset.action ===
            "complete-task"
          ) {

            toggleTask(task);

          }


          if (
            button.dataset.action ===
            "edit-task"
          ) {

            openTaskModal(task);

          }

        }
      );


    /* Exàmens */

    $("#exams-list")
      ?.addEventListener(
        "click",
        event => {

          const button =
            event.target.closest(
              "[data-action]"
            );

          if (!button) return;

          const id =
            Number(button.dataset.id);

          const exam =
            state.exams.find(
              item => item.id === id
            );

          if (!exam) return;


          if (
            button.dataset.action ===
            "edit-exam"
          ) {

            openExamModal(exam);

          }


          if (
            button.dataset.action ===
            "delete-exam"
          ) {

            deleteExam(exam);

          }

        }
      );


    /* Classes */

    $("#classes-list")
      ?.addEventListener(
        "click",
        event => {

          const button =
            event.target.closest(
              "[data-action='open-class']"
            );

          if (!button) return;

          openClassDetail(
            Number(button.dataset.id)
          );

        }
      );


    /* IA */

    $$("#ai-modes button")
      .forEach(button => {

        button.addEventListener(
          "click",
          () =>
            setAIMode(
              button.dataset.mode
            )
        );

      });


    $("#ai-form")
      ?.addEventListener(
        "submit",
        sendAIMessage
      );


    $("#open-test")
      ?.addEventListener(
        "click",
        openTestModal
      );


    $("#open-reco")
      ?.addEventListener(
        "click",
        loadRecommendations
      );


    /* Eines de dashboard */

    $$("[data-mode]")
      .forEach(button => {

        button.addEventListener(
          "click",
          () => {

            setAIMode(
              button.dataset.mode
            );

            navigate("ai");

          }
        );

      });


    /* Recomanacions */

    $("#recalc-ai")
      ?.addEventListener(
        "click",
        loadRecommendations
      );


    /* Calendari */

    $("#cal-prev")
      ?.addEventListener(
        "click",
        () => {

          state.calendarOffset--;

          renderCalendar();

        }
      );


    $("#cal-next")
      ?.addEventListener(
        "click",
        () => {

          state.calendarOffset++;

          renderCalendar();

        }
      );


    $("#calendar-today")
      ?.addEventListener(
        "click",
        () => {

          state.calendarOffset = 0;

          renderCalendar();

        }
      );


    /* Planner */

    $("#prev-week")
      ?.addEventListener(
        "click",
        () => {

          state.plannerOffset--;

          renderPlanner();

        }
      );


    $("#next-week")
      ?.addEventListener(
        "click",
        () => {

          state.plannerOffset++;

          renderPlanner();

        }
      );


    $("#generate-plan")
      ?.addEventListener(
        "click",
        generatePlan
      );


    $("#add-session")
      ?.addEventListener(
        "click",
        openStudySessionModal
      );


    /* Notificacions */

    $("#notifications")
      ?.addEventListener(
        "click",
        () => {

          const panel =
            $("#notification-panel");

          if (!panel) return;

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

        }
      );


    /* Cerca */

    $("#global-search")
      ?.addEventListener(
        "keydown",
        event => {

          if (
            event.key === "Enter"
          ) {

            performSearch(
              event.target.value
            );

          }

        }
      );


    /* Cmd/Ctrl + K */

    document.addEventListener(
      "keydown",
      event => {

        if (
          (event.metaKey ||
           event.ctrlKey) &&
          event.key.toLowerCase() === "k"
        ) {

          event.preventDefault();

          $("#global-search")
            ?.focus();

        }

        if (
          event.key === "Escape"
        ) {
          closeModal();

          $("#notification-panel")
            ?.classList.add(
              "hidden"
            );
        }

      }
    );


    /* Mobile */

    $("#mobile-menu")
      ?.addEventListener(
        "click",
        () => {

          $(".sidebar")
            ?.classList.toggle(
              "open"
            );

        }
      );


    /* Perfil */

    $$(".profile-chip")
      .forEach(button => {

        button.addEventListener(
          "click",
          () => navigate("profile")
        );

      });
  }


  /* =======================================================
     ELIMINAR EXAMEN
  ======================================================= */

  async function deleteExam(exam) {

    if (
      !confirm(
        `Vols eliminar l'examen de ${exam.subject}?`
      )
    ) {
      return;
    }


    try {

      await api(
        `/api/exams/${exam.id}`,
        {
          method: "DELETE"
        }
      );

      await loadExams();
      await loadDashboard();

      showToast(
        "Examen eliminat.",
        "success"
      );

    } catch (error) {

      showError(error);

    }
  }


  /* =======================================================
     INICIAR
  ======================================================= */

  document.addEventListener(
    "DOMContentLoaded",
    () => {

      bindApplicationEvents();

      boot();

    }
  );

})();
