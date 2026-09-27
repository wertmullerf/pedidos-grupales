import { z } from 'zod';
import type { CommandName } from './commands.js';
import type { OrderSnapshot } from './domain.js';
import type { ApiError } from './errors.js';
import type { OrderEvent } from './events.js';

// Protocolo Socket.IO entre cliente y servidor. Solo transporte WebSocket.

export interface ErrorAck {
  ok: false;
  error: ApiError;
  /** Versión actual del pedido en el server; null si no se consultó (p. ej. RATE_LIMITED). */
  version: number | null;
}

export type CommandAck =
  { ok: true; status: 'applied' | 'duplicate'; version: number; event: OrderEvent } | ErrorAck;

export const ResyncRequestSchema = z.object({
  sinceVersion: z.number().int().min(0).nullable(),
});
export type ResyncRequest = z.infer<typeof ResyncRequestSchema>;

export type ResyncAck =
  | { ok: true; mode: 'events'; events: OrderEvent[] }
  | { ok: true; mode: 'snapshot'; snapshot: OrderSnapshot }
  | ErrorAck;

export interface PresenceState {
  participants: { participantId: string; choosing: boolean }[];
}

export const ChoosingSchema = z.object({ choosing: z.boolean() });

/** Pedido enviado, tal como lo ve la cocina de la sucursal. */
export interface KitchenOrder {
  code: string;
  submittedAt: string;
  participants: { id: string; name: string; color: string }[];
  items: { id: string; participantId: string; name: string; quantity: number; notes: string }[];
  totalCents: number;
}

export type CommandHandler = (payload: unknown, ack: (res: CommandAck) => void) => void;

export interface ClientToServerEvents extends Record<CommandName, CommandHandler> {
  'order:resync': (payload: unknown, ack: (res: ResyncAck) => void) => void;
  'presence:choosing': (payload: unknown) => void;
}

export interface ServerToClientEvents {
  'order:event': (event: OrderEvent) => void;
  'presence:state': (state: PresenceState) => void;
  'kitchen:order': (order: KitchenOrder) => void;
}

/** auth del handshake: participante de un pedido, o pantalla de cocina de una sucursal. */
export type HandshakeAuth =
  | { kind?: 'participant'; tenantSlug: string; token: string }
  | { kind: 'kitchen'; tenantSlug: string; branchId: string };
