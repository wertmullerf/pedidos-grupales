import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

// Token de participante sin login: `payload.firma`, ambos en base64url, firmado con HMAC-SHA256.
// Incluye tenant y pedido para que el server pueda rechazar un token usado en otra cadena u otro pedido.

export interface ParticipantToken {
  tenantId: string;
  orderId: string;
  participantId: string;
}

const Payload = z.object({ t: z.guid(), o: z.guid(), p: z.guid() });

function sign(body: string, secret: string): string {
  return createHmac('sha256', secret).update(body).digest('base64url');
}

export function signToken(token: ParticipantToken, secret: string): string {
  const body = Buffer.from(
    JSON.stringify({ t: token.tenantId, o: token.orderId, p: token.participantId }),
  ).toString('base64url');
  return `${body}.${sign(body, secret)}`;
}

export function verifyToken(token: string, secret: string): ParticipantToken | null {
  const [body, signature, ...rest] = token.split('.');
  if (!body || !signature || rest.length > 0) return null;

  const expected = Buffer.from(sign(body, secret));
  const received = Buffer.from(signature);
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return null;

  try {
    const parsed = Payload.safeParse(JSON.parse(Buffer.from(body, 'base64url').toString('utf8')));
    if (!parsed.success) return null;
    return { tenantId: parsed.data.t, orderId: parsed.data.o, participantId: parsed.data.p };
  } catch {
    return null;
  }
}
