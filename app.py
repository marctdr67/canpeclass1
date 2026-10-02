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


# ============================================================
# CONFIGURACIÓ
# ============================================================

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
    """
    Obre una connexió PostgreSQL nova.
    Compatible amb Supabase Transaction Pooler.
    """

    if not DATABASE_URL:
        raise RuntimeError("DATABASE_URL no està configurada.")

    if psycopg2 is None:
        raise RuntimeError("psycopg2 no està instal·lat.")

    url = DATABASE_URL

    # Supabase/Vercel necessita SSL.
    if "sslmode=" not in url:
        separator = "&" if "?" in url else "?"
        url += separator + "sslmode=require"

    return psycopg2.connect(
        url,
        connect_timeout=10
    )


def db_query(sql, params=None, fetch=False, one=False):
    """
    Executa una consulta utilitzant RealDictCursor.
    Això permet accedir a les columnes com:
        row["username"]
    """

    conn = None

    try:
        conn = get_db()

        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(sql, params or ())

            result = None

            if fetch:
                if one:
                    result = cur.fetchone()
                else:
                    result = cur.fetchall()

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
    """
    Crea les taules que necessita MiniClassroom si encara no existeixen.
    No elimina dades existents.
    """

    statements = [

        """
        CREATE TABLE IF NOT EXISTS users (
            id SERIAL PRIMARY KEY,
            username TEXT NOT NULL,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'alumne',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """,

        """
        CREATE TABLE IF NOT EXISTS classes (
            id SERIAL PRIMARY KEY,
            name TEXT NOT NULL,
            subject TEXT,
            code VARCHAR(6) UNIQUE NOT NULL,
            teacher_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """,

        """
        CREATE TABLE IF NOT EXISTS class_students (
            class_id INTEGER REFERENCES classes(id) ON DELETE CASCADE,
            student_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
            joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (class_id, student_id)
        )
        """,

        """
        CREATE TABLE IF NOT EXISTS tasks (
            id SERIAL PRIMARY KEY,
            user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
            class_id INTEGER REFERENCES classes(id) ON DELETE SET NULL,
            name TEXT NOT NULL,
            subject TEXT,
            description TEXT,
            due_date DATE,
            estimated_minutes INTEGER DEFAULT 30,
            difficulty TEXT DEFAULT 'mitjana',
            status TEXT DEFAULT 'pendent',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            completed_at TIMESTAMP
        )
        """,

        """
        CREATE TABLE IF NOT EXISTS exams (
            id SERIAL PRIMARY KEY,
            user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
            class_id INTEGER REFERENCES classes(id) ON DELETE SET NULL,
            subject TEXT NOT NULL,
            exam_date DATE NOT NULL,
            syllabus TEXT,
            difficulty TEXT DEFAULT 'mitjana',
            study_minutes INTEGER DEFAULT 120,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """,

        """
        CREATE TABLE IF NOT EXISTS class_content (
            id SERIAL PRIMARY KEY,
            class_id INTEGER REFERENCES classes(id) ON DELETE CASCADE,
            author_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
            content_type TEXT NOT NULL DEFAULT 'avis',
            title TEXT NOT NULL,
            body TEXT,
            due_date DATE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """,

        """
        CREATE TABLE IF NOT EXISTS study_sessions (
            id SERIAL PRIMARY KEY,
            user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
            task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
            exam_id INTEGER REFERENCES exams(id) ON DELETE SET NULL,
            session_date DATE NOT NULL,
            minutes INTEGER DEFAULT 0,
            notes TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """,

        """
        CREATE TABLE IF NOT EXISTS test_results (
            id SERIAL PRIMARY KEY,
            user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
            subject TEXT,
            score INTEGER DEFAULT 0,
            total INTEGER DEFAULT 5,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """,

        """
        CREATE TABLE IF NOT EXISTS activity_log (
            id SERIAL PRIMARY KEY,
            user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
            event_type TEXT NOT NULL,
            details TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """
    ]

    conn = None

    try:
        conn = get_db()

        with conn.cursor() as cur:
            for statement in statements:
                cur.execute(statement)

        conn.commit()

    except Exception:
        if conn:
            conn.rollback()
        raise

    finally:
        if conn:
            conn.close()


