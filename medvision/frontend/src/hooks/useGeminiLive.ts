import { useCallback, useEffect, useRef, useState } from 'react';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TriageCard {
  condition: string;
  priority: 'immediate' | 'urgent' | 'delayed';
  steps: string[];
  reference: string;
  timestamp: string;
}

export type ConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'interrupted'
  | 'error'
  | 'reconnecting';

export interface SessionLogEntry {
  id: string;
  ts: number;
  type: 'system' | 'transcript' | 'triage' | 'error' | 'info';
  content: string;
}

export interface UseGeminiLiveReturn {
  connectionState: ConnectionState;
  isSpeaking: boolean;
  transcript: string;
  partialTranscript: string;
  userTranscript: string;
  triageCards: TriageCard[];
  sessionLog: SessionLogEntry[];
  audioLevel: number;
  connect: (cloudRunUrl: string, language: string) => void;
  disconnect: () => void;
  interrupt: () => void;
  sendVideoFrame: (base64: string) => void;
  sendAudio: (base64: string) => void;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const BACKOFF_DELAYS = [1000, 2000, 4000, 8000, 16000, 30000];

// ── Hook ──────────────────────────────────────────────────────────────────────

// ── Audio playback (PCM-16 @ 24kHz from Gemini) ─────────────────────────────

// Schedules PCM-16 @ 24 kHz chunks sequentially so they play one after another
// instead of all starting at currentTime (which causes overlapping/fast audio).
function buildAudioPlayer() {
  let ctx: AudioContext | null = null;
  let nextStartTime = 0;

  function getCtx(): AudioContext {
    if (!ctx || ctx.state === 'closed') {
      ctx = new AudioContext({ sampleRate: 24000 });
      nextStartTime = 0;
    }
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  }

  function play(base64: string, onStart?: () => void, onEnd?: () => void) {
    try {
      const audioCtx = getCtx();
      const raw = atob(base64);
      const bytes = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
      const pcm16 = new Int16Array(bytes.buffer);
      const float32 = new Float32Array(pcm16.length);
      for (let i = 0; i < pcm16.length; i++) float32[i] = pcm16[i] / 32768.0;
      const buffer = audioCtx.createBuffer(1, float32.length, 24000);
      buffer.getChannelData(0).set(float32);
      const source = audioCtx.createBufferSource();
      source.buffer = buffer;
      source.connect(audioCtx.destination);

      const now = audioCtx.currentTime;
      const wasIdle = nextStartTime <= now;
      const startAt = wasIdle ? now : nextStartTime;
      nextStartTime = startAt + buffer.duration;

      // onStart fires only for the first chunk of a new sequence
      if (wasIdle) onStart?.();
      source.start(startAt);
      // onEnd fires only when the queue is fully drained
      source.onended = () => {
        if (audioCtx.currentTime >= nextStartTime - 0.05) onEnd?.();
      };
    } catch (e) {
      console.error('Audio playback error:', e);
    }
  }

  // Call after turn_complete so the next response starts fresh
  function reset() { nextStartTime = 0; }

  return { play, reset };
}

const audioPlayer = buildAudioPlayer();

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useGeminiLive(): UseGeminiLiveReturn {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const videoIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cloudRunUrlRef = useRef<string>('');
  const languageRef = useRef<string>('en');
  const mountedRef = useRef(true);
  const logIdRef = useRef(0);
  const speakingWatchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected');
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [partialTranscript, setPartialTranscript] = useState('');
  const [userTranscript, setUserTranscript] = useState('');
  const [triageCards, setTriageCards] = useState<TriageCard[]>([]);
  const [sessionLog, setSessionLog] = useState<SessionLogEntry[]>([]);
  const [audioLevel, setAudioLevel] = useState(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const addLog = useCallback((type: SessionLogEntry['type'], content: string) => {
    if (!mountedRef.current) return;
    const entry: SessionLogEntry = {
      id: String(++logIdRef.current),
      ts: Date.now(),
      type,
      content,
    };
    setSessionLog(prev => [...prev.slice(-199), entry]);
  }, []);

  const openWebSocket = useCallback(
    (url: string, language: string) => {
      if (!mountedRef.current) return;

      const wsUrl = url.replace(/^http/, 'ws') + '/live';
      setConnectionState('connecting');
      addLog('system', `Connecting to ${wsUrl}…`);

      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!mountedRef.current) return;
        reconnectAttemptsRef.current = 0;
        setConnectionState('connected');
        addLog('system', `WebSocket connected to ${wsUrl}`);
        console.log('=== MEDVISION CONNECTED ===', wsUrl);
        // Backend sends the proactive greeting — no frontend wake message needed.
        // Sending client_content while realtime_input audio is already streaming
        // caused a turn-management conflict that silenced the agent.
      };

      ws.onmessage = (event: MessageEvent<string>) => {
        if (!mountedRef.current) return;
        let msg: { type: string; data: unknown };
        try {
          msg = JSON.parse(event.data) as { type: string; data: unknown };
        } catch {
          return;
        }

        switch (msg.type) {
          case 'status': {
            const raw = msg.data;
            const text = typeof raw === 'string' ? raw : (raw as Record<string, string>).state ?? String(raw);
            console.log('STATUS:', text);
            if (text === 'turn_complete') {
              setIsSpeaking(false);
              setPartialTranscript('');
              setUserTranscript('');
              setAudioLevel(0);
              audioPlayer.reset();
              // Clear watchdog — turn ended cleanly
              if (speakingWatchdogRef.current) {
                clearTimeout(speakingWatchdogRef.current);
                speakingWatchdogRef.current = null;
              }
            }
            addLog('info', `Status: ${text}`);
            break;
          }

          case 'user_transcript': {
            const text = typeof msg.data === 'string' ? msg.data : '';
            if (text) {
              setUserTranscript(text);
              addLog('info', `You said: ${text.slice(0, 200)}`);
            }
            break;
          }

          case 'transcript': {
            // Backend sends plain string after our fix
            const raw = msg.data;
            const chunk = typeof raw === 'string' ? raw
              : (raw as { chunk?: string }).chunk ?? '';
            console.log('TRANSCRIPT:', chunk.slice(0, 60));
            setPartialTranscript(chunk);
            setIsSpeaking(true);
            setAudioLevel(Math.random() * 0.8 + 0.2);
            setTranscript(prev => prev + chunk + ' ');
            if (chunk) addLog('transcript', chunk.slice(0, 200));
            break;
          }

          case 'audio_chunk': {
            const chunkData = msg.data as string;
            audioPlayer.play(
              chunkData,
              () => { if (mountedRef.current) setIsSpeaking(true); },
              () => { if (mountedRef.current) setIsSpeaking(false); },
            );
            // Watchdog: if turn_complete never arrives (e.g. network glitch),
            // force-reset isSpeaking after 15 s so the mic isn't stuck gated.
            if (speakingWatchdogRef.current) clearTimeout(speakingWatchdogRef.current);
            speakingWatchdogRef.current = setTimeout(() => {
              if (mountedRef.current) {
                console.warn('isSpeaking watchdog fired — force-resetting mic gate');
                setIsSpeaking(false);
                audioPlayer.reset();
                speakingWatchdogRef.current = null;
              }
            }, 15000);
            break;
          }

          case 'triage_card': {
            const card = msg.data as TriageCard;
            setTriageCards(prev => [card, ...prev]);
            addLog('triage', `Triage card: ${card.condition} [${card.priority.toUpperCase()}]`);
            break;
          }

          case 'error': {
            const raw = msg.data;
            const errText = typeof raw === 'string' ? raw : (raw as { message?: string }).message ?? 'Unknown error';
            addLog('error', errText);
            console.error('Agent error:', errText);
            break;
          }
        }
      };

      ws.onerror = (ev) => {
        if (!mountedRef.current) return;
        console.error('WebSocket ERROR — is uvicorn running on 8082?', wsUrl, ev);
        addLog('error', `Connection failed — is backend running? (${wsUrl})`);
        setConnectionState('error');
        setIsSpeaking(false);
      };

      ws.onclose = (event) => {
        if (!mountedRef.current) return;
        setIsSpeaking(false);
        setAudioLevel(0);
        if (videoIntervalRef.current) {
          clearInterval(videoIntervalRef.current);
          videoIntervalRef.current = null;
        }
        const reason =
          event.code === 1006
            ? 'Backend unreachable — is uvicorn running on port 8082?'
            : event.code === 1011
            ? 'Backend crashed — check Python terminal for errors'
            : event.reason || `Code ${event.code}`;
        console.log('WebSocket CLOSED:', event.code, reason);
        addLog('system', `Disconnected (${event.code}): ${reason}`);

        if (event.code !== 1000 && mountedRef.current) {
          scheduleReconnect();
        } else {
          setConnectionState('disconnected');
        }
      };
    },
    [addLog]
  );

