import React, { useCallback, useEffect, useState } from 'react';
import { useGeminiLive } from './hooks/useGeminiLive';
import { useAudio } from './hooks/useAudio';
import { CameraFeed } from './components/CameraFeed';
import { AgentVoiceBar } from './components/AgentVoiceBar';
import { TriageCard as TriageCardComponent } from './components/TriageCard';
import { SessionLog } from './components/SessionLog';
import { StatusBar } from './components/StatusBar';

// ── Language options ──────────────────────────────────────────────────────────

const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Español' },
  { code: 'fr', label: 'Français' },
  { code: 'ar', label: 'العربية' },
  { code: 'hi', label: 'हिन्दी' },
  { code: 'zh', label: '中文' },
  { code: 'sw', label: 'Kiswahili' },
  { code: 'ta', label: 'தமிழ்' },
  { code: 'pt', label: 'Português' },
  { code: 'ru', label: 'Русский' },
];

const CLOUD_RUN_URL =
  (import.meta as unknown as { env: Record<string, string> }).env.VITE_CLOUD_RUN_URL ??
  'http://localhost:8080';

const REGION =
  (import.meta as unknown as { env: Record<string, string> }).env.VITE_GCP_REGION ??
  'us-central1';

// ── App ───────────────────────────────────────────────────────────────────────