def ensure_db():
    """
    Inicialització segura.
    No bloqueja la pàgina si hi ha un problema temporal.
    """

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

    return datetime.strptime(str(value)[:10], "%Y-%m-%d").date()


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
            SELECT id, name AS username, email, role, created_at
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
            (user_id, event_type, details)
            VALUES (%s, %s, %s)
            """,
            (user_id, event_type, details)
        )
    except Exception as exc:
        print("ACTIVITY LOG ERROR:", repr(exc))


def generate_class_code():
    alphabet = string.ascii_uppercase + string.digits

    for _ in range(20):
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

    raise RuntimeError("No s'ha pogut generar un codi de classe.")


# ============================================================
# PÀGINA PRINCIPAL
# ============================================================

@app.route("/")
def index():

    return render_template("index.html")


# ============================================================
# HEALTH
# ============================================================

@app.route("/api/health")
def health():

    try:
        db_query("SELECT 1")

        return jsonify({
            "ok": True,
            "database": True
        })

    except Exception as exc:

        print("HEALTH ERROR:", repr(exc))

        return jsonify({
            "ok": False,
            "database": False
        }), 500


# ============================================================
# AUTENTICACIÓ
# ============================================================

@app.post("/api/register")
def register():

    data = request.get_json(silent=True) or {}

    username = str(data.get("username", "")).strip()
    email = str(data.get("email", "")).strip().lower()
    password = str(data.get("password", ""))
    role = str(data.get("role", "alumne")).strip().lower()

    if not username or not email or not password:
        return jsonify({
            "ok": False,
            "error": "Completa tots els camps."
        }), 400

    if len(password) < 6:
        return jsonify({
            "ok": False,
            "error": "La contrasenya ha de tenir almenys 6 caràcters."
        }), 400

    if role not in ("alumne", "professor"):
        role = "alumne"

    try:

        existing = db_query(
            """
            SELECT id
            FROM users
            WHERE email = %s
            """,
            (email,),
            fetch=True,
            one=True
        )

        if existing:
            return jsonify({
                "ok": False,
                "error": "Aquest correu ja està registrat."
            }), 409

        password_hash = generate_password_hash(password)

        user = db_query(
            """
            INSERT INTO users
            (name, email, password_hash, role)
            VALUES (%s, %s, %s, %s)
            RETURNING id, name AS username, email, role, created_at
            """,
            (
                username,
                email,
                password_hash,
                role
            ),
            fetch=True,
            one=True
        )

        session.clear()
        session["user_id"] = user["id"]

        log_activity("register", "Compte creat")

        return jsonify({
            "ok": True,
            "user": serialize(user)
        })

    except Exception as exc:

        print("REGISTER ERROR:", repr(exc))

        return jsonify({
            "ok": False,
            "error": "No s'ha pogut crear el compte."
        }), 500


@app.post("/api/login")
def login():

    data = request.get_json(silent=True) or {}

    email = str(data.get("email", "")).strip().lower()
    password = str(data.get("password", ""))

    if not email or not password:
        return jsonify({
            "ok": False,
            "error": "Escriu el correu i la contrasenya."
        }), 400

    try:

        # IMPORTANT:
        # RealDictCursor fa que u["username"] funcioni.
        user = db_query(
            """
            SELECT
                id,
                name AS username,
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

        if not user:
            return jsonify({
                "ok": False,
                "error": "El correu o la contrasenya no són correctes."
            }), 401

        if not check_password_hash(
            user["password_hash"],
            password
        ):
            return jsonify({
                "ok": False,
                "error": "El correu o la contrasenya no són correctes."
            }), 401

        session.clear()
        session["user_id"] = user["id"]

        safe_user = {
            "id": user["id"],
            "username": user["username"],
            "email": user["email"],
            "role": user["role"]
        }

        log_activity("login", "Inici de sessió")

        return jsonify({
            "ok": True,
            "user": safe_user
        })

    except Exception as exc:

        print("LOGIN DATABASE ERROR:", repr(exc))

        return jsonify({
            "ok": False,
            "error": "No s'ha pogut completar l'operació amb la base de dades."
        }), 500


