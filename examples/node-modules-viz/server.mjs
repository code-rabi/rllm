/**
 * node_modules Graph Analyzer - WebSocket Server
 * Parses pnpm-lock.yaml and runs RLLM queries
 */

import 'dotenv/config';
import { WebSocketServer } from 'ws';
import { readWantedLockfile } from '@pnpm/lockfile-file';
import { resolve } from 'path';
import { createRLLM } from 'rllm';
import { z } from 'zod';

// Define Zod schema for the dependency context
const PackageSchema = z.object({
  id: z.string().describe('Package identifier in format "name@version"'),
  name: z.string().describe('Package name'),
  version: z.string().describe('Semver version'),
  val: z.number().describe('Node size for visualization'),
  color: z.string().describe('Node color for visualization'),
});

const DependencySchema = z.object({
  from: z.string().describe('Source package id'),
  to: z.string().describe('Target package id (dependency)'),
});

const StatsSchema = z.object({
  totalPackages: z.number().describe('Total number of packages'),
  totalLinks: z.number().describe('Total number of dependency links'),
  directDeps: z.number().describe('Number of direct dependencies'),
});

const ContextSchema = z.object({
  packages: z.record(z.string(), PackageSchema).describe('Map of package id to package info'),
  dependencies: z.array(DependencySchema).describe('List of dependency relationships'),
  stats: StatsSchema.describe('Summary statistics'),
});

const PORT = 4242;
const TARGET = resolve(process.cwd(), '../../');

console.log('🔍 node_modules Graph Analyzer');
console.log(`Target: ${TARGET}\n`);

// Check for API key based on provider
const provider = process.env.PROVIDER || 'gemini';
const apiKeyName = {
  gemini: 'GEMINI_API_KEY or GOOGLE_API_KEY',
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  cerebras: 'CEREBRAS_API_KEY',
}[provider] || 'API key';

const hasApiKey = provider === 'gemini' 
  ? (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY)
  : process.env[`${provider.toUpperCase()}_API_KEY`];

if (!hasApiKey) {
  console.warn(`⚠️  ${apiKeyName} not set - queries will not work`);
}

// Initialize RLLM
const rlm = createRLLM({
  model: process.env.MODEL || 'gemini-3-flash-preview',
  provider: process.env.PROVIDER || 'gemini',
  verbose: true,
});

// Parse pnpm lockfile
console.log('📦 Parsing pnpm-lock.yaml...');

const lockfile = await readWantedLockfile(TARGET, { ignoreIncompatible: true });

if (!lockfile) {
  console.error('❌ No pnpm-lock.yaml found');
  process.exit(1);
}

// Build graph from lockfile
const nodes = new Map();
const links = [];

// Get root dependencies from importers
const rootImporter = lockfile.importers?.['.'];
const rootDeps = {
  ...(rootImporter?.dependencies || {}),
  ...(rootImporter?.devDependencies || {})
};

// Add root node
nodes.set('root', {
  id: 'root',
  name: 'root',
  version: '',
  val: 20,
  color: '#ff6b6b'
});

// Process all packages from lockfile
const packages = lockfile.packages || {};

for (const [pkgPath, pkgInfo] of Object.entries(packages)) {
  const match = pkgPath.match(/^\/?(.+)@([^@]+)$/);
  if (!match) continue;
  
  const [, name, version] = match;
  const id = `${name}@${version}`;
  
  if (nodes.has(id)) continue;
  
  const isDirect = Object.values(rootDeps).some(dep => {
    const depVersion = dep.version || dep;
    return depVersion.includes(version) || depVersion === version;
  });
  
  nodes.set(id, {
    id,
    name,
    version,
    val: isDirect ? 10 : 5,
    color: isDirect ? '#4ecdc4' : '#6c9bcf'
  });
  
  // Add edges for dependencies
  const deps = pkgInfo.dependencies || {};
  for (const [depName, depVersion] of Object.entries(deps)) {
    const depId = `${depName}@${depVersion}`;
    links.push({ source: id, target: depId });
  }
}

// Add links from root to direct dependencies
for (const [depName, depInfo] of Object.entries(rootDeps)) {
  const depVersion = depInfo.version || depInfo;
  const cleanVersion = depVersion.replace(/\(.*\)/, '');
  const depId = `${depName}@${cleanVersion}`;
  
  if (nodes.has(depId)) {
    links.push({ source: 'root', target: depId });
  }
}

