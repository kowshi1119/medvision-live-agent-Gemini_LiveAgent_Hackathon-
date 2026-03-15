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

from agent import SYSTEM_INSTRUCTION, get_who_protocol
from triage import TriageParser

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

LIVE_CONFIG = types.LiveConnectConfig(
    response_modalities=["AUDIO"],
    input_audio_transcription=types.AudioTranscriptionConfig(),
    output_audio_transcription=types.AudioTranscriptionConfig(),
    generation_config=types.GenerationConfig(temperature=0.2),
    system_instruction=types.Content(
        role="user",
        parts=[types.Part(text=SYSTEM_INSTRUCTION)],
    ),
    tools=[types.Tool(function_declarations=[get_protocol_tool])],
    speech_config=types.SpeechConfig(
        voice_config=types.VoiceConfig(
            prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name="Kore")
        )
    ),
)

# ── FastAPI app ────────────────────────────────────────────────────────────

app = FastAPI(title="MedVision API", version="2.0.0")
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
    return {
        "status": "ok",
        "version": "2.0.0",
        "model": MODEL,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


@app.websocket("/live")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    session_id = str(uuid.uuid4())
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

        async with client.aio.live.connect(model=MODEL, config=LIVE_CONFIG) as gemini_session:
            logger.info("Gemini Live session connected OK")
            await websocket.send_json({"type": "status", "data": "gemini_connected"})

            # ── Phase 1: Proactive greeting ─────────────────────────────────────
            # Send a kick-start text BEFORE the bidirectional audio loop so there is
            # no race with send_realtime_input audio.  We collect the greeting
            # response ourselves and stream audio/transcript back to the browser.
            # Stale audio_chunk messages that arrived during this phase are
            # silently discarded (they are ambient mic noise, not intentional speech).
            try:
                await gemini_session.send_client_content(
                    turns=[types.Content(
                        role="user",
                        parts=[types.Part(text="Hello. You are now connected. Please briefly greet the first responder and confirm you are ready to assist.")],
                    )],
                    turn_complete=True,
                )
                logger.info("Greeting sent to Gemini — waiting for response…")

                # Collect greeting response and forward it to the browser
                async for response in gemini_session.receive():
                    try:
                        if response.server_content:
                            sc = response.server_content
                            if sc.model_turn:
                                for part in sc.model_turn.parts:
                                    if getattr(part, "inline_data", None) and part.inline_data.data:
                                        await websocket.send_json({
                                            "type": "audio_chunk",
                                            "data": base64.b64encode(part.inline_data.data).decode(),
                                        })
                            ot = getattr(sc, "output_transcription", None)
                            if ot and getattr(ot, "text", None):
                                clean = parser.clean(ot.text)
                                if clean.strip():
                                    await websocket.send_json({"type": "transcript", "data": clean})
                                    logger.info("Greeting transcript: %s", clean[:80])
                            if sc.turn_complete:
                                await websocket.send_json({"type": "status", "data": "turn_complete"})
                                logger.info("Greeting complete — entering bidirectional loop")
                                break
                    except Exception as greet_msg_exc:
                        logger.warning("Greeting message error (continuing): %s", greet_msg_exc)

                # Drain stale audio_chunk / video_frame messages the frontend sent
                # while we were generating the greeting.  We cannot forward them
                # because they are ambient noise and will confuse Gemini's VAD.
                drained = 0
                while True:
                    try:
                        stale = await asyncio.wait_for(websocket.receive_text(), timeout=0.05)
                        stale_msg = json.loads(stale)
                        if stale_msg.get("type") in ("audio_chunk", "video_frame"):
                            drained += 1
                        else:
                            # Non-media message (e.g. end_session) — handle it
                            if stale_msg.get("type") == "end_session":
                                logger.info("end_session received during drain — closing")
                                return
                    except (asyncio.TimeoutError, Exception):
                        break
                if drained:
                    logger.info("Drained %d stale media messages before bidirectional loop", drained)

            except Exception as greet_exc:
                logger.warning("Greeting phase failed (%s) — continuing to bidirectional loop", greet_exc)

            await websocket.send_json({"type": "status", "data": "Agent connected and ready"})

            async def send_to_gemini():
                """Forward browser audio / video to Gemini."""
                logger.info("send_to_gemini task started")
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

                        if msg_type == "audio_chunk":
                            audio_bytes = base64.b64decode(msg["data"])
                            await gemini_session.send_realtime_input(
                                audio=types.Blob(data=audio_bytes, mime_type="audio/pcm;rate=16000")
                            )
                            logger.debug("Sent audio_chunk: %d bytes", len(audio_bytes))

                        elif msg_type == "video_frame":
                            image_bytes = base64.b64decode(msg["data"])
                            await gemini_session.send_realtime_input(
                                video=types.Blob(data=image_bytes, mime_type="image/jpeg")
                            )
                            logger.debug("Sent video_frame: %d bytes", len(image_bytes))

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
                """Forward Gemini responses to browser."""
                logger.info("receive_from_gemini task started - waiting for events")
                try:
                    async for response in gemini_session.receive():
                        # ── Wrap each message so one bad response never kills the loop ──
                        try:
                            logger.info("Gemini event: %s", type(response).__name__)

                            # ── Tool calls ───────────────────────────────────────────
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

                            # ── Server content (audio + text) ────────────────────────
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
                                                logger.info("Transcript: %s", clean[:80])
                                            for card in cards:
                                                await websocket.send_json({"type": "triage_card", "data": card})
                                                logger.info("Triage card: %s", card.get("condition"))

                                # ── Output audio transcription ───────────────────────
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
                                        logger.debug("Transcript chunk: %s", clean[:80])
                                    for card in cards:
                                        await websocket.send_json({"type": "triage_card", "data": card})
                                        logger.info("Triage card from transcript: %s", card.get("condition"))

                                # ── Input (user speech) transcription ────────────────
                                it = getattr(sc, "input_transcription", None)
                                if it and getattr(it, "text", None):
                                    user_text = it.text.strip()
                                    if user_text:
                                        await websocket.send_json({
                                            "type": "user_transcript",
                                            "data": user_text,
                                        })
                                        logger.info("User said: %s", user_text[:80])

                                if sc.turn_complete:
                                    for card in parser.flush():
                                        await websocket.send_json({"type": "triage_card", "data": card})
                                    await websocket.send_json({"type": "status", "data": "turn_complete"})
                                    logger.info("Turn complete")

                            # ── Top-level audio blob (older SDK path) ────────────────
                            elif (
                                getattr(response, "data", None)
                                and "audio" in str(getattr(response, "mime_type", ""))
                            ):
                                await websocket.send_json({
                                    "type": "audio_chunk",
                                    "data": base64.b64encode(response.data).decode(),
                                })

                        except Exception as msg_exc:
                            # Log the bad message and keep going — never kill the whole loop
                            logger.error(
                                "Error processing Gemini message (continuing): %s: %s",
                                type(msg_exc).__name__,
                                msg_exc,
                                exc_info=True,
                            )

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
        logger.info("Session ended: %s", session_id)
        try:
            await websocket.close()
        except Exception:
            pass


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=int(os.environ.get("PORT", 8080)), reload=False)

