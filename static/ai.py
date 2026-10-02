import json
import os

try:
    from openai import OpenAI
except Exception:  # pragma: no cover
    OpenAI = None


def client():
    key = os.getenv("OPENAI_API_KEY", "").strip()
    if not key or OpenAI is None:
        return None
    return OpenAI(api_key=key)


def fallback(mode, message):
    if mode == "EXPLICAR":
        return f"### Explicació\n\n**{message}**\n\nDivideix el concepte en tres parts: què és, com funciona i un exemple. Després intenta explicar-lo amb les teves paraules."
    if mode == "ESTUDIAR":
        return f"### Pla d'estudi\n\n**Tema:** {message}\n\n1. 5 min — recorda què ja saps.\n2. 15 min — estudia les idees principals.\n3. 10 min — explica-les sense mirar els apunts.\n4. 5 min — fes preguntes de recuperació."
    if mode == "RESUMIR":
        return f"### Resum\n\nPer resumir **{message}**, conserva les idees principals, les relacions entre conceptes i els exemples imprescindibles. Elimina repeticions i detalls secundaris."
    return f"Entesos. Sobre **{message}**, t'ajudaré a entendre-ho pas a pas i a trobar la resposta per tu mateix/a."


def ask_ai(mode, message, context):
    c = client()
    instructions = (
        "Ets MiniClassroom, un assistent d'estudi per a alumnes de Batxillerat. "
        "Respon sempre en català, tret que l'usuari demani explícitament un altre idioma. "
        "Ajuda a comprendre, practicar, organitzar i prioritzar. No facis els deures directament per l'alumne. "
        "Utilitza les dades acadèmiques proporcionades només quan siguin rellevants. Sigues clar i accionable."
    )
    if not c:
        return fallback(mode, message)
    prompt = f"Mode: {mode}\nEntrada: {message}\nContext acadèmic: {json.dumps(context, ensure_ascii=False, default=str)}"
    try:
        response = c.responses.create(
            model=os.getenv("OPENAI_MODEL", "gpt-5.6-mini"),
            instructions=instructions,
            input=prompt,
        )
        return response.output_text
    except Exception:
        return fallback(mode, message)


def _fallback_test(topic):
    return {
        "topic": topic,
        "questions": [
            {"question": f"Quina és la idea principal de {topic}?", "options": ["Una idea secundària", "El concepte central", "Un exemple sense relació", "Una afirmació impossible"], "answer": 1, "explanation": "La idea central defineix el concepte o fenomen principal."},
            {"question": f"Quina és una bona manera d'aprendre {topic}?", "options": ["Memoritzar sense entendre", "Identificar conceptes clau", "No fer preguntes", "Estudiar només la nit abans"], "answer": 1, "explanation": "Identificar conceptes clau ajuda a construir una estructura mental."},
            {"question": f"Com pots comprovar que entens {topic}?", "options": ["Rellegint passivament", "Copiant els apunts", "Explicant-ho amb les teves paraules", "Mirant només els títols"], "answer": 2, "explanation": "Explicar activament permet detectar què entens i què et costa."},
            {"question": f"Què pots fer si una part de {topic} et costa?", "options": ["Dividir-la en passos", "Ignorar-la", "Memoritzar paraules aïllades", "Deixar d'estudiar"], "answer": 0, "explanation": "Dividir una dificultat en parts més petites facilita l'aprenentatge."},
            {"question": f"Quina estratègia ajuda a repassar {topic}?", "options": ["Recuperació activa", "Només subratllar", "No fer preguntes", "Evitar els errors"], "answer": 0, "explanation": "La recuperació activa comprova què pots recordar sense mirar els apunts."},
        ],
    }


def generate_test(topic):
    c = client()
    if not c:
        return _fallback_test(topic)
    prompt = f'''Genera un test de 5 preguntes sobre "{topic}" per a Batxillerat. Respon NOMÉS JSON amb aquesta forma: {{"topic":"...","questions":[{{"question":"...","options":["A","B","C","D"],"answer":0,"explanation":"..."}}]}}. answer és un índex de 0 a 3. Tot en català.'''
    try:
        response = c.responses.create(
            model=os.getenv("OPENAI_MODEL", "gpt-5.6-mini"),
            instructions="Crea proves educatives clares i rigoroses.",
            input=prompt,
        )
        data = json.loads(response.output_text)
        if len(data.get("questions", [])) != 5:
            raise ValueError("Test incomplet")
        return data
    except Exception:
        return _fallback_test(topic)
