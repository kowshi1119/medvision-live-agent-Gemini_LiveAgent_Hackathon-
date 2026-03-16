import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import {
  AlertTriangle,
  Mic,
  MicOff,
  PhoneOff,
  Video,
  VideoOff,
  Volume2,
  Zap,
  Download,
  Trash2,
  Languages,
  Settings,
  HeartPulse,
  BrainCircuit,
  Eye,
  CircleDotDashed,
} from 'lucide-react';

import { useGeminiLive, SessionLogEntry } from './hooks/useGeminiLive';
import { useCamera } from './hooks/useCamera';
import { useAudio } from './hooks/useAudio';

import { CameraFeed } from './components/CameraFeed';
import { AgentVoiceBar } from './components/AgentVoiceBar';
import { TriageCard, TriageData } from './components/TriageCard';
import { SessionLog, LogEntry } from './components/SessionLog';
import { StatusBar } from './components/StatusBar';

// --- Main App Component ---
export default function App() {
  const [language, setLanguage] = useState('en');
  const [cloudRunUrl, setCloudRunUrl] = useState(import.meta.env.VITE_CLOUD_RUN_URL || 'http://localhost:8082');

  const {
    connectionState,
    isSpeaking,
    transcript,
    triageCards,
    sessionLog,
    lastAgentChunkTs,
    connect,
    disconnect,
    interrupt,
    sendAudio,
    sendVideoFrame,
  } = useGeminiLive();

  const [micMuted, setMicMuted] = useState(false);
  const micMutedRef = useRef(false);
  useEffect(() => { micMutedRef.current = micMuted; }, [micMuted]);

  // Track isSpeaking in a ref so sendAudioGated can read it synchronously
  const isSpeakingRef = useRef(false);
  useEffect(() => { isSpeakingRef.current = isSpeaking; }, [isSpeaking]);

  // Diagnostic counter — logs every 20th chunk so we know audio is flowing
  const audioSentRef = useRef(0);

  const GATE_MS = 800;
  const sendAudioGated = useCallback((base64: string) => {
    if (micMutedRef.current) return;
    // Hard block while agent is actively speaking (prevents echo feedback)
    if (isSpeakingRef.current) return;
    // Post-speech cooldown: block for GATE_MS after the last agent audio chunk
    if (Date.now() - lastAgentChunkTs.current < GATE_MS) return;
    audioSentRef.current += 1;
    if (audioSentRef.current === 1 || audioSentRef.current % 20 === 0) {
      console.log(`[MedVision Gate] ✅ Sending user audio chunk #${audioSentRef.current}`);
    }
    sendAudio(base64);
  }, [sendAudio, lastAgentChunkTs]);

  const { videoRef, isActive: isCameraOn, startCamera, stopCamera, captureFrame } = useCamera();
  const { isRecording: isMicOn, error: audioError, startRecording: startMic, stopRecording: stopMic } = useAudio();

  // Flashes true for 150 ms every time a video frame is transmitted to Gemini
  const [isCapturing, setIsCapturing] = useState(false);
  const captureFlashRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleSessionToggle = () => {
    if (connectionState === 'connected') {
      disconnect();
      stopCamera();
      stopMic();
    } else {
      connect(cloudRunUrl, language);
    }
  };

  useEffect(() => {
    if (connectionState === 'connected' && !isMicOn) {
      startCamera();
      startMic(sendAudioGated);
    }
  }, [connectionState, isMicOn, startCamera, startMic, sendAudioGated]);

  // Send video frames at 2 fps when connected; flash the capture indicator each time
  useEffect(() => {
    if (connectionState !== 'connected') return;
    const interval = setInterval(() => {
      const frame = captureFrame();
      if (frame) {
        sendVideoFrame(frame);
        setIsCapturing(true);
        if (captureFlashRef.current) clearTimeout(captureFlashRef.current);
        captureFlashRef.current = setTimeout(() => setIsCapturing(false), 150);
      }
    }, 500);
    return () => {
      clearInterval(interval);
      if (captureFlashRef.current) clearTimeout(captureFlashRef.current);
    };
  }, [connectionState, captureFrame, sendVideoFrame]);

  const mappedSessionLog = useMemo((): LogEntry[] =>
    sessionLog.map((entry: SessionLogEntry) => ({
      type: entry.type === 'system' ? 'info' : entry.type === 'transcript' ? 'user' : entry.type,
      message: entry.content,
      timestamp: new Date(entry.ts).toISOString(),
    })), [sessionLog]);

  const handleDownloadReport = () => {
    const report = {
      session_start: mappedSessionLog.find(e => e.type === 'info')?.timestamp,
      session_end: new Date().toISOString(),
      language,
      triage_cards: triageCards,
      full_log: mappedSessionLog,
    };
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `medvision_report_${new Date().toISOString()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const AppHeader = ({ connectionState }: { connectionState: string }) => (
    <header className="flex items-center justify-between h-14 px-4 border-b border-white/10 shrink-0">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 flex items-center justify-center bg-red-600/20 rounded-full border border-red-600">
          <HeartPulse className="w-5 h-5 text-red-500" />
        </div>
        <h1 className="text-xl font-bold text-white tracking-tighter">MedVision</h1>
      </div>
      <div className="hidden md:block">
        <p className="text-sm tracking-wider text-gray-400">MEDICAL COMMAND CENTER</p>
      </div>
      <div className="flex items-center gap-4">
        <StatusBar connectionState={connectionState} />
        <div className="w-px h-6 bg-white/10"></div>
        <span className="text-sm font-mono text-gray-400">UTC {new Date().toISOString().substring(11, 19)}</span>
      </div>
    </header>
  );

  return (
    <div className="flex flex-col h-screen bg-[#0A0A0F] text-slate-100 font-sans overflow-hidden">
      <AppHeader connectionState={connectionState} />
      <main className="grid flex-1 grid-cols-1 gap-4 p-4 lg:grid-cols-[340px_1fr_320px] overflow-hidden">
        <LeftPanel isCameraOn={isCameraOn} isMicOn={isMicOn} micMuted={micMuted} onToggleMic={() => setMicMuted(m => !m)} connectionState={connectionState} videoRef={videoRef} audioError={audioError} isCapturing={isCapturing} />
        <CenterPanel isSpeaking={isSpeaking} transcript={transcript} triageCards={triageCards} isConnected={connectionState === 'connected'} onInterrupt={interrupt} />
        <RightPanel
          connectionState={connectionState}
          onSessionToggle={handleSessionToggle}
          language={language}
          onLanguageChange={setLanguage}
          cloudRunUrl={cloudRunUrl}
          onCloudRunUrlChange={setCloudRunUrl}
          sessionLog={mappedSessionLog}
          onDownloadReport={handleDownloadReport}
        />
      </main>
    </div>
  );
}

// --- Layout Components ---

const LeftPanel = ({ isCameraOn, isMicOn, micMuted, onToggleMic, connectionState, videoRef, audioError, isCapturing }: { isCameraOn: boolean; isMicOn: boolean; micMuted: boolean; onToggleMic: () => void; connectionState: string; videoRef: React.RefObject<HTMLVideoElement>; audioError: string | null; isCapturing: boolean }) => (
  <div className="flex flex-col gap-4">
    <div className="flex-1 card overflow-hidden">
      <CameraFeed videoRef={videoRef} isCapturing={isCapturing} isConnected={connectionState === 'connected'} />
    </div>
    <div className="grid grid-cols-3 gap-2">
      <StatusPill icon={<Eye size={14} />} label="VISION" active={isCameraOn} />
      <StatusPill icon={<Volume2 size={14} />} label="AUDIO" active={isMicOn && !micMuted} />
      <StatusPill icon={<BrainCircuit size={14} />} label="AGENT" active={connectionState === 'connected'} />
    </div>
    {audioError && (
      <div className="flex items-start gap-2 p-2 rounded bg-red-900/40 border border-red-700">
        <AlertTriangle size={14} className="text-red-400 mt-0.5 shrink-0" />
        <p className="text-xs text-red-300">{audioError}</p>
      </div>
    )}
    {connectionState === 'connected' && (
      <button onClick={onToggleMic} className={`w-full btn flex items-center justify-center gap-2 ${micMuted ? 'btn-danger' : 'btn-secondary'}`}>
        {micMuted ? <MicOff size={16} /> : <Mic size={16} />}
        {micMuted ? 'UNMUTE' : 'MUTE'}
      </button>
    )}
  </div>
);

const CenterPanel = ({ isSpeaking, transcript, triageCards, isConnected, onInterrupt }: { isSpeaking: boolean; transcript: string; triageCards: TriageData[]; isConnected: boolean; onInterrupt: () => void; }) => (
  <div className="relative flex flex-col gap-4 overflow-hidden">
    <div className="flex flex-col flex-1 p-4 card">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold tracking-wider text-gray-400">AGENT TRANSCRIPT</h2>
        {isSpeaking && (
          <div className="flex items-center gap-2">
            <span className="relative flex w-2.5 h-2.5">
              <span className="absolute inline-flex w-full h-full bg-red-400 rounded-full opacity-75 animate-ping"></span>
              <span className="relative inline-flex w-2.5 h-2.5 bg-red-500 rounded-full"></span>
            </span>
            <span className="text-xs font-semibold tracking-wider text-red-400">LIVE</span>
          </div>
        )}
      </div>
      <AgentVoiceBar isSpeaking={isSpeaking} />
      <p className="flex-1 mt-3 text-lg text-slate-100 leading-relaxed">{transcript || "Waiting for agent..."}</p>
    </div>
    <div className="flex flex-col flex-1 p-4 overflow-hidden card">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold tracking-wider text-gray-400">TRIAGE ASSESSMENT</h2>
        {triageCards.length > 0 && (
          <div className="flex items-center justify-center w-6 h-6 text-xs font-bold text-white bg-red-600 rounded-full shadow-[0_0_10px_rgba(239,68,68,0.5)]">
            {triageCards.length}
          </div>
        )}
      </div>
      <div className="flex-1 -mr-2 pr-2 overflow-y-auto">
        {triageCards.length === 0 ? (
          <div className="flex items-center justify-center h-full border-2 border-dashed rounded-lg border-white/10">
            <p className="text-sm text-gray-500">Triage cards will appear here</p>
          </div>
        ) : (
          <div className="space-y-3">
            {triageCards.map((card, index) => (
              <TriageCard key={index} card={card} className="slide-up" style={{ animationDelay: `${index * 100}ms` }} />
            ))}
          </div>
        )}
      </div>
    </div>
    {isConnected && isSpeaking && (
      <button onClick={onInterrupt} className="absolute bottom-4 right-4 btn btn-primary flex items-center gap-2">
        <Zap size={16} /> INTERRUPT
      </button>
    )}
  </div>
);

const RightPanel = ({ connectionState, onSessionToggle, language, onLanguageChange, cloudRunUrl, onCloudRunUrlChange, sessionLog, onDownloadReport }: { connectionState: string; onSessionToggle: () => void; language: string; onLanguageChange: (lang: string) => void; cloudRunUrl: string; onCloudRunUrlChange: (url: string) => void; sessionLog: LogEntry[]; onDownloadReport: () => void; }) => {
  const sessionButtonContent = useMemo(() => {
    switch (connectionState) {
      case 'connecting': return <><Spinner /> CONNECTING...</>;
      case 'connected': return <><PhoneOff size={16} /> END SESSION</>;
      default: return 'START SESSION';
    }
  }, [connectionState]);

  return (
    <div className="flex flex-col gap-4">
      <div className="p-4 card">
        <button onClick={onSessionToggle} disabled={connectionState === 'connecting'} className={`w-full btn flex items-center justify-center gap-2 ${connectionState === 'connected' ? 'btn-danger' : 'btn-primary'}`}>
          {connectionState === 'connected' && <div className="absolute w-full h-full rounded-md pulse-ring bg-red-500/50" />}
          {sessionButtonContent}
        </button>
        <div className="mt-3 space-y-2">
          <LanguageSelector value={language} onChange={onLanguageChange} disabled={connectionState !== 'disconnected'} />
          <UrlInput value={cloudRunUrl} onChange={onCloudRunUrlChange} disabled={connectionState !== 'disconnected'} />
        </div>
      </div>
      <div className="flex flex-col flex-1 p-4 overflow-hidden card">
        <h2 className="mb-3 text-sm font-semibold tracking-wider text-gray-400">SESSION LOG</h2>
        <div className="flex-1 -mr-2 pr-2 overflow-y-auto bg-black/20 rounded-md p-2">
          <SessionLog log={sessionLog} />
        </div>
        <button onClick={onDownloadReport} className="w-full mt-3 btn btn-secondary flex items-center justify-center gap-2">
          <Download size={16} /> DOWNLOAD REPORT
        </button>
      </div>
    </div>
  );
};

// --- UI Components ---

const StatusPill = ({ icon, label, active }: { icon: React.ReactNode; label: string; active: boolean }) => (
  <div className={`status-pill ${active ? 'text-green-400' : 'text-gray-500'}`}>
    <div className={`w-2 h-2 rounded-full ${active ? 'bg-green-500 animate-pulse' : 'bg-gray-600'}`} />
    {icon}
    <span className="font-mono text-xs">{label}</span>
  </div>
);

const LanguageSelector = ({ value, onChange, disabled }: { value: string; onChange: (lang: string) => void; disabled: boolean }) => {
  const languages = { 'en': 'English', 'es': 'Español', 'fr': 'Français', 'ar': 'العربية', 'hi': 'हिन्दी', 'zh': '中文', 'sw': 'Kiswahili', 'ta': 'தமிழ்', 'pt': 'Português', 'ru': 'Русский' };
  return (
    <div className="relative">
      <Languages className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
      <select value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} className="w-full pl-10 pr-4 py-2 text-sm bg-gray-900 border border-gray-700 rounded-md appearance-none focus:outline-none focus:ring-1 focus:ring-red-500 disabled:opacity-50">
        {Object.entries(languages).map(([code, name]) => <option key={code} value={code}>{name}</option>)}
      </select>
    </div>
  );
};

const UrlInput = ({ value, onChange, disabled }: { value: string; onChange: (url: string) => void; disabled: boolean }) => (
  <div className="relative">
    <Settings className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
    <input type="text" value={value} onChange={(e) => onChange(e.target.value)} className="input-dark pl-10" disabled={disabled} placeholder="Backend URL" />
  </div>
);

const Spinner = () => (
  <svg className="w-5 h-5 text-white animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
  </svg>
);
