#!/usr/bin/env npx tsx
/**
 * Paper-style Benchmark for RLM-TS
 * 
 * Replicates the benchmark from the RLM paper (arxiv.org/abs/2512.24601)
 * Testing S-NIAH (Single Needle in a Haystack) and OOLONG at different context lengths.
 * 
 * Usage:
 *   pnpm tsx benchmarks/paper_benchmark.ts [options]
 * 
 * Options:
 *   --parallel N     Run N tasks in parallel (default: 3)
 *   --quick          Only run 8k and 16k context lengths
 *   --context 8k,16k Comma-separated context lengths to test
 */

import "dotenv/config";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { createRLM, type RLM } from "../src/index.js";
import {
  generateNeedleInHaystack,
  generateMultiNeedle,
  generateMultiHop,
  type OolongTask,
  type BenchmarkResult,
} from "./oolong.js";

// Context lengths to test - matching the paper (arxiv.org/abs/2512.24601)
// The LLM NEVER sees the full context - it's in a variable and the LLM writes
// code to slice/chunk/process it. That's the whole point of RLM!
// ~4 chars per token
const ALL_CONTEXT_LENGTHS = [
  { tokens: "8k", chars: 32000 },
  { tokens: "16k", chars: 64000 },
  { tokens: "33k", chars: 132000 },
  { tokens: "66k", chars: 264000 },
  { tokens: "131k", chars: 524000 },
  { tokens: "262k", chars: 1048000 },
  { tokens: "524k", chars: 2097000 },
  { tokens: "1M", chars: 4000000 },
];

// Estimated time per task based on context length (in seconds)
// Larger contexts need more iterations/sub-LLM calls
const ESTIMATED_TIME_PER_TASK: Record<string, number> = {
  "8k": 25,
  "16k": 30,
  "33k": 40,
  "66k": 50,
  "131k": 70,
  "262k": 100,
  "524k": 150,
  "1M": 200,
};

// ============================================================================
// Parallel Execution Utilities
// ============================================================================

interface TaskResult {
  task: OolongTask;
  result: BenchmarkResult;
}

/**
 * Run tasks with limited concurrency
 */
async function runWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
  onProgress?: (completed: number, total: number, item: T) => void
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  let completed = 0;

  async function runNext(): Promise<void> {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      const item = items[index]!;
      results[index] = await fn(item, index);
      completed++;
      onProgress?.(completed, items.length, item);
    }
  }

  // Start `concurrency` number of workers
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, runNext);
  await Promise.all(workers);

  return results;
}

/**
 * Run a single task and return its result
 */
/**
 * Smart validation for benchmark answers
 */
function validateAnswer(task: OolongTask, answer: string): boolean | undefined {
  if (!task.expectedAnswer) return undefined;
  
  const answerLower = answer.toLowerCase();
  
  // For multi-needle tasks: check each fact individually (order-independent)
  if (task.category === "multi-needle") {
    const expectedFacts = task.expectedAnswer.split(", ");
    return expectedFacts.every(fact => {
      // Expected format: "red elephant: 123"
      const parts = fact.toLowerCase().split(": ");
      if (parts.length === 2) {
        const [animal, number] = parts;
        // Check if both the animal description and number appear in answer
        return answerLower.includes(animal!) && answerLower.includes(number!);
      }
      return answerLower.includes(fact.toLowerCase());
    });
  }
  
  // For other tasks: simple substring match
  return answerLower.includes(task.expectedAnswer.toLowerCase());
}

async function runSingleTask(rlm: RLM, task: OolongTask): Promise<TaskResult> {
  const startTime = Date.now();
  
  try {
    const rlmResult = await rlm.completion(task.context, {
      rootPrompt: task.query,
    });
    
    const answer = rlmResult.answer;
    const correct = validateAnswer(task, answer);
    
    return {
      task,
      result: {
        taskId: task.id,
        implementation: "rlm-ts",
        answer,
        usage: rlmResult.usage,
        correct,
      },
    };
  } catch (error) {
    return {
      task,
      result: {
        taskId: task.id,
        implementation: "rlm-ts",
        answer: `Error: ${error}`,
        usage: {
          totalCalls: 0,
          rootCalls: 0,
          subCalls: 0,
          tokenUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
          executionTimeMs: Date.now() - startTime,
        },
        correct: false,
      },
    };
  }
}

/**
 * Format duration in human-readable form
 */
