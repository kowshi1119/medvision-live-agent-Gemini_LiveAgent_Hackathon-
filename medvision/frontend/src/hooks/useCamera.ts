import { useCallback, useEffect, useRef, useState } from 'react';

export interface UseCameraReturn {
  videoRef: React.RefObject<HTMLVideoElement>;
  isActive: boolean;
  error: string | null;
  startCamera: () => Promise<void>;
  stopCamera: () => void;
  captureFrame: () => string | null;
}

export function useCamera(): UseCameraReturn {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [isActive, setIsActive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Lazy canvas creation to avoid layout thrash
  const getCanvas = (): HTMLCanvasElement => {
    if (!canvasRef.current) {
      canvasRef.current = document.createElement('canvas');
    }
    return canvasRef.current;
  };

  const startCamera = useCallback(async () => {
    setError(null);
    try {
      // 'user' = front-facing / webcam — the person showing symptoms faces the camera
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: 'user',
        },
        audio: false,
      });

      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      setIsActive(true);
    } catch (err) {
      const message =
        err instanceof DOMException
          ? `Camera access denied: ${err.message}`
          : 'Camera unavailable';
      setError(message);
      setIsActive(false);
    }
  }, []);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setIsActive(false);
  }, []);

  /**
   * Capture the current video frame as a base64-encoded JPEG string.
   * Returns null if the camera is not active.
   */
  const captureFrame = useCallback((): string | null => {
    const video = videoRef.current;
    if (!video || !isActive || video.videoWidth === 0) return null;

    const canvas = getCanvas();

    // Cap at 640×480 so frames are compact enough for Gemini's live input
    const MAX_W = 640;
    const MAX_H = 480;
    const scale = Math.min(1, MAX_W / video.videoWidth, MAX_H / video.videoHeight);
    canvas.width  = Math.round(video.videoWidth  * scale);
    canvas.height = Math.round(video.videoHeight * scale);

    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    ctx.drawImage(video, 0, 0);

    // Return only the base64 data portion (strip data:image/jpeg;base64, prefix)
    const dataUrl = canvas.toDataURL('image/jpeg', 0.6);
    return dataUrl.split(',')[1] ?? null;
  }, [isActive]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, [stopCamera]);

  return {
    videoRef,
    isActive,
    error,
    startCamera,
    stopCamera,
    captureFrame,
  };
}
