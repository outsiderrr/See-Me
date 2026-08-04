import type { Context } from 'hono';
import { getConnInfo } from '@hono/node-server/conninfo';
import { hmacHex } from './hash';

/** Caller address. 信任前提（P1 拓扑，见 Caddyfile）：app 端口只绑 127.0.0.1，
 *  公网唯一入口是 Caddy，而 Caddy 会**整体替换** X-Forwarded-For 为真实客户端
 *  地址——所以取第一个值是安全的，客户端自带的伪造头活不过 Caddy。
 *  没有 XFF 的请求只能来自本机（运维脚本）或本地开发，回落到 socket 对端。 */
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
