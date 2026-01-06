/**
 * RLM TypeScript - Quick Start Example
 * 
 * Demonstrates code execution mode (like Python RLM).
 * 
 * Run with: pnpm tsx examples/quickstart.ts
 */

import { createRLM } from "../src/index.js";

async function main() {
  console.log("=== RLM TypeScript - Quick Start ===\n");

  // Create RLM instance in code execution mode (like Python RLM)
  const rlm = createRLM({
    model: "gpt-4o-mini",
    provider: "openai",
    verbose: true,
  });

  // =========================================================================
  // Example 1: Full RLM with code execution
  // =========================================================================
  console.log("\n--- Example 1: Code Execution Mode ---\n");

  const context = `
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

  const result1 = await rlm.completion(context, {
    rootPrompt: "What was the total annual revenue and which quarter had the highest profit?",
  });

  console.log("\nAnswer:", result1.answer);
  console.log("Iterations:", result1.iterations);
  console.log("Token usage:", result1.usage.tokenUsage.totalTokens);
  console.log("Sub-LLM calls:", result1.usage.subCalls);

  // =========================================================================
  // Example 2: Larger context with recursive processing
  // =========================================================================
  console.log("\n--- Example 2: Larger Context ---\n");

  const longText = `
    Chapter 1: The Dawn of Computing
    
    The history of computing begins with mechanical calculators. Charles Babbage
    designed the Analytical Engine in the 1830s, often considered the first
    general-purpose computer design. Ada Lovelace wrote what is considered the
    first computer program for this machine.
    
    Chapter 2: Electronic Computers
    
    The 1940s saw the development of electronic computers. ENIAC, completed in
    1945, was one of the first general-purpose electronic computers. It weighed
    30 tons and occupied 1,800 square feet. The invention of the transistor in
    1947 would eventually revolutionize computing.
    
    Chapter 3: Personal Computing Revolution
    
    The 1970s and 1980s brought computing to homes. The Apple II, released in
    1977, was one of the first successful personal computers. IBM's PC in 1981
    established standards that persist today. Microsoft Windows, released in
    1985, would eventually dominate the desktop market.
    
    Chapter 4: The Internet Age
    
    The 1990s saw the rise of the World Wide Web. Tim Berners-Lee invented the
    web in 1989. The Mosaic browser in 1993 made the web accessible to ordinary
    users. Companies like Amazon, Google, and Facebook would reshape society.
    
    Chapter 5: Mobile and Cloud Computing
    
    The 2000s and 2010s brought smartphones and cloud computing. Apple's iPhone
    in 2007 redefined mobile computing. Cloud platforms like AWS, launched in
    2006, enabled new business models. Today, computing is ubiquitous and
    increasingly powered by artificial intelligence.
  `.repeat(5); // Make it larger

  const result2 = await rlm.completion(longText, {
    rootPrompt: "Create a timeline of the key technological milestones mentioned, with years.",
  });

  console.log("\nTimeline:", result2.answer);
  console.log("Iterations:", result2.iterations);
  console.log("Sub-LLM calls:", result2.usage.subCalls);
  console.log("Tokens used:", result2.usage.tokenUsage.totalTokens);

  console.log("\n=== Done! ===\n");
}

main().catch(console.error);
