#!/bin/bash
# 她乡记 · 打包分发脚本
# 用法：./打包分发.sh
# 产物 1：skill安装包/ 下 3 个 skill 导入包（供 Trae 导入）
# 产物 2：dist/她乡记-分发包-日期.zip（发给金梅姐的完整包）

set -euo pipefail
cd "$(dirname "$0")"

ROOT="$(pwd)"
OUT_SKILL="$ROOT/skill安装包"
DATE=$(date +%Y%m%d)
OUT_ZIP="$ROOT/dist/她乡记-分发包-$DATE.zip"

# ---------- 1. 生成 skill 导入包（flat 结构：skill.md 在 zip 根，与 v5 包一致） ----------
mkdir -p "$OUT_SKILL"

# 1.1 她乡记文案（v5，含 references/）
cd "$ROOT/skills/mulan-video-content"
rm -f "$OUT_SKILL/mulan-video-content-v5.zip"
zip -r -q "$OUT_SKILL/mulan-video-content-v5.zip" skill.md references

# 1.2 对标账号文案（对标账号分析）
cd "$ROOT/skills/benchmark-copywriting"
rm -f "$OUT_SKILL/对标账号分析-skill.zip"
zip -q "$OUT_SKILL/对标账号分析-skill.zip" skill.md

# 1.3 对标账号分析（account-diff-compare）
cd "$ROOT/skills/account-diff-compare"
rm -f "$OUT_SKILL/account-diff-compare-skill.zip"
zip -q "$OUT_SKILL/account-diff-compare-skill.zip" skill.md

# ---------- 2. 打整个项目分发包（排除脚本自身与历史分发包） ----------
cd "$ROOT"
mkdir -p "$(dirname "$OUT_ZIP")"
rm -f "$OUT_ZIP"
zip -r -q "$OUT_ZIP" . \
  -x "skill安装包/*" \
  -x "*.zip" \
  -x ".trae-sandbox/*" \
  -x "frontend/node_modules/*"

echo "完成："
echo "  skill 导入包："
ls -1 "$OUT_SKILL" | sed 's/^/    - /'
echo "  完整分发包：$OUT_ZIP"
