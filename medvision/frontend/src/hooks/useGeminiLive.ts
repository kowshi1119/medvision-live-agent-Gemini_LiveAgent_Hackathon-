import { useState, useRef, useCallback } from 'react';
import { AgentMode, TriageCard, ConnState, LogEntry } from '../types';

interface GeminiLiveProps {
  backendUrl:           string
  language:             string
  captureFrame:         () => string | null
  onAgentModeChange?:   (mode: AgentMode) => void
  onTriageCard?:        (card: TriageCard) => void
  onVisualDetection?:   (detection: { condition: string; confidence: string; severity: string; observation: string }) => void
}

export interface GeminiLiveHook {
  connState:         ConnState
  triageCards:       TriageCard[]
  sessionLog:        LogEntry[]
  partialTranscript: string
  agentTranscript:   string
  connect:           () => Promise<void>
  disconnect:        () => void
  interrupt:         () => void
  sendAudio:         (b64: string) => void
  sendSpeechEvent:   (type: 'user_speech_start' | 'user_speech_end') => void
}

export function useGeminiLive(props: GeminiLiveProps): GeminiLiveHook {
  const { backendUrl, language, captureFrame, onAgentModeChange, onTriageCard, onVisualDetection } = props;
  const [connState, setConnState] = useState<ConnState>('disconnected');
  const [triageCards, setTriageCards] = useState<TriageCard[]>([]);
  const [sessionLog, setSessionLog] = useState<LogEntry[]>([]);
  const [partialTranscript, setPartialTranscript] = useState('');
  const [agentTranscript, setAgentTranscript] = useState('');
  const wsRef = useRef<WebSocket | null>(null);
  const videoIntervalRef = useRef<NodeJS.Timeout | null>(null);
  // Audio playback for agent voice
  const playbackCtxRef = useRef<AudioContext | null>(null);
  const nextPlayTimeRef = useRef<number>(0);
  // Ref-backed partial transcript so turn_complete can read current value across closures
  const partialRef = useRef<string>('');
  // Always-current captureFrame ref so the video interval never uses a stale closure
  const captureFrameRef = useRef<() => string | null>(captureFrame);
  captureFrameRef.current = captureFrame;

  const addLogEntry = (entry: Omit<LogEntry, 'timestamp'>) => {
    setSessionLog(prev => [...prev, { ...entry, timestamp: new Date().toISOString() }]);
  };

  const connect = useCallback(async () => {
    const wsUrl = backendUrl.replace(/^http/, 'ws') + '/live';
    setConnState('connecting');
    addLogEntry({ type: 'CONNECTION', message: `Connecting to ${wsUrl}` });

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    // Play a base64-encoded PCM16 24kHz chunk from Gemini using clock-based scheduling
    const playAudioChunk = (b64: string) => {
      try {
        if (!playbackCtxRef.current || playbackCtxRef.current.state === 'closed') {
          playbackCtxRef.current = new AudioContext({ sampleRate: 24000 });
          nextPlayTimeRef.current = 0;
        }
        const ctx = playbackCtxRef.current;
        if (ctx.state === 'suspended') ctx.resume();

        const binary = atob(b64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

        const pcm16 = new Int16Array(bytes.buffer);
        const float32 = new Float32Array(pcm16.length);
        for (let i = 0; i < pcm16.length; i++) {
          float32[i] = pcm16[i] / 32768;
        }

        const buffer = ctx.createBuffer(1, float32.length, 24000);
        buffer.copyToChannel(float32, 0);

        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(ctx.destination);

        // Schedule to play right after previous chunk (or immediately if behind)
        const startTime = Math.max(ctx.currentTime, nextPlayTimeRef.current);
        source.start(startTime);
        nextPlayTimeRef.current = startTime + buffer.duration;

        if (onAgentModeChange) onAgentModeChange('SPEAKING');
      } catch (e) {
        console.error('[useGeminiLive] Audio playback error:', e);
      }
    };

    ws.onopen = () => {
      setConnState('connected');
      addLogEntry({ type: 'CONNECTION', message: 'WebSocket connected' });
      ws.send(JSON.stringify({ type: 'config', language }));

      // Trigger greeting so agent speaks immediately on connect
      ws.send(JSON.stringify({
        type: 'text',
        data: 'Session connected. Please greet the user and confirm you can see and hear them.',
      }));

      if (videoIntervalRef.current) clearInterval(videoIntervalRef.current);
      videoIntervalRef.current = setInterval(() => {
        // Use ref so we always call the latest captureFrame, never a stale closure
        const frame = captureFrameRef.current();
        if (frame) {
          ws.send(JSON.stringify({ type: 'video', data: frame }));
        }
      }, 1500);  // 1.5s gives Gemini time to analyse each frame without overflow
    };

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      switch (msg.type) {

        case 'audio_chunk':
          // Agent speaking — play PCM audio from Gemini
          if (msg.data) playAudioChunk(msg.data);
          break;

        case 'transcript':
          // Streaming transcript chunks — accumulate until turn_complete
          if (msg.data) {
            partialRef.current += msg.data;
            setPartialTranscript(partialRef.current);
          }
          break;

        case 'user_transcript':
          // What the user said — add to session log
          if (msg.data) {
            addLogEntry({ type: 'CONNECTION', message: `You: ${msg.data}` });
          }
          break;

        case 'triage_card': {
          const card = msg.data as TriageCard;
          if (card) {
            setTriageCards(prev => [...prev, card]);
            if (onTriageCard) onTriageCard(card);
            addLogEntry({ type: 'TRIAGE', message: `Triage: ${card.condition}` });
          }
          break;
        }

        case 'status':
          if (msg.data === 'turn_complete') {
            // Finalize the streaming transcript into permanent history
            if (partialRef.current.trim()) {
              setAgentTranscript(prev => prev + partialRef.current + '\n');
            }
            partialRef.current = '';
            setPartialTranscript('');
            nextPlayTimeRef.current = 0;
            if (onAgentModeChange) onAgentModeChange('LISTENING');
          }
          addLogEntry({ type: 'CONNECTION', message: `Status: ${msg.data}` });
          break;

        case 'error':
          addLogEntry({ type: 'ERROR', message: msg.data || msg.message || 'Unknown error' });
          break;

        case 'visual_detection': {
          if (msg.data && onVisualDetection) {
            onVisualDetection(msg.data);
          }
          break;
        }

        default:
          console.log('[useGeminiLive] Unhandled message:', msg.type, msg);
      }
    };

    ws.onclose = () => {
      setConnState('disconnected');
      addLogEntry({ type: 'CONNECTION', message: 'WebSocket disconnected' });
      if (videoIntervalRef.current) clearInterval(videoIntervalRef.current);
    };

    ws.onerror = (error) => {
      console.error("WebSocket error:", error);
      addLogEntry({ type: 'ERROR', message: 'WebSocket error' });
    };
  // captureFrame intentionally excluded: captureFrameRef.current keeps it live
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backendUrl, language, onAgentModeChange, onTriageCard]);

  const disconnect = () => {
    wsRef.current?.close();
    // Close playback context to stop any queued audio immediately
    if (playbackCtxRef.current?.state !== 'closed') {
      playbackCtxRef.current?.close();
    }
    playbackCtxRef.current = null;
    nextPlayTimeRef.current = 0;
    partialRef.current = '';
    setPartialTranscript('');
  };

  const interrupt = () => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'interrupt' }));
      addLogEntry({ type: 'CONNECTION', message: 'Interrupt signal sent' });
    }
    // Stop playback immediately by closing and nulling the AudioContext
    if (playbackCtxRef.current?.state !== 'closed') {
      playbackCtxRef.current?.close();
    }
    playbackCtxRef.current = null;
    nextPlayTimeRef.current = 0;
    partialRef.current = '';
    setPartialTranscript('');
  };

  const sendAudio = useCallback((b64: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'audio', data: b64 }));
    } else {
      console.warn('[useGeminiLive] sendAudio called but WS not open, state:', wsRef.current?.readyState);
    }
  }, []);

  const sendSpeechEvent = useCallback((type: 'user_speech_start' | 'user_speech_end') => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type }));
    }
  }, []);

  return { connState, triageCards, sessionLog, partialTranscript, agentTranscript, connect, disconnect, interrupt, sendAudio, sendSpeechEvent };
}
