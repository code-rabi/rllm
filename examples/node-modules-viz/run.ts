#!/usr/bin/env node
/**
 * node_modules Graph Analyzer - Main Entry Point
 */

import "dotenv/config";
import { WebSocketServer, WebSocket } from "ws";
import { parseNodeModules } from "./lib/parse-node-modules.js";
import { buildGraph, graphToContext, graphToForceGraph } from "./lib/build-graph.js";
import { createTrackedGraph, createFilteredCallback } from "./lib/tracked-graph.js";
import { createRLLM } from "rllm";
import { resolve } from "path";

const PORT = 4242;

// Parse command line arguments
const args = process.argv.slice(2);
const targetArg = args.find(arg => arg.startsWith("--target="));
const targetPath = targetArg 
  ? targetArg.split("=")[1]! 
  : resolve(process.cwd(), "../../");

console.log("🔍 node_modules Graph Analyzer");
console.log(`Target: ${targetPath}\n`);

// Step 1: Parse node_modules
console.log("📦 Parsing node_modules...");
const parsed = parseNodeModules(targetPath);

if (parsed.packages.size === 0) {
  console.error("❌ No packages found.");
  process.exit(1);
}

// Step 2: Build graph
console.log("🔗 Building dependency graph...");
const graph = buildGraph(parsed);
const forceGraphData = graphToForceGraph(graph);
const context = graphToContext(graph);

console.log(`📊 Found ${graph.stats.totalPackages} packages\n`);

// Step 3: Create WebSocket server
console.log(`🌐 Starting WebSocket server on port ${PORT}...`);

const wss = new WebSocketServer({ port: PORT });
const clients = new Set<WebSocket>();

// Initialize RLLM
const rlm = createRLLM({
  model: process.env.MODEL || "gpt-4o-mini",
  provider: "openai",
  verbose: true,
});

wss.on("listening", () => {
  console.log(`🚀 WebSocket server running on ws://localhost:${PORT}`);
  console.log("✨ Ready! Waiting for frontend to connect...\n");
});

wss.on("error", (err) => {
  console.error("❌ Server error:", err);
  process.exit(1);
});

wss.on("connection", (ws) => {
  console.log("✅ Client connected");
  clients.add(ws);
  
  // Send graph data immediately
  ws.send(JSON.stringify({
    type: "graph_data",
    data: { graph: forceGraphData, stats: graph.stats }
  }));
  
  ws.on("message", async (data) => {
    try {
      const msg = JSON.parse(data.toString());
      
      if (msg.type === "run_query") {
        console.log(`\n🤖 Running query: ${msg.query}`);
        broadcast({ type: "status", status: "running" });
        
        const trackedContext = createTrackedGraph(
          context,
          createFilteredCallback((event) => {
            broadcast({ type: "access_event", data: event });
          })
        );
        
        try {
          const result = await rlm.completion(msg.query, { context: trackedContext });
          console.log("✅ Query complete");
          broadcast({ type: "result", data: result });
          broadcast({ type: "status", status: "completed" });
        } catch (err) {
          console.error("❌ Query error:", err);
          broadcast({ type: "status", status: "error", data: { error: String(err) } });
        }
      }
    } catch (err) {
      console.error("Failed to parse message:", err);
    }
  });
  
  ws.on("close", () => {
    console.log("Client disconnected");
    clients.delete(ws);
  });
});

function broadcast(msg: any) {
  const data = JSON.stringify(msg);
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  }
}

// Keep process alive
process.on("SIGINT", () => {
  console.log("\n👋 Shutting down...");
  wss.close();
  process.exit(0);
});
