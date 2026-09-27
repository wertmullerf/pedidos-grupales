import { z } from 'zod';

// Comandos de mutación. Todos llevan clientOpId (UUID generado por el cliente) para la
// idempotencia de la regla 5. Se validan acá para que socket y tests pasen por lo mismo.

const ClientOpId = z.uuid();
const Notes = z.string().trim().max(140);

export const AddItem = z.object({
  clientOpId: ClientOpId,
  menuItemId: z.uuid(),
  quantity: z.number().int().min(1).max(20).default(1),
  notes: Notes.default(''),
});

// Deltas, no valores absolutos (regla 3). El tope admite varios toques agrupados por el debounce.
export const IncrementItem = z.object({
  clientOpId: ClientOpId,
  itemId: z.uuid(),
  delta: z
    .number()
    .int()
    .min(-50)
    .max(50)
    .refine((d) => d !== 0, 'delta no puede ser 0'),
});

export const RemoveItem = z.object({ clientOpId: ClientOpId, itemId: z.uuid() });

export const UpdateNotes = z.object({ clientOpId: ClientOpId, itemId: z.uuid(), notes: Notes });

export const OrderCommand = z.object({ clientOpId: ClientOpId });

export type AddItemInput = z.input<typeof AddItem>;
export type IncrementItemInput = z.input<typeof IncrementItem>;
export type RemoveItemInput = z.input<typeof RemoveItem>;
export type UpdateNotesInput = z.input<typeof UpdateNotes>;
export type OrderCommandInput = z.input<typeof OrderCommand>;
