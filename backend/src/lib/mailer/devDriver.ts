import type { MailSender } from './index';

/** Dev only: prints the code so the developer can read it from the server log.
 *  The production driver MUST NEVER log the plaintext code. */
export const devDriver: MailSender = {
  async send(email, code) {
    console.log(`[mail:dev] -> ${email}: your code is ${code}`);
  },
};
