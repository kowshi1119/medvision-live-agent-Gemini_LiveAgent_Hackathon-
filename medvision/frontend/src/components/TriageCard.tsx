import React from 'react';
import { TriageCard as TriageCardType } from '../types';

interface TriageCardProps {
  card: TriageCardType;
}

export const TriageCard: React.FC<TriageCardProps> = ({ card }) => {
  const priorityConfig = {
    immediate: { color: 'var(--red)', label: 'IMMEDIATE' },
    urgent: { color: 'var(--yellow)', label: 'URGENT' },
    delayed: { color: 'var(--green)', label: 'DELAYED' },
  };

  const { color, label } = priorityConfig[card.priority];
  const condition = card.condition.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  const timestamp = new Date(card.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  return (
    <div style={{
      borderLeft: `4px solid ${color}`,
      background: 'var(--surface)',
      marginBottom: 10,
      padding: '10px 12px',
      borderRadius: '0 3px 3px 0',
      animation: 'slideIn .28s ease',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            fontFamily: "'Chakra Petch', sans-serif",
            fontSize: 9,
            fontWeight: 'bold',
            background: color,
            color: '#000',
            padding: '2px 8px',
            borderRadius: 3,
          }}>{label}</span>
          <h3 style={{ fontFamily: "'Chakra Petch', sans-serif", fontSize: 12, color: 'var(--bright)' }}>{condition}</h3>
        </div>
        <span style={{ fontFamily: "'Space Mono', monospace", fontSize: 9, color: 'var(--dim)' }}>{timestamp}</span>
      </div>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {card.steps.map((step, i) => (
          <li key={i} style={{ display: 'flex', fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: 'var(--mid)', marginBottom: 4 }}>
            <span style={{ color: 'var(--blue)', minWidth: 16 }}>{i + 1}.</span>
            <span>{step}</span>
          </li>
        ))}
      </ul>
      {card.reference && (
        <div style={{ fontFamily: "'Space Mono', monospace", fontSize: 9, fontStyle: 'italic', color: 'var(--dim)', marginTop: 6 }}>
          Ref: {card.reference}
        </div>
      )}
    </div>
  );
};
