# MiniClassroom — Institut Can Peixauet

Aplicació web funcional per al TdR sobre IA i educació.

## Arquitectura

- Frontend: HTML + CSS + JavaScript natiu.
- Backend: Flask.
- Base de dades: PostgreSQL de Supabase mitjançant `DATABASE_URL`.
- Autenticació: sessió Flask signada i contrasenyes amb hash de Werkzeug.
- IA: OpenAI opcional; si no hi ha clau, l'aplicació conserva un mode educatiu local de reserva.
- PDFs de classe: es guarden a PostgreSQL en una taula auxiliar `class_materials`, creada automàticament només quan s'utilitza la funció de materials.
- Deploy: Vercel detecta `index.py`, que exporta la instància Flask `app`.

## Variables de Vercel

Configura com a mínim:

- `DATABASE_URL` — connection string de Supabase, preferiblement Shared Pooler / Transaction Mode (port 6543).
- `SECRET_KEY` — cadena aleatòria llarga i privada.

Per activar la IA real:

- `OPENAI_API_KEY`
- `OPENAI_MODEL` (opcional; si no es defineix, s'utilitza el valor del projecte)

No posis cap clau ni contrasenya dins del codi o GitHub.

## Important amb Supabase

Aquesta versió està preparada per a l'esquema existent de MiniClassroom. No cal esborrar ni recrear les taules `users`, `classes`, `class_students`, `tasks`, `exams`, `class_content`, `study_sessions`, `test_results` o `activity_log`.

La taula `class_materials` és l'única taula auxiliar que l'aplicació crea automàticament si no existeix.

## Vercel

No cal `vercel.json`. Mantén a l'arrel:

```text
app.py
index.py
requirements.txt
services/
static/
templates/
```

## Funcionalitats

- Registre, login, logout i sessió.
- Perfils d'alumne i professor.
- Tasques i exàmens.
- Classes amb codi de 6 caràcters.
- Entrada d'alumnes a classes i control de permisos.
- Aula digital amb Tauler, Treball de classe, Persones i Qualificacions.
- Avisos, deures i exàmens publicats pel professor.
- Materials PDF del professor amb obertura i eliminació.
- Calendari.
- Planificador i sessions d'estudi persistents.
- Progrés i historial de tests.
- IA d'estudi en català amb context de tasques i exàmens.
- Test de 5 preguntes amb correcció.
- Registre d'activitat per a l'experiment del TdR.

## Desenvolupament local

```bash
pip install -r requirements.txt
python app.py
```

Obre `http://127.0.0.1:5000`.
