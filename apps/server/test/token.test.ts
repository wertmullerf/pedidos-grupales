import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { signToken, verifyToken } from '../src/auth/token.js';

const SECRET = 'secret-de-prueba-123';
const payload = { tenantId: randomUUID(), orderId: randomUUID(), participantId: randomUUID() };

describe('token de participante', () => {
  it('verifica un token firmado con el mismo secreto', () => {
    expect(verifyToken(signToken(payload, SECRET), SECRET)).toEqual(payload);
  });

  it('rechaza un token firmado con otro secreto', () => {
    expect(verifyToken(signToken(payload, SECRET), 'otro-secreto-distinto')).toBeNull();
  });

  it('rechaza un payload alterado (p. ej. cambiar de tenant)', () => {
    const [, signature] = signToken(payload, SECRET).split('.');
    const forged = Buffer.from(
      JSON.stringify({ t: randomUUID(), o: payload.orderId, p: payload.participantId }),
    ).toString('base64url');
    expect(verifyToken(`${forged}.${signature}`, SECRET)).toBeNull();
  });

  it('rechaza basura', () => {
    expect(verifyToken('', SECRET)).toBeNull();
    expect(verifyToken('a.b.c', SECRET)).toBeNull();
    expect(verifyToken('no-es-un-token', SECRET)).toBeNull();
  });
});
