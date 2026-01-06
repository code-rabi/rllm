/**
 * OOLONG Benchmark for RLM
 * 
 * Based on the official RLM paper benchmark (arxiv.org/abs/2512.24601).
 * 
 * Two modes:
 * 1. Real OOLONG: Downloads from HuggingFace (oolongbench/oolong-synth)
 * 2. Synthetic: Generates needle-in-haystack, multi-hop, aggregation tasks
 * 
 * Reference: https://alexzhang13.github.io/blog/2025/rlm/
 * Dataset: https://huggingface.co/datasets/oolongbench/oolong-synth
 */

import { writeFileSync, readFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { RLM } from "../src/rlm.js";
import type { RLMUsage, TokenUsage } from "../src/types.js";

// ============================================================================
// Types
// ============================================================================

export interface BenchmarkTask {
  id: string;
  name: string;
  context: string;
  query: string;
  expectedAnswer?: string;
}

export interface BenchmarkResult {
  taskId: string;
  implementation: string;
  answer: string;
  usage: RLMUsage;
  correct?: boolean;
  score?: number;
}

export interface OolongTask extends BenchmarkTask {
  category: "needle" | "multi-needle" | "multi-hop" | "aggregation" | "counting" | "distributional" | "enumeration" | "cumulative";
  contextLength: number;
  needleDepth?: number;
  needleCount?: number;
  hopCount?: number;
}

export interface OolongHFExample {
  context_window_text: string;
  question: string;
  answer: string;
  task_type?: string;
  context_length?: number;
}

export interface OolongBenchmarkOptions {
  rlm: RLM;
  tasks: OolongTask[];
  outputDir?: string;
  verbose?: boolean;
}

export interface OolongBenchmarkResult {
  tasks: OolongTask[];
  results: BenchmarkResult[];
  summary: {
    total: number;
    correct: number;
    accuracy: number;
    avgTimeMs: number;
    avgIterations: number;
    totalTokens: number;
    byCategory: Record<string, { correct: number; total: number; accuracy: number }>;
  };
}

// ============================================================================
// OOLONG Dataset from HuggingFace
// ============================================================================

const OOLONG_CACHE_FILE = ".oolong-cache.json";

/**
 * Download OOLONG benchmark from HuggingFace
 * Dataset: https://huggingface.co/datasets/oolongbench/oolong-synth
 */
export async function downloadOolongBenchmark(options?: {
  cacheDir?: string;
  limit?: number;
  forceRefresh?: boolean;
}): Promise<OolongTask[]> {
  const cacheDir = options?.cacheDir ?? "./benchmarks";
  const cachePath = join(cacheDir, OOLONG_CACHE_FILE);
  const limit = options?.limit ?? 50;

  // Check cache first
  if (!options?.forceRefresh && existsSync(cachePath)) {
    try {
      const cached = JSON.parse(readFileSync(cachePath, "utf-8"));
      console.log(`[OOLONG] Loaded ${cached.length} tasks from cache`);
      return cached.slice(0, limit);
    } catch {
      // Cache invalid, continue to download
    }
  }

  console.log("[OOLONG] Downloading from HuggingFace...");

  try {
    const url = `https://datasets-server.huggingface.co/rows?dataset=oolongbench%2Foolong-synth&config=default&split=test&offset=0&length=${limit}`;
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const data = await response.json() as { rows: Array<{ row: OolongHFExample }> };
    
    const tasks: OolongTask[] = data.rows.map((item, idx) => ({
      id: `oolong-${idx + 1}`,
      name: `OOLONG ${item.row.task_type ?? "task"} #${idx + 1}`,
      category: (item.row.task_type as OolongTask["category"]) ?? "needle",
      context: item.row.context_window_text,
      contextLength: item.row.context_window_text.length,
      query: item.row.question,
      expectedAnswer: item.row.answer,
    }));

    // Cache the results
    if (!existsSync(cacheDir)) {
      mkdirSync(cacheDir, { recursive: true });
    }
    writeFileSync(cachePath, JSON.stringify(tasks, null, 2));
    console.log(`[OOLONG] Downloaded ${tasks.length} tasks, cached to ${cachePath}`);

    return tasks;
  } catch (error) {
    console.error(`[OOLONG] Failed to download: ${error}`);
    console.log("[OOLONG] Falling back to synthetic benchmark...");
    return generateSyntheticSuite({ contextLengths: [50000, 100000] });
  }
}

// ============================================================================
// Synthetic Benchmark Generation (Fallback)
// ============================================================================

const FILLER_TOPICS = [
  "The history of bread-making dates back thousands of years. Ancient Egyptians are credited with developing leavened bread around 4000 BCE. The process was discovered accidentally when wild yeast landed on dough left out in the warm Egyptian climate.",
  "Butterflies taste with their feet. When a butterfly lands on a plant, special chemoreceptors on their feet help them determine if the plant is suitable for laying eggs or if it contains nectar worth drinking.",
  "The world's oldest known recipe is for beer. Dating back to around 1800 BCE, the recipe was found on a Sumerian tablet and describes a detailed brewing process using barley and dates.",
  "Octopuses have three hearts and blue blood. Two hearts pump blood to the gills, while the third pumps it to the rest of the body. Their blood is blue because it uses copper-based hemocyanin instead of iron-based hemoglobin.",
  "The shortest war in history lasted only 38 to 45 minutes. The Anglo-Zanzibar War occurred on August 27, 1896, between the United Kingdom and the Zanzibar Sultanate.",
  "Honey never spoils. Archaeologists have found 3,000-year-old honey in Egyptian tombs that was still perfectly edible. Honey's low moisture content and acidic pH create an inhospitable environment for bacteria.",
  "A group of flamingos is called a 'flamboyance'. These pink birds get their color from the carotenoid pigments in the algae and crustaceans they eat.",
  "The Eiffel Tower can grow more than 6 inches during the summer. The iron structure expands when heated, making the tower measurably taller on hot days.",
  "Bananas are berries, but strawberries are not. Botanically speaking, a berry develops from a single flower with one ovary, which applies to bananas but not to strawberries.",
  "Venus is the only planet that spins clockwise. All other planets in our solar system rotate counter-clockwise when viewed from above their north poles.",
  "The inventor of the Pringles can is buried in one. Fredric Baur designed the iconic cylindrical container and requested that some of his ashes be buried in a Pringles can.",
  "Scotland's national animal is the unicorn. The mythical creature has been a Scottish heraldic symbol since the 12th century.",
  "A jiffy is an actual unit of time. In physics, it represents the time it takes light to travel one centimeter, approximately 33.3564 picoseconds.",
  "The Great Wall of China is not visible from space with the naked eye. This popular myth has been debunked by astronauts, as the wall is too narrow to be distinguished from orbit.",
  "Cows have best friends and become stressed when separated from them. Research has shown that cows are social animals that form strong bonds with herd members.",
];

function generateHaystack(targetLength: number): string {
  const paragraphs: string[] = [];
  let currentLength = 0;
  let topicIndex = 0;

  while (currentLength < targetLength) {
    const topic = FILLER_TOPICS[topicIndex % FILLER_TOPICS.length]!;
    paragraphs.push(topic);
    currentLength += topic.length + 2;
    topicIndex++;
  }

  return paragraphs.join("\n\n");
}

function insertNeedleAtDepth(haystack: string, needle: string, depth: number): string {
  const position = Math.floor(haystack.length * depth);
  const searchStart = Math.max(0, position - 100);
  const searchEnd = Math.min(haystack.length, position + 100);
  const searchRegion = haystack.slice(searchStart, searchEnd);
  
  const breakIndex = searchRegion.indexOf("\n\n");
  const insertPosition = breakIndex >= 0 ? searchStart + breakIndex + 2 : position;
  
  return haystack.slice(0, insertPosition) + needle + "\n\n" + haystack.slice(insertPosition);
}

export function generateNeedleInHaystack(options: {
  id: string;
  contextLength: number;
  needleDepth?: number;
}): OolongTask {
  const { id, contextLength, needleDepth = 0.5 } = options;
  
  const secretCode = Math.random().toString(36).substring(2, 10).toUpperCase();
  const needle = `IMPORTANT: The secret code for project Alpha is: ${secretCode}. This code must be remembered for the final report.`;
  
  const haystack = generateHaystack(contextLength);
  const context = insertNeedleAtDepth(haystack, needle, needleDepth);
  
  return {
    id,
    name: `Needle in Haystack (${Math.round(contextLength / 1000)}k chars, depth ${needleDepth})`,
    category: "needle",
    context,
    contextLength: context.length,
    needleDepth,
    query: "What is the secret code for project Alpha?",
    expectedAnswer: secretCode,
  };
}

export function generateMultiNeedle(options: {
  id: string;
  contextLength: number;
  needleCount?: number;
}): OolongTask {
  const { id, contextLength, needleCount = 3 } = options;
  
  const colors = ["red", "blue", "green", "yellow", "purple", "orange"];
  const animals = ["elephant", "giraffe", "penguin", "dolphin", "tiger", "owl"];
  const numbers = Array.from({ length: needleCount }, () => Math.floor(Math.random() * 1000));
  
  const needles: string[] = [];
  const facts: string[] = [];
  
  for (let i = 0; i < needleCount; i++) {
    const color = colors[i % colors.length]!;
    const animal = animals[i % animals.length]!;
    const number = numbers[i]!;
    
    needles.push(`FACT ${i + 1}: The ${color} ${animal} has ID number ${number}.`);
    facts.push(`${color} ${animal}: ${number}`);
  }
  
  let context = generateHaystack(contextLength);
  for (let i = 0; i < needles.length; i++) {
    const depth = (i + 1) / (needles.length + 1);
    context = insertNeedleAtDepth(context, needles[i]!, depth);
  }
  
  return {
    id,
    name: `Multi-Needle (${needleCount} facts, ${Math.round(contextLength / 1000)}k chars)`,
    category: "multi-needle",
    context,
    contextLength: context.length,
    needleCount,
    query: `Find all the animal ID numbers mentioned in the text. List them as "color animal: number".`,
    expectedAnswer: facts.join(", "),
  };
}

export function generateMultiHop(options: {
  id: string;
  contextLength: number;
  hopCount?: number;
}): OolongTask {
  const { id, contextLength, hopCount = 3 } = options;
  
  const names = ["Alice", "Bob", "Carol", "David", "Eve", "Frank"];
  const cities = ["Paris", "Tokyo", "Sydney", "Cairo", "Berlin", "Toronto"];
  
  const chain: string[] = [];
  let finalAnswer = "";
  
  for (let i = 0; i < hopCount; i++) {
    const person = names[i % names.length]!;
    const city = cities[i % cities.length]!;
    
    if (i === 0) {
      chain.push(`CLUE ${i + 1}: The treasure map was last seen with ${person} in ${city}.`);
    } else if (i < hopCount - 1) {
      const prevPerson = names[(i - 1) % names.length]!;
      chain.push(`CLUE ${i + 1}: ${prevPerson} gave the map to ${person}, who traveled to ${city}.`);
    } else {
      const prevPerson = names[(i - 1) % names.length]!;
      chain.push(`CLUE ${i + 1}: ${prevPerson} sent the map to ${person}. ${person} hid it under the fountain in ${city}.`);
      finalAnswer = city;
    }
  }
  
  let context = generateHaystack(contextLength);
  for (let i = 0; i < chain.length; i++) {
    const depth = (i + 1) / (chain.length + 1);
    context = insertNeedleAtDepth(context, chain[i]!, depth);
  }
  
  return {
    id,
    name: `Multi-Hop (${hopCount} hops, ${Math.round(contextLength / 1000)}k chars)`,
    category: "multi-hop",
    context,
    contextLength: context.length,
    hopCount,
    query: "Follow the clues about the treasure map. In which city is the treasure map hidden?",
    expectedAnswer: finalAnswer,
  };
}

export function generateAggregation(options: {
  id: string;
  contextLength: number;
}): OolongTask {
  const { id, contextLength } = options;
  
  const products = ["Widget A", "Widget B", "Gadget X", "Gadget Y"];
  const records: string[] = [];
  let totalWidgetA = 0;
  
  const numRecords = Math.floor(contextLength / 10000);
  
  for (let i = 0; i < numRecords; i++) {
    const product = products[i % products.length]!;
    const quantity = Math.floor(Math.random() * 100) + 10;
    const month = ["January", "February", "March", "April", "May", "June"][i % 6]!;
    
    records.push(`SALES RECORD: In ${month}, we sold ${quantity} units of ${product}.`);
    
    if (product === "Widget A") {
      totalWidgetA += quantity;
    }
  }
  
  let context = generateHaystack(contextLength);
  for (let i = 0; i < records.length; i++) {
    const depth = (i + 1) / (records.length + 1);
    context = insertNeedleAtDepth(context, records[i]!, depth);
  }
  
  return {
    id,
    name: `Aggregation (${numRecords} records, ${Math.round(contextLength / 1000)}k chars)`,
    category: "aggregation",
    context,
    contextLength: context.length,
    query: "What is the total number of Widget A units sold across all months? Add up all the Widget A sales records.",
    expectedAnswer: String(totalWidgetA),
  };
}

export function generateSyntheticSuite(options?: {
  contextLengths?: number[];
  includeMultiHop?: boolean;
  includeAggregation?: boolean;
}): OolongTask[] {
  const contextLengths = options?.contextLengths ?? [50000, 100000, 200000];
  const tasks: OolongTask[] = [];
  let taskId = 1;
  
  for (const length of contextLengths) {
    for (const depth of [0.1, 0.5, 0.9]) {
      tasks.push(generateNeedleInHaystack({
        id: `needle-${taskId++}`,
        contextLength: length,
        needleDepth: depth,
      }));
    }
  }
  
  for (const length of contextLengths) {
    tasks.push(generateMultiNeedle({
      id: `multi-${taskId++}`,
      contextLength: length,
      needleCount: 3,
    }));
  }
  
  if (options?.includeMultiHop !== false) {
    for (const length of contextLengths.slice(0, 2)) {
      tasks.push(generateMultiHop({
        id: `hop-${taskId++}`,
        contextLength: length,
        hopCount: 3,
      }));
    }
  }
  
  if (options?.includeAggregation !== false) {
    for (const length of contextLengths.slice(0, 2)) {
      tasks.push(generateAggregation({
        id: `agg-${taskId++}`,
        contextLength: length,
      }));
    }
  }
  
  return tasks;
}

// ============================================================================
// Benchmark Runner
// ============================================================================

export async function runOolongBenchmark(
  options: OolongBenchmarkOptions
): Promise<OolongBenchmarkResult> {
  const { rlm, tasks, outputDir, verbose } = options;
  const results: BenchmarkResult[] = [];
  
  const log = verbose ? console.log : () => {};
  
  log(`\n${"=".repeat(60)}`);
  log(`OOLONG Benchmark - ${tasks.length} tasks`);
  log(`${"=".repeat(60)}\n`);

  for (const task of tasks) {
    log(`\n[${task.id}] ${task.name}`);
    log(`  Category: ${task.category}`);
    log(`  Context: ${Math.round(task.contextLength / 1000)}k chars`);
    log(`  Query: ${task.query.slice(0, 60)}...`);
    
    const startTime = Date.now();
    
    try {
      const rlmResult = await rlm.completion(task.context, {
        rootPrompt: task.query,
      });
      
      const answer = rlmResult.answer;
      
      // Smart validation: for multi-needle tasks, check each fact individually
      let correct: boolean | undefined;
      if (task.expectedAnswer) {
        if (task.category === "multi-needle") {
          // For multi-needle: check if ALL individual facts are present (order-independent)
          const expectedFacts = task.expectedAnswer.split(", ");
          const answerLower = answer.toLowerCase();
          correct = expectedFacts.every(fact => {
            // Check if the key parts of each fact are present
            // Expected format: "red elephant: 123"
            const parts = fact.toLowerCase().split(": ");
            if (parts.length === 2) {
              const [animal, number] = parts;
              // Check if both the animal description and number appear in answer
              return answerLower.includes(animal!) && answerLower.includes(number!);
            }
            return answerLower.includes(fact.toLowerCase());
          });
        } else {
          // For other tasks: simple substring match
          correct = answer.toLowerCase().includes(task.expectedAnswer.toLowerCase());
        }
      }
      
      const result: BenchmarkResult = {
        taskId: task.id,
        implementation: "rlm-ts",
        answer,
        usage: rlmResult.usage,
        correct,
      };
      
      results.push(result);
      
      log(`  Answer: ${answer.slice(0, 100)}${answer.length > 100 ? "..." : ""}`);
      log(`  Expected: ${task.expectedAnswer ?? "N/A"}`);
      log(`  Correct: ${correct ?? "N/A"}`);
      log(`  Time: ${rlmResult.usage.executionTimeMs}ms`);
      log(`  Iterations: ${rlmResult.iterations}`);
      log(`  Tokens: ${rlmResult.usage.tokenUsage.totalTokens}`);
    } catch (error) {
      log(`  ERROR: ${error}`);
      
      results.push({
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
      });
    }
  }
  
  // Calculate summary
  const correctCount = results.filter(r => r.correct).length;
  const avgTime = results.reduce((sum, r) => sum + r.usage.executionTimeMs, 0) / results.length;
  const totalTokens = results.reduce((sum, r) => sum + r.usage.tokenUsage.totalTokens, 0);
  
  const byCategory: Record<string, { correct: number; total: number; accuracy: number }> = {};
  for (const task of tasks) {
    if (!byCategory[task.category]) {
      byCategory[task.category] = { correct: 0, total: 0, accuracy: 0 };
    }
    byCategory[task.category]!.total++;
    
    const result = results.find(r => r.taskId === task.id);
    if (result?.correct) {
      byCategory[task.category]!.correct++;
    }
  }
  
  for (const cat of Object.keys(byCategory)) {
    byCategory[cat]!.accuracy = byCategory[cat]!.correct / byCategory[cat]!.total;
  }
  
  const summary = {
    total: tasks.length,
    correct: correctCount,
    accuracy: correctCount / tasks.length,
    avgTimeMs: avgTime,
    avgIterations: results.reduce((sum, r) => sum + (r.usage.totalCalls - r.usage.subCalls), 0) / results.length,
    totalTokens,
    byCategory,
  };
  
  log(`\n${"=".repeat(60)}`);
  log(`SUMMARY`);
  log(`${"=".repeat(60)}`);
  log(`Total tasks: ${summary.total}`);
  log(`Correct: ${summary.correct} (${(summary.accuracy * 100).toFixed(1)}%)`);
  log(`Average time: ${summary.avgTimeMs.toFixed(0)}ms`);
  log(`Total tokens: ${summary.totalTokens}`);
  log(`\nBy category:`);
  for (const [cat, stats] of Object.entries(summary.byCategory)) {
    log(`  ${cat}: ${stats.correct}/${stats.total} (${(stats.accuracy * 100).toFixed(1)}%)`);
  }
  
  const benchmarkResult: OolongBenchmarkResult = { tasks, results, summary };
  
  if (outputDir) {
    if (!existsSync(outputDir)) {
      mkdirSync(outputDir, { recursive: true });
    }
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    writeFileSync(
      join(outputDir, `oolong-${timestamp}.json`),
      JSON.stringify(benchmarkResult, null, 2)
    );
    log(`\nResults saved to ${outputDir}/oolong-${timestamp}.json`);
  }
  
  return benchmarkResult;
}

