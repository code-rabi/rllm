/**
 * System prompts for RLM
 * TypeScript port of rlm/utils/prompts.py
 * 
 * Note: Modified for JavaScript instead of Python
 */

import type { ZodType } from "zod";

/**
 * Main RLM system prompt - instructs the LLM on how to use the REPL environment
 */
export const RLM_SYSTEM_PROMPT = `You are tasked with answering a query with associated context. You can access, transform, and analyze this context interactively in a REPL environment that can recursively query sub-LLMs, which you are strongly encouraged to use as much as possible. You will be queried iteratively until you provide a final answer.

The REPL environment is initialized with:
1. A \`context\` variable that contains extremely important information about your query. You should check the content of the \`context\` variable to understand what you are working with. Make sure you look through it sufficiently as you answer your query.
2. A \`llm_query\` function that allows you to query an LLM (that can handle around 500K chars) inside your REPL environment.
3. A \`llm_query_batched\` function that allows you to query multiple prompts concurrently: \`await llm_query_batched(prompts)\` returns an array of responses. This is much faster than sequential \`llm_query\` calls when you have multiple independent queries.
4. The ability to use \`print()\` or \`console.log()\` statements to view the output of your REPL code and continue your reasoning.

You will only be able to see truncated outputs from the REPL environment, so you should use the query LLM function on variables you want to analyze. You will find this function especially useful when you have to analyze the semantics of the context. Use these variables as buffers to build up your final answer.

IMPORTANT: The REPL runs JavaScript/TypeScript, not Python. Use JavaScript syntax.

Make sure to explicitly look through the entire context in REPL before answering your query. An example strategy is to first look at the context and figure out a chunking strategy, then break up the context into smart chunks, and query an LLM per chunk with a particular question and save the answers to a buffer, then query an LLM with all the buffers to produce your final answer.

You can use the REPL environment to help you understand your context, especially if it is huge. Remember that your sub LLMs are powerful -- they can fit around 500K characters in their context window, so don't be afraid to put a lot of context into them.

When you want to execute JavaScript code in the REPL environment, wrap it in triple backticks with 'repl' language identifier. For example:
\`\`\`repl
const chunk = context.slice(0, 10000);
const answer = await llm_query(\`What is the magic number in the context? Here is the chunk: \${chunk}\`);
print(answer);
\`\`\`

As an example using batched queries for concurrent processing:
\`\`\`repl
const query = "A man became famous for his book. How many jobs did he have?";
// Split context into chunks
const chunkSize = Math.ceil(context.length / 10);
const chunks = [];
for (let i = 0; i < 10; i++) {
  chunks.push(context.slice(i * chunkSize, (i + 1) * chunkSize));
}

// Use batched query for concurrent processing - much faster!
const prompts = chunks.map((chunk, i) => 
  \`Try to answer: \${query}\\n\\nChunk \${i + 1}:\\n\${chunk}\\n\\nAnswer if found, or "Not found":\`
);
const answers = await llm_query_batched(prompts);
answers.forEach((answer, i) => print(\`Chunk \${i + 1}: \${answer}\`));

// Combine answers
const finalAnswer = await llm_query(
  \`Combine these answers to: \${query}\\n\\nAnswers:\\n\${answers.join("\\n")}\`
);
print(finalAnswer);
\`\`\`

IMPORTANT: When you have your final answer, you MUST call \`giveFinalAnswer()\` with the required format:

\`\`\`repl
giveFinalAnswer({ 
  message: "Your human-readable answer here",  // REQUIRED: must be a string
  data: { ... }  // OPTIONAL: any structured data
});
\`\`\`

The \`message\` property is REQUIRED and must be a string. The \`data\` property is optional and can contain any structured result data. This immediately ends execution and returns your result.

Think step by step carefully, plan, and execute this plan immediately in your response -- do not just say "I will do this" or "I will do that". Output to the REPL environment and recursive LLMs as much as possible. Remember to explicitly answer the original query in your final answer.`;

/**
 * User prompt template for each iteration
 */
export const USER_PROMPT = `Think step-by-step on what to do using the REPL environment (which contains the context) to answer the prompt.

Continue using the REPL environment, which has the \`context\` variable, and querying sub-LLMs by writing to \`\`\`repl\`\`\` tags, and determine your answer. Your next action:`;

/**
 * User prompt template with root prompt included
 */
