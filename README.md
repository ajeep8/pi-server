# pi-server

OpenAI-compatible HTTP API server for any application built with `@mariozechner/pi-coding-agent`.

Spawns your pi-agent binary via `--mode rpc` and exposes it as a `/v1/chat/completions` endpoint. Supports streaming (SSE), persistent sessions, and extension UI forwarding.

## Prerequisites

- Node.js 18+
- A pi-coding-agent based CLI

## Setup

```bash
git clone <repo-url> pi-server
cd pi-server
npm install
```

## Configuration

All configuration is via environment variables.

| Variable | Required | Default | Description |
|---|---|---|---|
| `PI_AGENT_BINARY` | Yes | - | Path to your pi-agent CLI entry point (e.g. `/path/to/pi-agent/src/cli.ts`) |
| `PI_AGENT_CWD` | No | `process.cwd()` | Working directory for the agent process |
| `PI_AGENT_ARGS` | No | - | Extra args passed to the agent (space-separated) |
| `PORT` | No | `8000` | Server port |
| `AUTH_TOKEN` | No | - | Bearer token for API authentication (disabled if unset) |
| `SESSION_TTL_MS` | No | `1800000` | Session idle timeout in ms (30 min) |
| `MAX_SESSIONS` | No | `100` | Max concurrent agent processes |
| `CLEANUP_INTERVAL_MS` | No | `60000` | How often to evict expired sessions (ms) |
| `PI_MODEL_NAME` | No | `pi-agent` | Model name returned by `/v1/models` |

## Running

```bash
PI_AGENT_BINARY=/path/to/your/cli.ts PI_AGENT_CWD=/path/to/project npm start
```

Dev mode with auto-reload:

```bash
PI_AGENT_BINARY=/path/to/your/cli.ts npm run dev
```

## API

### Endpoints

| Method | Path | Description |
|---|---|---|
| `POST` | `/v1/chat/completions` | Chat completions (streaming + non-streaming) |
| `GET` | `/v1/models` | List available models |
| `GET` | `/v1/sessions` | List active sessions |
| `DELETE` | `/v1/sessions/:id` | Destroy a session |
| `GET` | `/health` | Health check |

### Session modes

**Stateless** (no header) -- each request spawns a fresh agent process. Full message history must be sent every time.

**Persistent** (`x-session-id` header) -- the agent process stays alive between requests and maintains its own conversation history. Only send the latest user message.

## Examples

### Basic request (stateless)

```bash
curl http://localhost:8000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "mnemosyne",
    "messages": [{"role": "user", "content": "hello"}]
  }'
```

### Persistent session

```bash
# First message -- creates the session
curl http://localhost:8000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "x-session-id: my-session" \
  -d '{
    "model": "mnemosyne",
    "messages": [{"role": "user", "content": "list all documents"}]
  }'

# Follow-up -- reuses the same agent process
curl http://localhost:8000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "x-session-id: my-session" \
  -d '{
    "model": "mnemosyne",
    "messages": [{"role": "user", "content": "show me the first one"}]
  }'
```

### Streaming

```bash
curl http://localhost:8000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "mnemosyne",
    "stream": true,
    "messages": [{"role": "user", "content": "hello"}]
  }'
```

### With OpenAI SDK (Python)

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:8000/v1",
    api_key="your-token",  # or any string if AUTH_TOKEN is unset
)

response = client.chat.completions.create(
    model="mnemosyne",
    messages=[{"role": "user", "content": "hello"}],
    extra_headers={"x-session-id": "my-session"},
)
print(response.choices[0].message.content)
```

### With OpenAI SDK (TypeScript)

```typescript
import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "http://localhost:8000/v1",
  apiKey: "your-token",
});

const response = await client.chat.completions.create(
  {
    model: "mnemosyne",
    messages: [{ role: "user", content: "hello" }],
  },
  { headers: { "x-session-id": "my-session" } },
);
console.log(response.choices[0].message.content);
```

### Extension UI requests (interactive confirmation)

When the agent needs user input (e.g. confirming a file overwrite), pi-server returns it as a `tool_calls` response:

```json
{
  "choices": [{
    "message": {
      "role": "assistant",
      "content": "A file with the same name already exists.",
      "tool_calls": [{
        "id": "ext_ui_abc123",
        "type": "function",
        "function": {
          "name": "extension_ui_confirm",
          "arguments": "{\"message\":\"Override existing file?\",\"options\":[\"yes\",\"no\"]}"
        }
      }]
    },
    "finish_reason": "tool_calls"
  }]
}
```

Send the user's answer back as a tool result on the same session:

```bash
curl http://localhost:8000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "x-session-id: my-session" \
  -d '{
    "model": "mnemosyne",
    "messages": [
      {"role": "tool", "tool_call_id": "ext_ui_abc123", "content": "yes"}
    ]
  }'
```

The agent continues from where it paused and returns the final result.

### With authentication

```bash
# Start with auth
AUTH_TOKEN=my-secret-key PI_AGENT_BINARY=/path/to/cli.ts npm start

# Requests must include the token
curl http://localhost:8000/v1/chat/completions \
  -H "Authorization: Bearer my-secret-key" \
  -H "Content-Type: application/json" \
  -d '{"model": "mnemosyne", "messages": [{"role": "user", "content": "hello"}]}'
```

## Debugging

Session logs are written by pi-coding-agent to `~/.pi/agent/sessions/`. Each session produces a JSONL file containing the full conversation history including thinking blocks, tool calls, and results.
