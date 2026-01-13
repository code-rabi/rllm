/**
 * Unified LLM client with tool calling support
 */

import OpenAI from "openai";
import type {
  ChatMessage,
  ToolDefinition,
  TokenUsage,
  LLMProvider,
} from "./types.js";

export interface LLMClientOptions {
  provider: LLMProvider;
  model: string;
  apiKey?: string;
  baseUrl?: string;
}

export interface CompletionOptions {
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  temperature?: number;
  maxTokens?: number;
}

export interface CompletionResult {
  message: ChatMessage;
  usage: TokenUsage;
  finishReason: string;
}

/**
 * Unified LLM client that abstracts over different providers
 */
export class LLMClient {
  private client: OpenAI;
  private model: string;
  private provider: LLMProvider;

  constructor(options: LLMClientOptions) {
    this.model = options.model;
    this.provider = options.provider;

    // Validate: custom provider requires baseUrl
    if (options.provider === "custom" && !options.baseUrl) {
      throw new Error("Custom provider requires a baseUrl to be specified");
    }

    const apiKey = options.apiKey ?? this.getDefaultApiKey(options.provider);
    const baseUrl = options.baseUrl ?? this.getDefaultBaseUrl(options.provider);

    this.client = new OpenAI({ apiKey, baseURL: baseUrl });
  }

  private getDefaultApiKey(provider: LLMProvider): string | undefined {
    switch (provider) {
      case "openai":
        return process.env["OPENAI_API_KEY"];
      case "anthropic":
        return process.env["ANTHROPIC_API_KEY"];
      case "gemini":
        return process.env["GEMINI_API_KEY"] ?? process.env["GOOGLE_API_KEY"];
      case "openrouter":
        return process.env["OPENROUTER_API_KEY"];
      case "custom":
        return undefined; // Must be provided explicitly
    }
  }

  private getDefaultBaseUrl(provider: LLMProvider): string | undefined {
    switch (provider) {
      case "openai":
        return undefined; // Uses default
      case "anthropic":
        return "https://api.anthropic.com/v1";
      case "gemini":
        return "https://generativelanguage.googleapis.com/v1beta/openai/";
      case "openrouter":
        return "https://openrouter.ai/api/v1";
      case "custom":
        return undefined; // Must be provided explicitly (validated in constructor)
    }
  }

  /**
   * Check if model supports temperature parameter
   */
  private supportsTemperature(): boolean {
    // Models that don't support temperature (reasoning models, newer models)
    const noTempPatterns = ['o1', 'o3', 'gpt-5'];
    return !noTempPatterns.some(p => this.model.includes(p));
  }

  /**
   * Create a chat completion with optional tool calling
   */
  async complete(options: CompletionOptions): Promise<CompletionResult> {
    const requestParams: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming = {
      model: this.model,
      messages: options.messages as OpenAI.Chat.Completions.ChatCompletionMessageParam[],
      tools: options.tools as OpenAI.Chat.Completions.ChatCompletionTool[] | undefined,
      max_tokens: options.maxTokens,
    };

    // Only add temperature for models that support it
    if (this.supportsTemperature()) {
      requestParams.temperature = options.temperature ?? 0.7;
    }

    let response: OpenAI.Chat.Completions.ChatCompletion;
    try {
      response = await this.client.chat.completions.create(requestParams);
    } catch (error: unknown) {
      // Log context for debugging, then propagate the original error
      const err = error as Error & { status?: number; response?: { data?: unknown } };
      const status = err.status ?? (error as { statusCode?: number }).statusCode;
      console.error(`[LLMClient] API error (${this.provider}/${this.model}): status=${status}`, error);
      throw error;
    }

    const choice = response.choices[0]!
    const message: ChatMessage = {
      role: "assistant",
      content: choice.message.content ?? "",
      tool_calls: choice.message.tool_calls?.map((tc) => ({
        id: tc.id,
        type: "function" as const,
        function: {
          name: tc.function.name,
          arguments: tc.function.arguments,
        },
      })),
    };

    return {
      message,
      usage: {
        promptTokens: response.usage?.prompt_tokens ?? 0,
        completionTokens: response.usage?.completion_tokens ?? 0,
        totalTokens: response.usage?.total_tokens ?? 0,
      },
      finishReason: choice.finish_reason,
    };
  }

  /**
   * Simple text completion (no tools)
   */
  async chat(
    messages: ChatMessage[],
    options?: { temperature?: number; maxTokens?: number }
  ): Promise<string> {
    const result = await this.complete({
      messages,
      temperature: options?.temperature,
      maxTokens: options?.maxTokens,
    });
    return result.message.content;
  }
}

