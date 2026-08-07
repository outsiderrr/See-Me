# 部署（Fathom / 潜心 · 阿里云东京轻量应用服务器）

> 目录仍叫 `/opt/see-me`，**这是刻意的**：Compose 的项目名一旦跟着目录改，
> 卷名前缀也跟着改，会导致它找不到 `see-me_db-data` 而在空库上启动。
> compose 里已把 `name: see-me` 钉死，所以将来真要改目录也不会丢数据。

一台 Ubuntu 24.04 的轻量应用服务器即可（8G 内存绰绰有余）。

## 一次性：装 Docker + 拉代码 + 起服务

```bash
# 1) 装 Docker（含 compose 插件）
curl -fsSL https://get.docker.com | sh

# 2) 拉代码（仓库已公开，普通 clone 即可，不需要 token）
sudo git clone https://github.com/outsiderrr/See-Me.git /opt/see-me
sudo chown -R "$USER" /opt/see-me
cd /opt/see-me

# 3) 配置密钥
cp .env.server.example .env
nano .env   # 填 DB_PASSWORD 和 OTP_SECRET（各自一长串随机字符）

# 4) 构建并启动（数据库 + API + B 阅读网页）
docker compose up -d --build

# 5) 验证
curl -s http://localhost:3000/api/auth/request-code -X POST \
  -H 'content-type: application/json' -d '{"email":"you@example.com"}'
docker compose logs app | tail -5   # MAIL_DRIVER=dev 时能看到 [mail:dev] 验证码
```

之后浏览器打开 `http://<服务器公网IP>/` 就是 B 端登录阅读页；免登录卡的链接是
`http://<服务器公网IP>/c/<14位slug>`（slug 在 A 端建 open 卡时返回）。

> ⚠️ **上 HTTPS 之前别把真实的免登录链接发出去。** slug 就是这张卡的全部凭证，
> 明文 HTTP 会把它暴露在链路上的任何一跳。自己测试无妨，对外分享等 P1 的
> 域名 + Caddy 落地。

## 日常

```bash
cd /opt/see-me
docker compose logs -f app          # 看日志（MAIL_DRIVER=dev 时验证码在这里）
git pull && docker compose up -d --build   # 升级到最新代码
docker compose exec db pg_dump -U seeme see_me > backup.sql   # 备份
```

## 防火墙（轻量服务器控制台）

放行 TCP 80（HTTP）和 TCP 443（HTTPS）。80 不能关：Let's Encrypt 验证和
HTTP→HTTPS 跳转都要它。

## 域名 + HTTPS（P1，2026-08 上线）

1. 阿里云 DNS：`fathomlog.com` 加 A 记录 `@ → 服务器IP`，再加 `www → 服务器IP`
   （Caddyfile 里 www 跳转到裸域）。
2. 防火墙放行 443（见上节）。
3. 服务器上 `git pull && docker compose up -d --build`——caddy 服务起来后自动
   签证书（要等 DNS 解析生效；签失败它会自己重试）。
4. 验证：`https://fathomlog.com/health` 通、浏览器开 `/console` 有挂锁。
5. 从此 app 只绑 `127.0.0.1:3000`（运维脚本用），公网只有 Caddy 的 80/443；
   裸 IP 的 HTTP 访问无人应答，控制台一律走 `https://fathomlog.com/console`。

## 邮箱登录（2026-08-07 起；此前是手机验证码）

**为什么换**：给中国大陆手机发短信要过阿里云签名审核，审核要备案/公众号/企业资质
作佐证；备案又要求服务器在大陆，而本服务器在东京——那条路是死的。邮件没有这道关卡。

**首次切换**（`20260807140000_email_login` 迁移会把 `users.phone` 原样改名为
`users.email`，账号和笔记全部保留，但列里躺的还是旧手机号，**必须改成真邮箱才能登录**）：

```bash
cd /opt/see-me && git pull && docker compose up -d --build
# 把你的账号改成真实邮箱（<旧手机号> 换成迁移前登录用的那个）
docker compose exec db psql -U seeme -d see_me \
  -c "UPDATE users SET email='你的邮箱' WHERE email='<旧手机号>';"
```

**配真发信**（在这之前 `MAIL_DRIVER=dev`，验证码只打进容器日志）：

1. resend.com 注册，添加域名 `fathomlog.com`，按它给的 SPF/DKIM 记录去阿里云 DNS 添加；
2. 建一个 API key；
3. 服务器 `.env` 里填 `MAIL_DRIVER=resend`、`RESEND_API_KEY=re_...`、
   `MAIL_FROM=Fathom <noreply@fathomlog.com>`；
4. `docker compose up -d`，登录页发一次码验证。

## iOS 指向服务器

`ios/SeeMe/APIClient.swift` 里把 `deviceHost` 改成服务器公网 IP（或将来
的域名），重新 Archive 上传 TestFlight。ATS 目前允许 HTTP（0.01 开发版）；
上域名 + HTTPS 后应收紧为仅 HTTPS。

## 待办（M5 收尾）

- 域名解析到服务器 + Caddy/Nginx 做 HTTPS（免 ICP：服务器在东京）
- ~~阿里云短信签名~~ 已放弃：改成邮箱验证码（见「邮箱登录」节）
- 定期 pg_dump 备份