@app.post("/api/logout")
def logout():

    session.clear()

    return jsonify({
        "ok": True
    })


@app.get("/api/me")
@login_required
def me():

    try:

        user = current_user()

        if not user:
            session.clear()

            return jsonify({
                "ok": False,
                "error": "Sessió no vàlida."
            }), 401

        return jsonify({
            "ok": True,
            "user": serialize(user)
        })

    except Exception as exc:

        print("ME ERROR:", repr(exc))

        return jsonify({
            "ok": False,
            "error": "No s'ha pogut carregar el perfil."
        }), 500


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
            SELECT *
            FROM tasks
            WHERE user_id = %s
            ORDER BY
                CASE
                    WHEN status = 'pendent' THEN 0
                    WHEN status = 'en procés' THEN 1
                    ELSE 2
                END,
                due_date NULLS LAST,
                id DESC
            """,
            (user_id,),
            fetch=True
        )

        exams = db_query(
            """
            SELECT *
            FROM exams
            WHERE user_id = %s
            ORDER BY exam_date ASC
            """,
            (user_id,),
            fetch=True
        )

        pending = [
            t for t in tasks
            if t["status"] != "completada"
        ]

        completed = [
            t for t in tasks
            if t["status"] == "completada"
        ]

        urgent_limit = today() + timedelta(days=2)

        urgent = [
            t for t in pending
            if t["due_date"]
            and t["due_date"] <= urgent_limit
        ]

        completed_count = len(completed)
        total_count = len(tasks)

        progress = (
            round((completed_count / total_count) * 100)
            if total_count
            else 0
        )

        study = db_query(
            """
            SELECT COALESCE(SUM(minutes), 0) AS minutes
            FROM study_sessions
            WHERE user_id = %s
            """,
            (user_id,),
            fetch=True,
            one=True
        )

        return jsonify({
            "ok": True,
            "tasks": serialize_many(tasks),
            "exams": serialize_many(exams),
            "pending_count": len(pending),
            "urgent_count": len(urgent),
            "progress": progress,
            "stats": {
                "pending": len(pending),
                "completed": completed_count,
                "exams": len(exams),
                "urgent": len(urgent),
                "progress": progress,
                "study_minutes": int(study["minutes"] or 0)
            }
        })

    except Exception as exc:

        print("DASHBOARD ERROR:", repr(exc))

        return jsonify({
            "ok": False,
            "error": "No s'ha pogut carregar el tauler."
        }), 500


# ============================================================
# TASQUES
# ============================================================

@app.get("/api/tasks")
@login_required
def get_tasks():

    try:

        rows = db_query(
            """
            SELECT *
            FROM tasks
            WHERE user_id = %s
            ORDER BY
                due_date NULLS LAST,
                created_at DESC
            """,
            (session["user_id"],),
            fetch=True
        )

        return jsonify({
            "ok": True,
            "tasks": serialize_many(rows)
        })

    except Exception as exc:

        print("GET TASKS ERROR:", repr(exc))

        return jsonify({
            "ok": False,
            "error": "No s'han pogut carregar les tasques."
        }), 500


@app.post("/api/tasks")
@login_required
def create_task():

    data = request.get_json(silent=True) or {}

    name = str(data.get("name", "")).strip()

    if not name:
        return jsonify({
            "ok": False,
            "error": "El nom de la tasca és obligatori."
        }), 400

    subject = str(data.get("subject", "")).strip()
    description = str(data.get("description", "")).strip()

    due_date = parse_date(data.get("due_date"))

    estimated = data.get(
        "estimated_minutes",
        data.get("estimated_time", 30)
    )

    try:
        estimated = max(1, int(estimated))
    except Exception:
        estimated = 30

    difficulty = str(
        data.get("difficulty", "mitjana")
    ).strip()

    status = str(
        data.get("status", "pendent")
    ).strip()

    if status not in ("pendent", "en procés", "completada"):
        status = "pendent"

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
            status,
            completed_at
        )
        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
        RETURNING *
        """,
        (
            session["user_id"],
            data.get("class_id"),
            name,
            subject,
            description,
            due_date,
            estimated,
            difficulty,
            status,
            datetime.now() if status == "completada" else None
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


@app.route("/api/tasks/<int:task_id>", methods=["PUT", "PATCH"])
@login_required
def update_task(task_id):

    data = request.get_json(silent=True) or {}

    existing = db_query(
        """
        SELECT *
        FROM tasks
        WHERE id = %s
        AND user_id = %s
        """,
        (task_id, session["user_id"]),
        fetch=True,
        one=True
    )

    if not existing:
        return jsonify({
            "ok": False,
            "error": "Tasca no trobada."
        }), 404

    name = str(
        data.get("name", existing["name"])
    ).strip()

    subject = str(
        data.get("subject", existing["subject"] or "")
    ).strip()

    description = str(
        data.get("description", existing["description"] or "")
    ).strip()

    due_date = (
        parse_date(data["due_date"])
        if "due_date" in data
        else existing["due_date"]
    )

    try:
        estimated = int(
            data.get(
                "estimated_minutes",
                existing["estimated_minutes"]
            )
        )
    except Exception:
        estimated = existing["estimated_minutes"] or 30

    difficulty = data.get(
        "difficulty",
        existing["difficulty"]
    )

    status = data.get(
        "status",
        existing["status"]
    )

    completed_at = existing["completed_at"]

    if status == "completada" and not completed_at:
        completed_at = datetime.now()

    if status != "completada":
        completed_at = None

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
            status = %s,
            completed_at = %s
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
            completed_at,
            task_id,
            session["user_id"]
        ),
        fetch=True,
        one=True
    )

    if status == "completada":
        log_activity(
            "task_completed",
            name
        )

    return jsonify({
        "ok": True,
        "task": serialize(row)
    })


