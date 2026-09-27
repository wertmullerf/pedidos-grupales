import type { RequestHandler } from 'express';
import { verifyToken, type ParticipantToken } from '../auth/token.js';
import { AppError } from './errors.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Locals {
      actor: ParticipantToken;
    }
  }
}

/**
 * Valida un token contra la cadena resuelta por la URL (regla 10): un token firmado para otra
 * cadena se rechaza aunque la firma sea válida. Se reutiliza en el handshake de Socket.IO.
 */
export function authenticateParticipant(
  token: string | undefined,
  tenantId: string,
  secret: string,
): ParticipantToken {
  if (!token) throw new AppError(401, 'UNAUTHORIZED', 'Falta el token');
  const actor = verifyToken(token, secret);
  if (!actor) throw new AppError(401, 'UNAUTHORIZED', 'Token inválido o vencido');
  if (actor.tenantId !== tenantId) {
    throw new AppError(403, 'FORBIDDEN', 'El token no pertenece a esta cadena');
  }
  return actor;
}

/** Exige `Authorization: Bearer <token>`. Debe montarse después de resolveTenant. */
export function requireParticipant(secret: string): RequestHandler {
  return (req, res, next) => {
    const header = req.get('authorization');
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    res.locals.actor = authenticateParticipant(token, res.locals.tenant.id, secret);
    next();
  };
}
