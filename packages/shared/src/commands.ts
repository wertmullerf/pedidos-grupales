import { z } from 'zod';

// Operaciones sobre un pedido. Todas llevan clientOpId (UUID generado por el cliente) para la
// idempotencia: un reintento con el mismo clientOpId se aplica una sola vez.

const ClientOpId = z.uuid();
const Notes = z.string().trim().max(140);

export const AddItemCommand = z.object({
  clientOpId: ClientOpId,
  /**
   * Id de la nueva línea, opcional. Si el cliente lo genera puede operar sobre la línea
   * (sumar, anotar) antes de recibir la confirmación, sin mapear ids temporales.
   */
  itemId: z.uuid().optional(),
  menuItemId: z.uuid(),
  quantity: z.number().int().min(1).max(20).default(1),
  notes: Notes.default(''),
});

/** Deltas, no valores absolutos. El tope admite varios toques agrupados por el debounce. */
export const IncrementItemCommand = z.object({
  clientOpId: ClientOpId,
  itemId: z.uuid(),
  delta: z
    .number()
    .int()
    .min(-50)
    .max(50)
    .refine((d) => d !== 0, 'delta no puede ser 0'),
});

export const RemoveItemCommand = z.object({ clientOpId: ClientOpId, itemId: z.uuid() });

export const UpdateNotesCommand = z.object({
  clientOpId: ClientOpId,
  itemId: z.uuid(),
  notes: Notes,
});

export const OrderStatusCommand = z.object({ clientOpId: ClientOpId });

export const COMMAND_SCHEMAS = {
  'item:add': AddItemCommand,
  'item:increment': IncrementItemCommand,
  'item:remove': RemoveItemCommand,
  'item:notes': UpdateNotesCommand,
  'order:lock': OrderStatusCommand,
  'order:unlock': OrderStatusCommand,
  'order:submit': OrderStatusCommand,
} as const;

export type CommandName = keyof typeof COMMAND_SCHEMAS;
export const COMMAND_NAMES = Object.keys(COMMAND_SCHEMAS) as CommandName[];

/** Lo que manda el cliente (defaults opcionales). */
export type CommandInput<C extends CommandName> = z.input<(typeof COMMAND_SCHEMAS)[C]>;
/** Lo que recibe el servicio ya validado. */
export type Command<C extends CommandName> = z.output<(typeof COMMAND_SCHEMAS)[C]>;

export type AddItemInput = CommandInput<'item:add'>;
export type IncrementItemInput = CommandInput<'item:increment'>;
export type RemoveItemInput = CommandInput<'item:remove'>;
export type UpdateNotesInput = CommandInput<'item:notes'>;
export type OrderStatusInput = CommandInput<'order:lock'>;
