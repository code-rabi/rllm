# RLLM: Recursive Large Language Models (TypeScript)

A TypeScript implementation of [Recursive Language Models](https://arxiv.org/abs/2512.24601) for processing large contexts with LLMs.

Inspired by [Cloudflare's Code Mode](https://blog.cloudflare.com/code-mode/) approach.

### Sandbox Bindings

The V8 isolate provides these bindings to LLM-generated code:

| Binding | Description |
|---------|-------------|
| `context` | The loaded context data |
| `llm_query(prompt, model?)` | Query sub-LLM |
| `llm_query_batched(prompts, model?)` | Batch query sub-LLMs |
| `FINAL(answer)` | Return final answer |
| `FINAL_VAR(varName)` | Return variable as final answer |
| `print(...)` | Console output |

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  RLLM TypeScript                                            │
│                                                             │
│  ┌─────────────┐    ┌──────────────────────────────────┐   │
│  │   RLLM      │    │  V8 Isolate (Sandbox)            │   │
│  │   Class     │───▶│                                  │   │
│  └─────────────┘    │  • context (injected data)       │   │
│        │            │  • llm_query() ──┐               │   │
│        │            │  • llm_query_batched()           │   │
│        ▼            │  • print() / console             │   │
│  ┌─────────────┐    │  • FINAL() / FINAL_VAR()         │   │
│  │  LLMClient  │◀───┼──────────────────┘               │   │
│  │  (OpenAI)   │    │                                  │   │
│  └─────────────┘    │  LLM-generated JS code runs here │   │
│                     └──────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘

No TCP. No subprocess. Direct function calls via bindings.
```

## Development rules

```bash
# Install dependencies
pnpm install

# Build
pnpm build

# Run example
pnpm example

# Run tests
pnpm test
```
