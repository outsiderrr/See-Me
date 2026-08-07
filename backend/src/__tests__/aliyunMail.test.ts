import { describe, expect, it, afterEach } from 'vitest';
import { percentEncode, canonicalQuery, stringToSign, sign } from '../lib/mailer/aliyunDriver';

// 签名算法是这个驱动里唯一「写错了本地毫无征兆、只在真发信时失败」的部分，
// 所以拿阿里云文档（https://www.alibabacloud.com/help/zh/direct-mail/signature）
// 里的实例值来钉死它。
describe('aliyun DirectMail signing', () => {
  it('percent-encodes exactly the characters Aliyun requires', () => {
    // 文档实例：AccountName 为 <a%b'> 时，一次编码的结果
    expect(percentEncode("<a%b'>")).toBe('%3Ca%25b%27%3E');
    // encodeURIComponent 默认放过这五个，阿里云要求编码——漏了就只在含它们时炸
    expect(percentEncode("!'()*")).toBe('%21%27%28%29%2A');
    // 这四个必须保持原样，多编码同样会让签名失效
    expect(percentEncode('-_.~')).toBe('-_.~');
    expect(percentEncode(' ')).toBe('%20');
  });

  it('builds the documented StringToSign (double-encoded, sorted, POST)', () => {
    const params = { AccessKeyId: 'testid', AccountName: "<a%b'>", Action: 'SingleSendMail' };
    // 文档给的实例前缀，一字不差
    expect(stringToSign('POST', params)).toBe(
      'POST&%2F&AccessKeyId%3Dtestid%26AccountName%3D%253Ca%2525b%2527%253E%26Action%3DSingleSendMail',
    );
  });

  it('sorts parameters by name, not by insertion order', () => {
    const a = canonicalQuery({ Zeta: '1', Alpha: '2', Mu: '3' });
    const b = canonicalQuery({ Alpha: '2', Mu: '3', Zeta: '1' });
    expect(a).toBe('Alpha=2&Mu=3&Zeta=1');
    expect(a).toBe(b);
  });

  it('keys the HMAC with secret + "&" and returns base64', () => {
    const params = { AccessKeyId: 'testid', Action: 'SingleSendMail' };
    const s = sign('POST', params, 'testsecret');
    expect(s).toMatch(/^[A-Za-z0-9+/]+=*$/);
    // key 尾部那个 & 是阿里云的规定，掉了就是另一个签名
    const withoutAmp = require('node:crypto')
      .createHmac('sha1', 'testsecret')
      .update(stringToSign('POST', params))
      .digest('base64');
    expect(s).not.toBe(withoutAmp);
  });
});

describe('aliyun driver request', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
    for (const k of ['ALIYUN_ACCESS_KEY_ID', 'ALIYUN_ACCESS_KEY_SECRET', 'ALIYUN_DM_ACCOUNT']) delete process.env[k];
  });

  it('refuses to pretend it sent anything when unconfigured', async () => {
    const { aliyunDriver } = await import('../lib/mailer/aliyunDriver');
    await expect(aliyunDriver.send('a@b.com', '123456')).rejects.toThrow('mail_not_configured');
  });

  it('posts a signed form body carrying the code, and throws on API failure', async () => {
    process.env.ALIYUN_ACCESS_KEY_ID = 'testid';
    process.env.ALIYUN_ACCESS_KEY_SECRET = 'testsecret';
    process.env.ALIYUN_DM_ACCOUNT = 'noreply@fathomlog.com';
    const { aliyunDriver } = await import('../lib/mailer/aliyunDriver');

    let captured: { url: string; body: string } | null = null;
    globalThis.fetch = (async (url: string, init: { body: string }) => {
      captured = { url: String(url), body: init.body };
      return { ok: true, json: async () => ({ RequestId: 'x' }) };
    }) as unknown as typeof fetch;

    await aliyunDriver.send('me@126.com', '445985');
    expect(captured!.url).toContain('dm.aliyuncs.com');
    const body = captured!.body;
    expect(body).toContain('Action=SingleSendMail');
    expect(body).toContain('AccountName=noreply%40fathomlog.com');
    expect(body).toContain('ToAddress=me%40126.com');
    expect(body).toContain('445985'); // 验证码确实带上了
    expect(body).toMatch(/&Signature=[^&]+$/); // 签名在最后，且已编码
    // Timestamp 必须是 YYYY-MM-DDThh:mm:ssZ（带毫秒会被服务端拒签）
    expect(decodeURIComponent(body.match(/Timestamp=([^&]+)/)![1])).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);

    globalThis.fetch = (async () => ({
      ok: false,
      status: 400,
      json: async () => ({ Code: 'InvalidMailAddress' }),
    })) as unknown as typeof fetch;
    await expect(aliyunDriver.send('me@126.com', '000000')).rejects.toThrow('aliyun_dm_failed_400_InvalidMailAddress');
  });
});
