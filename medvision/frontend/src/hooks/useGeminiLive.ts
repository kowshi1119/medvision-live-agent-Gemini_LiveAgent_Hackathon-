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

export function useGeminiLive(): UseGeminiLiveReturn {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cloudRunUrlRef = useRef<string>('');
  const languageRef = useRef<string>('en');
  const mountedRef = useRef(true);
  const logIdRef = useRef(0);

  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected');
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [partialTranscript, setPartialTranscript] = useState('');
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
        addLog('system', 'WebSocket connected');

        // Send initial config
        ws.send(JSON.stringify({ type: 'config', language }));
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
            const data = msg.data as Record<string, string>;
            if (data.state === 'interrupted') {
              setConnectionState('interrupted');
              setTimeout(() => {
                if (mountedRef.current) setConnectionState('connected');
              }, 500);
            }
            addLog('info', `Status: ${data.state}`);
            break;
          }

          case 'transcript': {
            const data = msg.data as { chunk: string; partial: boolean; full?: string };
            if (data.partial) {
              setPartialTranscript(prev => prev + data.chunk);
              setIsSpeaking(true);
              // Simulate audio level from transcript activity
              setAudioLevel(Math.random() * 0.8 + 0.2);
            } else {
              setTranscript(prev => prev + (data.full ?? '') + '\n');
              setPartialTranscript('');
              setIsSpeaking(false);
              setAudioLevel(0);
              if (data.full) {
                addLog('transcript', data.full.slice(0, 120));
              }
            }
            break;
          }

          case 'audio_chunk': {
            setIsSpeaking(true);
            break;
          }

          case 'triage_card': {
            const card = msg.data as TriageCard;
            setTriageCards(prev => [card, ...prev]);
            addLog('triage', `Triage card: ${card.condition} [${card.priority.toUpperCase()}]`);
            break;
          }

          case 'error': {
            const data = msg.data as { message?: string };
            addLog('error', String(data.message ?? 'Unknown error'));
            break;
          }
        }
      };

      ws.onerror = () => {
        if (!mountedRef.current) return;
        addLog('error', 'WebSocket error');
        setConnectionState('error');
        setIsSpeaking(false);
      };

      ws.onclose = (event) => {
        if (!mountedRef.current) return;
        setIsSpeaking(false);
        setAudioLevel(0);
        addLog('system', `WebSocket closed (code ${event.code})`);

        if (event.code !== 1000 && mountedRef.current) {
          // Abnormal close — attempt reconnect with backoff
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
        addLog('info', 'Audio chunk sent');
      }
    },
    [addLog]
  );

  return {
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
  };
}
