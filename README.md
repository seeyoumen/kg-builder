# KG Builder — unstructured text → knowledge graph

A small, hands-on project for **understanding knowledge graphs**. You paste (or
pick) a paragraph of text; Claude extracts the entities and relationships; you
see the exact **Cypher** that would write them; you click **Insert**; and the
**live Neo4j graph** on the right updates in real time.

```
text  ──▶  Claude (Agent SDK)  ──▶  { nodes, relationships }  ──▶  Cypher  ──▶  Neo4j
                                                                         │
                                          browser graph  ◀── WebSocket ──┘
```

## How it works (the pieces)

| File | Role |
|------|------|
| `server/extract.js` | Calls the Claude Agent SDK to turn text into `{ nodes, relationships }` |
| `server/resolve.js` | **Entity resolution** — links new entities to ones already in the graph (exact / short↔full-form / subset matching, type-gated) so snippets connect instead of forming islands |
| `server/cypher.js`  | Turns that structure into Cypher (a readable version to *show*, a parameterized version to *run*) |
| `server/query.js` + `claude.js` | **NL → Cypher** query translation and result **summarization** (Claude Agent SDK) |
| `server/results.js` | Parses query results into graph-highlight ids + a summary-ready view; enforces read-only |
| `server/neo4j.js`   | Talks to Neo4j (run statements, read the whole graph for the viz) |
| `server/index.js`   | Express API + WebSocket that pushes live graph updates |
| `public/`           | The single-page UI (vis-network for the graph) |

## Entity resolution (connecting snippets)

Before inserting, each new entity is matched against what's already in the graph, so successive snippets build **one connected graph** instead of isolated islands. The matching ladder (strict → loose), type-gated so a `Place` never merges into an `Organization`:

1. **exact** — `"Steve Jobs"` == `"Steve Jobs"`
2. **normalized** — drop legal suffixes / leading "the": `"Apple"` ≈ `"Apple Inc."`
3. **word-subset** — `"Nobel Prize"` ⊆ `"Nobel Prize in Physics"`
4. **substring / word-overlap** — looser fallbacks

A confident match (score ≥ 0.7) canonicalizes the new entity to the existing node so the `MERGE` lands on it. The UI shows every match in a "🔗 Linked to existing graph" panel. Unit tests: `node server/resolve.test.mjs`.

The built-in samples deliberately overlap (e.g. Curie & Einstein share *Nobel Prize in Physics*; Apple, Pixar & Tim Cook share *Apple Inc.* / *Steve Jobs*) so you can watch clusters connect as you insert.

## Ask the graph (natural-language query)

The **🔍 Ask** tab turns a plain-English question into a query:

1. Type a question → **Generate Cypher**: Claude (given the live graph schema) writes a **read-only** Cypher query, shown in an editable box so you can inspect/tweak it.
2. **Run & highlight**: the query runs against Neo4j; the matching nodes/relationships **light up in the graph** (everything else dims) and the view zooms to them.
3. **Answer**: Claude summarizes the returned subgraph in plain English, grounded only in the results.

Safety: generated/edited queries pass a **read-only guard** (single statement; no `CREATE/MERGE/SET/DELETE/CALL/LOAD`) before execution, so the Ask tab can never mutate the graph.

## Prerequisites (to run after cloning)

- **Node.js 18+** — `node -v`
- **Docker Desktop**, running — hosts Neo4j
- **Claude access** — one of the two options under [Claude authentication](#claude-authentication-what-a-new-user-needs) below

## Run it (from a fresh clone)

```bash
git clone <this-repo-url> kg-builder
cd kg-builder

# 1. install dependencies
npm install

# 2. start Neo4j (first run pulls the image, then runs it)
npm run db:up
#    Neo4j Browser: http://localhost:7474   (user: neo4j / pass: kgdemo123)

# 3. authenticate Claude (see next section), then start the app
npm start
#    open http://localhost:3100
```

Later runs: `npm run db:start` instead of `db:up` (reuses the same container + its data).

## Claude authentication (what a new user needs)

The app calls Claude through the **Claude Agent SDK** (`@anthropic-ai/claude-agent-sdk`)
— for extracting entities/relationships from text, translating questions to Cypher,
and summarizing answers. You must provide credentials **one of two ways — pick ONE**:

### Option A — Anthropic API key (most portable)

Works for anyone with an Anthropic Console account; billed per token (pay-as-you-go).

1. Create a key at <https://console.anthropic.com> → **API Keys**.
2. Ensure that key's workspace can use the model in `KG_MODEL` (default `claude-opus-4-8`).
3. Set it in the same shell before `npm start`:

```bash
export ANTHROPIC_API_KEY="sk-ant-..."      # macOS / Linux / Git Bash
$env:ANTHROPIC_API_KEY = "sk-ant-..."      # Windows PowerShell
```

### Option B — an existing Claude Code login (no API key; uses your subscription)

If the machine already has **Claude Code** installed and you are **logged in**, the
Agent SDK reuses that session's credentials (`~/.claude/.credentials.json`) — **no
`ANTHROPIC_API_KEY` needed**. Requirements:

- **Claude Code** installed and logged in:
  ```bash
  npm install -g @anthropic-ai/claude-code
  claude          # then run /login once and sign in
  ```
- A **Claude Pro or Max subscription** (or a Console/Team plan) on that account whose
  plan can use the model in `KG_MODEL`.

> The server auto-detects this: if it finds **neither** an API key **nor** a logged-in
> Claude Code session, the first **Extract** or **Ask** action returns an auth error
> telling you to set `ANTHROPIC_API_KEY` or log into Claude Code.

**Only setting that matters:** `KG_MODEL` (default `claude-opus-4-8`). If your key/plan
can't use Opus, pick one it can, e.g.:

```bash
export KG_MODEL="claude-sonnet-5"          # Git Bash
$env:KG_MODEL = "claude-sonnet-5"          # PowerShell
```

## Config (env vars, all optional)

| Var | Default | Meaning |
|-----|---------|---------|
| `PORT` | `3100` | Web server port |
| `NEO4J_URI` | `bolt://localhost:7687` | Neo4j bolt endpoint |
| `NEO4J_USER` / `NEO4J_PASSWORD` | `neo4j` / `kgdemo123` | Neo4j credentials |
| `KG_MODEL` | `claude-opus-4-8` | Model used for extraction |

## Teardown

```bash
npm run db:stop   # stop Neo4j (keeps data)
npm run db:rm     # remove the container (data volume kg-neo4j-data persists)
```