export const USER_PROMPT_WITH_ROOT = `Think step-by-step on what to do using the REPL environment (which contains the context) to answer the original prompt: "{rootPrompt}".

Continue using the REPL environment, which has the \`context\` variable, and querying sub-LLMs by writing to \`\`\`repl\`\`\` tags, and determine your answer. Your next action:`;

/**
 * Get the Zod type name, supporting both Zod 3 and Zod 4
 */
function getZodTypeName(schema: unknown): string | undefined {
  const s = schema as Record<string, unknown>;
  
  // Zod 3: _def.typeName
  if (s._def && typeof s._def === "object") {
    const def = s._def as Record<string, unknown>;
    if (typeof def.typeName === "string") {
      return def.typeName;
    }
  }
  
  // Zod 4: _zod.def.type or constructor name
  if (s._zod && typeof s._zod === "object") {
    const zod = s._zod as Record<string, unknown>;
    if (zod.def && typeof zod.def === "object") {
      const def = zod.def as Record<string, unknown>;
      if (typeof def.type === "string") {
        return def.type;
      }
    }
  }
  
  // Try constructor name as fallback
  if (s.constructor && s.constructor.name) {
    return s.constructor.name;
  }
  
  return undefined;
}

/**
 * Get the inner schema from a Zod definition (works with Zod 3 and 4)
 */
function getInnerSchema(schema: unknown, key: string): unknown {
  const s = schema as Record<string, unknown>;
  
  // Zod 3: _def[key]
  if (s._def && typeof s._def === "object") {
    const def = s._def as Record<string, unknown>;
    if (def[key]) return def[key];
  }
  
  // Zod 4: _zod.def[key]
  if (s._zod && typeof s._zod === "object") {
    const zod = s._zod as Record<string, unknown>;
    if (zod.def && typeof zod.def === "object") {
      const def = zod.def as Record<string, unknown>;
      if (def[key]) return def[key];
    }
  }
  
  return undefined;
}

/**
 * Get object shape from a Zod object schema (works with Zod 3 and 4)
 */
function getObjectShape(schema: unknown): Record<string, unknown> | undefined {
  const s = schema as Record<string, unknown>;
  
  // Zod 3: _def.shape()
  if (s._def && typeof s._def === "object") {
    const def = s._def as Record<string, unknown>;
    if (typeof def.shape === "function") {
      return def.shape() as Record<string, unknown>;
    }
    if (def.shape && typeof def.shape === "object") {
      return def.shape as Record<string, unknown>;
    }
  }
  
  // Zod 4: _zod.def.shape
  if (s._zod && typeof s._zod === "object") {
    const zod = s._zod as Record<string, unknown>;
    if (zod.def && typeof zod.def === "object") {
      const def = zod.def as Record<string, unknown>;
      if (def.shape && typeof def.shape === "object") {
        return def.shape as Record<string, unknown>;
      }
    }
  }
  
  // Zod 4: shape property directly
  if (s.shape && typeof s.shape === "object") {
    return s.shape as Record<string, unknown>;
  }
  
  return undefined;
}

/**
 * Convert a Zod schema to a TypeScript type description for the LLM
 * Supports both Zod 3 and Zod 4
 */
