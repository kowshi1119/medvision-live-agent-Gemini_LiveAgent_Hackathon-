import React from 'react';

interface CameraFeedProps {
  videoRef: React.RefObject<HTMLVideoElement>;
  /** Flashes true for ~150 ms on every transmitted frame — shows capture activity */
  isCapturing?: boolean;
  isConnected?: boolean;
}

/** Symptom scenarios the model looks for in the camera feed */
const CUES = [
  { symbol: '✋', label: 'CHEST' },
  { symbol: '💨', label: 'BREATH' },
  { symbol: '🤕', label: 'HEAD' },
  { symbol: '😔', label: 'POSTURE' },
] as const;

/** Corner bracket for framing guide */
const Corner = ({ pos }: { pos: 'tl' | 'tr' | 'bl' | 'br' }) => {
  const base = 'absolute w-5 h-5 pointer-events-none';
  const classes: Record<typeof pos, string> = {
    tl: `${base} top-3 left-3  border-t-2 border-l-2 rounded-tl`,
    tr: `${base} top-3 right-3 border-t-2 border-r-2 rounded-tr`,
    bl: `${base} bottom-12 left-3  border-b-2 border-l-2 rounded-bl`,
    br: `${base} bottom-12 right-3 border-b-2 border-r-2 rounded-br`,
  };
  return <div className={`${classes[pos]} border-red-400/60`} />;
};

export function CameraFeed({ videoRef, isCapturing = false, isConnected = false }: CameraFeedProps) {
  return (
    <div className="relative w-full h-full bg-black rounded-lg overflow-hidden">
      {/* Mirror the video so it feels natural (selfie view) */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="object-cover w-full h-full"
        style={{ transform: 'scaleX(-1)' }}
      />

      {/* ── Overlay ── */}
      <div className="absolute inset-0 pointer-events-none">

        {/* Framing corner brackets */}
        <Corner pos="tl" /><Corner pos="tr" /><Corner pos="bl" /><Corner pos="br" />

        {/* Top status badge */}
        <div className="absolute top-2 left-1/2 -translate-x-1/2 flex items-center gap-1.5">
          {isConnected ? (
            <>
              <span className="relative flex w-2 h-2">
                <span className="absolute inline-flex w-full h-full rounded-full bg-green-400 opacity-75 animate-ping" />
                <span className="relative inline-flex w-2 h-2 rounded-full bg-green-500" />
              </span>
              <span className="text-[10px] font-mono tracking-widest text-green-400">VISION ACTIVE</span>
            </>
          ) : (
            <span className="text-[10px] font-mono tracking-widest text-gray-500">VISION STANDBY</span>
          )}
        </div>

        {/* Capture pulse (flashes white tint each time a frame is sent) */}
        <div
          className="absolute inset-0 rounded-lg bg-white/10 transition-opacity duration-150"
          style={{ opacity: isCapturing ? 1 : 0 }}
        />

        {/* Centre guide text — very faint so it doesn't distract */}
        <div className="absolute inset-0 flex items-center justify-center">
          <p className="text-[10px] font-mono tracking-widest text-white/15 text-center leading-5 select-none">
            KEEP FACE &amp; UPPER BODY<br />CENTERED IN FRAME
          </p>
        </div>

        {/* Bottom symptom cue pills */}
        <div className="absolute bottom-2 left-0 right-0 flex justify-center gap-1 px-2">
          {CUES.map(({ symbol, label }) => (
            <div
              key={label}
              className="flex items-center gap-1 rounded bg-black/60 border border-white/10 px-1.5 py-0.5"
            >
              <span style={{ fontSize: 10 }}>{symbol}</span>
              <span className="text-[9px] font-mono text-white/40 tracking-wider">{label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
