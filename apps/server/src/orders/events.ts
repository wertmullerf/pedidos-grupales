export type EventType =
  | 'participant_joined'
  | 'item_added'
  | 'item_incremented'
  | 'item_removed'
  | 'item_notes_updated'
  | 'order_locked'
  | 'order_unlocked'
  | 'order_submitted';

/** Evento del log append-only. `version` es la del pedido después de aplicarlo. */
export interface OrderEvent {
  orderId: string;
  version: number;
  clientOpId: string;
  type: EventType;
  payload: Record<string, unknown>;
}
