import { z } from 'zod';

export const ErrorCodeSchema = z.enum([
  'VALIDATION_ERROR',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'RATE_LIMITED',
  'TENANT_NOT_FOUND',
  'ORDER_NOT_FOUND',
  'BRANCH_NOT_FOUND',
  'BRANCH_CLOSED',
  'MENU_ITEM_NOT_FOUND',
  'MENU_ITEM_UNAVAILABLE',
  'ITEM_NOT_FOUND',
  'ITEM_ID_CONFLICT',
  'NOT_OWNER',
  'NOT_HOST',
  'ORDER_LOCKED',
  'INVALID_STATUS',
  'EMPTY_ORDER',
  'CLIENT_OP_CONFLICT',
  'CONFLICT',
  'INTERNAL',
]);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

export interface ApiError {
  code: ErrorCode;
  message: string;
}

/** Cuerpo de error de la API REST. */
export interface ApiErrorBody {
  error: ApiError & { issues?: unknown };
}
