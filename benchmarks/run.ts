#!/usr/bin/env npx tsx
/**
 * OOLONG Benchmark Runner
 * 
 * Downloads and runs the official OOLONG benchmark from HuggingFace
 * to validate the TypeScript RLM implementation.
 * 
 * Usage:
 *   pnpm tsx benchmarks/run.ts [options]
 * 
 * Options:
 *   --synthetic    Use synthetic benchmark (no download)
 *   --limit N      Limit to N tasks (default: 10)
 *   --verbose      Show detailed output
 * 
 * Reference: https://alexzhang13.github.io/blog/2025/rlm/
 * Dataset: https://huggingface.co/datasets/oolongbench/oolong-synth
 */

import "dotenv/config";
import { createRLM } from "../src/index.js";
import {
  downloadOolongBenchmark,
  generateSyntheticSuite,
  generateNeedleInHaystack,
  generateMultiNeedle,
  generateMultiHop,
  runOolongBenchmark,
  type OolongTask,
} from "./oolong.js";

async function main() {
  const args = process.argv.slice(2);
  const useSynthetic = args.includes("--synthetic");
  const verbose = args.includes("--verbose");
  const limitIdx = args.indexOf("--limit");
  const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1] ?? "10", 10) : 10;

  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║              OOLONG Benchmark for RLM-TS                     ║");
  console.log("╠══════════════════════════════════════════════════════════════╣");
  console.log("║  Reference: https://alexzhang13.github.io/blog/2025/rlm/     ║");
  console.log("║  Dataset: huggingface.co/datasets/oolongbench/oolong-synth   ║");
  console.log("╚══════════════════════════════════════════════════════════════╝");
  console.log();

  // Create RLM instance
  const rlm = createRLM({
    model: process.env.MODEL ?? "gpt-4o-mini",
    provider: (process.env.PROVIDER as "openai" | "anthropic" | "openrouter") ?? "openai",
    verbose: verbose,
  });

  // Get benchmark tasks
  let tasks: OolongTask[];

  if (useSynthetic) {
    console.log("[Mode] Synthetic benchmark (needle-in-haystack, multi-hop, etc.)");
    console.log();
    
    // Generate a smaller synthetic suite for quick testing
    tasks = [
      generateNeedleInHaystack({ id: "needle-1", contextLength: 30000, needleDepth: 0.3 }),
      generateNeedleInHaystack({ id: "needle-2", contextLength: 30000, needleDepth: 0.7 }),
      generateMultiNeedle({ id: "multi-1", contextLength: 40000, needleCount: 3 }),
      generateMultiHop({ id: "hop-1", contextLength: 35000, hopCount: 3 }),
    ];
  } else {
    console.log("[Mode] Real OOLONG benchmark from HuggingFace");
    console.log(`[Limit] ${limit} tasks`);
    console.log();
    
    tasks = await downloadOolongBenchmark({
      cacheDir: "./benchmarks",
      limit,
      forceRefresh: args.includes("--refresh"),
    });
  }

  console.log(`\nRunning ${tasks.length} benchmark tasks...\n`);

  // Run the benchmark
  const results = await runOolongBenchmark({
    rlm,
    tasks,
    outputDir: "./benchmarks/results",
    verbose: true,
  });

  // Final summary
  console.log("\n" + "═".repeat(60));
  console.log("FINAL RESULTS");
  console.log("═".repeat(60));
  console.log(`\nAccuracy: ${(results.summary.accuracy * 100).toFixed(1)}%`);
  console.log(`Correct: ${results.summary.correct}/${results.summary.total}`);
  console.log(`Average time: ${results.summary.avgTimeMs.toFixed(0)}ms per task`);
  console.log(`Total tokens: ${results.summary.totalTokens}`);
  
  console.log("\nBy Category:");
  for (const [category, stats] of Object.entries(results.summary.byCategory)) {
    const bar = "█".repeat(Math.round(stats.accuracy * 20)) + "░".repeat(20 - Math.round(stats.accuracy * 20));
    console.log(`  ${category.padEnd(15)} ${bar} ${stats.correct}/${stats.total} (${(stats.accuracy * 100).toFixed(0)}%)`);
  }
  
  console.log("\nResults saved to ./benchmarks/results/");
}

main().catch((error) => {
  console.error("Benchmark failed:", error);
  process.exit(1);
});

