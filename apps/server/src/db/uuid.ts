import { createHash } from 'node:crypto';

/** Namespace propio del proyecto para los UUID v5 del seed. */
export const SEED_NAMESPACE = '6f1c3b2e-8d4a-4f7e-9b1a-2c5d7e9f0a13';

/**
 * UUID v5 (RFC 9562): SHA-1 de namespace + nombre, con los bits de versión y variante fijados.
 * Mismo nombre => mismo UUID, así el seed es idempotente y los IDs pasan una validación estricta.
 */
export function uuidV5(name: string, namespace: string = SEED_NAMESPACE): string {
  const ns = Buffer.from(namespace.replace(/-/g, ''), 'hex');
  const hash = createHash('sha1').update(ns).update(name, 'utf8').digest();
  hash[6] = (hash[6]! & 0x0f) | 0x50; // versión 5
  hash[8] = (hash[8]! & 0x3f) | 0x80; // variante RFC
  const hex = hash.subarray(0, 16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
