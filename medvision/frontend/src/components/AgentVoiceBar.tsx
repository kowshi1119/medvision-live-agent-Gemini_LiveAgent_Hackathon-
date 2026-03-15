import React from 'react';

interface AgentVoiceBarProps {
  isSpeaking: boolean;
  audioLevel: number;
  transcript: string;
  partialTranscript: string;
  showInterrupt: boolean;
  onInterrupt: () => void;
}

export function AgentVoiceBar({ isSpeaking }: { isSpeaking: boolean }) {
  return (
    <div className={`flex items-center justify-center h-8 transition-opacity duration-300 ${isSpeaking ? 'opacity-100' : 'opacity-20'}`}>
      {Array.from({ length: 5 }).map((_, i) => (
        <div
          key={i}
          className="w-1 h-4 mx-0.5 bg-red-500 rounded-full wave-bar"
          style={{
            animationPlayState: isSpeaking ? 'running' : 'paused',
            animationDelay: `${i * 0.1}s`,
            height: isSpeaking ? `${Math.random() * 12 + 4}px` : '4px',
            transition: 'height 0.2s ease-in-out'
          }}
        />
      ))}
    </div>
  );
}
