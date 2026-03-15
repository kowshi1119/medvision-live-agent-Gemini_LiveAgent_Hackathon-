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

// AudioWorklet source — runs in the dedicated audio thread.
// Each process() call receives a 128-sample quantum; we post it straight to
// the main thread so the existing setInterval flush logic is unchanged.
const WORKLET_SOURCE = `
class PcmCaptureProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0]?.[0];
    if (ch) this.port.postMessage(ch.slice());
    return true; // keep processor alive
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
  // Controls the rAF audio-level loop — avoids the old _activeRef hack on the node
  const rafActiveRef = useRef(false);
  // Blob URL created for the worklet module — revoked on cleanup
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
      // AudioContext can start 'suspended' when created outside a direct
      // user-gesture handler. Resume it so the worklet actually processes.
      if (context.state === 'suspended') await context.resume();

      // Register the PCM capture worklet via an inline Blob URL
      const blob = new Blob([WORKLET_SOURCE], { type: 'application/javascript' });
      const blobUrl = URL.createObjectURL(blob);
      blobUrlRef.current = blobUrl;
      await context.audioWorklet.addModule(blobUrl);

      const source = context.createMediaStreamSource(stream);
      sourceRef.current = source;

      // Analyser for waveform visualisation
      const analyser = context.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.8;
      analyserRef.current = analyser;
      source.connect(analyser);

      // AudioWorkletNode replaces the deprecated ScriptProcessorNode
      const workletNode = new AudioWorkletNode(context, 'pcm-capture-processor');
      workletNodeRef.current = workletNode;
      workletNode.port.onmessage = (e: MessageEvent<Float32Array>) => {
        chunkBufferRef.current.push(e.data);
      };
      source.connect(workletNode);
      // Connect to destination so the node is alive in the audio graph.
      // Outputs are silent (the processor never fills output buffers).
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
    // Stop rAF level loop
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
