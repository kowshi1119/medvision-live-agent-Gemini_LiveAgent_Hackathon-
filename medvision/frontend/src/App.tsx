import React, { useState, useEffect, useCallback } from 'react';
import { AgentMode, Severity, ConnState, TriageCard, LogEntry } from './types';
import { useAudio } from './hooks/useAudio';
import { useCamera } from './hooks/useCamera';
import { useGeminiLive } from './hooks/useGeminiLive';
import { CameraFeed } from './components/CameraFeed';
import { MicControl } from './components/MicControl';
import { AgentVoiceBar } from './components/AgentVoiceBar';
import { TriageCard as TriageCardComponent } from './components/TriageCard';
import { SessionLog } from './components/SessionLog';
import { StatusBar } from './components/StatusBar';

const LANGUAGES = [
  {code:'en',label:'English'}, {code:'es',label:'Español'},
  {code:'fr',label:'Français'}, {code:'ar',label:'العربية'},
  {code:'hi',label:'हिन्दी'}, {code:'zh',label:'中文'},
  {code:'sw',label:'Kiswahili'}, {code:'ta',label:'தமிழ்'},
  {code:'pt',label:'Português'}, {code:'ru',label:'Русский'},
];

const App: React.FC = () => {
  const [sessionActive, setSessionActive] = useState(false);
  const [agentMode, setAgentMode] = useState<AgentMode>('STANDBY');
  const [maxSeverity, setMaxSeverity] = useState<Severity>('GREEN');
  const [sevFlash, setSevFlash] = useState(false);
  const [language, setLanguage] = useState('en');
  const [backendUrl, setBackendUrl] = useState('http://localhost:8081');
  const [seconds, setSeconds] = useState(0);

  const { isMuted, audioLevel, toggleMute, startAudio, stopAudio } = useAudio();
  const { isCameraOn, videoRef, toggleCamera, startCamera, stopCamera, captureFrame } = useCamera();

  const onTriageCard = (card: TriageCard) => {
    const newSeverity = card.priority === 'immediate' ? 'RED' : card.priority === 'urgent' ? 'YELLOW' : 'GREEN';
    if (newSeverity === 'RED' || (newSeverity === 'YELLOW' && maxSeverity !== 'RED')) {
      setMaxSeverity(newSeverity);
      setSevFlash(true);
      setTimeout(() => setSevFlash(false), 700);
    }
  };

  const onVisualDetection = useCallback((detection: { condition: string; confidence: string; severity: string; observation: string }) => {
    const sev = detection.severity;
    if (sev === 'immediate') {
      setMaxSeverity('RED');
      setSevFlash(true);
      setTimeout(() => setSevFlash(false), 700);
    } else if (sev === 'urgent') {
      setMaxSeverity(prev => prev !== 'RED' ? 'YELLOW' : prev);
      setSevFlash(true);
      setTimeout(() => setSevFlash(false), 700);
    }
  }, []);

  const { connState, triageCards, sessionLog, partialTranscript, agentTranscript, connect, disconnect, interrupt, sendAudio, sendSpeechEvent } = useGeminiLive({
    backendUrl,
    language,
    captureFrame,
    onAgentModeChange: setAgentMode,
    onTriageCard,
    onVisualDetection,
  });

const handleStart = useCallback(async () => {
      try {
        await connect();
        await startCamera();
        await startAudio(
          (b64: string) => { sendAudio(b64); },
          (evtType) => { sendSpeechEvent(evtType); },
        );
        setSessionActive(true);
        setMaxSeverity('GREEN');
      } catch (err) {
        console.error('[App] Session start failed:', err);
        alert('Failed to start: ' + (err as Error).message);
      }
    }, [connect, startCamera, startAudio, sendAudio, sendSpeechEvent]);

  const handleEnd = () => {
    disconnect();
    stopAudio();
    stopCamera();
    setSessionActive(false);
    setSeconds(0);
  };

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement) {
      return;
    }
    if (e.code === 'Space') {
      e.preventDefault();
      toggleMute();
    } else if (e.code === 'Escape') {
      interrupt();
    } else if (e.key.toLowerCase() === 'm') {
      toggleMute();
    }
  }, [toggleMute, interrupt]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (sessionActive) {
      timer = setInterval(() => setSeconds(s => s + 1), 1000);
    }
    return () => clearInterval(timer);
  }, [sessionActive]);

  const formatTime = (totalSeconds: number) => {
    const mins = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
    const secs = (totalSeconds % 60).toString().padStart(2, '0');
    return `${mins}:${secs}`;
  };

  const severityConfig = {
    RED: { color: 'var(--red)', label: '🔴 CRITICAL', animation: 'glowR 2s infinite' },
    YELLOW: { color: 'var(--yellow)', label: '⚠ URGENT', animation: '' },
    GREEN: { color: 'var(--green)', label: '● STABLE', animation: '' },
  };

  const agentModeConfig = {
    STANDBY: { text: '◌ STANDBY', color: 'var(--dim)' },
    LISTENING: { text: '● LISTENING', color: 'var(--blue)' },
    SPEAKING: { text: '◎ SPEAKING', color: 'var(--green)' },
  };

  return (
    <div style={{position:'fixed',inset:0,display:'flex',
                 flexDirection:'column',background:'var(--bg)',
                 overflow:'hidden',zIndex:1}}>

      <header style={{flexShrink:0,height:56,display:'flex',
                      alignItems:'center',gap:12,padding:'0 20px',
                      borderBottom:'1px solid var(--border)',
                      background:'rgba(13,18,32,0.97)',
                      backdropFilter:'blur(10px)',zIndex:10}}>
        <h1 style={{fontFamily:"'Chakra Petch',sans-serif", fontWeight:700, fontSize:18}}>🩺 MEDVISION</h1>
        <div style={{fontFamily:"'Space Mono',monospace", color: sessionActive ? 'var(--blue)' : 'var(--dim)'}}>
          {formatTime(seconds)}
        </div>
        <div style={{
            border: `1px solid ${severityConfig[maxSeverity].color}`,
            color: severityConfig[maxSeverity].color,
            padding: '2px 8px',
            borderRadius: 4,
            fontSize: 10,
            fontWeight: 'bold',
            animation: sevFlash ? 'sevFlash 0.7s ease-in-out' : severityConfig[maxSeverity].animation,
        }}>
          {severityConfig[maxSeverity].label}
        </div>
        <div style={{flex:1}}></div>
        <select value={language} onChange={e => setLanguage(e.target.value)} style={{background:'var(--surface)', border:'1px solid var(--border)', color:'var(--bright)', padding:'4px 8px', borderRadius:4}}>
          {LANGUAGES.map(lang => <option key={lang.code} value={lang.code}>{lang.label}</option>)}
        </select>
        {sessionActive && <button onClick={interrupt} style={{background:'var(--yellow)', color:'black', padding:'4px 12px', borderRadius:4, fontWeight:'bold'}}>INTERRUPT</button>}
        <button onClick={sessionActive ? handleEnd : handleStart} style={{background: sessionActive ? 'var(--red)' : 'var(--green)', color:'black', padding:'4px 12px', borderRadius:4, fontWeight:'bold'}}>
          {sessionActive ? 'END SESSION' : '▶ START SESSION'}
        </button>
      </header>

      <main style={{flex:1,minHeight:0,display:'flex',
                    flexDirection:'row',overflow:'hidden',zIndex:1}}>

        <aside style={{width:300,flexShrink:0,display:'flex',
                       flexDirection:'column',overflow:'hidden',
                       borderRight:'1px solid var(--border)'}}>
          <div style={{padding:12, flexShrink:0}}>
            <CameraFeed videoRef={videoRef} isCameraOn={isCameraOn} toggleCamera={toggleCamera} isSpeaking={agentMode === 'SPEAKING'} />
          </div>
          <div style={{flex:1, minHeight:0, overflowY:'auto', padding: '0 12px'}}>
            {triageCards.map((card, i) => <TriageCardComponent key={i} card={card} />)}
          </div>
          <div style={{flexShrink:0, borderTop:'1px solid var(--border)', display:'flex', justifyContent:'center', padding:'12px 0'}}>
            <MicControl isActive={sessionActive} isMuted={isMuted} audioLevel={audioLevel} onToggleMute={toggleMute} />
          </div>
        </aside>

        <section style={{flex:1,minWidth:0,display:'flex',
                         flexDirection:'column',overflow:'hidden'}}>
          <div style={{flexShrink:0, textAlign:'center', fontFamily:"'Chakra Petch',sans-serif", fontSize:36, color:agentModeConfig[agentMode].color, padding:'16px 0'}}>
            {agentModeConfig[agentMode].text}
          </div>
          <div style={{flexShrink:0}}>
            <AgentVoiceBar audioLevel={agentMode === 'SPEAKING' ? 0.5 : audioLevel} agentMode={agentMode} partialTranscript={partialTranscript} />
          </div>
          <div style={{flex:1, minHeight:0, overflowY:'auto', padding: '0 24px', fontFamily:"'JetBrains Mono',monospace", fontSize:14, color:'var(--bright)', whiteSpace:'pre-wrap'}}>
            {agentTranscript}
          </div>
        </section>

        <aside style={{width:280,flexShrink:0,display:'flex',
                       flexDirection:'column',overflow:'hidden',
                       borderLeft:'1px solid var(--border)'}}>
            <div style={{flexShrink:0, padding:12, borderBottom:'1px solid var(--border)'}}>
                <label style={{fontSize:10, color:'var(--dim)', display:'block', marginBottom:4}}>Backend URL</label>
                <input type="text" value={backendUrl} onChange={e => setBackendUrl(e.target.value)} style={{width:'100%', background:'var(--surface)', border:'1px solid var(--border)', color:'var(--bright)', padding:'4px 8px', borderRadius:4}}/>
            </div>
          <div style={{flex:1, minHeight:0, overflow:'hidden'}}>
            <SessionLog entries={sessionLog} />
          </div>
        </aside>

      </main>

      <footer style={{flexShrink:0,height:32,display:'flex',
                      alignItems:'center',justifyContent:'space-between',
                      padding:'0 16px',borderTop:'1px solid var(--border)',
                      background:'var(--panel)'}}>
        <StatusBar connState={connState} />
      </footer>

    </div>
  );
};

export default App;
