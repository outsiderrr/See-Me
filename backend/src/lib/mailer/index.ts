import { devDriver } from './devDriver';
import { resendDriver } from './resendDriver';

export interface MailSender {
  send(email: string, code: string): Promise<void>;
}

/** 驱动可插拔：契约是「把码送到这个地址」，换供应商只是加一个文件。
 *  取代了原来的短信驱动——给中国大陆手机发短信要过阿里云签名审核，
 *  而审核要备案/公众号/企业资质作佐证，服务器在东京办不了备案。邮件没这道关。 */
export function getMailSender(): MailSender {
  switch (process.env.MAIL_DRIVER ?? 'dev') {
    case 'resend':
      return resendDriver;
    case 'dev':
      return devDriver;
    default:
      return devDriver;
  }
}
