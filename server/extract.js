// Extraction step: unstructured text -> { nodes, relationships }.
//
// We call the Claude Agent SDK's `query()` as a single-turn, tool-free LLM call
// and prompt it to return strict JSON. We then normalize that JSON into the
// exact contract that cypher.js expects:
//
//   node:         { id, label, name, properties }
//                 - id:    stable slug (used to wire relationships together)
//                 - label: the entity TYPE / Neo4j label (Person, Organization, ...)
//                 - name:  the human display name / merge key
//   relationship: { from, to, type, properties }
//                 - from/to reference node ids
//                 - type is UPPER_SNAKE_CASE
//
// Auth note: the Agent SDK looks for ANTHROPIC_API_KEY (and provider env vars).
// When run on a machine already logged into Claude Code, it MAY inherit that
// session — we verify that empirically rather than assume it.

import { query } from "@anthropic-ai/claude-agent-sdk";

const MODEL = process.env.KG_MODEL || "claude-opus-4-8";

const SYSTEM_PROMPT = `You are an information-extraction engine that turns prose into a knowledge graph.
Extract the entities (nodes) and the relationships between them.

Respond with ONLY a single JSON object — no prose, no explanation, no markdown code fences.

The JSON must have this exact shape:
{
  "nodes": [
    { "id": "<lowercase_snake_slug>", "label": "<EntityType>", "name": "<Display Name>", "properties": { } }
  ],
  "relationships": [
    { "from": "<node id>", "to": "<node id>", "type": "<UPPER_SNAKE_TYPE>", "properties": { } }
  ]
}

Rules:
- "id" is a slug derived from the name, e.g. "marie_curie". Use it consistently in relationships.
- "label" is the entity TYPE, capitalized: Person, Organization, Place, Product, Award, Element, Work, Event, Field, etc.
- "name" is the readable name, e.g. "Marie Curie".
- Put attributes (years, dates, roles, numbers) inside "properties" as primitive values, never nested objects.
- "type" is an UPPER_SNAKE_CASE verb phrase, e.g. BORN_IN, FOUNDED, DISCOVERED, WON, WORKED_AT, MARRIED_TO, CREATED, PART_OF.
- Every id used in a relationship must also appear as a node.
- Return valid JSON only.`;

export async function extractGraph(text) {
  const prompt =
    `Extract the knowledge graph from the following text.\n\nTEXT:\n"""\n${text}\n"""`;

  let resultText = null;
  let assistantText = "";

  for await (const message of query({
    prompt,
    options: {
      model: MODEL,
      maxTurns: 1,
      allowedTools: [],
      permissionMode: "bypassPermissions",
      systemPrompt: SYSTEM_PROMPT,
    },
  })) {
    if (message.type === "assistant") {
      for (const block of message.message?.content ?? []) {
        if (block.type === "text") assistantText += block.text;
      }
    } else if (message.type === "result") {
      if (message.subtype === "success") {
        resultText = message.result;
      } else {
        throw new Error(`Claude extraction failed: ${message.subtype || "unknown"}`);
      }
    }
  }

  const raw = ((resultText ?? assistantText) || "").trim();
  if (!raw) throw new Error("No response from the model.");

  const parsed = parseJsonLoose(raw);
  return normalize(parsed);
}

// --- helpers ----------------------------------------------------------------

// Parse JSON even if the model wrapped it in a ```json fence or added stray
// text around it.
function parseJsonLoose(text) {
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const first = t.indexOf("{");
  const last = t.lastIndexOf("}");
  if (first !== -1 && last !== -1 && last > first) t = t.slice(first, last + 1);
  return JSON.parse(t);
}

function slugify(s) {
  return (
    String(s)
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || "entity"
  );
}

function prettify(id) {
  return String(id)
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// Neo4j properties must be primitives or arrays of primitives.
function coercePrimitive(v) {
  if (v === null) return null;
  const t = typeof v;
  if (t === "string" || t === "number" || t === "boolean") return v;
  if (Array.isArray(v) && v.every((x) => ["string", "number", "boolean"].includes(typeof x))) {
    return v;
  }
  return JSON.stringify(v);
}

function cleanProps(props) {
  const out = {};
  for (const [k, v] of Object.entries(props || {})) {
    if (k === "name") continue; // name is the merge key, kept on the node itself
    out[k] = coercePrimitive(v);
  }
  return out;
}

// Coerce arbitrary model JSON into our strict { nodes, relationships } contract.
function normalize(raw) {
  const nodesIn = Array.isArray(raw?.nodes) ? raw.nodes : [];
  const relsIn = Array.isArray(raw?.relationships)
    ? raw.relationships
    : Array.isArray(raw?.edges)
    ? raw.edges
    : [];

  const byId = new Map();

  for (const n of nodesIn) {
    const name = n?.name ?? n?.label ?? n?.id;
    if (!name) continue;
    const id = slugify(n?.id ?? name);
    const label = n?.label ?? n?.type ?? "Entity";
    if (!byId.has(id)) {
      byId.set(id, { id, label: String(label), name: String(name), properties: cleanProps(n?.properties) });
    }
  }

  const relationships = [];
  for (const r of relsIn) {
    const fromRaw = r?.from ?? r?.source ?? r?.start;
    const toRaw = r?.to ?? r?.target ?? r?.end;
    const type = r?.type ?? r?.label ?? r?.rel ?? "RELATED_TO";
    if (!fromRaw || !toRaw) continue;

    const from = slugify(fromRaw);
    const to = slugify(toRaw);

    // Make sure both endpoints exist as nodes even if the model forgot to list them.
    if (!byId.has(from)) byId.set(from, { id: from, label: "Entity", name: prettify(from), properties: {} });
    if (!byId.has(to)) byId.set(to, { id: to, label: "Entity", name: prettify(to), properties: {} });

    relationships.push({ from, to, type: String(type), properties: cleanProps(r?.properties) });
  }

  return { nodes: [...byId.values()], relationships };
}
