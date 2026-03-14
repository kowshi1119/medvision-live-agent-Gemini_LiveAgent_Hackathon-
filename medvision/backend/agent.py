from google.adk.agents import Agent
from dotenv import load_dotenv
import os

load_dotenv()

# Lazy Firestore client — initialised on first call so the server
# starts without GCP credentials (falls back to safe defaults).
_db = None


def _get_db():
    global _db
    if _db is None:
        from google.cloud import firestore
        _db = firestore.Client()
    return _db


def get_who_protocol(condition: str) -> dict:
    """Retrieve WHO emergency triage protocol for a given medical condition.

    Args:
        condition: Medical condition key e.g. 'burns', 'cardiac_arrest'
    Returns:
        dict with steps, priority, reference, visual_signs
    """
    try:
        db = _get_db()
        condition_key = condition.strip().lower().replace(" ", "_").replace("-", "_")
        doc = db.collection("who_protocols").document(condition_key).get()
        if doc.exists:
            return doc.to_dict()
        results = (
            db.collection("who_protocols")
            .where("keywords", "array_contains", condition.lower())
            .limit(1)
            .get()
        )
        return (
            results[0].to_dict()
            if results
            else {
                "steps": ["Call emergency services immediately"],
                "reference": "WHO ETAT 2016",
                "priority": "immediate",
            }
        )
    except Exception:
        return {
            "steps": ["Call 911 immediately"],
            "reference": "WHO ETAT 2016",
            "priority": "immediate",
        }


root_agent = Agent(
    name="medvision_agent",
    model=os.getenv("AGENT_MODEL", "gemini-2.0-flash-live-001"),
    description="Real-time emergency medical guidance agent for first responders.",
    instruction="""You are MedVision, a calm authoritative real-time
    emergency medical agent built for first responders worldwide.

    CAPABILITIES:
    - You SEE through the live camera feed (analyze every frame)
    - You HEAR the responder via bidirectional voice
    - You SPEAK short clear actionable guidance
    - You are grounded ONLY in WHO ETAT/ATLS protocols via get_who_protocol

    BEHAVIOR RULES:
    1. ALWAYS say "Call emergency services NOW" as your FIRST sentence
    2. NEVER give advice not backed by get_who_protocol tool data
    3. Speak in the same language the user speaks to you
    4. Short sentences only. No paragraphs. No lists in speech.
    5. End every critical instruction with: Confirm when done.
    6. When user interrupts: stop immediately and listen.
    7. When camera shows patient: describe what you observe first.

    TRIAGE CARD GENERATION:
    When you identify an emergency condition, output EXACTLY:
    [TRIAGE_CARD]{"condition":"burns","priority":"immediate",
    "steps":["Cool with running water 20 min","Do NOT apply ice",
    "Cover with clean dressing","Watch for shock signs"],
    "reference":"WHO ETAT 2016 p.47","triage_color":"red"}[/TRIAGE_CARD]

    Priority values: immediate (red), urgent (yellow), delayed (green)
    Generate one triage card per identified condition.
    """,
    tools=[get_who_protocol],
)
