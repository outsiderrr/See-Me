import { devDriver } from './devDriver';
import { resendDriver } from './resendDriver';
import { aliyunDriver } from './aliyunDriver';

export interface MailSender {
  send(email: string, code: string): Promise<void>;
}

/** 驱动可插拔：契约是「把码送到这个地址」，换供应商只是加一个文件。
 *  取代了原来的短信驱动——给中国大陆手机发短信要过阿里云签名审核，
 *  而审核要备案/公众号/企业资质作佐证，服务器在东京办不了备案。邮件没这道关。
 *
 *  配错一律立刻抛，绝不静默降级：dev 驱动会把**明文验证码**打进容器日志，
 *  `MAIL_DRIVER=Resend`（大小写错）这种手滑要是回落到它，你会以为发信配好了，
 *  实际每个登录码都躺在 docker logs 里等人捡。 */
export function getMailSender(): MailSender {
  const name = (process.env.MAIL_DRIVER ?? 'dev').trim();
  // aliyun：收件方是 126/163/QQ 时选它，境外发信方常被网易系拒收
  if (name === 'aliyun') return aliyunDriver;
  if (name === 'resend') return resendDriver;
  if (name === 'dev') {
    // 生产上用 dev 驱动是**过渡期的合法选择**（真发信还没配好时，码从容器日志里读，
    // 和上线前一样）——但必须是明知故犯，不能是手滑滑进来的。
    if (process.env.NODE_ENV === 'production' && process.env.MAIL_DEV_IN_PROD !== '1') {
      throw new Error(
        'MAIL_DRIVER=dev 会把明文验证码写进容器日志。生产环境确实要临时这么用，' +
          '在 .env 里显式加 MAIL_DEV_IN_PROD=1；配好真发信后请删掉它。',
      );
    }
    return devDriver;
  }
  throw new Error(`未知的 MAIL_DRIVER：${name}（可选 dev | resend | aliyun）`);
}
