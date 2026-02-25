/**
 * RLM - Recursive Language Models (TypeScript)
 * 
 * Code execution mode implementation for processing large contexts with LLMs.
 * LLM writes JavaScript code that runs in V8 isolate (like Python RLM).
 */

// Core RLLM
export { RLLM, createRLLM, type RLMConfig, type CompletionOptions, type RLMIteration } from "./rlm.js";

// Sandbox
export { Sandbox, type SandboxResult, type SandboxOptions, type LLMCallRecord, type FinalAnswer } from "./sandbox.js";

// Chunking utilities
export {
  chunkText,
  chunkByLines,
  chunkByPattern,
  chunkMarkdownByHeaders,
  chunkToTokenBudget,
  estimateTokens,
} from "./chunking.js";

// Parsing utilities
export {
  findCodeBlocks,
  formatExecutionResult,
  formatIteration,
} from "./parsing.js";

// Prompts
export {
  RLM_SYSTEM_PROMPT,
  USER_PROMPT,
  USER_PROMPT_WITH_ROOT,
  buildSystemPrompt,
  buildUserPrompt,
  zodSchemaToTypeDescription,
} from "./prompts.js";

// LLM Client
export { LLMClient, type LLMClientOptions, type CompletionOptions as LLMCompletionOptions, type CompletionResult } from "./llm-client.js";

// Types
export type {
  LLMProvider,
  ChatMessage,
  ToolCall,
  ToolDefinition,
  TokenUsage,
  RLMUsage,
  RLMResult,
  RLMTraceEntry,
  ChunkOptions,
  ContextSchema,
  InferContextType,
  RLMEventType,
  RLMEvent,
  RLMEventCallback,
  GenerateObjectErrorType,
  GenerateObjectRetryEvent,
  GenerateObjectOptions,
  GenerateObjectSchemas,
  GenerateObjectUsage,
  GenerateObjectResult,
} from "./types.js";
