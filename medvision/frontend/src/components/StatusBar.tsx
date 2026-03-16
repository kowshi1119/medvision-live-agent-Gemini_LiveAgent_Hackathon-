import React from 'react';
import { ConnState } from '../types';

interface StatusBarProps {
  connState: ConnState;
}

export const StatusBar: React.FC<StatusBarProps> = ({ connState }) => {
  const connConfig = {
    connected: { color: 'var(--green)', text: 'CONNECTED', animation: 'glowB 2s infinite' },
    connecting: { color: 'var(--yellow)', text: 'CONNECTING', animation: 'blink 1.5s infinite' },
    disconnected: { color: 'var(--red)', text: 'DISCONNECTED', animation: '' },
  };

  const { color, text, animation } = connConfig[connState];

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: "'Space Mono', monospace", fontSize: 10 }}>
        <div style={{ width: 7, height: 7, borderRadius: '50%', backgroundColor: color, animation }}></div>
        <span style={{ color: 'var(--mid)' }}>WS: {text}</span>
      </div>
      <div style={{ fontFamily: "'Space Mono', monospace", fontSize: 9, color: 'var(--dim)' }}>
        gemini-2.5-flash-native-audio-latest
      </div>
      <div style={{ fontFamily: "'Space Mono', monospace", fontSize: 9, color: 'var(--dim)' }}>
        WHO ETAT 2016 · ATLS 10th Ed
      </div>
    </>
  );
};
