#!/usr/bin/env bash
# Sync official AI model icons from LobeHub (lobehub.com/icons).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/public/model-icons"
BASE="https://unpkg.com/@lobehub/icons-static-svg@latest/icons"
mkdir -p "$OUT"

download() {
  local file="$1"
  curl -fsSL "$BASE/$file" -o "$OUT/$file"
}

download deepseek-color.svg
download openai.svg
download anthropic.svg
download claude-color.svg
download google-color.svg
download gemini-color.svg
download meta-color.svg
download mistral-color.svg
download qwen-color.svg
download alibaba-color.svg
download groq.svg
download openrouter.svg
download moonshot.svg
download zhipu-color.svg
download perplexity-color.svg
download huggingface-color.svg
download nvidia-color.svg
download minimax-color.svg
download fireworks-color.svg
download xai.svg
download together.svg
download cohere-color.svg

echo "Synced $(ls -1 "$OUT" | wc -l | tr -d ' ') model icons to $OUT"
