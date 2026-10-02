import os
from functools import wraps
from flask import Flask, jsonify, request, session, render_template
from werkzeug.security import generate_password_hash, check_password_hash
from dotenv import load_dotenv

load_dotenv()

app=Flask(__name__)
app.secret_key=os.getenv("SECRET_KEY","mini-classroom-dev-secret")

# Els imports de PostgreSQL són intencionadament mandrosos:
# així la portada de Vercel pot carregar encara que DATABASE_URL encara no estigui configurada.
def get_db():
    import psycopg
    from psycopg.rows import dict_row
    url=os.getenv("DATABASE_URL","").strip()
    if not url:
        raise RuntimeError("Falta DATABASE_URL")
    return psycopg.connect(url,row_factory=dict_row)

def init_db():
    with get_db() as conn:
        with conn.cursor() as c:
            c.execute("""CREATE TABLE IF NOT EXISTS users(
                id SERIAL PRIMARY KEY,name TEXT NOT NULL,email TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,role TEXT NOT NULL CHECK(role IN('student','teacher')),
                created_at TIMESTAMPTZ DEFAULT NOW())""")
            c.execute("""CREATE TABLE IF NOT EXISTS classes(
                id SERIAL PRIMARY KEY,name TEXT NOT NULL,code CHAR(6) UNIQUE NOT NULL,
                teacher_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                created_at TIMESTAMPTZ DEFAULT NOW())""")
            c.execute("""CREATE TABLE IF NOT EXISTS class_students(
                class_id INTEGER REFERENCES classes(id) ON DELETE CASCADE,
                student_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                joined_at TIMESTAMPTZ DEFAULT NOW(),PRIMARY KEY(class_id,student_id))""")
            c.execute("""CREATE TABLE IF NOT EXISTS tasks(
                id SERIAL PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                class_id INTEGER REFERENCES classes(id) ON DELETE SET NULL,name TEXT NOT NULL,
                subject TEXT NOT NULL,description TEXT DEFAULT '',due_date DATE,
                estimated_minutes INTEGER DEFAULT 30,difficulty TEXT DEFAULT 'mitjana',
                status TEXT DEFAULT 'pendent',created_at TIMESTAMPTZ DEFAULT NOW())""")
            c.execute("""CREATE TABLE IF NOT EXISTS exams(
                id SERIAL PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                class_id INTEGER REFERENCES classes(id) ON DELETE SET NULL,subject TEXT NOT NULL,
                exam_date DATE NOT NULL,syllabus TEXT DEFAULT '',difficulty TEXT DEFAULT 'mitjana',
                study_minutes INTEGER DEFAULT 120,created_at TIMESTAMPTZ DEFAULT NOW())""")
            c.execute("""CREATE TABLE IF NOT EXISTS class_content(
                id SERIAL PRIMARY KEY,class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
                teacher_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,kind TEXT NOT NULL,
                title TEXT NOT NULL,body TEXT DEFAULT '',event_date DATE,created_at TIMESTAMPTZ DEFAULT NOW())""")
            c.execute("""CREATE TABLE IF NOT EXISTS experiment_logs(
                id SERIAL PRIMARY KEY,user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
                event TEXT NOT NULL,payload JSONB DEFAULT '{}'::jsonb,created_at TIMESTAMPTZ DEFAULT NOW())""")
        conn.commit()

def db_required(fn):
    @wraps(fn)
    def w(*a,**kw):
        try:
            init_db()
            return fn(*a,**kw)
        except RuntimeError as e:
            return jsonify({"error":"La base de dades encara no està configurada. Afegeix DATABASE_URL a Vercel."}),503
        except Exception:
            return jsonify({"error":"No s'ha pogut connectar amb la base de dades."}),503
    return w

def user():
    uid=session.get("user_id")
    if not uid:return None
    with get_db() as conn:
        with conn.cursor() as c:
            c.execute("SELECT id,name,email,role FROM users WHERE id=%s",(uid,))
            return c.fetchone()

