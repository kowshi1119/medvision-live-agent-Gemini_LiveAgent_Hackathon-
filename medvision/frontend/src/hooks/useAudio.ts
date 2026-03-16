import { useState, useRef, useCallback, useEffect } from 'react';

export interface AudioHook {
  isMuted:    boolean
  audioLevel: number
  toggleMute: () => void
  startAudio: (onChunk: (b64: string) => void, onSpeechEvent?: (type: 'user_speech_start' | 'user_speech_end') => void) => Promise<void>
  stopAudio:  () => void
}

export function useAudio(): AudioHook {
  const [isMuted,    setIsMuted]    = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);

  const ctxRef       = useRef<AudioContext | null>(null);
  const streamRef    = useRef<MediaStream | null>(null);
  const workletRef   = useRef<AudioWorkletNode | null>(null);
  const analyserRef  = useRef<AnalyserNode | null>(null);
  const rafRef       = useRef<number>(0);
  const mutedRef     = useRef(false);
  const onChunkRef   = useRef<((b64: string) => void) | null>(null);
  // Speech activity detection
  const speechActiveRef    = useRef(false);
  const silenceTimerRef    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onSpeechEventRef   = useRef<((type: 'user_speech_start' | 'user_speech_end') => void) | null>(null);

  const startAudio = useCallback(async (onChunk: (b64: string) => void, onSpeechEvent?: (type: 'user_speech_start' | 'user_speech_end') => void) => {
    onChunkRef.current = onChunk;
    onSpeechEventRef.current = onSpeechEvent ?? null;

    try {
      // 1. Request mic permission
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        }
      });
      streamRef.current = stream;

      // 2. Create AudioContext at 16kHz for Gemini
      const ctx = new AudioContext({ sampleRate: 16000 });
      ctxRef.current = ctx;

      // 3. Resume context (required — browsers suspend until user gesture)
      if (ctx.state === 'suspended') {
        await ctx.resume();
      }

      // 4. Load AudioWorklet processor
      await ctx.audioWorklet.addModule('/pcm-capture-processor.js');
      console.log('[useAudio] AudioWorklet loaded');

      // 5. Create nodes
      const source   = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyserRef.current = analyser;

      const worklet = new AudioWorkletNode(ctx, 'pcm-capture-processor');
      workletRef.current = worklet;

      // 6. Receive PCM chunks from worklet → convert to base64 → fire callback
      worklet.port.onmessage = (event) => {
        if (mutedRef.current) return;
        if (!onChunkRef.current) return;

        const pcm16Buffer = event.data.pcm16 as ArrayBuffer;

        // ArrayBuffer → base64 in chunks to avoid call stack overflow
        const uint8  = new Uint8Array(pcm16Buffer);
        let binary   = '';
        const step   = 8192;
        for (let i = 0; i < uint8.length; i += step) {
          binary += String.fromCharCode(...uint8.subarray(i, i + step));
        }
        onChunkRef.current(btoa(binary));
      };

      // 7. Connect audio graph
      source.connect(analyser);
      source.connect(worklet);
      // Note: worklet does NOT need to connect to destination for processing to work

      // 8. RAF loop for visual level meter
      const tick = () => {
        const data = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(data);
        const avg = data.reduce((s, v) => s + v, 0) / data.length;
        const level = Math.min(avg / 80, 1);
        setAudioLevel(level);

        // Speech activity detection: level > 0.02 = speaking
        if (!mutedRef.current && onSpeechEventRef.current) {
          const isSpeaking = level > 0.02;
          if (isSpeaking && !speechActiveRef.current) {
            // Transitioned to speaking
            speechActiveRef.current = true;
            if (silenceTimerRef.current) { clearTimeout(silenceTimerRef.current); silenceTimerRef.current = null; }
            onSpeechEventRef.current('user_speech_start');
          } else if (!isSpeaking && speechActiveRef.current) {
            // Transitioned to silence — debounce 1500ms before calling speech_end
            if (!silenceTimerRef.current) {
              silenceTimerRef.current = setTimeout(() => {
                if (speechActiveRef.current) {
                  speechActiveRef.current = false;
                  if (onSpeechEventRef.current) onSpeechEventRef.current('user_speech_end');
                }
                silenceTimerRef.current = null;
              }, 1500);
            }
          }
        }

        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);

      console.log('[useAudio] Started successfully — sampleRate:', ctx.sampleRate);

    } catch (err: unknown) {
      console.error('[useAudio] Failed:', err);
      throw err;
    }
  }, []);

  const stopAudio = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    if (silenceTimerRef.current) { clearTimeout(silenceTimerRef.current); silenceTimerRef.current = null; }
    workletRef.current?.port.close();
    workletRef.current?.disconnect();
    streamRef.current?.getTracks().forEach(t => t.stop());
    ctxRef.current?.close();

    ctxRef.current         = null;
    streamRef.current      = null;
    workletRef.current     = null;
    analyserRef.current    = null;
    onChunkRef.current     = null;
    onSpeechEventRef.current = null;
    speechActiveRef.current  = false;

    setIsMuted(false);
    setAudioLevel(0);
    mutedRef.current = false;

    console.log('[useAudio] Stopped');
  }, []);

  const toggleMute = useCallback(() => {
    mutedRef.current = !mutedRef.current;
    setIsMuted(mutedRef.current);
    // Also disable the actual track for true hardware mute
    streamRef.current?.getAudioTracks().forEach(t => {
      t.enabled = !mutedRef.current;
    });
    console.log('[useAudio] Muted:', mutedRef.current);
  }, []);

  useEffect(() => () => stopAudio(), [stopAudio]);

  return { isMuted, audioLevel, toggleMute, startAudio, stopAudio };
}
