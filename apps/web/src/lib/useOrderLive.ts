import {
  ConnectionError,
  OrderConnection,
  OrderSession,
  type ConnectionStatus,
  type ResyncInfo,
} from '@pedido/client';
import type { OrderEvent, OrderSnapshot, PresenceState } from '@pedido/shared';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { notifyError, notifyInfo, notifyRemote } from '@/components/order/notify';
import type { Identity } from './identity';
import { rejectionMessage } from './messages';
import { record, recordPaint } from './recorder';

type EntryBody =
  | { kind: 'event'; event: OrderEvent }
  | { kind: 'resync'; info: ResyncInfo }
  | { kind: 'connection'; status: 'lost' | 'back' };

export type ActivityEntry = EntryBody & { id: string; at: number };

const MAX_ACTIVITY = 80;
const FLASH_MS = 1100;
const SYNCED_BADGE_MS = 2800;
const CHOOSING_IDLE_MS = 4000;

/** Resaltados activos: quién hizo el último cambio de un ítem/participante y cuándo (re-dispara la animación). */
export type FlashMap = ReadonlyMap<string, { by: string; at: number }>;

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
  const [flash, setFlash] = useState<FlashMap>(new Map());
  const [justSynced, setJustSynced] = useState(false);
  const onInvalidRef = useRef(onInvalidToken);
  useEffect(() => {
    onInvalidRef.current = onInvalidToken;
  });

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

    const highlight = (id: string, by: string) => {
      const at = Date.now();
      setFlash((m) => new Map(m).set(id, { by, at }));
      later(
        () =>
          setFlash((m) => {
            // Solo si no hubo un cambio más nuevo sobre el mismo elemento.
            if (m.get(id)?.at !== at) return m;
            const next = new Map(m);
            next.delete(id);
            return next;
          }),
        FLASH_MS,
      );
    };

    const person = (id: string) => conn.store.state?.participants.find((p) => p.id === id);

    const offApplied = conn.store.onApplied((event) => {
      push({ kind: 'event', event });
      const by =
        event.type === 'participant_joined' ? event.payload.participant.id : event.payload.by;
      const itemId =
        event.type === 'item_added'
          ? event.payload.item.id
          : 'itemId' in event.payload
            ? event.payload.itemId
            : null;
      record({ kind: 'applied', version: event.version, type: event.type, by, itemId });
      recordPaint({ version: event.version, type: event.type, by, itemId });

      // Lo propio ya se vio al tocar: solo resaltamos y avisamos lo que hizo otra persona.
      if (by === me) return;
      const who = person(by);
      switch (event.type) {
        case 'participant_joined':
          highlight(by, by);
          notifyRemote(
            `${event.payload.participant.name} se sumó al pedido`,
            event.payload.participant,
          );
          break;
        case 'item_added':
          highlight(event.payload.item.id, by);
          if (who) notifyRemote(`${who.name} agregó ${event.payload.item.name}`, who);
          break;
        case 'item_incremented':
        case 'item_removed':
        case 'item_notes_updated':
          highlight(event.payload.itemId, by);
          break;
        case 'order_locked':
          notifyRemote(`${who?.name ?? 'El host'} cerró el pedido`, who);
          break;
        case 'order_unlocked':
          notifyRemote(`${who?.name ?? 'El host'} reabrió el pedido`, who);
          break;
      }
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

    const offReject = session.onReject((r) => notifyError(rejectionMessage(r.code, r.command)));

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
  }, [conn, session, identity.participantId]);

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

  /** Solo modo debug: corta el socket unos segundos y deja que el resync haga su trabajo. */
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
    notifyError,
    notifyInfo,
    markChoosing,
    simulateDisconnect,
  };
}
