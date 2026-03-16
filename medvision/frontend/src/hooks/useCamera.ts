import React, { useState, useRef, useEffect } from 'react';

export interface CameraHook {
  isCameraOn:   boolean
  videoRef:     React.RefObject<HTMLVideoElement>
  toggleCamera: () => void
  startCamera:  () => Promise<void>
  stopCamera:   () => void
  captureFrame: () => string | null   // base64 JPEG, null when camera off
}

export function useCamera(): CameraHook {
  const [isCameraOn, setIsCameraOn] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' }
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setIsCameraOn(true);
    } catch (error) {
      console.error("Error starting camera:", error);
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
    }
    setIsCameraOn(false);
  };

  const toggleCamera = () => {
    if (streamRef.current) {
      streamRef.current.getVideoTracks().forEach(track => {
        track.enabled = !track.enabled;
      });
      setIsCameraOn(prev => !prev);
    }
  };

  const captureFrame = (): string | null => {
    const video = videoRef.current;
    // Use streamRef (a ref) instead of isCameraOn (state) so that closures
    // captured before startCamera() still see the live camera state at call time.
    if (!streamRef.current || !video || video.videoWidth === 0) {
      return null;
    }
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL('image/jpeg', 0.8).split(',')[1];
    }
    return null;
  };

  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, []);

  return { isCameraOn, videoRef, toggleCamera, startCamera, stopCamera, captureFrame };
}
