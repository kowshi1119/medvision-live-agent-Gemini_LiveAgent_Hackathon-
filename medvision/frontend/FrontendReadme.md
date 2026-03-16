# MedVision Frontend

React 18 + TypeScript + Vite frontend for the MedVision real-time multimodal emergency medical agent. Connects to the FastAPI backend over WebSocket for bidirectional PCM voice and live camera vision powered by `gemini-2.5-flash-native-audio-latest`.

---

## Tech Stack

| Layer | Library / Tool |
|---|---|
| UI Framework | React 18 |
| Language | TypeScript 5 |
| Build Tool | Vite 5 |
| Styling | Tailwind CSS 3 |
| Transport | WebSocket (native browser API) |
| Audio | Web Audio API — AudioWorklet (PCM 16 kHz capture), AnalyserNode (RMS), PCM 24 kHz playback |
| Video | WebRTC `getUserMedia` → JPEG frames at 2 fps |

---

## Project Structure

```
frontend/
├── public/
│   └── pcm-capture-processor.js  # AudioWorklet processor — PCM 16kHz capture
├── src/
│   ├── App.tsx                   # Root component: layout, session state, severity tracker, agent mode
│   ├── main.tsx                  # React entry point
│   ├── index.css                 # Tailwind base styles + custom animations
│   ├── components/
│   │   ├── AgentVoiceBar.tsx     # RMS-driven waveform bars + partial/final transcript
│   │   ├── CameraFeed.tsx        # Live webcam preview + "AI SEES" visual-cue overlay
│   │   ├── SessionLog.tsx        # Scrollable real-time event log
│   │   ├── StatusBar.tsx         # Connection status footer
│   │   └── TriageCard.tsx        # Colour-coded triage card with priority badge + WHO steps
│   └── hooks/
│       ├── useGeminiLive.ts      # WebSocket lifecycle, audio/video send, message dispatch
│       ├── useAudio.ts           # AudioWorklet PCM capture + RMS audioLevel analyser
│       └── useCamera.ts          # WebRTC camera capture at 2 fps
├── index.html
├── vite.config.ts                # Dev server proxy config
├── tailwind.config.ts
├── postcss.config.json
├── tsconfig.json
└── package.json
```

---

## Environment Variables

Create a `.env` file in the `frontend/` directory (never commit this file):

```env
VITE_CLOUD_RUN_URL=http://localhost:8082
```

| Variable | Description | Default |
|---|---|---|
| `VITE_CLOUD_RUN_URL` | Backend base URL (local or Cloud Run) | `http://localhost:8082` |

---

## Local Development

### Prerequisites

- Node.js 20+
- npm 9+
- Backend running on `http://localhost:8082` (see [backend README](../README.md))

### Install & Run

```bash
cd medvision/frontend
npm install
npm run dev
```

The dev server starts on **http://localhost:3000**. WebSocket requests (`/live`) and HTTP requests (`/health`) are proxied to the backend via `vite.config.ts`.

### Available Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start Vite dev server with HMR |
| `npm run build` | Type-check + production build to `dist/` |
| `npm run preview` | Preview the production build locally |

---

## Key Components & Hooks

### `useGeminiLive` hook

Central hook that drives the entire session:

- Opens `WebSocket` to `ws://<backend>/live`
- Sends user audio as `{ type: "audio", data: "<base64 PCM16 mono 16kHz>" }`
- Sends camera frames as `{ type: "video", data: "<base64 JPEG>" }`
- Receives agent audio (PCM 24 kHz), partial + final transcripts, triage cards, session log entries
- Echo gate: mic is blocked for 800 ms after agent audio ends to prevent feedback
- Exposes: `connectionState`, `isSpeaking`, `partialTranscript`, `userTranscript`, `triageCards`, `sessionLog`, `audioLevel`, `connect`, `disconnect`, `sendText`

### `useAudio` hook

