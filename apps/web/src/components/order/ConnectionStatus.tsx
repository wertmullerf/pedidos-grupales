import type { ConnectionStatus as Status } from '@pedido/client';
import { cn } from 'cn';

const LABELS = {
  connecting: 'Conectando…',
  connected: 'Conectado',
  reconnecting: 'Reconectando…',
  synced: 'Sincronizado',
} as const;

/** Estado de conexión discreto: un punto y una palabra en gris. */
export function ConnectionStatus({ status, justSynced }: { status: Status; justSynced: boolean }) {
  const view =
    status === 'reconnecting' || status === 'connecting'
      ? status
      : justSynced
        ? 'synced'
        : 'connected';
  return (
    <span
      role="status"
      data-testid="connection"
      data-state={view}
      className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground"
    >
      <span
        className={cn(
          'size-1.5 rounded-full',
          view === 'connected' && 'bg-emerald-500',
          view === 'synced' && 'bg-sky-500',
          view === 'reconnecting' && 'animate-pulse bg-amber-500',
          view === 'connecting' && 'bg-neutral-300',
        )}
      />
      {LABELS[view]}
    </span>
  );
}
