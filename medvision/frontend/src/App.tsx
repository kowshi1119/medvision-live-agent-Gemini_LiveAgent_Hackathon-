import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
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
    partialTranscript,
    userTranscript,
    triageCards,
    sessionLog,
    connect,
    disconnect,
    interrupt,
    sendAudio,
    sendVideoFrame,
  } = useGeminiLive();

  const { isActive: isCameraOn, startCamera, stopCamera, captureFrame, videoRef } = useCamera();
  const { isRecording: isMicOn, startRecording: startMic, stopRecording: stopMic } = useAudio();

  // Gate mic audio: do NOT send while agent is speaking.
  // Without this, the speaker output is picked up by the mic and sent back
  // to Gemini, breaking its VAD so it never detects end-of-speech.
  const isSpeakingRef = useRef(false);
  useEffect(() => { isSpeakingRef.current = isSpeaking; }, [isSpeaking]);
  const sendAudioGated = useCallback(
    (base64: string) => { if (!isSpeakingRef.current) sendAudio(base64); },
    [sendAudio]
  );

  // Send video frames to Gemini while connected and camera is active
  const captureFrameRef = useRef(captureFrame);
  captureFrameRef.current = captureFrame;
  const sendVideoFrameRef = useRef(sendVideoFrame);
  sendVideoFrameRef.current = sendVideoFrame;

  useEffect(() => {
    if (connectionState !== 'connected' || !isCameraOn) return;
    const interval = setInterval(() => {
      const frame = captureFrameRef.current();
      if (frame) sendVideoFrameRef.current(frame);
    }, 500); // 2 fps — good balance of visual context vs bandwidth
    return () => clearInterval(interval);
  }, [connectionState, isCameraOn]);

  // Restart mic + camera whenever the WS connection (re-)establishes —
  // covers both the initial connect and background auto-reconnects.
  useEffect(() => {
    if (connectionState === 'connected') {
      if (!isCameraOn) startCamera();
      if (!isMicOn)    startMic(sendAudioGated);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionState]); // intentionally omit stable refs to avoid double-start

  const handleSessionToggle = () => {
    if (connectionState === 'connected') {
      disconnect();
      stopCamera();
      stopMic();
    } else if (connectionState !== 'connecting') {
      // Works from any non-active state: disconnected, error, reconnecting
      connect(cloudRunUrl, language);
      startCamera();
      startMic(sendAudioGated);
    }
  };

  const clearSession = () => {
    // This should be implemented in useGeminiLive, but for now we'll do it here
    // setTriageCards([]);
    // setSessionLog([]);
  };

  const mappedSessionLog = useMemo((): LogEntry[] => {
    return sessionLog.map((entry: SessionLogEntry) => ({
      type: entry.type === 'system' ? 'info' : entry.type === 'transcript' ? 'user' : entry.type,
      message: entry.content,
      timestamp: new Date(entry.ts).toISOString(),
    }));
  }, [sessionLog]);

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
    a.click();
    URL.revokeObjectURL(url);
  };

  // Mock latency
  const latency = connectionState === 'connected' ? Math.floor(Math.random() * 50) + 20 : 0;

  return (
    <div className="flex flex-col h-screen bg-[#0A0A0F] text-slate-100 font-sans overflow-hidden">
      <AppHeader connectionState={connectionState} latency={latency} />
      <main className="grid flex-1 grid-cols-1 gap-3 p-3 lg:grid-cols-[320px_1fr_280px] overflow-hidden">
        <LeftPanel isCameraOn={isCameraOn} isMicOn={isMicOn} videoRef={videoRef} />
        <CenterPanel
          isSpeaking={isSpeaking}
          transcript={transcript}
          partialTranscript={partialTranscript}
          userTranscript={userTranscript}
          triageCards={triageCards}
          isConnected={connectionState === 'connected'}
          onInterrupt={interrupt}
        />
        <RightPanel
          connectionState={connectionState}
          onSessionToggle={handleSessionToggle}
          language={language}
          onLanguageChange={setLanguage}
          cloudRunUrl={cloudRunUrl}
          onCloudRunUrlChange={setCloudRunUrl}
          sessionLog={mappedSessionLog}
          onClearLog={clearSession}
          onDownloadReport={handleDownloadReport}
        />
      </main>
    </div>
  );
}

