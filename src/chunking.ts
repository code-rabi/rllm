/**
 * Chunking utilities for processing large strings
 */

import type { ChunkOptions } from "./types.js";

const DEFAULT_DELIMITERS = [
  "\n\n\n",   // Triple newline (major sections)
  "\n\n",     // Double newline (paragraphs)
  "\n",       // Single newline
  ". ",       // Sentence end
  "! ",
  "? ",
  "; ",       // Clause boundaries
  ", ",
  " ",        // Words (last resort)
];

/**
 * Smart text chunking that respects natural boundaries
 */
export function chunkText(text: string, options: ChunkOptions): string[] {
  const { chunkSize, overlap = 0, delimiters = DEFAULT_DELIMITERS } = options;

  if (text.length <= chunkSize) {
    return [text];
  }

  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    let end = Math.min(start + chunkSize, text.length);

    // If we're not at the end, try to find a good break point
    if (end < text.length) {
      const searchStart = Math.max(start, end - Math.floor(chunkSize * 0.2));
      const searchRegion = text.slice(searchStart, end);

      // Try each delimiter in priority order
      let bestBreak = -1;
      for (const delim of delimiters) {
        const lastIndex = searchRegion.lastIndexOf(delim);
        if (lastIndex !== -1) {
          bestBreak = searchStart + lastIndex + delim.length;
          break;
        }
      }

      if (bestBreak > start) {
        end = bestBreak;
      }
    }

    chunks.push(text.slice(start, end).trim());

    // Move start, accounting for overlap
    start = end - overlap;
    if (start >= text.length) break;
  }

  return chunks.filter((c) => c.length > 0);
}

/**
 * Chunk by line count
 */
export function chunkByLines(text: string, linesPerChunk: number): string[] {
  const lines = text.split("\n");
  const chunks: string[] = [];

  for (let i = 0; i < lines.length; i += linesPerChunk) {
    chunks.push(lines.slice(i, i + linesPerChunk).join("\n"));
  }

  return chunks;
}

/**
 * Chunk by regex pattern (e.g., markdown headers, code blocks)
 */
export function chunkByPattern(text: string, pattern: RegExp): string[] {
  const parts = text.split(pattern);
  const matches = text.match(pattern) ?? [];

  // Interleave matches back with parts
  const chunks: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]?.trim();
    if (part) {
      // Prepend the delimiter that preceded this part
      const prefix = i > 0 ? matches[i - 1] ?? "" : "";
      chunks.push((prefix + part).trim());
    }
  }

  return chunks.filter((c) => c.length > 0);
}

/**
 * Chunk markdown by headers
 */
export function chunkMarkdownByHeaders(
  text: string,
  level: 1 | 2 | 3 = 2
): { header: string; content: string }[] {
  const headerPattern = new RegExp(`^${"#".repeat(level)}\\s+(.+)$`, "gm");
  const sections: { header: string; content: string }[] = [];

  let lastIndex = 0;
  let lastHeader = "";
  let match: RegExpExecArray | null;

  while ((match = headerPattern.exec(text)) !== null) {
    if (lastIndex > 0 || match.index > 0) {
      sections.push({
        header: lastHeader,
        content: text.slice(lastIndex, match.index).trim(),
      });
    }
    lastHeader = match[1] ?? "";
    lastIndex = match.index + match[0].length;
  }

  // Don't forget the last section
  if (lastIndex < text.length) {
    sections.push({
      header: lastHeader,
      content: text.slice(lastIndex).trim(),
    });
  }

  return sections.filter((s) => s.content.length > 0);
}

/**
 * Estimate token count (rough approximation: ~4 chars per token)
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Chunk to fit within token budget
 */
export function chunkToTokenBudget(
  text: string,
  tokensPerChunk: number,
  overlap: number = 0
): string[] {
  // Approximate: 4 chars per token
  const charsPerChunk = tokensPerChunk * 4;
  const overlapChars = overlap * 4;

  return chunkText(text, {
    chunkSize: charsPerChunk,
    overlap: overlapChars,
  });
}

