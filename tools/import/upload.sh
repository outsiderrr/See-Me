#!/bin/sh
# Fathom 导入 —— Mac 侧一键上传。Claude 到服务器 SSH 不通，这个脚本给用户跑：
#
#   tools/import/upload.sh [库文件]        # 不带参数 = 取 库/ 里最新的 .md
#
# 流程：本地 check（不过不上传）→ scp 到服务器 → ssh 跑 server-ingest.sh → state 拷回湖。
# 服务器地址和手机号刻意不进公开仓库，放湖里：~/通用空间/潜心/.import-config.json
#   {"server": "admin@<服务器IP>", "phone": "+86..."}
set -eu

HERE=$(cd "$(dirname "$0")" && pwd)
LAKE="${FATHOM_LAKE:-$HOME/通用空间/潜心}"
CONF="$LAKE/.import-config.json"
STATE="$LAKE/.import-state.json"

[ -f "$CONF" ] || { echo "缺 $CONF（内容：{\"server\": \"user@ip\", \"phone\": \"+86...\"}）"; exit 1; }
SERVER=$(node -p "require('$CONF').server")
PHONE=$(node -p "require('$CONF').phone")

FILE=${1:-$(ls -t "$LAKE/库"/*.md 2>/dev/null | head -1)}
[ -n "${FILE:-}" ] && [ -f "$FILE" ] || { echo "库/ 里没找到要导的文件"; exit 1; }
echo "== 库文件：$FILE"

# --- 1) 本地全量校验，不过不上传 ---
node "$HERE/import.mjs" check "$FILE" --lake "$LAKE"

# --- 2) 上传（import.mjs + server-ingest.sh + 库文件 + state；仓库路径带空格，逐个引） ---
echo "== 上传到 $SERVER:~/fathom-import/"
ssh "$SERVER" 'mkdir -p ~/fathom-import'
if [ -f "$STATE" ]; then
  scp -q "$HERE/import.mjs" "$HERE/server-ingest.sh" "$FILE" "$STATE" "$SERVER:fathom-import/"
else
  scp -q "$HERE/import.mjs" "$HERE/server-ingest.sh" "$FILE" "$SERVER:fathom-import/"
fi

# --- 3) 服务器上入库（dev OTP 自动捞码，见 server-ingest.sh）。
#         入库半途失败时 state 也已经更新了一部分，所以失败也要把 state 拷回来。 ---
RC=0
ssh "$SERVER" "cd /opt/see-me && sh ~/fathom-import/server-ingest.sh '$PHONE' \
  ~/fathom-import/'$(basename "$FILE")' ~/fathom-import/.import-state.json" || RC=$?

# --- 4) state 拷回湖（幂等的记忆在这份文件里，务必带回来） ---
scp -q "$SERVER:fathom-import/.import-state.json" "$STATE" \
  || { [ "$RC" = 0 ] && RC=1; echo "!! state 没拷回来——别重跑，先手动确认服务器上的 ~/fathom-import/.import-state.json"; }
if [ "$RC" = 0 ]; then
  echo "== 完成。state 已拷回 $STATE"
  echo "== 去 /console 的收件箱审校打标签吧"
else
  echo "!! 入库过程有失败（退出码 $RC），看上面的逐条汇报；state 已尽量拷回，修好后重跑即可（幂等）"
fi
exit $RC
