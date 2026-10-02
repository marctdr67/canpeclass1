import os
import secrets
import string
from datetime import date, datetime, timedelta
from functools import wraps

from flask import Flask, jsonify, render_template, request, session
from werkzeug.security import generate_password_hash, check_password_hash

try:
    import psycopg2
    from psycopg2.extras import RealDictCursor
except ImportError:
    psycopg2 = None
    RealDictCursor = None


# ============================================================
# CONFIGURACIÓ
# ============================================================

app = Flask(__name__)
app.secret_key = os.getenv("SECRET_KEY", "change-this-secret-in-vercel")
app.config.update(
    JSON_SORT_KEYS=False,
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
    SESSION_COOKIE_SECURE=True,
    PERMANENT_SESSION_LIFETIME=timedelta(days=7),
)

DATABASE_URL = os.getenv("DATABASE_URL", "").strip()


# ============================================================
# BASE DE DADES
# ============================================================

def get_db():
    if not DATABASE_URL:
        raise RuntimeError("DATABASE_URL no està configurada.")
    if psycopg2 is None:
        raise RuntimeError("psycopg2 no està instal·lat.")

    url = DATABASE_URL
    if "sslmode=" not in url:
        url += "&sslmode=require" if "?" in url else "?sslmode=require"

    return psycopg2.connect(url, connect_timeout=10)


def db_query(sql, params=None, fetch=False, one=False):
    conn = None
    try:
        conn = get_db()
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(sql, params or ())
            result = None
            if fetch:
                result = cur.fetchone() if one else cur.fetchall()
            conn.commit()
            return result
    except Exception:
        if conn:
            conn.rollback()
        raise
    finally:
        if conn:
            conn.close()


def serialize(value):
    if value is None:
        return None
    if isinstance(value, dict):
        value = dict(value)
    elif hasattr(value, "items"):
        value = dict(value)
    else:
        return value

    for key, item in list(value.items()):
        if isinstance(item, (datetime, date)):
            value[key] = item.isoformat()
    return value


def serialize_many(rows):
    return [serialize(row) for row in (rows or [])]


def parse_date(value):
    if not value:
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    return datetime.strptime(str(value)[:10], "%Y-%m-%d").date()


def safe_int(value, default=0, minimum=None):
    try:
        result = int(value)
    except (TypeError, ValueError):
        result = default
    if minimum is not None:
        result = max(minimum, result)
    return result


def normalize_difficulty(value):
    value = str(value or "mitjana").strip().lower()
    aliases = {
        "1": "baixa",
        "2": "mitjana",
        "3": "alta",
        "easy": "baixa",
        "medium": "mitjana",
        "hard": "alta",
    }
    return aliases.get(value, value if value in {"baixa", "mitjana", "alta"} else "mitjana")


def normalize_status(value):
    value = str(value or "pendent").strip().lower()
    aliases = {
        "pending": "pendent",
        "in progress": "en procés",
        "en procés": "en procés",
        "en proces": "en procés",
        "done": "completada",
        "completed": "completada",
    }
    value = aliases.get(value, value)
    return value if value in {"pendent", "en procés", "completada"} else "pendent"


# ============================================================
# AUTENTICACIÓ I PERMISOS
# ============================================================

def current_user():
    user_id = session.get("user_id")
    if not user_id:
        return None
    try:
        return db_query(
            """
            SELECT id, name AS username, name, email, role, created_at
            FROM users
            WHERE id = %s
            """,
            (user_id,),
            fetch=True,
            one=True,
        )
    except Exception as exc:
        print("CURRENT USER ERROR:", repr(exc))
        return None