// Filter links to only include existing nodes
const validLinks = links.filter(link => 
  nodes.has(link.source) && nodes.has(link.target)
);

const graphData = {
  nodes: Array.from(nodes.values()),
  links: validLinks
};

const stats = {
  totalPackages: nodes.size,
  totalLinks: validLinks.length,
  directDeps: Object.keys(rootDeps).length
};

// Build context object for RLLM
const rawContext = {
  packages: Object.fromEntries(nodes),
  dependencies: validLinks.map(l => ({ from: l.source, to: l.target })),
  stats
};

// Create tracked context with Proxy to emit access events
function createTrackedContext(target, onAccess, path = []) {
  if (target === null || typeof target !== 'object') {
    return target;
  }
  
  return new Proxy(target, {
    get(obj, prop) {
      if (typeof prop === 'symbol' || String(prop).startsWith('__')) {
        return obj[prop];
      }
      
      const propStr = String(prop);
      const currentPath = [...path, propStr];
      
      // Emit access event for packages
      if (currentPath[0] === 'packages' && currentPath.length >= 2) {
        const nodeId = currentPath[1];
        console.log(`📍 Accessing: ${nodeId}`);
        onAccess({ type: 'node_access', nodeId, path: currentPath });
      }
      
      const value = obj[prop];
      
      // Recursively wrap objects
      if (value !== null && typeof value === 'object' && typeof value !== 'function') {
        return createTrackedContext(value, onAccess, currentPath);
      }
      
      return value;
    },
    
    ownKeys(obj) {
      console.log(`📍 Enumerating: ${path.join('.')}`);
      return Reflect.ownKeys(obj);
    }
  });
}

console.log(`📊 Found ${stats.totalPackages} packages, ${stats.totalLinks} dependency links\n`);

// Create WebSocket server
console.log(`🌐 Starting WebSocket server on port ${PORT}...`);
const wss = new WebSocketServer({ port: PORT });
const clients = new Set();

function broadcast(msg) {
  const data = JSON.stringify(msg);
  for (const client of clients) {
    if (client.readyState === 1) { // WebSocket.OPEN
      client.send(data);
    }
  }
}

wss.on('listening', () => {
  console.log(`🚀 Server running at ws://localhost:${PORT}`);
  console.log('✨ Ready! Open http://localhost:3000\n');
});

wss.on('error', (err) => {
  console.error('❌ Server error:', err.message);
});

wss.on('connection', (ws) => {
  console.log('✅ Client connected');
  clients.add(ws);
  
  // Send graph data
  ws.send(JSON.stringify({
    type: 'graph_data',
    data: { graph: graphData, stats }
  }));
  
  ws.on('message', async (data) => {
    try {
      const msg = JSON.parse(data.toString());
      
      if (msg.type === 'run_query') {
        console.log(`\n🤖 Running query: ${msg.query}`);
        broadcast({ type: 'status', status: 'running' });
        
        // Create tracked context that emits access events
        const trackedContext = createTrackedContext(rawContext, (event) => {
          if (event.nodeId) {
            broadcast({ type: 'access_event', data: event });
          }
        });
        
        try {
          const result = await rlm.completion(msg.query, { 
            context: trackedContext,
            contextSchema: ContextSchema,
            onEvent: (event) => {
              // Broadcast RLLM events to frontend for the activity log
              broadcast({ type: 'rllm_event', data: event });
            }
          });
          console.log('✅ Query complete');
          console.log('Result:', result);
          broadcast({ type: 'result', data: result });
          broadcast({ type: 'status', status: 'completed' });
        } catch (err) {
          console.error('❌ Query error:', err.message);
          broadcast({ 
            type: 'result', 
            data: { answer: { message: `Error: ${err.message}`, data: null } }
          });
          broadcast({ type: 'status', status: 'error' });
        }
      }
    } catch (err) {
      console.error('Failed to parse message:', err);
    }
  });
  
  ws.on('close', () => {
    console.log('Client disconnected');
    clients.delete(ws);
  });
});

// Keep alive
process.on('SIGINT', () => {
  console.log('\n👋 Shutting down...');
  wss.close();
  process.exit(0);
});
