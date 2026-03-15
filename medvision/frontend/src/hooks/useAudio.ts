import { useCallback, useEffect, useRef, useState } from 'react';

export interface UseAudioReturn {
  isRecording: boolean;
  error: string | null;
  audioLevel: number;
  startRecording: (onChunk: (base64: string) => void) => Promise<void>;
  stopRecording: () => void;
  getAnalyserNode: () => AnalyserNode | null;
}

const SAMPLE_RATE = 16000;
const CHUNK_DURATION_MS = 250; // Send audio every 250ms

// Inline blob fallback — used only if /pcm-capture-processor.js can't be loaded.
const WORKLET_SOURCE = `
class PcmCaptureProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0]?.[0];
    if (ch && ch.length > 0) this.port.postMessage(ch.slice());
    return true;
  }
}
registerProcessor('pcm-capture-processor', PcmCaptureProcessor);
`;

export function useAudio(): UseAudioReturn {
  const contextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunkBufferRef = useRef<Float32Array[]>([]);
  const chunkTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const onChunkRef = useRef<((base64: string) => void) | null>(null);
  const rafActiveRef = useRef(false);
  const blobUrlRef = useRef<string | null>(null);

  const [isRecording, setIsRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [audioLevel, setAudioLevel] = useState(0);

  const startRecording = useCallback(async (onChunk: (base64: string) => void) => {
    setError(null);
    onChunkRef.current = onChunk;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: SAMPLE_RATE,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });

      streamRef.current = stream;

      const context = new AudioContext({ sampleRate: SAMPLE_RATE });
      contextRef.current = context;
      console.log('[MedVision Audio] AudioContext sampleRate:', context.sampleRate);

      if (context.state === 'suspended') {
        await context.resume();
        console.log('[MedVision Audio] AudioContext resumed');
      }

      // Register the PCM capture worklet.
      // Prefer the static public file (no CSP/blob restrictions); fall back to
      // an inline Blob URL if the file isn't reachable (e.g. production CDN).
      try {
        await context.audioWorklet.addModule('/pcm-capture-processor.js');
        console.log('[MedVision Audio] Worklet loaded from /pcm-capture-processor.js');
      } catch (e1) {
        console.warn('[MedVision Audio] Static worklet failed, trying blob URL:', e1);
        const blob = new Blob([WORKLET_SOURCE], { type: 'application/javascript' });
        const blobUrl = URL.createObjectURL(blob);
        blobUrlRef.current = blobUrl;
        await context.audioWorklet.addModule(blobUrl);
        console.log('[MedVision Audio] Worklet loaded from blob URL');
      }

      const source = context.createMediaStreamSource(stream);
      sourceRef.current = source;

      // Analyser for waveform visualisation
      const analyser = context.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.8;
      analyserRef.current = analyser;
      source.connect(analyser);

      // AudioWorkletNode captures PCM quanta and posts them to the main thread
      const workletNode = new AudioWorkletNode(context, 'pcm-capture-processor');
      workletNodeRef.current = workletNode;
      let quantaReceived = 0;
      workletNode.port.onmessage = (e: MessageEvent<Float32Array>) => {
        chunkBufferRef.current.push(e.data);
        quantaReceived += 1;
        if (quantaReceived === 1) {
          console.log('[MedVision Audio] ✅ Worklet is posting audio quanta — mic active');
        }
      };
      source.connect(workletNode);
      // Connect to destination keeps the node alive in the audio graph;
      // outputs are silent (processor never fills output buffers).
      workletNode.connect(context.destination);

      // Audio level monitoring
      rafActiveRef.current = true;
      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      const updateLevel = () => {
        if (!rafActiveRef.current || !analyserRef.current) return;
        analyserRef.current.getByteFrequencyData(dataArray);
        const avg = dataArray.reduce((sum, val) => sum + val, 0) / dataArray.length;
        setAudioLevel(avg / 255);
        requestAnimationFrame(updateLevel);
      };
      requestAnimationFrame(updateLevel);

      // Flush accumulated quanta to Gemini every CHUNK_DURATION_MS
      let chunksDispatched = 0;
      chunkTimerRef.current = setInterval(() => {
        if (chunkBufferRef.current.length === 0) return;

        const totalLen = chunkBufferRef.current.reduce((s, b) => s + b.length, 0);
        const combined = new Float32Array(totalLen);
        let offset = 0;
        for (const buf of chunkBufferRef.current) {
          combined.set(buf, offset);
          offset += buf.length;
        }
        chunkBufferRef.current = [];

        const pcm16 = float32ToInt16(combined);
        const base64 = arrayBufferToBase64(pcm16.buffer);
        chunksDispatched += 1;
        if (chunksDispatched % 20 === 1) {
          console.debug(`[MedVision Audio] Dispatching chunk #${chunksDispatched} (${totalLen} samples)`);
        }
        onChunkRef.current?.(base64);
      }, CHUNK_DURATION_MS);

      setIsRecording(true);
      console.log('[MedVision Audio] Recording started');
    } catch (err) {
      const message =
        err instanceof DOMException && err.name === 'NotAllowedError'
          ? 'Microphone permission denied — please allow microphone access'
          : err instanceof DOMException && err.name === 'NotFoundError'
          ? 'No microphone found — please connect a microphone'
          : err instanceof Error
          ? `Microphone error: ${err.message}`
          : 'Microphone unavailable';
      console.error('[MedVision Audio] startRecording failed:', err);
      setError(message);
      setIsRecording(false);
    }
  }, []);

  const stopRecording = useCallback(() => {
    rafActiveRef.current = false;

    if (chunkTimerRef.current) {
      clearInterval(chunkTimerRef.current);
      chunkTimerRef.current = null;
    }
    chunkBufferRef.current = [];

    if (workletNodeRef.current) {
      workletNodeRef.current.port.close();
      workletNodeRef.current.disconnect();
      workletNodeRef.current = null;
    }
    if (sourceRef.current) {
      sourceRef.current.disconnect();
      sourceRef.current = null;
    }
    if (contextRef.current) {
      void contextRef.current.close();
      contextRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
    }
    analyserRef.current = null;
    setIsRecording(false);
    setAudioLevel(0);
  }, []);

  const getAnalyserNode = useCallback((): AnalyserNode | null => {
    return analyserRef.current;
  }, []);

  useEffect(() => {
    return () => { stopRecording(); };
  }, [stopRecording]);

  return { isRecording, error, audioLevel, startRecording, stopRecording, getAnalyserNode };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function float32ToInt16(float32: Float32Array): Int16Array {
  const int16 = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return int16;
}

function arrayBufferToBase64(buffer: ArrayBufferLike): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
