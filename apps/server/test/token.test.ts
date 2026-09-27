import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { signToken, TOKEN_TTL_SECONDS, verifyToken } from '../src/auth/token.js';

const SECRET = 'secret-de-prueba-123';
const payload = { tenantId: randomUUID(), orderId: randomUUID(), participantId: randomUUID() };

function decodeBody(token: string) {
  return JSON.parse(Buffer.from(token.split('.')[0]!, 'base64url').toString('utf8'));
}

describe('token de participante', () => {
  it('verifica un token firmado con el mismo secreto', () => {
    expect(verifyToken(signToken(payload, SECRET), SECRET)).toEqual(payload);
  });

  it('incluye exp a 24 h', () => {
    const now = 1_800_000_000;
    const token = signToken(payload, SECRET, { now });
    expect(decodeBody(token).exp).toBe(now + TOKEN_TTL_SECONDS);
    expect(TOKEN_TTL_SECONDS).toBe(24 * 60 * 60);
  });

  it('rechaza un token vencido', () => {
    const now = 1_800_000_000;
    const token = signToken(payload, SECRET, { now });
    expect(verifyToken(token, SECRET, now + TOKEN_TTL_SECONDS - 1)).toEqual(payload);
    expect(verifyToken(token, SECRET, now + TOKEN_TTL_SECONDS)).toBeNull();
  });

  it('rechaza un token firmado con otro secreto', () => {
    expect(verifyToken(signToken(payload, SECRET), 'otro-secreto-distinto')).toBeNull();
  });

  it('rechaza un payload alterado (cambiar de tenant, pedido o extender exp)', () => {
    const original = signToken(payload, SECRET);
    const [, signature] = original.split('.');
    const body = decodeBody(original);
    for (const forgedBody of [
      { ...body, t: randomUUID() },
      { ...body, o: randomUUID() },
      { ...body, exp: body.exp + 3600 },
    ]) {
      const forged = Buffer.from(JSON.stringify(forgedBody)).toString('base64url');
      expect(verifyToken(`${forged}.${signature}`, SECRET)).toBeNull();
    }
  });

  it('rechaza una firma alterada', () => {
    const [body, signature] = signToken(payload, SECRET).split('.');
    const flipped = signature!.slice(0, -2) + (signature!.endsWith('AA') ? 'BB' : 'AA');
    expect(verifyToken(`${body}.${flipped}`, SECRET)).toBeNull();
  });

  it('rechaza basura', () => {
    expect(verifyToken('', SECRET)).toBeNull();
    expect(verifyToken('a.b.c', SECRET)).toBeNull();
    expect(verifyToken('no-es-un-token', SECRET)).toBeNull();
  });
});
