import asyncio
import base64
import json
import logging
import os
import uuid
from datetime import datetime, timezone

from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from google import genai
from google.genai import types

load_dotenv()

logging.basicConfig(
    level=logging.DEBUG,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)
logging.getLogger("google").setLevel(logging.INFO)
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("uvicorn").setLevel(logging.INFO)

from agent import SYSTEM_INSTRUCTION, build_system_instruction, get_who_protocol
from triage import TriageParser

try:
    from cloud_storage import save_session_log as _save_session_log
    _CLOUD_STORAGE_AVAILABLE = True
except Exception as _cs_exc:
    _CLOUD_STORAGE_AVAILABLE = False
    logger.warning("cloud_storage unavailable — session logs will not be persisted to GCS (%s)", _cs_exc)

# ── MedGemma (optional local GPU model) ───────────────────────────────────
_MEDGEMMA_ENABLED = os.environ.get("MEDGEMMA_ENABLED", "false").lower() == "true"
try:
    if _MEDGEMMA_ENABLED:
        from medgemma import MedGemmaAnalyser
        from medgemma_worker import MedGemmaWorker
        _MEDGEMMA_AVAILABLE = True
        logger.info("MedGemma module loaded OK")
    else:
        _MEDGEMMA_AVAILABLE = False
        logger.info("MedGemma disabled (MEDGEMMA_ENABLED != true)")
except Exception as _mg_exc:
    _MEDGEMMA_AVAILABLE = False
    logger.warning("MedGemma not available: %s", _mg_exc)

# ── Gemini client ──────────────────────────────────────────────────────────

GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
GOOGLE_CLOUD_PROJECT = os.environ.get("GOOGLE_CLOUD_PROJECT", "")

if not GEMINI_API_KEY:
    print("=" * 50)
    print("WARNING: GEMINI_API_KEY not set! Agent will not work.")
    print("Create backend/.env with: GEMINI_API_KEY=your_key")
    print("=" * 50)
else:
    print(f"Starting MedVision | API key SET | project={GOOGLE_CLOUD_PROJECT or 'not set'}")

MODEL = os.environ.get("AGENT_MODEL", "gemini-2.5-flash-native-audio-latest")
client = genai.Client(api_key=GEMINI_API_KEY) if GEMINI_API_KEY else None
logger.info("Gemini client initialised — model=%s", MODEL)

# ── Tool declaration ───────────────────────────────────────────────────────

get_protocol_tool = types.FunctionDeclaration(
    name="get_who_protocol",
    description="Get WHO emergency triage protocol for a medical condition",
    parameters=types.Schema(
        type=types.Type.OBJECT,
        properties={
            "condition": types.Schema(
                type=types.Type.STRING,
                description="Medical condition e.g. burns, cardiac_arrest",
            )
        },
        required=["condition"],
    ),
)

# Default config (English) — kept for backwards-compat; per-session configs created via _build_live_config()
LIVE_CONFIG = types.LiveConnectConfig(
    response_modalities=["AUDIO"],
    input_audio_transcription=types.AudioTranscriptionConfig(),
    output_audio_transcription=types.AudioTranscriptionConfig(),
    generation_config=types.GenerationConfig(temperature=0.1),
    system_instruction=types.Content(
        role="user",
        parts=[types.Part(text=SYSTEM_INSTRUCTION)],
    ),
    tools=[types.Tool(function_declarations=[get_protocol_tool])],
    speech_config=types.SpeechConfig(
        voice_config=types.VoiceConfig(
            prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name="Aoede")
        )
    ),
    realtime_input_config=types.RealtimeInputConfig(
        automatic_activity_detection=types.AutomaticActivityDetection(
            disabled=False,
        ),
        activity_handling=types.ActivityHandling.START_OF_ACTIVITY_INTERRUPTS,
    ),
)


