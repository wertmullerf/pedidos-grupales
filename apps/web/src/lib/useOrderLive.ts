import {
  ConnectionError,
  OrderConnection,
  OrderSession,
  type ConnectionStatus,
  type ResyncInfo,
} from '@pedido/client';
import type { OrderEvent, OrderSnapshot, PresenceState } from '@pedido/shared';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { Identity } from './identity';
import { rejectionMessage } from './messages';

type EntryBody =
  | { kind: 'event'; event: OrderEvent }
  | { kind: 'resync'; info: ResyncInfo }
  | { kind: 'connection'; status: 'lost' | 'back' };

export type ActivityEntry = EntryBody & { id: string; at: number };

export interface Toast {
  id: number;
  text: string;
  tone: 'warn' | 'info' | 'ok';
}

const MAX_ACTIVITY = 80;
const FLASH_MS = 1600;
const SYNCED_BADGE_MS = 2800;
const CHOOSING_IDLE_MS = 4000;

/**
 * Conexión en vivo a un pedido para la UI: estado (optimista), conexión, presencia, actividad,
 * resaltado de cambios de otras personas y avisos cuando el server rechaza algo.
 */
export function useOrderLive(tenantSlug: string, identity: Identity, onInvalidToken: () => void) {
  // Conexión y sesión viven lo que el componente. Crearlas no abre el socket (autoConnect: false):
  // conectar y desconectar es trabajo del efecto.
  const [{ conn, session }] = useState(() => {
    const conn = new OrderConnection({
      url: window.location.origin,
      tenantSlug,
      token: identity.token,
    });
    return { conn, session: new OrderSession(conn, identity.participantId) };
  });

  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [flash, setFlash] = useState<ReadonlySet<string>>(new Set());
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [justSynced, setJustSynced] = useState(false);
  const onInvalidRef = useRef(onInvalidToken);
  useEffect(() => {
    onInvalidRef.current = onInvalidToken;
  });

  const toast = useCallback((text: string, tone: Toast['tone'] = 'info') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-2), { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200);
  }, []);

  useEffect(() => {
    const me = identity.participantId;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const later = (fn: () => void, ms: number) => {
      const t = setTimeout(() => {
        timers.delete(t);
        fn();
      }, ms);
      timers.add(t);
    };
    let seq = 0;
    const push = (entry: EntryBody) =>
      setActivity((a) =>
        [{ ...entry, id: `${Date.now()}-${seq++}`, at: Date.now() }, ...a].slice(0, MAX_ACTIVITY),
      );

    const highlight = (id: string) => {
      setFlash((s) => new Set(s).add(id));
      later(
        () =>
          setFlash((s) => {
            const next = new Set(s);
            next.delete(id);
            return next;
          }),
        FLASH_MS,
      );
    };

    const offApplied = conn.store.onApplied((event) => {
      push({ kind: 'event', event });
      // Resaltamos solo lo que cambió otra persona: lo propio ya se vio al tocar.
      if (event.type === 'participant_joined') {
        if (event.payload.participant.id !== me) highlight(event.payload.participant.id);
        return;
      }
      if (event.payload.by === me) return;
      if (event.type === 'item_added') highlight(event.payload.item.id);
      else if ('itemId' in event.payload) highlight(event.payload.itemId);
    });

    const offResync = conn.onResync((info) => {
      // El resync inicial al conectar no es noticia.
      if (info.fromVersion !== null) push({ kind: 'resync', info });
    });

    let wasConnected = false;
    const offConn = conn.subscribe(() => {
      if (conn.status === 'reconnecting' && wasConnected) {
        wasConnected = false;
        push({ kind: 'connection', status: 'lost' });
      } else if (conn.status === 'connected' || conn.status === 'resynced') {
        if (!wasConnected && conn.status === 'resynced') {
          push({ kind: 'connection', status: 'back' });
          setJustSynced(true);
          later(() => setJustSynced(false), SYNCED_BADGE_MS);
        }
        wasConnected = true;
      }
    });

    const offReject = session.onReject((r) => toast(rejectionMessage(r.code, r.command), 'warn'));

    conn.connect().catch((err: unknown) => {
      if (err instanceof ConnectionError && ['UNAUTHORIZED', 'FORBIDDEN'].includes(err.code)) {
        onInvalidRef.current();
      }
    });

    return () => {
      offApplied();
      offResync();
      offConn();
      offReject();
      for (const t of timers) clearTimeout(t);
      void session.flush();
      conn.disconnect();
    };
  }, [conn, session, identity.participantId, toast]);

  const state = useSyncExternalStore<OrderSnapshot | null>(
    (l) => session.subscribe(l),
    () => session.state,
  );
  const status = useSyncExternalStore<ConnectionStatus>(
    (l) => conn.subscribe(l),
    () => conn.status,
  );
  const presence = useSyncExternalStore<PresenceState>(
    (l) => conn.subscribe(l),
    () => conn.presence,
  );

  // "Está eligiendo…": efímero, se apaga solo tras unos segundos sin tocar el menú.
  const choosingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const choosing = useRef(false);
  const markChoosing = useCallback(() => {
    if (!choosing.current) {
      choosing.current = true;
      conn.setChoosing(true);
    }
    if (choosingTimer.current) clearTimeout(choosingTimer.current);
    choosingTimer.current = setTimeout(() => {
      choosing.current = false;
      conn.setChoosing(false);
    }, CHOOSING_IDLE_MS);
  }, [conn]);

  /** Botón de la demo: corta el socket unos segundos y deja que el resync haga su trabajo. */
  const simulateDisconnect = useCallback(
    (ms = 4000) => {
      conn.disconnect();
      setTimeout(() => conn.reconnect(), ms);
    },
    [conn],
  );

  return {
    session,
    state,
    status,
    justSynced,
    presence,
    activity,
    flash,
    toasts,
    toast,
    markChoosing,
    simulateDisconnect,
  };
}
