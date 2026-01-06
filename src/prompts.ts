/**
 * System prompts for RLM
 * TypeScript port of rlm/utils/prompts.py
 * 
 * Note: Modified for JavaScript instead of Python
 */

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

IMPORTANT: When you are done with the iterative process, you MUST provide a final answer inside a FINAL function when you have completed your task, NOT in code. Do not use these tags unless you have completed your task. You have two options:
1. Use FINAL(your final answer here) to provide the answer directly
2. Use FINAL_VAR(variable_name) to return a variable you have created in the REPL environment as your final output

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
 * Build the initial system prompt with context metadata
 */
export function buildSystemPrompt(
  systemPrompt: string,
  contextLengths: number[],
  contextTotalLength: number,
  contextType: string
): Array<{ role: "system" | "assistant"; content: string }> {
  // Truncate context lengths display if too many
  let lengthsDisplay: string;
  if (contextLengths.length > 100) {
    const truncated = contextLengths.slice(0, 100);
    lengthsDisplay = `[${truncated.join(", ")}... + ${contextLengths.length - 100} more]`;
  } else {
    lengthsDisplay = `[${contextLengths.join(", ")}]`;
  }

  const metadataPrompt = `Your context is a ${contextType} with ${contextTotalLength} total characters, and is broken up into chunks of char lengths: ${lengthsDisplay}.`;

  return [
    { role: "system", content: systemPrompt },
    { role: "assistant", content: metadataPrompt },
  ];
}

/**
 * Build the user prompt for an iteration
 */
export function buildUserPrompt(
  rootPrompt: string | null,
  iteration: number
): { role: "user"; content: string } {
  let prompt: string;

  if (iteration === 0) {
    const safeguard = "You have not interacted with the REPL environment or seen your prompt / context yet. Your next action should be to look through and figure out how to answer the prompt, so don't just provide a final answer yet.\n\n";
    prompt = safeguard + (
      rootPrompt
        ? USER_PROMPT_WITH_ROOT.replace("{rootPrompt}", rootPrompt)
        : USER_PROMPT
    );
  } else {
    prompt = "The history before is your previous interactions with the REPL environment. " + (
      rootPrompt
        ? USER_PROMPT_WITH_ROOT.replace("{rootPrompt}", rootPrompt)
        : USER_PROMPT
    );
  }

  return { role: "user", content: prompt };
}

