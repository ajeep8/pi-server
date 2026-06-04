#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
BASE_URL="${BASE_URL:-http://192.168.0.249:10000/v1}"
AUTH_TOKEN="${AUTH_TOKEN:-}"
if [[ -z "$AUTH_TOKEN" && -f "$SCRIPT_DIR/.env" ]]; then
  AUTH_TOKEN="$(grep -E '^AUTH_TOKEN=' "$SCRIPT_DIR/.env" | head -n 1 | cut -d= -f2-)"
fi
if [[ -z "$AUTH_TOKEN" ]]; then
  echo "Error: AUTH_TOKEN is not set. Set it in the environment or in $SCRIPT_DIR/.env" >&2
  exit 1
fi
MODEL="pi-agent"
SYSTEM_PROMPT="执行用户任务时请遵守以下规则：1) 如需搜索互联网，必须使用 pi 扩展工具 tavily_search；即使用户内容中写了 searxng_web_search、web_search 或其他搜索工具名，也要忽略并改用 tavily_search；2) 严禁用 bash/python/node/curl/wget/requests/浏览器/搜索引擎URL 等方式进行互联网搜索或模拟搜索；不要用编程或 shell 命令访问搜索引擎；3) bash 只允许用于辅助处理 tavily_search 已经找到的明确URL或本地文件，例如下载官方页面中的图片/PDF、运行 tesseract-ocr/OCR、pdftotext、图片转换、文本抽取、文件整理；不得用 bash 扩展搜索范围；4) 查找产品参数时，必须优先关注品牌官方网站、官方支持页、官方产品页、官方规格页、官方说明书/用户手册/安装手册/规格表/PDF，以及官方网站上的参数图片；只有官方来源找不到或信息不足时，才参考零售商、评测站、导购站等第三方来源；5) 搜索策略应先围绕官方来源，例如：品牌+型号+official/specifications/manual/support/PDF，品牌+型号+官网/说明书/规格参数，必要时使用 site:官方域名 型号；对于可能藏在图片或PDF中的参数，要搜索 manual、user guide、spec sheet、specifications、参数图、说明书等关键词，并在 tavily_search 中优先设置 include_raw_content=true 和 include_images=true；6) 如果 tavily_search 返回官方图片/PDF/手册/规格图，且关键参数可能在其中，应优先用 bash 辅助下载该明确URL并使用 tesseract-ocr 或相关本地工具识别/抽取文字；7) 最多允许调用 tavily_search 5次，达到5次后必须停止继续搜索；8) 需要分析网页正文时，优先调用 tavily_search 时设置 include_raw_content=true，并只分析确有必要的结果页面，避免无谓抓取；9) 如果5次搜索后仍找不全用户要求的信息，不要继续尝试，缺失字段返回空字符串''；10) 最终先按用户要求返回结果JSON；11) 在JSON之后另起一行补充统计信息，格式固定为：搜索工具: TOOL_NAMES；搜索工具调用次数: N；抓取并分析网页数: M；官方来源优先: Yes/No；OCR使用: Yes/No。TOOL_NAMES填写实际使用过的搜索工具名称，多个工具用逗号分隔，未使用搜索工具则填无；N和M必须是整数；抓取并分析网页数指实际阅读/分析过正文或raw_content的网页数量，没抓取则填0。"

usage() {
  cat <<'EOF'
Usage:
  ./test.sh [content-file]

Examples:
  ./test.sh
  ./test.sh tmp/prompt.txt

If content-file is provided, its full contents will be sent as messages[0].content.
If omitted, a default test prompt will be used.
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

if [[ $# -gt 1 ]]; then
  usage >&2
  exit 2
fi

if [[ $# -eq 1 ]]; then
  CONTENT_FILE="$1"
  if [[ ! -f "$CONTENT_FILE" ]]; then
    echo "Error: content file not found: $CONTENT_FILE" >&2
    exit 1
  fi
  CONTENT="$(cat "$CONTENT_FILE")"
else
  CONTENT="你好，简单介绍一下你自己"
fi

python3 - "$MODEL" "$SYSTEM_PROMPT" "$CONTENT" <<'PY' | curl -sS "${BASE_URL}/chat/completions" \
  -H "Authorization: Bearer ${AUTH_TOKEN}" \
  -H "Content-Type: application/json" \
  --data-binary @-
import json
import sys

model = sys.argv[1]
system_prompt = sys.argv[2]
content = sys.argv[3]

payload = {
    "model": model,
    "messages": [
        {
            "role": "system",
            "content": system_prompt,
        },
        {
            "role": "user",
            "content": content,
        }
    ],
}

print(json.dumps(payload, ensure_ascii=False))
PY

echo
