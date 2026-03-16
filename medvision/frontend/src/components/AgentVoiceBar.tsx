import React from 'react';
import { AgentMode } from '../types';

interface AgentVoiceBarProps {
  audioLevel: number;
  agentMode: AgentMode;
  partialTranscript: string;
}

const scaleFactors = [0.3, 0.6, 0.85, 1.0, 0.85, 0.6, 0.3];

export const AgentVoiceBar: React.FC<AgentVoiceBarProps> = ({ audioLevel, agentMode, partialTranscript }) => {
  const color = agentMode === 'SPEAKING' ? 'var(--green)' : agentMode === 'LISTENING' ? 'var(--blue)' : 'var(--border)';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', height: 80 }}>
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'flex-end', height: 60, gap: 5 }}>
        {scaleFactors.map((scale, i) => (
          <div
            key={i}
            style={{
              width: 5,
              borderRadius: 3,
              backgroundColor: color,
              height: `${6 + (audioLevel * 52 * scale)}px`,
              transition: 'height 80ms ease-out',
            }}
          />
        ))}
      </div>
      <div style={{ fontFamily: "'Space Mono', monospace", fontSize: 10, color: 'var(--mid)', height: 20, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 300 }}>
        {partialTranscript}
      </div>
    </div>
  );
};
