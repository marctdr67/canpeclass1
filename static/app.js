const $ = (s) => document.querySelector(s);

let mode = "dubte";

const esc = (x) =>
  String(x ?? "").replace(/[&<>"']/g, (m) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[m]));

async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || "S'ha produït un error.");
  }

  return data;
}

function showError(error) {
  const element = $("#error");
  if (element) {
    element.textContent = error.message;
  }
}

async function load() {
  try {
    const me = await api("/api/me");

    if (!me.user) {
      $("#auth").hidden = false;
      $("#app").hidden = true;
      return;
    }

    $("#auth").hidden = true;
    $("#app").hidden = false;

    $("#hello").textContent = `Hola, ${me.user.name}!`;

    $("#teacher").hidden = me.user.role !== "teacher";
    $("#student").hidden = me.user.role !== "student";

    const dashboard = await api("/api/dashboard");

    const pending = dashboard.tasks.filter(
      task => task.status !== "completada"
    ).length;

    $("#info").textContent =
      `${pending} tasques pendents · ${dashboard.exams.length} exàmens`;

    $("#tasks").innerHTML =
      dashboard.tasks.map(task => `
        <div class="item">
          <b>${esc(task.name)}</b> · ${esc(task.subject)}
          <br>
          <small>
            ${task.due_date || "Sense data"} ·
            ${task.estimated_minutes} min ·
            ${esc(task.status)}
          </small>
          <br>
          <button onclick="completeTask(${task.id})">
            Completar
          </button>
        </div>
      `).join("") || "<p>Cap tasca.</p>";

    $("#exams").innerHTML =
      dashboard.exams.map(exam => `
        <div class="item">
          <b>${esc(exam.subject)}</b>
          <br>
          <small>
            ${exam.exam_date} ·
            ${exam.study_minutes} min
          </small>
          <br>
          ${esc(exam.syllabus || "")}
        </div>
      `).join("") || "<p>Cap examen.</p>";

  } catch (error) {
    showError(error);
  }
}

async function completeTask(id) {
  try {
    await api(`/api/tasks/${id}`, {
      method: "PATCH",
      body: JSON.stringify({
        status: "completada"
      })
    });

    await load();
  } catch (error) {
    showError(error);
  }
}

$("#login").addEventListener("submit", async (event) => {
  event.preventDefault();

  try {
    await api("/api/login", {
      method: "POST",
      body: JSON.stringify(
        Object.fromEntries(new FormData(event.target))
      )
    });

    await load();

  } catch (error) {
    showError(error);
  }
});

$("#register").addEventListener("submit", async (event) => {
  event.preventDefault();

  try {
    await api("/api/register", {
      method: "POST",
      body: JSON.stringify(
        Object.fromEntries(new FormData(event.target))
      )
    });

    await load();

  } catch (error) {
    showError(error);
  }
});

$("#logout").addEventListener("click", async () => {
  await api("/api/logout", {
    method: "POST"
  });

  await load();
});

$("#task").addEventListener("submit", async (event) => {
  event.preventDefault();

  try {
    await api("/api/tasks", {
      method: "POST",
      body: JSON.stringify(
        Object.fromEntries(new FormData(event.target))
      )
    });

    event.target.reset();
    await load();

  } catch (error) {
    showError(error);
  }
});

$("#exam").addEventListener("submit", async (event) => {
  event.preventDefault();

  try {
    await api("/api/exams", {
      method: "POST",
      body: JSON.stringify(
        Object.fromEntries(new FormData(event.target))
      )
    });

    event.target.reset();
    await load();

  } catch (error) {
    showError(error);
  }
});

$("#newclass").addEventListener("submit", async (event) => {
  event.preventDefault();

  try {
    const result = await api("/api/classes", {
      method: "POST",
      body: JSON.stringify(
        Object.fromEntries(new FormData(event.target))
      )
    });

    $("#classresult").textContent =
      `Codi de classe: ${result.class.code}`;

    event.target.reset();

  } catch (error) {
    showError(error);
  }
});

$("#join").addEventListener("submit", async (event) => {
  event.preventDefault();

  try {
    await api("/api/classes/join", {
      method: "POST",
      body: JSON.stringify(
        Object.fromEntries(new FormData(event.target))
      )
    });

    event.target.reset();
    await load();

  } catch (error) {
    showError(error);
  }
});

document.querySelectorAll("[data-mode]").forEach((button) => {
  button.addEventListener("click", () => {
    mode = button.dataset.mode;
  });
});

$("#ask").addEventListener("click", async () => {
  try {
    const result = await api("/api/ai", {
      method: "POST",
      body: JSON.stringify({
        mode: mode,
        message: $("#question").value
      })
    });

    $("#answer").textContent =
      typeof result.result === "string"
        ? result.result
        : JSON.stringify(result.result, null, 2);

  } catch (error) {
    $("#answer").textContent = error.message;
  }
});

load();
