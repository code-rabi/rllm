# RLLM: Recursive Large Language Models (TypeScript)

A TypeScript implementation of [Recursive Language Models](https://arxiv.org/abs/2512.24601) for processing large contexts with LLMs.

Inspired by [Cloudflare's Code Mode](https://blog.cloudflare.com/code-mode/) approach.

**Key differences from the [Python version](https://github.com/alexzhang13/rlm):**
- [V8 isolates](#why-v8-isolates-not-tcpcontainers) instead of subprocess/TCP
- [Zod schema support](#structured-context-with-zod-schema) for typed context
- TypeScript-native

## Installation

```bash
pnpm add rllm
# or
npm install rllm
```

## Demo

RLLM analyzing a `node_modules` directory — the LLM writes JavaScript to parse dependencies, query sub-LLMs in parallel, and synthesize a final answer:

![RLLM Demo](./RLLM.mp4)

Built with Gemini Flash 3. See the full interactive example in [`examples/node-modules-viz/`](./examples/node-modules-viz/).

## Quick Start

LLM writes JavaScript code that runs in a secure V8 isolate:

```typescript
import { createRLLM } from 'rllm';

const rlm = createRLLM({
  model: 'gpt-4o-mini',
  verbose: true,
});

// Full RLM completion - prompt first, context in options
const result = await rlm.completion(
  "What are the key findings in this research?",
  { context: hugeDocument }
);

console.log(result.answer);
console.log(`Iterations: ${result.iterations}, Sub-LLM calls: ${result.usage.subCalls}`);
```

### Structured Context with Zod Schema

For structured data, you can provide a Zod schema. The LLM will receive type information, enabling it to write better code:

```typescript
import { z } from 'zod';
import { createRLLM } from 'rllm';

// Define schema for your data
const DataSchema = z.object({
  users: z.array(z.object({
    id: z.string(),
    name: z.string(),
    role: z.enum(['admin', 'user', 'guest']),
    activity: z.array(z.object({
      date: z.string(),
      action: z.string(),
    })),
  })),
  settings: z.record(z.string(), z.boolean()),
});

const rlm = createRLLM({ model: 'gpt-4o-mini' });

const result = await rlm.completion(
  "How many admin users are there? What actions did they perform?",
  {
    context: myData,
    contextSchema: DataSchema,  // LLM sees the type structure!
  }
);
```

The LLM will know it can access `context.users`, `context.settings`, etc. with full type awareness.

The LLM will write code like:
```javascript
// LLM-generated code runs in V8 isolate
const chunks = [];
for (let i = 0; i < context.length; i += 50000) {
  chunks.push(context.slice(i, i + 50000));
}

const findings = await llm_query_batched(
  chunks.map(c => `Extract key findings from:\n${c}`)
);

const summary = await llm_query(`Combine findings:\n${findings.join('\n')}`);
print(summary);
FINAL(summary);
```

## API Reference

### `createRLLM(options)`

Create an RLLM instance with sensible defaults.

```typescript
const rlm = createRLLM({
  model: 'gpt-4o-mini',      // Model name
  provider: 'openai',         // 'openai' | 'anthropic' | 'gemini' | 'openrouter' | 'custom'
  apiKey: process.env.KEY,    // Optional, uses env vars by default
  baseUrl: undefined,         // Optional, required for 'custom' provider
  verbose: true,              // Enable logging
});
```

### Custom Provider (OpenAI-Compatible APIs)

Use the `custom` provider to connect to any OpenAI-compatible API (e.g., vLLM, Ollama, LM Studio, Azure OpenAI):

```typescript
const rlm = createRLLM({
  provider: 'custom',
  model: 'llama-3.1-8b',
  baseUrl: 'http://localhost:8000/v1',  // Required for custom provider
  apiKey: 'your-api-key',               // Optional, depends on your API
  verbose: true,
});
```

**Note:** When using `provider: 'custom'`, the `baseUrl` parameter is **required**. An error will be thrown if it's not provided.

### `RLLM` Methods

| Method | Description |
|--------|-------------|
| `rlm.completion(prompt, options)` | Full RLM completion with code execution |
| `rlm.chat(messages)` | Direct LLM chat |
| `rlm.getClient()` | Get underlying LLM client |

### `CompletionOptions`

| Option | Type | Description |
|--------|------|-------------|
| `context` | `string \| T` | The context data available to LLM-generated code |
| `contextSchema` | `ZodType<T>` | Optional Zod schema describing context structure |

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

### Real-time Events

Subscribe to execution events for visualizations, debugging, or streaming UIs:

```typescript
const result = await rlm.completion("Analyze this data", {
  context: myData,
  onEvent: (event) => {
    switch (event.type) {
      case "iteration_start":
        console.log(`Starting iteration ${event.iteration}`);
        break;
      case "llm_query_start":
        console.log("LLM thinking...");
        break;
      case "code_execution_start":
        console.log(`Executing:\n${event.code}`);
        break;
      case "sub_llm_query":
        console.log(`Sub-query: ${event.prompt}`);
        break;
      case "final_answer":
        console.log(`Answer: ${event.answer}`);
        break;
    }
  }
});
```

| Event Type | Description |
|------------|-------------|
| `iteration_start` | New iteration beginning |
| `llm_query_start` | Main LLM query starting |
| `llm_query_end` | Main LLM response received |
| `code_execution_start` | V8 isolate executing code |
| `code_execution_end` | Code execution finished |
| `sub_llm_query` | Sub-LLM query via `llm_query()` |
| `final_answer` | `FINAL()` called with answer |

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

## Why V8 Isolates? (Not TCP/Containers)

The Python RLLM uses subprocess + TCP sockets for code execution. We use **V8 isolates** instead:

```
Python RLLM:  LLM → Python exec() → subprocess → TCP socket → LMHandler
TypeScript:   LLM → V8 isolate (same process) → direct function calls
```


Benefits:
- **No TCP/network** - Direct function calls via bindings
- **Fast startup** - Isolates spin up in milliseconds
- **Secure** - V8's built-in memory isolation
- **Simple** - No containers, no socket servers

## Development

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

## License

MIT - Same as the original Python RLLM.

## Credits

Based on the [Recursive Language Models](https://arxiv.org/abs/2512.24601) paper and [Python implementation](https://github.com/alexzhang13/rlm) by Alex Zhang et al.

Reference: [RLM Blogpost](https://alexzhang13.github.io/blog/2025/rlm/)
