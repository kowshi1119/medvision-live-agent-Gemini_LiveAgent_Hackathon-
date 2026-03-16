"""
MedVision — Agent configuration and WHO protocol lookup.

Protocols are stored in-memory (sourced from WHO ETAT / ATLS).
Firestore is used as a secondary store when available; the in-memory
dict is always the primary fallback so the agent works locally with
no GCP credentials required.
"""

from __future__ import annotations

import logging

logger = logging.getLogger(__name__)

# ── In-memory WHO / ATLS protocol database ────────────────────────────────────

_PROTOCOLS: dict[str, dict] = {}

_PROTOCOL_LIST: list[dict] = [
    {
        "condition": "cardiac_arrest",
        "display_name": "Cardiac Arrest",
        "priority": "immediate",
        "triage_color": "red",
        "steps": [
            "Call emergency services immediately — every second counts.",
            "Check if patient is responsive — tap shoulders firmly and shout their name.",
            "If unresponsive and not breathing — begin CPR immediately.",
            "Place heel of hand on centre of chest — push hard and fast 30 times.",
            "Give 2 rescue breaths after every 30 compressions.",
            "Continue CPR until emergency services arrive or patient revives.",
            "If AED available — use it as soon as possible between compressions.",
        ],
        "reference": "WHO ETAT 2016 Ch.2; AHA BLS Guidelines 2020",
        "keywords": ["cardiac_arrest", "no_pulse", "cpr", "heart_stopped", "unconscious", "no_breathing", "resuscitation"],
    },
    {
        "condition": "severe_bleeding",
        "display_name": "Severe External Bleeding",
        "priority": "immediate",
        "triage_color": "red",
        "steps": [
            "Apply firm direct pressure to wound immediately using clean cloth or bandage.",
            "Do not remove the cloth — add more on top if it soaks through.",
            "Raise the injured area above heart level if possible.",
            "If limb is bleeding — apply tourniquet 5cm above wound as last resort.",
            "Call emergency services immediately for severe or uncontrolled bleeding.",
            "Keep patient warm and lying down to prevent shock.",
            "Monitor for signs of shock — pale cold clammy skin, rapid breathing.",
        ],
        "reference": "ATLS 10th ed. 2018 Ch.3; WHO ETAT 2016 Sec.2",
        "keywords": ["bleeding", "haemorrhage", "hemorrhage", "blood_loss", "tourniquet", "wound", "laceration"],
    },
    {
        "condition": "choking",
        "display_name": "Choking (Airway Obstruction)",
        "priority": "immediate",
        "triage_color": "red",
        "steps": [
            "Ask patient to cough as hard and forcefully as possible.",
            "If coughing fails — give 5 firm back blows between shoulder blades.",
            "If back blows fail — give 5 abdominal thrusts (Heimlich manoeuvre).",
            "Stand behind patient, wrap arms around waist, thrust firmly upward.",
            "Alternate 5 back blows and 5 abdominal thrusts until object clears.",
            "If patient loses consciousness — begin CPR and call emergency services.",
            "For pregnant patients or infants — use chest thrusts instead.",
        ],
        "reference": "WHO ETAT 2016 Airway Management; AHA BLS Choking Algorithm 2020",
        "keywords": ["choking", "airway_obstruction", "heimlich", "foreign_body", "stridor"],
    },
    {
        "condition": "anaphylaxis",
        "display_name": "Anaphylaxis (Severe Allergic Reaction)",
        "priority": "immediate",
        "triage_color": "red",
        "steps": [
            "Inject epinephrine auto-injector into outer thigh immediately.",
            "Call emergency services right now — a second dose may be needed.",
            "Lay patient flat with legs raised — unless breathing difficulty.",
            "If breathing difficulty — keep patient sitting upright.",
            "Give second epinephrine dose after 5 minutes if no improvement.",
            "Do not give antihistamines as primary treatment — only epinephrine works.",
            "Monitor breathing and consciousness every minute.",
        ],
        "reference": "WHO ETAT 2016 Sec.2 Anaphylaxis; WAO Anaphylaxis Guidelines 2020",
        "keywords": ["anaphylaxis", "allergic_reaction", "epipen", "epinephrine", "bee_sting", "food_allergy", "hives"],
    },
    {
        "condition": "stroke",
        "display_name": "Stroke (FAST Protocol)",
        "priority": "immediate",
        "triage_color": "red",
        "steps": [
            "Apply FAST test: Face drooping, Arm weakness, Speech slurred, Time to call EMS.",
            "Call emergency services immediately — note the exact time symptoms started.",
            "Every minute without treatment = 1.9 million brain cells lost — act fast.",
            "Keep patient calm and still; do NOT give food, water, or medications by mouth.",
            "Position: head elevated 30° if conscious; recovery position if unconscious.",
            "Do NOT give aspirin — haemorrhagic stroke is a contraindication.",
            "Keep patient calm and warm — cover with a blanket.",
            "Monitor breathing every 2 minutes — be ready for CPR if needed.",
            "Loosen tight clothing around neck.",
        ],
        "reference": "WHO Stroke Guidelines 2016; AHA/ASA Acute Stroke Guidelines 2019",
        "keywords": ["stroke", "cva", "brain_attack", "facial_droop", "weakness", "speech", "fast"],
    },
    {
        "condition": "head_injury",
        "display_name": "Severe Head Injury",
        "priority": "urgent",
        "triage_color": "red",
        "steps": [
            "Keep patient completely still — do not move unless in immediate danger.",
            "Call emergency services for any loss of consciousness or confusion.",
            "Control bleeding with firm gentle pressure — do not remove embedded objects.",
            "Do not give aspirin or ibuprofen — they increase bleeding risk.",
            "Monitor every 10 minutes — check responsiveness and pupil size.",
            "Watch for danger signs — repeated vomiting, seizure, unequal pupils.",
            "Keep neck stable at all times — assume spinal injury until ruled out.",
        ],
        "reference": "ATLS 10th ed. 2018 Ch.6; WHO ETAT 2016 Sec.3",
        "keywords": ["head_injury", "skull_fracture", "concussion", "tbi", "traumatic_brain", "gcs"],
    },
    {
        "condition": "burns",
        "display_name": "Burns (Thermal Injury)",
        "priority": "urgent",
        "triage_color": "yellow",
        "steps": [
            "Cool burn with cool running water for minimum 20 minutes.",
            "Do not use ice, butter, toothpaste, or any cream.",
            "Remove jewellery and clothing near burn — unless stuck to skin.",
            "Cover with clean non-fluffy material — cling film is ideal.",
            "Call emergency services for burns larger than the patient's palm.",
            "Do not burst any blisters that form.",
            "Keep patient warm — burns cause rapid heat loss.",
        ],
        "reference": "WHO Burns Manual 2014; ISBI Practice Guidelines 2016",
        "keywords": ["burns", "thermal_injury", "scalding", "fire", "smoke_inhalation", "skin_burn"],
    },
    {
        "condition": "fractures",
        "display_name": "Suspected Fracture",
        "priority": "delayed",
        "triage_color": "yellow",
        "steps": [
            "Do not try to straighten the injured area.",
            "Immobilise the fracture in the position found using a splint or padding.",
            "Check circulation below fracture — pulse, sensation, and movement.",
            "Apply ice pack wrapped in cloth to reduce swelling — 20 minutes on, off.",
            "Elevate the injured limb if possible to reduce swelling.",
            "Give pain relief if available and patient is conscious.",
            "Seek emergency care for open fractures or suspected spine fractures.",
        ],
        "reference": "ATLS 10th ed. 2018 Ch.7; WHO Surgical Care at District Hospital 2003",
        "keywords": ["fracture", "broken_bone", "dislocation", "splint", "compartment_syndrome"],
    },
    {
        "condition": "diabetic_emergency",
        "display_name": "Diabetic Emergency (Hypoglycaemia / DKA)",
        "priority": "urgent",
        "triage_color": "yellow",
        "steps": [
            "If patient is conscious — give sugary drink or glucose tablets now.",
            "Do not give food or drink if patient is unconscious.",
            "If unconscious — call emergency services immediately.",
            "If glucagon kit available — inject into thigh or upper arm.",
            "Lay unconscious patient in recovery position.",
            "Recheck patient in 15 minutes — if no improvement call emergency services.",
            "Note any medications patient takes and report to emergency team.",
        ],
        "reference": "WHO ETAT 2016 Hypoglycaemia; IDF Clinical Practice Guidelines 2021",
        "keywords": ["hypoglycaemia", "hypoglycemia", "diabetes", "dka", "low_blood_sugar", "insulin", "glucose"],
    },
    {
        "condition": "seizure",
        "display_name": "Seizure / Convulsion",
        "priority": "urgent",
        "triage_color": "yellow",
        "steps": [
            "Do NOT restrain the patient — clear all objects from the area around them.",
            "Time the seizure from onset — call EMS immediately if it exceeds 5 minutes.",
            "Protect the head with something soft — a cushion or folded clothing.",
            "Turn patient gently onto their side after convulsions stop.",
            "Do NOT put anything in the mouth — the tongue cannot be swallowed.",
            "Loosen tight clothing around the neck.",
            "Stay with the patient until they are fully conscious and oriented.",
            "If this is the patient's first-ever seizure: take to hospital immediately.",
            "After seizure: monitor breathing and maintain the recovery position.",
        ],
        "reference": "WHO ETAT 2016 Convulsions; Epilepsy Foundation First Aid 2017",
        "keywords": ["seizure", "convulsion", "epilepsy", "fit", "status_epilepticus", "shaking"],
    },
    {
        "condition": "drowning",
        "display_name": "Drowning",
        "priority": "immediate",
        "triage_color": "red",
        "steps": [
            "Remove patient from water safely — do not risk rescuer drowning.",
            "Call emergency services immediately.",
            "Check for breathing — if absent begin CPR immediately.",
            "Give 5 rescue breaths first before beginning chest compressions.",
            "Continue CPR until emergency services arrive.",
            "Keep patient warm — drowning victims lose heat rapidly.",
            "All drowning patients must go to hospital even if they seem recovered.",
        ],
        "reference": "WHO ETAT 2016; ERC Drowning Guidelines 2021",
        "keywords": ["drowning", "near_drowning", "submersion", "water_rescue"],
    },
    {
        "condition": "poisoning",
        "display_name": "Poisoning / Toxic Ingestion",
        "priority": "urgent",
        "triage_color": "yellow",
        "steps": [
            "Call poison control and emergency services immediately.",
            "Identify the poison if possible — keep container for emergency team.",
            "Do not induce vomiting unless specifically told to by poison control.",
            "If patient is unconscious place in recovery position.",
            "If poison is on skin or eyes — flush with large amounts of water.",
            "Do not give food, water, or milk unless told to by poison control.",
            "Monitor breathing and consciousness every minute.",
        ],
        "reference": "WHO Model Formulary 2010 Poisoning; Goldfrank's 10th ed.",
        "keywords": ["poisoning", "overdose", "toxic", "ingestion", "pesticide", "drug_overdose"],
    },
    {
        "condition": "heat_stroke",
        "display_name": "Heat Stroke",
        "priority": "urgent",
        "triage_color": "yellow",
        "steps": [
            "Move patient to coolest available place immediately.",
            "Remove excess clothing.",
            "Cool patient rapidly — wet cloths on neck, armpits, and groin.",
            "Fan patient vigorously while applying wet cloths.",
            "Give cool water to drink if patient is fully conscious.",
            "Call emergency services — heat stroke is life-threatening.",
            "Do not give aspirin or paracetamol — they do not help heat stroke.",
        ],
        "reference": "WHO Environmental Health 2009; Bouchama & Knochel NEJM 2002",
        "keywords": ["heat_stroke", "hyperthermia", "heat_exhaustion", "sunstroke"],
    },
    {
        "condition": "hypothermia",
        "display_name": "Hypothermia",
        "priority": "urgent",
        "triage_color": "yellow",
        "steps": [
            "Move patient to warm dry shelter immediately.",
            "Remove all wet clothing carefully.",
            "Wrap patient in blankets including the head — leave face exposed.",
            "Give warm sweet drinks only if patient is fully conscious.",
            "Do not rub limbs — this pushes cold blood to the heart.",
            "Do not apply direct heat — use body warmth and blankets only.",
            "Call emergency services for severe hypothermia or unconsciousness.",
        ],
        "reference": "ERC Hypothermia Guidelines 2021; Paal et al. Scand J Trauma 2016",
        "keywords": ["hypothermia", "cold_exposure", "frostbite", "freezing"],
    },
    {
        "condition": "chest_pain",
        "display_name": "Acute Chest Pain (Suspected ACS)",
        "priority": "immediate",
        "triage_color": "red",
        "steps": [
            "Have patient stop all activity and sit or lie down immediately.",
            "Loosen any tight clothing around chest and neck.",
            "Call emergency services immediately — do not leave the patient alone.",
            "If conscious and not allergic to aspirin: give 300mg aspirin to CHEW (not swallow).",
            "Administer oxygen if available and SpO2 < 94%.",
            "Monitor breathing every 2 minutes — do not give food or water.",
            "Be prepared to perform CPR — have AED ready if available.",
            "If patient loses consciousness and stops breathing: begin CPR immediately.",
            "Document onset time, character, radiation, diaphoresis, nausea, dyspnoea.",
        ],
        "reference": "WHO CVD Guidelines 2016; ESC STEMI Guidelines 2018",
        "keywords": ["chest_pain", "heart_attack", "acs", "myocardial_infarction", "mi", "stemi", "angina"],
    },
    {
        "condition": "difficulty_breathing",
        "display_name": "Acute Respiratory Distress",
        "priority": "immediate",
        "triage_color": "red",
        "steps": [
            "Sit patient fully upright — never lay flat; forward-leaning tripod position if needed.",
            "Loosen all clothing around chest and neck immediately.",
            "Call emergency services if no improvement within 3 minutes.",
            "For known asthma: give prescribed inhaler immediately — 4 puffs via spacer.",
            "For allergic reaction with breathing difficulty: give epinephrine if available.",
            "Give oxygen if available: 10–15 L/min via non-rebreather mask.",
            "Keep patient calm — anxiety and panic significantly worsen breathing.",
            "Monitor SpO2 if pulse oximeter available — below 94% is danger threshold.",
            "Be prepared to initiate CPR if breathing stops.",
        ],
        "reference": "WHO ETAT 2016 Respiratory Signs; BTS Emergency O2 Guidelines 2017",
        "keywords": ["difficulty_breathing", "dyspnoea", "respiratory_distress", "asthma", "copd", "breathless"],
    },
    {
        "condition": "unconscious_patient",
        "display_name": "Unconscious Patient",
        "priority": "immediate",
        "triage_color": "red",
        "steps": [
            "Check for response — tap shoulder firmly and shout the patient's name.",
            "Call emergency services immediately.",
            "Open airway: tilt head back and lift chin (jaw-thrust only if trauma suspected).",
            "Check breathing: look, listen, and feel for 10 seconds.",
            "If not breathing: begin CPR — 30 chest compressions then 2 rescue breaths.",
            "If breathing: place in recovery position on their side.",
            "Do not leave the patient — monitor and re-assess every minute.",
            "Attach AED as soon as available and follow voice prompts.",
        ],
        "reference": "WHO ETAT 2016 Ch.2; ILCOR BLS 2020",
        "keywords": ["unconscious", "unresponsive", "coma", "collapse", "found_down"],
    },
    {
        "condition": "eye_injury",
        "display_name": "Eye Injury",
        "priority": "delayed",
        "triage_color": "yellow",
        "steps": [
            "Do not rub or apply pressure to the injured eye.",
            "If chemical in eye — flush immediately with clean water for 20 minutes.",
            "If object in eye — do not try to remove it.",
            "Cover eye loosely with clean cloth or eye shield.",
            "Cover the UNINJURED eye too — both eyes move together.",
            "Seek emergency care immediately for any penetrating eye injury.",
            "Keep patient calm and as still as possible.",
        ],
        "reference": "WHO Prevention of Blindness; ATLS 10th ed. Ocular Trauma",
        "keywords": ["eye_injury", "chemical_eye", "foreign_body_eye", "corneal", "hyphema"],
    },
    {
        "condition": "snake_bite",
        "display_name": "Snakebite",
        "priority": "urgent",
        "triage_color": "yellow",
        "steps": [
            "Keep patient completely still — movement spreads venom faster.",
            "Immobilise bitten limb at or below heart level.",
            "Remove watches, rings, and tight items near bite site.",
            "Mark the edge of swelling with pen and note the time every 15 minutes.",
            "Call emergency services immediately — antivenom may be needed.",
            "Do not cut the wound, suck out venom, apply tourniquet, or use ice.",
            "Identify the snake if safely possible — photograph from a safe distance.",
        ],
        "reference": "WHO Snakebite Envenomation Guidelines 2019",
        "keywords": ["snake_bite", "snakebite", "envenomation", "venom", "antivenom"],
    },
    {
        "condition": "obstetric_emergency",
        "display_name": "Obstetric Emergency",
        "priority": "immediate",
        "triage_color": "red",
        "steps": [
            "Call emergency services immediately — do not attempt home delivery alone.",
            "Keep mother calm, warm, and lying on her left side.",
            "If birth is imminent — prepare clean surface, towels, and warm environment.",
            "Do not pull on baby or cord under any circumstances.",
            "If cord comes out before baby — keep cord moist and call immediately.",
            "After delivery — keep baby warm on mother's chest immediately.",
            "Monitor mother for severe bleeding after delivery.",
        ],
        "reference": "WHO ETAT 2016 Obstetric Emergencies; WHO PPH Recommendations 2012",
        "keywords": ["obstetric_emergency", "postpartum_haemorrhage", "eclampsia", "cord_prolapse", "labour"],
    },
]


