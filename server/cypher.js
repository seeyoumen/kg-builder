// Turns a normalized extraction ({ nodes, relationships }) into Cypher.
//
// We return TWO forms of each statement:
//   - `display`: a human-readable Cypher string with values inlined. This is
//     what we show you in the UI so you can *see* exactly what a knowledge-graph
//     write looks like. This is the teaching payload.
//   - `cypher` + `params`: a parameterized version that we actually execute
//     against Neo4j. Same operation, but values travel as parameters so quotes
//     and special characters can never break (or inject into) the query.
//
// Merge strategy: nodes are MERGEd on (label, name) so re-inserting the same
// entity updates it instead of creating a duplicate. Relationships are MERGEd
// on (fromName)-[:TYPE]->(toName).

// --- identifier / value sanitizers -----------------------------------------

// A Neo4j label: letters, digits, underscores; must not start with a digit.
// 支持中文标签，允许中文字符
export function sanitizeLabel(label) {
  // 保留原始标签（包括中文），只做基本清理
  const cleaned = String(label || "")
    .replace(/[^\u4e00-\u9fa5A-Za-z0-9_]/g, "_")
    .replace(/^(\d)/, "_$1");
  return cleaned || "实体";
}

// A relationship type, can be Chinese text.
// 关系类型可以是中文
export function sanitizeRelType(type) {
  // 保留原始的关系类型（包括中文），只做基本清理
  const cleaned = String(type || "")
    .trim()
    .replace(/[\u4e00-\u9fa5A-Za-z0-9_]/g, (c) => c) // 保留中文、字母、数字、下划线
    .replace(/[^ \u4e00-\u9fa5A-Za-z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  return cleaned || "相关";
}

// A property key. Wrap in backticks only if it isn't a plain identifier.
function keyForDisplay(key) {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(key) ? key : "`" + key + "`";
}

// Render a value as a Cypher literal (for the display-only version).
function valueForDisplay(v) {
  if (v === null || v === undefined) return "null";
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return "[" + v.map(valueForDisplay).join(", ") + "]";
  // strings (and anything else) -> a properly escaped double-quoted literal
  return JSON.stringify(String(v));
}

function propsForDisplay(props) {
  const entries = Object.entries(props || {});
  if (entries.length === 0) return "{}";
  return (
    "{ " +
    entries.map(([k, v]) => `${keyForDisplay(k)}: ${valueForDisplay(v)}`).join(", ") +
    " }"
  );
}

// --- statement builders ------------------------------------------------------

function nodeStatement(node) {
  const label = sanitizeLabel(node.label);
  const name = node.name;
  const props = node.properties || {};
  const hasProps = Object.keys(props).length > 0;

  const display = hasProps
    ? `MERGE (n:${label} { name: ${valueForDisplay(name)} })\n  SET n += ${propsForDisplay(props)}`
    : `MERGE (n:${label} { name: ${valueForDisplay(name)} })`;

  const cypher = hasProps
    ? `MERGE (n:\`${label}\` { name: $name }) SET n += $props`
    : `MERGE (n:\`${label}\` { name: $name })`;

  return { kind: "node", display, cypher, params: { name, props } };
}

function relStatement(rel, nameById) {
  const type = sanitizeRelType(rel.type);
  const fromName = nameById.get(rel.from) ?? rel.from;
  const toName = nameById.get(rel.to) ?? rel.to;
  const props = rel.properties || {};
  const hasProps = Object.keys(props).length > 0;

  let display =
    `MATCH (a { name: ${valueForDisplay(fromName)} }), (b { name: ${valueForDisplay(toName)} })\n` +
    `MERGE (a)-[r:${type}]->(b)`;
  if (hasProps) display += `\n  SET r += ${propsForDisplay(props)}`;

  let cypher =
    `MATCH (a { name: $from }), (b { name: $to }) MERGE (a)-[r:\`${type}\`]->(b)`;
  if (hasProps) cypher += ` SET r += $props`;

  return { kind: "rel", display, cypher, params: { from: fromName, to: toName, props } };
}

// --- public API --------------------------------------------------------------

// Returns an array of statements, nodes first (so relationship MATCHes find
// their endpoints), each as { kind, display, cypher, params }.
export function generateStatements(extraction) {
  const nodes = extraction?.nodes ?? [];
  const relationships = extraction?.relationships ?? [];

  const nameById = new Map(nodes.map((n) => [n.id, n.name]));

  const nodeStmts = nodes.map(nodeStatement);
  const relStmts = relationships.map((r) => relStatement(r, nameById));

  return [...nodeStmts, ...relStmts];
}

// Convenience: join all `display` strings into one script (what the UI shows).
export function statementsToScript(statements) {
  return statements.map((s) => s.display + ";").join("\n\n");
}
