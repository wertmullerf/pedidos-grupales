import type { ConnectionStatus } from '@pedido/client';
import styles from './order.module.css';

const LABELS = {
  connecting: 'Conectando…',
  connected: 'Conectado',
  reconnecting: 'Reconectando…',
  synced: 'Sincronizado',
} as const;

/** Estado de conexión discreto. "Sincronizado" se muestra un rato después de un resync. */
export function ConnectionBadge({
  status,
  justSynced,
}: {
  status: ConnectionStatus;
  justSynced: boolean;
}) {
  const view =
    status === 'reconnecting' || status === 'connecting'
      ? status
      : justSynced
        ? 'synced'
        : 'connected';

  return (
    <span className={styles.connection} data-state={view} role="status" data-testid="connection">
      <span className={styles.connectionDot} />
      {LABELS[view]}
    </span>
  );
}