- `AudioWorklet` (`pcm-capture-processor.js`) collects PCM 16-bit samples from the mic at 16 kHz
- `AnalyserNode` runs a RAF loop computing RMS → `audioLevel` (0–1) for the waveform visualiser

### `useCamera` hook

- `getUserMedia({ video: true })` → `<canvas>` snapshot → JPEG base64 at 2 fps
- Forwards frames to `useGeminiLive` via `sendVideoFrame()`

### `AgentVoiceBar`

Five animated bars with deterministic scale factors `[0.55, 0.85, 1.0, 0.80, 0.50]`. Height is driven by the real `audioLevel` from the hook — no random jitter.

### `CameraFeed`

Shows the live webcam feed at constrained height. Overlays a red "AI SEES: …" banner when Gemini reports a detected visual cue in the scene.

### `TriageCard`

Renders each AI-generated triage card with:

- **Priority badge**: `IMMEDIATE` (red), `URGENT` (amber), `DELAYED` (green)
- **Condition name** (spaces substituted for underscores)
- **Numbered WHO action steps**
- **Reference** to the WHO/ATLS guideline
- **Timestamp**

### `App.tsx` — Session UI

Three-column layout (`Left | Center | Right`) inside a fixed `h-screen` shell:

| Panel | Content |
|---|---|
| Left | Camera feed · Severity badge · Triage cards |
| Center | Agent mode indicator (LISTENING / SPEAKING / STANDBY) · AgentVoiceBar · Live transcript |
| Right | Session log |

Header contains the **Start Session / End Session** button and the always-visible **INTERRUPT** button. Max-severity badge (🔴 RED / 🟡 YELLOW / 🟢 GREEN) tracks the highest severity seen across the session.

---

## Supported Languages

The language selector (header dropdown) sets the language passed to the backend. The agent responds in the same language the first responder speaks:

English · Español · Français · العربية · हिन्दी · 中文 · Kiswahili · தமிழ் · Português · Русский

---

## WebSocket Message Protocol

### Client → Server

```json
{ "type": "audio",     "data": "<base64 PCM16 mono 16kHz>" }
{ "type": "video",     "data": "<base64 JPEG frame>" }
{ "type": "interrupt" }
{ "type": "ping" }
```

### Server → Client

```json
{ "type": "audio",       "data": "<base64 PCM16>", "sampleRate": 24000 }
{ "type": "transcript",  "text": "...", "final": true }
{ "type": "triage_card", "card": { "condition": "...", "priority": "immediate", "steps": [...], "reference": "...", "timestamp": "..." } }
{ "type": "session_log", "entry": { ... } }
{ "type": "turn_end" }
{ "type": "error",       "message": "..." }
```

---

## Production Build

```bash
npm run build
```

Output is in `dist/`. Deploy to:
- **Firebase Hosting**: `firebase deploy --only hosting`
- **Google Cloud Storage**: `gsutil -m rsync -r dist/ gs://<bucket>`
- **Cloud Run** (nginx container): see `../backend/deploy.sh`

---

## Troubleshooting

| Problem | Fix |
|---|---|
| Blank screen / no connection | Check backend is running: `curl http://localhost:8082/health` |
| Camera not appearing | Allow camera permissions; only HTTPS or `localhost` is allowed by browsers |
| Mic not transmitting | Allow microphone permissions; check browser console for `getUserMedia` errors |
| Port 3000 already in use | Vite auto-increments to 3001, 3002, etc.; update `VITE_CLOUD_RUN_URL` if needed |
| CORS errors | Ensure `FRONTEND_ORIGIN` in `backend/.env` matches the actual dev-server port |
| Waveform bars stuck | Verify `audioLevel` is non-zero; check `useAudio` AudioWorklet is running |
| No triage cards | Speak a clear medical scenario; check backend logs for `[TRIAGE_CARD]` parsing |
| Agent not responding | Click INTERRUPT to reset, then speak again; check WebSocket status in Status Bar |
