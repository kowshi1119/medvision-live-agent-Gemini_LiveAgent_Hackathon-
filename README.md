# MedVision — Gemini Live Agent Challenge

**Real-time multimodal emergency AI for first responders.**

Uses the Gemini Live API (`gemini-2.5-flash-native-audio-latest`) for bidirectional voice + live camera vision, grounded in 20 WHO/ATLS protocols via Firestore — zero hallucinations.

## Highlights

| | |
|---|---|
| 🎙️ Bidirectional voice | PCM 16 kHz capture → Gemini Live → PCM 24 kHz playback, echo-gated |
| 📷 Live camera vision | WebRTC frames (2 fps) → Gemini multimodal, with "AI SEES" overlay |
| 🩺 Instant triage cards | `[TRIAGE_CARD]` markers parsed in real-time, colour-coded by severity |
| 🔴 Severity escalation | Max-severity badge (RED/YELLOW/GREEN) persists across entire session |
| 🤖 Agent mode indicator | LISTENING / SPEAKING / STANDBY status in real-time |
| 🌍 Multilingual | Responds in the user's language automatically |
| ⚡ Interrupt button | Always-visible — stops agent speech instantly |
| 📦 Zero hallucinations | All protocols sourced from Firestore; Gemini uses grounding tool calls only |
| ☁️ Cloud-native | Cloud Run + Cloud Storage session logs + Cloud Logging |

## Stack

- **AI**: `gemini-2.5-flash-native-audio-latest`, `google-genai >= 1.5.0`
- **Backend**: Python 3.11, FastAPI, uvicorn (port 8082)
- **Frontend**: React 18, TypeScript, Tailwind CSS 3, Vite (port 3000)
- **Infra**: Cloud Run, Firestore, Cloud Storage, Terraform

## Quick start

```bash
# Backend (local)
cd medvision/backend
pip install -r requirements.txt
uvicorn main:app --port 8082

# Frontend (local)
cd medvision/frontend
npm install && npm run dev   # → http://localhost:3000
```

See [medvision/README.md](medvision/README.md) for full docs, architecture diagram, and Cloud Run deployment guide.

#GeminiLiveAgentChallenge
