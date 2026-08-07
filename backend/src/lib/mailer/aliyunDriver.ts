import { createHmac, randomUUID } from 'node:crypto';
import type { MailSender } from './index';

// 阿里云邮件推送（DirectMail）。为什么需要它：收件方是 126/163/QQ 时，网易系对境外
// 发信方过滤极严，Resend 这类境外服务很可能被拒收或丢进垃圾箱；阿里云走国内链路，
// 投递率高得多。依然零依赖——RPC 签名用 node 自带的 crypto 手写。
//
// 契约来源（2026-08-07 核对）：
//   签名机制 https://www.alibabacloud.com/help/zh/direct-mail/signature
//   公共参数 https://www.alibabacloud.com/help/zh/direct-mail/public-parameters
//   SingleSendMail https://www.alibabacloud.com/help/zh/direct-mail/api-dm-2015-11-23-singlesendmail

/**
 * 阿里云的 percentEncode：只有 A-Za-z0-9-_.~ 不编码。
 * encodeURIComponent 差在 `!'()*` 这五个字符上——它不编码，阿里云要求编码。
 * 漏掉它们的后果是签名在含这些字符时才失败（邮箱本地部分完全可能有 `'`），
 * 是那种「平时好好的，某个用户就是登不上」的鬼故事，所以这里显式补齐。
 */
export const percentEncode = (s: string) =>
  encodeURIComponent(s)
    .replace(/!/g, '%21')
    .replace(/'/g, '%27')
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29')
    .replace(/\*/g, '%2A');

/** 规范化查询串：参数名字典序，键值各自 percentEncode 后用 = 连、用 & 拼。 */
export const canonicalQuery = (params: Record<string, string>) =>
  Object.keys(params)
    .sort()
    .map((k) => `${percentEncode(k)}=${percentEncode(params[k])}`)
    .join('&');

/**
 * StringToSign = METHOD + "&" + percentEncode("/") + "&" + percentEncode(规范化查询串)。
 * 注意最后一段是**二次编码**：规范化串里已经是 `%3C` 的地方，这里会变成 `%253C`。
 * 少一次或多一次编码都会得到一个看起来很像、但服务端永远不认的签名。
 */
export const stringToSign = (method: string, params: Record<string, string>) =>
  `${method}&${percentEncode('/')}&${percentEncode(canonicalQuery(params))}`;

/** HMAC-SHA1 的 key 是 AccessKeySecret **加一个 & 字符**，结果 base64。 */
export const sign = (method: string, params: Record<string, string>, secret: string) =>
  createHmac('sha1', secret + '&').update(stringToSign(method, params)).digest('base64');

// 地域决定 Version：杭州是 2015-11-23，其它地域（如新加坡）是 2017-06-22。
const DEFAULT_ENDPOINT = 'https://dm.aliyuncs.com/';
const DEFAULT_VERSION = '2015-11-23';

export const aliyunDriver: MailSender = {
  async send(email, code) {
    const keyId = process.env.ALIYUN_ACCESS_KEY_ID;
    const secret = process.env.ALIYUN_ACCESS_KEY_SECRET;
    const account = process.env.ALIYUN_DM_ACCOUNT; // 控制台里配好的发信地址
    if (!keyId || !secret || !account) throw new Error('mail_not_configured');

    const params: Record<string, string> = {
      // 公共参数
      Format: 'JSON',
      Version: process.env.ALIYUN_DM_VERSION || DEFAULT_VERSION,
      AccessKeyId: keyId,
      SignatureMethod: 'HMAC-SHA1',
      SignatureVersion: '1.0',
      SignatureNonce: randomUUID(),
      Timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'), // 要 YYYY-MM-DDThh:mm:ssZ
      // 业务参数
      Action: 'SingleSendMail',
      AccountName: account,
      AddressType: '1', // 用发信地址，不用随机账号
      ReplyToAddress: 'false',
      ToAddress: email,
      Subject: `Fathom 登录验证码 ${code}`, // 码放进标题：通知栏一眼可见，不用点开
      TextBody: `你的 Fathom 登录验证码是 ${code}，5 分钟内有效。\n\n如果这不是你本人的操作，忽略这封邮件即可。`,
      ...(process.env.ALIYUN_DM_FROM_ALIAS ? { FromAlias: process.env.ALIYUN_DM_FROM_ALIAS } : {}),
    };

    const body = `${canonicalQuery(params)}&Signature=${percentEncode(sign('POST', params, secret))}`;
    const res = await fetch(process.env.ALIYUN_DM_ENDPOINT || DEFAULT_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!res.ok) {
      // 只取错误码：Message 里可能回显收件地址，不该进日志
      const codeName = await res
        .json()
        .then((j: { Code?: string }) => j?.Code ?? 'unknown')
        .catch(() => 'unparseable');
      throw new Error(`aliyun_dm_failed_${res.status}_${codeName}`);
    }
  },
};
