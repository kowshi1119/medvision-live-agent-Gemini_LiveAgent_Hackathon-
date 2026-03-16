import React from 'react';

interface MicControlProps {
  isActive: boolean;
  isMuted: boolean;
  audioLevel: number;
  onToggleMute: () => void;
}

export const MicControl: React.FC<MicControlProps> = ({ isActive, isMuted, audioLevel, onToggleMute }) => {
  const radius = 28;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference * (1 - audioLevel);

  return (
    <div style={{ textAlign: 'center', fontFamily: "'Space Mono', monospace" }}>
      {isMuted && (
        <div style={{ color: 'var(--red)', animation: 'blink 1.5s infinite', fontSize: 10, marginBottom: 8 }}>
          MIC MUTED
        </div>
      )}
      <button onClick={onToggleMute} style={{ background: 'none', border: 'none', cursor: 'pointer', opacity: isActive ? 1 : 0.3 }}>
        <svg width="64" height="64" viewBox="0 0 64 64">
          <circle
            cx="32"
            cy="32"
            r={radius}
            fill="var(--surface)"
            stroke="var(--border)"
            strokeWidth="2"
          />
          <circle
            cx="32"
            cy="32"
            r={radius}
            fill="none"
            stroke={isMuted ? 'var(--red)' : 'var(--blue)'}
            strokeWidth="2"
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            transform="rotate(-90 32 32)"
            style={{ transition: 'stroke-dashoffset 0.05s linear' }}
          />
          <text x="32" y="38" textAnchor="middle" fontSize="24">
            {isMuted ? '🔇' : '🎤'}
          </text>
        </svg>
      </button>
      <div style={{ fontSize: 10, color: 'var(--dim)', marginTop: 8 }}>MICROPHONE</div>
      {isActive && !isMuted && (
        <div style={{ fontSize: 9, color: 'var(--dim)', marginTop: 4 }}>M - MUTE</div>
      )}
    </div>
  );
};
