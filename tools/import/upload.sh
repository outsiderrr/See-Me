#!/bin/sh
# Fathom 导入 —— Mac 侧一键上传。Claude 到服务器 SSH 不通，这个脚本给用户跑：
#
#   tools/import/upload.sh [库文件]        # 不带参数 = 取 库/ 里最新的 .md
#
# 流程：本地 check（不过不上传）→ scp 到服务器 → ssh 跑 server-ingest.sh → state 拷回湖。
# 服务器地址和手机号刻意不进公开仓库，放湖里：~/通用空间/潜心/.import-config.json
#   {"server": "admin@<服务器IP>", "phone": "+86...", "tags": ["…suggest 词表…"]}
set -eu

HERE=$(cd "$(dirname "$0")" && pwd)
LAKE="${FATHOM_LAKE:-$HOME/通用空间/潜心}"
CONF="$LAKE/.import-config.json"
STATE="$LAKE/.import-state.json"

[ -f "$CONF" ] || { echo "缺 $CONF（内容：{\"server\": \"user@ip\", \"phone\": \"+86...\"}）"; exit 1; }
SERVER=$(node -p "require('$CONF').server")
PHONE=$(node -p "require('$CONF').phone")
# server/phone 会内插进远端命令；含引号的一律拒绝（config 是自家文件，坏了就修它）
case "$PHONE$SERVER" in *"'"*) echo "config 里的 server/phone 不能含单引号"; exit 1;; esac

FILE=${1:-$(ls -t "$LAKE/库"/*.md 2>/dev/null | head -1)}
[ -n "${FILE:-}" ] && [ -f "$FILE" ] || { echo "库/ 里没找到要导的文件"; exit 1; }
echo "== 库文件：$FILE"

# --- 1) 本地全量校验，不过不上传 ---
node "$HERE/import.mjs" check "$FILE" --lake "$LAKE"

# --- 2) 上传。库文件在远端固定叫 upload.md：远端命令里不内插本地文件名
#         （文件名也是提炼产物的一部分，当外部输入对待——不给它进 shell 的机会），
#         顺带保证宿主上的明文副本只有一份、每次覆盖。 ---
echo "== 上传到 $SERVER:~/fathom-import/"
ssh "$SERVER" 'mkdir -p ~/fathom-import'
scp -q "$HERE/import.mjs" "$HERE/server-ingest.sh" "$SERVER:fathom-import/"
scp -q "$FILE" "$SERVER:fathom-import/upload.md"
if [ -f "$STATE" ]; then
  scp -q "$STATE" "$SERVER:fathom-import/.import-state.json"
fi

# --- 3) 服务器上入库（dev OTP 自动捞码，见 server-ingest.sh）。
#         入库半途失败时 state 也可能已更新一部分，所以失败也要把 state 拷回来。 ---
RC=0
ssh "$SERVER" "cd /opt/see-me && sh ~/fathom-import/server-ingest.sh '$PHONE' \
  ~/fathom-import/upload.md ~/fathom-import/.import-state.json" || RC=$?

# --- 4) state 拷回湖（幂等的记忆在这份文件里，务必带回来），成功后清掉服务器副本
#         （state 里有每条笔记的标题=实际内容，宿主上不留） ---
if scp -q "$SERVER:fathom-import/.import-state.json" "$STATE" 2>/dev/null; then
  ssh "$SERVER" 'rm -f ~/fathom-import/.import-state.json' || true
elif [ "$RC" = 0 ]; then
  # ingest 成功却没有 state 可拷（理论上不该发生——成功至少会补记）
  RC=1
  echo "!! state 没拷回来——别急着重跑，先手动确认服务器上的 ~/fathom-import/.import-state.json"
else
  echo "（state 没拷回来——上面失败发生在入库之前的话属正常，修好直接重跑）"
fi
if [ "$RC" = 0 ]; then
  echo "== 完成。state 已拷回 $STATE"
  echo "== 去 /console 的收件箱审校打标签吧"
else
  echo "!! 流程有失败（退出码 $RC），看上面的逐条汇报；修好后重跑即可（幂等，不会重复入库）"
fi
exit $RC
