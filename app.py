
import os, secrets, string, json
from datetime import datetime, date, timedelta
from functools import wraps
from urllib.parse import urlsplit, urlunsplit, parse_qsl, urlencode

import psycopg
from psycopg.rows import dict_row
from flask import Flask, jsonify, render_template, request, session
from werkzeug.security import generate_password_hash, check_password_hash

from services.ai import ask_ai, build_recommendations, generate_test

app = Flask(__name__)
app.secret_key = os.environ.get("SECRET_KEY", "dev-change-this-secret")
app.config["JSON_SORT_KEYS"] = False
app.json.default = lambda obj: obj.isoformat() if isinstance(obj, (date, datetime)) else str(obj)

SCHEMA_READY = False

def db_url():
    url = os.environ.get("DATABASE_URL", "").strip()
    if not url:
        return ""
    # Supabase requires SSL for the managed Postgres connection.
    parts = urlsplit(url)
    params = dict(parse_qsl(parts.query, keep_blank_values=True))
    params.setdefault("sslmode", "require")
    return urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(params), parts.fragment))

def connect():
    url = db_url()
    if not url:
        raise RuntimeError("DATABASE_URL no està configurada.")
    # Disable prepared statements: Supabase transaction pooling is compatible with
    # unnamed statements, while server-side prepared statements can cause issues.
    return psycopg.connect(url, row_factory=dict_row, prepare_threshold=None)