def _build_live_config(lang: str = "en") -> types.LiveConnectConfig:
    """Create a language-aware LiveConnectConfig for each session."""
    return types.LiveConnectConfig(
        response_modalities=["AUDIO"],
        input_audio_transcription=types.AudioTranscriptionConfig(),
        output_audio_transcription=types.AudioTranscriptionConfig(),
        generation_config=types.GenerationConfig(temperature=0.1),
        system_instruction=types.Content(
            role="user",
            parts=[types.Part(text=build_system_instruction(lang))],
        ),
        tools=[types.Tool(function_declarations=[get_protocol_tool])],
        speech_config=types.SpeechConfig(
            voice_config=types.VoiceConfig(
                prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name="Aoede")
            )
        ),
        realtime_input_config=types.RealtimeInputConfig(
            automatic_activity_detection=types.AutomaticActivityDetection(
                disabled=False,
            ),
            activity_handling=types.ActivityHandling.START_OF_ACTIVITY_INTERRUPTS,
        ),
    )

# ── FastAPI app ────────────────────────────────────────────────────────────

app = FastAPI(title="MedVision API", version="2.0.0")


@app.on_event("startup")
async def _startup() -> None:
    """Initialise MedGemma worker in a background thread at startup."""
    if _MEDGEMMA_AVAILABLE:
        analyser = MedGemmaAnalyser()
        worker = MedGemmaWorker(analyser)
        app.state.medgemma_worker = worker
        app.state.medgemma_analyser = analyser
        # Load model in a thread pool so we don't block the event loop
        loop = asyncio.get_event_loop()
        try:
            await loop.run_in_executor(None, analyser.load)
            worker.start()
            logger.info("MedGemma worker started")
        except Exception as exc:
            logger.warning("MedGemma failed to load at startup: %s", exc)
    else:
        app.state.medgemma_worker = None
        app.state.medgemma_analyser = None


@app.on_event("shutdown")
async def _shutdown() -> None:
    worker = getattr(app.state, "medgemma_worker", None)
    if worker:
        worker.stop()


