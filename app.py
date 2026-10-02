import os
import secrets
import string
from datetime import datetime, date, timedelta
from functools import wraps

from flask import Flask, jsonify, render_template, request, session
from werkzeug.security import generate_password_hash, check_password_hash

try:
    import psycopg2
    from psycopg2.extras import RealDictCursor
except ImportError:
    psycopg2 = None
    RealDictCursor = None


app = Flask(__name__)
app.secret_key = os.getenv(
    "SECRET_KEY",
    "miniclassroom-development-secret-change-me"
)

DATABASE_URL = os.getenv("DATABASE_URL")
app.config["JSON_SORT_KEYS"] = False


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
        separator = "&" if "?" in url else "?"
        url += separator + "sslmode=require"

    return psycopg2.connect(
        url,
        connect_timeout=10
    )


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


def init_db():
    db_query("SELECT 1")


def ensure_db():
    if not DATABASE_URL:
        return

    try:
        init_db()
    except Exception as exc:
        print("DATABASE INIT ERROR:", repr(exc))


# ============================================================
# HELPERS
# ============================================================

def today():
    return date.today()


def parse_date(value):
    if not value:
        return None

    if isinstance(value, date):
        return value

    return datetime.strptime(
        str(value)[:10],
        "%Y-%m-%d"
    ).date()


def serialize(row):
    if row is None:
        return None

    result = dict(row)

    for key, value in list(result.items()):
        if isinstance(value, (date, datetime)):
            result[key] = value.isoformat()

    return result


def serialize_many(rows):
    return [serialize(row) for row in rows]


def current_user():
    user_id = session.get("user_id")

    if not user_id:
        return None

    try:
        return db_query(
            """
            SELECT
                id,
                name AS username,
                email,
                CASE
                    WHEN LOWER(role) IN ('teacher', 'professor')
                    THEN 'professor'
                    ELSE 'alumne'
                END AS role,
                created_at
            FROM users
            WHERE id = %s
            """,
            (user_id,),
            fetch=True,
            one=True
        )
    except Exception:
        return None


