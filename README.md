# MiniClassroom — versió reconstruïda

Aplicació web funcional per al TdR sobre IA i educació.

## Arquitectura

- **Frontend:** HTML + CSS + JavaScript natiu.
- **Backend:** Flask 3.
- **Base de dades:** PostgreSQL de Supabase.
- **Deploy:** Vercel amb Flask en Python.
- **IA:** OpenAI Responses API si `OPENAI_API_KEY` existeix; fallback local en català si no existeix.
- **Autenticació:** sessió Flask i contrasenyes amb hash de Werkzeug.

La versió està dissenyada per treballar amb la base de dades Supabase existent del projecte. No fa servir SQLite ni crea una segona arquitectura d'autenticació.

## Variables de Vercel

Obligatòries:

- `DATABASE_URL` — cadena del **Shared pooler / Transaction mode** de Supabase.
- `SECRET_KEY` — secret aleatori llarg.

Opcional:

- `OPENAI_API_KEY`
- `OPENAI_MODEL`

Per Vercel serverless, Supabase documenta el Shared pooler en transaction mode (`6543`) com una opció adequada per a funcions serverless. La cadena s'ha de copiar directament del panell **Connect** de Supabase i no s'ha de construir manualment.

## Estructura

```text
app.py
requirements.txt
schema.sql
services/
  __init__.py
  ai.py
static/
  app.js
  style.css
  logo-canpeixauet.png
  canpeixauet.jpg
templates/
  index.html
  error.html
```

## Proves locals

```bash
python -m py_compile app.py services/ai.py
node --check static/app.js
```

Per executar:

```bash
pip install -r requirements.txt
flask --app app run
```

No cal `vercel.json`: Vercel detecta Flask en un projecte Python amb la configuració actual.
