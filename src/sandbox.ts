/**
 * V8 Isolate Sandbox for RLM Code Execution
 * 
 * Runs LLM-generated code in a secure V8 isolate with injected bindings.
 * No TCP, no subprocess - just in-process isolation.
 */

import * as vm from "node:vm";
import type { LLMClient } from "./llm-client.js";
import type { ChatMessage, TokenUsage } from "./types.js";

// ============================================================================
// Types
// ============================================================================

export interface SandboxResult {
  stdout: string;
  stderr: string;
  locals: Record<string, unknown>;
  executionTimeMs: number;
  llmCalls: LLMCallRecord[];
  error?: string;
}

export interface LLMCallRecord {
  prompt: string;
  response: string;
  model?: string;
  usage: TokenUsage;
  durationMs: number;
}

export interface SandboxOptions {
  /** Timeout for code execution in ms (default: 300000 = 5 min) */
  timeout?: number;
  /** Additional globals to inject */
  extraGlobals?: Record<string, unknown>;
}

// ============================================================================
// Sandbox Class
// ============================================================================

/**
 * V8 Isolate Sandbox for executing LLM-generated code safely.
 * 
 * Provides these bindings to the code:
 * - `context` - The loaded context data
 * - `llm_query(prompt, model?)` - Query sub-LLM
 * - `llm_query_batched(prompts, model?)` - Batch query sub-LLMs
 * - `FINAL(answer)` - Return final answer
 * - `FINAL_VAR(varName)` - Return variable as final answer
 * - `print(...)` - Console output
 * - Basic JS builtins (Array, Object, Math, JSON, etc.)
 */
export class Sandbox {
  private client: LLMClient;
  private systemPrompt?: string;
  private context: unknown = null;
  private vmContext: vm.Context | null = null;
  
  // Execution state
  private stdout: string[] = [];
  private stderr: string[] = [];
  private locals: Record<string, unknown> = {};
  private llmCalls: LLMCallRecord[] = [];
  private finalAnswer: string | null = null;

  constructor(client: LLMClient, systemPrompt?: string) {
    this.client = client;
    this.systemPrompt = systemPrompt;
  }

  /**
   * Load context data into the sandbox
   */
  loadContext(contextPayload: unknown): void {
    this.context = contextPayload;
    if (this.vmContext) {
      this.vmContext["context"] = contextPayload;
    }
  }

