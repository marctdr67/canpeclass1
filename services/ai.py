import os
import json


def ask(mode, message="", context=None):

    key = os.getenv("OPENAI_API_KEY", "").strip()
    model = os.getenv("OPENAI_MODEL", "").strip()

    if not key or not model:

        if mode == "test":
            return {
                "questions": [
                    {
                        "question": "Quin és un bon mètode per comprovar si has entès un tema?",
                        "options": [
                            "Fer preguntes de pràctica",
                            "No repassar",
                            "Memoritzar sense entendre",
                            "Deixar-lo"
                        ],
                        "answer": "A",
                        "explanation": "Les preguntes de pràctica permeten comprovar la comprensió."
                    },
                    {
                        "question": "Què ajuda a organitzar l'estudi?",
                        "options": [
                            "Un pla",
                            "Improvisar sempre",
                            "No mirar les dates",
                            "Estudiar només el dia abans"
                        ],
                        "answer": "A",
                        "explanation": "Un pla permet repartir l'estudi segons les prioritats."
                    },
                    {
                        "question": "Què és una prioritat d'estudi?",
                        "options": [
                            "Una tasca o examen proper",
                            "Qualsevol tasca antiga",
                            "Una activitat acabada",
                            "Cap activitat"
                        ],
                        "answer": "A",
                        "explanation": "La proximitat del termini és un dels factors que pot augmentar la prioritat."
                    },
                    {
                        "question": "Què convé fer davant d'un dubte?",
                        "options": [
                            "Demanar una explicació",
                            "Ignorar-lo",
                            "Copiar la resposta",
                            "No estudiar"
                        ],
                        "answer": "A",
                        "explanation": "Explicar el dubte ajuda a resoldre'l i entendre el concepte."
                    },
                    {
                        "question": "Per què serveixen les sessions d'estudi planificades?",
                        "options": [
                            "Per repartir l'esforç",
                            "Per evitar descansar",
                            "Per eliminar les tasques",
                            "Per no preparar exàmens"
                        ],
                        "answer": "A",
                        "explanation": "Repartir les sessions ajuda a preparar-se amb antelació."
                    }
                ]
            }

        return (
            "La IA està preparada però encara no s'ha configurat "
            "OPENAI_API_KEY i OPENAI_MODEL a Vercel."
        )

    try:

        from openai import OpenAI

        client = OpenAI(api_key=key)

        context_text = json.dumps(
            context or {},
            ensure_ascii=False
        )

        instructions = """
Ets l'assistent educatiu de MiniClassroom.

Respon sempre en català.

Sigues clar, pedagògic i adequat per a estudiants
de 15 a 18 anys.

Fes servir les dades reals de tasques i exàmens
quan estiguin disponibles.
"""

        prompt = f"""
Mode: {mode}

Missatge:
{message}

Dades de l'alumne:
{context_text}
"""

        if mode == "test":

            response = client.responses.create(
                model=model,
                instructions=(
                    instructions +
                    """
Genera exactament 5 preguntes.
Cada pregunta ha de tenir 4 opcions:
A, B, C i D.

Indica la resposta correcta i una explicació.

Retorna només JSON amb la clau "questions".
"""
                ),
                input=prompt
            )

            return json.loads(response.output_text)

        response = client.responses.create(
            model=model,
            instructions=instructions,
            input=prompt
        )

        return response.output_text

    except Exception:

        return (
            "No s'ha pogut consultar la IA ara mateix. "
            "Revisa la configuració d'OpenAI a Vercel."
        )
