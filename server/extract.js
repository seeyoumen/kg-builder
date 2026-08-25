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

const SYSTEM_PROMPT = `你是一个知识图谱信息提取引擎，将文本转换为知识图谱。
提取实体（节点）和它们之间的关系。

仅返回一个 JSON 对象——不要任何散文、解释或 markdown 代码框。

JSON 必须具有以下确切结构：
{
  "nodes": [
    { "id": "<小写蛇形命名>", "label": "<实体类型>", "name": "<显示名称>", "properties": { } }
  ],
  "relationships": [
    { "from": "<节点 id>", "to": "<节点 id>", "type": "<关系类型>", "properties": { } }
  ]
}

规则：
- "id" 是从名称派生的标识符，例如 "marie_curie" 或 "ju_liren"。在关系中一致使用它。
- "label" 是实体类型，使用中文：人物、组织、地点、产品、奖项、元素、作品、事件、领域等。
- "name" 是可读名称，例如 "玛丽·居里" 或 "爱因斯坦"。
- 将属性（年份、日期、角色、数字）放在 "properties" 中作为原始值，不要嵌套对象。
- "type" 是中文关系描述，例如：出生于、创立、发现、获得、工作于、结婚、创作、属于等。
- 关系中使用的每个 id 也必须作为节点出现。
- 只返回有效的 JSON。`;

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
