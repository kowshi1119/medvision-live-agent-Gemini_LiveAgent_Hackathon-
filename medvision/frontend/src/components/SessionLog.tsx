import React, { useEffect, useRef } from 'react';

export interface LogEntry {
  type: 'info' | 'error' | 'agent' | 'user' | 'triage';
  message: string;
  timestamp: string;
}

interface SessionLogProps {
  log: LogEntry[];
}

export function SessionLog({ log }: SessionLogProps) {
  const logContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [log]);

  const getBorderColor = (type: LogEntry['type']) => {
    switch (type) {
      case 'info': return 'border-green-500';
      case 'error': return 'border-red-500';
      case 'agent': return 'border-blue-500';
      case 'user': return 'border-yellow-500';
      case 'triage': return 'border-purple-500';
      default: return 'border-gray-500';
    }
  };

  return (
    <div ref={logContainerRef} className="space-y-2 text-xs font-mono">
      {log.map((entry, index) => (
        <div key={index} className={`pl-2 border-l-2 ${getBorderColor(entry.type)}`}>
          <span className="mr-2 text-slate-500">{new Date(entry.timestamp).toLocaleTimeString()}</span>
          <span className="text-slate-300">{entry.message}</span>
        </div>
      ))}
    </div>
  );
}
