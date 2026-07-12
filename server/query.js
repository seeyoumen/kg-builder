// Natural-language querying:
//   generateCypher(question, schema) -> a READ-ONLY Cypher query
//   summarizeResults(question, resultsText) -> a short NL answer
import { runClaude } from "./claude.js";

const CYPHER_SYSTEM = `You translate a natural-language question into ONE read-only Neo4j Cypher query over a knowledge graph.

Output rules:
- Output ONLY the Cypher query. No prose, no explanation, no markdown code fences.
- READ ONLY. Use only MATCH, OPTIONAL MATCH, WHERE, WITH, UNWIND, RETURN, ORDER BY, SKIP, LIMIT and aggregation functions (count, collect, etc.).
- NEVER use CREATE, MERGE, SET, DELETE, DETACH, REMOVE, DROP, FOREACH, LOAD CSV, or CALL. A single statement only (no semicolons).
- Prefer to RETURN whole nodes and relationships so the result can be drawn, e.g. "MATCH (a)-[r]->(b) RETURN a, r, b". Return scalars/aggregates only when the question asks to count or aggregate.
- Match names case-insensitively: WHERE toLower(n.name) CONTAINS toLower("apple").
- Add a LIMIT (e.g. 50) to open-ended queries. Use ONLY the labels, relationship types, and property keys in the schema.

RELATIONSHIP BREADTH — widen WITHIN the question's intent, prune OUTSIDE it:
- Never lock onto a single relationship type when the schema has SYNONYMS/SUBTYPES of the same idea — include them all via alternation, e.g. [:WORKED_AT|EMPLOYED_BY]. This is the breadth that avoids empty results.
- But do NOT union in relationship types with a DIFFERENT or OPPOSITE meaning. Match the verb's actual meaning:
    "work at / employed by"          -> WORKED_AT                 (NOT FOUNDED, CHIEF_EXECUTIVE_OF, ACQUIRED)
    "found / create / build / start" -> FOUNDED|CREATED|DEVELOPED (NOT ACQUIRED — acquiring an existing thing is not creating it)
    "lead / run / head / CEO of"     -> CHIEF_EXECUTIVE_OF|FOUNDED
    "discovered / invented"          -> DISCOVERED|DEVELOPED
  Include the types whose names/meaning clearly match the verb; leave the rest out.

DIRECT vs PATH — match the query shape to the question:
- If the question names a SPECIFIC relationship (born -> BORN_IN, discovered -> DISCOVERED, won -> WON, married -> MARRIED_TO, founded -> FOUNDED), use that edge DIRECTLY, e.g. MATCH (a)-[:BORN_IN]->(b). Do NOT use variable-length / shortestPath for these — it routes through shared hub nodes (a shared award, a shared employer) and drags in unrelated entities.
- Use shortestPath ONLY when the connection is genuinely indirect:
    (a) "how are A and B related/connected" with BOTH entities named -> shortestPath between those two NAMED nodes: shortestPath((a)-[*..6]-(b)).
    (b) a place that hangs off an organization, e.g. "which city did <person> work in" -> traverse person -> org -> place EXPLICITLY (this also drops orgs with no location):
        MATCH (p:Person)-[:WORKED_AT|FOUNDED|CHIEF_EXECUTIVE_OF]->(o:Organization)-[:LOCATED_IN|FOUNDED_IN|PART_OF]->(place:Place)
        WHERE toLower(p.name) CONTAINS toLower("X") RETURN p, o, place
- NEVER write shortestPath from one node to ALL nodes of a label (e.g. a person to every :Place). Always bind BOTH endpoints — two named entities, or one named entity plus a concrete pattern that ENDS at the requested target type.

RETURN ONLY WHAT ANSWERS THE QUESTION:
- When a specific target type is requested (a Place, a company, a person), return/highlight only nodes and relationships on a path that actually REACHES that target. Drop dead-end branches (e.g. an organization with no location, for a "which city" question).
- Honor explicit constraints/exclusions with a WHERE clause: "before / other than / except Apple" -> AND NOT toLower(o.name) CONTAINS toLower("apple"); "who did NOT / didn't ..." -> WHERE NOT EXISTS { ... }.
- Geographic qualifiers like "in the USA / in the US / in America / in Europe" must NEVER become a property filter. Do NOT write place.country CONTAINS "usa" (or = "USA"), place.state = ..., etc. — those properties are only sometimes populated, so such a filter almost always returns NOTHING. IGNORE the geographic qualifier: return the matching place(s) as if it were absent, and let the summary mention the region. Same for other narrow property-equality filters (an exact year, etc.) unless the question is specifically asking for that property value.`;

// Optional user-chosen matching strategy, appended as a steering note.
const MODE_INSTRUCTIONS = {
  auto: "",
  direct:
    "\n\nMATCH MODE = DIRECT (strict): Use ONLY the single most specific relationship type that literally matches the question's verb. Do NOT broaden to synonyms/related types and do NOT use variable-length or shortestPath traversals. Keep the pattern minimal and exact.",
  broad:
    "\n\nMATCH MODE = BROAD: Cast a wide net WITHIN the question's intent — include every relationship type that is a synonym or subtype of the asked idea via alternation, e.g. [:A|B|C]. Still exclude types with a different or opposite meaning.",
  path:
    "\n\nMATCH MODE = PATH / CONNECTIONS: Prefer variable-length and shortestPath traversals to surface indirect, multi-hop connections. Bind the endpoints and RETURN whole paths so intermediate nodes are included.",
};

export async function generateCypher(question, schema, mode = "auto") {
  const modeNote = MODE_INSTRUCTIONS[mode] || "";
  const prompt = `Graph schema:\n${schema}\n\nQuestion: ${question}${modeNote}\n\nCypher query:`;
  let cypher = await runClaude(CYPHER_SYSTEM, prompt);
  // Strip any stray code fences just in case.
  cypher = cypher.replace(/```(?:cypher)?/gi, "").replace(/```/g, "").trim();
  return cypher;
}

const SUMMARY_SYSTEM = `You answer a question using ONLY the query results from a knowledge graph provided to you.
- Be concise: 2-4 sentences of plain prose.
- Use only facts present in the results; never invent or add outside knowledge.
- Do NOT state any date, number, name, or attribute that is not explicitly present in the provided results.
- The results are empty ONLY if there are no nodes, no relationships, AND no values. A list of nodes with no relationships is still a valid, non-empty answer — describe those nodes; do NOT say nothing was found.`;

export async function summarizeResults(question, resultsText) {
  const prompt = `Question: ${question}\n\nQuery results from the graph:\n${resultsText}\n\nAnswer:`;
  return runClaude(SUMMARY_SYSTEM, prompt);
}
