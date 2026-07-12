// Shared single-turn, tool-free call to the Claude Agent SDK.
// Used by the NL→Cypher translator and the results summarizer.
import { query } from "@anthropic-ai/claude-agent-sdk";

const MODEL = process.env.KG_MODEL || "claude-opus-4-8";

export async function runClaude(system, prompt) {
  let result = null;
  let assistant = "";
  for await (const message of query({
    prompt,
    options: {
      model: MODEL,
      maxTurns: 1,
      allowedTools: [],
      permissionMode: "bypassPermissions",
      systemPrompt: system,
    },
  })) {
    if (message.type === "assistant") {
      for (const block of message.message?.content ?? []) {
        if (block.type === "text") assistant += block.text;
      }
    } else if (message.type === "result") {
      if (message.subtype === "success") result = message.result;
      else throw new Error(`Claude failed: ${message.subtype || "unknown"}`);
    }
  }
  return ((result ?? assistant) || "").trim();
}
