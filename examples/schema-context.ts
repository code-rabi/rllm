/**
 * RLM TypeScript - Structured Context with Zod Schema
 * 
 * Demonstrates using Zod schemas to provide type information to the LLM.
 * The LLM receives the TypeScript type structure and can write better code.
 * 
 * Run with: pnpm tsx examples/schema-context.ts
 */

import "dotenv/config";
import { z } from "zod";
import { createRLLM } from "../src/index.js";

async function main() {
  console.log("=== RLLM TypeScript - Schema Context Examples ===\n");

  const rlm = createRLLM({
    model: "gpt-4o-mini",
    provider: "openai",
    verbose: true,
  });

  // =========================================================================
  // Example 1: Object with nested structure
  // =========================================================================
  console.log("\n--- Example 1: Nested Object Schema ---\n");

  // Define a schema for our structured data
  const CompanyDataSchema = z.object({
    companyName: z.string(),
    year: z.number(),
    quarters: z.array(z.object({
      quarter: z.enum(["Q1", "Q2", "Q3", "Q4"]),
      revenue: z.number(),
      operatingCosts: z.number(),
      netProfit: z.number(),
    })),
    employees: z.object({
      total: z.number(),
      departments: z.record(z.string(), z.number()),
    }),
  });

  // Create typed data matching the schema
  const companyData: z.infer<typeof CompanyDataSchema> = {
    companyName: "TechCorp Inc.",
    year: 2024,
    quarters: [
      { quarter: "Q1", revenue: 45.2, operatingCosts: 32.1, netProfit: 13.1 },
      { quarter: "Q2", revenue: 52.8, operatingCosts: 35.4, netProfit: 17.4 },
      { quarter: "Q3", revenue: 61.3, operatingCosts: 38.2, netProfit: 23.1 },
      { quarter: "Q4", revenue: 78.5, operatingCosts: 45.6, netProfit: 32.9 },
    ],
    employees: {
      total: 1250,
      departments: {
        Engineering: 450,
        Sales: 200,
        Marketing: 150,
        Operations: 300,
        HR: 50,
        Finance: 100,
      },
    },
  };

  const result1 = await rlm.completion(
    "Analyze the company data: Which quarter had the best profit margin (profit/revenue ratio)? Also, what percentage of employees are in Engineering?",
    {
      context: companyData,
      contextSchema: CompanyDataSchema,
    }
  );

  console.log("\nAnswer:", result1.answer);
  console.log("Iterations:", result1.iterations);
  console.log("Sub-LLM calls:", result1.usage.subCalls);
  console.log("Tokens used:", result1.usage.tokenUsage.totalTokens);

  // =========================================================================
  // Example 2: Array of objects with optional fields
  // =========================================================================
  console.log("\n--- Example 2: Array Schema with Optional Fields ---\n");

  const ProductSchema = z.object({
    id: z.string(),
    name: z.string(),
    category: z.string(),
    price: z.number(),
    inStock: z.boolean(),
    reviews: z.array(z.object({
      rating: z.number(),
      comment: z.string(),
    })).optional(),
  });

  const ProductListSchema = z.array(ProductSchema);

  const products: z.infer<typeof ProductListSchema> = [
    {
      id: "p1",
      name: "Wireless Mouse",
      category: "Electronics",
      price: 29.99,
      inStock: true,
      reviews: [
        { rating: 5, comment: "Great mouse!" },
        { rating: 4, comment: "Good value" },
      ],
    },
    {
      id: "p2",
      name: "USB-C Hub",
      category: "Electronics",
      price: 49.99,
      inStock: true,
      reviews: [{ rating: 5, comment: "Essential for my laptop" }],
    },
    {
      id: "p3",
      name: "Desk Lamp",
      category: "Office",
      price: 34.99,
      inStock: false,
    },
    {
      id: "p4",
      name: "Mechanical Keyboard",
      category: "Electronics",
      price: 129.99,
      inStock: true,
      reviews: [
        { rating: 5, comment: "Amazing typing experience" },
        { rating: 5, comment: "Worth every penny" },
        { rating: 4, comment: "A bit loud but great feel" },
      ],
    },
  ];

  const result2 = await rlm.completion(
    "What is the average review rating for products that are in stock? List the products with their average ratings.",
    {
      context: products,
      contextSchema: ProductListSchema,
    }
  );

  console.log("\nAnswer:", result2.answer);
  console.log("Iterations:", result2.iterations);
  console.log("Sub-LLM calls:", result2.usage.subCalls);

  console.log("\n=== Done! ===\n");
}

main().catch(console.error);

