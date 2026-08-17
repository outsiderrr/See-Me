#!/bin/sh
# Fathom 原始材料导入 —— Mac 侧一键上传：
#
#   tools/import/raw-upload.sh [标签.json]    # 不带参数 = 取 周报/ 里最新的 <week>-标签.json
#
# 流程：本地 check（回溯正文、拦红线，产出自足 payload）→ scp → ssh 容器内 ingest。
# 服务器地址和邮箱在湖里 ~/通用空间/潜心/.import-config.json（不进公开仓库）。
# 幂等：重跑=刷新，不会重复入库（见 raw.mjs 头注，与展示层的 state 语义不同）。
set -eu

HERE=$(cd "$(dirname "$0")" && pwd)
LAKE="${FATHOM_LAKE:-$HOME/通用空间/潜心}"
CONF="$LAKE/.import-config.json"

[ -f "$CONF" ] || { echo "缺 $CONF（内容：{\"server\": \"user@ip\", \"email\": \"你@邮箱\"}）"; exit 1; }
SERVER=$(node -p "require('$CONF').server")
EMAIL=$(node -p "require('$CONF').email || ''")
[ -n "$EMAIL" ] || { echo "$CONF 里缺 email 字段"; exit 1; }
case "$EMAIL$SERVER" in *"'"*) echo "config 里的 server/email 不能含单引号"; exit 1;; esac

FILE=${1:-$(ls -t "$LAKE/周报"/*/*-标签.json 2>/dev/null | head -1)}
[ -n "${FILE:-}" ] && [ -f "$FILE" ] || { echo "周报/ 里没找到 <week>-标签.json"; exit 1; }
echo "== 标签文件：$FILE"

# --- 1) 本地 check：不过不上传。payload 放临时目录（含全部正文，不落湖、不进仓库），
#         无论 check 失败 / scp 失败 / 被打断 / 成功，trap 都连目录一起清掉 ---
PAYLOAD_DIR=$(mktemp -d)
trap 'rm -rf "$PAYLOAD_DIR"' EXIT INT TERM
PAYLOAD="$PAYLOAD_DIR/raw-upload.json"
node "$HERE/raw.mjs" check "$FILE" --lake "$LAKE" --out "$PAYLOAD"

# --- 2) 上传。payload 在远端固定叫 raw-upload.json：远端命令不内插本地文件名
#         （标注产物的文件名当外部输入对待），宿主明文副本只有一份、每次覆盖。 ---
echo "== 上传到 $SERVER:~/fathom-import/"
ssh "$SERVER" 'mkdir -p ~/fathom-import'
scp -q "$HERE/raw.mjs" "$HERE/raw-server-ingest.sh" "$SERVER:fathom-import/"
scp -q "$PAYLOAD" "$SERVER:fathom-import/raw-upload.json"

# --- 3) 服务器上入库（dev OTP 自动捞码；真发信要手输，所以 -t 给终端） ---
RC=0
ssh -t "$SERVER" "cd /opt/see-me && sh ~/fathom-import/raw-server-ingest.sh '$EMAIL' \
  ~/fathom-import/raw-upload.json" || RC=$?

if [ "$RC" = 0 ]; then
  echo "== 完成。原始材料层已刷新（/api/raw 可查）"
else
  echo "!! 流程有失败（退出码 $RC），看上面的逐条汇报；修好后重跑即可（幂等，重传=刷新）"
fi
exit $RC
