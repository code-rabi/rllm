# RLM-TS: Recursive Language Models (TypeScript)

A TypeScript implementation of [Recursive Language Models](https://arxiv.org/abs/2512.24601) for processing large contexts with LLMs.

Inspired by [Cloudflare's Code Mode](https://blog.cloudflare.com/code-mode/) approach.

## Installation

```bash
pnpm add rlm-ts
# or
npm install rlm-ts
```

## Quick Start

LLM writes JavaScript code that runs in a secure V8 isolate:

```typescript
import { createRLM } from 'rlm-ts';

const rlm = createRLM({
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
import { createRLM } from 'rlm-ts';

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

const rlm = createRLM({ model: 'gpt-4o-mini' });

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

### `createRLM(options)`

Create an RLM instance with sensible defaults.

```typescript
const rlm = createRLM({
  model: 'gpt-4o-mini',      // Model name
  provider: 'openai',         // 'openai' | 'anthropic' | 'openrouter'
  apiKey: process.env.KEY,    // Optional, uses env vars by default
  verbose: true,              // Enable logging
});
```

### `RLM` Methods

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

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  RLM TypeScript                                             │
│                                                             │
│  ┌─────────────┐    ┌──────────────────────────────────┐   │
│  │   RLM       │    │  V8 Isolate (Sandbox)            │   │
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

The Python RLM uses subprocess + TCP sockets for code execution. We use **V8 isolates** instead:

```
Python RLM:  LLM → Python exec() → subprocess → TCP socket → LMHandler
TypeScript:  LLM → V8 isolate (same process) → direct function calls
```


Benefits:
- ✅ **No TCP/network** - Direct function calls via bindings
- ✅ **Fast startup** - Isolates spin up in milliseconds
- ✅ **Secure** - V8's built-in memory isolation
- ✅ **Simple** - No containers, no socket servers

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

MIT - Same as the original Python RLM.

## Credits

Based on the [Recursive Language Models](https://arxiv.org/abs/2512.24601) paper and [Python implementation](https://github.com/alexzhang13/rlm) by Alex Zhang et al.

Reference: [RLM Blogpost](https://alexzhang13.github.io/blog/2025/rlm/)
