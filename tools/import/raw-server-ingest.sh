#!/bin/sh
# Fathom 原始材料导入 —— 服务器侧。由 Mac 上的 raw-upload.sh 经 ssh 调用，也可手动跑：
#
#   cd /opt/see-me && sh ~/fathom-import/raw-server-ingest.sh "$(邮箱)" ~/fathom-import/raw-upload.json
#
# 与 server-ingest.sh（展示层）同构但刻意独立成文件：两条管线的失败互不牵连，
# 且这里没有 state 文件要拷回（原始层是幂等镜像，见 raw.mjs 头注）。
# 同样的隐私姿势：宿主没有 node，入库跑在 app 容器里对 localhost:3000，
# 内容不出这台机器；跑完清掉容器副本和宿主上的明文 payload。

set -eu

EMAIL=${1:?用法: raw-server-ingest.sh <邮箱> <raw-upload.json>}
FILE=${2:?用法: raw-server-ingest.sh <邮箱> <raw-upload.json>}
DIR=$(cd "$(dirname "$FILE")" && pwd)
BASE_HOST=http://localhost:3000

[ -f docker-compose.yml ] || { echo "请在 /opt/see-me 下运行（要用 docker compose）"; exit 1; }

# --- 1) dev OTP 换 token（真发信模式捞不到日志码，改手输） ---
curl -sf -X POST "$BASE_HOST/api/auth/request-code" \
  -H 'content-type: application/json' -d "{\"email\":\"$EMAIL\"}" >/dev/null \
  || { echo "请求验证码失败（限流是 5 次/10 分钟，稍等再试）"; exit 1; }
sleep 2
CODE=$(docker compose logs --tail=100 app | tr -d '\r' \
  | grep -F "[mail:dev] -> $EMAIL" | tail -1 | grep -oE '[0-9]{6}[[:space:]]*$' | tr -d '[:space:]')
if [ -z "${CODE:-}" ]; then
  printf "日志里没有验证码（多半配了真发信）。请查收 %s 的邮件，输入 6 位验证码: " "$EMAIL"
  read -r CODE
fi
[ -n "${CODE:-}" ] || { echo "没有验证码，中止"; exit 1; }
TOKEN=$(curl -sf -X POST "$BASE_HOST/api/auth/verify" \
  -H 'content-type: application/json' -d "{\"email\":\"$EMAIL\",\"code\":\"$CODE\"}" \
  | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')
[ -n "${TOKEN:-}" ] || { echo "验证码校验失败"; exit 1; }
trap 'curl -s -X POST "$BASE_HOST/api/auth/logout" -H "Authorization: Bearer $TOKEN" >/dev/null 2>&1 || true' EXIT

# --- 2) 容器内跑 ingest（payload 固定名 raw-upload.json，见 raw-upload.sh） ---
RC=0
docker compose exec -T app rm -rf /tmp/fathom-raw
docker compose exec -T app mkdir -p /tmp/fathom-raw
docker compose cp "$DIR/raw.mjs" app:/tmp/fathom-raw/raw.mjs
docker compose cp "$FILE" app:/tmp/fathom-raw/raw-upload.json
docker compose exec -T -e FATHOM_TOKEN="$TOKEN" app \
  node /tmp/fathom-raw/raw.mjs ingest /tmp/fathom-raw/raw-upload.json \
  --base http://localhost:3000 || RC=$?

# --- 3) 清场：容器副本 + 宿主明文 payload（正文全在里面，宿主不留） ---
docker compose exec -T app rm -rf /tmp/fathom-raw || true
rm -f "$FILE"
exit $RC