def _build_index() -> None:
    for p in _PROTOCOL_LIST:
        key = p["condition"]
        _PROTOCOLS[key] = p
        for kw in p.get("keywords", []):
            _PROTOCOLS.setdefault(kw, p)


_build_index()


def get_who_protocol(condition: str) -> dict:
    """Return WHO/ATLS protocol for a condition.

    Lookup order:
    1. Exact key match in in-memory index (fast, always works).
    2. Partial keyword scan (handles synonyms).
    3. Firestore (if GCP credentials are available).
    4. Generic fallback.
    """
    key = condition.strip().lower().replace(" ", "_").replace("-", "_")

    # 1. In-memory exact match
    if key in _PROTOCOLS:
        logger.info("Protocol found in-memory: %s", key)
        return _PROTOCOLS[key]

    # 2. Partial keyword scan
    for k, proto in _PROTOCOLS.items():
        if key in k or k in key:
            logger.info("Protocol partial-match: %s → %s", key, proto["condition"])
            return proto

    # 3. Firestore fallback (optional — only when GCP credentials present)
    try:
        from google.cloud import firestore as _fs  # noqa: PLC0415
        db = _fs.Client()
        doc = db.collection("who_protocols").document(key).get()
        if doc.exists:
            logger.info("Protocol from Firestore: %s", key)
            return doc.to_dict()
        results = (
            db.collection("who_protocols")
            .where("keywords", "array_contains", condition.lower())
            .limit(1)
            .get()
        )
        if results:
            logger.info("Protocol from Firestore keyword search: %s", key)
            return results[0].to_dict()
    except Exception as exc:
        logger.debug("Firestore unavailable (%s) — using in-memory only", exc)

    # 4. Generic fallback
    logger.warning("No protocol found for: %s — returning generic fallback", key)
    return {
        "condition": condition,
        "display_name": condition.replace("_", " ").title(),
        "priority": "immediate",
        "triage_color": "red",
        "steps": [
            "Call emergency services immediately.",
            "Keep patient still and calm.",
            "Monitor breathing and pulse.",
            "Do not give food or water.",
        ],
        "reference": "WHO ETAT 2016",
    }


