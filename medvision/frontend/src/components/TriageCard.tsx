import React from 'react';
import type { TriageCard as TriageCardType } from '../hooks/useGeminiLive';

interface TriageCardProps {
  card: TriageCardType;
}

const PRIORITY_STYLES: Record<
  string,
  { badge: string; border: string }
> = {
  immediate: {
    badge: 'bg-red-600 text-white',
    border: 'border-red-600/50',
  },
  urgent: {
    badge: 'bg-yellow-400 text-black',
    border: 'border-yellow-400/50',
  },
  delayed: {
    badge: 'bg-green-600 text-white',
    border: 'border-green-600/50',
  },
};

export const TriageCard: React.FC<TriageCardProps> = ({ card }) => {
  const styles = PRIORITY_STYLES[card.priority] ?? PRIORITY_STYLES.urgent;

  const timestamp = new Date(card.timestamp).toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  return (
    <div
      className={`animate-triage-in rounded-xl border ${styles.border} bg-[#0D0E15] p-4 shadow-[0_8px_24px_rgba(0,0,0,0.35)]`}
    >
      {/* Header: priority badge + condition name + timestamp */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span
          className={`rounded px-2.5 py-0.5 text-xs font-bold uppercase tracking-widest ${styles.badge}`}
        >
          {card.priority}
        </span>
        <h3 className="text-xl font-bold capitalize text-white">
          {card.condition.replace(/_/g, ' ')}
        </h3>
        <span className="ml-auto text-[10px] text-slate-500">{timestamp}</span>
      </div>

      {/* Numbered action steps */}
      {card.steps.length > 0 && (
        <ol className="mb-3 flex max-h-36 flex-col gap-1.5 overflow-y-auto pr-1">
          {card.steps.map((step, i) => (
            <li
              key={i}
              className="flex gap-2 text-sm leading-relaxed text-slate-200"
            >
              <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-slate-800 text-[11px] font-semibold text-slate-400">
                {i + 1}
              </span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
      )}

      {/* WHO / protocol reference */}
      <div className="border-t border-white/10 pt-2">
        <p className="truncate text-[10px] text-slate-500">{card.reference}</p>
      </div>
    </div>
  );
};
