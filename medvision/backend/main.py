from datetime import datetime
import asyncio
import base64
import json
import logging
import os
import uuid

from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from google.adk.agents.run_config import StreamingMode
from google.adk.runners import InMemorySessionService, LiveRequestQueue, RunConfig, Runner
from google.cloud import logging as cloud_logging
from google.genai import types
import uvicorn

from agent import root_agent
from triage import TriageParser

load_dotenv()

try:
    cloud_logging.Client().setup_logging()
except Exception:
    pass

logger = logging.getLogger(__name__)

app = FastAPI(title="MedVision API", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[os.getenv("FRONTEND_ORIGIN", "*")],
    allow_methods=["*"],
    allow_headers=["*"],
)

session_service = InMemorySessionService()
runner = Runner(app_name="medvision", agent=root_agent, session_service=session_service)


@app.get("/health")
async def health() -> dict:
    return {
        "status": "ok",
        "version": "1.0.0",
        "timestamp": datetime.utcnow().isoformat(),
    }


@app.websocket("/live")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    session_id = str(uuid.uuid4())
    user_id = "responder"
    logger.info("New session: %s", session_id)

    await session_service.create_session(
        app_name="medvision", user_id=user_id, session_id=session_id
    )

    live_queue = LiveRequestQueue()
    parser = TriageParser()

    run_config = RunConfig(
        response_modalities=["AUDIO", "TEXT"],
        streaming_mode=StreamingMode.BIDI,
        speech_config=types.SpeechConfig(
            voice_config=types.VoiceConfig(
                prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name="Aoede")
            )
        ),
    )

    async def upstream():
        """Browser -> Agent: video frames + audio chunks."""
        try:
            while True:
                raw = await websocket.receive_text()
                msg = json.loads(raw)
                msg_type = msg.get("type")
                if msg_type == "audio_chunk":
                    live_queue.send_realtime(
                        types.Blob(
                            data=base64.b64decode(msg["data"]),
                            mime_type="audio/pcm;rate=16000",
                        )
                    )
                elif msg_type == "video_frame":
                    live_queue.send_realtime(
                        types.Blob(
                            data=base64.b64decode(msg["data"]),
                            mime_type="image/jpeg",
                        )
                    )
                elif msg_type == "interrupt":
                    live_queue.send_realtime(types.ActivityEnd())
                    logger.info("Interrupt received")
                elif msg_type == "text":
                    live_queue.send_content(
                        types.Content(
                            role="user",
                            parts=[types.Part(text=msg["data"])],
                        )
                    )
                elif msg_type == "end_session":
                    live_queue.close()
                    break
        except WebSocketDisconnect:
            logger.info("Session disconnected: %s", session_id)
            live_queue.close()

    async def downstream():
        """Agent -> Browser: audio + transcript + triage cards."""
        try:
            async for event in runner.run_live(
                user_id=user_id,
                session_id=session_id,
                live_request_queue=live_queue,
                run_config=run_config,
            ):
                if websocket.client_state.name != "CONNECTED":
                    break

                event_type = getattr(event, "type", "")
                if event_type == "audio" and hasattr(event, "data"):
                    await websocket.send_json(
                        {
                            "type": "audio_chunk",
                            "data": base64.b64encode(event.data).decode(),
                        }
                    )
                elif hasattr(event, "text") and event.text:
                    cards = parser.process(event.text)
                    clean = parser.clean(event.text)
                    if clean.strip():
                        await websocket.send_json(
                            {
                                "type": "transcript",
                                "data": {
                                    "chunk": clean,
                                    "partial": False,
                                    "full": clean,
                                },
                            }
                        )
                    for card in cards:
                        await websocket.send_json({"type": "triage_card", "data": card})
        except Exception as exc:
            logger.error("Downstream error: %s", exc)

    try:
        await asyncio.gather(upstream(), downstream())
    except Exception as exc:
        logger.error("Session error: %s", exc)
    finally:
        live_queue.close()
        try:
            await websocket.close()
        except Exception:
            pass
        logger.info("Session closed: %s", session_id)


if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=int(os.environ.get("PORT", 8080)),
        reload=False,
    )
