function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

export const env = {
  databaseUrl: () => req('DATABASE_URL'),
  otpSecret: () => req('OTP_SECRET'),
  smsDriver: () => process.env.SMS_DRIVER ?? 'dev',
  sessionTtlDays: () => Number(process.env.SESSION_TTL_DAYS ?? '60'),
  port: () => Number(process.env.PORT ?? '3000'),
};