  const scheduleReconnect = useCallback(() => {
    if (!mountedRef.current) return;
    const attempt = reconnectAttemptsRef.current;
    const delay = BACKOFF_DELAYS[Math.min(attempt, BACKOFF_DELAYS.length - 1)];
    reconnectAttemptsRef.current += 1;
    setConnectionState('reconnecting');
    addLog('system', `Reconnecting in ${delay / 1000}s (attempt ${attempt + 1})…`);

    reconnectTimerRef.current = setTimeout(() => {
      if (mountedRef.current && cloudRunUrlRef.current) {
        openWebSocket(cloudRunUrlRef.current, languageRef.current);
      }
    }, delay);
  }, [addLog, openWebSocket]);

  const connect = useCallback(
    (cloudRunUrl: string, language: string) => {
      cloudRunUrlRef.current = cloudRunUrl;
      languageRef.current = language;
      reconnectAttemptsRef.current = 0;

      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close(1000);
      }

      setTranscript('');
      setPartialTranscript('');
      setTriageCards([]);
      setSessionLog([]);

      openWebSocket(cloudRunUrl, language);
    },
    [openWebSocket]
  );

  const disconnect = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
    }
    if (videoIntervalRef.current) {
      clearInterval(videoIntervalRef.current);
      videoIntervalRef.current = null;
    }
    reconnectAttemptsRef.current = Infinity; // Prevent auto-reconnect
    if (wsRef.current) {
      wsRef.current.send(JSON.stringify({ type: 'end_session' }));
      wsRef.current.close(1000);
      wsRef.current = null;
    }
    setConnectionState('disconnected');
    setIsSpeaking(false);
    setAudioLevel(0);
    addLog('system', 'Session ended');
  }, [addLog]);

  const interrupt = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'interrupt' }));
      setIsSpeaking(false);
      setPartialTranscript('');
      setAudioLevel(0);
      addLog('info', 'Interrupted');
    }
  }, [addLog]);

  const sendVideoFrame = useCallback((base64: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'video_frame', data: base64 }));
    }
  }, []);

  const sendAudio = useCallback(
    (base64: string) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'audio_chunk', data: base64 }));
        // Note: no addLog here — fires 4x/sec and spams the log
      }
    },
    []
  );

  return {
    connectionState,
    isSpeaking,
    transcript,
    partialTranscript,
    userTranscript,
    triageCards,
    sessionLog,
    audioLevel,
    connect,
    disconnect,
    interrupt,
    sendVideoFrame,
    sendAudio,
  };
}
