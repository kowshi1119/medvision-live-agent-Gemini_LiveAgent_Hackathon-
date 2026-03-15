import React, { useMemo } from 'react';

export interface TriageData {
  condition: string;
  priority: 'immediate' | 'urgent' | 'delayed' | string;
  steps: string[];
  reference: string;
  timestamp: string;
}

interface TriageCardProps {
  card: TriageData;
  className?: string;
  style?: React.CSSProperties;
}

export function TriageCard({ card, className, style }: TriageCardProps) {
  const { priorityClass, priorityLabel } = useMemo(() => {
    switch (card.priority.toLowerCase()) {
      case 'immediate':
        return { priorityClass: 'bg-red-600 text-red-100', priorityLabel: 'IMMEDIATE' };
      case 'urgent':
        return { priorityClass: 'bg-orange-500 text-orange-100', priorityLabel: 'URGENT' };
      case 'delayed':
        return { priorityClass: 'bg-green-600 text-green-100', priorityLabel: 'DELAYED' };
      default:
        return { priorityClass: 'bg-gray-500 text-gray-100', priorityLabel: card.priority.toUpperCase() };
    }
  }, [card.priority]);

  return (
    <div className={`bg-[#1A1A24] p-3 rounded-lg border border-[rgba(255,255,255,0.08)] ${className}`} style={style}>
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-semibold text-white">{card.condition.replace(/_/g, ' ')}</h3>
        <span className={`px-2 py-0.5 text-xs font-bold rounded-full ${priorityClass}`}>
          {priorityLabel}
        </span>
      </div>
      <ol className="pl-4 mb-2 space-y-1 text-sm list-decimal text-slate-300">
        {card.steps.map((step, i) => <li key={i}>{step}</li>)}
      </ol>
      <div className="flex items-center justify-between text-xs text-slate-500">
        <span>{card.reference}</span>
        <span>{new Date(card.timestamp).toLocaleTimeString()}</span>
      </div>
    </div>
  );
}
