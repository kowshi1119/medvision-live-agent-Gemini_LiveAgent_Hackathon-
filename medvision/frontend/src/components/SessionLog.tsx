import React, { useEffect, useRef } from 'react';
import { LogEntry } from '../types';

interface SessionLogProps {
  entries: LogEntry[];
}

export const SessionLog: React.FC<SessionLogProps> = ({ entries }) => {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [entries]);

  const copyLog = () => {
    const logText = entries.map(entry =>
      `[${new Date(entry.timestamp).toLocaleTimeString()}] ${entry.type.padEnd(10)} ${entry.message}`
    ).join('\n');
    navigator.clipboard.writeText(logText);
  };

  const typeColors = {
    TRIAGE: 'var(--yellow)',
    ERROR: 'var(--red)',
    CONNECTION: 'var(--blue)',
    TURN_END: 'var(--green)',
    TRANSCRIPT: 'var(--mid)',
  };

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', fontFamily: "'Space Mono', monospace", fontSize: 10 }}>
      <div style={{ flexShrink: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', borderBottom: '1px solid var(--border)' }}>
        <span style={{ color: 'var(--dim)' }}>{entries.length} EVENTS</span>
        <button onClick={copyLog} style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--mid)', padding: '2px 8px', borderRadius: 3, cursor: 'pointer' }}>
          COPY LOG
        </button>
      </div>
      <div ref={scrollRef} style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '8px 12px' }}>
        {entries.length === 0 ? (
          <div style={{ color: 'var(--dim)', fontStyle: 'italic', textAlign: 'center', paddingTop: 20 }}>
            — no events yet —
          </div>
        ) : (
          entries.map((entry, i) => (
            <div key={i} style={{ display: 'flex', whiteSpace: 'pre-wrap' }}>
              <span style={{ color: 'var(--dim)', marginRight: 8 }}>[{new Date(entry.timestamp).toLocaleTimeString()}]</span>
              <span style={{ color: typeColors[entry.type] || 'var(--mid)', minWidth: 70 }}>{entry.type}</span>
              <span style={{ color: 'var(--bright)' }}>{entry.message}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