  /**
   * Initialize the VM context with all bindings
   */
  private createContext(options: SandboxOptions = {}): vm.Context {
    // Reset state
    this.stdout = [];
    this.stderr = [];
    this.llmCalls = [];
    this.finalAnswer = null;

    const sandbox: Record<string, unknown> = {
      // ========== Console / Print ==========
      console: {
        log: (...args: unknown[]) => this.stdout.push(args.map(String).join(" ")),
        error: (...args: unknown[]) => this.stderr.push(args.map(String).join(" ")),
        warn: (...args: unknown[]) => this.stderr.push(args.map(String).join(" ")),
        info: (...args: unknown[]) => this.stdout.push(args.map(String).join(" ")),
      },
      print: (...args: unknown[]) => this.stdout.push(args.map(String).join(" ")),

      // ========== Context ==========
      context: this.context,

      // ========== LLM Query Bindings ==========
      llm_query: (prompt: string, model?: string) => this.llmQuery(prompt, model),
      llm_query_batched: (prompts: string[], model?: string) => this.llmQueryBatched(prompts, model),

      // ========== Final Answer ==========
      FINAL: (answer: unknown) => {
        this.finalAnswer = String(answer);
        return this.finalAnswer;
      },
      FINAL_VAR: (varName: string) => {
        const name = varName.trim().replace(/^["']|["']$/g, "");
        if (name in this.locals) {
          this.finalAnswer = String(this.locals[name]);
        } else {
          this.finalAnswer = `Error: Variable '${name}' not found`;
        }
        return this.finalAnswer;
      },

      // ========== Safe JS Builtins ==========
      JSON,
      Math,
      Date,
      Array,
      Object,
      String,
      Number,
      Boolean,
      Map,
      Set,
      WeakMap,
      WeakSet,
      Promise,
      RegExp,
      Error,
      TypeError,
      RangeError,
      SyntaxError,
      URIError,
      EvalError,
      ReferenceError,
      parseInt,
      parseFloat,
      isNaN,
      isFinite,
      encodeURI,
      decodeURI,
      encodeURIComponent,
      decodeURIComponent,
      Infinity,
      NaN,
      undefined,

      // ========== Async Support ==========
      setTimeout,
      setInterval,
      clearTimeout,
      clearInterval,
      setImmediate,
      clearImmediate,
      queueMicrotask,

      // ========== Useful Utilities ==========
      atob: (str: string) => Buffer.from(str, "base64").toString("utf-8"),
      btoa: (str: string) => Buffer.from(str, "utf-8").toString("base64"),

      // ========== Internal State Ref ==========
      __locals__: this.locals,

      // ========== Extra Globals ==========
      ...options.extraGlobals,
    };

    this.vmContext = vm.createContext(sandbox);
    return this.vmContext;
  }

  /**
   * Query sub-LLM (async binding for sandbox code)
   */
  private async llmQuery(prompt: string, model?: string): Promise<string> {
    const startTime = Date.now();
    
    const messages: ChatMessage[] = [];
    if (this.systemPrompt) {
      messages.push({ role: "system", content: this.systemPrompt });
    }
    messages.push({ role: "user", content: prompt });

    try {
      const result = await this.client.complete({ messages });
      const durationMs = Date.now() - startTime;

      this.llmCalls.push({
        prompt,
        response: result.message.content,
        model,
        usage: result.usage,
        durationMs,
      });

      return result.message.content;
    } catch (e) {
      return `Error: LLM query failed - ${e}`;
    }
  }

  /**
   * Batch query sub-LLMs (async binding for sandbox code)
   */
  private async llmQueryBatched(prompts: string[], model?: string): Promise<string[]> {
    const results = await Promise.all(
      prompts.map((prompt) => this.llmQuery(prompt, model))
    );
    return results;
  }

  /**
   * Execute code in the sandbox
   */
  async execute(code: string, options: SandboxOptions = {}): Promise<SandboxResult> {
    const timeout = options.timeout ?? 300000; // 5 min default
    const startTime = Date.now();

    // Create fresh context for this execution
    const context = this.createContext(options);

    try {
      // Wrap code to handle async, catch ALL errors, and capture variables
      // Errors in LLM code should NOT crash - they get reported back so LLM can fix
      // We use a two-level try/catch to ensure errors never escape
      const wrappedCode = `
        (async () => {
          let __userError__ = null;
          try {
            ${code}
          } catch (__e__) {
            __userError__ = __e__;
            // Report error to stderr so LLM can see and fix it
            console.error(__e__.name + ': ' + __e__.message);
            if (__e__.stack) {
              console.error(__e__.stack.split('\\n').slice(0, 3).join('\\n'));
            }
          }
          
          // Always try to capture variables, even after error
          try {
            const __capturedLocals__ = {};
            const __skipKeys__ = new Set([
              'console', 'print', 'context', 'llm_query', 'llm_query_batched', 
              'FINAL', 'FINAL_VAR', 'JSON', 'Math', 'Date', 'Array', 'Object',
              'String', 'Number', 'Boolean', 'Map', 'Set', 'Promise', 'RegExp',
              'Error', 'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval'
            ]);
            for (const key of Object.keys(this)) {
              if (!key.startsWith('__') && 
                  typeof this[key] !== 'function' &&
                  !__skipKeys__.has(key)) {
                try {
                  __capturedLocals__[key] = this[key];
                } catch {}
              }
            }
            Object.assign(__locals__, __capturedLocals__);
          } catch (__captureError__) {
            // Ignore errors during variable capture
            console.error('Warning: Failed to capture some variables');
          }
        })().catch(__finalError__ => {
          // Catch any unhandled promise rejections
          console.error('Unhandled error: ' + __finalError__.message);
        })
      `;

      const script = new vm.Script(wrappedCode, {
        filename: "rlm-sandbox.js",
      });

      const result = script.runInContext(context, { timeout });

      // If result is a promise, await it with error handling
      if (result instanceof Promise) {
        try {
          await result;
        } catch (promiseError) {
          // Promise rejection - capture error but don't crash
          const msg = promiseError instanceof Error 
            ? `${promiseError.name}: ${promiseError.message}` 
            : String(promiseError);
          this.stderr.push(msg);
        }
      }

      // Sync locals from context
      this.syncLocals(context);

      return {
        stdout: this.stdout.join("\n"),
        stderr: this.stderr.join("\n"),
        locals: { ...this.locals },
        executionTimeMs: Date.now() - startTime,
        llmCalls: [...this.llmCalls],
      };
    } catch (e) {
      const errorMessage = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
      
      return {
        stdout: this.stdout.join("\n"),
        stderr: this.stderr.join("\n") + (this.stderr.length ? "\n" : "") + errorMessage,
        locals: { ...this.locals },
        executionTimeMs: Date.now() - startTime,
        llmCalls: [...this.llmCalls],
        error: errorMessage,
      };
    }
  }

  /**
   * Sync variables from VM context to locals
   */
  private syncLocals(context: vm.Context): void {
    const skipKeys = new Set([
      "console", "print", "context", "llm_query", "llm_query_batched",
      "FINAL", "FINAL_VAR", "JSON", "Math", "Date", "Array", "Object",
      "String", "Number", "Boolean", "Map", "Set", "WeakMap", "WeakSet",
      "Promise", "RegExp", "Error", "TypeError", "RangeError", "SyntaxError",
      "URIError", "EvalError", "ReferenceError", "parseInt", "parseFloat",
      "isNaN", "isFinite", "encodeURI", "decodeURI", "encodeURIComponent",
      "decodeURIComponent", "Infinity", "NaN", "undefined", "setTimeout",
      "setInterval", "clearTimeout", "clearInterval", "setImmediate",
      "clearImmediate", "queueMicrotask", "atob", "btoa", "__locals__",
    ]);

    for (const key of Object.keys(context)) {
      if (!key.startsWith("__") && !skipKeys.has(key)) {
        this.locals[key] = context[key];
      }
    }
  }

  /**
   * Get the final answer if one was set via FINAL() or FINAL_VAR()
   */
  getFinalAnswer(): string | null {
    return this.finalAnswer;
  }

  /**
   * Get a local variable value
   */
  getLocal(name: string): unknown {
    return this.locals[name];
  }

  /**
   * Get all locals
   */
  getLocals(): Record<string, unknown> {
    return { ...this.locals };
  }

  /**
   * Get all LLM calls made during execution
   */
  getLLMCalls(): LLMCallRecord[] {
    return [...this.llmCalls];
  }

  /**
   * Get total token usage across all LLM calls
   */
  getTotalUsage(): TokenUsage {
    return this.llmCalls.reduce(
      (acc, call) => ({
        promptTokens: acc.promptTokens + call.usage.promptTokens,
        completionTokens: acc.completionTokens + call.usage.completionTokens,
        totalTokens: acc.totalTokens + call.usage.totalTokens,
      }),
      { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
    );
  }

  /**
   * Reset sandbox state (keeps context)
   */
  reset(): void {
    this.stdout = [];
    this.stderr = [];
    this.locals = {};
    this.llmCalls = [];
    this.finalAnswer = null;
    this.vmContext = null;
  }
}