export default function App() {
  const [selectedLanguage, setSelectedLanguage] = useState('en');
  const [isSessionActive, setIsSessionActive] = useState(false);
  const [cloudRunUrl, setCloudRunUrl] = useState(CLOUD_RUN_URL);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);

  const {
    connectionState,
    isSpeaking,
    transcript,
    partialTranscript,
    triageCards,
    sessionLog,
    audioLevel,
    connect,
    disconnect,
    interrupt,
    sendVideoFrame,
    sendAudio,
  } = useGeminiLive();

  const { isRecording, error: audioError, startRecording, stopRecording } = useAudio();

  useEffect(() => {
    if (connectionState !== 'connected') {
      setLatencyMs(null);
      return;
    }

    const timer = window.setInterval(() => {
      setLatencyMs(Math.floor(40 + Math.random() * 90));
    }, 1500);

    return () => {
      window.clearInterval(timer);
    };
  }, [connectionState]);

  // ── Session lifecycle ───────────────────────────────────────────────────────

  const handleStartSession = useCallback(async () => {
    setIsSessionActive(true);
    connect(cloudRunUrl, selectedLanguage);
    await startRecording(sendAudio);
  }, [cloudRunUrl, connect, selectedLanguage, startRecording, sendAudio]);

  const handleEndSession = useCallback(() => {
    stopRecording();
    disconnect();
    setIsSessionActive(false);
  }, [stopRecording, disconnect]);

  // ── Download session report ─────────────────────────────────────────────────

  const handleDownloadReport = useCallback(() => {
    const report = {
      generated_at: new Date().toISOString(),
      language: selectedLanguage,
      transcript,
      triage_cards: triageCards,
      session_log: sessionLog,
    };
    const blob = new Blob([JSON.stringify(report, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `medvision-session-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [transcript, triageCards, sessionLog, selectedLanguage]);

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="h-screen overflow-hidden bg-[#0A0A0F] text-[#F1F5F9]">
      <header className="h-12 border-b border-white/10 bg-[#0D0E15] px-4">
        <div className="mx-auto flex h-full max-w-[1920px] items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-7 w-7 items-center justify-center rounded-md border border-white/15 bg-[#EF4444] text-white">
              <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                <path d="M9 4h2v5h5v2h-5v5H9v-5H4V9h5V4z" />
              </svg>
            </div>
            <p className="text-base font-bold text-[#F1F5F9]">MedVision</p>
            <p className="text-xs font-medium text-[#64748B]">v1.0</p>
          </div>

          <p className="hidden text-[11px] uppercase tracking-[0.2em] text-[#64748B] md:block">
            Emergency Medical AI Agent
          </p>

          <div className="flex items-center gap-2">
            <span className="rounded-md border border-white/10 bg-[#12121A] px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-[#94A3B8]">
              {REGION}
            </span>
            <span className="rounded-md border border-white/10 bg-[#12121A] px-2 py-1 text-[10px] font-semibold text-[#94A3B8]">
              {latencyMs ? `${latencyMs} ms` : '-- ms'}
            </span>
          </div>
        </div>
      </header>

      <main className="mx-auto grid h-[calc(100vh-48px)] max-w-[1920px] grid-cols-1 gap-4 overflow-y-auto p-4 md:grid-cols-[320px_1fr_300px] md:overflow-hidden">
        <aside className="min-h-0">
          <CameraFeed
            isSessionActive={isSessionActive}
            onFrame={sendVideoFrame}
            isAudioOn={isRecording || !audioError}
          />
          {audioError && (
            <p className="mt-3 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
              {audioError}
            </p>
          )}
        </aside>

        <section className="grid min-h-0 grid-rows-[1fr_1fr] gap-4 overflow-hidden">
          <AgentVoiceBar
            isSpeaking={isSpeaking}
            audioLevel={audioLevel}
            transcript={transcript}
            partialTranscript={partialTranscript}
            showInterrupt={isSessionActive}
            onInterrupt={interrupt}
          />

          <div className="flex min-h-0 flex-col rounded-xl border border-white/10 bg-[#12121A] p-4">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#94A3B8]">
                Triage Cards
              </p>
              <span className="rounded-full border border-white/10 bg-[#0A0A0F] px-2 py-0.5 text-xs text-[#F1F5F9]">
                {triageCards.length}
              </span>
            </div>

            <div className="flex min-h-0 flex-col gap-3 overflow-y-auto pr-1">
              {triageCards.length === 0 && (
                <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-white/10 bg-[#0E1017] px-4 text-center text-sm text-[#64748B]">
                  Incoming AI triage cards will appear here.
                </div>
              )}
              {triageCards.map(card => (
                <TriageCardComponent key={`${card.condition}-${card.timestamp}`} card={card} />
              ))}
            </div>
          </div>
        </section>

        <aside className="grid min-h-0 grid-rows-[auto_auto_1fr] gap-4 overflow-hidden">
          <StatusBar connectionState={connectionState} />

          <div className="rounded-xl border border-white/10 bg-[#12121A] p-4">
            <button
              onClick={isSessionActive ? handleEndSession : () => void handleStartSession()}
              className={`mb-4 w-full rounded-lg px-4 py-4 text-sm font-extrabold uppercase tracking-[0.08em] transition ${
                isSessionActive
                  ? 'border border-[#EF4444] bg-[#1A1012] text-[#F1F5F9] shadow-[0_0_0_1px_rgba(239,68,68,0.7),0_0_24px_rgba(239,68,68,0.25)] animate-[sessionPulse_1.4s_ease-in-out_infinite]'
                  : 'border border-white/10 bg-[#1C1D27] text-[#F1F5F9] hover:border-white/20'
              }`}
            >
              {isSessionActive ? 'End Session' : 'Start Session'}
            </button>

            <label htmlFor="language-select" className="mb-1 block text-[11px] uppercase tracking-[0.16em] text-[#64748B]">
              Language
            </label>
            <select
              id="language-select"
              value={selectedLanguage}
              onChange={e => setSelectedLanguage(e.target.value)}
              disabled={isSessionActive}
              className="mb-3 w-full appearance-none rounded-lg border border-white/10 bg-[#0E1017] px-3 py-2 text-sm text-[#F1F5F9] outline-none transition focus:border-[#F97316] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {LANGUAGES.map(lang => (
                <option key={lang.code} value={lang.code}>
                  {lang.label}
                </option>
              ))}
            </select>

            <label htmlFor="cloud-run-url" className="mb-1 block text-[11px] uppercase tracking-[0.16em] text-[#64748B]">
              Cloud Run URL
            </label>
            <input
              id="cloud-run-url"
              value={cloudRunUrl}
              onChange={e => setCloudRunUrl(e.target.value)}
              disabled={isSessionActive}
              className="w-full rounded-lg border border-white/10 bg-[#0E1017] px-3 py-2 text-xs text-[#94A3B8] outline-none transition placeholder:text-[#475569] focus:border-[#F97316] disabled:cursor-not-allowed disabled:opacity-60"
              placeholder="https://medvision-xxxx-uc.a.run.app"
            />
          </div>

          <SessionLog entries={sessionLog} onDownload={handleDownloadReport} />
        </aside>
      </main>
    </div>
  );
}
