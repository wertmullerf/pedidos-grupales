import { z } from 'zod';
import { OrderItemSchema, ParticipantSchema } from './domain.js';

// Eventos del log append-only (order_events). `version` es la del pedido después de aplicarlo;
// `by` es el participante que originó el cambio.

const base = {
  orderId: z.uuid(),
  version: z.number().int().positive(),
  clientOpId: z.uuid(),
};
const By = z.uuid();

export const OrderEventSchema = z.discriminatedUnion('type', [
  z.object({
    ...base,
    type: z.literal('participant_joined'),
    payload: z.object({ participant: ParticipantSchema }),
  }),
  z.object({
    ...base,
    type: z.literal('item_added'),
    payload: z.object({ by: By, item: OrderItemSchema }),
  }),
  z.object({
    ...base,
    type: z.literal('item_incremented'),
    // quantity es la cantidad resultante; 0 significa que la línea se eliminó.
    payload: z.object({
      by: By,
      itemId: z.uuid(),
      delta: z.number().int(),
      quantity: z.number().int().nonnegative(),
    }),
  }),
  z.object({
    ...base,
    type: z.literal('item_removed'),
    payload: z.object({ by: By, itemId: z.uuid() }),
  }),
  z.object({
    ...base,
    type: z.literal('item_notes_updated'),
    payload: z.object({ by: By, itemId: z.uuid(), notes: z.string() }),
  }),
  z.object({ ...base, type: z.literal('order_locked'), payload: z.object({ by: By }) }),
  z.object({ ...base, type: z.literal('order_unlocked'), payload: z.object({ by: By }) }),
  z.object({ ...base, type: z.literal('order_submitted'), payload: z.object({ by: By }) }),
]);

export type OrderEvent = z.infer<typeof OrderEventSchema>;
export type EventType = OrderEvent['type'];
export type EventOf<T extends EventType> = Extract<OrderEvent, { type: T }>;