SYSTEM_INSTRUCTION = """You are MedVision — a real-time emergency medical AI assistant.
You watch the camera and listen to the microphone simultaneously.

═══════════════════════════════════════
CORE IDENTITY
═══════════════════════════════════════

You are NOT a chatbot. You are an emergency triage officer.
You do NOT give disclaimers or filler phrases.
You OBSERVE, IDENTIFY, ACT — in that order, every time.

═══════════════════════════════════════
LISTEN FIRST — SPEAK SECOND
═══════════════════════════════════════

Your default state is SILENCE.
You only speak when:
  1. You clearly see a symptom in the camera
  2. The user finishes speaking
  3. A dangerous condition is confirmed

When the user is speaking — STOP and LISTEN completely.
Never interrupt the user mid-sentence.
After you finish speaking — WAIT for the user to respond.

CORRECT behaviour:
  Agent: "Chest pain confirmed. Two immediate steps —
          One: sit the patient down. Two: loosen clothing.
          Do you need the remaining steps?"
  (then WAIT silently for user response)

WRONG behaviour:
  Agent: "Step 1... Step 2... Step 3... Step 4... also Step 5..."
  (user cannot speak)

═══════════════════════════════════════
RESPONSE LENGTH RULES — STRICTLY FOLLOW
═══════════════════════════════════════

First response after detecting ANY condition:
  → Maximum 3 sentences
  → State condition, state severity, give first 2 steps only
  → Then STOP and wait

Only give more steps when user asks for them.
Never give all 7 steps without being asked.

Perfect first response example:
"I can see the patient holding their chest — this is chest pain, URGENT.
Step one: have them sit down and stop all activity immediately.
Step two: loosen any tight clothing around the chest and neck.
Do you want the next steps?"

═══════════════════════════════════════
TURN-TAKING RULES
═══════════════════════════════════════

After you speak — enter LISTENING mode immediately.
You get ONE speaking turn, then the user gets ONE speaking turn.

If user says "next steps" or "continue" → give next 2 steps only, then wait.
If user says "what else"              → give 1 more piece of information, then wait.
If user says "repeat"                 → repeat only the last thing you said.
If no speech for 8 seconds            → ask ONE short question only.

═══════════════════════════════════════
VISUAL DETECTION DICTIONARY
═══════════════════════════════════════

When you see any of these in the camera — speak immediately:

BODY SIGNAL                            CONDITION              SEVERITY
────────────────────────────────────────────────────────────────────
Hand pressed on chest                  chest_pain             URGENT
Hand on chest + pale face              cardiac_arrest         IMMEDIATE
Both hands on throat                   choking                IMMEDIATE
Lips turning blue                      choking                IMMEDIATE
Rapid visible chest rising             difficulty_breathing   IMMEDIATE
Forward lean + neck muscles straining  difficulty_breathing   URGENT
Full body convulsing                   seizure                IMMEDIATE
Eyes rolled back                       seizure                IMMEDIATE
Both hands holding head or temples     head_injury            URGENT
Head drooping + eyes closing           unconscious_patient    IMMEDIATE
Complete limpness                      unconscious_patient    IMMEDIATE
Slumped posture + no response          unconscious_patient    IMMEDIATE
Red swollen face + visible hives       anaphylaxis            IMMEDIATE
Scratching throat + swollen lips       anaphylaxis            IMMEDIATE
Holding stomach + doubled over         poisoning              URGENT
Unsteady balance + confused look       stroke                 IMMEDIATE
Face drooping on one side              stroke                 IMMEDIATE
Cradling arm or leg carefully          fractures              DELAYED
Holding or covering eye area           eye_injury             DELAYED
Sweating + pale + shaking              diabetic_emergency     URGENT
Flushed red face + touching forehead   heat_stroke            URGENT
Shivering + blue lips + slow movement  hypothermia            URGENT
Heavily pregnant + visible distress    obstetric_emergency    IMMEDIATE

You do not need audio confirmation to speak about visual symptoms.
Keep your response SHORT — follow the 3-sentence rule above.

If the image is dark or unclear: ask once — "Can you improve the lighting or move closer?"

═══════════════════════════════════════
AUDIO DETECTION DICTIONARY
═══════════════════════════════════════

KEYWORD HEARD                          CONDITION TO TRIGGER
───────────────────────────────────────────────────────────────
chest pain / chest tightness           chest_pain
can’t breathe / breathless             difficulty_breathing
not breathing / stopped breathing      cardiac_arrest
choking / can’t swallow                choking
unconscious / not responding           unconscious_patient
seizure / convulsing / shaking         seizure
allergic / swelling / rash             anaphylaxis
head injury / hit head / dizzy         head_injury
stroke / face drooping / slurred       stroke
bleeding / blood / cut                 severe_bleeding
burn / fire / scalded                  burns
broken / fracture / can’t move         fractures
diabetic / sugar / insulin             diabetic_emergency
poisoned / swallowed / overdose        poisoning
snake bite / bitten                    snake_bite
pregnant / labour / contractions       obstetric_emergency
heat / sun / overheated                heat_stroke
cold / freezing / hypothermia          hypothermia
drowning / water / submerged           drowning

═══════════════════════════════════════
CONFIDENCE SCORING
═══════════════════════════════════════

SCORE 3 — MAXIMUM (audio AND visual both confirm same condition)
  → State condition immediately + first 2 steps + severity
  → Generate triage card
  → Wait for user
  Example: "CONFIRMED: I see [visual] and hear [audio]. This is [condition], [SEVERITY].
  Step one: [action]. Step two: [action]. Do you want more steps?"

SCORE 2 — HIGH (one strong signal)
  → State what you see/hear + ask ONE confirming question
  Example: "HIGH PROBABILITY: I can see [visual]. This appears to be [condition].
  Can you confirm — is the patient [specific yes/no question]?"

SCORE 1 — LOW (weak or ambiguous signal)
  → Describe exactly what you observe + ask one targeted question
  Never give a wrong protocol — ask first.

═══════════════════════════════════════
TRIAGE CARD — GENERATE SILENTLY
═══════════════════════════════════════

Generate the triage card in the background — do NOT read it aloud.
The frontend displays it automatically. Just output the marker block.

[TRIAGE_CARD]{"condition":"condition_name","priority":"immediate|urgent|delayed","steps":["step1","step2","step3","step4","step5"],"reference":"WHO ETAT 2016","timestamp":"CURRENT_ISO_TIMESTAMP"}[/TRIAGE_CARD]

Generate this after every confirmed condition. Never read it aloud.

═══════════════════════════════════════
SEVERITY LEVELS
═══════════════════════════════════════

IMMEDIATE → life-threatening, seconds matter
            cardiac_arrest, choking, severe_bleeding,
            anaphylaxis, unconscious_patient, difficulty_breathing severe

URGENT    → serious, needs treatment within 30 minutes
            chest_pain, stroke, head_injury, seizure,
            burns, snake_bite, obstetric_emergency

DELAYED   → stable, can wait
            minor fractures, eye_injury minor, heat_stroke mild

═══════════════════════════════════════
GREETING — ONCE ONLY
═══════════════════════════════════════

Say this once at session start, then go completely silent:
"MedVision ready. Camera and microphone active.
Show me the patient or describe the emergency."

Do not speak again until you detect a symptom or the user speaks.

═══════════════════════════════════════
WHAT NEVER TO SAY
═══════════════════════════════════════

Never say more than 3 sentences before pausing
Never read all 7 steps without user asking
Never say "As I was saying..." or repeat previous turns
Never say "Let me also mention..." to extend your speaking turn
Never use filler words: "Certainly", "Of course", "Absolutely"
Never say "I cannot see clearly" → describe what you CAN see
Never say "Please consult a doctor" → you are the emergency guidance
Never introduce yourself more than once per session

═══════════════════════════════════════
LANGUAGE
═══════════════════════════════════════

Respond in whatever language the user speaks.
Detect from the very first word. Never mix languages in one response."""

_LANGUAGE_NAMES: dict[str, str] = {
    "en": "English",
    "es": "Spanish",
    "fr": "French",
    "ar": "Arabic",
    "hi": "Hindi",
    "zh": "Chinese (Mandarin)",
    "sw": "Swahili",
    "ta": "Tamil",
    "pt": "Portuguese",
    "ru": "Russian",
}


def build_system_instruction(lang: str = "en") -> str:
    """Return SYSTEM_INSTRUCTION with a hard language constraint injected."""
    lang_name = _LANGUAGE_NAMES.get(lang, "English")
    base = SYSTEM_INSTRUCTION.replace(
        "Respond in whatever language the user speaks.",
        f"You MUST respond ONLY in {lang_name} for this entire session. Every word you speak must be in {lang_name}.",
    )
    if lang != "en":
        base += f"\n\nCRITICAL LANGUAGE RULE: All guidance, triage cards, and responses MUST be delivered in {lang_name} only. Do not switch languages under any circumstance."
    return base

