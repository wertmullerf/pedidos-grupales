export interface TokenBucketRule {
  /** Ráfaga máxima de eventos. */
  capacity: number;
  /** Eventos por segundo que se recuperan. */
  refillPerSecond: number;
}

/**
 * Rate limit por conexión. Vive en memoria porque una conexión WebSocket está fija en una sola
 * instancia: no hace falta compartir el contador entre servers.
 */
export class TokenBucket {
  private tokens: number;
  private last: number;

  constructor(
    private readonly rule: TokenBucketRule,
    private readonly now: () => number = Date.now,
  ) {
    this.tokens = rule.capacity;
    this.last = now();
  }

  take(): boolean {
    const now = this.now();
    this.tokens = Math.min(
      this.rule.capacity,
      this.tokens + ((now - this.last) / 1000) * this.rule.refillPerSecond,
    );
    this.last = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}
