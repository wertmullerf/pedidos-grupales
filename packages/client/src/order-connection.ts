import type {
  ClientToServerEvents,
  CommandAck,
  CommandInput,
  CommandName,
  ErrorAck,
  HandshakeAuth,
  OrderEvent,
  PresenceState,
  ResyncAck,
  ServerToClientEvents,
} from '@pedido/shared';
import { io, type Socket } from 'socket.io-client';
import { OrderStore } from './order-store.js';

export type ConnectionStatus = 'connecting' | 'connected' | 'reconnecting' | 'resynced';

export interface ResyncInfo {
  mode: 'events' | 'snapshot';
  fromVersion: number | null;
  toVersion: number | null;
}

export interface OrderConnectionOptions {
  /** Origen del server (o de nginx). */
  url: string;
  tenantSlug: string;
  token: string;
  ackTimeoutMs?: number;
}

export class ConnectionError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

/**
 * Conexión en vivo a un pedido: mantiene el OrderStore al día con los eventos del server,
 * detecta huecos de versión y resincroniza (al conectar, al reconectar y ante un salto).
 */
export class OrderConnection {
  readonly store = new OrderStore();
  readonly socket: Socket<ServerToClientEvents, ClientToServerEvents>;
  presence: PresenceState = { participants: [] };
  status: ConnectionStatus = 'connecting';
  readonly stats = { resyncs: 0, lastResyncMode: null as 'events' | 'snapshot' | null };

  private readonly ackTimeoutMs: number;
  private resyncInFlight: Promise<void> | null = null;
  private resyncAgain = false;
  private everSynced = false;
  private listeners = new Set<() => void>();
  private resyncListeners = new Set<(info: ResyncInfo) => void>();

  constructor(opts: OrderConnectionOptions) {
    this.ackTimeoutMs = opts.ackTimeoutMs ?? 5000;
    this.socket = io(opts.url, {
      // Solo WebSocket: funciona detrás de nginx round-robin sin sticky sessions.
      transports: ['websocket'],
      auth: { tenantSlug: opts.tenantSlug, token: opts.token } satisfies HandshakeAuth,
      autoConnect: false,
      reconnectionDelay: 300,
      reconnectionDelayMax: 3000,
    });

    this.socket.on('connect', () => {
      // Tras (re)conectar pedimos lo que falte desde la última versión vista (regla 7).
      this.resync().then(
        () => {
          this.setStatus(this.everSynced ? 'resynced' : 'connected');
          this.everSynced = true;
        },
        // Si falla (p. ej. timeout), el próximo evento con salto o la próxima reconexión reintenta.
        () => {},
      );
    });
    this.socket.on('disconnect', () => this.setStatus('reconnecting'));
    this.socket.on('order:event', (event) => this.handleEvent(event));
    this.socket.on('presence:state', (presence: PresenceState) => {
      this.presence = presence;
      this.notify();
    });
    this.store.subscribe(() => this.notify());
  }

  /** Conecta y resuelve cuando el estado inicial está sincronizado. Rechaza si el server rechaza el token. */
  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const onError = (err: Error & { data?: { code?: string } }) => {
        cleanup();
        this.socket.disconnect();
        reject(new ConnectionError(err.data?.code ?? err.message));
      };
      const onChange = () => {
        if (this.status === 'connected' || this.status === 'resynced') {
          cleanup();
          resolve();
        }
      };
      const cleanup = () => {
        this.socket.off('connect_error', onError);
        this.listeners.delete(onChange);
      };
      this.socket.once('connect_error', onError);
      this.listeners.add(onChange);
      this.socket.connect();
    });
  }

  /** Envía un comando y espera la confirmación del server. */
  async send<C extends CommandName>(command: C, payload: CommandInput<C>): Promise<CommandAck> {
    const ack: CommandAck = await this.socket
      .timeout(this.ackTimeoutMs)
      // Todos los comandos comparten la firma (payload, ack); el genérico solo tipa el payload.
      .emitWithAck(command as CommandName, payload);
    if (ack.ok) this.handleEvent(ack.event);
    else this.handleErrorVersion(ack);
    return ack;
  }

  setChoosing(choosing: boolean): void {
    this.socket.emit('presence:choosing', { choosing });
  }

  /** Corta la conexión; con `reconnect()` vuelve y resincroniza. */
  disconnect(): void {
    this.socket.disconnect();
  }

  reconnect(): void {
    this.socket.connect();
  }

  close(): void {
    this.listeners.clear();
    this.socket.disconnect();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onResync(listener: (info: ResyncInfo) => void): () => void {
    this.resyncListeners.add(listener);
    return () => this.resyncListeners.delete(listener);
  }

  get connected(): boolean {
    return this.socket.connected;
  }

  /** Resuelve cuando el socket está conectado (inmediatamente si ya lo está). */
  whenConnected(): Promise<void> {
    if (this.socket.connected) return Promise.resolve();
    return new Promise((resolve) => this.socket.once('connect', () => resolve()));
  }

  /**
   * Pide al server lo que falta desde la versión actual. Si ya hay un resync en curso, agenda
   * otro al terminar en lugar de lanzar dos en paralelo.
   */
  resync(): Promise<void> {
    if (this.resyncInFlight) {
      this.resyncAgain = true;
      return this.resyncInFlight;
    }
    this.resyncInFlight = (async () => {
      try {
        do {
          this.resyncAgain = false;
          const ack: ResyncAck = await this.socket
            .timeout(this.ackTimeoutMs)
            .emitWithAck('order:resync', { sinceVersion: this.store.version });
          if (!ack.ok) throw new ConnectionError(ack.error.code);
          this.stats.resyncs++;
          this.stats.lastResyncMode = ack.mode;
          const fromVersion = this.store.version;
          if (ack.mode === 'snapshot') this.store.setSnapshot(ack.snapshot);
          else for (const event of ack.events) this.store.applyEvent(event);
          const info = { mode: ack.mode, fromVersion, toVersion: this.store.version };
          for (const l of this.resyncListeners) l(info);
        } while (this.resyncAgain || this.store.hasGap);
      } finally {
        this.resyncInFlight = null;
      }
    })();
    return this.resyncInFlight;
  }

  private handleEvent(event: OrderEvent) {
    // Un salto de versión significa que se perdió algo: resync en vez de aplicar a ciegas (regla 8).
    if (this.store.applyEvent(event) === 'gap') void this.resync().catch(() => {});
  }

  private handleErrorVersion(ack: ErrorAck) {
    const local = this.store.version;
    if (ack.version !== null && local !== null && ack.version > local) {
      void this.resync().catch(() => {});
    }
  }

  private setStatus(status: ConnectionStatus) {
    this.status = status;
    this.notify();
  }

  private notify() {
    for (const l of this.listeners) l();
  }
}
