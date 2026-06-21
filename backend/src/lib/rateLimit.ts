import { db } from '../db';

/**
 * Cross-process atomic rate limiter backed by a single SQL UPSERT.
 * Resets the counter when the window has expired, otherwise increments.
 * (Spec §5: redeem/OTP limiting must be cross-process atomic — no in-memory counters.)
 */
export async function consume(
  key: string,
  limit: number,
  windowMs: number,
): Promise<{ allowed: boolean; count: number; retryAfterMs: number }> {
  const rows = await db.$queryRaw<{ count: number; window_end: Date }[]>`
    INSERT INTO rate_limits (key, count, window_end)
    VALUES (${key}, 1, now() + (${windowMs}::text || ' milliseconds')::interval)
    ON CONFLICT (key) DO UPDATE SET
      count = CASE WHEN rate_limits.window_end < now() THEN 1 ELSE rate_limits.count + 1 END,
      window_end = CASE WHEN rate_limits.window_end < now()
                        THEN now() + (${windowMs}::text || ' milliseconds')::interval
                        ELSE rate_limits.window_end END
    RETURNING count, window_end;
  `;
  const { count, window_end } = rows[0];
  const allowed = count <= limit;
  const retryAfterMs = allowed ? 0 : Math.max(0, new Date(window_end).getTime() - Date.now());
  return { allowed, count, retryAfterMs };
}
