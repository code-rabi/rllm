/**
 * RLM - Recursive Language Model
 * 
 * Code execution mode (like Python RLM) - LLM writes JS code, runs in V8 isolate
 */

import { LLMClient, type LLMClientOptions } from "./llm-client.js";
import { Sandbox, type SandboxResult } from "./sandbox.js";
import { findCodeBlocks, findFinalAnswer, formatIteration } from "./parsing.js";
import { RLM_SYSTEM_PROMPT, buildSystemPrompt, buildUserPrompt } from "./prompts.js";
import type { ChatMessage, TokenUsage, RLMResult, RLMTraceEntry } from "./types.js";

// ============================================================================
// Configuration
// ============================================================================

export interface RLMConfig {
  /** LLM client configuration */
  client: LLMClientOptions;
  /** Maximum iterations for code execution (default: 30) */
  maxIterations?: number;
  /** Custom system prompt (replaces default) */
  systemPrompt?: string;
  /** Enable verbose logging */
  verbose?: boolean;
}

export interface CompletionOptions {
  /** Root prompt shown to LLM each iteration (the main question) */
  rootPrompt?: string;
}

export interface CodeBlock {
  code: string;
  result: SandboxResult;
}

export interface RLMIteration {
  response: string;
  codeBlocks: CodeBlock[];
  finalAnswer: string | null;
  iterationTimeMs: number;
}

// ============================================================================
// RLM Class
// ============================================================================

/**
 * Recursive Language Model
 * 
 * LLM writes JavaScript code that runs in a V8 isolate (like Python RLM).
 * The LLM can recursively call itself or other LLMs via llm_query().
 */
export class RLM {
  private client: LLMClient;
  private config: RLMConfig;
  private systemPrompt: string;

  constructor(config: RLMConfig) {
    this.config = {
      maxIterations: 30,
      ...config,
    };
    this.client = new LLMClient(config.client);
    this.systemPrompt = config.systemPrompt ?? RLM_SYSTEM_PROMPT;
  }

  private log(...args: unknown[]): void {
    if (this.config.verbose) {
      console.log("[RLM]", ...args);
    }
  }

  // ==========================================================================
  // Code Execution Mode (Full RLM)
  // ==========================================================================

