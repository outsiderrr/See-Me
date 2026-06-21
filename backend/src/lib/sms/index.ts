import { devDriver } from './devDriver';

export interface SmsSender {
  send(phone: string, code: string): Promise<void>;
}

export function getSmsSender(): SmsSender {
  switch (process.env.SMS_DRIVER ?? 'dev') {
    case 'dev':
      return devDriver;
    // case 'aliyun': return aliyunDriver;  // wired in M5 once the signature is approved
    default:
      return devDriver;
  }
}
