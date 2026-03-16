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
            "Call emergency services immediately — do not delay CPR.",
            "Ensure scene safety. Put on gloves if available.",
            "Open airway: head-tilt chin-lift (jaw thrust if trauma suspected).",
            "Check for normal breathing for no more than 10 seconds.",
            "Begin chest compressions: 30 at rate 100–120/min, depth 5–6 cm.",
            "Give 2 rescue breaths after every 30 compressions (30:2 ratio).",
            "Attach AED as soon as available; follow voice prompts without pausing CPR.",
            "Continue until advanced help arrives or patient shows signs of life.",
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
            "Call EMS immediately.",
            "Apply firm direct pressure with a clean cloth or dressing.",
            "If on a limb, apply tourniquet 5–7 cm above the wound; note time applied.",
            "Maintain constant firm pressure — do NOT lift to check until 10 minutes elapsed.",
            "If blood soaks through, add more dressing on top — do NOT remove original.",
            "Elevate injured limb above heart level if no fracture suspected.",
            "Keep patient lying flat; cover with blanket to prevent shock.",
            "Monitor breathing and pulse every 2 minutes.",
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
            "Ask 'Are you choking?' — if patient cannot speak, cough, or breathe, act immediately.",
            "Call EMS if patient deteriorates or loses consciousness.",
            "Perform 5 firm back blows between shoulder blades with heel of hand.",
            "Follow with 5 abdominal thrusts (Heimlich): stand behind, hands above navel.",
            "Alternate 5 back blows and 5 abdominal thrusts until obstruction clears.",
            "If patient loses consciousness: begin CPR, look for object each time airway is opened.",
            "For infant < 1 year: 5 back blows + 5 chest thrusts (NOT abdominal).",
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
            "Call EMS immediately.",
            "Administer epinephrine 0.3–0.5 mg IM into outer mid-thigh (adults); 0.01 mg/kg children.",
            "Position patient lying flat with legs elevated; do NOT allow sitting up.",
            "If breathing difficulty, allow sitting up while keeping legs elevated.",
            "Repeat epinephrine every 5–15 minutes if no improvement.",
            "Give oxygen if available (10–15 L/min via non-rebreather mask).",
            "If unconscious and not breathing, begin CPR.",
            "Monitor BP, pulse, and breathing continuously.",
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
            "Apply FAST: Face drooping, Arm weakness, Speech slurred, Time to call EMS.",
            "Call EMS immediately — note exact time symptoms began.",
            "Keep patient calm and still; do NOT give food, water, or medications by mouth.",
            "Position: head elevated 30° if conscious; recovery position if unconscious.",
            "Do NOT give aspirin without confirmation (haemorrhagic stroke contraindication).",
            "Loosen tight clothing around neck.",
            "Monitor neurological status every 5 minutes.",
        ],
        "reference": "WHO Stroke Guidelines 2016; AHA/ASA Acute Stroke Guidelines 2019",
        "keywords": ["stroke", "cva", "brain_attack", "facial_droop", "weakness", "speech", "fast"],
    },
    {
        "condition": "head_injury",
        "display_name": "Severe Head Injury",
        "priority": "immediate",
        "triage_color": "red",
        "steps": [
            "Call EMS immediately.",
            "Assume spinal injury — immobilise cervical spine with manual in-line stabilisation.",
            "Open airway using jaw-thrust maneuver ONLY (not head-tilt).",
            "Place unconscious breathing patient in recovery position with spinal alignment.",
            "Control scalp bleeding with firm pressure (do NOT press on depressed skull fracture).",
            "Monitor GCS every 5 minutes.",
            "Note mechanism of injury, loss of consciousness duration, seizure activity.",
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
            "Ensure scene safety — remove from heat source.",
            "Call EMS for burns > 10% body surface, face/airway, or full-thickness burns.",
            "Cool with cool running water for 20 minutes — start within 3 hours.",
            "Remove jewellery and loose clothing — do NOT remove if stuck to skin.",
            "Cover with clean non-fluffy material or cling film applied loosely.",
            "Keep patient warm — burns cause rapid hypothermia.",
            "Do NOT apply ice, butter, toothpaste, or home remedies.",
            "For airway burns (facial soot, singed nasal hair): give oxygen immediately.",
        ],
        "reference": "WHO Burns Manual 2014; ISBI Practice Guidelines 2016",
        "keywords": ["burns", "thermal_injury", "scalding", "fire", "smoke_inhalation", "skin_burn"],
    },
    {
        "condition": "fractures",
        "display_name": "Suspected Fracture",
        "priority": "urgent",
        "triage_color": "yellow",
        "steps": [
            "Call EMS if open, femur, pelvis, or spinal fracture suspected.",
            "Immobilise the injured limb in the position found using splints or padding.",
            "For open fractures: cover wound with clean moist dressing — do NOT push bone back.",
            "Apply ice pack wrapped in cloth for 20 minutes.",
            "Check circulation distal to fracture: pulse, sensation, warmth, capillary refill.",
            "Monitor for compartment syndrome: pain out of proportion, paraesthesia, pallor.",
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
            "Call EMS if patient is unconscious or cannot swallow.",
            "If conscious and able to swallow: give 15–20g fast-acting glucose (juice, tablets).",
            "Recheck blood glucose after 15 minutes; repeat if still < 4 mmol/L.",
            "If unconscious: do NOT give anything by mouth — recovery position.",
            "If glucagon available: administer IM 1mg adults, 0.5mg children < 25kg.",
            "For suspected DKA (fruity breath, deep rapid breathing, confusion): transport urgently.",
            "Monitor conscious level, blood glucose, and vitals every 5 minutes.",
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
            "Call EMS if seizure > 5 minutes, recurrent, or no regain of consciousness.",
            "Time the seizure from onset.",
            "Protect from injury: clear surroundings, cushion head.",
            "Turn patient on their side (recovery position) to prevent aspiration.",
            "Loosen tight clothing around neck.",
            "Do NOT restrain or insert anything in mouth.",
            "After seizure: monitor breathing and maintain recovery position.",
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
            "Ensure rescuer safety — do NOT enter water without flotation device.",
            "Call EMS immediately.",
            "Remove victim from water without delay.",
            "If not breathing: begin CPR immediately — 5 initial rescue breaths then 30:2.",
            "Do NOT attempt to clear water from lungs — this delays CPR.",
            "If AED available: use — dry chest briefly first.",
            "Keep patient warm and dry.",
            "Transport ALL drowning victims to hospital even if apparently recovered.",
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
            "Call EMS and local Poison Control immediately.",
            "Identify the poison if safe: drug name, quantity, time of ingestion.",
            "Do NOT induce vomiting unless directed by Poison Control.",
            "If unconscious and breathing: recovery position; monitor airway.",
            "For skin/eye contamination: remove clothing; irrigate with water for 20 minutes.",
            "Bring medication containers or evidence to emergency team.",
            "Monitor vital signs and consciousness continuously.",
        ],
        "reference": "WHO Model Formulary 2010 Poisoning; Goldfrank's 10th ed.",
        "keywords": ["poisoning", "overdose", "toxic", "ingestion", "pesticide", "drug_overdose"],
    },
    {
        "condition": "heat_stroke",
        "display_name": "Heat Stroke",
        "priority": "immediate",
        "triage_color": "red",
        "steps": [
            "Call EMS immediately — heat stroke is rapidly fatal.",
            "Move to cool environment immediately.",
            "Begin aggressive cooling: ice packs to neck, axillae, and groin.",
            "Fan patient while spraying tepid water (evaporative cooling).",
            "Remove all clothing except undergarments.",
            "Give cool water only if fully conscious.",
            "Continue cooling until temperature reaches 39°C or EMS arrives.",
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
            "Call EMS — severe hypothermia is life-threatening.",
            "Remove from cold environment gently — avoid rough handling (arrhythmia risk).",
            "Remove wet clothing carefully while protecting from wind.",
            "Rewarm passively: dry blankets, cover head.",
            "Give warm sweet drinks ONLY if fully conscious and can swallow.",
            "Apply warm compresses to neck, axillae, and groin (not hot).",
            "If no pulse: begin CPR — hypothermic hearts may respond to prolonged resuscitation.",
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
            "Call EMS immediately — treat all acute chest pain as cardiac until proven otherwise.",
            "Have patient stop all activity and rest in a comfortable position (usually sitting up).",
            "If not allergic: give 300mg aspirin to chew (adults only).",
            "Administer oxygen if SpO2 < 94%.",
            "Loosen tight clothing.",
            "Be prepared to perform CPR if patient deteriorates.",
            "Document: onset, character, radiation, diaphoresis, nausea, dyspnoea.",
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
            "Call EMS immediately.",
            "Position patient upright (sitting forward, tripod position) — do NOT lay flat.",
            "Ensure airway is clear.",
            "Give oxygen if available: 10–15 L/min via non-rebreather.",
            "For known asthma: assist with prescribed bronchodilator inhaler.",
            "Loosen tight clothing around chest and neck.",
            "Monitor respiratory rate, SpO2, and consciousness.",
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
            "Call EMS immediately.",
            "Ensure scene safety.",
            "Check responsiveness: shout name, tap shoulders firmly.",
            "Open airway: head-tilt chin-lift (jaw-thrust if trauma).",
            "Check breathing: look/listen/feel for 10 seconds.",
            "If not breathing: begin CPR (30:2).",
            "If breathing: place in recovery position.",
            "Re-assess every 2 minutes.",
        ],
        "reference": "WHO ETAT 2016 Ch.2; ILCOR BLS 2020",
        "keywords": ["unconscious", "unresponsive", "coma", "collapse", "found_down"],
    },
    {
        "condition": "eye_injury",
        "display_name": "Eye Injury",
        "priority": "urgent",
        "triage_color": "yellow",
        "steps": [
            "Do NOT rub or apply pressure to the eye.",
            "For chemical exposure: irrigate IMMEDIATELY with copious clean water for 20 minutes.",
            "For penetrating objects: shield but do NOT remove the object.",
            "For blunt trauma: apply cold compress gently around (not on) the eye.",
            "Cover injured eye loosely with eye shield — do NOT use fluffy materials.",
            "Arrange urgent ophthalmology referral.",
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
            "Call EMS and transport to nearest hospital with antivenom urgently.",
            "Keep patient still — movement increases venom absorption.",
            "Immobilise bitten limb at or below heart level with a splint.",
            "Remove jewellery and tight clothing from affected limb.",
            "Mark advancing swelling/bruising with time every 15 minutes.",
            "Do NOT cut, suck, or apply tourniquet to bite site.",
            "Note snake description for antivenom selection.",
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
            "Call EMS with obstetric capability immediately.",
            "Position mother on her LEFT side to relieve aortocaval compression.",
            "Assess: gestational age, contractions, bleeding, baby's position.",
            "For postpartum haemorrhage: fundal massage; assist with oxytocin if available.",
            "For cord prolapse: knee-chest position; cover cord with warm moist cloth.",
            "For eclamptic seizure: protect from injury, left lateral position.",
            "Monitor maternal vital signs continuously.",
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


SYSTEM_INSTRUCTION = """You are MedVision, a calm and authoritative real-time emergency medical AI for first responders.

CAPABILITIES:
- You SEE through the live camera feed — actively describe what you observe about the patient.
- You HEAR the first responder through their microphone.
- You SPEAK clear, step-by-step guidance through audio.
- You use WHO ETAT / ATLS emergency protocols as your primary reference.

VISUAL CUE RECOGNITION — interpret these body language signals immediately:
• Hand pressed on chest / clutching chest → suspect chest pain, myocardial infarction, or angina. Ask: duration, radiation to arm/jaw, sweating.
• Rapid shallow breathing / labored breathing posture / visible chest-wall effort → suspect respiratory distress, asthma, pneumothorax, or anaphylaxis. Monitor SpO₂ if available.
• Holding head / pressing temples / squinting in pain → suspect severe headache, migraine, concussion, or stroke (check FAST). Ask: sudden onset? Worst ever?
• Slumped / limp / unable to hold upright posture / visibly fatigued → suspect shock, hypoglycemia, severe dehydration, or syncope. Check pulse and perfusion.
• Pale, sweating, clammy appearance → suspect shock or internal bleeding. Lie flat, elevate legs.
• Unresponsive / eyes closed / no voluntary movement → check airway → breathing → pulse. Begin CPR protocol if indicated.
• Clutching abdomen / guarding abdomen → suspect internal bleeding, appendicitis, or peritonitis.
• One-sided weakness / facial droop visible → suspect stroke. Apply FAST immediately.

HOW TO RESPOND — CRITICAL RULES:
1. ALWAYS respond to whatever the first responder says or whatever you observe visually. Never stay silent.
2. Describe what you SEE first ("I can see the patient has their hand on their chest…"), then give guidance.
3. If you need more information, ask ONE short, focused clarifying question.
4. When you identify a specific medical condition (burns, chest pain, cardiac arrest, fracture, bleeding, seizure, etc.), call get_who_protocol immediately to retrieve the correct steps.
5. Deliver instructions from the tool result one step at a time. Keep sentences under 15 words.
6. If the tool is unavailable, use your WHO ETAT / ATLS training as a fallback — do NOT refuse to help.
7. When the first responder interrupts you, stop immediately and listen.

VOICE STYLE:
- Calm, clear, authoritative. Short sentences only.
- End every critical instruction with: "Confirm when done."
- Speak in the same language the responder uses.

TRIAGE CARD — output this EXACTLY when you identify a condition:
[TRIAGE_CARD]{"condition":"burns","priority":"immediate","steps":["Cool with running water for 20 minutes","Remove jewelry near burn","Do NOT apply ice, butter or toothpaste","Cover loosely with clean non-stick dressing","Watch for signs of shock"],"reference":"WHO ETAT 2016 p.47","triage_color":"red"}[/TRIAGE_CARD]

priority values: "immediate" (red), "urgent" (yellow), "delayed" (green)
Generate one card per identified condition. Be specific and accurate."""