  /**
   * Full RLM completion - LLM writes code that runs in V8 isolate
   * 
   * This is the main RLM paradigm where the LLM can:
   * - Write arbitrary JavaScript code
   * - Query sub-LLMs via llm_query()
   * - Iterate until it finds an answer
   */
  async completion(
    context: string | unknown,
    options: CompletionOptions = {}
  ): Promise<RLMResult> {
    const startTime = Date.now();
    const trace: RLMTraceEntry[] = [];

    // Create sandbox for this completion
    const sandbox = new Sandbox(this.client, this.systemPrompt);
    sandbox.loadContext(context);

    // Build initial message history with context metadata
    const contextStr = typeof context === "string" ? context : JSON.stringify(context);
    const contextType = typeof context === "string" ? "string" : 
                        Array.isArray(context) ? "array" : "object";
    
    let messageHistory = buildSystemPrompt(
      this.systemPrompt,
      [contextStr.length],
      contextStr.length,
      contextType
    ) as ChatMessage[];

    let iterations = 0;
    let totalUsage: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

    for (let i = 0; i < this.config.maxIterations!; i++) {
      iterations = i + 1;

      // Build current prompt
      const userPrompt = buildUserPrompt(options.rootPrompt ?? null, i);
      const currentMessages = [...messageHistory, userPrompt];

      // Query LLM
      this.log(`Iteration ${i + 1}: Querying LLM...`);
      const llmResult = await this.client.complete({ messages: currentMessages });
      
      totalUsage.promptTokens += llmResult.usage.promptTokens;
      totalUsage.completionTokens += llmResult.usage.completionTokens;
      totalUsage.totalTokens += llmResult.usage.totalTokens;

      trace.push({
        type: "llm_call",
        timestamp: Date.now(),
        data: {
          iteration: i + 1,
          promptLength: currentMessages.map(m => m.content).join("").length,
          responseLength: llmResult.message.content.length,
        },
      });

      const response = llmResult.message.content;

      // Check for final answer in response
      const finalAnswerMatch = findFinalAnswer(response);
      if (finalAnswerMatch) {
        const [type, content] = finalAnswerMatch;
        let finalAnswer: string;

        if (type === "FINAL_VAR") {
          const varValue = sandbox.getLocal(content);
          finalAnswer = varValue !== undefined ? String(varValue) : `Error: Variable '${content}' not found`;
        } else {
          finalAnswer = content;
        }

        this.log(`Final answer found at iteration ${i + 1}`);

        return {
          answer: finalAnswer,
          usage: {
            totalCalls: iterations + sandbox.getLLMCalls().length,
            rootCalls: iterations,
            subCalls: sandbox.getLLMCalls().length,
            tokenUsage: this.addUsage(totalUsage, sandbox.getTotalUsage()),
            executionTimeMs: Date.now() - startTime,
          },
          iterations,
          trace,
        };
      }

      // Find and execute code blocks
      const codeBlockStrs = findCodeBlocks(response);
      const codeBlocks: CodeBlock[] = [];

      for (const code of codeBlockStrs) {
        this.log(`Executing code block...`);
        
        trace.push({
          type: "tool_call",
          timestamp: Date.now(),
          data: { codeLength: code.length },
        });

        const result = await sandbox.execute(code);
        codeBlocks.push({ code, result });

        trace.push({
          type: "tool_result",
          timestamp: Date.now(),
          data: {
            hasOutput: result.stdout.length > 0,
            hasError: !!result.error,
            llmCalls: result.llmCalls.length,
          },
        });

        // Check if code set a final answer
        const sandboxFinal = sandbox.getFinalAnswer();
        if (sandboxFinal) {
          this.log(`Final answer set via code at iteration ${i + 1}`);

          return {
            answer: sandboxFinal,
            usage: {
              totalCalls: iterations + sandbox.getLLMCalls().length,
              rootCalls: iterations,
              subCalls: sandbox.getLLMCalls().length,
              tokenUsage: this.addUsage(totalUsage, sandbox.getTotalUsage()),
              executionTimeMs: Date.now() - startTime,
            },
            iterations,
            trace,
          };
        }
      }

      // Format iteration and add to history
      const newMessages = formatIteration(response, codeBlocks);
      messageHistory = [...messageHistory, ...newMessages] as ChatMessage[];

      this.log(`Iteration ${i + 1} complete: ${codeBlocks.length} code blocks executed`);
    }

    // Ran out of iterations - ask for final answer
    this.log("Max iterations reached, requesting final answer...");
    
    const finalPrompt: ChatMessage = {
      role: "user",
      content: "You've reached the maximum iterations. Please provide your best final answer now using FINAL(your answer).",
    };
    
    const finalResult = await this.client.complete({
      messages: [...messageHistory, finalPrompt],
    });

    totalUsage.promptTokens += finalResult.usage.promptTokens;
    totalUsage.completionTokens += finalResult.usage.completionTokens;
    totalUsage.totalTokens += finalResult.usage.totalTokens;

    const finalMatch = findFinalAnswer(finalResult.message.content);
    const answer = finalMatch ? finalMatch[1] : finalResult.message.content;

    return {
      answer,
      usage: {
        totalCalls: iterations + 1 + sandbox.getLLMCalls().length,
        rootCalls: iterations + 1,
        subCalls: sandbox.getLLMCalls().length,
        tokenUsage: this.addUsage(totalUsage, sandbox.getTotalUsage()),
        executionTimeMs: Date.now() - startTime,
      },
      iterations: iterations + 1,
      trace,
    };
  }

  private addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
    return {
      promptTokens: a.promptTokens + b.promptTokens,
      completionTokens: a.completionTokens + b.completionTokens,
      totalTokens: a.totalTokens + b.totalTokens,
    };
  }

  /**
   * Direct chat with the LLM
   */
  async chat(messages: ChatMessage[]): Promise<string> {
    return this.client.chat(messages);
  }

  /**
   * Get the underlying LLM client
   */
  getClient(): LLMClient {
    return this.client;
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create an RLM instance with sensible defaults
 */
export function createRLM(options: {
  model?: string;
  provider?: "openai" | "anthropic" | "openrouter";
  apiKey?: string;
  verbose?: boolean;
}): RLM {
  return new RLM({
    client: {
      provider: options.provider ?? "openai",
      model: options.model ?? "gpt-4o-mini",
      apiKey: options.apiKey,
    },
    verbose: options.verbose,
  });
}
