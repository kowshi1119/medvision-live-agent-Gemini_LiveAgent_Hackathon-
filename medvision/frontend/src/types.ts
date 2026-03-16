export type AgentMode = 'STANDBY' | 'LISTENING' | 'SPEAKING'
export type Severity  = 'GREEN' | 'YELLOW' | 'RED'
export type ConnState = 'disconnected' | 'connecting' | 'connected'

export interface TriageCard {
  condition: string
  priority:  'immediate' | 'urgent' | 'delayed'
  steps:     string[]
  reference: string
  timestamp: string
}

export interface LogEntry {
  type:      'TRIAGE' | 'TRANSCRIPT' | 'CONNECTION' | 'ERROR' | 'TURN_END'
  message:   string
  timestamp: string
}
