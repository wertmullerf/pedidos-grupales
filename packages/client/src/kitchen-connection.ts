import type {
  ClientToServerEvents,
  HandshakeAuth,
  KitchenOrder,
  ServerToClientEvents,
} from '@pedido/shared';
import { io, type Socket } from 'socket.io-client';

/** Pantalla de cocina de una sucursal: recibe en vivo los pedidos grupales que se envían. */
export class KitchenConnection {
  readonly socket: Socket<ServerToClientEvents, ClientToServerEvents>;

  constructor(opts: { url: string; tenantSlug: string; branchId: string }) {
    this.socket = io(opts.url, {
      transports: ['websocket'],
      auth: {
        kind: 'kitchen',
        tenantSlug: opts.tenantSlug,
        branchId: opts.branchId,
      } satisfies HandshakeAuth,
    });
  }

  onOrder(listener: (order: KitchenOrder) => void): () => void {
    this.socket.on('kitchen:order', listener);
    return () => this.socket.off('kitchen:order', listener);
  }

  /** Al (re)conectar conviene volver a pedir la lista: lo enviado mientras tanto no llegó en vivo. */
  onConnect(listener: () => void): () => void {
    this.socket.on('connect', listener);
    return () => this.socket.off('connect', listener);
  }

  onDisconnect(listener: () => void): () => void {
    this.socket.on('disconnect', listener);
    return () => this.socket.off('disconnect', listener);
  }

  close(): void {
    this.socket.disconnect();
  }
}