def login_required(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        if not session.get("user_id"):
            return jsonify({"ok": False, "error": "Has d'iniciar sessió."}), 401
        return fn(*args, **kwargs)
    return wrapper


def teacher_required(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        user = current_user()
        if not user:
            return jsonify({"ok": False, "error": "Has d'iniciar sessió."}), 401
        if user["role"] != "professor":
            return jsonify({"ok": False, "error": "Aquesta acció és només per a professors."}), 403
        return fn(*args, **kwargs)
    return wrapper


def log_activity(event_type, details=""):
    user_id = session.get("user_id")
    if not user_id:
        return
    try:
        db_query(
            """
            INSERT INTO activity_log (user_id, event_type, details)
            VALUES (%s, %s, %s)
            """,
            (user_id, event_type, details),
        )
    except Exception as exc:
        print("ACTIVITY LOG ERROR:", repr(exc))


def user_safe(user):
    if not user:
        return None
    return {
        "id": user["id"],
        "username": user.get("username") or user.get("name") or "Usuari",
        "name": user.get("name") or user.get("username") or "Usuari",
        "email": user["email"],
        "role": user["role"],
    }


def generate_class_code():
    alphabet = string.ascii_uppercase + string.digits
    for _ in range(50):
        code = "".join(secrets.choice(alphabet) for _ in range(6))
        row = db_query("SELECT id FROM classes WHERE code = %s", (code,), fetch=True, one=True)
        if not row:
            return code
    raise RuntimeError("No s'ha pogut generar un codi de classe.")


def class_access(class_id, user_id):
    classroom = db_query(
        """
        SELECT c.*, u.name AS teacher_name
        FROM classes c
        LEFT JOIN users u ON u.id = c.teacher_id
        WHERE c.id = %s
        """,
        (class_id,),
        fetch=True,
        one=True,
    )
    if not classroom:
        return None, False, False

    is_teacher = classroom["teacher_id"] == user_id
    if is_teacher:
        return classroom, True, True

    membership = db_query(
        """
        SELECT 1 FROM class_students
        WHERE class_id = %s AND student_id = %s
        """,
        (class_id, user_id),
        fetch=True,
        one=True,
    )
    return classroom, bool(membership), False


# ============================================================
# PÀGINA / HEALTH
# ============================================================

@app.get("/")
def index():
    return render_template("index.html")


@app.get("/api/health")
def health():
    try:
        db_query("SELECT 1")
        return jsonify({"ok": True, "database": "connected"})
    except Exception as exc:
        print("HEALTH ERROR:", repr(exc))
        return jsonify({"ok": False, "database": "error"}), 500


# ============================================================
# AUTENTICACIÓ
# ============================================================

@app.post("/api/register")
def register():
    data = request.get_json(silent=True) or {}
    name = str(data.get("username", data.get("name", ""))).strip()
    email = str(data.get("email", "")).strip().lower()
    password = str(data.get("password", ""))
    role = str(data.get("role", "alumne")).strip().lower()

    if not name or not email or not password:
        return jsonify({"ok": False, "error": "Completa tots els camps."}), 400
    if len(password) < 6:
        return jsonify({"ok": False, "error": "La contrasenya ha de tenir almenys 6 caràcters."}), 400
    if role not in {"alumne", "professor"}:
        role = "alumne"

    try:
        existing = db_query(
            "SELECT id FROM users WHERE LOWER(email) = LOWER(%s)",
            (email,), fetch=True, one=True,
        )
        if existing:
            return jsonify({"ok": False, "error": "Aquest correu ja està registrat."}), 409

        user = db_query(
            """
            INSERT INTO users (name, email, password_hash, role)
            VALUES (%s, %s, %s, %s)
            RETURNING id, name, name AS username, email, role, created_at
            """,
            (name, email, generate_password_hash(password), role),
            fetch=True,
            one=True,
        )

        session.clear()
        session.permanent = True
        session["user_id"] = user["id"]
        log_activity("register", "Compte creat")
        return jsonify({"ok": True, "user": user_safe(user)})

    except Exception as exc:
        print("REGISTER ERROR:", repr(exc))
        return jsonify({"ok": False, "error": "No s'ha pogut crear el compte."}), 500


@app.post("/api/login")
def login():
    data = request.get_json(silent=True) or {}
    email = str(data.get("email", "")).strip().lower()
    password = str(data.get("password", ""))

    if not email or not password:
        return jsonify({"ok": False, "error": "Escriu el correu i la contrasenya."}), 400

    try:
        user = db_query(
            """
            SELECT id, name, name AS username, email, password_hash, role
            FROM users
            WHERE LOWER(email) = LOWER(%s)
            """,
            (email,), fetch=True, one=True,
        )
        if not user or not check_password_hash(user["password_hash"], password):
            return jsonify({"ok": False, "error": "El correu o la contrasenya no són correctes."}), 401

        session.clear()
        session.permanent = True
        session["user_id"] = user["id"]
        log_activity("login", "Inici de sessió")
        return jsonify({"ok": True, "user": user_safe(user)})

    except Exception as exc:
        print("LOGIN ERROR:", repr(exc))
        return jsonify({"ok": False, "error": "No s'ha pogut completar l'operació amb la base de dades."}), 500


@app.post("/api/logout")
def logout():
    session.clear()
    return jsonify({"ok": True})


@app.get("/api/me")
@login_required
def me():
    user = current_user()
    if not user:
        session.clear()
        return jsonify({"ok": False, "error": "Sessió no vàlida."}), 401
    return jsonify({"ok": True, "user": user_safe(user)})


@app.put("/api/profile")
@login_required
def update_profile():
    data = request.get_json(silent=True) or {}
    user_id = session["user_id"]
    name = str(data.get("name", data.get("username", ""))).strip()
    email = str(data.get("email", "")).strip().lower()

    current = current_user()
    if not current:
        return jsonify({"ok": False, "error": "Sessió no vàlida."}), 401

    name = name or current["name"]
    email = email or current["email"]

    try:
        duplicate = db_query(
            "SELECT id FROM users WHERE LOWER(email)=LOWER(%s) AND id<>%s",
            (email, user_id), fetch=True, one=True,
        )
        if duplicate:
            return jsonify({"ok": False, "error": "Aquest correu ja està utilitzat."}), 409

        user = db_query(
            """
            UPDATE users SET name=%s, email=%s
            WHERE id=%s
            RETURNING id, name, name AS username, email, role
            """,
            (name, email, user_id), fetch=True, one=True,
        )
        log_activity("profile_updated", "Perfil actualitzat")
        return jsonify({"ok": True, "user": user_safe(user)})
    except Exception as exc:
        print("PROFILE ERROR:", repr(exc))
        return jsonify({"ok": False, "error": "No s'ha pogut actualitzar el perfil."}), 500


# ============================================================
# DASHBOARD
# ============================================================

@app.get("/api/dashboard")
@login_required
def dashboard():
    user_id = session["user_id"]
    try:
        tasks = db_query(
            """
            SELECT * FROM tasks
            WHERE user_id=%s
            ORDER BY
              CASE WHEN status='pendent' THEN 0
                   WHEN status='en procés' THEN 1 ELSE 2 END,
              due_date NULLS LAST, id DESC
            """,
            (user_id,), fetch=True,
        )
        exams = db_query(
            "SELECT * FROM exams WHERE user_id=%s ORDER BY exam_date ASC, id DESC",
            (user_id,), fetch=True,
        )
        classes = get_classes_data(user_id)

        pending = [t for t in tasks if t["status"] != "completada"]
        completed = [t for t in tasks if t["status"] == "completada"]
        urgent_limit = date.today() + timedelta(days=2)
        urgent = [t for t in pending if t["due_date"] and t["due_date"] <= urgent_limit]
        progress = round(len(completed) / len(tasks) * 100) if tasks else 0

        study = db_query(
            "SELECT COALESCE(SUM(minutes),0) AS minutes FROM study_sessions WHERE user_id=%s",
            (user_id,), fetch=True, one=True,
        )
        stats = {
            "pending": len(pending),
            "completed": len(completed),
            "exams": len(exams),
            "urgent": len(urgent),
            "progress": progress,
            "study_minutes": int(study["minutes"] or 0),
        }

        return jsonify({
            "ok": True,
            "tasks": serialize_many(tasks),
            "exams": serialize_many(exams),
            "classes": serialize_many(classes),
            "stats": stats,
            # aliases for older/newer frontend versions
            "pending_count": stats["pending"],
            "urgent_count": stats["urgent"],
            "progress": progress,
            "study_minutes": stats["study_minutes"],
        })
    except Exception as exc:
        print("DASHBOARD ERROR:", repr(exc))
        return jsonify({"ok": False, "error": "No s'ha pogut carregar el tauler."}), 500


# ============================================================
# TASQUES
# ============================================================

@app.get("/api/tasks")
@login_required
def get_tasks():
    try:
        rows = db_query(
            "SELECT * FROM tasks WHERE user_id=%s ORDER BY due_date NULLS LAST, created_at DESC, id DESC",
            (session["user_id"],), fetch=True,
        )
        return jsonify({"ok": True, "tasks": serialize_many(rows)})
    except Exception as exc:
        print("TASKS GET ERROR:", repr(exc))
        return jsonify({"ok": False, "error": "No s'han pogut carregar les tasques."}), 500


@app.post("/api/tasks")
@login_required
def create_task():
    data = request.get_json(silent=True) or {}
    name = str(data.get("name", "")).strip()
    if not name:
        return jsonify({"ok": False, "error": "El nom de la tasca és obligatori."}), 400

    due_date = parse_date(data.get("due_date"))
    estimated = safe_int(data.get("estimated_minutes", data.get("estimated_time", 30)), 30, 1)
    difficulty = normalize_difficulty(data.get("difficulty"))
    status = normalize_status(data.get("status"))

    try:
        row = db_query(
            """
            INSERT INTO tasks
            (user_id, class_id, name, subject, description, due_date,
             estimated_minutes, difficulty, status, completed_at)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            RETURNING *
            """,
            (
                session["user_id"],
                data.get("class_id"),
                name,
                str(data.get("subject", "")).strip(),
                str(data.get("description", "")).strip(),
                due_date,
                estimated,
                difficulty,
                status,
                datetime.now() if status == "completada" else None,
            ), fetch=True, one=True,
        )
        log_activity("task_created", name)
        return jsonify({"ok": True, "task": serialize(row)}), 201
    except Exception as exc:
        print("TASK CREATE ERROR:", repr(exc))
        return jsonify({"ok": False, "error": "No s'ha pogut crear la tasca."}), 500


@app.route("/api/tasks/<int:task_id>", methods=["PUT", "PATCH"])
@login_required
def update_task(task_id):
    data = request.get_json(silent=True) or {}
    user_id = session["user_id"]

    existing = db_query(
        "SELECT * FROM tasks WHERE id=%s AND user_id=%s",
        (task_id, user_id), fetch=True, one=True,
    )
    if not existing:
        return jsonify({"ok": False, "error": "Tasca no trobada."}), 404

    name = str(data.get("name", existing["name"])).strip()
    subject = str(data.get("subject", existing["subject"] or "")).strip()
    description = str(data.get("description", existing["description"] or "")).strip()
    due_date = parse_date(data["due_date"]) if "due_date" in data else existing["due_date"]
    estimated = safe_int(data.get("estimated_minutes", existing["estimated_minutes"] or 30), 30, 1)
    difficulty = normalize_difficulty(data.get("difficulty", existing["difficulty"]))
    status = normalize_status(data.get("status", existing["status"]))

    completed_at = existing["completed_at"]
    if status == "completada" and not completed_at:
        completed_at = datetime.now()
    elif status != "completada":
        completed_at = None

    try:
        row = db_query(
            """
            UPDATE tasks SET name=%s, subject=%s, description=%s,
              due_date=%s, estimated_minutes=%s, difficulty=%s,
              status=%s, completed_at=%s
            WHERE id=%s AND user_id=%s
            RETURNING *
            """,
            (name, subject, description, due_date, estimated, difficulty,
             status, completed_at, task_id, user_id),
            fetch=True, one=True,
        )
        if status == "completada":
            log_activity("task_completed", name)
        return jsonify({"ok": True, "task": serialize(row)})
    except Exception as exc:
        print("TASK UPDATE ERROR:", repr(exc))
        return jsonify({"ok": False, "error": "No s'ha pogut actualitzar la tasca."}), 500


@app.delete("/api/tasks/<int:task_id>")
@login_required
def delete_task(task_id):
    try:
        row = db_query(
            "DELETE FROM tasks WHERE id=%s AND user_id=%s RETURNING id",
            (task_id, session["user_id"]), fetch=True, one=True,
        )
        if not row:
            return jsonify({"ok": False, "error": "Tasca no trobada."}), 404
        log_activity("task_deleted", str(task_id))
        return jsonify({"ok": True})
    except Exception as exc:
        print("TASK DELETE ERROR:", repr(exc))
        return jsonify({"ok": False, "error": "No s'ha pogut eliminar la tasca."}), 500


# ============================================================
# EXÀMENS
# ============================================================

@app.get("/api/exams")
@login_required
def get_exams():
    try:
        rows = db_query(
            "SELECT * FROM exams WHERE user_id=%s ORDER BY exam_date ASC, id DESC",
            (session["user_id"],), fetch=True,
        )
        return jsonify({"ok": True, "exams": serialize_many(rows)})
    except Exception as exc:
        print("EXAMS GET ERROR:", repr(exc))
        return jsonify({"ok": False, "error": "No s'han pogut carregar els exàmens."}), 500


@app.post("/api/exams")
@login_required
def create_exam():
    data = request.get_json(silent=True) or {}
    subject = str(data.get("subject", "")).strip()
    exam_date = parse_date(data.get("exam_date", data.get("date")))
    if not subject or not exam_date:
        return jsonify({"ok": False, "error": "Indica l'assignatura i la data."}), 400

    study_minutes = safe_int(data.get("study_minutes", data.get("study_time", 120)), 120, 0)
    try:
        row = db_query(
            """
            INSERT INTO exams
            (user_id, class_id, subject, exam_date, syllabus, difficulty, study_minutes)
            VALUES (%s,%s,%s,%s,%s,%s,%s)
            RETURNING *
            """,
            (
                session["user_id"], data.get("class_id"), subject, exam_date,
                str(data.get("syllabus", "")).strip(),
                normalize_difficulty(data.get("difficulty")), study_minutes,
            ), fetch=True, one=True,
        )
        log_activity("exam_created", subject)
        return jsonify({"ok": True, "exam": serialize(row)}), 201
    except Exception as exc:
        print("EXAM CREATE ERROR:", repr(exc))
        return jsonify({"ok": False, "error": "No s'ha pogut crear l'examen."}), 500


@app.route("/api/exams/<int:exam_id>", methods=["PUT", "PATCH"])
@login_required
def update_exam(exam_id):
    data = request.get_json(silent=True) or {}
    existing = db_query(
        "SELECT * FROM exams WHERE id=%s AND user_id=%s",
        (exam_id, session["user_id"]), fetch=True, one=True,
    )
    if not existing:
        return jsonify({"ok": False, "error": "Examen no trobat."}), 404

    subject = str(data.get("subject", existing["subject"])).strip()
    exam_date = parse_date(data["exam_date"]) if "exam_date" in data else existing["exam_date"]
    syllabus = str(data.get("syllabus", existing["syllabus"] or "")).strip()
    difficulty = normalize_difficulty(data.get("difficulty", existing["difficulty"]))
    study_minutes = safe_int(data.get("study_minutes", existing["study_minutes"] or 120), 120, 0)

    try:
        row = db_query(
            """
            UPDATE exams SET subject=%s, exam_date=%s, syllabus=%s,
              difficulty=%s, study_minutes=%s
            WHERE id=%s AND user_id=%s
            RETURNING *
            """,
            (subject, exam_date, syllabus, difficulty, study_minutes, exam_id, session["user_id"]),
            fetch=True, one=True,
        )
        return jsonify({"ok": True, "exam": serialize(row)})
    except Exception as exc:
        print("EXAM UPDATE ERROR:", repr(exc))
        return jsonify({"ok": False, "error": "No s'ha pogut actualitzar l'examen."}), 500


@app.delete("/api/exams/<int:exam_id>")
@login_required
def delete_exam(exam_id):
    try:
        row = db_query(
            "DELETE FROM exams WHERE id=%s AND user_id=%s RETURNING id",
            (exam_id, session["user_id"]), fetch=True, one=True,
        )
        if not row:
            return jsonify({"ok": False, "error": "Examen no trobat."}), 404
        return jsonify({"ok": True})
    except Exception as exc:
        print("EXAM DELETE ERROR:", repr(exc))
        return jsonify({"ok": False, "error": "No s'ha pogut eliminar l'examen."}), 500


# ============================================================
# CLASSES
# ============================================================

def get_classes_data(user_id):
    user = db_query("SELECT id, role FROM users WHERE id=%s", (user_id,), fetch=True, one=True)
    if not user:
        return []

    if user["role"] == "professor":
        return db_query(
            """
            SELECT c.*, u.name AS teacher_name, u.name AS teacher,
              'professor' AS membership,
              (SELECT COUNT(*) FROM class_students cs WHERE cs.class_id=c.id) AS student_count
            FROM classes c
            LEFT JOIN users u ON u.id=c.teacher_id
            WHERE c.teacher_id=%s
            ORDER BY c.created_at DESC, c.id DESC
            """,
            (user_id,), fetch=True,
        )

    return db_query(
        """
        SELECT c.*, u.name AS teacher_name, u.name AS teacher,
          'student' AS membership,
          (SELECT COUNT(*) FROM class_students cs2 WHERE cs2.class_id=c.id) AS student_count
        FROM classes c
        JOIN class_students cs ON cs.class_id=c.id
        LEFT JOIN users u ON u.id=c.teacher_id
        WHERE cs.student_id=%s
        ORDER BY c.created_at DESC, c.id DESC
        """,
        (user_id,), fetch=True,
    )


@app.get("/api/classes")
@login_required
def get_classes():
    try:
        return jsonify({"ok": True, "classes": serialize_many(get_classes_data(session["user_id"]))})
    except Exception as exc:
        print("CLASSES GET ERROR:", repr(exc))
        return jsonify({"ok": False, "error": "No s'han pogut carregar les classes."}), 500


@app.post("/api/classes")
@teacher_required
def create_class():
    data = request.get_json(silent=True) or {}
    name = str(data.get("name", "")).strip()
    subject = str(data.get("subject", "")).strip()
    if not name:
        return jsonify({"ok": False, "error": "El nom de la classe és obligatori."}), 400

    try:
        code = generate_class_code()
        row = db_query(
            """
            INSERT INTO classes (name, subject, code, teacher_id)
            VALUES (%s,%s,%s,%s)
            RETURNING *
            """,
            (name, subject, code, session["user_id"]), fetch=True, one=True,
        )
        log_activity("class_created", name)
        return jsonify({"ok": True, "class": serialize(row)}), 201
    except Exception as exc:
        print("CLASS CREATE ERROR:", repr(exc))
        return jsonify({"ok": False, "error": "No s'ha pogut crear la classe."}), 500


@app.post("/api/classes/join")
@login_required
def join_class():
    user = current_user()
    if user["role"] != "alumne":
        return jsonify({"ok": False, "error": "Només els alumnes poden unir-se a una classe."}), 403

    data = request.get_json(silent=True) or {}
    code = str(data.get("code", "")).strip().upper()
    if len(code) != 6:
        return jsonify({"ok": False, "error": "El codi ha de tenir 6 caràcters."}), 400

    classroom = db_query("SELECT * FROM classes WHERE code=%s", (code,), fetch=True, one=True)
    if not classroom:
        return jsonify({"ok": False, "error": "No existeix cap classe amb aquest codi."}), 404

    already = db_query(
        "SELECT 1 FROM class_students WHERE class_id=%s AND student_id=%s",
        (classroom["id"], user["id"]), fetch=True, one=True,
    )
    if already:
        return jsonify({"ok": False, "error": "Ja formes part d'aquesta classe."}), 409

    try:
        db_query(
            "INSERT INTO class_students (class_id, student_id) VALUES (%s,%s)",
            (classroom["id"], user["id"]),
        )
        log_activity("class_joined", classroom["name"])
        return jsonify({"ok": True, "class": serialize(classroom)})
    except Exception as exc:
        print("CLASS JOIN ERROR:", repr(exc))
        return jsonify({"ok": False, "error": "No s'ha pogut unir a la classe."}), 500


@app.get("/api/classes/<int:class_id>")
@login_required
def class_detail(class_id):
    user = current_user()
    classroom, allowed, is_teacher = class_access(class_id, user["id"])
    if not classroom:
        return jsonify({"ok": False, "error": "Classe no trobada."}), 404
    if not allowed:
        return jsonify({"ok": False, "error": "No tens accés a aquesta classe."}), 403

    try:
        content = db_query(
            """
            SELECT cc.id, cc.class_id, cc.author_id,
              cc.content_type, cc.title, cc.body, cc.due_date,
              cc.created_at, u.name AS author_name
            FROM class_content cc
            LEFT JOIN users u ON u.id=cc.author_id
            WHERE cc.class_id=%s
            ORDER BY cc.created_at DESC, cc.id DESC
            """,
            (class_id,), fetch=True,
        )

        # Compatibilitat amb el frontend de l'aula.
        for item in content:
            item["kind"] = item.get("content_type") or "avis"
            item["event_date"] = item.get("due_date")

        students = []
        if is_teacher:
            students = db_query(
                """
                SELECT u.id, u.name AS username, u.name, u.email
                FROM class_students cs
                JOIN users u ON u.id=cs.student_id
                WHERE cs.class_id=%s
                ORDER BY u.name
                """,
                (class_id,), fetch=True,
            )

        student_count = db_query(
            "SELECT COUNT(*) AS count FROM class_students WHERE class_id=%s",
            (class_id,), fetch=True, one=True,
        )

        classroom["student_count"] = int(student_count["count"] or 0)
        classroom["membership"] = "professor" if is_teacher else "student"
        classroom["teacher"] = classroom.get("teacher_name")

        return jsonify({
            "ok": True,
            "class": serialize(classroom),
            "content": serialize_many(content),
            "students": serialize_many(students),
            "can_manage": is_teacher,
        })
    except Exception as exc:
        print("CLASS DETAIL ERROR:", repr(exc))
        return jsonify({"ok": False, "error": "No s'ha pogut carregar el tauler."}), 500


@app.post("/api/classes/<int:class_id>/content")
@teacher_required
def create_class_content(class_id):
    classroom, allowed, is_teacher = class_access(class_id, session["user_id"])
    if not classroom or not allowed or not is_teacher:
        return jsonify({"ok": False, "error": "No tens permisos per publicar en aquesta classe."}), 403

    data = request.get_json(silent=True) or {}
    title = str(data.get("title", "")).strip()
    body = str(data.get("body", data.get("description", ""))).strip()
    kind = str(data.get("kind", data.get("content_type", data.get("type", "avis")))).strip().lower()
    due_date = parse_date(data.get("event_date", data.get("due_date")))

    if kind not in {"avis", "tasca", "examen", "material", "anunci", "homework"}:
        kind = "avis"
    if kind == "anunci":
        kind = "avis"
    if kind == "homework":
        kind = "tasca"
    if not title:
        return jsonify({"ok": False, "error": "El títol és obligatori."}), 400

    try:
        row = db_query(
            """
            INSERT INTO class_content
            (class_id, author_id, content_type, title, body, due_date)
            VALUES (%s,%s,%s,%s,%s,%s)
            RETURNING *
            """,
            (class_id, session["user_id"], kind, title, body, due_date),
            fetch=True, one=True,
        )
        log_activity("class_content_created", title)
        row["kind"] = row.get("content_type") or kind
        row["event_date"] = row.get("due_date")
        return jsonify({"ok": True, "content": serialize(row)}), 201
    except Exception as exc:
        print("CLASS CONTENT ERROR:", repr(exc))
        return jsonify({"ok": False, "error": "No s'ha pogut publicar el contingut."}), 500


# ============================================================
# SESSIONS D'ESTUDI
# ============================================================

@app.get("/api/study-sessions")
@login_required
def get_study_sessions():
    try:
        rows = db_query(
            """
            SELECT id, user_id, task_id, exam_id, session_date, minutes, notes, created_at
            FROM study_sessions
            WHERE user_id=%s
            ORDER BY session_date DESC, id DESC
            LIMIT 200
            """,
            (session["user_id"],), fetch=True,
        )
        return jsonify({"ok": True, "sessions": serialize_many(rows)})
    except Exception as exc:
        print("STUDY GET ERROR:", repr(exc))
        return jsonify({"ok": False, "error": "No s'han pogut carregar les sessions d'estudi."}), 500


@app.post("/api/study-sessions")
@login_required
def create_study_session():
    data = request.get_json(silent=True) or {}
    session_date = parse_date(data.get("session_date")) or date.today()
    minutes = safe_int(data.get("minutes", data.get("completed_minutes", 0)), 0, 0)
    notes = str(data.get("notes", "")).strip()

    try:
        row = db_query(
            """
            INSERT INTO study_sessions
            (user_id, task_id, exam_id, session_date, minutes, notes)
            VALUES (%s,%s,%s,%s,%s,%s)
            RETURNING *
            """,
            (session["user_id"], data.get("task_id"), data.get("exam_id"), session_date, minutes, notes),
            fetch=True, one=True,
        )
        log_activity("study_session", f"{minutes} minuts")
        return jsonify({"ok": True, "session": serialize(row)}), 201
    except Exception as exc:
        print("STUDY CREATE ERROR:", repr(exc))
        return jsonify({"ok": False, "error": "No s'ha pogut guardar la sessió d'estudi."}), 500


# ============================================================
# PROGRÉS
# ============================================================

@app.get("/api/progress")
@login_required
def progress():
    user_id = session["user_id"]
    try:
        tasks = db_query(
            """
            SELECT COUNT(*) AS total,
              COUNT(*) FILTER (WHERE status='completada') AS completed
            FROM tasks WHERE user_id=%s
            """,
            (user_id,), fetch=True, one=True,
        )
        study = db_query(
            """
            SELECT COALESCE(SUM(minutes),0) AS minutes
            FROM study_sessions WHERE user_id=%s
            """,
            (user_id,), fetch=True, one=True,
        )
        weekly = db_query(
            """
            SELECT session_date, COALESCE(SUM(minutes),0) AS minutes
            FROM study_sessions
            WHERE user_id=%s
              AND session_date >= CURRENT_DATE - INTERVAL '6 days'
            GROUP BY session_date
            ORDER BY session_date
            """,
            (user_id,), fetch=True,
        )
        test_stats = db_query(
            """
            SELECT COUNT(*) AS tests,
              COALESCE(AVG(CASE WHEN total>0 THEN score::numeric/total*100 END),0) AS average
            FROM test_results WHERE user_id=%s
            """,
            (user_id,), fetch=True, one=True,
        )

        total = int(tasks["total"] or 0)
        completed = int(tasks["completed"] or 0)
        percentage = round(completed / total * 100) if total else 0
        minutes = int(study["minutes"] or 0)

        return jsonify({
            "ok": True,
            "progress": percentage,
            "total_tasks": total,
            "completed_tasks": completed,
            "study_minutes": minutes,
            "tasks": {"total": total, "completed": completed},
            "study": {"planned": minutes, "completed": minutes},
            "tests": {
                "count": int(test_stats["tests"] or 0),
                "average": round(float(test_stats["average"] or 0), 1),
            },
            "weekly": serialize_many(weekly),
        })
    except Exception as exc:
        print("PROGRESS ERROR:", repr(exc))
        return jsonify({"ok": False, "error": "No s'ha pogut carregar el progrés."}), 500


# ============================================================
# IA / RECOMANACIONS
# ============================================================

def build_ai_context(user_id):
    tasks = db_query(
        """
        SELECT name, subject, due_date, difficulty, status, estimated_minutes
        FROM tasks WHERE user_id=%s AND status!='completada'
        ORDER BY due_date NULLS LAST LIMIT 20
        """,
        (user_id,), fetch=True,
    )
    exams = db_query(
        """
        SELECT subject, exam_date, difficulty, syllabus, study_minutes
        FROM exams WHERE user_id=%s ORDER BY exam_date LIMIT 10
        """,
        (user_id,), fetch=True,
    )
    return {"tasques": serialize_many(tasks), "examens": serialize_many(exams)}


@app.post("/api/ai")
@login_required
def ai():
    data = request.get_json(silent=True) or {}
    mode = str(data.get("mode", "DUBTE")).upper()
    message = str(data.get("message", data.get("prompt", ""))).strip()
    if not message:
        return jsonify({"ok": False, "error": "Escriu alguna cosa per a la IA."}), 400

    try:
        from services.ai import ask_ai
        answer = ask_ai(mode=mode, message=message, context=build_ai_context(session["user_id"]))
    except Exception as exc:
        print("AI ERROR:", repr(exc))
        answer = "Ara mateix no puc connectar amb el servei d'IA. Pots continuar organitzant les teves tasques i exàmens mentre ho tornem a intentar."

    log_activity("ai_use", mode)
    return jsonify({"ok": True, "mode": mode, "answer": answer})


@app.get("/api/recommendations")
@login_required
def recommendations():
    user_id = session["user_id"]
    try:
        tasks = db_query(
            """
            SELECT * FROM tasks
            WHERE user_id=%s AND status!='completada'
            ORDER BY due_date NULLS LAST,
              CASE difficulty WHEN 'alta' THEN 0 WHEN 'mitjana' THEN 1 ELSE 2 END,
              id DESC LIMIT 10
            """,
            (user_id,), fetch=True,
        )
        result = []
        for task in tasks:
            reason = "Tasca pendent"
            if task["due_date"]:
                days = (task["due_date"] - date.today()).days
                if days < 0:
                    reason = "Està fora de termini."
                elif days == 0:
                    reason = "És per avui."
                elif days <= 2:
                    reason = "La data límit és molt propera."
                elif task["difficulty"] == "alta":
                    reason = "Té una dificultat elevada."
            result.append({"task": serialize(task), "reason": reason})
        return jsonify({"ok": True, "recommendations": result})
    except Exception as exc:
        print("RECOMMENDATIONS ERROR:", repr(exc))
        return jsonify({"ok": False, "error": "No s'han pogut calcular les recomanacions."}), 500


@app.get("/api/ai/recommendations")
@login_required
def ai_recommendations():
    return recommendations()


@app.post("/api/ai/test")
@login_required
def ai_test():
    data = request.get_json(silent=True) or {}
    topic = str(data.get("topic", "")).strip()
    if not topic:
        return jsonify({"ok": False, "error": "Indica un tema per crear el test."}), 400
    try:
        from services.ai import generate_test
        result = generate_test(topic)
        return jsonify({"ok": True, **result})
    except Exception as exc:
        print("AI TEST ERROR:", repr(exc))
        return jsonify({"ok": False, "error": "No s'ha pogut generar el test."}), 500


# ============================================================
# TESTS
# ============================================================

@app.post("/api/test-results")
@login_required
def save_test_result():
    data = request.get_json(silent=True) or {}
    score = safe_int(data.get("score"), 0, 0)
    total = safe_int(data.get("total"), 5, 1)
    subject = str(data.get("subject", data.get("topic", ""))).strip()
    try:
        row = db_query(
            """
            INSERT INTO test_results (user_id, subject, score, total)
            VALUES (%s,%s,%s,%s)
            RETURNING *
            """,
            (session["user_id"], subject, score, total), fetch=True, one=True,
        )
        log_activity("test_completed", f"{score}/{total}")
        return jsonify({"ok": True, "result": serialize(row)}), 201
    except Exception as exc:
        print("TEST RESULT ERROR:", repr(exc))
        return jsonify({"ok": False, "error": "No s'ha pogut guardar el resultat."}), 500


@app.post("/api/tests/result")
@login_required
def save_test_result_legacy():
    return save_test_result()


@app.get("/api/tests/history")
@login_required
def test_history():
    try:
        rows = db_query(
            "SELECT * FROM test_results WHERE user_id=%s ORDER BY created_at DESC LIMIT 50",
            (session["user_id"],), fetch=True,
        )
        return jsonify({"ok": True, "results": serialize_many(rows)})
    except Exception as exc:
        print("TEST HISTORY ERROR:", repr(exc))
        return jsonify({"ok": False, "error": "No s'ha pogut carregar l'historial."}), 500


# ============================================================
# ERRORS
# ============================================================

@app.errorhandler(404)
def not_found(error):
    if request.path.startswith("/api/"):
        return jsonify({"ok": False, "error": "Recurs no trobat."}), 404
    return render_template("error.html"), 404


@app.errorhandler(500)
def server_error(error):
    if request.path.startswith("/api/"):
        return jsonify({"ok": False, "error": "Error intern del servidor."}), 500
    return render_template("error.html"), 500


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.getenv("PORT", "5000")), debug=True)
