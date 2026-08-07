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
`users.email`，账号和笔记全部保留，但列里躺的还是旧手机号，**必须改成真邮箱才能登录**）。

⚠️ **顺序不能变：改邮箱必须发生在 app 起来之前。** 迁移完成到 UPDATE 之间，只要
有人（包括你自己手快）打开登录页输一次邮箱，服务端就会用那个地址 upsert 出一个
**新的空账号**占掉唯一键，随后的 UPDATE 撞键失败，76 条笔记留在旧行上——2026-08-03
的「一人两账号」事故就是这么发生的。所以先只起数据库、迁完、改完，最后才放 app 出来：

```bash
cd /opt/see-me && git pull

# 1) 先构建新镜像，再起数据库。
#    ⚠️ build 不能省：Dockerfile 是 `COPY . .`，迁移文件是**打进镜像**的，源码目录里
#    有不等于容器里有。跳过它的话下一步会报「No pending migrations to apply」，
#    然后 UPDATE 报 column "email" does not exist（2026-08-07 实际踩过）。
docker compose build app
docker compose up -d db

# 2) 单独跑迁移（app 容器跑完即退，不监听端口）
docker compose run --rm --entrypoint sh app -c 'npx prisma migrate deploy'

# 3) 把账号改成真实邮箱。lower(trim()) 是硬要求：后端登录时会把输入归一化成小写，
#    库里若存了大写，你永远登不进这一行。RETURNING 用来确认确实改到了 1 行。
docker compose exec db psql -U seeme -d see_me -c \
  "UPDATE users SET email=lower(trim('你的邮箱')) WHERE email='<旧手机号>' RETURNING id, email;"
#    ↑ 返回 0 行 = WHERE 里的旧值不对。先查真实值再改，别去登录页试：
#    docker compose exec db psql -U seeme -d see_me -c \
#      "SELECT id, email, display_name, (SELECT count(*) FROM notes n WHERE n.user_id=u.id) notes FROM users u ORDER BY notes DESC;"

# 4) 确认无误后再放 app 和 caddy 出来
docker compose up -d --build
```

**万一还是撞车了**（UPDATE 报 duplicate key）：先删掉那个误建的空账号再改，
删之前务必确认它的 notes 数是 0：

```bash
docker compose exec db psql -U seeme -d see_me -c \
  "DELETE FROM users WHERE email=lower(trim('你的邮箱'))
     AND NOT EXISTS (SELECT 1 FROM notes WHERE user_id=users.id);"
```

**配真发信**（在这之前 `MAIL_DRIVER=dev` + `MAIL_DEV_IN_PROD=1`，验证码只打进容器日志——
这个开关必须显式设，防的是把 `MAIL_DRIVER` 拼错时静默降级成「以为在发信、其实码全进日志」）：

**先选驱动**：收件方是 **126/163/QQ 等国内邮箱 → 用 `aliyun`**（网易系对境外发信方
过滤极严，Resend 很可能被拒收或进垃圾箱）；收件方是 Gmail 等海外邮箱 → `resend` 更省事。

### A. 阿里云邮件推送（推荐给国内邮箱）

1. 控制台开通「邮件推送」→ **发信域名**：添加 `fathomlog.com`，把它给的
   SPF / DKIM / MX（所有权校验）记录加到同账号的云解析里，等验证通过；
2. **发信地址**：新建一个，比如 `noreply@fathomlog.com`，类型选「触发邮件」；
3. RAM 里建个用户拿 AccessKey，只授 `AliyunDirectMailFullAccess`（别用主账号密钥）；
4. 服务器 `.env`：

   ```
   MAIL_DRIVER=aliyun
   ALIYUN_ACCESS_KEY_ID=LTAI...
   ALIYUN_ACCESS_KEY_SECRET=...
   ALIYUN_DM_ACCOUNT=noreply@fathomlog.com
   ALIYUN_DM_FROM_ALIAS=Fathom
   ```

   并**删掉 `MAIL_DEV_IN_PROD`**；
5. `docker compose up -d`，登录页发一次码验证。

> 默认打杭州地域（Version `2015-11-23`）。要换新加坡等地域，`ALIYUN_DM_ENDPOINT`
> 和 `ALIYUN_DM_VERSION` 必须**一起**改（新加坡是 `https://dm.ap-southeast-1.aliyuncs.com/`
> + `2017-06-22`），只改一个会一直签名失败。

### B. Resend（海外邮箱够用）

1. resend.com 注册，添加域名 `fathomlog.com`，按它给的 SPF/DKIM 记录去阿里云 DNS 添加；
2. 建一个 API key；
3. 服务器 `.env` 里填 `MAIL_DRIVER=resend`、`RESEND_API_KEY=re_...`、
   `MAIL_FROM=Fathom <noreply@fathomlog.com>`，并**删掉 `MAIL_DEV_IN_PROD`**；
4. `docker compose up -d`，登录页发一次码验证。

### 发信没成功怎么查

`/request-code` 返回 502 就是发信这一步失败了（不会假装成功）。看日志：

```bash
docker compose logs --tail=50 app | grep -iE 'aliyun_dm_failed|resend_failed|mail_not_configured'
```

`mail_not_configured` = 密钥/发信地址没配全；`aliyun_dm_failed_400_InvalidMailAddress`
之类的尾巴是阿里云返回的错误码，按码查它的文档即可。

## iOS 指向服务器

`ios/SeeMe/APIClient.swift` 里把 `deviceHost` 改成服务器公网 IP（或将来
的域名），重新 Archive 上传 TestFlight。ATS 目前允许 HTTP（0.01 开发版）；
上域名 + HTTPS 后应收紧为仅 HTTPS。

## 待办（M5 收尾）

- 域名解析到服务器 + Caddy/Nginx 做 HTTPS（免 ICP：服务器在东京）
- ~~阿里云短信签名~~ 已放弃：改成邮箱验证码（见「邮箱登录」节）
- 定期 pg_dump 备份
