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

export function useAudio(): UseAudioReturn {
  const contextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunkBufferRef = useRef<Float32Array[]>([]);
  const chunkTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const onChunkRef = useRef<((base64: string) => void) | null>(null);

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

      const source = context.createMediaStreamSource(stream);
      sourceRef.current = source;

      // Analyser for waveform visualisation
      const analyser = context.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.8;
      analyserRef.current = analyser;
      source.connect(analyser);

      // Script processor for raw PCM capture
      const processor = context.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;

      processor.onaudioprocess = (event: AudioProcessingEvent) => {
        const inputBuffer = event.inputBuffer.getChannelData(0);
        chunkBufferRef.current.push(new Float32Array(inputBuffer));
      };

      source.connect(processor);
      processor.connect(context.destination);

      // Audio level monitoring — use a ref so the loop doesn't
      // capture a stale `isRecording` value
      const activeRef = { current: true };
      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      const updateLevel = () => {
        if (!activeRef.current || !analyserRef.current) return;
        analyserRef.current.getByteFrequencyData(dataArray);
        const avg = dataArray.reduce((sum, val) => sum + val, 0) / dataArray.length;
        setAudioLevel(avg / 255);
        requestAnimationFrame(updateLevel);
      };
      requestAnimationFrame(updateLevel);

      // Store ref for cleanup
      (processorRef as React.MutableRefObject<ScriptProcessorNode & { _activeRef?: { current: boolean } }>).current!._activeRef = activeRef;

      // Flush buffer at regular intervals
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

        // Convert Float32 PCM to Int16 PCM (16-bit signed)
        const pcm16 = float32ToInt16(combined);
        const base64 = arrayBufferToBase64(pcm16.buffer);
        onChunkRef.current?.(base64);
      }, CHUNK_DURATION_MS);

      setIsRecording(true);
    } catch (err) {
      const message =
        err instanceof DOMException
          ? `Microphone access denied: ${err.message}`
          : 'Microphone unavailable';
      setError(message);
      setIsRecording(false);
    }
  }, []);

  const stopRecording = useCallback(() => {
    if (chunkTimerRef.current) {
      clearInterval(chunkTimerRef.current);
      chunkTimerRef.current = null;
    }
    chunkBufferRef.current = [];

    if (processorRef.current) {
      // Stop the rAF level loop
      const p = processorRef.current as ScriptProcessorNode & { _activeRef?: { current: boolean } };
      if (p._activeRef) p._activeRef.current = false;
      processorRef.current.disconnect();
      processorRef.current = null;
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
    analyserRef.current = null;
    setIsRecording(false);
    setAudioLevel(0);
  }, []);

  const getAnalyserNode = useCallback((): AnalyserNode | null => {
    return analyserRef.current;
  }, []);

  useEffect(() => {
    return () => {
      stopRecording();
    };
  }, [stopRecording]);

  return {
    isRecording,
    error,
    audioLevel,
    startRecording,
    stopRecording,
    getAnalyserNode,
  };
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
