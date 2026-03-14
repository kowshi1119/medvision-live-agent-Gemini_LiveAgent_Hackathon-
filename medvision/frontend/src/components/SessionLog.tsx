import React, { useEffect, useRef } from 'react';
import type { SessionLogEntry } from '../hooks/useGeminiLive';

interface SessionLogProps {
  entries: SessionLogEntry[];
  onDownload: () => void;
}

const TYPE_STYLES: Record<SessionLogEntry['type'], { border: string; text: string }> = {
  system: { border: 'border-slate-500/60', text: 'text-slate-300' },
  info: { border: 'border-emerald-500/80', text: 'text-emerald-200' },
  transcript: { border: 'border-sky-500/80', text: 'text-sky-200' },
  triage: { border: 'border-sky-500/80', text: 'text-sky-200' },
  error: { border: 'border-red-500/80', text: 'text-red-200' },
};

export const SessionLog: React.FC<SessionLogProps> = ({ entries, onDownload }) => {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [entries]);

  return (
    <div className="flex min-h-0 flex-col rounded-xl border border-white/10 bg-[#12121A] overflow-hidden">
      <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#94A3B8]">Session Log</p>
        <span className="text-[11px] text-[#64748B]">{entries.length} events</span>
      </div>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3 text-xs">
        {entries.length === 0 && (
          <p className="rounded-lg border border-dashed border-white/10 bg-[#0D0E15] p-3 text-[#64748B]">
            Awaiting session events.
          </p>
        )}

        {entries.map(entry => {
          const style = TYPE_STYLES[entry.type];
          const time = new Date(entry.ts).toLocaleTimeString('en-US', {
            hour12: false,
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
          });

          return (
            <div
              key={entry.id}
              className={`rounded-lg border border-white/10 border-l-4 bg-[#0D0E15] px-3 py-2 ${style.border}`}
            >
              <p className="mb-1 font-mono text-[10px] text-[#64748B]">{time}</p>
              <p className={`break-words leading-relaxed ${style.text}`}>
                {entry.content}
              </p>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      <div className="border-t border-white/10 p-3">
        <button
          onClick={onDownload}
          className="w-full rounded-lg border border-[#F97316]/40 bg-[#1A1410] px-3 py-2 text-xs font-bold uppercase tracking-[0.08em] text-[#FDBA74] transition hover:border-[#F97316] hover:text-[#FED7AA]"
        >
          Download Report
        </button>
      </div>
    </div>
  );
};
