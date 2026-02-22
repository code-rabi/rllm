/**
 * RLM - Recursive Language Model
 * 
 * Code execution mode (like Python RLM) - LLM writes JS code, runs in V8 isolate
 */

import type { ZodType } from "zod";
import { LLMClient, type LLMClientOptions } from "./llm-client.js";
import { Sandbox, type SandboxResult } from "./sandbox.js";
import { findCodeBlocks, formatIteration, formatExecutionResult } from "./parsing.js";
import type { FinalAnswer } from "./sandbox.js";
import { RLM_SYSTEM_PROMPT, buildSystemPrompt, buildUserPrompt, zodSchemaToTypeDescription } from "./prompts.js";
import type { ChatMessage, TokenUsage, RLMResult, RLMTraceEntry, RLMEventCallback, RLMEvent } from "./types.js";

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

export interface CompletionOptions<TContext = string> {
  /** 
   * The context data available to LLM-generated code.
   * Can be a string or any structured data.
   */
  context?: TContext;
  
  /**
   * Zod schema describing the context structure.
   * When provided, the LLM receives type information about the context,
   * enabling it to write better code that understands the data structure.
   */
  contextSchema?: ZodType<TContext>;

  /**
   * Callback for real-time events during execution.
   * Useful for visualizing LLM queries and code execution.
   */
  onEvent?: RLMEventCallback;
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
export class RLLM {
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
   * 
   * @param prompt - The main question or task for the LLM
   * @param options - Options including context data and optional schema
   */
  async completion<TContext = string>(
    prompt: string,
    options: CompletionOptions<TContext> = {}
  ): Promise<RLMResult> {
    const startTime = Date.now();
    const trace: RLMTraceEntry[] = [];

    const context = options.context ?? ("" as unknown as TContext);
    
    // Create sandbox for this completion
    const sandbox = new Sandbox(this.client, this.systemPrompt);
    sandbox.loadContext(context);

    // Build initial message history with context metadata
    const contextStr = typeof context === "string" ? context : JSON.stringify(context);
    const contextType = typeof context === "string" ? "string" : 
                        Array.isArray(context) ? "array" : "object";
    
    // Generate type description from Zod schema if provided
    const schemaDescription = options.contextSchema 
      ? zodSchemaToTypeDescription(options.contextSchema)
      : null;
    
    let messageHistory = buildSystemPrompt(
      this.systemPrompt,
      [contextStr.length],
      contextStr.length,
      contextType,
      schemaDescription
    ) as ChatMessage[];

    let iterations = 0;
    let totalUsage: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

    const emit = (event: Omit<RLMEvent, 'timestamp'>) => {
      options.onEvent?.({ ...event, timestamp: Date.now() });
    };

    for (let i = 0; i < this.config.maxIterations!; i++) {
      iterations = i + 1;

      // Build current prompt
      const userPrompt = buildUserPrompt(prompt, i);
      const currentMessages = [...messageHistory, userPrompt];

      // Query LLM
      this.log(`Iteration ${i + 1}: Querying LLM...`);
      emit({ type: 'iteration_start', iteration: i + 1 });
      
      // Get the last user message as prompt (truncated for UI)
      const lastUserMsg = currentMessages[currentMessages.length - 1]?.content || '';
      emit({ 
        type: 'llm_query_start', 
        iteration: i + 1,
        prompt: lastUserMsg.length > 2000 ? lastUserMsg.slice(0, 2000) + '...' : lastUserMsg
      });
      
      const llmResult = await this.client.complete({ messages: currentMessages });
      
      emit({ type: 'llm_query_end', iteration: i + 1, response: llmResult.message.content });
      
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

      // Find and execute code blocks
      const codeBlockStrs = findCodeBlocks(response);
      const codeBlocks: CodeBlock[] = [];

      for (const code of codeBlockStrs) {
        this.log(`Executing code block...`);
        emit({ type: 'code_execution_start', iteration: i + 1, code });
        
        trace.push({
          type: "tool_call",
          timestamp: Date.now(),
          data: { codeLength: code.length },
        });

        const result = await sandbox.execute(code);
        codeBlocks.push({ code, result });
        
        // Format the result as the LLM will see it
        const formattedOutput = formatExecutionResult(result);
        
        emit({ 
          type: 'code_execution_end', 
          iteration: i + 1, 
          code,
          output: formattedOutput,
          error: result.error 
        });

        trace.push({
          type: "tool_result",
          timestamp: Date.now(),
          data: {
            hasOutput: result.stdout.length > 0,
            hasError: !!result.error,
            llmCalls: result.llmCalls.length,
          },
        });

        // Check if giveFinalAnswer() was called
        const finalAnswer = sandbox.getFinalAnswer();
        if (finalAnswer) {
          this.log(`Final answer set via giveFinalAnswer() at iteration ${i + 1}`);
          emit({ type: 'final_answer', iteration: i + 1, answer: finalAnswer.message });

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
      content: "You've reached the maximum iterations. Please provide your best final answer now using giveFinalAnswer({ message: 'your answer', data: optionalData }).",
    };
    
    const finalResult = await this.client.complete({
      messages: [...messageHistory, finalPrompt],
    });

    totalUsage.promptTokens += finalResult.usage.promptTokens;
    totalUsage.completionTokens += finalResult.usage.completionTokens;
    totalUsage.totalTokens += finalResult.usage.totalTokens;

    // Execute any code blocks in the final response
    const finalCodeBlocks = findCodeBlocks(finalResult.message.content);
    for (const code of finalCodeBlocks) {
      await sandbox.execute(code);
    }

    // Check if giveFinalAnswer() was called
    const finalAnswer = sandbox.getFinalAnswer();
    if (finalAnswer) {
      return {
        answer: finalAnswer,
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

    // Fallback: return the raw response as the answer
    return {
      answer: { message: finalResult.message.content, data: undefined },
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
 * Create an RLLM instance with sensible defaults
 */
export function createRLLM(options: {
  model?: string;
  provider?: "openai" | "anthropic" | "gemini" | "openrouter" | "cerebras" | "custom";
  apiKey?: string;
  baseUrl?: string;
  verbose?: boolean;
}): RLLM {
  return new RLLM({
    client: {
      provider: options.provider ?? "openai",
      model: options.model ?? "gpt-4o-mini",
      apiKey: options.apiKey,
      baseUrl: options.baseUrl,
    },
    verbose: options.verbose,
  });
}
