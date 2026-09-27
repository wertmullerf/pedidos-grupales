import { z } from 'zod';

export const OrderStatusSchema = z.enum(['open', 'locked', 'submitted']);
export type OrderStatus = z.infer<typeof OrderStatusSchema>;

export const ParticipantSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  color: z.string(),
});
export type Participant = z.infer<typeof ParticipantSchema>;

/** Una línea del pedido. El precio unitario queda congelado al agregarla. */
export const OrderItemSchema = z.object({
  id: z.uuid(),
  participantId: z.uuid(),
  menuItemId: z.uuid(),
  name: z.string(),
  unitPriceCents: z.number().int().nonnegative(),
  quantity: z.number().int().positive(),
  notes: z.string(),
});
export type OrderItem = z.infer<typeof OrderItemSchema>;

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
