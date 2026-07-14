export type NotifyEventType = "agentEnd" | "error" | "inputNeeded";

export interface NotifyEvent {
  type: NotifyEventType;
  sessionId: string | null;
  sessionName: string | null;
  summary: string;
  detail?: string;
}

type Listener = (event: NotifyEvent) => void;

const listeners = new Set<Listener>();

export function onNotifyEvent(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function emitNotifyEvent(event: NotifyEvent): void {
  for (const l of listeners) {
    try {
      l(event);
    } catch {
      // ignore listener errors
    }
  }
}