def login_required(fn):
    @wraps(fn)
    def w(*a,**kw):
        if not session.get("user_id"):return jsonify({"error":"No has iniciat sessió"}),401
        return fn(*a,**kw)
    return w

@app.get("/")
def home(): return render_template("index.html")

@app.get("/health")
def health():
    try:
        init_db()
        return jsonify({"ok":True,"database":"connected"})
    except Exception as e:
        return jsonify({"ok":False,"database":"not configured or unavailable","detail":str(e)}),503

@app.post("/api/register")
@db_required
def register():
    d=request.get_json() or {}
    name=d.get("name","").strip();email=d.get("email","").strip().lower();pw=d.get("password","");role=d.get("role","student")
    if not name or not email or len(pw)<6 or role not in ("student","teacher"):return jsonify({"error":"Revisa les dades. La contrasenya ha de tenir almenys 6 caràcters."}),400
    try:
        with get_db() as conn:
            with conn.cursor() as c:
                c.execute("INSERT INTO users(name,email,password_hash,role) VALUES(%s,%s,%s,%s) RETURNING id",(name,email,generate_password_hash(pw),role))
                uid=c.fetchone()["id"]
            conn.commit()
        session["user_id"]=uid
        return jsonify({"ok":True})
    except Exception:
        return jsonify({"error":"Aquest correu ja està registrat o no és vàlid."}),409

@app.post("/api/login")
@db_required
def login():
    d=request.get_json() or {}
    with get_db() as conn:
        with conn.cursor() as c:
            c.execute("SELECT id,password_hash FROM users WHERE email=%s",(d.get("email","").strip().lower(),))
            u=c.fetchone()
    if not u or not check_password_hash(u["password_hash"],d.get("password","")):return jsonify({"error":"Correu o contrasenya incorrectes."}),401
    session["user_id"]=u["id"];return jsonify({"ok":True})

@app.post("/api/logout")
def logout():session.clear();return jsonify({"ok":True})

@app.get("/api/me")
def me():
    try:u=user()
    except Exception:u=None
    return jsonify({"user":u})

@app.get("/api/dashboard")
@login_required
@db_required
def dashboard():
    uid=session["user_id"]
    with get_db() as conn:
        with conn.cursor() as c:
            c.execute("SELECT * FROM tasks WHERE user_id=%s ORDER BY due_date NULLS LAST,id DESC",(uid,));tasks=c.fetchall()
            c.execute("SELECT * FROM exams WHERE user_id=%s ORDER BY exam_date,id",(uid,));exams=c.fetchall()
            c.execute("""SELECT c.id,c.name,c.code FROM classes c JOIN class_students cs ON cs.class_id=c.id WHERE cs.student_id=%s ORDER BY c.name""",(uid,));classes=c.fetchall()
    return jsonify({"tasks":tasks,"exams":exams,"classes":classes})

@app.post("/api/tasks")
@login_required
@db_required
def add_task():
    d=request.get_json() or {}
    if not d.get("name") or not d.get("subject"):return jsonify({"error":"Falten nom i assignatura."}),400
    with get_db() as conn:
        with conn.cursor() as c:
            c.execute("""INSERT INTO tasks(user_id,name,subject,description,due_date,estimated_minutes,difficulty,status)
            VALUES(%s,%s,%s,%s,%s,%s,%s,%s) RETURNING *""",(session["user_id"],d["name"],d["subject"],d.get("description",""),d.get("due_date") or None,int(d.get("estimated_minutes",30)),d.get("difficulty","mitjana"),"pendent"))
            row=c.fetchone()
        conn.commit()
    return jsonify({"task":row})