export function zodSchemaToTypeDescription(schema: ZodType): string {
  const typeName = getZodTypeName(schema);
  
  if (!typeName) {
    return "unknown";
  }

  // Normalize type names (Zod 4 uses lowercase, Zod 3 uses ZodX)
  const normalizedType = typeName.replace(/^Zod/, "").toLowerCase();
  
  switch (normalizedType) {
    case "string":
      return "string";
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "null":
      return "null";
    case "undefined":
      return "undefined";
    case "any":
      return "any";
    case "unknown":
      return "unknown";
    case "never":
      return "never";
    case "void":
      return "void";
    case "date":
      return "Date";
    case "bigint":
      return "bigint";
    case "symbol":
      return "symbol";
    case "literal": {
      const value = getInnerSchema(schema, "value");
      return typeof value === "string" ? `"${value}"` : String(value);
    }
    case "array": {
      const itemType = getInnerSchema(schema, "type") || getInnerSchema(schema, "element");
      if (itemType) {
        return `${zodSchemaToTypeDescription(itemType as ZodType)}[]`;
      }
      return "unknown[]";
    }
    case "object": {
      const shape = getObjectShape(schema);
      if (shape) {
        const props = Object.entries(shape).map(([key, val]) => {
          const valTypeName = getZodTypeName(val);
          const isOptional = valTypeName?.toLowerCase().includes("optional");
          return `  ${key}${isOptional ? "?" : ""}: ${zodSchemaToTypeDescription(val as ZodType)};`;
        });
        return `{\n${props.join("\n")}\n}`;
      }
      return "object";
    }
    case "optional": {
      const inner = getInnerSchema(schema, "innerType") || getInnerSchema(schema, "wrapped");
      if (inner) {
        return `${zodSchemaToTypeDescription(inner as ZodType)} | undefined`;
      }
      return "unknown | undefined";
    }
    case "nullable": {
      const inner = getInnerSchema(schema, "innerType") || getInnerSchema(schema, "wrapped");
      if (inner) {
        return `${zodSchemaToTypeDescription(inner as ZodType)} | null`;
      }
      return "unknown | null";
    }
    case "union": {
      const options = getInnerSchema(schema, "options") as ZodType[] | undefined;
      if (options && Array.isArray(options)) {
        return options.map(opt => zodSchemaToTypeDescription(opt)).join(" | ");
      }
      return "unknown";
    }
    case "enum": {
      const values = getInnerSchema(schema, "values") as string[] | undefined;
      if (values && Array.isArray(values)) {
        return values.map(v => `"${v}"`).join(" | ");
      }
      // Zod 4 might store as entries
      const entries = getInnerSchema(schema, "entries") as Record<string, string> | undefined;
      if (entries && typeof entries === "object") {
        return Object.values(entries).map(v => `"${v}"`).join(" | ");
      }
      return "string";
    }
    case "record": {
      const keyType = getInnerSchema(schema, "keyType");
      const valueType = getInnerSchema(schema, "valueType");
      const keyStr = keyType ? zodSchemaToTypeDescription(keyType as ZodType) : "string";
      const valStr = valueType ? zodSchemaToTypeDescription(valueType as ZodType) : "unknown";
      return `Record<${keyStr}, ${valStr}>`;
    }
    case "tuple": {
      const items = getInnerSchema(schema, "items") as ZodType[] | undefined;
      if (items && Array.isArray(items)) {
        return `[${items.map(item => zodSchemaToTypeDescription(item)).join(", ")}]`;
      }
      return "[]";
    }
    default:
      // For complex or unknown types, try to get a description
      const desc = getInnerSchema(schema, "description");
      if (typeof desc === "string") {
        return desc;
      }
      return "unknown";
  }
}

/**
 * Build the initial system prompt with context metadata
 */
export function buildSystemPrompt(
  systemPrompt: string,
  contextLengths: number[],
  contextTotalLength: number,
  contextType: string,
  schemaDescription?: string | null
): Array<{ role: "system" | "assistant"; content: string }> {
  // Truncate context lengths display if too many
  let lengthsDisplay: string;
  if (contextLengths.length > 100) {
    const truncated = contextLengths.slice(0, 100);
    lengthsDisplay = `[${truncated.join(", ")}... + ${contextLengths.length - 100} more]`;
  } else {
    lengthsDisplay = `[${contextLengths.join(", ")}]`;
  }

  let metadataPrompt = `Your context is a ${contextType} with ${contextTotalLength} total characters, and is broken up into chunks of char lengths: ${lengthsDisplay}.`;

  // Add type information if schema was provided
  if (schemaDescription) {
    metadataPrompt += `\n\nThe \`context\` variable has the following TypeScript type:\n\`\`\`typescript\ntype Context = ${schemaDescription}\n\`\`\`\n\nYou can access the properties of \`context\` directly according to this type structure.`;
  }

  return [
    { role: "system", content: systemPrompt },
    { role: "assistant", content: metadataPrompt },
  ];
}

/**
 * Build the user prompt for an iteration
 */
export function buildUserPrompt(
  prompt: string,
  iteration: number
): { role: "user"; content: string } {
  let content: string;

  if (iteration === 0) {
    const safeguard = "You have not interacted with the REPL environment or seen your prompt / context yet. Your next action should be to look through and figure out how to answer the prompt, so don't just provide a final answer yet.\n\n";
    content = safeguard + USER_PROMPT_WITH_ROOT.replace("{rootPrompt}", prompt);
  } else {
    content = "The history before is your previous interactions with the REPL environment. " + 
      USER_PROMPT_WITH_ROOT.replace("{rootPrompt}", prompt);
  }

  return { role: "user", content };
}