app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_origin_regex=".*",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health() -> dict:
    mg_analyser = getattr(app.state, "medgemma_analyser", None)
    mg_status = mg_analyser.get_status() if mg_analyser else {"ready": False, "device": None}
    return {
        "status": "ok",
        "version": "2.0.0",
        "model": MODEL,
        "medgemma": mg_status,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


@app.websocket("/live")
async def websocket_endpoint(websocket: WebSocket, lang: str = "en"):
    await websocket.accept()
    session_id = str(uuid.uuid4())
    session_start_ts = datetime.now(timezone.utc)
    session_events: list[dict] = []
    logger.info("WS accepted, session_id=%s", session_id)

    # Tell frontend we are alive immediately
    await websocket.send_json({"type": "status", "data": "backend_connected"})

    parser = TriageParser()

    if not client:
        await websocket.send_json({"type": "error", "data": "GEMINI_API_KEY not set on server"})
        await websocket.close()
        return

    try:
        await websocket.send_json({"type": "status", "data": "connecting_to_gemini"})
        logger.info("Connecting to Gemini Live model=%s", MODEL)

        live_config = _build_live_config(lang)
        async with client.aio.live.connect(model=MODEL, config=live_config) as gemini_session:
            logger.info("Gemini Live session connected OK")
            await websocket.send_json({"type": "status", "data": "gemini_connected"})

            # Fire the greeting as a single text turn BEFORE asyncio.gather so
            # receive_from_gemini() is the ONLY consumer of gemini_session.receive().
            # We do NOT await the response here — it arrives via receive_from_gemini().
            try:
                await gemini_session.send_client_content(
                    turns=[types.Content(
                        role="user",
                        parts=[types.Part(text="Session started. Briefly introduce yourself as MedVision and confirm you are ready to assist.")],
                    )],
                    turn_complete=True,
                )
                logger.info("Greeting fired — starting bidirectional loop")
            except Exception as greet_exc:
                logger.warning("Greeting failed (%s) — continuing without it", greet_exc)

            await websocket.send_json({"type": "status", "data": "Agent connected and ready"})

            async def send_to_gemini():
                """Forward browser audio / video to Gemini."""
                logger.info("send_to_gemini task started")
                last_visual_check = 0.0  # asyncio clock time of last [VISUAL_CHECK] prompt
                try:
                    while True:
                        try:
                            raw = await asyncio.wait_for(websocket.receive_text(), timeout=30.0)
                        except asyncio.TimeoutError:
                            # Send keepalive so frontend knows we are still alive
                            try:
                                await websocket.send_json({"type": "status", "data": "keepalive"})
                            except Exception:
                                break
                            continue

                        msg = json.loads(raw)
                        msg_type = msg.get("type")

                        if msg_type in ("audio", "audio_chunk"):
                            audio_bytes = base64.b64decode(msg["data"])
                            print(f"[DEBUG] Audio received: {len(audio_bytes)} bytes")
                            await gemini_session.send_realtime_input(
                                audio=types.Blob(data=audio_bytes, mime_type="audio/pcm;rate=16000")
                            )
                            logger.debug("Sent audio chunk: %d bytes", len(audio_bytes))

                        elif msg_type in ("video", "video_frame"):
                            image_bytes = base64.b64decode(msg["data"])
                            print(f"[DEBUG] Video frame received: {len(image_bytes)} bytes")
                            # Send image + descriptive prompt together so Gemini
                            # analyses the frame rather than ignoring it.
                            await gemini_session.send_realtime_input(
                                video=types.Blob(data=image_bytes, mime_type="image/jpeg")
                            )
                            logger.debug("Sent video frame: %d bytes", len(image_bytes))

                            # ── MedGemma parallel analysis ─────────────────────
                            mg_worker = getattr(app.state, "medgemma_worker", None)
                            if mg_worker:
                                mg_worker.submit_frame(image_bytes)
                                mg_result = mg_worker.get_result()
                                if mg_result and mg_result.get("condition") not in (None, "none_detected"):
                                    # Forward detection to frontend for UI update
                                    await websocket.send_json({
                                        "type": "visual_detection",
                                        "data": mg_result,
                                    })
                                    # Also surface as a Gemini cue so the voice agent is aware
                                    cue = (
                                        f"[MEDGEMMA_DETECTION] condition={mg_result['condition']} "
                                        f"confidence={mg_result['confidence']} "
                                        f"severity={mg_result['severity']} "
                                        f"observation={mg_result['observation']}"
                                    )
                                    try:
                                        await gemini_session.send_client_content(
                                            turns=[types.Content(
                                                role="user",
                                                parts=[types.Part(text=cue)],
                                            )],
                                            turn_complete=True,
                                        )
                                    except Exception as mg_cue_exc:
                                        logger.debug("MedGemma cue failed: %s", mg_cue_exc)

                            # Every 4 seconds, send a [VISUAL_CHECK] so the agent
                            # proactively analyzes what it sees and speaks about symptoms.
                            now = asyncio.get_event_loop().time()
                            if now - last_visual_check >= 4.0:
                                last_visual_check = now
                                try:
                                    await gemini_session.send_client_content(
                                        turns=[types.Content(
                                            role="user",
                                            parts=[
                                                types.Part(text=(
                                                    "[VISUAL_CHECK] Examine this camera frame carefully. "
                                                    "Scan for: hand on chest, hands on throat, rapid breathing, "
                                                    "head holding, body slumping, full-body shaking, "
                                                    "pale or flushed face, holding abdomen, cradling a limb. "
                                                    "If you see any of these — name it immediately and follow your protocol. "
                                                    "If nothing significant is visible, say so briefly and wait."
                                                )),
                                            ],
                                        )],
                                        turn_complete=True,
                                    )
                                    logger.info("Visual check prompt sent")
                                except Exception as ve:
                                    logger.debug("Visual check failed: %s", ve)

                        elif msg_type == "user_speech_start":
                            # User started speaking — interrupt agent's current output
                            logger.info("user_speech_start received — interrupting agent")
                            try:
                                await gemini_session.send_client_content(
                                    turns=[types.Content(role="user", parts=[types.Part(text="[interrupted]")])],
                                    turn_complete=True,
                                )
                            except Exception as iex:
                                logger.debug("Interrupt on speech_start failed: %s", iex)

                        elif msg_type == "user_speech_end":
                            # User finished speaking — Gemini will naturally respond
                            # to the audio chunks that arrived before this message.
                            logger.info("user_speech_end received")

                        elif msg_type == "interrupt":
                            await gemini_session.send_client_content(
                                turns=[types.Content(role="user", parts=[types.Part(text="[interrupted]")])],
                                turn_complete=True,
                            )
                            logger.info("Interrupt sent to Gemini")

                        elif msg_type == "text":
                            text = msg.get("data", "")
                            await gemini_session.send_client_content(
                                turns=[types.Content(role="user", parts=[types.Part(text=text)])],
                                turn_complete=True,
                            )
                            logger.info("Text sent: %s", text[:80])

                        elif msg_type == "end_session":
                            logger.info("end_session requested")
                            break

                        else:
                            logger.debug("Unknown message type: %s", msg_type)

                except WebSocketDisconnect:
                    logger.info("Client disconnected: %s", session_id)
                except Exception as exc:
                    logger.error("send_to_gemini error: %s", exc, exc_info=True)

            async def receive_from_gemini():
                """Forward Gemini responses to browser.

                IMPORTANT: gemini_session.receive() in the google-genai SDK yields
                messages for ONE turn only — the async-for loop exits when the server
                sends turn_complete.  We wrap it in `while True` so every subsequent
                user turn is also handled.
                """
                logger.info("receive_from_gemini task started")
                try:
                    while True:
                        logger.info("receive_from_gemini: waiting for next turn …")
                        async for response in gemini_session.receive():
                            try:
                                logger.info("Gemini event: %s", type(response).__name__)

                                # ── Tool calls ───────────────────────────────────────
                                if response.tool_call and response.tool_call.function_calls:
                                    for fc in response.tool_call.function_calls:
                                        logger.info("Tool call: %s(%s)", fc.name, fc.args)
                                        if fc.name == "get_who_protocol":
                                            result = get_who_protocol(fc.args.get("condition", "unknown"))
                                            await gemini_session.send_tool_response(
                                                function_responses=[
                                                    types.FunctionResponse(
                                                        name=fc.name,
                                                        id=fc.id,
                                                        response={"result": result},
                                                    )
                                                ]
                                            )
                                            logger.info("Tool response sent: %s", fc.name)

                                # ── Server content (audio + text) ────────────────────
                                if response.server_content:
                                    sc = response.server_content

                                    if sc.model_turn:
                                        for part in sc.model_turn.parts:
                                            if getattr(part, "inline_data", None) and part.inline_data.data:
                                                await websocket.send_json({
                                                    "type": "audio_chunk",
                                                    "data": base64.b64encode(part.inline_data.data).decode(),
                                                })
                                                logger.debug("Audio chunk: %d bytes", len(part.inline_data.data))

                                            elif getattr(part, "text", None):
                                                cards = parser.process(part.text)
                                                clean = parser.clean(part.text)
                                                if clean.strip():
                                                    await websocket.send_json({
                                                        "type": "transcript",
                                                        "data": clean,
                                                    })
                                                    session_events.append({"ts": datetime.now(timezone.utc).isoformat(), "type": "agent_transcript", "text": clean[:500]})
                                                    logger.info("Transcript: %s", clean[:80])
                                                for card in cards:
                                                    await websocket.send_json({"type": "triage_card", "data": card})
                                                    session_events.append({"ts": datetime.now(timezone.utc).isoformat(), "type": "triage_card", "card": card})
                                                    logger.info("Triage card: %s", card.get("condition"))

                                    # ── Output audio transcription ────────────────────
                                    ot = getattr(sc, "output_transcription", None)
                                    if ot and getattr(ot, "text", None):
                                        transcript_chunk = ot.text
                                        cards = parser.process(transcript_chunk)
                                        clean = parser.clean(transcript_chunk)
                                        if clean.strip():
                                            await websocket.send_json({
                                                "type": "transcript",
                                                "data": clean,
                                            })
                                            session_events.append({"ts": datetime.now(timezone.utc).isoformat(), "type": "agent_transcript", "text": clean[:500]})
                                            logger.debug("Transcript chunk: %s", clean[:80])
                                        for card in cards:
                                            await websocket.send_json({"type": "triage_card", "data": card})
                                            session_events.append({"ts": datetime.now(timezone.utc).isoformat(), "type": "triage_card", "card": card})
                                            logger.info("Triage card from transcript: %s", card.get("condition"))

                                    # ── Input (user speech) transcription ─────────────
                                    it = getattr(sc, "input_transcription", None)
                                    if it and getattr(it, "text", None):
                                        user_text = it.text.strip()
                                        if user_text:
                                            await websocket.send_json({
                                                "type": "user_transcript",
                                                "data": user_text,
                                            })
                                            session_events.append({"ts": datetime.now(timezone.utc).isoformat(), "type": "user_speech", "text": user_text[:500]})
                                            logger.info("User said: %s", user_text[:80])

                                    if sc.turn_complete:
                                        for card in parser.flush():
                                            await websocket.send_json({"type": "triage_card", "data": card})
                                        await websocket.send_json({"type": "status", "data": "turn_complete"})
                                        logger.info("Turn complete — looping for next turn")

                                # ── Top-level audio blob (older SDK path) ─────────────
                                elif (
                                    getattr(response, "data", None)
                                    and "audio" in str(getattr(response, "mime_type", ""))
                                ):
                                    await websocket.send_json({
                                        "type": "audio_chunk",
                                        "data": base64.b64encode(response.data).decode(),
                                    })

                            except Exception as msg_exc:
                                logger.error(
                                    "Error processing Gemini message (continuing): %s: %s",
                                    type(msg_exc).__name__,
                                    msg_exc,
                                    exc_info=True,
                                )
                        # inner async-for ended (turn_complete received) — loop back

                except Exception as exc:
                    logger.error("receive_from_gemini fatal: %s", type(exc).__name__, exc_info=True)
                    try:
                        await websocket.send_json({"type": "error", "data": f"Agent error: {exc}"})
                    except Exception:
                        pass

            results = await asyncio.gather(
                send_to_gemini(),
                receive_from_gemini(),
                return_exceptions=True,
            )
            for i, result in enumerate(results):
                if isinstance(result, Exception):
                    task_name = ["upstream", "downstream"][i]
                    logger.error("%s crashed: %s: %s", task_name, type(result).__name__, result, exc_info=result)
                    try:
                        await websocket.send_json({
                            "type": "error",
                            "data": f"{task_name} failed: {type(result).__name__}: {result}",
                        })
                    except Exception:
                        pass

    except Exception as exc:
        logger.error("Session failed: %s", type(exc).__name__, exc_info=True)
        try:
            await websocket.send_json({"type": "error", "data": f"Connection failed: {exc}"})
        except Exception:
            pass
    finally:
        logger.info("Session ended: %s  events=%d", session_id, len(session_events))
        # ── Persist session log to Cloud Storage ──────────────────────────────
        if _CLOUD_STORAGE_AVAILABLE and session_events:
            try:
                payload = {
                    "session_id": session_id,
                    "started_at": session_start_ts.isoformat(),
                    "ended_at": datetime.now(timezone.utc).isoformat(),
                    "transcript_chunks": sum(1 for e in session_events if e["type"] == "agent_transcript"),
                    "triage_cards": sum(1 for e in session_events if e["type"] == "triage_card"),
                    "events": session_events,
                }
                await _save_session_log(session_id, payload)
                logger.info("Session log saved to GCS: %s", session_id)
            except Exception as _cse:
                logger.warning("Cloud Storage save failed (non-fatal): %s", _cse)
        try:
            await websocket.close()
        except Exception:
            pass


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=int(os.environ.get("PORT", 8080)), reload=False)

