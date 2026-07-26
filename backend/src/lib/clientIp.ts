import type { Context } from 'hono';
import { getConnInfo } from '@hono/node-server/conninfo';
import { hmacHex } from './hash';

/** Best-effort caller address. Behind the P1 Caddy front end this is the
 *  X-Forwarded-For entry; direct connections fall back to the socket peer. */
export function clientIp(c: Context): string {
  const xff = c.req.header('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  try {
    return getConnInfo(c).remote.address ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

/** Stable pseudonym for a rate-limit key. Same address → same bucket, but no
 *  plaintext reader address is ever written to the database: an open card keeps
 *  no reader records, and the abuse counters must not quietly become one. */
export function ipRateKey(ip: string): string {
  return hmacHex(ip).slice(0, 24);
}

export function clientIpRateKey(c: Context): string {
  return ipRateKey(clientIp(c));
}
