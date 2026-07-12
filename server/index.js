// Express + WebSocket server that ties the pieces together:
//
//   GET  /api/samples          -> the built-in text snippets
//   POST /api/extract {text}   -> { extraction, statements, script }   (Claude)
//   POST /api/insert {extraction} -> runs Cypher on Neo4j, returns fresh graph
//   POST /api/clear            -> wipes the graph
//   GET  /api/graph            -> current graph (nodes/edges for vis-network)
//   WS   /ws                   -> pushes the live graph to the browser on change

import express from "express";
import { WebSocketServer } from "ws";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { SAMPLES } from "./data/samples.js";
import { extractGraph } from "./extract.js";
import { resolveAgainstExisting } from "./resolve.js";
import { generateStatements, statementsToScript } from "./cypher.js";
import { generateCypher, summarizeResults } from "./query.js";
import { assertReadOnly, extractResults, resultsToText } from "./results.js";
import * as db from "./neo4j.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3100;

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "..", "public")));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

// --- websocket broadcast -----------------------------------------------------

function broadcastGraph(graph) {
  const payload = JSON.stringify({ type: "graph", graph });
  for (const client of wss.clients) {
    if (client.readyState === 1 /* OPEN */) client.send(payload);
  }
}

wss.on("connection", async (ws) => {
  try {
    ws.send(JSON.stringify({ type: "graph", graph: await db.getGraph() }));
  } catch (err) {
    ws.send(JSON.stringify({ type: "error", message: String(err.message || err) }));
  }
});

// --- routes ------------------------------------------------------------------

app.get("/api/samples", (_req, res) => {
  res.json(SAMPLES);
});

app.post("/api/extract", async (req, res) => {
  const text = (req.body?.text || "").trim();
  if (!text) return res.status(400).json({ error: "No text provided." });
  try {
    const raw = await extractGraph(text);
    // Link the fresh entities to anything already in the graph.
    const existing = await db.getEntities();
    const { extraction, links } = resolveAgainstExisting(raw, existing);
    const statements = generateStatements(extraction);
    res.json({ extraction, links, statements, script: statementsToScript(statements) });
  } catch (err) {
    console.error("extract error:", err);
    res.status(500).json({ error: String(err.message || err) });
  }
});

app.post("/api/insert", async (req, res) => {
  const incoming = req.body?.extraction;
  if (!incoming?.nodes) return res.status(400).json({ error: "No extraction provided." });
  try {
    // Re-resolve at insert time in case the graph changed since extraction.
    const existing = await db.getEntities();
    const { extraction } = resolveAgainstExisting(incoming, existing);
    const statements = generateStatements(extraction);
    await db.runStatements(statements);
    const graph = await db.getGraph();
    broadcastGraph(graph);
    res.json({ ok: true, inserted: statements.length, graph });
  } catch (err) {
    console.error("insert error:", err);
    res.status(500).json({ error: String(err.message || err) });
  }
});

app.post("/api/clear", async (_req, res) => {
  try {
    await db.clearGraph();
    const graph = await db.getGraph();
    broadcastGraph(graph);
    res.json({ ok: true, graph });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

app.get("/api/graph", async (_req, res) => {
  try {
    res.json(await db.getGraph());
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

// NL question -> read-only Cypher (shown to the user before running).
app.post("/api/query/generate", async (req, res) => {
  const question = (req.body?.question || "").trim();
  const mode = req.body?.mode || "auto";
  if (!question) return res.status(400).json({ error: "No question provided." });
  try {
    const schema = await db.getSchema();
    const cypher = await generateCypher(question, schema, mode);
    res.json({ cypher });
  } catch (err) {
    console.error("query/generate error:", err);
    res.status(500).json({ error: String(err.message || err) });
  }
});

// Run a read-only Cypher query -> highlight ids + structured results + summary.
app.post("/api/query/run", async (req, res) => {
  const question = (req.body?.question || "").trim();
  const cypher = (req.body?.cypher || "").trim();
  if (!cypher) return res.status(400).json({ error: "No query provided." });
  try {
    assertReadOnly(cypher);
    const records = await db.runReadQuery(cypher);
    const parsed = extractResults(records);
    const summary = await summarizeResults(question || "Summarize these results.", resultsToText(parsed));
    res.json({
      highlight: parsed.highlight,
      nodes: parsed.nodes,
      relationships: parsed.relationships,
      values: parsed.values,
      summary,
      matched: { nodes: parsed.nodes.length, edges: parsed.highlight.edgeIds.length },
    });
  } catch (err) {
    console.error("query/run error:", err);
    res.status(400).json({ error: String(err.message || err) });
  }
});

// --- startup -----------------------------------------------------------------

async function waitForNeo4j(retries = 15, delayMs = 2000) {
  for (let i = 1; i <= retries; i++) {
    try {
      await db.verifyConnection();
      return true;
    } catch (err) {
      console.log(`Waiting for Neo4j (${i}/${retries})... ${err.code || err.message}`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  return false;
}

async function main() {
  const connected = await waitForNeo4j();
  if (!connected) {
    console.error(
      "\nCould not connect to Neo4j at bolt://localhost:7687.\n" +
        "Start it with:  npm run db:up   (first time)  or  npm run db:start\n"
    );
  } else {
    console.log("Connected to Neo4j.");
  }

  server.listen(PORT, () => {
    console.log(`\nKG Builder running:  http://localhost:${PORT}\n`);
  });
}

main();

process.on("SIGINT", async () => {
  await db.close();
  process.exit(0);
});
