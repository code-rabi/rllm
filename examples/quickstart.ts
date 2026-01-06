/**
 * RLM TypeScript - Quick Start Example
 * 
 * Simple example showing the basic API: prompt first, context in options.
 * 
 * Run with: pnpm tsx examples/quickstart.ts
 */

import "dotenv/config";
import { createRLM } from "../src/index.js";

async function main() {
  console.log("=== RLM TypeScript - Quick Start ===\n");

  // Create RLM instance
  const rlm = createRLM({
    model: "gpt-4o-mini",
    provider: "openai",
    verbose: true,
  });

  // Example context - a financial report
  const financialReport = `
    # Company Financial Report 2024
    
    ## Q1 Results
    Revenue: $45.2 million
    Operating costs: $32.1 million
    Net profit: $13.1 million
    
    ## Q2 Results
    Revenue: $52.8 million
    Operating costs: $35.4 million
    Net profit: $17.4 million
    
    ## Q3 Results
    Revenue: $61.3 million
    Operating costs: $38.2 million
    Net profit: $23.1 million
    
    ## Q4 Results
    Revenue: $78.5 million
    Operating costs: $45.6 million
    Net profit: $32.9 million
    
    ## Annual Summary
    The company achieved record growth in 2024, with total revenue of $237.8 million
    and net profit of $86.5 million, representing a 45% increase over 2023.
  `;

  // Run RLM completion - prompt first, context in options
  const result = await rlm.completion(
    "What was the total annual revenue and which quarter had the highest profit?",
    { context: financialReport }
  );

  console.log("\nAnswer:", result.answer);
  console.log("Iterations:", result.iterations);
  console.log("Token usage:", result.usage.tokenUsage.totalTokens);
  console.log("Sub-LLM calls:", result.usage.subCalls);

  console.log("\n=== Done! ===\n");
}

main().catch(console.error);
