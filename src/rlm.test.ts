import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { RLLM } from "./rlm.js";
import type { ChatMessage, TokenUsage } from "./types.js";

interface MockCompletionResponse {
  content: string;
  usage: TokenUsage;
}

function createTestRLLMWithMock(responses: MockCompletionResponse[]): {
  rllm: RLLM;
  completeMock: ReturnType<typeof vi.fn>;
} {
  const rllm = new RLLM({
    client: {
      provider: "openai",
      model: "gpt-4o-mini",
      apiKey: "test-key",
    },
  });

  const completeMock = vi.fn().mockImplementation(async () => {
    const next = responses.shift();
    if (!next) {
      throw new Error("No mock response configured");
    }
    return {
      message: { role: "assistant", content: next.content },
      usage: next.usage,
      finishReason: "stop",
    };
  });

  (
    rllm as unknown as {
      client: {
        complete: (options: { messages: ChatMessage[] }) => Promise<unknown>;
      };
    }
  ).client = { complete: completeMock };

  return { rllm, completeMock };
}

describe("RLLM.generateObject", () => {
  it("returns typed object on first valid attempt", async () => {
    const outputSchema = z.object({
      name: z.string(),
      count: z.number(),
    });
    const inputSchema = z.object({
      report: z.string(),
    });

    const { rllm } = createTestRLLMWithMock([
      {
        content: '{"name":"ok","count":3}',
        usage: { promptTokens: 11, completionTokens: 7, totalTokens: 18 },
      },
    ]);

    const result = await rllm.generateObject(
      "Generate object",
      {
        input: { report: "hello" },
        inputSchema,
        outputSchema,
      }
    );

    expect(result.object).toEqual({ name: "ok", count: 3 });
    expect(result.attempts).toBe(1);
    expect(result.rawResponse).toBe('{"name":"ok","count":3}');
    expect(result.usage.totalCalls).toBe(1);
    expect(result.usage.tokenUsage).toEqual({
      promptTokens: 11,
      completionTokens: 7,
      totalTokens: 18,
    });
  });

  it("retries after invalid JSON and succeeds", async () => {
    const outputSchema = z.object({
      city: z.string(),
    });
    const onRetry = vi.fn();

    const { rllm, completeMock } = createTestRLLMWithMock([
      {
        content: '{"city":"Tel Aviv"',
        usage: { promptTokens: 5, completionTokens: 4, totalTokens: 9 },
      },
      {
        content: '{"city":"Tel Aviv"}',
        usage: { promptTokens: 6, completionTokens: 4, totalTokens: 10 },
      },
    ]);

    const result = await rllm.generateObject("Return city", { outputSchema }, {
      maxRetries: 2,
      onRetry,
    });

    expect(result.object).toEqual({ city: "Tel Aviv" });
    expect(result.attempts).toBe(2);
    expect(result.usage.totalCalls).toBe(2);
    expect(result.usage.tokenUsage).toEqual({
      promptTokens: 11,
      completionTokens: 8,
      totalTokens: 19,
    });

    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry.mock.calls[0]?.[0].errorType).toBe("json_parse");
    expect(completeMock).toHaveBeenCalledTimes(2);
  });

  it("retries after schema mismatch and succeeds", async () => {
    const outputSchema = z.object({
      status: z.enum(["ok", "error"]),
      count: z.number(),
    });
    const onRetry = vi.fn();

    const { rllm } = createTestRLLMWithMock([
      {
        content: '{"status":"ok","count":"3"}',
        usage: { promptTokens: 8, completionTokens: 5, totalTokens: 13 },
      },
      {
        content: '{"status":"ok","count":3}',
        usage: { promptTokens: 9, completionTokens: 5, totalTokens: 14 },
      },
    ]);

    const result = await rllm.generateObject("Return status and count", { outputSchema }, {
      maxRetries: 2,
      onRetry,
    });

    expect(result.object).toEqual({ status: "ok", count: 3 });
    expect(result.attempts).toBe(2);
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry.mock.calls[0]?.[0].errorType).toBe("schema_validation");
    expect(onRetry.mock.calls[0]?.[0].validationIssues?.length).toBeGreaterThan(0);
  });

  it("throws actionable error after exhausting retries", async () => {
    const outputSchema = z.object({
      id: z.string(),
    });

    const { rllm } = createTestRLLMWithMock([
      {
        content: '{"id":123}',
        usage: { promptTokens: 3, completionTokens: 2, totalTokens: 5 },
      },
      {
        content: '{"id":456}',
        usage: { promptTokens: 3, completionTokens: 2, totalTokens: 5 },
      },
    ]);

    await expect(
      rllm.generateObject("Return id", { outputSchema }, { maxRetries: 1 })
    ).rejects.toThrow(/generateObject failed after 2 attempt/);
  });

  it("fails fast when input does not satisfy inputSchema", async () => {
    const outputSchema = z.object({ answer: z.string() });
    const inputSchema = z.object({ age: z.number() });
    const { rllm, completeMock } = createTestRLLMWithMock([
      {
        content: '{"answer":"ok"}',
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      },
    ]);

    await expect(
      rllm.generateObject("Use input", {
        input: { age: "not-a-number" } as unknown as { age: number },
        inputSchema,
        outputSchema,
      })
    ).rejects.toThrow(/input failed inputSchema validation/);

    expect(completeMock).toHaveBeenCalledTimes(0);
  });
});
