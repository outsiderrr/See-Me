import { beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../server';
import { db } from '../db';
import { resetDb } from '../test/helpers';

// 登录标识归一化的回归测试。2026-08-03 出过事故：同一个人用带/不带 `+86` 两种写法
// 登录，被当成两个账号，76 条笔记全落在其中一个名下、另一个是空壳。邮箱的域名部分
// 大小写不敏感，不归一就会重演同一个 bug —— 所以这条必须钉死。
describe('email login identity', () => {
  beforeEach(resetDb);

  const app = buildApp();
  const post = (path: string, body: unknown) =>
    app.request(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  /** MAIL_DRIVER 默认是 dev，验证码只打日志——测试里直接从库里取哈希不可行，
   *  改为拦 console.log 拿到明文码。 */
  async function codeFor(email: string): Promise<string> {
    const orig = console.log;
    let code = '';
    console.log = (...args: unknown[]) => {
      const m = String(args[0] ?? '').match(/your code is (\d{6})/);
      if (m) code = m[1];
    };
    try {
      const r = await post('/api/auth/request-code', { email });
      expect(r.status).toBe(200);
    } finally {
      console.log = orig;
    }
    expect(code).toMatch(/^\d{6}$/);
    return code;
  }

  it('treats case and whitespace variants as one and the same account', async () => {
    const code = await codeFor('Me@Example.COM');
    // 换一种写法来验证：大小写、首尾空格都不该产生第二个账号
    const r = await post('/api/auth/verify', { email: '  me@example.com  ', code });
    expect(r.status).toBe(200);

    const users = await db.user.findMany();
    expect(users).toHaveLength(1);
    expect(users[0].email).toBe('me@example.com'); // 落库的一律是归一化后的形态
  });

  it('rejects malformed addresses before any code is issued', async () => {
    for (const bad of ['', 'nope', 'a@b', 'a b@c.com', 'a@@b.com']) {
      expect((await post('/api/auth/request-code', { email: bad })).status).toBe(400);
    }
    expect(await db.emailOtp.count()).toBe(0);
    expect(await db.user.count()).toBe(0);
  });

  it('locks out after repeated wrong codes and never creates an account', async () => {
    await codeFor('brute@example.com');
    for (let i = 0; i < 5; i++) {
      expect((await post('/api/auth/verify', { email: 'brute@example.com', code: '000000' })).status).toBe(401);
    }
    const locked = await post('/api/auth/verify', { email: 'brute@example.com', code: '000000' });
    expect((await locked.json()).error).toBe('locked');
    expect(await db.user.count()).toBe(0); // 猜码猜不出账号来
  });
});
