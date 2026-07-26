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
curl -s http://localhost/api/auth/request-code -X POST \
  -H 'content-type: application/json' -d '{"phone":"+8613500009001"}'
docker compose logs app | tail -5   # 应看到 [sms:dev] 验证码
```

之后浏览器打开 `http://<服务器公网IP>/` 就是 B 端登录阅读页；免登录卡的链接是
`http://<服务器公网IP>/c/<14位slug>`（slug 在 A 端建 open 卡时返回）。

> ⚠️ **上 HTTPS 之前别把真实的免登录链接发出去。** slug 就是这张卡的全部凭证，
> 明文 HTTP 会把它暴露在链路上的任何一跳。自己测试无妨，对外分享等 P1 的
> 域名 + Caddy 落地。

## 日常

```bash
cd /opt/see-me
docker compose logs -f app          # 看日志（dev 短信驱动的验证码在这里）
git pull && docker compose up -d --build   # 升级到最新代码
docker compose exec db pg_dump -U seeme see_me > backup.sql   # 备份
```

## 防火墙（轻量服务器控制台）

放行 TCP 80（HTTP）。将来上域名 + HTTPS 再放行 443。

## iOS 指向服务器

`ios/SeeMe/APIClient.swift` 里把 `deviceHost` 改成服务器公网 IP（或将来
的域名），重新 Archive 上传 TestFlight。ATS 目前允许 HTTP（0.01 开发版）；
上域名 + HTTPS 后应收紧为仅 HTTPS。

## 待办（M5 收尾）

- 域名解析到服务器 + Caddy/Nginx 做 HTTPS（免 ICP：服务器在东京）
- 阿里云短信签名过审后接 `aliyun` 驱动（SMS_DRIVER=aliyun）
- 定期 pg_dump 备份
