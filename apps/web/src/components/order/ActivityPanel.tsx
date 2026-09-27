import type { ConnectionStatus } from '@pedido/client';
import type { OrderEvent, OrderSnapshot } from '@pedido/shared';
import { formatTime } from '../../lib/format';
import type { ActivityEntry } from '../../lib/useOrderLive';
import styles from './order.module.css';

/**
 * Panel de la demo: cada evento con su número de versión, en el orden en que se aplicó.
 * Sirve para ver (y explicar) el versionado, las desconexiones y los resyncs.
 */
export function ActivityPanel({
  entries,
  state,
  me,
  status,
  onSimulateDisconnect,
}: {
  entries: ActivityEntry[];
  state: OrderSnapshot;
  me: string;
  status: ConnectionStatus;
  onSimulateDisconnect: () => void;
}) {
  const people = new Map(state.participants.map((p) => [p.id, p]));
  // Nombres de producto por línea: del estado actual y de los eventos (por si la línea ya no existe).
  const itemNames = new Map(state.items.map((i) => [i.id, i.name]));
  for (const e of entries) {
    if (e.kind === 'event' && e.event.type === 'item_added') {
      itemNames.set(e.event.payload.item.id, e.event.payload.item.name);
    }
  }
  const offline = status === 'reconnecting';

  return (
    <div className={styles.activity} data-testid="activity">
      <header className={styles.activityHeader}>
        <div>
          <h3 className={styles.activityTitle}>Actividad</h3>
          <p className={styles.activityVersion}>
            versión <strong data-testid="version">{state.order.version}</strong>
          </p>
        </div>
        <button
          className="btn btn-secondary"
          onClick={onSimulateDisconnect}
          disabled={offline}
          style={{ minHeight: 38, fontSize: 13, padding: '0 14px' }}
        >
          {offline ? 'Desconectado…' : 'Simular desconexión'}
        </button>
      </header>
      {entries.length === 0 ? (
        <p className={styles.activityEmpty}>Los cambios de todos van a aparecer acá, en vivo.</p>
      ) : (
        <ol className={styles.activityList}>
          {entries.map((entry) => (
            <li key={entry.id} className={styles.activityItem} data-kind={entry.kind}>
              {entry.kind === 'event' ? (
                <EventRow
                  event={entry.event}
                  people={people}
                  itemNames={itemNames}
                  me={me}
                  at={entry.at}
                />
              ) : entry.kind === 'resync' ? (
                <>
                  <span className={styles.activityBadge} data-kind="resync">
                    ↻
                  </span>
                  <span className={styles.activityText}>
                    {entry.info.mode === 'snapshot'
                      ? `Resincronizado con snapshot completo (v${entry.info.fromVersion} → v${entry.info.toVersion})`
                      : entry.info.toVersion === entry.info.fromVersion
                        ? 'Resincronizado: no faltaba nada'
                        : `Resincronizado: recuperó ${versionRange(entry.info.fromVersion, entry.info.toVersion)}`}
                  </span>
                  <time className={styles.activityTime}>{formatTime(entry.at)}</time>
                </>
              ) : (
                <>
                  <span className={styles.activityBadge} data-kind={entry.status}>
                    {entry.status === 'lost' ? '✕' : '✓'}
                  </span>
                  <span className={styles.activityText}>
                    {entry.status === 'lost' ? 'Se cortó la conexión' : 'Conexión recuperada'}
                  </span>
                  <time className={styles.activityTime}>{formatTime(entry.at)}</time>
                </>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function EventRow({
  event,
  people,
  itemNames,
  me,
  at,
}: {
  event: OrderEvent;
  people: Map<string, { name: string; color: string }>;
  itemNames: Map<string, string>;
  me: string;
  at: number;
}) {
  const byId =
    event.type === 'participant_joined' ? event.payload.participant.id : event.payload.by;
  const by = people.get(byId);
  const who = byId === me ? 'Vos' : (by?.name ?? 'Alguien');
  return (
    <>
      <span className={styles.activityVersionTag} style={{ background: by?.color ?? '#999' }}>
        v{event.version}
      </span>
      <span className={styles.activityText}>
        <strong>{who}</strong> {describe(event, itemNames, byId === me)}
      </span>
      <time className={styles.activityTime}>{formatTime(at)}</time>
    </>
  );
}

function describe(event: OrderEvent, itemNames: Map<string, string>, mine: boolean): string {
  const item =
    'itemId' in event.payload ? (itemNames.get(event.payload.itemId) ?? 'una línea') : '';
  // "Vos agregaste" / "Beto agregó": se conjuga según quién hizo el cambio.
  const v = (vos: string, tercera: string) => (mine ? vos : tercera);
  switch (event.type) {
    case 'participant_joined':
      return v('te sumaste al pedido', 'se sumó al pedido');
    case 'item_added':
      return `${v('agregaste', 'agregó')} ${event.payload.item.quantity}× ${event.payload.item.name}`;
    case 'item_incremented': {
      const { delta, quantity } = event.payload;
      if (quantity === 0) return `${v('sacaste', 'sacó')} ${item}`;
      const verb = delta > 0 ? v('sumaste', 'sumó') : v('restaste', 'restó');
      return `${verb} ${Math.abs(delta)} ${item} (quedan ${quantity})`;
    }
    case 'item_removed':
      return `${v('sacaste', 'sacó')} ${item}`;
    case 'item_notes_updated':
      return event.payload.notes
        ? `${v('anotaste', 'anotó')} “${event.payload.notes}” en ${item}`
        : `${v('borraste', 'borró')} la aclaración de ${item}`;
    case 'order_locked':
      return v('cerraste el pedido', 'cerró el pedido');
    case 'order_unlocked':
      return v('reabriste el pedido', 'reabrió el pedido');
    case 'order_submitted':
      return v('enviaste el pedido a la sucursal', 'envió el pedido a la sucursal');
  }
}

function versionRange(from: number | null, to: number | null) {
  const first = (from ?? 0) + 1;
  return first === to ? `v${to}` : `v${first}–v${to}`;
}
