
import json, os
from datetime import date

try:
    from openai import OpenAI
except Exception:
    OpenAI = None

def _client():
    key=os.environ.get("OPENAI_API_KEY")
    if not key or OpenAI is None:
        return None
    return OpenAI(api_key=key)

def _catalan_fallback(mode, message):
    if mode == "EXPLICAR":
        return f"### Explicació\n\n**{message}**\n\nComença definint el concepte amb les teves paraules. Després divideix-lo en 2 o 3 idees clau i comprova cada idea amb un exemple.\n\n**Per comprovar que ho entens:** explica'm el concepte sense mirar els apunts i digues quin exemple el representa millor."
    if mode == "ESTUDIAR":
        return f"### Pla d'estudi: {message}\n\n1. **5 min** — activa els coneixements previs.\n2. **15 min** — estudia les idees principals.\n3. **10 min** — intenta explicar-les sense apunts.\n4. **5 min** — fes 3 preguntes de repàs.\n\nSi m'expliques què és el que et costa, puc adaptar el pla."
    if mode == "RESUMIR":
        return f"### Resum\n\nEl text tracta sobre **{message}**. Per fer un bon resum, conserva les idees que expliquen què és, com funciona i quina conseqüència o exemple és essencial. Elimina repeticions i detalls secundaris."
    return f"Entesos. Sobre **{message}**, t'ajudaré a raonar-ho pas a pas en català, prioritzant pistes i explicacions perquè puguis arribar tu mateix/a a la resposta."

def ask_ai(mode, message, context):
    client=_client()
    system="""Ets MiniClassroom, un assistent d'estudi per a alumnes de Batxillerat.
Respon SEMPRE en català, tret que l'usuari demani explícitament un altre idioma.
No facis els deures directament com si fossis l'alumne. Ajuda a comprendre, practicar,
organitzar-se i prendre decisions d'estudi. Sigues clar, breu i accionable.
"""
    prompt=f"""Mode: {mode}
Pregunta/entrada de l'alumne:
{message}

Dades acadèmiques actuals (fes-les servir només si són rellevants):
{json.dumps(context, ensure_ascii=False, default=str)}
"""
    if not client:
        return _catalan_fallback(mode,message)
    response=client.responses.create(
        model=os.environ.get("OPENAI_MODEL","gpt-5.6-mini"),
        instructions=system,
        input=prompt,
    )
    return response.output_text

def build_recommendations(tasks, exams):
    today=date.today()
    items=[]
    for e in exams:
        try:
            days=(e["exam_date"]-today).days
        except Exception:
            days=999
        if days < 0:
            continue
        urgency=max(1, 10-days)
        score=urgency + (e.get("difficulty") or 2)*2 + min(5, (e.get("study_minutes") or 60)/60)
        items.append({
            "type":"examen","title":e["subject"],"score":round(score,1),
            "reason":f"És d'aquí a {days} dies i has indicat una dificultat {e.get('difficulty') or 2}/3.",
            "action":"Fes una sessió de repàs avui."
        })
    for t in tasks:
        if t.get("status")=="completada":
            continue
        days=999
        if t.get("due_date"):
            try: days=(t["due_date"]-today).days
            except Exception: pass
        urgency=max(1, 9-days)
        score=urgency + (t.get("difficulty") or 2)*1.5 + min(4,(t.get("estimated_minutes") or 30)/60)
        items.append({
            "type":"tasca","title":t["name"],"score":round(score,1),
            "reason":f"Entrega en {max(0,days)} dies · dificultat {t.get('difficulty') or 2}/3 · {t.get('estimated_minutes') or 30} min.",
            "action":"Comença per una primera sessió de 25 minuts."
        })
    items.sort(key=lambda x:x["score"], reverse=True)
    return items[:5]

def generate_test(topic):
    client=_client()
    if not client:
        return {
            "topic":topic,
            "questions":[
                {"question":f"Quina afirmació descriu millor {topic}?",
                 "options":["Una idea relacionada però incorrecta","La definició o idea principal","Un exemple que no hi té relació","Una conseqüència impossible"],"answer":1,
                 "explanation":"La resposta correcta és la que expressa la idea principal del tema."},
                {"question":f"Què hauries de fer primer per entendre {topic}?",
                 "options":["Memoritzar-ho tot","Identificar els conceptes clau","Saltar directament al test","Evitar els exemples"],"answer":1,
                 "explanation":"Identificar els conceptes clau ajuda a construir una estructura mental."},
                {"question":f"Quin mètode ajuda més a comprovar que entens {topic}?",
                 "options":["Rellegir sense parar","Copiar el text","Explicar-ho amb les teves paraules","Mirar només els títols"],"answer":2,
                 "explanation":"L'explicació activa obliga a recuperar i connectar les idees."},
                {"question":f"Què és útil quan una part de {topic} et costa?",
                 "options":["Dividir-la en passos","Ignorar-la","Memoritzar paraules aïllades","Deixar-la per sempre"],"answer":0,
                 "explanation":"Dividir una dificultat en passos redueix la càrrega cognitiva."},
                {"question":f"Quina és una bona manera de repassar {topic}?",
                 "options":["Fer recuperació activa","Només subratllar","No fer preguntes","Estudiar només la nit abans"],"answer":0,
                 "explanation":"La recuperació activa permet comprovar què recordes realment."}
            ]
        }
    prompt=f"""Genera un test educatiu de 5 preguntes sobre "{topic}" per a un alumne de Batxillerat.
Respon NOMÉS JSON amb aquesta forma:
{{"topic":"...","questions":[{{"question":"...","options":["A","B","C","D"],"answer":0,"explanation":"..."}}]}}
answer és l'índex 0-3 de la resposta correcta. Tot en català."""
    r=client.responses.create(
        model=os.environ.get("OPENAI_MODEL","gpt-5.6-mini"),
        instructions="Ets un creador de proves educatives rigoroses i clares.",
        input=prompt
    )
    text=r.output_text.strip()
    try:
        return json.loads(text)
    except Exception:
        return generate_test(topic) if client is None else {
            "topic":topic,
            "questions":[]
        }