@app.patch("/api/tasks/<int:tid>")
@login_required
@db_required
def patch_task(tid):
    d=request.get_json() or {}
    allowed={"name","subject","description","due_date","estimated_minutes","difficulty","status"}
    fields=[x for x in d if x in allowed]
    if not fields:return jsonify({"error":"Cap canvi."}),400
    vals=[d[x] for x in fields]+[tid,session["user_id"]]
    with get_db() as conn:
        with conn.cursor() as c:
            c.execute("UPDATE tasks SET "+",".join(x+"=%s" for x in fields)+" WHERE id=%s AND user_id=%s RETURNING *",vals);row=c.fetchone()
        conn.commit()
    return jsonify({"task":row}) if row else (jsonify({"error":"Tasca no trobada."}),404)

@app.post("/api/exams")
@login_required
@db_required
def add_exam():
    d=request.get_json() or {}
    if not d.get("subject") or not d.get("exam_date"):return jsonify({"error":"Falten assignatura i data."}),400
    with get_db() as conn:
        with conn.cursor() as c:
            c.execute("""INSERT INTO exams(user_id,subject,exam_date,syllabus,difficulty,study_minutes)
            VALUES(%s,%s,%s,%s,%s,%s) RETURNING *""",(session["user_id"],d["subject"],d["exam_date"],d.get("syllabus",""),d.get("difficulty","mitjana"),int(d.get("study_minutes",120))))
            row=c.fetchone()
        conn.commit()
    return jsonify({"exam":row})

@app.post("/api/classes")
@login_required
@db_required
def add_class():
    import secrets,string
    u=user()
    if u["role"]!="teacher":return jsonify({"error":"Només els professors poden crear classes."}),403
    name=(request.get_json() or {}).get("name","").strip()
    if not name:return jsonify({"error":"Indica un nom."}),400
    code="".join(secrets.choice(string.ascii_uppercase+string.digits) for _ in range(6))
    with get_db() as conn:
        with conn.cursor() as c:
            c.execute("INSERT INTO classes(name,code,teacher_id) VALUES(%s,%s,%s) RETURNING *",(name,code,u["id"]));row=c.fetchone()
        conn.commit()
    return jsonify({"class":row})

@app.post("/api/classes/join")
@login_required
@db_required
def join():
    u=user()
    if u["role"]!="student":return jsonify({"error":"Només els alumnes poden unir-se."}),403
    code=(request.get_json() or {}).get("code","").strip().upper()
    with get_db() as conn:
        with conn.cursor() as c:
            c.execute("SELECT id,name,code FROM classes WHERE code=%s",(code,));cl=c.fetchone()
            if not cl:return jsonify({"error":"Codi inexistent."}),404
            c.execute("SELECT 1 FROM class_students WHERE class_id=%s AND student_id=%s",(cl["id"],u["id"]))
            if c.fetchone():return jsonify({"error":"Ja formes part d'aquesta classe."}),409
            c.execute("INSERT INTO class_students(class_id,student_id) VALUES(%s,%s)",(cl["id"],u["id"]))
        conn.commit()
    return jsonify({"class":cl})

@app.post("/api/ai")
@login_required
def ai():
    from services.ai import ask
    d=request.get_json() or {};uid=session["user_id"];tasks=[];exams=[]
    try:
        with get_db() as conn:
            with conn.cursor() as c:
                c.execute("SELECT id,name,subject,due_date,estimated_minutes,difficulty,status FROM tasks WHERE user_id=%s ORDER BY due_date NULLS LAST",(uid,));tasks=c.fetchall()
                c.execute("SELECT id,subject,exam_date,syllabus,difficulty,study_minutes FROM exams WHERE user_id=%s ORDER BY exam_date",(uid,));exams=c.fetchall()
    except Exception: pass
    return jsonify({"result":ask(d.get("mode","dubte"),d.get("message",""),{"tasks":tasks,"exams":exams})})

@app.errorhandler(404)
def not_found(e):
    return render_template("error.html",code=404),404

@app.errorhandler(500)
def internal(e):
    return render_template("error.html",code=500),500
