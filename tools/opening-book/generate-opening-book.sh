#!/usr/bin/env sh
set -eu

# 离线开局库生成入口。
#
# 默认每个局面搜索 15 秒；网页实时对局仍然是 5 秒。
# 可以用环境变量控制规模：
#
# THINK_MS=15000 MAX_ENTRIES=500 MAX_PLY=8 RADIUS=4 BRANCH=8 WORKERS=22 ACTIVATE=1 ./tools/opening-book/generate-opening-book.sh

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"

set -- \
  --think-ms "${THINK_MS:-15000}" \
  --max-entries "${MAX_ENTRIES:-500}" \
  --max-ply "${MAX_PLY:-8}" \
  --radius "${RADIUS:-4}" \
  --branch "${BRANCH:-8}"

if [ -n "${WORKERS:-}" ]; then
  set -- "$@" --workers "$WORKERS"
fi

if [ -n "${ACTIVATE:-}" ]; then
  set -- "$@" --activate
fi

node "$ROOT_DIR/tools/opening-book/generate-opening-book.mjs" "$@"
