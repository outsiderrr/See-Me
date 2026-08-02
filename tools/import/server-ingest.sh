#!/bin/sh
# Fathom 导入 —— 服务器侧。由 Mac 上的 upload.sh 经 ssh 调用，也可手动跑：
#
#   cd /opt/see-me && sh ~/fathom-import/server-ingest.sh '+86手机号' ~/fathom-import/<库文件>.md
#
# 做什么：
#   1) dev 短信驱动的验证码只打进容器日志（SMS_DRIVER=dev），这里自动捞码换 token；
#   2) 宿主上没有 node，导入跑在 app 容器里（node:24），对容器内 localhost:3000 入库——
#      笔记内容全程不出这台机器（这正是不从本机 POST 的原因）;
#   3) state 文件拷回宿主，由 upload.sh 带回数据湖。
#
# 将来切 aliyun 驱动后第 1 步会捞不到码——到时把 CODE 那两行换成 read 手输。
set -eu

PHONE=${1:?用法: server-ingest.sh <+86手机号> <库文件> [state文件]}
FILE=${2:?用法: server-ingest.sh <+86手机号> <库文件> [state文件]}
STATE=${3:-$(dirname "$FILE")/.import-state.json}
DIR=$(cd "$(dirname "$FILE")" && pwd)
BASE_HOST=http://localhost   # 宿主视角的 app（80 → 容器 3000）

[ -f docker-compose.yml ] || { echo "请在 /opt/see-me 下运行（要用 docker compose）"; exit 1; }

# --- 1) dev OTP 换 token ---
curl -sf -X POST "$BASE_HOST/api/auth/request-code" \
  -H 'content-type: application/json' -d "{\"phone\":\"$PHONE\"}" >/dev/null \
  || { echo "请求验证码失败（限流是 5 次/10 分钟，稍等再试）"; exit 1; }
sleep 2
CODE=$(docker compose logs --tail=100 app | tr -d '\r' \
  | grep -F "[sms:dev] -> $PHONE" | tail -1 | grep -oE '[0-9]{6}[[:space:]]*$' | tr -d '[:space:]')
[ -n "${CODE:-}" ] || { echo "容器日志里没捞到验证码（SMS_DRIVER 不是 dev？）"; exit 1; }
TOKEN=$(curl -sf -X POST "$BASE_HOST/api/auth/verify" \
  -H 'content-type: application/json' -d "{\"phone\":\"$PHONE\",\"code\":\"$CODE\"}" \
  | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')
[ -n "${TOKEN:-}" ] || { echo "验证码校验失败"; exit 1; }

# --- 2) 容器内跑 ingest（失败也要走到 state 拷回，所以手动接住退出码） ---
docker compose exec -T app rm -rf /tmp/fathom-import
docker compose cp "$DIR" app:/tmp/fathom-import
RC=0
docker compose exec -T -e FATHOM_TOKEN="$TOKEN" app \
  node /tmp/fathom-import/import.mjs ingest "/tmp/fathom-import/$(basename "$FILE")" \
  --state "/tmp/fathom-import/$(basename "$STATE")" --base http://localhost:3000 || RC=$?

# --- 3) state 拷回宿主，容器内清场，token 作废 ---
docker compose cp "app:/tmp/fathom-import/$(basename "$STATE")" "$STATE"
docker compose exec -T app rm -rf /tmp/fathom-import
curl -s -X POST "$BASE_HOST/api/auth/logout" -H "Authorization: Bearer $TOKEN" >/dev/null || true
exit $RC