@app.delete("/api/tasks/<int:task_id>")
@login_required
def delete_task(task_id):

    row = db_query(
        """
        DELETE FROM tasks
        WHERE id = %s
        AND user_id = %s
        RETURNING id
        """,
        (task_id, session["user_id"]),
        fetch=True,
        one=True
    )

    if not row:
        return jsonify({
            "ok": False,
            "error": "Tasca no trobada."
        }), 404

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

    try:

        rows = db_query(
            """
            SELECT *
            FROM exams
            WHERE user_id = %s
            ORDER BY exam_date ASC
            """,
            (session["user_id"],),
            fetch=True
        )

        return jsonify({
            "ok": True,
            "exams": serialize_many(rows)
        })

    except Exception as exc:

        print("GET EXAMS ERROR:", repr(exc))

        return jsonify({
            "ok": False,
            "error": "No s'han pogut carregar els exàmens."
        }), 500


@app.post("/api/exams")
@login_required
def create_exam():

    data = request.get_json(silent=True) or {}

    subject = str(
        data.get("subject", "")
    ).strip()

    exam_date = parse_date(
        data.get("exam_date", data.get("date"))
    )

    if not subject or not exam_date:
        return jsonify({
            "ok": False,
            "error": "Indica l'assignatura i la data."
        }), 400

    syllabus = str(
        data.get("syllabus", "")
    ).strip()

    difficulty = str(
        data.get("difficulty", "mitjana")
    ).strip()

    try:
        study_minutes = int(
            data.get(
                "study_minutes",
                data.get("study_time", 120)
            )
        )
    except Exception:
        study_minutes = 120

    row = db_query(
        """
        INSERT INTO exams
        (
            user_id,
            class_id,
            subject,
            exam_date,
            syllabus,
            difficulty,
            study_minutes
        )
        VALUES (%s,%s,%s,%s,%s,%s,%s)
        RETURNING *
        """,
        (
            session["user_id"],
            data.get("class_id"),
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

    data = request.get_json(silent=True) or {}

    existing = db_query(
        """
        SELECT *
        FROM exams
        WHERE id = %s
        AND user_id = %s
        """,
        (exam_id, session["user_id"]),
        fetch=True,
        one=True
    )

    if not existing:
        return jsonify({
            "ok": False,
            "error": "Examen no trobat."
        }), 404

    subject = str(
        data.get("subject", existing["subject"])
    ).strip()

    exam_date = (
        parse_date(data["exam_date"])
        if "exam_date" in data
        else existing["exam_date"]
    )

    syllabus = data.get(
        "syllabus",
        existing["syllabus"]
    )

    difficulty = data.get(
        "difficulty",
        existing["difficulty"]
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
        (exam_id, session["user_id"]),
        fetch=True,
        one=True
    )

    if not row:
        return jsonify({
            "ok": False,
            "error": "Examen no trobat."
        }), 404

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

    try:

        if user["role"] == "professor":

            classes = db_query(
                """
                SELECT
                    c.*, COUNT(cs.student_id) AS student_count,
                    'professor' AS membership, NULL::text AS teacher
                FROM classes c LEFT JOIN class_students cs ON cs.class_id = c.id
                WHERE c.teacher_id = %s GROUP BY c.id ORDER BY c.created_at DESC
                """,
                (user["id"],),
                fetch=True
            )

        else:

            classes = db_query(
                """
                SELECT c.*, u.name AS teacher_name, u.name AS teacher,
                    'student' AS membership,
                    (SELECT COUNT(*) FROM class_students cs2 WHERE cs2.class_id=c.id) AS student_count
                FROM classes c JOIN class_students cs ON cs.class_id=c.id
                LEFT JOIN users u ON u.id=c.teacher_id
                WHERE cs.student_id=%s ORDER BY c.created_at DESC
                """,
                (user["id"],),
                fetch=True
            )

        return jsonify({
            "ok": True,
            "classes": serialize_many(classes)
        })

    except Exception as exc:

        print("GET CLASSES ERROR:", repr(exc))

        return jsonify({
            "ok": False,
            "error": "No s'han pogut carregar les classes."
        }), 500


@app.post("/api/classes")
@teacher_required
def create_class():

    data = request.get_json(silent=True) or {}

    name = str(
        data.get("name", "")
    ).strip()

    subject = str(
        data.get("subject", "")
    ).strip()

    if not name:
        return jsonify({
            "ok": False,
            "error": "El nom de la classe és obligatori."
        }), 400

    code = generate_class_code()

    row = db_query(
        """
        INSERT INTO classes
        (name, subject, code, teacher_id)
        VALUES (%s,%s,%s,%s)
        RETURNING *
        """,
        (
            name,
            subject,
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
        return jsonify({
            "ok": False,
            "error": "Només els alumnes poden unir-se a una classe."
        }), 403

    data = request.get_json(silent=True) or {}

    code = str(
        data.get("code", "")
    ).strip().upper()

    if len(code) != 6:
        return jsonify({
            "ok": False,
            "error": "El codi ha de tenir 6 caràcters."
        }), 400

    classroom = db_query(
        """
        SELECT *
        FROM classes
        WHERE code = %s
        """,
        (code,),
        fetch=True,
        one=True
    )

    if not classroom:
        return jsonify({
            "ok": False,
            "error": "No existeix cap classe amb aquest codi."
        }), 404

    already = db_query(
        """
        SELECT 1
        FROM class_students
        WHERE class_id = %s
        AND student_id = %s
        """,
        (
            classroom["id"],
            user["id"]
        ),
        fetch=True,
        one=True
    )

    if already:
        return jsonify({
            "ok": False,
            "error": "Ja formes part d'aquesta classe."
        }), 409

    db_query(
        """
        INSERT INTO class_students
        (class_id, student_id)
        VALUES (%s,%s)
        """,
        (
            classroom["id"],
            user["id"]
        )
    )

    log_activity(
        "class_joined",
        classroom["name"]
    )

    return jsonify({
        "ok": True,
        "class": serialize(classroom)
    })


@app.get("/api/classes/<int:class_id>")
@login_required
def class_detail(class_id):

    user = current_user()

    classroom = db_query(
        """
        SELECT
            c.*, u.name AS teacher_name, u.name AS teacher
        FROM classes c
        LEFT JOIN users u
            ON u.id = c.teacher_id
        WHERE c.id = %s
        """,
        (class_id,),
        fetch=True,
        one=True
    )

    if not classroom:
        return jsonify({
            "ok": False,
            "error": "Classe no trobada."
        }), 404

    allowed = False

    if classroom["teacher_id"] == user["id"]:
        allowed = True
    else:

        member = db_query(
            """
            SELECT 1
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

        allowed = bool(member)

    if not allowed:
        return jsonify({
            "ok": False,
            "error": "No tens accés a aquesta classe."
        }), 403

    content = db_query(
        """
        SELECT cc.id, cc.class_id, cc.teacher_id AS author_id,
            cc.kind AS content_type, cc.kind, cc.title, cc.body, cc.event_date,
            cc.event_date AS due_date, cc.created_at, u.name AS author_name
        FROM class_content cc LEFT JOIN users u ON u.id=cc.teacher_id
        WHERE cc.class_id = %s
        ORDER BY cc.created_at DESC
        """,
        (class_id,),
        fetch=True
    )

    students = []

    if classroom["teacher_id"] == user["id"]:

        students = db_query(
            """
            SELECT
                u.id,
                u.name AS username,
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

    return jsonify({
        "ok": True,
        "class": serialize(classroom),
        "content": serialize_many(content),
        "students": serialize_many(students),
        "can_manage": classroom["teacher_id"] == user["id"]
    })


@app.post("/api/classes/<int:class_id>/content")
@teacher_required
def create_class_content(class_id):

    classroom = db_query(
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

    if not classroom:
        return jsonify({
            "ok": False,
            "error": "Classe no trobada."
        }), 404

    data = request.get_json(silent=True) or {}

    title = str(
        data.get("title", "")
    ).strip()

    body = str(
        data.get("body", data.get("description", ""))
    ).strip()

    # El frontend actual utilitza "kind" i "event_date".
    # Mantenim també els noms antics per compatibilitat.
    content_type = str(
        data.get("kind", data.get("content_type", data.get("type", "avis")))
    ).strip()

    due_date = parse_date(
        data.get("event_date", data.get("due_date"))
    )

    if not title:
        return jsonify({
            "ok": False,
            "error": "El títol és obligatori."
        }), 400

    row = db_query(
        """
        INSERT INTO class_content
        (class_id, teacher_id, kind, title, body, event_date)
        VALUES (%s,%s,%s,%s,%s,%s)
        RETURNING *
        """,
        (
            class_id,
            session["user_id"],
            content_type,
            title,
            body,
            due_date
        ),
        fetch=True,
        one=True
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
        SELECT id, student_id, task_id, subject, session_date, planned_minutes, completed_minutes, created_at, completed_minutes AS minutes
        FROM study_sessions WHERE student_id=%s ORDER BY session_date DESC, id DESC
        LIMIT 100
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

    session_date = parse_date(
        data.get("session_date")
    ) or today()

    try:
        minutes = max(
            0,
            int(data.get("minutes", 0))
        )
    except Exception:
        minutes = 0

    row = db_query(
        """
        INSERT INTO study_sessions
        (student_id, task_id, subject, session_date, planned_minutes, completed_minutes)
        VALUES (%s,%s,%s,%s,%s,%s)
        RETURNING *
        """,
        (
            session["user_id"],
            data.get("task_id"),
            data.get("subject", ""),
            session_date,
            max(minutes, int(data.get("planned_minutes", minutes) or 0)),
            minutes
        ),
        fetch=True,
        one=True
    )

    log_activity(
        "study_session",
        f"{minutes} minuts"
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

    tasks = db_query(
        """
        SELECT
            COUNT(*) AS total,
            COUNT(*) FILTER (
                WHERE status = 'completada'
            ) AS completed
        FROM tasks
        WHERE user_id = %s
        """,
        (user_id,),
        fetch=True,
        one=True
    )

    study = db_query(
        """
        SELECT COALESCE(SUM(planned_minutes),0) AS planned_minutes, COALESCE(SUM(completed_minutes),0) AS completed_minutes
        FROM study_sessions WHERE student_id=%s
        """,
        (user_id,),
        fetch=True,
        one=True
    )

    weekly = db_query(
        """
        SELECT session_date, COALESCE(SUM(planned_minutes),0) AS planned_minutes,
            COALESCE(SUM(completed_minutes),0) AS completed_minutes,
            COALESCE(SUM(completed_minutes),0) AS minutes
        FROM study_sessions WHERE student_id=%s
        AND session_date >= CURRENT_DATE - INTERVAL '6 days'
        GROUP BY session_date ORDER BY session_date
        """,
        (user_id,),
        fetch=True
    )

    total = int(tasks["total"] or 0)
    completed = int(tasks["completed"] or 0)

    percentage = (
        round(completed / total * 100)
        if total
        else 0
    )

    return jsonify({
        "ok": True,
        "progress": percentage,
        "total_tasks": total,
        "completed_tasks": completed,
        "study_minutes": int(study["completed_minutes"] or 0),
        "study": {"planned": int(study["planned_minutes"] or 0), "completed": int(study["completed_minutes"] or 0)},
        "tasks": {"total": total, "completed": completed},
        "weekly": serialize_many(weekly)
    })


@app.get("/api/ai/recommendations")
@login_required
def ai_recommendations_alias():
    return recommendations()

@app.post("/api/ai/test")
@login_required
def ai_test():
    from services.ai import generate_test
    data=request.get_json(silent=True) or {}
    topic=str(data.get("topic","")).strip()
    if not topic: return jsonify({"ok":False,"error":"Indica un tema per crear el test."}),400
    return jsonify({"ok":True, **generate_test(topic)})

@app.post("/api/test-results")
@login_required
def save_test_result_alias():
    return save_test_result()

# ============================================================
# TESTS
# ============================================================

@app.post("/api/tests/result")
@login_required
def save_test_result():

    data = request.get_json(silent=True) or {}

    try:
        score = int(data.get("score", 0))
        total = int(data.get("total", 5))
    except Exception:
        score = 0
        total = 5

    subject = str(
        data.get("subject", "")
    ).strip()

    row = db_query(
        """
        INSERT INTO test_results
        (
            user_id,
            subject,
            score,
            total
        )
        VALUES (%s,%s,%s,%s)
        RETURNING *
        """,
        (
            session["user_id"],
            subject,
            score,
            total
        ),
        fetch=True,
        one=True
    )

    log_activity(
        "test_completed",
        f"{score}/{total}"
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
        ORDER BY created_at DESC
        LIMIT 30
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

    mode = str(
        data.get("mode", "DUBTE")
    ).upper()

    message = str(
        data.get(
            "message",
            data.get("prompt", "")
        )
    ).strip()

    if not message:
        return jsonify({
            "ok": False,
            "error": "Escriu alguna cosa per a la IA."
        }), 400

    user_id = session["user_id"]

    # Context real de l'alumne.
    tasks = db_query(
        """
        SELECT
            name,
            subject,
            due_date,
            difficulty,
            status,
            estimated_minutes
        FROM tasks
        WHERE user_id = %s
        AND status != 'completada'
        ORDER BY due_date NULLS LAST
        LIMIT 15
        """,
        (user_id,),
        fetch=True
    )

    exams = db_query(
        """
        SELECT
            subject,
            exam_date,
            difficulty,
            syllabus,
            study_minutes
        FROM exams
        WHERE user_id = %s
        ORDER BY exam_date
        LIMIT 10
        """,
        (user_id,),
        fetch=True
    )

    context = {
        "tasques": serialize_many(tasks),
        "examens": serialize_many(exams)
    }

    try:

        from services.ai import ask_ai

        answer = ask_ai(
            mode=mode,
            message=message,
            context=context
        )

    except Exception as exc:

        print("AI ERROR:", repr(exc))

        answer = (
            "Ara mateix no puc connectar amb el servei d'IA. "
            "Pots continuar organitzant les teves tasques "
            "i exàmens mentre ho tornem a intentar."
        )

    log_activity(
        "ai_use",
        mode
    )

    return jsonify({
        "ok": True,
        "mode": mode,
        "answer": answer
    })


# ============================================================
# RECOMANACIONS
# ============================================================

@app.get("/api/recommendations")
@login_required
def recommendations():

    user_id = session["user_id"]

    tasks = db_query(
        """
        SELECT *
        FROM tasks
        WHERE user_id = %s
        AND status != 'completada'
        ORDER BY
            due_date NULLS LAST,
            CASE difficulty
                WHEN 'alta' THEN 0
                WHEN 'mitjana' THEN 1
                ELSE 2
            END
        LIMIT 10
        """,
        (user_id,),
        fetch=True
    )

    recommendations = []

    for task in tasks:

        reason = "Tasca pendent"

        if task["due_date"]:
            days = (
                task["due_date"] - today()
            ).days

            if days < 0:
                reason = "Està fora de termini."
            elif days == 0:
                reason = "És per avui."
            elif days <= 2:
                reason = "La data límit és molt propera."
            elif task["difficulty"] == "alta":
                reason = "Té una dificultat elevada."

        recommendations.append({
            "task": serialize(task),
            "reason": reason
        })

    return jsonify({
        "ok": True,
        "recommendations": recommendations
    })


# ============================================================
# PERFIL
# ============================================================

@app.put("/api/profile")
@login_required
def update_profile():
    data = request.get_json(silent=True) or {}
    user_id = session["user_id"]

    name = str(data.get("name", data.get("username", ""))).strip()
    email = str(data.get("email", "")).strip().lower()

    if not name or not email:
        return jsonify({
            "ok": False,
            "error": "El nom i el correu són obligatoris."
        }), 400

    try:
        existing = db_query(
            """
            SELECT id FROM users
            WHERE LOWER(email) = LOWER(%s)
            AND id <> %s
            """,
            (email, user_id),
            fetch=True,
            one=True
        )

        if existing:
            return jsonify({
                "ok": False,
                "error": "Aquest correu ja està utilitzat."
            }), 409

        row = db_query(
            """
            UPDATE users
            SET name = %s, email = %s
            WHERE id = %s
            RETURNING id, name AS username, email, role, created_at
            """,
            (name, email, user_id),
            fetch=True,
            one=True
        )

        if not row:
            return jsonify({
                "ok": False,
                "error": "Usuari no trobat."
            }), 404

        log_activity("profile_updated", "Perfil actualitzat")

        return jsonify({
            "ok": True,
            "user": serialize(row)
        })

    except Exception as exc:
        print("PROFILE ERROR:", repr(exc))
        return jsonify({
            "ok": False,
            "error": "No s'ha pogut actualitzar el perfil."
        }), 500


# ============================================================
# ERRORS
# ============================================================

@app.errorhandler(404)
def not_found(error):

    if request.path.startswith("/api/"):
        return jsonify({
            "ok": False,
            "error": "Recurs no trobat."
        }), 404

    return render_template("error.html"), 404


@app.errorhandler(500)
def server_error(error):

    if request.path.startswith("/api/"):
        return jsonify({
            "ok": False,
            "error": "Error intern del servidor."
        }), 500

    return render_template("error.html"), 500


# ============================================================
# STARTUP
# ============================================================

# Vercel importa app.py com a mòdul.
# No executem app.run() en producció.
#
# Intentem inicialitzar la base de dades en carregar el mòdul.
try:
    ensure_db()
except Exception as startup_error:
    print(
        "STARTUP DATABASE ERROR:",
        repr(startup_error)
    )


if __name__ == "__main__":

    app.run(
        host="0.0.0.0",
        port=int(
            os.getenv("PORT", "5000")
        ),
        debug=True
    )
