import React, { useMemo } from 'react';

interface StatusBarProps {
  connectionState: string;
}

export function StatusBar({ connectionState }: StatusBarProps) {
  const { color, text } = useMemo(() => {
    switch (connectionState) {
      case 'connected':
        return { color: 'bg-green-500', text: 'Connected' };
      case 'connecting':
        return { color: 'bg-yellow-500 animate-pulse', text: 'Connecting' };
      case 'disconnected':
      default:
        return { color: 'bg-red-500', text: 'Disconnected' };
    }
  }, [connectionState]);

  return (
    <div className="flex items-center gap-2" title={text}>
      <div className={`w-2.5 h-2.5 rounded-full ${color}`} />
    </div>
  );
}
