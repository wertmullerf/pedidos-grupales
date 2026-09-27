// Contrato con el servidor (apps/server). Los tests de integración del server ejercitan este
// paquete contra el server real, así que un desvío entre ambos lados rompe los tests.

export type OrderStatus = 'open' | 'locked' | 'submitted';

export interface Participant {
  id: string;
  name: string;
  color: string;
}

export interface OrderItem {
  id: string;
  participantId: string;
  menuItemId: string;
  name: string;
  unitPriceCents: number;
  quantity: number;
  notes: string;
}

export interface OrderSnapshot {
  order: {
    id: string;
    code: string;
    status: OrderStatus;
    version: number;
    hostParticipantId: string;
    createdAt: string;
    updatedAt: string;
  };
  branch: { id: string; name: string; address: string; isOpen: boolean };
  participants: (Participant & { joinedAt?: string })[];
  items: OrderItem[];
  totalCents: number;
}

export type EventType =
  | 'participant_joined'
  | 'item_added'
  | 'item_incremented'
  | 'item_removed'
  | 'item_notes_updated'
  | 'order_locked'
  | 'order_unlocked'
  | 'order_submitted';

export interface OrderEvent {
  orderId: string;
  version: number;
  clientOpId: string;
  type: EventType;
  payload: Record<string, unknown>;
}

export type CommandName =
  | 'item:add'
  | 'item:increment'
  | 'item:remove'
  | 'item:notes'
  | 'order:lock'
  | 'order:unlock'
  | 'order:submit';

export interface ErrorAck {
  ok: false;
  error: { code: string; message: string };
  /** Versión actual del pedido en el server (null si no se consultó, p. ej. RATE_LIMITED). */
  version: number | null;
}

export type CommandAck =
  { ok: true; status: 'applied' | 'duplicate'; version: number; event: OrderEvent } | ErrorAck;

export type ResyncAck =
  | { ok: true; mode: 'events'; events: OrderEvent[] }
  | { ok: true; mode: 'snapshot'; snapshot: OrderSnapshot }
  | ErrorAck;

export interface PresenceState {
  participants: { participantId: string; choosing: boolean }[];
}
