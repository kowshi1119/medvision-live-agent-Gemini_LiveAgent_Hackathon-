import React from 'react';

interface AgentVoiceBarProps {
  isSpeaking: boolean;
  audioLevel: number;
  transcript: string;
  partialTranscript: string;
  showInterrupt: boolean;
  onInterrupt: () => void;
}

export const AgentVoiceBar: React.FC<AgentVoiceBarProps> = ({
  isSpeaking,
  audioLevel: _audioLevel,
  transcript,
  partialTranscript,
  showInterrupt,
  onInterrupt,
}) => {
  return (
    <div className="flex min-h-0 flex-col rounded-xl border border-white/10 bg-[#12121A] p-4">
      <div className="mb-4 rounded-xl border border-white/10 bg-[#0D0E15] p-4">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#94A3B8]">
            Voice Activity
          </p>
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#64748B]">
            Gemini Live
          </p>
        </div>

        <div className="flex h-14 items-end justify-center gap-2">
          {[0, 1, 2, 3, 4].map(index => (
            <span
              key={index}
              className={`w-3 rounded-full bg-gradient-to-t from-[#F97316] to-[#EF4444] transition-opacity ${
                isSpeaking
                  ? 'animate-[voiceBars_0.38s_ease-in-out_infinite] opacity-100'
                  : 'h-[4px] opacity-30'
              }`}
              style={
                isSpeaking
                  ? ({ animationDelay: `${index * 90}ms` } as React.CSSProperties)
                  : undefined
              }
            />
          ))}
        </div>
      </div>

      <div className="mb-4 min-h-0 flex-1 overflow-y-auto rounded-xl border border-white/10 bg-[#0D0E15] p-4">
        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-[#94A3B8]">
          Live Transcript
        </p>
        <p className="whitespace-pre-wrap text-[16px] leading-relaxed text-[#F1F5F9]">
          {transcript}
          {partialTranscript && (
            <span className="text-[#F97316]">{partialTranscript}</span>
          )}
          {!transcript && !partialTranscript && (
            <span className="text-[#64748B]">Awaiting streaming clinical response...</span>
          )}
        </p>
      </div>

      {showInterrupt && (
        <button
          onClick={onInterrupt}
          className="w-full rounded-lg border border-[#EF4444]/70 bg-[#EF4444] px-4 py-3 text-sm font-extrabold uppercase tracking-[0.1em] text-white transition hover:bg-[#DC2626]"
        >
          Interrupt
        </button>
      )}
    </div>
  );
};
