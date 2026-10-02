# MiniClassroom — Vercel 2

Versió preparada per a Vercel amb Flask zero-config.

IMPORTANT:
- `app.py` és a la RAÍZ.
- No hi ha `vercel.json` a propòsit.
- No hi ha configuració `functions`.
- Les carpetes `templates`, `static` i `services` s'han de conservar.

Per a dades persistents a Vercel cal configurar `DATABASE_URL` amb PostgreSQL.
Per a IA real cal configurar `OPENAI_API_KEY` i `OPENAI_MODEL`.

Desplegament:
1. Puja el contingut d'aquest ZIP a la RAÍZ del repositori GitHub.
2. Importa aquest repositori a Vercel.
3. A Vercel > Settings > Environment Variables configura `SECRET_KEY` i `DATABASE_URL`.
4. Redeploy.
