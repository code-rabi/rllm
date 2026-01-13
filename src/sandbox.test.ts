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
    it("catches runtime errors gracefully", async () => {
      const sandbox = new Sandbox(mockClient);
      sandbox.loadContext({ name: "test" });

      // Code that will throw a TypeError - should not crash the sandbox
      const result = await sandbox.execute(`
        const data = context.nonExistent.map(x => x);
      `);

      // Execution should complete without crashing
      expect(result.executionTimeMs).toBeGreaterThan(0);
    });

    it("catches undefined variable errors gracefully", async () => {
      const sandbox = new Sandbox(mockClient);
      sandbox.loadContext("test");

      const result = await sandbox.execute(`
        const x = undefinedVariable + 1;
      `);

      // Execution should complete without crashing
      expect(result.executionTimeMs).toBeGreaterThan(0);
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

  describe("giveFinalAnswer callback", () => {
    it("captures giveFinalAnswer with message only", async () => {
      const sandbox = new Sandbox(mockClient);
      sandbox.loadContext("test");

      await sandbox.execute(`
        giveFinalAnswer({ message: "The answer is 42" });
      `);

      const answer = sandbox.getFinalAnswer();
      expect(answer).not.toBeNull();
      expect(answer!.message).toBe("The answer is 42");
      expect(answer!.data).toBeUndefined();
    });

    it("captures giveFinalAnswer with message and data", async () => {
      const sandbox = new Sandbox(mockClient);
      sandbox.loadContext([1, 2, 3, 4, 5]);

      await sandbox.execute(`
        const sum = context.reduce((a, b) => a + b, 0);
        giveFinalAnswer({ 
          message: "Sum is " + sum,
          data: { sum, items: context }
        });
      `);

      const answer = sandbox.getFinalAnswer();
      expect(answer).not.toBeNull();
      expect(answer!.message).toBe("Sum is 15");
      expect(answer!.data).toEqual({ sum: 15, items: [1, 2, 3, 4, 5] });
    });

    it("validates giveFinalAnswer requires message property", async () => {
      const sandbox = new Sandbox(mockClient);
      sandbox.loadContext("test");

      await sandbox.execute(`
        giveFinalAnswer({ data: "wrong format" });
      `);

      // Should NOT set final answer because message is required
      expect(sandbox.getFinalAnswer()).toBeNull();
    });

    it("validates giveFinalAnswer message must be string", async () => {
      const sandbox = new Sandbox(mockClient);
      sandbox.loadContext("test");

      await sandbox.execute(`
        giveFinalAnswer({ message: 123 });
      `);

      // Should NOT set final answer because message must be string
      expect(sandbox.getFinalAnswer()).toBeNull();
    });

    it("persists final answer across executions", async () => {
      const sandbox = new Sandbox(mockClient);
      sandbox.loadContext("test");

      await sandbox.execute(`
        giveFinalAnswer({ message: "First answer" });
      `);

      // Execute more code
      await sandbox.execute(`
        const x = 1 + 1;
      `);

      // Final answer should still be there
      const answer = sandbox.getFinalAnswer();
      expect(answer).not.toBeNull();
      expect(answer!.message).toBe("First answer");
    });
  });

  describe("does not crash on errors", () => {
    it("continues execution after error", async () => {
      const sandbox = new Sandbox(mockClient);
      sandbox.loadContext("test");

      // First execution with error - should not crash
      await sandbox.execute(`
        const x = badVar.something;
      `);

      // Second execution should still work
      const result2 = await sandbox.execute(`
        print("Still working!");
      `);
      expect(result2.stdout).toBe("Still working!");
    });
  });
});
