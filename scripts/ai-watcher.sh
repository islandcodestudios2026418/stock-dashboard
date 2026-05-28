#!/bin/bash
# kiro-cli AI analysis watcher
# Polls .ai-requests/ for new analysis requests, runs kiro-cli, writes results to .ai-results/
#
# Usage: bash scripts/ai-watcher.sh
# Run this in a separate terminal/screen session on Zeabur

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
REQUESTS_DIR="$SCRIPT_DIR/.ai-requests"
RESULTS_DIR="$SCRIPT_DIR/.ai-results"
POLL_INTERVAL=3  # seconds

mkdir -p "$REQUESTS_DIR" "$RESULTS_DIR"

echo "🤖 AI Analysis Watcher started"
echo "   Watching: $REQUESTS_DIR"
echo "   Results:  $RESULTS_DIR"
echo "   Poll interval: ${POLL_INTERVAL}s"
echo ""

while true; do
  for request_file in "$REQUESTS_DIR"/*.json; do
    [ -f "$request_file" ] || continue

    filename=$(basename "$request_file")
    id="${filename%.json}"
    result_file="$RESULTS_DIR/${id}.json"

    echo "📥 Processing: $id"

    # Read request
    system=$(jq -r '.system' "$request_file")
    prompt=$(jq -r '.prompt' "$request_file")
    symbol=$(jq -r '.symbol' "$request_file")

    # Build the full prompt for kiro-cli
    full_prompt="$system

---
$prompt

請按照框架輸出分析結果。"

    # Run kiro-cli (non-interactive, pipe prompt)
    analysis=$(echo "$full_prompt" | kiro chat --no-streaming 2>/dev/null)

    if [ $? -eq 0 ] && [ -n "$analysis" ]; then
      # Write result
      jq -n --arg analysis "$analysis" --arg id "$id" --arg symbol "$symbol" \
        '{id: $id, symbol: $symbol, analysis: $analysis, ts: (now | floor)}' > "$result_file"
      echo "✅ Done: $id → $result_file"
    else
      # Write error result
      jq -n --arg id "$id" --arg symbol "$symbol" \
        '{id: $id, symbol: $symbol, analysis: "⚠️ kiro-cli 分析失敗，請稍後再試", ts: (now | floor)}' > "$result_file"
      echo "❌ Failed: $id"
    fi

    # Remove processed request
    rm -f "$request_file"
  done

  sleep "$POLL_INTERVAL"
done
