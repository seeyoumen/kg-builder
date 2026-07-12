// Quick, dependency-free checks for the entity resolver.
// Run: node server/resolve.test.mjs
import { scorePair, resolveAgainstExisting } from "./resolve.js";

let pass = 0, fail = 0;
function check(desc, cond) {
  if (cond) { pass++; console.log("  ok  " + desc); }
  else { fail++; console.log("FAIL  " + desc); }
}

console.log("scorePair:");
check("exact", scorePair("Steve Jobs", "Steve Jobs")?.method === "exact");
check("normalized short-form (Apple ~ Apple Inc.)", scorePair("Apple", "Apple Inc.")?.method === "normalized");
check("normalized article (The Beatles ~ Beatles)", scorePair("The Beatles", "Beatles")?.method === "normalized");
check("word-subset (Nobel Prize ⊆ Nobel Prize in Physics)", scorePair("Nobel Prize", "Nobel Prize in Physics")?.method === "word-subset");
check("no false single-token subset (Paris vs University of Paris)", (scorePair("Paris", "University of Paris")?.method || "") !== "word-subset");
check("unrelated -> null", scorePair("Radium", "Toy Story") === null);

console.log("resolveAgainstExisting:");
const existing = [
  { name: "Nobel Prize in Physics", label: "Award" },
  { name: "Apple Inc.", label: "Organization" },
  { name: "University of Paris", label: "Organization" },
];

// Einstein's award should link to the existing Nobel Prize node.
const r1 = resolveAgainstExisting(
  { nodes: [{ id: "npp", name: "Nobel Prize in Physics", label: "Award", properties: {} }], relationships: [] },
  existing
);
check("exact award links", r1.links.length === 1 && r1.links[0].to === "Nobel Prize in Physics");

// "Apple" should canonicalize to "Apple Inc."
const r2 = resolveAgainstExisting(
  { nodes: [{ id: "apple", name: "Apple", label: "Organization", properties: {} }], relationships: [] },
  existing
);
check("Apple canonicalizes to Apple Inc.", r2.extraction.nodes[0].name === "Apple Inc." && r2.extraction.nodes[0].linkedFrom === "Apple");

// A brand-new entity should NOT link.
const r3 = resolveAgainstExisting(
  { nodes: [{ id: "spacex", name: "SpaceX", label: "Organization", properties: {} }], relationships: [] },
  existing
);
check("new entity does not link", r3.links.length === 0 && r3.extraction.nodes[0].name === "SpaceX");

// Label gating: a Place named "Paris" must NOT merge into the Organization "University of Paris".
const r4 = resolveAgainstExisting(
  { nodes: [{ id: "paris", name: "Paris", label: "Place", properties: {} }], relationships: [] },
  existing
);
check("label-gated: Paris(Place) not merged into University of Paris(Org)", r4.links.length === 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