// --- Sub-components for layout ---

const AppHeader = ({ connectionState, latency }: { connectionState: string; latency: number }) => (
  <header className="flex items-center justify-between h-12 px-4 border-b border-[rgba(255,255,255,0.08)] shrink-0">
    <div className="flex items-center gap-2">
      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#EF4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 5v14M5 12h14" />
      </svg>
      <h1 className="text-lg font-bold text-white">MedVision</h1>
      <span className="text-xs text-slate-500">v1.0</span>
    </div>
    <div className="hidden md:block">
      <p className="text-xs tracking-widest text-gray-500 uppercase">Emergency Medical AI Agent</p>
    </div>
    <div className="flex items-center gap-2">
      <StatusBar connectionState={connectionState} />
      <span className="text-xs text-slate-400">{latency > 0 ? `${latency}ms` : '...'}</span>
    </div>
  </header>
);

const LeftPanel = ({ isCameraOn, isMicOn, videoRef }: { isCameraOn: boolean; isMicOn: boolean; videoRef: React.RefObject<HTMLVideoElement> }) => (
  <div className="flex-col hidden gap-3 lg:flex">
    <div className="flex-1 card">
      <CameraFeed videoRef={videoRef} />
    </div>
    <div className="flex items-center justify-around p-2 card">
      <StatusPill label="VISION" active={isCameraOn} />
      <StatusPill label="AUDIO" active={isMicOn} />
      <StatusPill label="GROUNDED" active={true} />
    </div>
  </div>
);

const CenterPanel = ({ isSpeaking, transcript, partialTranscript, userTranscript, triageCards, isConnected, onInterrupt }: { isSpeaking: boolean; transcript: string; partialTranscript: string; userTranscript: string; triageCards: TriageData[]; isConnected: boolean; onInterrupt: () => void; }) => (
  <div className="relative flex flex-col gap-3 overflow-hidden">
    <div className="flex flex-col flex-1 gap-3 p-4 card overflow-hidden">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-300">CONVERSATION</h2>
        {isSpeaking && (
          <div className="flex items-center gap-2">
            <span className="relative flex w-2 h-2">
              <span className="absolute inline-flex w-full h-full bg-red-500 rounded-full opacity-75 animate-ping"></span>
              <span className="relative inline-flex w-2 h-2 bg-red-600 rounded-full"></span>
            </span>
            <span className="text-xs font-semibold tracking-wider text-red-500">SPEAKING</span>
          </div>
        )}
      </div>
      <AgentVoiceBar isSpeaking={isSpeaking} />
      {/* User's voice query */}
      {userTranscript && (
        <div className="px-3 py-2 rounded-lg bg-slate-800/60 border border-slate-700/50">
          <p className="text-xs text-slate-400 mb-1">YOU</p>
          <p className="text-sm text-slate-200">{userTranscript}</p>
        </div>
      )}
      {/* Agent's response — show partial (rolling) while speaking, final when done */}
      <div className="flex-1 overflow-y-auto">
        <p className="text-xs text-slate-400 mb-1">MEDVISION</p>
        <p className="text-base text-slate-100">
          {isSpeaking && partialTranscript ? partialTranscript : (transcript || '…')}
        </p>
      </div>
    </div>
    <div className="flex flex-col flex-1 gap-3 p-4 overflow-hidden card">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-300">TRIAGE CARDS</h2>
        {triageCards.length > 0 && (
          <div className="flex items-center justify-center w-5 h-5 text-xs font-bold text-white bg-red-600 rounded-full">
            {triageCards.length}
          </div>
        )}
      </div>
      <div className="flex-1 overflow-y-auto">
        {triageCards.length === 0 ? (
          <div className="flex items-center justify-center h-full border-2 border-dashed rounded-lg border-slate-700">
            <p className="text-sm text-slate-500">Triage cards will appear here</p>
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
      <button
        onClick={onInterrupt}
        className="absolute bottom-0 w-full py-3 text-base font-bold text-white transition-colors bg-red-600 btn hover:bg-red-700 active:bg-red-800"
      >
        INTERRUPT AGENT
      </button>
    )}
  </div>
);

