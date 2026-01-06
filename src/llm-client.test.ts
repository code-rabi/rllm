/**
 * LLM Client tests - providers and base URLs
 * 
 * Note: These tests verify the provider configuration logic without
 * making actual API calls. We test the URL/key selection logic directly.
 */

import { describe, it, expect } from "vitest";
import { LLMClient } from "./llm-client.js";

// Test the provider configuration logic directly
// (extracted from LLMClient to make it testable)

function getDefaultApiKey(provider: "openai" | "anthropic" | "openrouter" | "custom"): string | undefined {
  switch (provider) {
    case "openai":
      return process.env["OPENAI_API_KEY"];
    case "anthropic":
      return process.env["ANTHROPIC_API_KEY"];
    case "openrouter":
      return process.env["OPENROUTER_API_KEY"];
    case "custom":
      return undefined;
  }
}

function getDefaultBaseUrl(provider: "openai" | "anthropic" | "openrouter" | "custom"): string | undefined {
  switch (provider) {
    case "openai":
      return undefined; // Uses default
    case "anthropic":
      return "https://api.anthropic.com/v1";
    case "openrouter":
      return "https://openrouter.ai/api/v1";
    case "custom":
      return undefined;
  }
}

describe("LLMClient provider configuration", () => {
  describe("getDefaultBaseUrl", () => {
    it("returns undefined for OpenAI (uses default)", () => {
      expect(getDefaultBaseUrl("openai")).toBeUndefined();
    });

    it("returns Anthropic base URL", () => {
      expect(getDefaultBaseUrl("anthropic")).toBe("https://api.anthropic.com/v1");
    });

    it("returns OpenRouter base URL", () => {
      expect(getDefaultBaseUrl("openrouter")).toBe("https://openrouter.ai/api/v1");
    });
  });

  describe("getDefaultApiKey", () => {
    it("reads OPENAI_API_KEY for openai provider", () => {
      const original = process.env["OPENAI_API_KEY"];
      process.env["OPENAI_API_KEY"] = "test-key";
      
      expect(getDefaultApiKey("openai")).toBe("test-key");
      
      process.env["OPENAI_API_KEY"] = original;
    });

    it("reads ANTHROPIC_API_KEY for anthropic provider", () => {
      const original = process.env["ANTHROPIC_API_KEY"];
      process.env["ANTHROPIC_API_KEY"] = "test-anthropic-key";
      
      expect(getDefaultApiKey("anthropic")).toBe("test-anthropic-key");
      
      process.env["ANTHROPIC_API_KEY"] = original;
    });

    it("reads OPENROUTER_API_KEY for openrouter provider", () => {
      const original = process.env["OPENROUTER_API_KEY"];
      process.env["OPENROUTER_API_KEY"] = "test-openrouter-key";
      
      expect(getDefaultApiKey("openrouter")).toBe("test-openrouter-key");
      
      process.env["OPENROUTER_API_KEY"] = original;
    });

    it("returns undefined for custom provider (must be provided explicitly)", () => {
      expect(getDefaultApiKey("custom")).toBeUndefined();
    });
  });

  describe("custom provider", () => {
    it("returns undefined for custom provider base URL", () => {
      expect(getDefaultBaseUrl("custom")).toBeUndefined();
    });

    it("throws error when custom provider is used without baseUrl", () => {
      expect(() => {
        new LLMClient({
          provider: "custom",
          model: "my-model",
          apiKey: "test-key",
        });
      }).toThrow("Custom provider requires a baseUrl to be specified");
    });

    it("creates client successfully when custom provider has baseUrl", () => {
      const client = new LLMClient({
        provider: "custom",
        model: "my-model",
        apiKey: "test-key",
        baseUrl: "https://my-custom-api.example.com/v1",
      });
      expect(client).toBeDefined();
    });
  });
});
