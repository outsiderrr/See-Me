import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../env';

export function hmacHex(value: string): string {
  return createHmac('sha256', env.otpSecret()).update(value).digest('hex');
}

export function timingSafeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}
