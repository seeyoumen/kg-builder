// Thin wrapper around the official Neo4j driver.
// Connection defaults match the `db:up` script in package.json; override with
// env vars if you point at a different instance.

import neo4j from "neo4j-driver";

const URI = process.env.NEO4J_URI || "bolt://localhost:7687";
const USER = process.env.NEO4J_USER || "neo4j";
const PASSWORD = process.env.NEO4J_PASSWORD || "kgdemo123";

const driver = neo4j.driver(URI, neo4j.auth.basic(USER, PASSWORD), {
  disableLosslessIntegers: true, // integers come back as plain JS numbers
});

// Verify the connection is actually reachable. Throws if Neo4j isn't up yet.
export async function verifyConnection() {
  await driver.verifyConnectivity();
}

// Run a list of { cypher, params } statements in order, in one transaction so
// a failure rolls the whole insert back.
export async function runStatements(statements) {
  const session = driver.session();
  try {
    const tx = session.beginTransaction();
    for (const stmt of statements) {
      await tx.run(stmt.cypher, stmt.params || {});
    }
    await tx.commit();
  } finally {
    await session.close();
  }
}

// Read the entire graph and shape it for vis-network:
//   nodes: { id, label, group, title }
//   edges: { id, from, to, label, arrows }
export async function getGraph() {
  const session = driver.session({ defaultAccessMode: neo4j.session.READ });
  try {
    const result = await session.run(
      "MATCH (n) OPTIONAL MATCH (n)-[r]->(m) RETURN n, r, m"
    );

    const nodes = new Map();
    const edges = new Map();

    const addNode = (node) => {
      if (!node) return;
      const id = node.elementId;
      if (nodes.has(id)) return;
      const primaryLabel = node.labels?.[0] || "Node";
      const name = node.properties?.name ?? primaryLabel;
      nodes.set(id, {
        id,
        label: String(name),
        group: primaryLabel,
        title: formatProps(primaryLabel, node.properties),
      });
    };

    for (const record of result.records) {
      const n = record.get("n");
      const m = record.get("m");
      const r = record.get("r");
      addNode(n);
      addNode(m);
      if (r) {
        const id = r.elementId;
        if (!edges.has(id)) {
          edges.set(id, {
            id,
            from: r.startNodeElementId,
            to: r.endNodeElementId,
            label: r.type,
            arrows: "to",
          });
        }
      }
    }

    return { nodes: [...nodes.values()], edges: [...edges.values()] };
  } finally {
    await session.close();
  }
}

// All existing entities as { name, label } — fed to the resolver so new
// snippets can link to nodes already in the graph.
export async function getEntities() {
  const session = driver.session({ defaultAccessMode: neo4j.session.READ });
  try {
    const result = await session.run(
      "MATCH (n) WHERE n.name IS NOT NULL RETURN n.name AS name, labels(n)[0] AS label"
    );
    return result.records.map((r) => ({ name: r.get("name"), label: r.get("label") }));
  } finally {
    await session.close();
  }
}

// A compact schema description (labels + their property keys, and the
// relationship patterns present) to give the NL→Cypher translator.
export async function getSchema() {
  const session = driver.session({ defaultAccessMode: neo4j.session.READ });
  try {
    const labelRes = await session.run(
      "MATCH (n) UNWIND labels(n) AS label UNWIND keys(n) AS k RETURN label, collect(DISTINCT k) AS keys ORDER BY label"
    );
    const relRes = await session.run(
      "MATCH (a)-[r]->(b) RETURN DISTINCT labels(a)[0] AS from, type(r) AS rel, labels(b)[0] AS to ORDER BY from, rel LIMIT 200"
    );

    const labelLines = labelRes.records.map(
      (rec) => `  ${rec.get("label")}: ${rec.get("keys").join(", ")}`
    );
    const relLines = relRes.records.map(
      (rec) => `  (${rec.get("from")})-[:${rec.get("rel")}]->(${rec.get("to")})`
    );

    if (!labelLines.length) return "(the graph is currently empty)";
    return (
      "Node labels (with properties):\n" +
      labelLines.join("\n") +
      "\nRelationship patterns:\n" +
      (relLines.join("\n") || "  (none yet)")
    );
  } finally {
    await session.close();
  }
}

// Run a (validated read-only) Cypher query and return the raw records.
export async function runReadQuery(cypher) {
  const session = driver.session({ defaultAccessMode: neo4j.session.READ });
  try {
    const result = await session.run(cypher);
    return result.records;
  } finally {
    await session.close();
  }
}

// Delete everything. Handy for a fresh start from the UI.
export async function clearGraph() {
  const session = driver.session();
  try {
    await session.run("MATCH (n) DETACH DELETE n");
  } finally {
    await session.close();
  }
}

export async function close() {
  await driver.close();
}

// Build a small HTML tooltip string for a node from its properties.
function formatProps(label, props = {}) {
  const lines = [`(:${label})`];
  for (const [k, v] of Object.entries(props)) {
    lines.push(`${k}: ${Array.isArray(v) ? v.join(", ") : v}`);
  }
  return lines.join("\n");
}
