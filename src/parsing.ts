/**
 * Parsing utilities for RLM responses
 * TypeScript port of rlm/utils/parsing.py
 */

import type { SandboxResult } from "./sandbox.js";

/**
 * Find REPL code blocks in text wrapped in triple backticks with 'repl' language.
 * Returns list of code content strings.
 */
export function findCodeBlocks(text: string): string[] {
  // Match ```repl ... ``` blocks
  const pattern = /```repl\s*\n([\s\S]*?)\n```/g;
  const results: string[] = [];

  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const codeContent = match[1]?.trim();
    if (codeContent) {
      results.push(codeContent);
    }
  }

  return results;
}

/**
 * Find FINAL(...) or FINAL_VAR(...) statement in response.
 * Returns [type, content] or null if not found.
 */
export function findFinalAnswer(text: string): [string, string] | null {
  // Check for FINAL_VAR pattern first - must be at start of line
  const finalVarPattern = /^\s*FINAL_VAR\s*\(\s*["']?([^"')]+)["']?\s*\)/m;
  let match = finalVarPattern.exec(text);
  if (match) {
    return ["FINAL_VAR", match[1]!.trim()];
  }

  // Check for FINAL pattern - must be at start of line
  // Handle both single-line and multi-line content
  const finalPattern = /^\s*FINAL\s*\(([\s\S]*?)\)\s*$/m;
  match = finalPattern.exec(text);
  if (match) {
    return ["FINAL", match[1]!.trim()];
  }

  return null;
}

/**
 * Format a sandbox execution result for display
 */
export function formatExecutionResult(result: SandboxResult): string {
  const parts: string[] = [];

  if (result.stdout) {
    parts.push(result.stdout);
  }

  if (result.stderr) {
    parts.push(result.stderr);
  }

  // Show key variables (excluding internal ones)
  const importantVars: string[] = [];
  for (const key of Object.keys(result.locals)) {
    if (!key.startsWith("_")) {
      importantVars.push(key);
    }
  }

  if (importantVars.length > 0) {
    parts.push(`REPL variables: [${importantVars.join(", ")}]`);
  }

  return parts.length > 0 ? parts.join("\n\n") : "No output";
}

/**
 * Format an RLM iteration for the message history
 */
export function formatIteration(
  response: string,
  codeBlocks: Array<{ code: string; result: SandboxResult }>,
  maxCharLength: number = 20000
): Array<{ role: "assistant" | "user"; content: string }> {
  const messages: Array<{ role: "assistant" | "user"; content: string }> = [
    { role: "assistant", content: response },
  ];

  for (const block of codeBlocks) {
    let resultStr = formatExecutionResult(block.result);
    
    if (resultStr.length > maxCharLength) {
      resultStr = resultStr.slice(0, maxCharLength) + 
        `... + [${resultStr.length - maxCharLength} chars truncated]`;
    }

    messages.push({
      role: "user",
      content: `Code executed:\n\`\`\`javascript\n${block.code}\n\`\`\`\n\nREPL output:\n${resultStr}`,
    });
  }

  return messages;
}

/**
 * Convert context to appropriate format for REPL
 */
export function convertContextForRepl(
  context: unknown
): { data: unknown; str: string | null } {
  if (typeof context === "string") {
    return { data: null, str: context };
  }
  
  if (Array.isArray(context)) {
    if (context.length > 0 && typeof context[0] === "object" && context[0] !== null) {
      const first = context[0] as Record<string, unknown>;
      if ("content" in first) {
        return { 
          data: context.map((msg: Record<string, unknown>) => msg["content"] ?? ""), 
          str: null 
        };
      }
    }
    return { data: context, str: null };
  }
  
  return { data: context, str: null };
}