const RightPanel = ({
  connectionState, onSessionToggle, language, onLanguageChange, cloudRunUrl, onCloudRunUrlChange, sessionLog, onClearLog, onDownloadReport
}: {
  connectionState: string; onSessionToggle: () => void; language: string; onLanguageChange: (lang: string) => void; cloudRunUrl: string; onCloudRunUrlChange: (url: string) => void; sessionLog: LogEntry[]; onClearLog: () => void; onDownloadReport: () => void;
}) => {
  const sessionButtonContent = useMemo(() => {
    switch (connectionState) {
      case 'connecting':
        return <><Spinner /> CONNECTING...</>;
      case 'connected':
        return 'END SESSION';
      default:
        return 'START SESSION';
    }
  }, [connectionState]);

  const sessionButtonClass = useMemo(() => {
    switch (connectionState) {
      case 'connected':
        return 'btn-danger relative';
      default:
        return 'btn-secondary';
    }
  }, [connectionState]);

  return (
    <div className="flex flex-col gap-3">
      <div className="p-4 card">
        <button
          onClick={onSessionToggle}
          disabled={connectionState === 'connecting'}
          className={`w-full btn flex items-center justify-center gap-2 ${sessionButtonClass}`}
        >
          {connectionState === 'connected' && <div className="absolute w-full h-full rounded-md pulse-ring bg-red-500/50" />}
          {sessionButtonContent}
        </button>
        <LanguageSelector value={language} onChange={onLanguageChange} disabled={connectionState !== 'disconnected'} />
      </div>
      <div className="p-4 card">
        <label htmlFor="cloud-run-url" className="block mb-1 text-xs text-slate-400">Backend URL</label>
        <input
          id="cloud-run-url"
          type="text"
          value={cloudRunUrl}
          onChange={(e) => onCloudRunUrlChange(e.target.value)}
          className="input-dark"
          disabled={connectionState !== 'disconnected'}
        />
      </div>
      <div className="flex flex-col flex-1 p-4 overflow-hidden card">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-semibold text-slate-300">SESSION LOG</h2>
          <button onClick={onClearLog} className="text-xs text-slate-500 hover:text-slate-300">Clear</button>
        </div>
        <div className="flex-1 overflow-y-auto">
          <SessionLog log={sessionLog} />
        </div>
        <button onClick={onDownloadReport} className="w-full mt-2 btn btn-secondary">
          DOWNLOAD REPORT
        </button>
      </div>
    </div>
  );
};

// --- Helper Components ---

const StatusPill = ({ label, active }: { label: string; active: boolean }) => (
  <div className="flex items-center gap-2 px-3 py-1 text-xs font-semibold rounded-full bg-slate-800 text-slate-300">
    <div className={`w-2 h-2 rounded-full ${active ? 'bg-green-500' : 'bg-slate-600'}`} />
    {label}
  </div>
);

const LanguageSelector = ({ value, onChange, disabled }: { value: string; onChange: (lang: string) => void; disabled: boolean }) => {
  const languages = {
    'en': 'English', 'es': 'Español', 'fr': 'Français', 'ar': 'العربية', 'hi': 'हिन्दी',
    'zh': '中文', 'sw': 'Kiswahili', 'ta': 'தமிழ்', 'pt': 'Português', 'ru': 'Русский'
  };

  return (
    <div className="relative mt-2">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="w-full px-3 py-2 text-sm bg-gray-900 border border-gray-700 rounded-md appearance-none focus:outline-none focus:ring-1 focus:ring-red-500 disabled:opacity-50"
      >
        {Object.entries(languages).map(([code, name]) => (
          <option key={code} value={code}>{name}</option>
        ))}
      </select>
      <div className="absolute inset-y-0 right-0 flex items-center px-2 pointer-events-none">
        <svg className="w-4 h-4 fill-current text-slate-500" viewBox="0 0 20 20"><path d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" /></svg>
      </div>
    </div>
  );
};

const Spinner = () => (
  <svg className="w-4 h-4 text-white animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
  </svg>
);
