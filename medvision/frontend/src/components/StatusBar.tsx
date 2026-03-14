import React from 'react';
import type { ConnectionState } from '../hooks/useGeminiLive';

interface StatusBarProps {
  connectionState: ConnectionState;
}

const STATE_CONFIG: Record<ConnectionState, { color: string; label: string }> = {
  disconnected: { color: 'bg-slate-500', label: 'Disconnected' },
  connecting: { color: 'bg-amber-400 animate-pulse', label: 'Connecting' },
  connected: { color: 'bg-emerald-400', label: 'Connected' },
  interrupted: { color: 'bg-orange-400 animate-pulse', label: 'Interrupted' },
  error: { color: 'bg-red-500', label: 'Error' },
  reconnecting: { color: 'bg-amber-400 animate-pulse', label: 'Reconnecting' },
};

export const StatusBar: React.FC<StatusBarProps> = ({ connectionState }) => {
  const { color, label } = STATE_CONFIG[connectionState];

  return (
    <div className="rounded-xl border border-white/10 bg-[#12121A] p-4">
      <div className="mb-2 flex items-center justify-between">
        <div>
          <p className="text-sm font-bold text-[#F1F5F9]">MedVision</p>
          <p className="text-xs text-[#64748B]">Gemini Live</p>
        </div>
        <span className={`h-2.5 w-2.5 rounded-full ${color}`} />
      </div>
      <div className="rounded-lg border border-white/10 bg-[#0D0E15] px-3 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-[#94A3B8]">
        {label}
      </div>
    </div>
  );
};
