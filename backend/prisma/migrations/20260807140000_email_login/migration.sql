-- 手机验证码 → 邮箱验证码。
--
-- 为什么换：给中国大陆手机发短信要过阿里云签名审核，而审核要备案/公众号/企业资质
-- 作佐证；备案又要求服务器在大陆，而本项目服务器在东京——这条路是死的。邮件无此关卡。
--
-- 迁移策略是**改名而非重建**：users 行原样保留，笔记、标签、卡、分享的外键一个都不动。
-- 老的 phone 值（11 位手机号）会原样躺在 email 列里，不是合法邮箱——部署后必须跑一条
-- UPDATE 把它改成真实邮箱才能登录（见 DEPLOY.md「邮箱登录」节）。刻意不在这里硬编码
-- 任何人的邮箱：仓库是公开的。

ALTER TABLE "users" RENAME COLUMN "phone" TO "email";
ALTER INDEX "users_phone_key" RENAME TO "users_email_key";

-- 验证码表直接重建：里面只有 5 分钟内有效的临时行，没有保留价值，
-- 而且旧行的主键是手机号，留着只会碍事。
DROP TABLE "phone_otps";
CREATE TABLE "email_otps" (
    "email" TEXT NOT NULL,
    "code_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "consumed" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_otps_pkey" PRIMARY KEY ("email")
);
