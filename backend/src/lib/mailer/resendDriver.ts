import type { MailSender } from './index';

/** Resend（resend.com）。用现成的 fetch 打 REST，不引依赖——这个后端一贯如此。
 *  失败必须抛：调用方要据此回 500，不能让用户对着一个永远等不到的验证码干等。 */
export const resendDriver: MailSender = {
  async send(email, code) {
    const key = process.env.RESEND_API_KEY;
    const from = process.env.MAIL_FROM;
    if (!key || !from) throw new Error('mail_not_configured'); // 配错了要立刻炸，别静默降级

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        from,
        to: [email],
        subject: `Fathom 登录验证码 ${code}`, // 码放进标题：通知栏一眼可见，不用点开
        text: `你的 Fathom 登录验证码是 ${code}，5 分钟内有效。\n\n如果这不是你本人的操作，忽略这封邮件即可。`,
      }),
    });
    if (!res.ok) {
      // 响应体可能含收件地址，只留状态码和短摘要，别把它写进日志
      throw new Error(`resend_failed_${res.status}`);
    }
  },
};
