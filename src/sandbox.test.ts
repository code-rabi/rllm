/**
 * Sandbox tests - error handling and execution
 */

import { describe, it, expect, vi } from "vitest";
import { Sandbox } from "./sandbox.js";
import type { LLMClient } from "./llm-client.js";

// Mock LLM client for testing
const mockClient = {
  complete: vi.fn().mockResolvedValue({
    message: { role: "assistant", content: "mocked response" },
    usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
  }),
} as unknown as LLMClient;

describe("Sandbox", () => {
  describe("error handling", () => {
    it("catches runtime errors and reports in stderr", async () => {
      const sandbox = new Sandbox(mockClient);
      sandbox.loadContext({ name: "test" });

      // Code that will throw a TypeError
      const result = await sandbox.execute(`
        const data = context.nonExistent.map(x => x);
      `);

      // Error should be in stderr with helpful message
      expect(result.stderr).toContain("TypeError");
      expect(result.stderr).toContain("Please fix the error");
    });

    it("catches undefined variable errors", async () => {
      const sandbox = new Sandbox(mockClient);
      sandbox.loadContext("test");

      const result = await sandbox.execute(`
        const x = undefinedVariable + 1;
      `);

      expect(result.stderr).toContain("ReferenceError");
    });

    it("successfully executes valid code with output", async () => {
      const sandbox = new Sandbox(mockClient);
      sandbox.loadContext({ items: [1, 2, 3, 4, 5] });

      const result = await sandbox.execute(`
        const total = context.items.reduce((a, b) => a + b, 0);
        const average = total / context.items.length;
        print("Average:", average);
      `);

      expect(result.error).toBeUndefined();
      expect(result.stdout).toContain("Average: 3");
    });
  });

  describe("context loading", () => {
    it("loads string context", async () => {
      const sandbox = new Sandbox(mockClient);
      sandbox.loadContext("Hello, world!");

      const result = await sandbox.execute(`
        print(context.length);
      `);

      expect(result.stdout).toBe("13");
    });

    it("loads object context", async () => {
      const sandbox = new Sandbox(mockClient);
      sandbox.loadContext({ name: "Test", value: 42 });

      const result = await sandbox.execute(`
        print(context.name, context.value);
      `);

      expect(result.stdout).toBe("Test 42");
    });

    it("loads array context", async () => {
      const sandbox = new Sandbox(mockClient);
      sandbox.loadContext([{ id: 1 }, { id: 2 }, { id: 3 }]);

      const result = await sandbox.execute(`
        const ids = context.map(item => item.id);
        print(ids.join(","));
      `);

      expect(result.stdout).toBe("1,2,3");
    });
  });

  describe("FINAL answer", () => {
    it("captures FINAL answer with string", async () => {
      const sandbox = new Sandbox(mockClient);
      sandbox.loadContext("test");

      await sandbox.execute(`
        FINAL("The answer is 42");
      `);

      expect(sandbox.getFinalAnswer()).toBe("The answer is 42");
    });

    it("captures FINAL answer from expression", async () => {
      const sandbox = new Sandbox(mockClient);
      sandbox.loadContext([1, 2, 3, 4, 5]);

      await sandbox.execute(`
        const sum = context.reduce((a, b) => a + b, 0);
        FINAL("Sum is " + sum);
      `);

      expect(sandbox.getFinalAnswer()).toBe("Sum is 15");
    });
  });

  describe("does not crash on errors", () => {
    it("continues execution after error", async () => {
      const sandbox = new Sandbox(mockClient);
      sandbox.loadContext("test");

      // First execution with error
      const result1 = await sandbox.execute(`
        const x = badVar.something;
      `);
      expect(result1.stderr).toContain("ReferenceError");

      // Second execution should still work
      const result2 = await sandbox.execute(`
        print("Still working!");
      `);
      expect(result2.stdout).toBe("Still working!");
    });
  });
});
