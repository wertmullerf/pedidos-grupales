import type { ConnectionStatus } from '@pedido/client';
import type { OrderEvent, OrderSnapshot } from '@pedido/shared';
import { Button } from '@/components/ui/button';
import { formatTime } from '@/lib/format';
import type { ActivityEntry } from '@/lib/useOrderLive';

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
    <div className="rounded-lg border p-4" data-testid="activity">
      <header className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold">Actividad</h3>
          <p className="text-xs text-muted-foreground">
            versión <strong data-testid="version">{state.order.version}</strong>
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={onSimulateDisconnect} disabled={offline}>
          {offline ? 'Desconectado…' : 'Simular desconexión'}
        </Button>
      </header>
      {entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Los cambios de todos van a aparecer acá, en vivo.
        </p>
      ) : (
        <ol className="max-h-[60dvh] space-y-0.5 overflow-y-auto">
          {entries.map((entry) => (
            <li
              key={entry.id}
              className="grid grid-cols-[auto_1fr_auto] items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px] data-[kind=connection]:bg-amber-50 data-[kind=resync]:bg-sky-50"
              data-kind={entry.kind}
            >
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
                  <span className="w-9 text-center font-bold" data-kind="resync">
                    ↻
                  </span>
                  <span className="min-w-0">
                    {entry.info.mode === 'snapshot'
                      ? `Resincronizado con snapshot completo (v${entry.info.fromVersion} → v${entry.info.toVersion})`
                      : entry.info.toVersion === entry.info.fromVersion
                        ? 'Resincronizado: no faltaba nada'
                        : `Resincronizado: recuperó ${versionRange(entry.info.fromVersion, entry.info.toVersion)}`}
                  </span>
                  <time className="tabular text-[11px] text-muted-foreground">
                    {formatTime(entry.at)}
                  </time>
                </>
              ) : (
                <>
                  <span className="w-9 text-center font-bold" data-kind={entry.status}>
                    {entry.status === 'lost' ? '✕' : '✓'}
                  </span>
                  <span className="min-w-0">
                    {entry.status === 'lost' ? 'Se cortó la conexión' : 'Conexión recuperada'}
                  </span>
                  <time className="tabular text-[11px] text-muted-foreground">
                    {formatTime(entry.at)}
                  </time>
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
      <span
        className="tabular w-9 rounded-sm py-0.5 text-center text-[11px] font-bold text-white"
        style={{ background: by?.color ?? '#999' }}
      >
        v{event.version}
      </span>
      <span className="min-w-0">
        <strong>{who}</strong> {describe(event, itemNames, byId === me)}
      </span>
      <time className="tabular text-[11px] text-muted-foreground">{formatTime(at)}</time>
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
