# MedVision Frontend

React + TypeScript + Vite frontend for the MedVision AI-powered medical triage assistant. Connects to the FastAPI backend over WebSocket for real-time bidirectional voice and video streaming.

---

## Tech Stack

| Layer | Library / Tool |
|---|---|
| UI Framework | React 18 |
| Language | TypeScript 5 |
| Build Tool | Vite 5 |
| Styling | Tailwind CSS 3 |
| Transport | WebSocket (native browser API) |

---

## Project Structure

```
frontend/
├── src/
│   ├── App.tsx                  # Root component, session lifecycle
│   ├── main.tsx                 # React entry point
│   ├── index.css                # Tailwind base styles + animations
│   ├── components/
│   │   ├── AgentVoiceBar.tsx    # Animated audio-level indicator when agent speaks
│   │   ├── CameraFeed.tsx       # Live webcam preview + frame capture
│   │   ├── SessionLog.tsx       # Scrolling event log (transcripts, triage events)
│   │   ├── StatusBar.tsx        # Connection state, latency, language selector
│   │   └── TriageCard.tsx       # Renders a single triage card with priority badge
│   └── hooks/
│       ├── useGeminiLive.ts     # Core WebSocket hook (connect/disconnect/events)
│       ├── useAudio.ts          # Microphone capture + PCM streaming
│       └── useCamera.ts         # Webcam frame capture at configurable FPS
├── index.html
├── vite.config.ts               # Dev server + WebSocket proxy config
├── tailwind.config.ts
├── postcss.config.json
├── tsconfig.json
└── package.json
```

---

## Environment Variables

Create a `.env` file in the `frontend/` directory (never commit this file):

```env
VITE_CLOUD_RUN_URL=http://localhost:8080
VITE_GCP_REGION=us-central1
```

| Variable | Description | Default |
|---|---|---|
| `VITE_CLOUD_RUN_URL` | Backend base URL (local or Cloud Run) | `http://localhost:8080` |
| `VITE_GCP_REGION` | GCP region (display only) | `us-central1` |

---

## Local Development

### Prerequisites

- Node.js 18+
- npm 9+
- Backend running on `http://localhost:8080` (see `backend/` README)

### Install & Run

```bash
cd medvision/frontend
npm install
npm run dev
```

The dev server starts on **http://localhost:3000** by default. WebSocket requests to `/live` and HTTP requests to `/health` are proxied to the backend automatically via `vite.config.ts`.

### Available Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start Vite dev server with HMR |
| `npm run build` | Type-check + production build to `dist/` |
| `npm run preview` | Preview the production build locally |
| `npm run type-check` | TypeScript type check only (no emit) |

---

## Key Components

### `useGeminiLive` hook

The central hook that manages everything:

- Opens a `WebSocket` to `ws://<backend>/live?lang=<lang>`
- Sends user audio (`{ type: "audio", data: "<base64 PCM>" }`)
- Sends video frames (`{ type: "video", data: "<base64 JPEG>" }`)
- Receives agent audio, transcripts, and triage card JSON
- Implements exponential backoff reconnection (1s → 2s → 4s → 8s → 16s → 30s)
- Exposes: `connectionState`, `isSpeaking`, `transcript`, `triageCards`, `sessionLog`, `audioLevel`

### `TriageCard` component

Renders each AI-generated triage card with:

- **Priority badge**: `IMMEDIATE` (red), `URGENT` (yellow), `DELAYED` (green)
- **Condition name** (human-readable, underscores replaced with spaces)
- **Numbered action steps** from WHO Emergency Triage protocols
- **Reference** to the WHO guideline used
- **Timestamp** of when the card was generated

### `AgentVoiceBar`

Animated waveform bars that pulse when the AI agent is speaking, driven by the `audioLevel` value from `useGeminiLive`.

### `CameraFeed`

Captures webcam frames using `useCamera` and forwards them to `useGeminiLive.sendVideoFrame()` for visual context analysis by the Gemini model.

---

## Supported Languages

The language selector in `StatusBar` allows the agent to respond in:

English, Español, Français, العربية, हिन्दी, 中文, Kiswahili, தமிழ், Português, Русский

---

## Production Build

```bash
npm run build
```

Output is in `dist/`. Serve it with any static web server or deploy to:
- **Firebase Hosting**: `firebase deploy --only hosting`
- **Google Cloud Storage**: `gsutil -m rsync -r dist/ gs://<bucket>`
- **Cloud Run** (nginx container): see `../backend/deploy.sh`

---

## WebSocket Message Protocol

### Client → Server

```json
{ "type": "audio", "data": "<base64 PCM16 mono 16kHz>" }
{ "type": "video", "data": "<base64 JPEG frame>" }
{ "type": "interrupt" }
{ "type": "ping" }
```

### Server → Client

```json
{ "type": "audio",       "data": "<base64 PCM>", "sampleRate": 24000 }
{ "type": "transcript",  "text": "...",           "final": true }
{ "type": "triage_card", "card": { "condition": "...", "priority": "immediate", "steps": [...], "reference": "...", "timestamp": "..." } }
{ "type": "session_log", "entry": { ... } }
{ "type": "turn_end" }
{ "type": "error",       "message": "..." }
```

---

## Troubleshooting

| Problem | Fix |
|---|---|
| Blank screen / no connection | Check backend is running: `curl http://localhost:8080/health` |
| Camera not appearing | Allow camera permissions in browser; only HTTPS or localhost is allowed |
| Mic not transmitting | Allow microphone permissions; check `useAudio` hook for `getUserMedia` errors |
| Port 3000 already in use | Vite will try 3001, 3002 automatically; update `FRONTEND_ORIGIN` in `backend/.env` to match |
| CORS errors | Set `FRONTEND_ORIGIN=http://localhost:<port>` in `backend/.env` and restart backend |
| No triage cards appearing | Speak a clear medical scenario; check backend logs for `TRIAGE_CARD` parsing |
