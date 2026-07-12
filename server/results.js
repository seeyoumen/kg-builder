// Parse Neo4j query result records into:
//   - highlight ids (node/edge elementIds) to light up in the graph
//   - a structured {nodes, relationships, values} view for the UI
//   - a readable text form for the summarizer
// plus a read-only guard for user/LLM-supplied Cypher.

const isNode = (v) => v && typeof v === "object" && Array.isArray(v.labels) && "elementId" in v;
const isRel = (v) => v && typeof v === "object" && "type" in v && "startNodeElementId" in v;
const isPath = (v) => v && typeof v === "object" && Array.isArray(v.segments);

// Reject anything that could mutate the graph. The DB is standalone, so access
// mode isn't enforced by the server — this keyword guard is the real barrier.
export function assertReadOnly(cypher) {
  const c = String(cypher).trim().replace(/;\s*$/, "");
  if (c.includes(";")) throw new Error("Only a single read-only statement is allowed.");
  const banned = /\b(CREATE|MERGE|DELETE|DETACH|SET|REMOVE|DROP|FOREACH|CALL|LOAD)\b/i;
  if (banned.test(c)) {
    throw new Error("Only read-only queries are allowed (no CREATE/MERGE/SET/DELETE/CALL/LOAD).");
  }
  return c;
}

export function extractResults(records, cap = 300) {
  const nodeMap = new Map(); // elementId -> {id,label,name,properties}
  const relList = [];
  const edgeIds = new Set();
  const values = [];

  const addNode = (n) => {
    if (n && !nodeMap.has(n.elementId)) {
      nodeMap.set(n.elementId, {
        id: n.elementId,
        label: n.labels?.[0] || "Node",
        name: n.properties?.name ?? (n.labels?.[0] || "Node"),
        properties: n.properties || {},
      });
    }
  };
  const addRel = (r) => {
    if (r && !edgeIds.has(r.elementId)) {
      edgeIds.add(r.elementId);
      relList.push({ startId: r.startNodeElementId, endId: r.endNodeElementId, type: r.type, properties: r.properties || {} });
    }
  };
  const walk = (v) => {
    if (v == null) return;
    if (isNode(v)) addNode(v);
    else if (isRel(v)) addRel(v);
    else if (isPath(v)) {
      addNode(v.start);
      for (const s of v.segments) { addRel(s.relationship); addNode(s.start); addNode(s.end); }
    } else if (Array.isArray(v)) v.forEach(walk);
    else if (typeof v === "object") Object.values(v).forEach(walk);
  };

  let n = 0;
  for (const rec of records) {
    if (n++ >= cap) break;
    for (const key of rec.keys) {
      const v = rec.get(key);
      if (v != null && typeof v !== "object") values.push(`${key} = ${v}`); // scalar (count, name, ...)
      else walk(v);
    }
  }

  const nodeIds = new Set(nodeMap.keys());
  for (const r of relList) { nodeIds.add(r.startId); nodeIds.add(r.endId); }

  const nameOf = (id) => nodeMap.get(id)?.name || "(node)";
  const relationships = relList.map((r) => ({ from: nameOf(r.startId), to: nameOf(r.endId), type: r.type }));
  const nodes = [...nodeMap.values()].map((x) => ({ name: x.name, label: x.label, properties: x.properties }));

  return { highlight: { nodeIds: [...nodeIds], edgeIds: [...edgeIds] }, nodes, relationships, values };
}

export function resultsToText({ nodes, relationships, values }) {
  const lines = [];
  if (nodes.length) {
    lines.push("Nodes:");
    for (const nd of nodes) {
      const props = Object.entries(nd.properties)
        .filter(([k]) => k !== "name")
        .map(([k, v]) => `${k}: ${v}`)
        .join(", ");
      lines.push(`- ${nd.name} (${nd.label})${props ? ` { ${props} }` : ""}`);
    }
  }
  if (relationships.length) {
    lines.push("Relationships:");
    for (const r of relationships) lines.push(`- ${r.from} -${r.type}-> ${r.to}`);
  }
  if (values.length) {
    lines.push("Values:");
    for (const v of values) lines.push(`- ${v}`);
  }
  return lines.join("\n") || "(no results)";
}
