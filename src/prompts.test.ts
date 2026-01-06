/**
 * Prompts tests - Zod schema to type description
 */

import { describe, it, expect } from "vitest";
import { z } from "zod";
import { zodSchemaToTypeDescription, buildSystemPrompt } from "./prompts.js";

describe("zodSchemaToTypeDescription", () => {
  it("converts primitive types", () => {
    expect(zodSchemaToTypeDescription(z.string())).toBe("string");
    expect(zodSchemaToTypeDescription(z.number())).toBe("number");
    expect(zodSchemaToTypeDescription(z.boolean())).toBe("boolean");
    expect(zodSchemaToTypeDescription(z.null())).toBe("null");
    expect(zodSchemaToTypeDescription(z.undefined())).toBe("undefined");
  });

  it("converts array types", () => {
    expect(zodSchemaToTypeDescription(z.array(z.string()))).toBe("string[]");
    expect(zodSchemaToTypeDescription(z.array(z.number()))).toBe("number[]");
  });

  it("converts object types", () => {
    const schema = z.object({
      name: z.string(),
      age: z.number(),
    });

    const result = zodSchemaToTypeDescription(schema);
    expect(result).toContain("name: string;");
    expect(result).toContain("age: number;");
  });

  it("converts nested object types", () => {
    const schema = z.object({
      user: z.object({
        id: z.string(),
        profile: z.object({
          email: z.string(),
        }),
      }),
    });

    const result = zodSchemaToTypeDescription(schema);
    expect(result).toContain("user:");
    expect(result).toContain("id: string;");
    expect(result).toContain("email: string;");
  });

  it("converts optional types", () => {
    const schema = z.object({
      required: z.string(),
      optional: z.string().optional(),
    });

    const result = zodSchemaToTypeDescription(schema);
    expect(result).toContain("required: string;");
    expect(result).toContain("optional?:");
  });

  it("converts enum types", () => {
    const schema = z.enum(["admin", "user", "guest"]);
    const result = zodSchemaToTypeDescription(schema);
    expect(result).toContain('"admin"');
    expect(result).toContain('"user"');
    expect(result).toContain('"guest"');
  });

  it("converts record types", () => {
    const schema = z.record(z.string(), z.number());
    const result = zodSchemaToTypeDescription(schema);
    expect(result).toContain("Record<");
    expect(result).toContain("string");
    expect(result).toContain("number");
  });

  it("converts union types", () => {
    const schema = z.union([z.string(), z.number()]);
    const result = zodSchemaToTypeDescription(schema);
    expect(result).toContain("string");
    expect(result).toContain("number");
    expect(result).toContain("|");
  });

  it("converts complex nested schema", () => {
    const schema = z.object({
      companyName: z.string(),
      quarters: z.array(z.object({
        quarter: z.enum(["Q1", "Q2", "Q3", "Q4"]),
        revenue: z.number(),
      })),
      employees: z.object({
        total: z.number(),
        departments: z.record(z.string(), z.number()),
      }),
    });

    const result = zodSchemaToTypeDescription(schema);
    expect(result).toContain("companyName: string;");
    expect(result).toContain("quarters:");
    expect(result).toContain("quarter:");
    expect(result).toContain('"Q1"');
    expect(result).toContain("revenue: number;");
    expect(result).toContain("employees:");
    expect(result).toContain("total: number;");
    expect(result).toContain("departments:");
  });
});

describe("buildSystemPrompt", () => {
  it("includes context metadata", () => {
    const result = buildSystemPrompt(
      "Test system prompt",
      [1000, 2000],
      3000,
      "array"
    );

    expect(result).toHaveLength(2);
    expect(result[0]!.role).toBe("system");
    expect(result[0]!.content).toBe("Test system prompt");
    expect(result[1]!.role).toBe("assistant");
    expect(result[1]!.content).toContain("array");
    expect(result[1]!.content).toContain("3000");
  });

  it("includes schema description when provided", () => {
    const result = buildSystemPrompt(
      "Test system prompt",
      [1000],
      1000,
      "object",
      "{ name: string; value: number; }"
    );

    expect(result[1]!.content).toContain("TypeScript type");
    expect(result[1]!.content).toContain("name: string");
    expect(result[1]!.content).toContain("value: number");
  });

  it("handles null schema gracefully", () => {
    const result = buildSystemPrompt(
      "Test system prompt",
      [1000],
      1000,
      "string",
      null
    );

    expect(result[1]!.content).not.toContain("TypeScript type");
  });
});