def login_required(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        if not session.get("user_id"):
            return jsonify({
                "ok": False,
                "error": "Has d'iniciar sessió."
            }), 401

        return fn(*args, **kwargs)

    return wrapper


def teacher_required(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        user = current_user()

        if not user:
            return jsonify({
                "ok": False,
                "error": "Has d'iniciar sessió."
            }), 401

        if user["role"] != "professor":
            return jsonify({
                "ok": False,
                "error": "Aquesta acció és només per a professors."
            }), 403

        return fn(*args, **kwargs)

    return wrapper


def log_activity(event_type, details=""):
    user_id = session.get("user_id")

    if not user_id:
        return

    try:
        db_query(
            """
            INSERT INTO activity_log
            (
                user_id,
                event_type,
                details
            )
            VALUES (%s, %s, %s)
            """,
            (
                user_id,
                event_type,
                details
            )
        )
    except Exception as exc:
        print("ACTIVITY LOG ERROR:", repr(exc))


def normalize_difficulty(value):
    if value is None:
        return "mitjana"

    value = str(value).strip().lower()

    mapping = {
        "1": "baixa",
        "2": "mitjana",
        "3": "alta",
        "baixa": "baixa",
        "mitjana": "mitjana",
        "alta": "alta",
        "low": "baixa",
        "medium": "mitjana",
        "high": "alta"
    }

    return mapping.get(value, "mitjana")


def generate_class_code():
    alphabet = string.ascii_uppercase + string.digits

    for _ in range(100):
        code = "".join(
            secrets.choice(alphabet)
            for _ in range(6)
        )

        exists = db_query(
            """
            SELECT id
            FROM classes
            WHERE code = %s
            """,
            (code,),
            fetch=True,
            one=True
        )

        if not exists:
            return code

    raise RuntimeError(
        "No s'ha pogut generar un codi de classe únic."
    )


def json_error(message, status=400):
    return jsonify({
        "ok": False,
        "error": message
    }), status


# ============================================================
# PÀGINA PRINCIPAL
# ============================================================

@app.route("/")
def index():
    return render_template("index.html")


@app.get("/api/health")
def health():
    try:
        db_query("SELECT 1")

        return jsonify({
            "ok": True,
            "database": True
        })

    except Exception as exc:
        return jsonify({
            "ok": False,
            "database": False,
            "error": str(exc)
        }), 500


# ============================================================
# AUTENTICACIÓ
# ============================================================

@app.post("/api/register")
def register():
    data = request.get_json(silent=True) or {}

    name = (
        data.get("name")
        or data.get("username")
        or ""
    ).strip()

    email = (
        data.get("email")
        or ""
    ).strip().lower()

    password = data.get("password") or ""

    role = (
        data.get("role")
        or "alumne"
    ).strip().lower()

    if not name:
        return json_error(
            "Has d'introduir el teu nom."
        )

    if not email:
        return json_error(
            "Has d'introduir el teu correu."
        )

    if len(password) < 6:
        return json_error(
            "La contrasenya ha de tenir almenys 6 caràcters."
        )

    if role not in ("alumne", "professor"):
        role = "alumne"

    existing = db_query(
        """
        SELECT id
        FROM users
        WHERE LOWER(email) = LOWER(%s)
        """,
        (email,),
        fetch=True,
        one=True
    )

    if existing:
        return json_error(
            "Aquest correu ja està registrat.",
            409
        )

    password_hash = generate_password_hash(password)

    row = db_query(
        """
        INSERT INTO users
        (
            name,
            email,
            password_hash,
            role
        )
        VALUES (%s, %s, %s, %s)
        RETURNING
            id,
            name,
            email,
            role,
            created_at
        """,
        (
            name,
            email,
            password_hash,
            role
        ),
        fetch=True,
        one=True
    )

    user = serialize(row)

    session["user_id"] = user["id"]

    log_activity(
        "register",
        "Nou compte creat"
    )

    return jsonify({
        "ok": True,
        "user": {
            "id": user["id"],
            "username": user["name"],
            "name": user["name"],
            "email": user["email"],
            "role": (
                "professor"
                if str(user["role"]).lower()
                in ("professor", "teacher")
                else "alumne"
            )
        }
    })


@app.post("/api/login")
def login():
    data = request.get_json(silent=True) or {}

    email = (
        data.get("email")
        or ""
    ).strip().lower()

    password = data.get("password") or ""

    if not email or not password:
        return json_error(
            "Introdueix el correu i la contrasenya."
        )

    row = db_query(
        """
        SELECT
            id,
            name,
            email,
            password_hash,
            role,
            created_at
        FROM users
        WHERE LOWER(email) = LOWER(%s)
        """,
        (email,),
        fetch=True,
        one=True
    )

    if not row:
        return json_error(
            "El correu o la contrasenya no són correctes.",
            401
        )

    if not check_password_hash(
        row["password_hash"],
        password
    ):
        return json_error(
            "El correu o la contrasenya no són correctes.",
            401
        )

    session["user_id"] = row["id"]

    role = (
        "professor"
        if str(row["role"]).lower()
        in ("professor", "teacher")
        else "alumne"
    )

    log_activity(
        "login",
        "Inici de sessió"
    )

    return jsonify({
        "ok": True,
        "user": {
            "id": row["id"],
            "username": row["name"],
            "name": row["name"],
            "email": row["email"],
            "role": role
        }
    })


@app.post("/api/logout")
def logout():
    session.clear()

    return jsonify({
        "ok": True
    })


@app.get("/api/me")
def me():
    user = current_user()

    if not user:
        return jsonify({
            "ok": True,
            "authenticated": False,
            "user": None
        })

    user = serialize(user)

    return jsonify({
        "ok": True,
        "authenticated": True,
        "user": {
            "id": user["id"],
            "username": user["username"],
            "name": user["username"],
            "email": user["email"],
            "role": user["role"],
            "created_at": user.get("created_at")
        }
    })


# ============================================================
# DASHBOARD
# ============================================================

@app.get("/api/dashboard")
@login_required
def dashboard():
    user_id = session["user_id"]

    pending = db_query(
        """
        SELECT COUNT(*) AS count
        FROM tasks
        WHERE user_id = %s
          AND LOWER(COALESCE(status, 'pendent'))
          != 'completada'
        """,
        (user_id,),
        fetch=True,
        one=True
    )["count"]

    urgent = db_query(
        """
        SELECT COUNT(*) AS count
        FROM tasks
        WHERE user_id = %s
          AND LOWER(COALESCE(status, 'pendent'))
          != 'completada'
          AND due_date IS NOT NULL
          AND due_date <= CURRENT_DATE + INTERVAL '3 days'
        """,
        (user_id,),
        fetch=True,
        one=True
    )["count"]

    total = db_query(
        """
        SELECT COUNT(*) AS count
        FROM tasks
        WHERE user_id = %s
        """,
        (user_id,),
        fetch=True,
        one=True
    )["count"]

    completed = db_query(
        """
        SELECT COUNT(*) AS count
        FROM tasks
        WHERE user_id = %s
          AND LOWER(COALESCE(status, '')) = 'completada'
        """,
        (user_id,),
        fetch=True,
        one=True
    )["count"]

    progress = (
        round((completed / total) * 100)
        if total
        else 0
    )

    exams = db_query(
        """
        SELECT COUNT(*) AS count
        FROM exams
        WHERE user_id = %s
          AND exam_date >= CURRENT_DATE
        """,
        (user_id,),
        fetch=True,
        one=True
    )["count"]

    upcoming_tasks = db_query(
        """
        SELECT *
        FROM tasks
        WHERE user_id = %s
          AND LOWER(COALESCE(status, 'pendent'))
          != 'completada'
        ORDER BY due_date NULLS LAST, id DESC
        LIMIT 6
        """,
        (user_id,),
        fetch=True
    )

    upcoming_exams = db_query(
        """
        SELECT *
        FROM exams
        WHERE user_id = %s
          AND exam_date >= CURRENT_DATE
        ORDER BY exam_date ASC
        LIMIT 5
        """,
        (user_id,),
        fetch=True
    )

    return jsonify({
        "ok": True,
        "stats": {
            "pending": pending,
            "urgent": urgent,
            "exams": exams,
            "progress": progress
        },
        "pending_count": pending,
        "urgent_count": urgent,
        "exam_count": exams,
        "progress": progress,
        "tasks": serialize_many(upcoming_tasks),
        "exams": serialize_many(upcoming_exams)
    })


# ============================================================
# TASQUES
# ============================================================

@app.get("/api/tasks")
@login_required
def get_tasks():
    user_id = session["user_id"]

    rows = db_query(
        """
        SELECT *
        FROM tasks
        WHERE user_id = %s
        ORDER BY due_date NULLS LAST, id DESC
        """,
        (user_id,),
        fetch=True
    )

    return jsonify({
        "ok": True,
        "tasks": serialize_many(rows)
    })


@app.post("/api/tasks")
@login_required
def create_task():
    data = request.get_json(silent=True) or {}

    user_id = session["user_id"]

    name = (
        data.get("name")
        or data.get("title")
        or ""
    ).strip()

    subject = (
        data.get("subject")
        or data.get("assignatura")
        or ""
    ).strip()

    description = (
        data.get("description")
        or ""
    ).strip()

    due_date = (
        data.get("due_date")
        or data.get("date")
        or None
    )

    estimated = data.get(
        "estimated_minutes",
        data.get("estimated_time", 30)
    )

    try:
        estimated = int(estimated or 30)
    except (TypeError, ValueError):
        estimated = 30

    difficulty = normalize_difficulty(
        data.get("difficulty")
    )

    status = (
        data.get("status")
        or "pendent"
    ).strip().lower()

    if status not in (
        "pendent",
        "en procés",
        "en proces",
        "completada"
    ):
        status = "pendent"

    if status == "en proces":
        status = "en procés"

    if not name:
        return json_error(
            "Has d'introduir el nom de la tasca."
        )

    row = db_query(
        """
        INSERT INTO tasks
        (
            user_id,
            class_id,
            name,
            subject,
            description,
            due_date,
            estimated_minutes,
            difficulty,
            status
        )
        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)
        RETURNING *
        """,
        (
            user_id,
            data.get("class_id"),
            name,
            subject,
            description,
            due_date,
            estimated,
            difficulty,
            status
        ),
        fetch=True,
        one=True
    )

    log_activity(
        "task_created",
        name
    )

    return jsonify({
        "ok": True,
        "task": serialize(row)
    }), 201


@app.route(
    "/api/tasks/<int:task_id>",
    methods=["PUT", "PATCH"]
)
@login_required
def update_task(task_id):
    user_id = session["user_id"]

    existing = db_query(
        """
        SELECT *
        FROM tasks
        WHERE id = %s
          AND user_id = %s
        """,
        (
            task_id,
            user_id
        ),
        fetch=True,
        one=True
    )

    if not existing:
        return json_error(
            "No s'ha trobat la tasca.",
            404
        )

    data = request.get_json(silent=True) or {}

    name = data.get(
        "name",
        existing["name"]
    )

    subject = data.get(
        "subject",
        existing["subject"]
    )

    description = data.get(
        "description",
        existing["description"]
    )

    due_date = data.get(
        "due_date",
        existing["due_date"]
    )

    estimated = data.get(
        "estimated_minutes",
        existing["estimated_minutes"]
    )

    difficulty = normalize_difficulty(
        data.get(
            "difficulty",
            existing["difficulty"]
        )
    )

    status = data.get(
        "status",
        existing["status"]
    )

    if status == "en proces":
        status = "en procés"

    row = db_query(
        """
        UPDATE tasks
        SET
            name = %s,
            subject = %s,
            description = %s,
            due_date = %s,
            estimated_minutes = %s,
            difficulty = %s,
            status = %s
        WHERE id = %s
          AND user_id = %s
        RETURNING *
        """,
        (
            name,
            subject,
            description,
            due_date,
            estimated,
            difficulty,
            status,
            task_id,
            user_id
        ),
        fetch=True,
        one=True
    )

    log_activity(
        "task_updated",
        str(task_id)
    )

    return jsonify({
        "ok": True,
        "task": serialize(row)
    })


@app.delete("/api/tasks/<int:task_id>")
@login_required
def delete_task(task_id):
    user_id = session["user_id"]

    row = db_query(
        """
        DELETE FROM tasks
        WHERE id = %s
          AND user_id = %s
        RETURNING id
        """,
        (
            task_id,
            user_id
        ),
        fetch=True,
        one=True
    )

    if not row:
        return json_error(
            "No s'ha trobat la tasca.",
            404
        )

    log_activity(
        "task_deleted",
        str(task_id)
    )

    return jsonify({
        "ok": True
    })


# ============================================================
# EXÀMENS
# ============================================================

@app.get("/api/exams")
@login_required
def get_exams():
    rows = db_query(
        """
        SELECT *
        FROM exams
        WHERE user_id = %s
        ORDER BY exam_date ASC, id DESC
        """,
        (session["user_id"],),
        fetch=True
    )

    return jsonify({
        "ok": True,
        "exams": serialize_many(rows)
    })


@app.post("/api/exams")
@login_required
def create_exam():
    data = request.get_json(silent=True) or {}

    subject = (
        data.get("subject")
        or ""
    ).strip()

    exam_date = (
        data.get("exam_date")
        or data.get("date")
        or None
    )

    syllabus = (
        data.get("syllabus")
        or data.get("temari")
        or ""
    ).strip()

    difficulty = normalize_difficulty(
        data.get("difficulty")
    )

    study_minutes = data.get(
        "study_minutes",
        data.get("available_minutes", 0)
    )

    try:
        study_minutes = int(study_minutes or 0)
    except (TypeError, ValueError):
        study_minutes = 0

    if not subject:
        return json_error(
            "Has d'introduir l'assignatura."
        )

    if not exam_date:
        return json_error(
            "Has d'introduir la data de l'examen."
        )

    row = db_query(
        """
        INSERT INTO exams
        (
            user_id,
            subject,
            exam_date,
            syllabus,
            difficulty,
            study_minutes
        )
        VALUES (%s,%s,%s,%s,%s,%s)
        RETURNING *
        """,
        (
            session["user_id"],
            subject,
            exam_date,
            syllabus,
            difficulty,
            study_minutes
        ),
        fetch=True,
        one=True
    )

    log_activity(
        "exam_created",
        subject
    )

    return jsonify({
        "ok": True,
        "exam": serialize(row)
    }), 201


@app.put("/api/exams/<int:exam_id>")
@login_required
def update_exam(exam_id):
    existing = db_query(
        """
        SELECT *
        FROM exams
        WHERE id = %s
          AND user_id = %s
        """,
        (
            exam_id,
            session["user_id"]
        ),
        fetch=True,
        one=True
    )

    if not existing:
        return json_error(
            "No s'ha trobat l'examen.",
            404
        )

    data = request.get_json(silent=True) or {}

    subject = data.get(
        "subject",
        existing["subject"]
    )

    exam_date = data.get(
        "exam_date",
        existing["exam_date"]
    )

    syllabus = data.get(
        "syllabus",
        existing["syllabus"]
    )

    difficulty = normalize_difficulty(
        data.get(
            "difficulty",
            existing["difficulty"]
        )
    )

    study_minutes = data.get(
        "study_minutes",
        existing["study_minutes"]
    )

    row = db_query(
        """
        UPDATE exams
        SET
            subject = %s,
            exam_date = %s,
            syllabus = %s,
            difficulty = %s,
            study_minutes = %s
        WHERE id = %s
          AND user_id = %s
        RETURNING *
        """,
        (
            subject,
            exam_date,
            syllabus,
            difficulty,
            study_minutes,
            exam_id,
            session["user_id"]
        ),
        fetch=True,
        one=True
    )

    return jsonify({
        "ok": True,
        "exam": serialize(row)
    })


@app.delete("/api/exams/<int:exam_id>")
@login_required
def delete_exam(exam_id):
    row = db_query(
        """
        DELETE FROM exams
        WHERE id = %s
          AND user_id = %s
        RETURNING id
        """,
        (
            exam_id,
            session["user_id"]
        ),
        fetch=True,
        one=True
    )

    if not row:
        return json_error(
            "No s'ha trobat l'examen.",
            404
        )

    log_activity(
        "exam_deleted",
        str(exam_id)
    )

    return jsonify({
        "ok": True
    })


# ============================================================
# CLASSES
# ============================================================

@app.get("/api/classes")
@login_required
def get_classes():
    user = current_user()

    if not user:
        return json_error(
            "Has d'iniciar sessió.",
            401
        )

    if user["role"] == "professor":
        rows = db_query(
            """
            SELECT
                c.*,
                u.name AS teacher_name,
                COUNT(cs.student_id) AS student_count
            FROM classes c
            JOIN users u
                ON u.id = c.teacher_id
            LEFT JOIN class_students cs
                ON cs.class_id = c.id
            WHERE c.teacher_id = %s
            GROUP BY c.id, u.name
            ORDER BY c.created_at DESC
            """,
            (user["id"],),
            fetch=True
        )
    else:
        rows = db_query(
            """
            SELECT
                c.*,
                u.name AS teacher_name,
                COUNT(cs2.student_id) AS student_count
            FROM classes c
            JOIN users u
                ON u.id = c.teacher_id
            JOIN class_students cs
                ON cs.class_id = c.id
               AND cs.student_id = %s
            LEFT JOIN class_students cs2
                ON cs2.class_id = c.id
            GROUP BY c.id, u.name
            ORDER BY c.created_at DESC
            """,
            (user["id"],),
            fetch=True
        )

    classes = serialize_many(rows)

    for item in classes:
        item["teacher"] = item.get("teacher_name")
        item["membership"] = True

    return jsonify({
        "ok": True,
        "classes": classes
    })


@app.post("/api/classes")
@teacher_required
def create_class():
    data = request.get_json(silent=True) or {}

    name = (
        data.get("name")
        or data.get("title")
        or ""
    ).strip()

    if not name:
        return json_error(
            "Has d'introduir el nom de la classe."
        )

    code = generate_class_code()

    row = db_query(
        """
        INSERT INTO classes
        (
            name,
            code,
            teacher_id
        )
        VALUES (%s,%s,%s)
        RETURNING *
        """,
        (
            name,
            code,
            session["user_id"]
        ),
        fetch=True,
        one=True
    )

    log_activity(
        "class_created",
        name
    )

    return jsonify({
        "ok": True,
        "class": serialize(row)
    }), 201


@app.post("/api/classes/join")
@login_required
def join_class():
    user = current_user()

    if user["role"] != "alumne":
        return json_error(
            "Només els alumnes poden unir-se a una classe.",
            403
        )

    data = request.get_json(silent=True) or {}

    code = (
        data.get("code")
        or ""
    ).strip().upper()

    if not code:
        return json_error(
            "Introdueix el codi de la classe."
        )

    class_row = db_query(
        """
        SELECT *
        FROM classes
        WHERE UPPER(code) = %s
        """,
        (code,),
        fetch=True,
        one=True
    )

    if not class_row:
        return json_error(
            "No existeix cap classe amb aquest codi.",
            404
        )

    existing = db_query(
        """
        SELECT id
        FROM class_students
        WHERE class_id = %s
          AND student_id = %s
        """,
        (
            class_row["id"],
            user["id"]
        ),
        fetch=True,
        one=True
    )

    if existing:
        return json_error(
            "Ja formes part d'aquesta classe.",
            409
        )

    db_query(
        """
        INSERT INTO class_students
        (
            class_id,
            student_id
        )
        VALUES (%s,%s)
        """,
        (
            class_row["id"],
            user["id"]
        )
    )

    log_activity(
        "class_joined",
        str(class_row["id"])
    )

    return jsonify({
        "ok": True,
        "class": serialize(class_row)
    })


@app.get("/api/classes/<int:class_id>")
@login_required
def class_detail(class_id):
    user = current_user()

    class_row = db_query(
        """
        SELECT
            c.*,
            u.name AS teacher_name
        FROM classes c
        JOIN users u
            ON u.id = c.teacher_id
        WHERE c.id = %s
        """,
        (class_id,),
        fetch=True,
        one=True
    )

    if not class_row:
        return json_error(
            "No s'ha trobat la classe.",
            404
        )

    allowed = False

    if user["role"] == "professor":
        allowed = (
            class_row["teacher_id"]
            == user["id"]
        )
    else:
        membership = db_query(
            """
            SELECT id
            FROM class_students
            WHERE class_id = %s
              AND student_id = %s
            """,
            (
                class_id,
                user["id"]
            ),
            fetch=True,
            one=True
        )

        allowed = bool(membership)

    if not allowed:
        return json_error(
            "No tens accés a aquesta classe.",
            403
        )

    students = db_query(
        """
        SELECT
            u.id,
            u.name,
            u.email
        FROM class_students cs
        JOIN users u
            ON u.id = cs.student_id
        WHERE cs.class_id = %s
        ORDER BY u.name
        """,
        (class_id,),
        fetch=True
    )

    content = db_query(
        """
        SELECT *
        FROM class_content
        WHERE class_id = %s
        ORDER BY
            COALESCE(due_date, created_at) DESC,
            id DESC
        """,
        (class_id,),
        fetch=True
    )

    result = serialize(class_row)
    result["teacher"] = result.get("teacher_name")
    result["students"] = serialize_many(students)
    result["content"] = serialize_many(content)

    return jsonify({
        "ok": True,
        "class": result
    })


@app.post("/api/classes/<int:class_id>/content")
@teacher_required
def create_class_content(class_id):
    class_row = db_query(
        """
        SELECT *
        FROM classes
        WHERE id = %s
          AND teacher_id = %s
        """,
        (
            class_id,
            session["user_id"]
        ),
        fetch=True,
        one=True
    )

    if not class_row:
        return json_error(
            "No tens accés a aquesta classe.",
            403
        )

    data = request.get_json(silent=True) or {}

    content_type = (
        data.get("type")
        or data.get("content_type")
        or "anunci"
    ).strip().lower()

    title = (
        data.get("title")
        or data.get("name")
        or ""
    ).strip()

    description = (
        data.get("description")
        or ""
    ).strip()

    due_date = (
        data.get("due_date")
        or data.get("event_date")
        or None
    )

    if not title:
        return json_error(
            "Has d'introduir un títol."
        )

    row = db_query(
        """
        INSERT INTO class_content
        (
            class_id,
            type,
            title,
            description,
            due_date
        )
        VALUES (%s,%s,%s,%s,%s)
        RETURNING *
        """,
        (
            class_id,
            content_type,
            title,
            description,
            due_date
        ),
        fetch=True,
        one=True
    )

    log_activity(
        "class_content_created",
        title
    )

    return jsonify({
        "ok": True,
        "content": serialize(row)
    }), 201


# ============================================================
# SESSIONS D'ESTUDI
# ============================================================

@app.get("/api/study-sessions")
@login_required
def get_study_sessions():
    rows = db_query(
        """
        SELECT *
        FROM study_sessions
        WHERE user_id = %s
        ORDER BY session_date ASC, id ASC
        """,
        (session["user_id"],),
        fetch=True
    )

    return jsonify({
        "ok": True,
        "sessions": serialize_many(rows)
    })


@app.post("/api/study-sessions")
@login_required
def create_study_session():
    data = request.get_json(silent=True) or {}

    session_date = (
        data.get("session_date")
        or data.get("date")
        or None
    )

    minutes = data.get(
        "minutes",
        data.get("duration_minutes", 0)
    )

    try:
        minutes = int(minutes or 0)
    except (TypeError, ValueError):
        minutes = 0

    title = (
        data.get("title")
        or data.get("name")
        or "Sessió d'estudi"
    ).strip()

    if not session_date:
        return json_error(
            "Has d'indicar una data."
        )

    row = db_query(
        """
        INSERT INTO study_sessions
        (
            user_id,
            session_date,
            minutes,
            title
        )
        VALUES (%s,%s,%s,%s)
        RETURNING *
        """,
        (
            session["user_id"],
            session_date,
            minutes,
            title
        ),
        fetch=True,
        one=True
    )

    log_activity(
        "study_session_created",
        title
    )

    return jsonify({
        "ok": True,
        "session": serialize(row)
    }), 201


# ============================================================
# PROGRÉS
# ============================================================

@app.get("/api/progress")
@login_required
def progress():
    user_id = session["user_id"]

    total_tasks = db_query(
        """
        SELECT COUNT(*) AS count
        FROM tasks
        WHERE user_id = %s
        """,
        (user_id,),
        fetch=True,
        one=True
    )["count"]

    completed_tasks = db_query(
        """
        SELECT COUNT(*) AS count
        FROM tasks
        WHERE user_id = %s
          AND LOWER(COALESCE(status, '')) = 'completada'
        """,
        (user_id,),
        fetch=True,
        one=True
    )["count"]

    pending_tasks = total_tasks - completed_tasks

    task_progress = (
        round(
            completed_tasks
            / total_tasks
            * 100
        )
        if total_tasks
        else 0
    )

    study = db_query(
        """
        SELECT
            COALESCE(SUM(minutes), 0) AS minutes
        FROM study_sessions
        WHERE user_id = %s
        """,
        (user_id,),
        fetch=True,
        one=True
    )["minutes"]

    tests = db_query(
        """
        SELECT
            COUNT(*) AS count,
            COALESCE(AVG(score), 0) AS average
        FROM test_results
        WHERE user_id = %s
        """,
        (user_id,),
        fetch=True,
        one=True
    )

    weekly = db_query(
        """
        SELECT
            COALESCE(SUM(minutes), 0) AS minutes
        FROM study_sessions
        WHERE user_id = %s
          AND session_date >= CURRENT_DATE - INTERVAL '6 days'
        """,
        (user_id,),
        fetch=True,
        one=True
    )["minutes"]

    return jsonify({
        "ok": True,
        "progress": task_progress,
        "total_tasks": total_tasks,
        "completed_tasks": completed_tasks,
        "pending_tasks": pending_tasks,
        "study_minutes": study,
        "weekly_study_minutes": weekly,
        "test_count": tests["count"],
        "test_average": float(tests["average"] or 0),
        "tasks": {
            "total": total_tasks,
            "completed": completed_tasks,
            "pending": pending_tasks,
            "percentage": task_progress
        },
        "study": {
            "minutes": study,
            "hours": round(
                float(study or 0) / 60,
                1
            )
        },
        "tests": {
            "count": tests["count"],
            "average": float(
                tests["average"] or 0
            )
        },
        "week": {
            "minutes": weekly,
            "hours": round(
                float(weekly or 0) / 60,
                1
            )
        }
    })


# ============================================================
# TESTS
# ============================================================

@app.route(
    "/api/tests/result",
    methods=["POST"]
)
@app.route(
    "/api/test-results",
    methods=["POST"]
)
@login_required
def save_test_result():
    data = request.get_json(silent=True) or {}

    subject = (
        data.get("subject")
        or ""
    ).strip()

    score = data.get(
        "score",
        data.get("correct", 0)
    )

    total = data.get(
        "total",
        5
    )

    try:
        score = float(score or 0)
    except (TypeError, ValueError):
        score = 0

    try:
        total = int(total or 5)
    except (TypeError, ValueError):
        total = 5

    answers = data.get(
        "answers",
        data.get("details", "")
    )

    row = db_query(
        """
        INSERT INTO test_results
        (
            user_id,
            subject,
            score,
            total,
            details
        )
        VALUES (%s,%s,%s,%s,%s)
        RETURNING *
        """,
        (
            session["user_id"],
            subject,
            score,
            total,
            str(answers)
        ),
        fetch=True,
        one=True
    )

    log_activity(
        "test_completed",
        f"{subject}: {score}/{total}"
    )

    return jsonify({
        "ok": True,
        "result": serialize(row)
    }), 201


@app.get("/api/tests/history")
@login_required
def test_history():
    rows = db_query(
        """
        SELECT *
        FROM test_results
        WHERE user_id = %s
        ORDER BY created_at DESC, id DESC
        LIMIT 20
        """,
        (session["user_id"],),
        fetch=True
    )

    return jsonify({
        "ok": True,
        "results": serialize_many(rows)
    })


# ============================================================
# IA
# ============================================================

@app.post("/api/ai")
@login_required
def ai():
    data = request.get_json(silent=True) or {}

    message = (
        data.get("message")
        or data.get("prompt")
        or ""
    ).strip()

    mode = (
        data.get("mode")
        or "dubte"
    ).strip().lower()

    if not message:
        return json_error(
            "Escriu una pregunta."
        )

    user_id = session["user_id"]

    tasks = db_query(
        """
        SELECT
            name,
            subject,
            due_date,
            estimated_minutes,
            difficulty,
            status
        FROM tasks
        WHERE user_id = %s
        ORDER BY due_date NULLS LAST
        LIMIT 20
        """,
        (user_id,),
        fetch=True
    )

    exams = db_query(
        """
        SELECT
            subject,
            exam_date,
            syllabus,
            difficulty,
            study_minutes
        FROM exams
        WHERE user_id = %s
        ORDER BY exam_date ASC
        LIMIT 20
        """,
        (user_id,),
        fetch=True
    )

    try:
        from services.ai import ask_ai

        result = ask_ai(
            message=message,
            mode=mode,
            tasks=serialize_many(tasks),
            exams=serialize_many(exams)
        )

    except Exception as exc:
        print("AI ERROR:", repr(exc))

        result = (
            "Ara mateix no puc connectar amb el servei "
            "d'intel·ligència artificial. "
            "Pots tornar-ho a provar d'aquí una estona."
        )

    log_activity(
        "ai_chat",
        mode
    )

    return jsonify({
        "ok": True,
        "response": result,
        "message": result
    })


@app.post("/api/ai/test")
@login_required
def ai_test():
    data = request.get_json(silent=True) or {}

    subject = (
        data.get("subject")
        or "General"
    ).strip()

    topic = (
        data.get("topic")
        or data.get("message")
        or ""
    ).strip()

    difficulty = normalize_difficulty(
        data.get("difficulty")
    )

    try:
        from services.ai import generate_test

        result = generate_test(
            subject=subject,
            topic=topic,
            difficulty=difficulty
        )

    except Exception as exc:
        print("AI TEST ERROR:", repr(exc))

        result = {
            "title": f"Test de {subject}",
            "questions": [
                {
                    "question": (
                        "Quin aspecte vols practicar "
                        "en aquest test?"
                    ),
                    "options": [
                        "Conceptes bàsics",
                        "Aplicació",
                        "Problemes",
                        "Repàs"
                    ],
                    "correct": 0,
                    "explanation": (
                        "Pots configurar la IA per "
                        "generar preguntes automàtiques."
                    )
                }
            ]
        }

    log_activity(
        "ai_test_generated",
        subject
    )

    return jsonify({
        "ok": True,
        "test": result
    })


@app.route(
    "/api/recommendations",
    methods=["GET"]
)
@app.route(
    "/api/ai/recommendations",
    methods=["GET"]
)
@login_required
def recommendations():
    user_id = session["user_id"]

    tasks = db_query(
        """
        SELECT *
        FROM tasks
        WHERE user_id = %s
          AND LOWER(COALESCE(status, 'pendent'))
          != 'completada'
        ORDER BY
            due_date NULLS LAST,
            CASE
                WHEN LOWER(difficulty) = 'alta'
                THEN 1
                WHEN LOWER(difficulty) = 'mitjana'
                THEN 2
                ELSE 3
            END,
            id DESC
        LIMIT 10
        """,
        (user_id,),
        fetch=True
    )

    exams = db_query(
        """
        SELECT *
        FROM exams
        WHERE user_id = %s
          AND exam_date >= CURRENT_DATE
        ORDER BY exam_date ASC
        LIMIT 10
        """,
        (user_id,),
        fetch=True
    )

    recommendations_list = []

    for task in tasks:
        due = task.get("due_date")

        reason = "És una tasca pendent."

        if due:
            try:
                days = (
                    parse_date(due)
                    - today()
                ).days

                if days <= 1:
                    reason = (
                        "Té la data d'entrega molt a prop."
                    )
                elif days <= 3:
                    reason = (
                        "La data d'entrega és propera."
                    )
            except Exception:
                pass

        if str(task.get("difficulty")).lower() == "alta":
            reason += " La dificultat indicada és alta."

        recommendations_list.append({
            "type": "task",
            "id": task["id"],
            "title": task["name"],
            "subject": task.get("subject"),
            "reason": reason
        })

    for exam in exams:
        exam_date = exam.get("exam_date")

        reason = "Tens un examen pròxim."

        if exam_date:
            try:
                days = (
                    parse_date(exam_date)
                    - today()
                ).days

                reason = (
                    f"L'examen és d'aquí "
                    f"{max(days, 0)} dies."
                )
            except Exception:
                pass

        recommendations_list.append({
            "type": "exam",
            "id": exam["id"],
            "title": (
                f"Examen de {exam.get('subject', '')}"
            ),
            "subject": exam.get("subject"),
            "reason": reason
        })

    return jsonify({
        "ok": True,
        "recommendations": recommendations_list[:10]
    })


# ============================================================
# ERRORS
# ============================================================

@app.errorhandler(404)
def not_found(error):
    if request.path.startswith("/api/"):
        return jsonify({
            "ok": False,
            "error": "Ruta no trobada."
        }), 404

    return render_template(
        "error.html",
        code=404
    ), 404


@app.errorhandler(500)
def server_error(error):
    if request.path.startswith("/api/"):
        return jsonify({
            "ok": False,
            "error": "Error intern del servidor."
        }), 500

    return render_template(
        "error.html",
        code=500
    ), 500


# ============================================================
# INICI
# ============================================================

ensure_db()


if __name__ == "__main__":
    app.run(
        host="0.0.0.0",
        port=int(
            os.getenv("PORT", "5000")
        ),
        debug=True
    )
