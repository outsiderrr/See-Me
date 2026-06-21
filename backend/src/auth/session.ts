import { randomBytes } from 'node:crypto';
import { db } from '../db';
import { env } from '../env';

/** Opaque, high-entropy, server-side revocable session token.
 *  Works as both a web cookie value and a native Bearer token. */
export async function createSession(userId: string): Promise<{ id: string; expiresAt: Date }> {
  const id = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + env.sessionTtlDays() * 86_400_000);
  await db.session.create({ data: { id, userId, expiresAt } });
  return { id, expiresAt };
}

export async function validateSession(sessionId: string): Promise<{ userId: string } | null> {
  const s = await db.session.findUnique({ where: { id: sessionId } });
  if (!s || s.revoked || s.expiresAt.getTime() < Date.now()) return null;
  return { userId: s.userId };
}

export async function revokeSession(sessionId: string): Promise<void> {
  await db.session.updateMany({ where: { id: sessionId }, data: { revoked: true } });
}
