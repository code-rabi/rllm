/**
 * Core types for RLM (Recursive Language Models)
 */

import type { ZodType } from "zod";

// ============================================================================
// Context Schema Types
// ============================================================================

/**
 * A Zod schema that defines the structure of context data.
 * Used to provide type information to both TypeScript and the LLM.
 */
export type ContextSchema<T = unknown> = ZodType<T>;

/**
 * Infer the type from a context schema
 */
export type InferContextType<S> = S extends ZodType<infer T> ? T : string;

// ============================================================================
// LLM Client Types
// ============================================================================

export type LLMProvider = "openai" | "anthropic" | "gemini" | "openrouter" | "cerebras" | "custom";

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
}

export interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, {
        type: string;
        description: string;
        items?: { type: string };
        enum?: string[];
      }>;
      required: string[];
    };
  };
}

// ============================================================================
// Usage Tracking
// ============================================================================

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface RLMUsage {
  totalCalls: number;
  rootCalls: number;
  subCalls: number;
  tokenUsage: TokenUsage;
  executionTimeMs: number;
}

// ============================================================================
// RLM Result Types
// ============================================================================

export interface RLMResult {
  answer: {
    message: string;
    data?: unknown;
  };
  usage: RLMUsage;
  iterations: number;
  trace: RLMTraceEntry[];
}

export interface RLMTraceEntry {
  type: "llm_call" | "tool_call" | "tool_result";
  timestamp: number;
  data: Record<string, unknown>;
}

// ============================================================================
// Real-time Event Types
// ============================================================================

export type RLMEventType = 
  | "iteration_start"
  | "llm_query_start"
  | "llm_query_end"
  | "code_execution_start"
  | "code_execution_end"
  | "final_answer";

export interface RLMEvent {
  type: RLMEventType;
  timestamp: number;
  iteration?: number;
  code?: string;
  response?: string;
  output?: string;
  answer?: string;
  error?: string;
  prompt?: string;
}

export type RLMEventCallback = (event: RLMEvent) => void;

// ============================================================================
// Chunking Types
// ============================================================================

export interface ChunkOptions {
  /** Target size per chunk in characters */
  chunkSize: number;
  /** Overlap between chunks in characters */
  overlap?: number;
  /** Split on these delimiters (in priority order) */
  delimiters?: string[];
}
