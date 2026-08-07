#!/bin/sh
# Fathom 导入 —— 服务器侧。由 Mac 上的 upload.sh 经 ssh 调用，也可手动跑：
#
#   cd /opt/see-me && sh ~/fathom-import/server-ingest.sh "$(从湖配置里读邮箱)" ~/fathom-import/upload.md
#
# 做什么：
#   1) 换 token：MAIL_DRIVER=dev 时验证码只在容器日志里，自动捞；配了真发信（resend）
#      就捞不到了，改为提示你从邮箱里读出来手输（所以 upload.sh 用 ssh -t）；
#   2) 宿主上没有 node，导入跑在 app 容器里（node:24），对容器内 localhost:3000 入库——
#      笔记内容全程不出这台机器（这正是不从本机 POST 的原因）;
#   3) state 拷回宿主由 upload.sh 带回数据湖；库文件用完即删，宿主不留明文笔记。
#

set -eu

EMAIL=${1:?用法: server-ingest.sh <邮箱> <库文件> [state文件]}
FILE=${2:?用法: server-ingest.sh <邮箱> <库文件> [state文件]}
STATE=${3:-$(dirname "$FILE")/.import-state.json}
DIR=$(cd "$(dirname "$FILE")" && pwd)
BASE_HOST=http://localhost:3000   # 宿主视角的 app（上 Caddy 后 app 只绑 127.0.0.1:3000）

[ -f docker-compose.yml ] || { echo "请在 /opt/see-me 下运行（要用 docker compose）"; exit 1; }

# --- 1) dev OTP 换 token ---
curl -sf -X POST "$BASE_HOST/api/auth/request-code" \
  -H 'content-type: application/json' -d "{\"email\":\"$EMAIL\"}" >/dev/null \
  || { echo "请求验证码失败（限流是 5 次/10 分钟，稍等再试）"; exit 1; }
sleep 2
# dev 驱动：码在容器日志里，自动捞
CODE=$(docker compose logs --tail=100 app | tr -d '\r' \
  | grep -F "[mail:dev] -> $EMAIL" | tail -1 | grep -oE '[0-9]{6}[[:space:]]*$' | tr -d '[:space:]')
# 真发信（resend）：日志里没有，让用户从邮箱读出来手输
if [ -z "${CODE:-}" ]; then
  printf "日志里没有验证码（多半配了真发信）。请查收 %s 的邮件，输入 6 位验证码: " "$EMAIL"
  read -r CODE
fi
[ -n "${CODE:-}" ] || { echo "没有验证码，中止"; exit 1; }
TOKEN=$(curl -sf -X POST "$BASE_HOST/api/auth/verify" \
  -H 'content-type: application/json' -d "{\"email\":\"$EMAIL\",\"code\":\"$CODE\"}" \
  | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')
[ -n "${TOKEN:-}" ] || { echo "验证码校验失败"; exit 1; }
# 从这里起无论哪条路径退出，都吊销会话（不留 60 天长活 token）
trap 'curl -s -X POST "$BASE_HOST/api/auth/logout" -H "Authorization: Bearer $TOKEN" >/dev/null 2>&1 || true' EXIT

# --- 2) 容器内跑 ingest ---
SB=$(basename "$STATE")
docker compose exec -T app rm -rf /tmp/fathom-import
docker compose cp "$DIR" app:/tmp/fathom-import
# STATE 未必住在 $DIR 里（手动用法）：显式送进容器。少这一步的话，ingest 会拿
# 空 state 起跑，"删过的笔记不复活"失守，拷回时还会反向覆盖调用者的真 state。
if [ -f "$STATE" ]; then
  docker compose cp "$STATE" "app:/tmp/fathom-import/$SB"
fi
RC=0
docker compose exec -T -e FATHOM_TOKEN="$TOKEN" app \
  node /tmp/fathom-import/import.mjs ingest "/tmp/fathom-import/$(basename "$FILE")" \
  --state "/tmp/fathom-import/$SB" --base http://localhost:3000 || RC=$?

# --- 3) state 只有产生了才拷回（首跑早退时容器里没有它；拷回失败不能吞掉 RC、
#         也不能拦住后面的清场） ---
if docker compose exec -T app test -f "/tmp/fathom-import/$SB"; then
  docker compose cp "app:/tmp/fathom-import/$SB" "$STATE" \
    || { echo "!! state 拷回宿主失败——去容器 /tmp/fathom-import/$SB 手动抢救"; [ "$RC" = 0 ] && RC=1; }
else
  echo "（本次没有产生 state——多半在入库前就失败了，重跑安全）"
fi

# --- 4) 清场：容器内副本 + 宿主上的明文库文件（宿主不留笔记内容） ---
docker compose exec -T app rm -rf /tmp/fathom-import || true
rm -f "$FILE"
exit $RC