def ensure_schema():
    global SCHEMA_READY
    if SCHEMA_READY:
        return
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id BIGSERIAL PRIMARY KEY,
                username TEXT NOT NULL,
                email TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                role TEXT NOT NULL CHECK (role IN ('alumne','professor')),
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
            CREATE TABLE IF NOT EXISTS classes (
                id BIGSERIAL PRIMARY KEY,
                name TEXT NOT NULL,
                code VARCHAR(6) NOT NULL UNIQUE,
                teacher_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
            CREATE TABLE IF NOT EXISTS class_students (
                class_id BIGINT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
                student_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                PRIMARY KEY (class_id, student_id)
            );
            CREATE TABLE IF NOT EXISTS tasks (
                id BIGSERIAL PRIMARY KEY,
                student_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                name TEXT NOT NULL,
                subject TEXT NOT NULL,
                description TEXT DEFAULT '',
                due_date DATE,
                estimated_minutes INTEGER NOT NULL DEFAULT 30,
                difficulty INTEGER NOT NULL DEFAULT 2 CHECK (difficulty BETWEEN 1 AND 3),
                status TEXT NOT NULL DEFAULT 'pendent'
                    CHECK (status IN ('pendent','en procés','completada')),
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                completed_at TIMESTAMPTZ
            );
            CREATE TABLE IF NOT EXISTS exams (
                id BIGSERIAL PRIMARY KEY,
                student_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                subject TEXT NOT NULL,
                exam_date DATE NOT NULL,
                syllabus TEXT DEFAULT '',
                difficulty INTEGER NOT NULL DEFAULT 2 CHECK (difficulty BETWEEN 1 AND 3),
                study_minutes INTEGER NOT NULL DEFAULT 120,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
            CREATE TABLE IF NOT EXISTS class_content (
                id BIGSERIAL PRIMARY KEY,
                class_id BIGINT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
                author_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                content_type TEXT NOT NULL CHECK (content_type IN ('deures','examen','avis')),
                title TEXT NOT NULL,
                body TEXT DEFAULT '',
                due_date DATE,
                event_date DATE,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
            CREATE TABLE IF NOT EXISTS study_sessions (
                id BIGSERIAL PRIMARY KEY,
                student_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                task_id BIGINT REFERENCES tasks(id) ON DELETE SET NULL,
                subject TEXT DEFAULT '',
                session_date DATE NOT NULL,
                planned_minutes INTEGER NOT NULL DEFAULT 30,
                completed_minutes INTEGER NOT NULL DEFAULT 0,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
            CREATE TABLE IF NOT EXISTS ai_events (
                id BIGSERIAL PRIMARY KEY,
                user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
                event_type TEXT NOT NULL,
                metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
            CREATE TABLE IF NOT EXISTS test_results (
                id BIGSERIAL PRIMARY KEY,
                user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                topic TEXT DEFAULT '',
                score INTEGER NOT NULL DEFAULT 0,
                total INTEGER NOT NULL DEFAULT 0,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
            """)
        conn.commit()
    SCHEMA_READY = True

def db_error_response(e):
    app.logger.exception("Database error")
    return jsonify({"error": "No s'ha pogut completar l'operació amb la base de dades.", "detail": str(e)}), 500

def current_user():
    uid = session.get("user_id")
    if not uid:
        return None
    ensure_schema()
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id, username, email, role, created_at FROM users WHERE id=%s", (uid,))
            return cur.fetchone()

def login_required(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        if not session.get("user_id"):
            return jsonify({"error": "Has d'iniciar sessió."}), 401
        try:
            ensure_schema()
        except Exception as e:
            return db_error_response(e)
        return fn(*args, **kwargs)
    return wrapper

def role_required(role):
    def deco(fn):
        @wraps(fn)
        def wrapper(*args, **kwargs):
            u = current_user()
            if not u:
                return jsonify({"error": "Has d'iniciar sessió."}), 401
            if u["role"] != role:
                return jsonify({"error": "No tens permisos per fer aquesta acció."}), 403
            return fn(*args, **kwargs)
        return wrapper
    return deco

def parse_int(value, default, minimum=None, maximum=None):
    try:
        n = int(value)
    except (TypeError, ValueError):
        n = default
    if minimum is not None:
        n = max(minimum, n)
    if maximum is not None:
        n = min(maximum, n)
    return n

def log_event(event_type, metadata=None):
    uid = session.get("user_id")
    if not uid:
        return
    try:
        with connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "INSERT INTO ai_events (user_id,event_type,metadata) VALUES (%s,%s,%s::jsonb)",
                    (uid, event_type, json.dumps(metadata or {}, ensure_ascii=False))
                )
            conn.commit()
    except Exception:
        app.logger.exception("Could not log experiment event")

@app.get("/")
def index():
    try:
        ensure_schema()
        return render_template("index.html")
    except Exception:
        # Keep the UI reachable even if the database is temporarily unavailable.
        return render_template("index.html")

@app.get("/api/health")
def health():
    try:
        ensure_schema()
        with connect() as conn:
            conn.execute("SELECT 1")
        return jsonify({"ok": True})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500

@app.get("/api/me")
def me():
    try:
        u = current_user()
        return jsonify({"user": u})
    except Exception as e:
        return db_error_response(e)

@app.post("/api/register")
def register():
    data = request.get_json(silent=True) or {}
    username = (data.get("username") or "").strip()
    email = (data.get("email") or "").strip().lower()
    password = data.get("password") or ""
    role = data.get("role") or "alumne"
    if len(username) < 2 or "@" not in email or len(password) < 6:
        return jsonify({"error": "Completa correctament el nom, el correu i una contrasenya de mínim 6 caràcters."}), 400
    if role not in ("alumne", "professor"):
        return jsonify({"error": "Tipus d'usuari no vàlid."}), 400
    try:
        ensure_schema()
        with connect() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT 1 FROM users WHERE email=%s", (email,))
                if cur.fetchone():
                    return jsonify({"error": "Aquest correu ja està registrat."}), 409
                cur.execute(
                    "INSERT INTO users (username,email,password_hash,role) VALUES (%s,%s,%s,%s) RETURNING id",
                    (username, email, generate_password_hash(password), role)
                )
                uid = cur.fetchone()["id"]
            conn.commit()
        session.clear()
        session["user_id"] = uid
        return jsonify({"ok": True})
    except Exception as e:
        return db_error_response(e)

@app.post("/api/login")
def login():
    data = request.get_json(silent=True) or {}
    email = (data.get("email") or "").strip().lower()
    password = data.get("password") or ""
    try:
        ensure_schema()
        with connect() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT * FROM users WHERE email=%s", (email,))
                u = cur.fetchone()
        if not u or not check_password_hash(u["password_hash"], password):
            return jsonify({"error": "Correu o contrasenya incorrectes."}), 401
        session.clear()
        session["user_id"] = u["id"]
        return jsonify({"ok": True, "user": {"id":u["id"],"username":u["username"],"email":u["email"],"role":u["role"]}})
    except Exception as e:
        return db_error_response(e)

@app.post("/api/logout")
def logout():
    session.clear()
    return jsonify({"ok": True})

@app.get("/api/dashboard")
@login_required
def dashboard():
    uid = session["user_id"]
    try:
        with connect() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    SELECT id,name,subject,description,due_date,estimated_minutes,difficulty,status
                    FROM tasks WHERE student_id=%s ORDER BY
                    CASE status WHEN 'completada' THEN 2 WHEN 'en procés' THEN 1 ELSE 0 END,
                    due_date NULLS LAST, id DESC
                """, (uid,))
                tasks = cur.fetchall()
                cur.execute("""
                    SELECT id,subject,exam_date,syllabus,difficulty,study_minutes
                    FROM exams WHERE student_id=%s ORDER BY exam_date
                """, (uid,))
                exams = cur.fetchall()
                cur.execute("""
                    SELECT c.id,c.name,c.code,c.teacher_id,u.username AS teacher,
                           (SELECT COUNT(*) FROM class_students cs WHERE cs.class_id=c.id) AS student_count
                    FROM classes c JOIN users u ON u.id=c.teacher_id
                    WHERE c.teacher_id=%s
                    UNION ALL
                    SELECT c.id,c.name,c.code,c.teacher_id,u.username AS teacher,
                           (SELECT COUNT(*) FROM class_students cs WHERE cs.class_id=c.id) AS student_count
                    FROM class_students cs JOIN classes c ON c.id=cs.class_id
                    JOIN users u ON u.id=c.teacher_id
                    WHERE cs.student_id=%s
                    ORDER BY name
                """, (uid,uid))
                classes = cur.fetchall()
                cur.execute("SELECT COALESCE(SUM(planned_minutes),0) AS planned, COALESCE(SUM(completed_minutes),0) AS completed FROM study_sessions WHERE student_id=%s", (uid,))
                study = cur.fetchone()
        pending = [t for t in tasks if t["status"] != "completada"]
        urgent = []
        today = date.today()
        for t in pending:
            if t["due_date"] and (t["due_date"] - today).days <= 2:
                urgent.append(t)
        return jsonify({
            "tasks": tasks, "exams": exams[:8], "classes": classes,
            "pending_count": len(pending), "urgent_count": len(urgent),
            "progress": round((len(tasks)-len(pending))*100/len(tasks)) if tasks else 0,
            "study": study
        })
    except Exception as e:
        return db_error_response(e)

@app.get("/api/tasks")
@login_required
def get_tasks():
    try:
        with connect() as conn:
            with conn.cursor() as cur:
                cur.execute("""SELECT id,name,subject,description,due_date,estimated_minutes,difficulty,status
                               FROM tasks WHERE student_id=%s ORDER BY due_date NULLS LAST,id DESC""",
                            (session["user_id"],))
                return jsonify({"tasks": cur.fetchall()})
    except Exception as e:
        return db_error_response(e)

@app.post("/api/tasks")
@login_required
def create_task():
    d = request.get_json(silent=True) or {}
    name = (d.get("name") or "").strip()
    subject = (d.get("subject") or "").strip()
    if not name or not subject:
        return jsonify({"error": "El nom i l'assignatura són obligatoris."}), 400
    try:
        with connect() as conn:
            with conn.cursor() as cur:
                cur.execute("""INSERT INTO tasks
                    (student_id,name,subject,description,due_date,estimated_minutes,difficulty,status)
                    VALUES (%s,%s,%s,%s,%s,%s,%s,%s) RETURNING id""",
                    (session["user_id"],name,subject,d.get("description",""),d.get("due_date") or None,
                     parse_int(d.get("estimated_minutes"),30,5,1440),
                     parse_int(d.get("difficulty"),2,1,3),
                     d.get("status") if d.get("status") in ("pendent","en procés","completada") else "pendent"))
                tid=cur.fetchone()["id"]
            conn.commit()
        log_event("task_created", {"task_id": tid})
        return jsonify({"ok":True,"id":tid})
    except Exception as e:
        return db_error_response(e)

@app.patch("/api/tasks/<int:task_id>")
@login_required
def update_task(task_id):
    d=request.get_json(silent=True) or {}
    allowed = ["name","subject","description","due_date","estimated_minutes","difficulty","status"]
    fields=[]; values=[]
    for k in allowed:
        if k in d:
            if k=="status" and d[k] not in ("pendent","en procés","completada"):
                continue
            fields.append(f"{k}=%s")
            values.append(d[k] if k not in ("estimated_minutes","difficulty") else parse_int(d[k],30 if k=="estimated_minutes" else 2,5 if k=="estimated_minutes" else 1,1440 if k=="estimated_minutes" else 3))
    if not fields:
        return jsonify({"error":"No hi ha canvis."}),400
    if "status" in d and d["status"]=="completada":
        fields.append("completed_at=NOW()")
    values.extend([task_id,session["user_id"]])
    try:
        with connect() as conn:
            with conn.cursor() as cur:
                cur.execute(f"UPDATE tasks SET {','.join(fields)} WHERE id=%s AND student_id=%s", values)
                if cur.rowcount==0:
                    return jsonify({"error":"Tasca no trobada."}),404
            conn.commit()
        if d.get("status")=="completada":
            log_event("task_completed", {"task_id":task_id})
        return jsonify({"ok":True})
    except Exception as e:
        return db_error_response(e)

@app.delete("/api/tasks/<int:task_id>")
@login_required
def delete_task(task_id):
    try:
        with connect() as conn:
            with conn.cursor() as cur:
                cur.execute("DELETE FROM tasks WHERE id=%s AND student_id=%s",(task_id,session["user_id"]))
                if cur.rowcount==0: return jsonify({"error":"Tasca no trobada."}),404
            conn.commit()
        return jsonify({"ok":True})
    except Exception as e:
        return db_error_response(e)

@app.get("/api/exams")
@login_required
def get_exams():
    try:
        with connect() as conn:
            with conn.cursor() as cur:
                cur.execute("""SELECT id,subject,exam_date,syllabus,difficulty,study_minutes
                               FROM exams WHERE student_id=%s ORDER BY exam_date""",(session["user_id"],))
                return jsonify({"exams":cur.fetchall()})
    except Exception as e:
        return db_error_response(e)

@app.post("/api/exams")
@login_required
def create_exam():
    d=request.get_json(silent=True) or {}
    if not d.get("subject") or not d.get("exam_date"):
        return jsonify({"error":"L'assignatura i la data són obligatòries."}),400
    try:
        with connect() as conn:
            with conn.cursor() as cur:
                cur.execute("""INSERT INTO exams (student_id,subject,exam_date,syllabus,difficulty,study_minutes)
                               VALUES (%s,%s,%s,%s,%s,%s) RETURNING id""",
                            (session["user_id"],d["subject"],d["exam_date"],d.get("syllabus",""),
                             parse_int(d.get("difficulty"),2,1,3),
                             parse_int(d.get("study_minutes"),120,15,2000)))
                eid=cur.fetchone()["id"]
            conn.commit()
        log_event("exam_created", {"exam_id":eid})
        return jsonify({"ok":True,"id":eid})
    except Exception as e:
        return db_error_response(e)

@app.delete("/api/exams/<int:exam_id>")
@login_required
def delete_exam(exam_id):
    try:
        with connect() as conn:
            with conn.cursor() as cur:
                cur.execute("DELETE FROM exams WHERE id=%s AND student_id=%s",(exam_id,session["user_id"]))
                if cur.rowcount==0:return jsonify({"error":"Examen no trobat."}),404
            conn.commit()
        return jsonify({"ok":True})
    except Exception as e:
        return db_error_response(e)

def class_list_for(uid):
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT c.id,c.name,c.code,c.teacher_id,u.username AS teacher,
                       (SELECT COUNT(*) FROM class_students cs2 WHERE cs2.class_id=c.id) AS student_count,
                       CASE WHEN c.teacher_id=%s THEN 'professor' ELSE 'alumne' END AS membership
                FROM classes c JOIN users u ON u.id=c.teacher_id
                WHERE c.teacher_id=%s OR EXISTS(
                    SELECT 1 FROM class_students cs WHERE cs.class_id=c.id AND cs.student_id=%s
                )
                ORDER BY c.created_at DESC
            """,(uid,uid,uid))
            return cur.fetchall()

@app.get("/api/classes")
@login_required
def get_classes():
    try:
        return jsonify({"classes":class_list_for(session["user_id"])})
    except Exception as e:
        return db_error_response(e)

@app.post("/api/classes")
@role_required("professor")
def create_class():
    d=request.get_json(silent=True) or {}
    name=(d.get("name") or "").strip()
    if len(name)<2:return jsonify({"error":"Escriu un nom de classe vàlid."}),400
    try:
        with connect() as conn:
            with conn.cursor() as cur:
                code=None
                for _ in range(20):
                    candidate="".join(secrets.choice(string.ascii_uppercase+string.digits) for _ in range(6))
                    cur.execute("SELECT 1 FROM classes WHERE code=%s",(candidate,))
                    if not cur.fetchone():
                        code=candidate;break
                if not code: return jsonify({"error":"No s'ha pogut generar un codi únic."}),500
                cur.execute("INSERT INTO classes (name,code,teacher_id) VALUES (%s,%s,%s) RETURNING id",
                            (name,code,session["user_id"]))
                cid=cur.fetchone()["id"]
            conn.commit()
        log_event("class_created", {"class_id":cid})
        return jsonify({"ok":True,"id":cid,"code":code})
    except Exception as e:
        return db_error_response(e)

@app.post("/api/classes/join")
@role_required("alumne")
def join_class():
    d=request.get_json(silent=True) or {}
    code=(d.get("code") or "").strip().upper()
    if len(code)!=6:return jsonify({"error":"El codi ha de tenir 6 caràcters."}),400
    try:
        with connect() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT id,name,code FROM classes WHERE code=%s",(code,))
                c=cur.fetchone()
                if not c:return jsonify({"error":"No existeix cap classe amb aquest codi."}),404
                cur.execute("SELECT 1 FROM class_students WHERE class_id=%s AND student_id=%s",(c["id"],session["user_id"]))
                if cur.fetchone():return jsonify({"error":"Ja formes part d'aquesta classe."}),409
                cur.execute("INSERT INTO class_students (class_id,student_id) VALUES (%s,%s)",(c["id"],session["user_id"]))
            conn.commit()
        log_event("class_joined", {"class_id":c["id"]})
        return jsonify({"ok":True,"class":c})
    except Exception as e:
        return db_error_response(e)

@app.get("/api/classes/<int:class_id>")
@login_required
def class_detail(class_id):
    uid=session["user_id"]
    try:
        with connect() as conn:
            with conn.cursor() as cur:
                cur.execute("""SELECT c.id,c.name,c.code,c.teacher_id,u.username AS teacher
                               FROM classes c JOIN users u ON u.id=c.teacher_id WHERE c.id=%s""",(class_id,))
                c=cur.fetchone()
                if not c:return jsonify({"error":"Classe no trobada."}),404
                is_teacher=(c["teacher_id"]==uid)
                cur.execute("SELECT 1 FROM class_students WHERE class_id=%s AND student_id=%s",(class_id,uid))
                is_student=bool(cur.fetchone())
                if not is_teacher and not is_student:return jsonify({"error":"No tens accés a aquesta classe."}),403
                cur.execute("""SELECT id,content_type,title,body,due_date,event_date,created_at
                               FROM class_content WHERE class_id=%s ORDER BY created_at DESC""",(class_id,))
                content=cur.fetchall()
                students=[]
                if is_teacher:
                    cur.execute("""SELECT u.id,u.username,u.email,cs.joined_at
                                   FROM class_students cs JOIN users u ON u.id=cs.student_id
                                   WHERE cs.class_id=%s ORDER BY u.username""",(class_id,))
                    students=cur.fetchall()
        return jsonify({"class":c,"content":content,"students":students,"can_manage":is_teacher})
    except Exception as e:
        return db_error_response(e)

@app.post("/api/classes/<int:class_id>/content")
@role_required("professor")
def add_class_content(class_id):
    d=request.get_json(silent=True) or {}
    ctype=d.get("content_type")
    if ctype not in ("deures","examen","avis"):
        return jsonify({"error":"Tipus de contingut no vàlid."}),400
    try:
        with connect() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT id FROM classes WHERE id=%s AND teacher_id=%s",(class_id,session["user_id"]))
                if not cur.fetchone():return jsonify({"error":"No pots gestionar aquesta classe."}),403
                cur.execute("""INSERT INTO class_content
                    (class_id,author_id,content_type,title,body,due_date,event_date)
                    VALUES (%s,%s,%s,%s,%s,%s,%s) RETURNING id""",
                    (class_id,session["user_id"],ctype,(d.get("title") or "").strip(),
                     d.get("body",""),d.get("due_date") or None,d.get("event_date") or None))
                cid=cur.fetchone()["id"]
            conn.commit()
        return jsonify({"ok":True,"id":cid})
    except Exception as e:
        return db_error_response(e)

@app.get("/api/study-sessions")
@login_required
def get_study_sessions():
    try:
        with connect() as conn:
            with conn.cursor() as cur:
                cur.execute("""SELECT id,task_id,subject,session_date,planned_minutes,completed_minutes
                               FROM study_sessions WHERE student_id=%s ORDER BY session_date,id""",(session["user_id"],))
                return jsonify({"sessions":cur.fetchall()})
    except Exception as e:
        return db_error_response(e)

@app.post("/api/study-sessions")
@login_required
def create_study_session():
    d=request.get_json(silent=True) or {}
    try:
        with connect() as conn:
            with conn.cursor() as cur:
                cur.execute("""INSERT INTO study_sessions
                    (student_id,task_id,subject,session_date,planned_minutes,completed_minutes)
                    VALUES (%s,%s,%s,%s,%s,%s) RETURNING id""",
                    (session["user_id"],d.get("task_id") or None,d.get("subject",""),
                     d.get("session_date") or date.today().isoformat(),
                     parse_int(d.get("planned_minutes"),30,5,480),
                     parse_int(d.get("completed_minutes"),0,0,480)))
                sid=cur.fetchone()["id"]
            conn.commit()
        log_event("study_session_created", {"session_id":sid})
        return jsonify({"ok":True,"id":sid})
    except Exception as e:
        return db_error_response(e)

@app.get("/api/progress")
@login_required
def progress():
    uid=session["user_id"]
    try:
        with connect() as conn:
            with conn.cursor() as cur:
                cur.execute("""SELECT
                    COUNT(*) FILTER (WHERE status='completada') AS completed,
                    COUNT(*) FILTER (WHERE status!='completada') AS pending,
                    COUNT(*) AS total,
                    COALESCE(SUM(estimated_minutes) FILTER (WHERE status!='completada'),0) AS pending_minutes
                    FROM tasks WHERE student_id=%s""",(uid,))
                t=cur.fetchone()
                cur.execute("""SELECT COALESCE(SUM(planned_minutes),0) AS planned,
                                      COALESCE(SUM(completed_minutes),0) AS completed
                               FROM study_sessions WHERE student_id=%s""",(uid,))
                s=cur.fetchone()
                cur.execute("""SELECT session_date,COALESCE(SUM(completed_minutes),0) AS minutes
                               FROM study_sessions WHERE student_id=%s
                               AND session_date >= CURRENT_DATE-6
                               GROUP BY session_date ORDER BY session_date""",(uid,))
                week=cur.fetchall()
                cur.execute("""SELECT score,total,topic,created_at FROM test_results
                               WHERE user_id=%s ORDER BY created_at DESC LIMIT 8""",(uid,))
                tests=cur.fetchall()
        return jsonify({"tasks":t,"study":s,"week":week,"tests":tests})
    except Exception as e:
        return db_error_response(e)

@app.post("/api/ai")
@login_required
def ai_chat():
    d=request.get_json(silent=True) or {}
    mode=d.get("mode","DUBTE")
    message=(d.get("message") or "").strip()
    if not message:return jsonify({"error":"Escriu una pregunta o un tema."}),400
    uid=session["user_id"]
    try:
        with connect() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT name,subject,due_date,estimated_minutes,difficulty,status FROM tasks WHERE student_id=%s ORDER BY due_date NULLS LAST",(uid,))
                tasks=cur.fetchall()
                cur.execute("SELECT subject,exam_date,syllabus,difficulty,study_minutes FROM exams WHERE student_id=%s ORDER BY exam_date",(uid,))
                exams=cur.fetchall()
        context={"tasques":tasks,"exàmens":exams}
        answer=ask_ai(mode,message,context)
        log_event("ai_chat", {"mode":mode})
        return jsonify({"answer":answer})
    except Exception as e:
        return db_error_response(e)

@app.get("/api/ai/recommendations")
@login_required
def ai_recommendations():
    uid=session["user_id"]
    try:
        with connect() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT id,name,subject,due_date,estimated_minutes,difficulty,status FROM tasks WHERE student_id=%s AND status!='completada' ORDER BY due_date NULLS LAST",(uid,))
                tasks=cur.fetchall()
                cur.execute("SELECT id,subject,exam_date,syllabus,difficulty,study_minutes FROM exams WHERE student_id=%s ORDER BY exam_date",(uid,))
                exams=cur.fetchall()
        recs=build_recommendations(tasks,exams)
        log_event("ai_recommendations", {"count":len(recs)})
        return jsonify({"recommendations":recs})
    except Exception as e:
        return db_error_response(e)

@app.post("/api/ai/test")
@login_required
def ai_test():
    d=request.get_json(silent=True) or {}
    topic=(d.get("topic") or "").strip()
    if not topic:return jsonify({"error":"Indica el tema del test."}),400
    try:
        test=generate_test(topic)
        return jsonify(test)
    except Exception as e:
        return db_error_response(e)

@app.post("/api/test-results")
@login_required
def save_test_result():
    d=request.get_json(silent=True) or {}
    try:
        with connect() as conn:
            with conn.cursor() as cur:
                cur.execute("""INSERT INTO test_results (user_id,topic,score,total)
                               VALUES (%s,%s,%s,%s)""",
                            (session["user_id"],d.get("topic",""),
                             parse_int(d.get("score"),0,0,100),
                             parse_int(d.get("total"),0,0,100)))
            conn.commit()
        log_event("test_completed", {"topic":d.get("topic",""),"score":d.get("score",0),"total":d.get("total",0)})
        return jsonify({"ok":True})
    except Exception as e:
        return db_error_response(e)

@app.errorhandler(404)
def not_found(e):
    if request.path.startswith("/api/"):
        return jsonify({"error":"Ruta no trobada."}),404
    return render_template("error.html", code=404),404

@app.errorhandler(500)
def internal(e):
    if request.path.startswith("/api/"):
        return jsonify({"error":"Error intern del servidor."}),500
    return render_template("error.html", code=500),500

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT",5000)), debug=True)
