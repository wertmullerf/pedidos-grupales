import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

// Token de participante sin login: `payload.firma`, ambos en base64url, firmado con HMAC-SHA256.
// Incluye tenant y pedido para que el server pueda rechazar un token usado en otra cadena u otro pedido.

export interface ParticipantToken {
  tenantId: string;
  orderId: string;
  participantId: string;
}

export const TOKEN_TTL_SECONDS = 24 * 60 * 60;

const Payload = z.object({
  t: z.uuid(),
  o: z.uuid(),
  p: z.uuid(),
  exp: z.number().int(), // segundos desde epoch
});

const nowSeconds = () => Math.floor(Date.now() / 1000);

function sign(body: string, secret: string): Buffer {
  return createHmac('sha256', secret).update(body).digest();
}

export function signToken(
  token: ParticipantToken,
  secret: string,
  { ttlSeconds = TOKEN_TTL_SECONDS, now = nowSeconds() } = {},
): string {
  const body = Buffer.from(
    JSON.stringify({
      t: token.tenantId,
      o: token.orderId,
      p: token.participantId,
      exp: now + ttlSeconds,
    }),
  ).toString('base64url');
  return `${body}.${sign(body, secret).toString('base64url')}`;
}

/** Devuelve el payload si la firma es válida y no venció; si no, null. */
export function verifyToken(
  token: string,
  secret: string,
  now: number = nowSeconds(),
): ParticipantToken | null {
  const [body, signature, ...rest] = token.split('.');
  if (!body || !signature || rest.length > 0) return null;

  // Comparación en tiempo constante sobre los bytes de la firma.
  const expected = sign(body, secret);
  const received = Buffer.from(signature, 'base64url');
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return null;

  let parsed;
  try {
    parsed = Payload.safeParse(JSON.parse(Buffer.from(body, 'base64url').toString('utf8')));
  } catch {
    return null;
  }
  if (!parsed.success || parsed.data.exp <= now) return null;
  return { tenantId: parsed.data.t, orderId: parsed.data.o, participantId: parsed.data.p };
}