function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds.toFixed(0)}s`;
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  if (mins < 60) return `${mins}m ${secs}s`;
  const hours = Math.floor(mins / 60);
  const remainMins = mins % 60;
  return `${hours}h ${remainMins}m`;
}

interface BenchmarkDataPoint {
  contextTokens: string;
  contextChars: number;
  sniahScore: number;
  pairsScore: number;
  oolongScore: number;
  sniahTime: number;
  pairsTime: number;
  oolongTime: number;
}

interface BenchmarkOptions {
  contextLengths: typeof ALL_CONTEXT_LENGTHS;
  concurrency: number;
  modelName: string;
}

/**
 * Generate all tasks for the benchmark
 */
function generateAllTasks(contextLengths: typeof ALL_CONTEXT_LENGTHS): OolongTask[] {
  const tasks: OolongTask[] = [];

  for (const { tokens, chars } of contextLengths) {
    // S-NIAH: 5 trials at different depths
    tasks.push(
      generateNeedleInHaystack({ id: `sniah-${tokens}-1`, contextLength: chars, needleDepth: 0.1 }),
      generateNeedleInHaystack({ id: `sniah-${tokens}-2`, contextLength: chars, needleDepth: 0.25 }),
      generateNeedleInHaystack({ id: `sniah-${tokens}-3`, contextLength: chars, needleDepth: 0.5 }),
      generateNeedleInHaystack({ id: `sniah-${tokens}-4`, contextLength: chars, needleDepth: 0.75 }),
      generateNeedleInHaystack({ id: `sniah-${tokens}-5`, contextLength: chars, needleDepth: 0.9 }),
    );

    // OOLONG-Pairs: 3 trials with different needle counts
    tasks.push(
      generateMultiNeedle({ id: `pairs-${tokens}-1`, contextLength: chars, needleCount: 2 }),
      generateMultiNeedle({ id: `pairs-${tokens}-2`, contextLength: chars, needleCount: 3 }),
      generateMultiNeedle({ id: `pairs-${tokens}-3`, contextLength: chars, needleCount: 4 }),
    );

    // OOLONG: 3 trials with different hop counts
    tasks.push(
      generateMultiHop({ id: `oolong-${tokens}-1`, contextLength: chars, hopCount: 2 }),
      generateMultiHop({ id: `oolong-${tokens}-2`, contextLength: chars, hopCount: 3 }),
      generateMultiHop({ id: `oolong-${tokens}-3`, contextLength: chars, hopCount: 4 }),
    );
  }

  return tasks;
}

/**
 * Estimate total benchmark time
 */
function estimateTotalTime(
  contextLengths: typeof ALL_CONTEXT_LENGTHS,
  concurrency: number
): { totalTasks: number; sequentialTime: number; parallelTime: number } {
  const tasksPerContext = 11; // 5 S-NIAH + 3 Pairs + 3 OOLONG
  const totalTasks = contextLengths.length * tasksPerContext;

  let sequentialTime = 0;
  for (const { tokens } of contextLengths) {
    const timePerTask = ESTIMATED_TIME_PER_TASK[tokens] ?? 30;
    sequentialTime += timePerTask * tasksPerContext;
  }

  // Parallel time estimate (rough approximation)
  const parallelTime = sequentialTime / Math.min(concurrency, totalTasks);

  return { totalTasks, sequentialTime, parallelTime };
}

/**
 * Aggregate results by context length
 */
function aggregateResults(
  taskResults: TaskResult[],
  contextLengths: typeof ALL_CONTEXT_LENGTHS
): BenchmarkDataPoint[] {
  const results: BenchmarkDataPoint[] = [];

  for (const { tokens, chars } of contextLengths) {
    // Filter results for this context length
    const sniahResults = taskResults.filter(r => r.task.id.startsWith(`sniah-${tokens}-`));
    const pairsResults = taskResults.filter(r => r.task.id.startsWith(`pairs-${tokens}-`));
    const oolongResults = taskResults.filter(r => r.task.id.startsWith(`oolong-${tokens}-`));

    const sniahCorrect = sniahResults.filter(r => r.result.correct).length;
    const pairsCorrect = pairsResults.filter(r => r.result.correct).length;
    const oolongCorrect = oolongResults.filter(r => r.result.correct).length;

    const avgTime = (results: TaskResult[]) =>
      results.reduce((sum, r) => sum + r.result.usage.executionTimeMs, 0) / results.length;

    results.push({
      contextTokens: tokens,
      contextChars: chars,
      sniahScore: (sniahCorrect / sniahResults.length) * 100,
      pairsScore: (pairsCorrect / pairsResults.length) * 100,
      oolongScore: (oolongCorrect / oolongResults.length) * 100,
      sniahTime: avgTime(sniahResults),
      pairsTime: avgTime(pairsResults),
      oolongTime: avgTime(oolongResults),
    });
  }

  return results;
}

async function runPaperBenchmark(options: BenchmarkOptions): Promise<BenchmarkDataPoint[]> {
  const { contextLengths, concurrency, modelName } = options;

  // Generate all tasks
  const allTasks = generateAllTasks(contextLengths);

  // Estimate time
  const { totalTasks, sequentialTime, parallelTime } = estimateTotalTime(contextLengths, concurrency);

  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║        RLM-TS Paper Benchmark (arxiv.org/abs/2512.24601)     ║");
  console.log("╠══════════════════════════════════════════════════════════════╣");
  console.log(`║  Model: ${modelName.padEnd(52)}║`);
  console.log(`║  Tasks: ${String(totalTasks).padEnd(52)}║`);
  console.log(`║  Concurrency: ${String(concurrency).padEnd(46)}║`);
  console.log(`║  Est. Time: ~${formatDuration(parallelTime).padEnd(47)}║`);
  console.log(`║  (Sequential would be: ~${formatDuration(sequentialTime).padEnd(35)}║`);
  console.log("╚══════════════════════════════════════════════════════════════╝");
  console.log();

  const rlm = createRLM({
    model: modelName,
    provider: (process.env.PROVIDER as "openai" | "anthropic" | "openrouter") ?? "openai",
    verbose: false,
  });

  const startTime = Date.now();
  let lastCategory = "";

  // Run all tasks in parallel with concurrency limit
  console.log(`Starting ${totalTasks} tasks with concurrency ${concurrency}...\n`);

  // Track completed results for progress display
  const completedResults: TaskResult[] = [];

  const taskResults = await runWithConcurrency(
    allTasks,
    concurrency,
    async (task) => {
      const result = await runSingleTask(rlm, task);
      completedResults.push(result);
      return result;
    },
    (completed, total, task) => {
      // Extract category from task ID (e.g., "sniah-8k-1" -> "sniah")
      const [category, contextSize] = task.id.split("-");
      const categoryName = category === "sniah" ? "S-NIAH" : 
                          category === "pairs" ? "OOLONG-Pairs" : "OOLONG";
      
      const elapsed = (Date.now() - startTime) / 1000;
      const avgPerTask = elapsed / completed;
      const remaining = avgPerTask * (total - completed);
      
      // Show progress with pass/fail status
      const pct = ((completed / total) * 100).toFixed(0);
      const result = completedResults.find(r => r.task.id === task.id);
      const status = result?.result.correct ? "✓" : "✗";
      
      console.log(
        `[${completed}/${total}] ${pct}% | ${status} ${categoryName} ${contextSize} | ` +
        `ETA: ${formatDuration(remaining)}`
      );
    }
  );

  const totalTime = (Date.now() - startTime) / 1000;
  console.log(`\n✅ Completed ${totalTasks} tasks in ${formatDuration(totalTime)}`);

  // Aggregate results by context length
  return aggregateResults(taskResults, contextLengths);
}

function generatePythonPlotScript(results: BenchmarkDataPoint[], modelName: string): string {
  const contextLabels = results.map(r => `"${r.contextTokens}"`).join(", ");
  const sniahScores = results.map(r => r.sniahScore.toFixed(1)).join(", ");
  const pairsScores = results.map(r => r.pairsScore.toFixed(1)).join(", ");
  const oolongScores = results.map(r => r.oolongScore.toFixed(1)).join(", ");

  return `#!/usr/bin/env python3
"""
Generate benchmark chart for RLM-TS (matching paper Figure 1 style)
"""
import matplotlib.pyplot as plt
import numpy as np

# Data from benchmark
context_lengths = [${contextLabels}]
sniah_scores = [${sniahScores}]
pairs_scores = [${pairsScores}]
oolong_scores = [${oolongScores}]

# Create figure
fig, ax = plt.subplots(1, 1, figsize=(10, 6))

# Colors matching the paper (Figure 1)
sniah_color = '#1f77b4'   # Blue (like paper)
pairs_color = '#c0392b'   # Dark red (OOLONG-Pairs in paper)
oolong_color = '#d35400'  # Orange (OOLONG in paper)

# Plot lines with different markers
x = np.arange(len(context_lengths))
ax.plot(x, sniah_scores, 'o-', color=sniah_color, linewidth=2, markersize=8, label='S-NIAH')
ax.plot(x, pairs_scores, 's-', color=pairs_color, linewidth=2, markersize=8, label='OOLONG-Pairs')
ax.plot(x, oolong_scores, '^-', color=oolong_color, linewidth=2, markersize=8, label='OOLONG')

# Styling
ax.set_xlabel('Input Context Length (log scale)', fontsize=12)
ax.set_ylabel('Score (%)', fontsize=12)
ax.set_title('RLM-TS (${modelName})', fontsize=14, fontweight='bold')
ax.set_xticks(x)
ax.set_xticklabels(context_lengths)
ax.set_ylim(0, 105)
ax.set_yticks([0, 20, 40, 60, 80, 100])
ax.grid(True, alpha=0.3)
ax.legend(loc='lower left', fontsize=11)

# Background shading (green = within context window)
ax.axvspan(-0.5, len(context_lengths) - 0.5, alpha=0.08, color='green')

plt.tight_layout()
plt.savefig('benchmarks/results/rlm_ts_benchmark.png', dpi=150, bbox_inches='tight')
print('Saved: benchmarks/results/rlm_ts_benchmark.png')
plt.close()
`;
}

function parseArgs() {
  const args = process.argv.slice(2);
  
  // Parse --parallel N
  const parallelIdx = args.indexOf("--parallel");
  const concurrency = parallelIdx >= 0 ? parseInt(args[parallelIdx + 1] ?? "3", 10) : 3;

  // Parse --quick (only 8k and 16k)
  const quick = args.includes("--quick");

  // Parse --context 8k,16k,33k
  const contextIdx = args.indexOf("--context");
  let contextLengths = ALL_CONTEXT_LENGTHS;
  
  if (quick) {
    contextLengths = ALL_CONTEXT_LENGTHS.filter(c => ["8k", "16k"].includes(c.tokens));
  } else if (contextIdx >= 0) {
    const requestedTokens = (args[contextIdx + 1] ?? "").split(",");
    contextLengths = ALL_CONTEXT_LENGTHS.filter(c => requestedTokens.includes(c.tokens));
  }

  // Parse --estimate (just show time estimate, don't run)
  const estimateOnly = args.includes("--estimate");

  return { concurrency, contextLengths, estimateOnly };
}

async function main() {
  const modelName = process.env.MODEL ?? "gpt-5-mini";
  const { concurrency, contextLengths, estimateOnly } = parseArgs();

  // Show time estimate
  const { totalTasks, sequentialTime, parallelTime } = estimateTotalTime(contextLengths, concurrency);

  if (estimateOnly) {
    console.log("╔══════════════════════════════════════════════════════════════╗");
    console.log("║              BENCHMARK TIME ESTIMATE                         ║");
    console.log("╠══════════════════════════════════════════════════════════════╣");
    console.log(`║  Context lengths: ${contextLengths.map(c => c.tokens).join(", ").padEnd(41)}║`);
    console.log(`║  Tasks per context: 11 (5 S-NIAH + 3 Pairs + 3 OOLONG)        ║`);
    console.log(`║  Total tasks: ${String(totalTasks).padEnd(46)}║`);
    console.log("╠══════════════════════════════════════════════════════════════╣");
    console.log(`║  Sequential time: ~${formatDuration(sequentialTime).padEnd(41)}║`);
    console.log(`║  With ${concurrency} parallel: ~${formatDuration(parallelTime).padEnd(42 - String(concurrency).length)}║`);
    console.log("╚══════════════════════════════════════════════════════════════╝");
    console.log("\nTo run the benchmark:");
    console.log(`  MODEL=${modelName} pnpm tsx benchmarks/paper_benchmark.ts --parallel ${concurrency}`);
    console.log("\nFor a quick test (8k + 16k only):");
    console.log(`  MODEL=${modelName} pnpm tsx benchmarks/paper_benchmark.ts --quick --parallel ${concurrency}`);
    return;
  }

  // Run benchmark
  const results = await runPaperBenchmark({ contextLengths, concurrency, modelName });

  // Save results as JSON
  const outputDir = "./benchmarks/results";
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  writeFileSync(
    `${outputDir}/paper-benchmark-${timestamp}.json`,
    JSON.stringify({ model: modelName, results }, null, 2)
  );

  // Generate Python plotting script
  const plotScript = generatePythonPlotScript(results, modelName);
  writeFileSync(`${outputDir}/plot_benchmark.py`, plotScript);

  // Print summary
  console.log("\n" + "═".repeat(70));
  console.log("FINAL RESULTS");
  console.log("═".repeat(70));
  console.log(`\nModel: ${modelName}`);
  console.log("\n┌─────────────┬───────────┬───────────────┬───────────┐");
  console.log("│ Context     │ S-NIAH    │ OOLONG-Pairs  │ OOLONG    │");
  console.log("├─────────────┼───────────┼───────────────┼───────────┤");
  for (const r of results) {
    console.log(`│ ${r.contextTokens.padEnd(11)} │ ${r.sniahScore.toFixed(0).padStart(6)}%   │ ${r.pairsScore.toFixed(0).padStart(10)}%   │ ${r.oolongScore.toFixed(0).padStart(6)}%   │`);
  }
  console.log("└─────────────┴───────────┴───────────────┴───────────┘");

  console.log(`\n✅ Results saved to ${outputDir}/paper-benchmark-${timestamp}.json`);
  console.log(`✅ Plot script saved to ${outputDir}/plot_benchmark.py`);
  console.log("\nTo generate the PNG chart, run:");
  console.log("  python3 benchmarks/results/plot_benchmark.py");
}

main().catch(console.error);

