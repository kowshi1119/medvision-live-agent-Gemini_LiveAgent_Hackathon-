import React, { useEffect, useRef } from 'react';
import { useCamera } from '../hooks/useCamera';

interface CameraFeedProps {
  isSessionActive: boolean;
  onFrame: (base64: string) => void;
  isAudioOn: boolean;
}

const FRAME_INTERVAL_MS = 500;

export const CameraFeed: React.FC<CameraFeedProps> = ({
  isSessionActive,
  onFrame,
  isAudioOn,
}) => {
  const { videoRef, isActive, error, startCamera, stopCamera, captureFrame } = useCamera();
  const frameTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isLive = isSessionActive && isActive;

  // Start camera when session starts; stop when session ends
  useEffect(() => {
    if (isSessionActive && !isActive) {
      void startCamera();
    } else if (!isSessionActive && isActive) {
      stopCamera();
    }
  }, [isSessionActive, isActive, startCamera, stopCamera]);

  // Stream frames to backend at 2fps when session is active
  useEffect(() => {
    if (isSessionActive && isActive) {
      frameTimerRef.current = setInterval(() => {
        const frame = captureFrame();
        if (frame) onFrame(frame);
      }, FRAME_INTERVAL_MS);
    } else {
      if (frameTimerRef.current) {
        clearInterval(frameTimerRef.current);
        frameTimerRef.current = null;
      }
    }

    return () => {
      if (frameTimerRef.current) {
        clearInterval(frameTimerRef.current);
      }
    };
  }, [isSessionActive, isActive, captureFrame, onFrame]);

  return (
    <div className="flex h-full min-h-0 flex-col rounded-xl border border-white/10 bg-[#12121A] p-3">
      <div
        className={`relative mb-3 aspect-[4/3] overflow-hidden rounded-xl border border-white/10 bg-[#0A0A0F] ${
          isLive ? 'shadow-[0_0_0_2px_#EF4444,0_0_20px_rgba(239,68,68,0.3)]' : ''
        }`}
      >
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className={`h-full w-full object-cover transition-opacity duration-300 ${
            isActive ? 'opacity-100' : 'opacity-0'
          }`}
        />

        {!isActive && !error && (
          <div className="absolute inset-0 flex items-center justify-center px-4 text-center text-sm text-[#64748B]">
            Camera standby. Session activation will begin patient capture.
          </div>
        )}

        {error && (
          <div className="absolute inset-0 flex items-center justify-center bg-[#0A0A0F]/90 px-4 text-center text-sm text-red-300">
            {error}
          </div>
        )}

        <div className="absolute bottom-0 left-0 right-0 flex items-center justify-between border-t border-white/10 bg-[#06070D]/85 px-3 py-2 backdrop-blur-sm">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#CBD5E1]">
            Patient View
          </p>
          <span className="rounded-md border border-[#EF4444]/30 bg-[#EF4444]/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em] text-[#FCA5A5]">
            LIVE
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-2">
        <StatPill label="GEMINI VISION: ON" />
        <StatPill label={`AUDIO: ${isAudioOn ? 'ON' : 'ON'}`} />
        <StatPill label="GROUNDED: WHO" />
      </div>
    </div>
  );
};

function StatPill({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-[#0D0E15] px-3 py-2 text-[11px] font-semibold tracking-wide text-[#94A3B8]">
      <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)]" />
      {label}
    </div>
  );
}
