# node_modules Graph Analyzer

Interactive 3D visualization of your `node_modules` dependencies with RLLM-powered queries. Watch in real-time as the AI traverses your dependency graph to answer questions about duplicates, sizes, and relationships.

## Features

- 📦 **Parse any node_modules** - Analyzes package.json files, calculates sizes, detects duplicates
- 🎯 **Real-time Visualization** - 3D force-directed graph with live highlighting as RLLM explores
- 🤖 **AI-Powered Queries** - Ask natural language questions about your dependencies
- 🔍 **Proxy Hooks** - Tracks every property access via JavaScript Proxies for visualization

## Quick Start

```bash
cd examples/node-modules-viz
pnpm install
pnpm start
```

Then open http://localhost:3000 in your browser.

This runs both the backend (WebSocket + RLLM) and frontend (Vite + React) concurrently.

This will:
1. Parse the parent directory's `node_modules` (this repo)
2. Show the 3D visualization
3. Let you click example queries or type your own

## Usage

### Analyze a specific project

```bash
pnpm server --target=/path/to/your/project
```

### Run a custom query from CLI

```bash
pnpm server --query="Find the largest packages"
```

Or just use the interactive UI in the browser!

### Combine both

```bash
pnpm server --target=~/projects/my-app --query="What brings in lodash?"
```

## Example Queries

### Find Duplicates
```
Which packages have multiple versions installed?
```

### Dependency Chains
```
What brings in lodash? Show the dependency chain.
```

### Disk Space Analysis
```
How much disk space could I save by deduping?
```

### Size Analysis
```
Find the 5 largest packages and their total size.
```

### Dependency Relationships
```
What's the path from react to scheduler?
```

### Popularity Analysis
```
Which packages have the most dependents?
```

### License Audit
```
Find all MIT licensed packages.
```

### Circular Dependencies
```
Find circular dependencies in the graph.
```

### Dev vs Prod
```
How many packages are dev dependencies vs production?
```

### Version Conflicts
```
Show all packages where different versions are required by different dependents.
```

## How It Works

### 1. Graph Parsing

The parser walks your `node_modules` directory recursively:
- Reads each `package.json`
- Calculates disk size
- Detects hoisting and nesting
- Identifies duplicate versions

### 2. Proxy Tracking

The graph context is wrapped in recursive JavaScript Proxies:

```typescript
const trackedContext = createTrackedGraph(context, (event) => {
  // When RLLM code accesses context.packages["lodash@4.17.21"]
  // This callback fires and sends the event to the browser
  server.sendAccessEvent(event);
});
```

### 3. RLLM Execution

The AI writes JavaScript code that runs in a V8 isolate:

```javascript
// Example: Find duplicates
const duplicates = [];
for (const [name, ids] of Object.entries(context.packagesByName)) {
  if (ids.length > 1) {
    const sizes = ids.map(id => context.packages[id].diskSize);
    duplicates.push({ name, versions: ids, totalSize: sizes.reduce((a,b) => a+b) });
  }
}
giveFinalAnswer({ message: JSON.stringify(duplicates, null, 2) });
```

Every property access (like `context.packages[id]`) triggers the Proxy, which emits an event to highlight that node in the visualization.

### 4. Real-time Visualization

The browser receives WebSocket events and highlights nodes as they're accessed:
- **Blue nodes** = regular packages
- **Red nodes** = duplicate versions
- **Green pulse** = currently accessed by RLLM

## Architecture

```
┌─────────────────┐
│  node_modules/  │
└────────┬────────┘
         │ parse
         ▼
┌─────────────────┐
│ Dependency Graph│
└────────┬────────┘
         │ wrap in Proxy
         ▼
┌─────────────────┐      ┌──────────────┐
│ Tracked Context │─────▶│ RLLM Engine  │
└────────┬────────┘      └──────┬───────┘
         │                      │
         │ access events        │ query result
         ▼                      ▼
┌─────────────────────────────────────┐
│     WebSocket Server                │
└────────────┬────────────────────────┘
             │
             ▼
┌─────────────────────────────────────┐
│  Browser (force-graph-3d)           │
│  - 3D visualization                 │
│  - Real-time highlighting           │
│  - Stats panel                      │
└─────────────────────────────────────┘
```

## Graph Data Structure

### Nodes
```typescript
{
  id: "lodash@4.17.21",
  name: "lodash",
  version: "4.17.21",
  diskSize: 1234567,
  isDuplicate: false,
  isHoisted: true,
  dependents: ["package-a@1.0.0", "package-b@2.0.0"]
}
```

### Edges
```typescript
{
  source: "react@18.2.0",
  target: "scheduler@0.23.0",
  type: "prod",
  versionRange: "^0.23.0"
}
```

## Environment Variables

Create a `.env` file:

```bash
OPENAI_API_KEY=your_key_here
MODEL=gpt-4o-mini  # or gpt-4o, gpt-4-turbo, etc.
# Optional: switch provider (openai | anthropic | gemini | openrouter | cerebras)
# PROVIDER=cerebras
# CEREBRAS_API_KEY=your_key_here
```

## Tips

- **Large projects**: Parsing may take a minute for huge `node_modules` (10k+ packages)
- **Query complexity**: Start simple, let RLLM iterate to solve complex queries
- **Visualization**: Click and drag nodes, scroll to zoom, the graph auto-rotates
- **Results panel**: Shows at the bottom when query completes

## Troubleshooting

### No packages found
Make sure the target directory has a `node_modules` folder:
```bash
ls /path/to/project/node_modules
```

### Browser doesn't open
Manually navigate to: http://localhost:3000

### WebSocket connection failed
Check if port 3000 is available:
```bash
lsof -i :3000
```

### RLLM query fails
Check your OpenAI API key is set:
```bash
echo $OPENAI_API_KEY
```

## Development

```bash
# Watch mode (auto-restart on changes)
pnpm dev

# Run with verbose logging
pnpm start --query="Your query"
```

## Credits

Built with:
- [RLLM](https://github.com/code-rabi/rllm) - Recursive Language Models
- [react-force-graph-3d](https://github.com/vasturiano/react-force-graph) - React 3D graph visualization
- [Vite](https://vitejs.dev/) + [React](https://react.dev/) - Frontend framework
- [ws](https://github.com/websockets/ws) - WebSocket server (port 4242)

Inspired by the [Recursive Language Models paper](https://arxiv.org/abs/2512.24601).
