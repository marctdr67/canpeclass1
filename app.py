import os
import secrets
import string
from datetime import date, datetime, timedelta
from functools import wraps

from flask import Flask, jsonify, render_template, request, session
from werkzeug.security import check_password_hash, generate_password_hash

try:
    import psycopg2
    from psycopg2.extras import RealDictCursor
except ImportError:  # pragma: no cover
    psycopg2 = None
    RealDictCursor = None

app = Flask(__name__)
app.secret_key = os.getenv("SECRET_KEY", "dev-only-change-me")
app.config.update(
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
    SESSION_COOKIE_SECURE=os.getenv("VERCEL", "").lower() == "1" or os.getenv("FLASK_ENV") == "production",
    PERMANENT_SESSION_LIFETIME=timedelta(days=14),
)

DATABASE_URL = os.getenv("DATABASE_URL", "").strip()


# ============================================================
# HELPERS
# ============================================================

def serialize(value):
    if value is None:
        return None
    if isinstance(value, dict):
        return {k: serialize(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [serialize(v) for v in value]
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    return value


def serialize_many(rows):
    return [serialize(r) for r in (rows or [])]


def db_connect():
    if not DATABASE_URL:
        raise RuntimeError("DATABASE_URL no està configurada a Vercel.")
    if psycopg2 is None:
        raise RuntimeError("La llibreria de PostgreSQL no està instal·lada.")

    url = DATABASE_URL
    if "sslmode=" not in url:
        url += "&sslmode=require" if "?" in url else "?sslmode=require"

    # Supabase Transaction Pooler (6543) is suitable for Vercel serverless.
    return psycopg2.connect(url, connect_timeout=10, cursor_factory=RealDictCursor)


def db_query(sql, params=(), fetch=False, one=False):
    conn = None
    try:
        conn = db_connect()
        with conn.cursor() as cur:
            cur.execute(sql, params)
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


def parse_date(value):
    if not value:
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    try:
        return datetime.strptime(str(value)[:10], "%Y-%m-%d").date()
    except ValueError:
        return None


def safe_int(value, default=0, minimum=0):
    try:
        result = int(value)
    except (TypeError, ValueError):
        result = default
    return max(minimum, result)


def difficulty(value):
    value = str(value or "mitjana").strip().lower()
    aliases = {"1": "baixa", "2": "mitjana", "3": "alta", "easy": "baixa", "medium": "mitjana", "hard": "alta"}
    return aliases.get(value, value if value in {"baixa", "mitjana", "alta"} else "mitjana")


def status(value):
    value = str(value or "pendent").strip().lower()
    aliases = {"pending": "pendent", "in progress": "en procés", "en proces": "en procés", "done": "completada", "completed": "completada"}
    value = aliases.get(value, value)
    return value if value in {"pendent", "en procés", "completada"} else "pendent"


def safe_user(row):
    if not row:
        return None
    name = row.get("name") or row.get("username") or "Usuari"
    return {"id": row["id"], "name": name, "username": name, "email": row["email"], "role": row["role"]}


def log_activity(event_type, details=""):
    uid = session.get("user_id")
    if not uid:
        return
    try:
        db_query("INSERT INTO activity_log (user_id, event_type, details) VALUES (%s,%s,%s)", (uid, event_type, details))
    except Exception as exc:
        print("ACTIVITY LOG ERROR:", repr(exc))


def current_user():
    uid = session.get("user_id")
    if not uid:
        return None
    try:
        return db_query("SELECT id, name, email, role, created_at FROM users WHERE id=%s", (uid,), True, True)
    except Exception:
        return None


def login_required(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        if not session.get("user_id"):
            return jsonify(ok=False, error="Has d'iniciar sessió."), 401
        user = current_user()
        if not user:
            session.clear()
            return jsonify(ok=False, error="La sessió ja no és vàlida."), 401
        return fn(*args, **kwargs)
    return wrapper


def teacher_required(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        user = current_user()
        if not user:
            return jsonify(ok=False, error="Has d'iniciar sessió."), 401
        if user["role"] != "professor":
            return jsonify(ok=False, error="Aquesta acció és només per a professors."), 403
        return fn(*args, **kwargs)
    return wrapper


def class_access(class_id, user_id):
    classroom = db_query(
        """
        SELECT c.*, u.name AS teacher_name
        FROM classes c
        LEFT JOIN users u ON u.id=c.teacher_id
        WHERE c.id=%s
        """, (class_id,), True, True)
    if not classroom:
        return None, False, False
    if classroom["teacher_id"] == user_id:
        return classroom, True, True
    member = db_query("SELECT id FROM class_students WHERE class_id=%s AND student_id=%s", (class_id, user_id), True, True)
    return classroom, bool(member), False


def class_code():
    alphabet = string.ascii_uppercase + string.digits
    for _ in range(100):
        code = "".join(secrets.choice(alphabet) for _ in range(6))
        if not db_query("SELECT id FROM classes WHERE code=%s", (code,), True, True):
            return code
    raise RuntimeError("No s'ha pogut generar un codi únic.")


def classes_for(user_id):
    user = db_query("SELECT id, role FROM users WHERE id=%s", (user_id,), True, True)
    if not user:
        return []
    if user["role"] == "professor":
        rows = db_query(
            """
            SELECT c.*, u.name AS teacher_name,
              'professor' AS membership,
              (SELECT COUNT(*) FROM class_students cs WHERE cs.class_id=c.id) AS student_count
            FROM classes c LEFT JOIN users u ON u.id=c.teacher_id
            WHERE c.teacher_id=%s ORDER BY c.created_at DESC, c.id DESC
            """, (user_id,), True)
    else:
        rows = db_query(
            """
            SELECT c.*, u.name AS teacher_name,
              'student' AS membership,
              (SELECT COUNT(*) FROM class_students cs2 WHERE cs2.class_id=c.id) AS student_count
            FROM classes c
            JOIN class_students cs ON cs.class_id=c.id
            LEFT JOIN users u ON u.id=c.teacher_id
            WHERE cs.student_id=%s ORDER BY c.created_at DESC, c.id DESC
            """, (user_id,), True)
    for row in rows:
        row["teacher"] = row.get("teacher_name")
    return rows


# ============================================================
# PAGES / HEALTH
# ============================================================

@app.get("/")
def index():
    return render_template("index.html")


@app.get("/api/health")
def health():
    try:
        db_query("SELECT 1")
        return jsonify(ok=True, database=True)
    except Exception as exc:
        print("HEALTH ERROR:", repr(exc))
        return jsonify(ok=False, database=False, error="No s'ha pogut connectar amb la base de dades."), 500


# ============================================================
# AUTH
# ============================================================

@app.post("/api/register")
def register():
    data = request.get_json(silent=True) or {}
    name = str(data.get("name", data.get("username", ""))).strip()
    email = str(data.get("email", "")).strip().lower()
    password = str(data.get("password", ""))
    role = str(data.get("role", "alumne")).strip().lower()

    if not name or not email or not password:
        return jsonify(ok=False, error="Completa tots els camps."), 400
    if len(password) < 6:
        return jsonify(ok=False, error="La contrasenya ha de tenir almenys 6 caràcters."), 400
    if role not in {"alumne", "professor"}:
        role = "alumne"

    try:
        if db_query("SELECT id FROM users WHERE LOWER(email)=LOWER(%s)", (email,), True, True):
            return jsonify(ok=False, error="Aquest correu ja està registrat."), 409
        row = db_query(
            """
            INSERT INTO users (name,email,password_hash,role)
            VALUES (%s,%s,%s,%s)
            RETURNING id,name,email,role,created_at
            """, (name, email, generate_password_hash(password), role), True, True)
        session.clear()
        session.permanent = True
        session["user_id"] = row["id"]
        log_activity("register", "Compte creat")
        return jsonify(ok=True, user=safe_user(row)), 201
    except Exception as exc:
        print("REGISTER ERROR:", repr(exc))
        return jsonify(ok=False, error="No s'ha pogut crear el compte."), 500


@app.post("/api/login")
def login():
    data = request.get_json(silent=True) or {}
    email = str(data.get("email", "")).strip().lower()
    password = str(data.get("password", ""))
    if not email or not password:
        return jsonify(ok=False, error="Escriu el correu i la contrasenya."), 400
    try:
        row = db_query("SELECT id,name,email,password_hash,role FROM users WHERE LOWER(email)=LOWER(%s)", (email,), True, True)
        if not row or not check_password_hash(row["password_hash"], password):
            return jsonify(ok=False, error="El correu o la contrasenya no són correctes."), 401
        session.clear()
        session.permanent = True
        session["user_id"] = row["id"]
        log_activity("login", "Inici de sessió")
        return jsonify(ok=True, user=safe_user(row))
    except Exception as exc:
        print("LOGIN ERROR:", repr(exc))
        return jsonify(ok=False, error="No s'ha pogut completar l'operació amb la base de dades."), 500


@app.post("/api/logout")
def logout():
    session.clear()
    return jsonify(ok=True)


@app.get("/api/me")
@login_required
def me():
    return jsonify(ok=True, user=safe_user(current_user()))


@app.put("/api/profile")
@login_required
def update_profile():
    data = request.get_json(silent=True) or {}
    uid = session["user_id"]
    current = current_user()
    name = str(data.get("name", current["name"])).strip() or current["name"]
    email = str(data.get("email", current["email"])).strip().lower() or current["email"]
    try:
        duplicate = db_query("SELECT id FROM users WHERE LOWER(email)=LOWER(%s) AND id<>%s", (email, uid), True, True)
        if duplicate:
            return jsonify(ok=False, error="Aquest correu ja està utilitzat."), 409
        row = db_query("UPDATE users SET name=%s,email=%s WHERE id=%s RETURNING id,name,email,role", (name,email,uid), True, True)
        log_activity("profile_updated", "Perfil actualitzat")
        return jsonify(ok=True, user=safe_user(row))
    except Exception as exc:
        print("PROFILE ERROR:", repr(exc))
        return jsonify(ok=False, error="No s'ha pogut actualitzar el perfil."), 500


# ============================================================
# DASHBOARD
# ============================================================

@app.get("/api/dashboard")
@login_required
def dashboard():
    uid = session["user_id"]
    try:
        tasks = db_query("SELECT * FROM tasks WHERE user_id=%s ORDER BY CASE WHEN status='pendent' THEN 0 WHEN status='en procés' THEN 1 ELSE 2 END, due_date NULLS LAST, id DESC", (uid,), True)
        exams = db_query("SELECT * FROM exams WHERE user_id=%s ORDER BY exam_date ASC, id DESC", (uid,), True)
        classes = classes_for(uid)
        pending = [x for x in tasks if x["status"] != "completada"]
        completed = [x for x in tasks if x["status"] == "completada"]
        limit = date.today() + timedelta(days=2)
        urgent = [x for x in pending if x.get("due_date") and x["due_date"] <= limit]
        study = db_query("SELECT COALESCE(SUM(completed_minutes),0) AS minutes FROM study_sessions WHERE student_id=%s", (uid,), True, True)
        stats = {
            "pending": len(pending), "completed": len(completed), "exams": len(exams),
            "urgent": len(urgent), "progress": round(len(completed)/len(tasks)*100) if tasks else 0,
            "study_minutes": int(study["minutes"] or 0),
        }
        return jsonify(ok=True, tasks=serialize_many(tasks), exams=serialize_many(exams), classes=serialize_many(classes), stats=stats, **{
            "pending_count": stats["pending"], "urgent_count": stats["urgent"], "progress": stats["progress"], "study_minutes": stats["study_minutes"]
        })
    except Exception as exc:
        print("DASHBOARD ERROR:", repr(exc))
        return jsonify(ok=False, error="No s'ha pogut carregar el tauler."), 500


# ============================================================
# TASKS
# ============================================================

@app.get("/api/tasks")
@login_required
def tasks_get():
    try:
        rows = db_query("SELECT * FROM tasks WHERE user_id=%s ORDER BY due_date NULLS LAST, id DESC", (session["user_id"],), True)
        return jsonify(ok=True, tasks=serialize_many(rows))
    except Exception as exc:
        print("TASKS GET ERROR:", repr(exc))
        return jsonify(ok=False, error="No s'han pogut carregar les tasques."), 500


@app.post("/api/tasks")
@login_required
def tasks_create():
    data = request.get_json(silent=True) or {}
    name = str(data.get("name", "")).strip()
    if not name:
        return jsonify(ok=False, error="El nom de la tasca és obligatori."), 400
    due = parse_date(data.get("due_date"))
    estimated = safe_int(data.get("estimated_minutes", 30), 30, 1)
    diff = difficulty(data.get("difficulty"))
    stat = status(data.get("status"))
    try:
        row = db_query(
            """
            INSERT INTO tasks (user_id,class_id,name,subject,description,due_date,estimated_minutes,difficulty,status)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING *
            """, (session["user_id"], data.get("class_id"), name, str(data.get("subject","")).strip(), str(data.get("description","")).strip(), due, estimated, diff, stat), True, True)
        log_activity("task_created", name)
        return jsonify(ok=True, task=serialize(row)), 201
    except Exception as exc:
        print("TASK CREATE ERROR:", repr(exc))
        return jsonify(ok=False, error="No s'ha pogut crear la tasca."), 500


@app.route("/api/tasks/<int:task_id>", methods=["PUT", "PATCH"])
@login_required
def tasks_update(task_id):
    uid = session["user_id"]
    old = db_query("SELECT * FROM tasks WHERE id=%s AND user_id=%s", (task_id,uid), True, True)
    if not old:
        return jsonify(ok=False, error="Tasca no trobada."), 404
    data = request.get_json(silent=True) or {}
    name = str(data.get("name", old["name"])).strip()
    subject = str(data.get("subject", old["subject"] or "")).strip()
    description = str(data.get("description", old["description"] or "")).strip()
    due = parse_date(data.get("due_date")) if "due_date" in data else old["due_date"]
    estimated = safe_int(data.get("estimated_minutes", old["estimated_minutes"] or 30), 30, 1)
    diff = difficulty(data.get("difficulty", old["difficulty"]))
    stat = status(data.get("status", old["status"]))
    try:
        row = db_query(
            """
            UPDATE tasks SET name=%s,subject=%s,description=%s,due_date=%s,estimated_minutes=%s,difficulty=%s,status=%s
            WHERE id=%s AND user_id=%s RETURNING *
            """, (name,subject,description,due,estimated,diff,stat,task_id,uid), True, True)
        if stat == "completada" and old["status"] != "completada":
            log_activity("task_completed", name)
        return jsonify(ok=True, task=serialize(row))
    except Exception as exc:
        print("TASK UPDATE ERROR:", repr(exc))
        return jsonify(ok=False, error="No s'ha pogut actualitzar la tasca."), 500


@app.delete("/api/tasks/<int:task_id>")
@login_required
def tasks_delete(task_id):
    try:
        row = db_query("DELETE FROM tasks WHERE id=%s AND user_id=%s RETURNING id", (task_id,session["user_id"]), True, True)
        if not row:
            return jsonify(ok=False, error="Tasca no trobada."), 404
        log_activity("task_deleted", str(task_id))
        return jsonify(ok=True)
    except Exception as exc:
        print("TASK DELETE ERROR:", repr(exc))
        return jsonify(ok=False, error="No s'ha pogut eliminar la tasca."), 500


# ============================================================
# EXAMS
# ============================================================

@app.get("/api/exams")
@login_required
def exams_get():
    try:
        rows = db_query("SELECT * FROM exams WHERE user_id=%s ORDER BY exam_date ASC, id DESC", (session["user_id"],), True)
        return jsonify(ok=True, exams=serialize_many(rows))
    except Exception as exc:
        print("EXAMS GET ERROR:", repr(exc))
        return jsonify(ok=False, error="No s'han pogut carregar els exàmens."), 500


@app.post("/api/exams")
@login_required
def exams_create():
    data = request.get_json(silent=True) or {}
    subject = str(data.get("subject", "")).strip()
    exam_date = parse_date(data.get("exam_date", data.get("date")))
    if not subject or not exam_date:
        return jsonify(ok=False, error="Indica l'assignatura i la data."), 400
    try:
        row = db_query(
            """
            INSERT INTO exams (user_id,class_id,subject,exam_date,syllabus,difficulty,study_minutes)
            VALUES (%s,%s,%s,%s,%s,%s,%s) RETURNING *
            """, (session["user_id"],data.get("class_id"),subject,exam_date,str(data.get("syllabus","")).strip(),difficulty(data.get("difficulty")),safe_int(data.get("study_minutes",120),120,0)), True, True)
        log_activity("exam_created", subject)
        return jsonify(ok=True, exam=serialize(row)), 201
    except Exception as exc:
        print("EXAM CREATE ERROR:", repr(exc))
        return jsonify(ok=False, error="No s'ha pogut crear l'examen."), 500


@app.route("/api/exams/<int:exam_id>", methods=["PUT", "PATCH"])
@login_required
def exams_update(exam_id):
    uid = session["user_id"]
    old = db_query("SELECT * FROM exams WHERE id=%s AND user_id=%s", (exam_id,uid), True, True)
    if not old:
        return jsonify(ok=False, error="Examen no trobat."), 404
    data = request.get_json(silent=True) or {}
    subject = str(data.get("subject",old["subject"])).strip()
    exam_date = parse_date(data.get("exam_date")) if "exam_date" in data else old["exam_date"]
    try:
        row = db_query("""
            UPDATE exams SET subject=%s,exam_date=%s,syllabus=%s,difficulty=%s,study_minutes=%s
            WHERE id=%s AND user_id=%s RETURNING *
        """, (subject,exam_date,str(data.get("syllabus",old["syllabus"] or "")).strip(),difficulty(data.get("difficulty",old["difficulty"])),safe_int(data.get("study_minutes",old["study_minutes"] or 120),120,0),exam_id,uid), True, True)
        return jsonify(ok=True, exam=serialize(row))
    except Exception as exc:
        print("EXAM UPDATE ERROR:", repr(exc))
        return jsonify(ok=False, error="No s'ha pogut actualitzar l'examen."), 500


@app.delete("/api/exams/<int:exam_id>")
@login_required
def exams_delete(exam_id):
    try:
        row = db_query("DELETE FROM exams WHERE id=%s AND user_id=%s RETURNING id", (exam_id,session["user_id"]), True, True)
        if not row:
            return jsonify(ok=False, error="Examen no trobat."), 404
        return jsonify(ok=True)
    except Exception as exc:
        print("EXAM DELETE ERROR:", repr(exc))
        return jsonify(ok=False, error="No s'ha pogut eliminar l'examen."), 500


# ============================================================
# CLASSES
# ============================================================

@app.get("/api/classes")
@login_required
def classes_get():
    try:
        return jsonify(ok=True, classes=serialize_many(classes_for(session["user_id"])))
    except Exception as exc:
        print("CLASSES GET ERROR:", repr(exc))
        return jsonify(ok=False, error="No s'han pogut carregar les classes."), 500


@app.post("/api/classes")
@teacher_required
def classes_create():
    data = request.get_json(silent=True) or {}
    name = str(data.get("name", "")).strip()
    subject = str(data.get("subject", "")).strip()
    if not name:
        return jsonify(ok=False, error="El nom de la classe és obligatori."), 400
    try:
        code = class_code()
        row = db_query("INSERT INTO classes (name,subject,code,teacher_id) VALUES (%s,%s,%s,%s) RETURNING *", (name,subject,code,session["user_id"]), True, True)
        log_activity("class_created", name)
        return jsonify({"ok": True, "class": serialize(row)}), 201
    except Exception as exc:
        print("CLASS CREATE ERROR:", repr(exc))
        return jsonify(ok=False, error="No s'ha pogut crear la classe."), 500


@app.post("/api/classes/join")
@login_required
def classes_join():
    user = current_user()
    if user["role"] != "alumne":
        return jsonify(ok=False, error="Només els alumnes poden unir-se a una classe."), 403
    code = str((request.get_json(silent=True) or {}).get("code", "")).strip().upper()
    if len(code) != 6 or any(c not in string.ascii_uppercase + string.digits for c in code):
        return jsonify(ok=False, error="El codi ha de tenir 6 caràcters (lletres majúscules i números)."), 400
    try:
        classroom = db_query("SELECT * FROM classes WHERE code=%s", (code,), True, True)
        if not classroom:
            return jsonify(ok=False, error="No existeix cap classe amb aquest codi."), 404
        if db_query("SELECT id FROM class_students WHERE class_id=%s AND student_id=%s", (classroom["id"],user["id"]), True, True):
            return jsonify(ok=False, error="Ja formes part d'aquesta classe."), 409
        db_query("INSERT INTO class_students (class_id,student_id) VALUES (%s,%s)", (classroom["id"],user["id"]))
        log_activity("class_joined", classroom["name"])
        return jsonify({"ok": True, "class": serialize(classroom)}), 201
    except Exception as exc:
        print("CLASS JOIN ERROR:", repr(exc))
        if getattr(exc, "pgcode", None) == "23505":
            return jsonify(ok=False, error="Ja formes part d'aquesta classe."), 409
        return jsonify(ok=False, error="No s'ha pogut unir a la classe."), 500


@app.get("/api/classes/<int:class_id>")
@login_required
def class_detail(class_id):
    classroom, allowed, teacher = class_access(class_id, session["user_id"])
    if not classroom:
        return jsonify(ok=False, error="Classe no trobada."), 404
    if not allowed:
        return jsonify(ok=False, error="No tens accés a aquesta classe."), 403
    try:
        content = db_query(
            """
            SELECT cc.id,cc.class_id,cc.teacher_id AS author_id,cc.kind,cc.title,cc.body,
                   cc.event_date,u.name AS author_name,cc.created_at
            FROM class_content cc LEFT JOIN users u ON u.id=cc.teacher_id
            WHERE cc.class_id=%s ORDER BY cc.created_at DESC,cc.id DESC
            """, (class_id,), True)
        students = []
        if teacher:
            students = db_query("""
                SELECT u.id,u.name,u.email
                FROM class_students cs JOIN users u ON u.id=cs.student_id
                WHERE cs.class_id=%s ORDER BY u.name
            """, (class_id,), True)
        count = db_query("SELECT COUNT(*) AS count FROM class_students WHERE class_id=%s", (class_id,), True, True)
        classroom["teacher"] = classroom.get("teacher_name")
        classroom["student_count"] = int(count["count"] or 0)
        classroom["membership"] = "professor" if teacher else "student"
        return jsonify({"ok": True, "class": serialize(classroom), "content": serialize_many(content), "students": serialize_many(students), "can_manage": teacher})
    except Exception as exc:
        print("CLASS DETAIL ERROR:", repr(exc))
        return jsonify(ok=False, error="No s'ha pogut carregar la classe."), 500


@app.post("/api/classes/<int:class_id>/content")
@teacher_required
def class_content_create(class_id):
    classroom, allowed, teacher = class_access(class_id, session["user_id"])
    if not classroom or not allowed or not teacher:
        return jsonify(ok=False, error="No tens permisos per publicar en aquesta classe."), 403
    data = request.get_json(silent=True) or {}
    title = str(data.get("title", "")).strip()
    body = str(data.get("body", data.get("description", ""))).strip()
    kind = str(data.get("kind", "avis")).strip().lower()
    kind = {"anunci":"avis","announcement":"avis","homework":"tasca","deures":"tasca"}.get(kind, kind)
    if kind not in {"avis","tasca","examen","material"}:
        kind = "avis"
    event_date = parse_date(data.get("event_date", data.get("due_date")))
    if not title:
        return jsonify(ok=False, error="El títol és obligatori."), 400
    try:
        row = db_query("""
            INSERT INTO class_content (class_id,teacher_id,kind,title,body,event_date)
            VALUES (%s,%s,%s,%s,%s,%s) RETURNING *
        """, (class_id,session["user_id"],kind,title,body,event_date), True, True)
        log_activity("class_content_created", title)
        return jsonify(ok=True, content=serialize(row)), 201
    except Exception as exc:
        print("CLASS CONTENT ERROR:", repr(exc))
        return jsonify(ok=False, error="No s'ha pogut publicar el contingut."), 500


# ============================================================
# STUDY SESSIONS / PROGRESS
# ============================================================

@app.get("/api/study-sessions")
@login_required
def study_get():
    try:
        rows = db_query("""
            SELECT id,student_id,task_id,exam_id,session_date,planned_minutes,completed_minutes,notes,created_at
            FROM study_sessions WHERE student_id=%s ORDER BY session_date DESC,id DESC LIMIT 200
        """, (session["user_id"],), True)
        return jsonify(ok=True, sessions=serialize_many(rows))
    except Exception as exc:
        print("STUDY GET ERROR:", repr(exc))
        return jsonify(ok=False, error="No s'han pogut carregar les sessions d'estudi."), 500


@app.post("/api/study-sessions")
@login_required
def study_create():
    data = request.get_json(silent=True) or {}
    d = parse_date(data.get("session_date")) or date.today()
    planned = safe_int(data.get("planned_minutes", data.get("minutes", 0)), 0, 0)
    completed = safe_int(data.get("completed_minutes", data.get("minutes", 0)), 0, 0)
    try:
        row = db_query("""
            INSERT INTO study_sessions (student_id,task_id,exam_id,session_date,planned_minutes,completed_minutes,notes)
            VALUES (%s,%s,%s,%s,%s,%s,%s) RETURNING *
        """, (session["user_id"],data.get("task_id"),data.get("exam_id"),d,planned,completed,str(data.get("notes","")).strip()), True, True)
        log_activity("study_session", f"{completed} minuts")
        return jsonify(ok=True, session=serialize(row)), 201
    except Exception as exc:
        print("STUDY CREATE ERROR:", repr(exc))
        return jsonify(ok=False, error="No s'ha pogut guardar la sessió d'estudi."), 500


@app.get("/api/progress")
@login_required
def progress():
    uid = session["user_id"]
    try:
        tasks = db_query("SELECT COUNT(*) AS total,COUNT(*) FILTER (WHERE status='completada') AS completed FROM tasks WHERE user_id=%s", (uid,), True, True)
        study = db_query("SELECT COALESCE(SUM(planned_minutes),0) AS planned,COALESCE(SUM(completed_minutes),0) AS completed FROM study_sessions WHERE student_id=%s", (uid,), True, True)
        weekly = db_query("""
            SELECT session_date,COALESCE(SUM(planned_minutes),0) AS planned_minutes,COALESCE(SUM(completed_minutes),0) AS completed_minutes
            FROM study_sessions WHERE student_id=%s AND session_date >= CURRENT_DATE-INTERVAL '6 days'
            GROUP BY session_date ORDER BY session_date
        """, (uid,), True)
        tests = db_query("SELECT COUNT(*) AS count,COALESCE(AVG(CASE WHEN total>0 THEN score::numeric/total*100 END),0) AS average FROM test_results WHERE user_id=%s", (uid,), True, True)
        total = int(tasks["total"] or 0); completed = int(tasks["completed"] or 0)
        return jsonify(ok=True, progress=round(completed/total*100) if total else 0, total_tasks=total, completed_tasks=completed,
                        study_minutes=int(study["completed"] or 0), tasks={"total":total,"completed":completed},
                        study={"planned":int(study["planned"] or 0),"completed":int(study["completed"] or 0)},
                        tests={"count":int(tests["count"] or 0),"average":round(float(tests["average"] or 0),1)}, weekly=serialize_many(weekly))
    except Exception as exc:
        print("PROGRESS ERROR:", repr(exc))
        return jsonify(ok=False, error="No s'ha pogut carregar el progrés."), 500


# ============================================================
# AI
# ============================================================

def ai_context(uid):
    tasks = db_query("SELECT name,subject,due_date,difficulty,status,estimated_minutes FROM tasks WHERE user_id=%s AND status!='completada' ORDER BY due_date NULLS LAST,id DESC LIMIT 20", (uid,), True)
    exams = db_query("SELECT subject,exam_date,difficulty,syllabus,study_minutes FROM exams WHERE user_id=%s ORDER BY exam_date LIMIT 10", (uid,), True)
    return {"tasques": serialize_many(tasks), "examens": serialize_many(exams)}


def local_recommendations(uid):
    today = date.today()
    tasks = db_query("SELECT * FROM tasks WHERE user_id=%s AND status!='completada'", (uid,), True)
    exams = db_query("SELECT * FROM exams WHERE user_id=%s", (uid,), True)
    items = []
    rank = {"alta":3,"mitjana":2,"baixa":1}
    for e in exams:
        days = (e["exam_date"]-today).days if e.get("exam_date") else 999
        if days < 0: continue
        score = max(0, 14-days) + rank.get(e.get("difficulty"),2)*2 + min(6,(e.get("study_minutes") or 0)/60)
        items.append({"type":"examen","title":e["subject"],"score":round(score,1),"reason":f"Examen en {days} dies i dificultat {e.get('difficulty','mitjana')}."})
    for t in tasks:
        days = (t["due_date"]-today).days if t.get("due_date") else 999
        score = max(0, 12-days) + rank.get(t.get("difficulty"),2) + min(5,(t.get("estimated_minutes") or 30)/60)
        items.append({"type":"tasca","title":t["name"],"score":round(score,1),"reason":f"Entrega en {days if days>=0 else 'retard'} dies · {t.get('estimated_minutes') or 30} min."})
    items.sort(key=lambda x:x["score"], reverse=True)
    return items[:6]


@app.post("/api/ai")
@login_required
def ai_chat():
    data = request.get_json(silent=True) or {}
    message = str(data.get("message", data.get("prompt", ""))).strip()
    mode = str(data.get("mode", "DUBTE")).upper()
    if not message:
        return jsonify(ok=False, error="Escriu una pregunta."), 400
    try:
        from services.ai import ask_ai
        answer = ask_ai(mode, message, ai_context(session["user_id"]))
    except Exception as exc:
        print("AI ERROR:", repr(exc))
        answer = "Ara mateix no puc connectar amb la IA. Pots continuar organitzant les teves tasques i exàmens mentre ho tornem a intentar."
    log_activity("ai_use", mode)
    return jsonify(ok=True, mode=mode, answer=answer)


@app.get("/api/recommendations")
@login_required
def recommendations():
    try:
        return jsonify(ok=True, recommendations=local_recommendations(session["user_id"]))
    except Exception as exc:
        print("RECOMMENDATIONS ERROR:", repr(exc))
        return jsonify(ok=False, error="No s'han pogut calcular les recomanacions."), 500


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
        return jsonify(ok=False, error="Indica un tema."), 400
    try:
        from services.ai import generate_test
        return jsonify(ok=True, **generate_test(topic))
    except Exception as exc:
        print("AI TEST ERROR:", repr(exc))
        return jsonify(ok=False, error="No s'ha pogut generar el test."), 500


# ============================================================
# TEST RESULTS
# ============================================================

@app.post("/api/test-results")
@login_required
def test_results_create():
    data = request.get_json(silent=True) or {}
    score = safe_int(data.get("score"), 0, 0)
    total = safe_int(data.get("total"), 5, 1)
    subject = str(data.get("subject", data.get("topic", ""))).strip()
    try:
        row = db_query("INSERT INTO test_results (user_id,subject,score,total) VALUES (%s,%s,%s,%s) RETURNING *", (session["user_id"],subject,score,total), True, True)
        log_activity("test_completed", f"{score}/{total}")
        return jsonify(ok=True, result=serialize(row)), 201
    except Exception as exc:
        print("TEST RESULT ERROR:", repr(exc))
        return jsonify(ok=False, error="No s'ha pogut guardar el resultat."), 500


@app.post("/api/tests/result")
@login_required
def test_results_legacy():
    return test_results_create()


@app.get("/api/tests/history")
@login_required
def test_history():
    try:
        rows = db_query("SELECT * FROM test_results WHERE user_id=%s ORDER BY created_at DESC,id DESC LIMIT 50", (session["user_id"],), True)
        return jsonify(ok=True, results=serialize_many(rows))
    except Exception as exc:
        print("TEST HISTORY ERROR:", repr(exc))
        return jsonify(ok=False, error="No s'ha pogut carregar l'historial."), 500


# ============================================================
# ERROR HANDLERS
# ============================================================

@app.errorhandler(404)
def not_found(error):
    if request.path.startswith("/api/"):
        return jsonify(ok=False, error="Recurs no trobat."), 404
    return render_template("error.html"), 404


@app.errorhandler(500)
def internal_error(error):
    if request.path.startswith("/api/"):
        return jsonify(ok=False, error="Error intern del servidor."), 500
    return render_template("error.html"), 500


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.getenv("PORT", "5000")), debug=True)
