import type { SmsSender } from './index';

/** Dev only: prints the code so the developer can read it from the server log.
 *  The aliyun/production driver MUST NEVER log the plaintext code. */
export const devDriver: SmsSender = {
  async send(phone, code) {
    console.log(`[sms:dev] -> ${phone}: your code is ${code}`);
  },
};
