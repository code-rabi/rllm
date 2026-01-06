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

export type LLMProvider = "openai" | "anthropic" | "openrouter" | "custom";

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

export interface RLMResult<T = string> {
  answer: T;
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
