// Entity resolution: link newly-extracted entities to ones already in the graph
// so successive snippets build ONE connected graph instead of isolated islands.
//
// For each candidate node we ask "have we seen this thing before?" using a
// ladder of string heuristics, from strict to loose:
//
//   exact            "Steve Jobs"            == "Steve Jobs"
//   normalized       "Apple"                 == "Apple Inc."      (drop legal suffix / leading "the")
//   word-subset      "Nobel Prize"           ⊆  "Nobel Prize in Physics"
//   substring        "...Paris..."           in "University of Paris" (word boundary)
//   word-overlap     Jaccard of tokens ≥ 0.6
//
// A confident match (score ≥ 0.7, label-compatible) rewrites the candidate to
// the EXISTING canonical name+label, so the MERGE lands on the same node and the
// graphs connect. We also return the list of links for the UI to show.

const LEGAL_SUFFIXES = new Set([
  "inc", "incorporated", "corp", "corporation", "ltd", "limited",
  "llc", "co", "company", "group", "plc", "gmbh", "sa", "ag",
]);
const STOP = new Set(["the", "of", "a", "an", "and", "in", "at", "for", "de", "di", "van", "von"]);

const AUTO_LINK = 0.7;

function tokenize(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter(Boolean);
}

// "Apple Inc." -> ["apple"], "The Beatles" -> ["beatles"], "University of Paris" -> ["university","of","paris"]
function coreTokens(s) {
  let t = tokenize(s);
  if (t.length > 1 && t[0] === "the") t = t.slice(1);
  while (t.length > 1 && LEGAL_SUFFIXES.has(t[t.length - 1])) t = t.slice(0, -1);
  return t;
}
const core = (s) => coreTokens(s).join(" ");
const contentTokens = (s) => coreTokens(s).filter((x) => !STOP.has(x));

function isSubset(small, big) {
  const set = new Set(big);
  return small.length > 0 && small.every((x) => set.has(x));
}
function jaccard(a, b) {
  const A = new Set(a), B = new Set(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

// Score one candidate name against one existing name. Returns {score, method} or null.
export function scorePair(candName, existName) {
  const cRaw = String(candName).toLowerCase().trim();
  const eRaw = String(existName).toLowerCase().trim();
  if (!cRaw || !eRaw) return null;
  if (cRaw === eRaw) return { score: 1.0, method: "exact" };

  const cCore = core(candName), eCore = core(existName);
  if (cCore && cCore === eCore) return { score: 0.95, method: "normalized" };

  const cTok = contentTokens(candName), eTok = contentTokens(existName);
  if (cTok.length && eTok.length && (isSubset(cTok, eTok) || isSubset(eTok, cTok))) {
    const shorter = cTok.length <= eTok.length ? cTok : eTok;
    // require ≥2 tokens so we don't merge "Paris" into "University of Paris"
    if (shorter.length >= 2) return { score: 0.85, method: "word-subset" };
  }

  if (cCore.length >= 4 && eCore.length >= 4) {
    const [s, l] = cCore.length <= eCore.length ? [cCore, eCore] : [eCore, cCore];
    const re = new RegExp("\\b" + s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b");
    if (re.test(l)) return { score: 0.72, method: "substring" };
  }

  const j = jaccard(cTok, eTok);
  if (j >= 0.6) return { score: Number(j.toFixed(2)), method: "word-overlap" };

  return null;
}

// Cross-label linking is only allowed on very strong (exact/normalized) matches,
// so we don't merge e.g. a Place into an Organization on a loose token overlap.
function labelsCompatible(a, b, method) {
  if (!a || !b || a === b) return true;
  if (a === "Entity" || b === "Entity") return true;
  return method === "exact" || method === "normalized";
}

// existing: [{ name, label }] already in the DB.
// Returns { extraction (with matched nodes canonicalized), links }.
export function resolveAgainstExisting(extraction, existing = []) {
  const links = [];

  const nodes = (extraction.nodes || []).map((node) => {
    let best = null;
    for (const ex of existing) {
      const res = scorePair(node.name, ex.name);
      if (!res || res.score < AUTO_LINK) continue;
      if (!labelsCompatible(node.label, ex.label, res.method)) continue;
      if (!best || res.score > best.score) best = { ...res, existing: ex };
    }

    if (best) {
      const renamed = String(best.existing.name).toLowerCase() !== String(node.name).toLowerCase();
      links.push({
        from: node.name,
        to: best.existing.name,
        fromLabel: node.label,
        toLabel: best.existing.label,
        method: best.method,
        score: Number(best.score.toFixed(2)),
        renamed, // true = short/full-form normalization; false = same name already present
      });
      // Canonicalize to the existing node so the MERGE connects the graphs.
      return {
        ...node,
        name: best.existing.name,
        label: best.existing.label || node.label,
        linkedFrom: node.name,
        linked: true,
      };
    }
    return node;
  });

  return {
    extraction: { ...extraction, nodes, relationships: extraction.relationships || [] },
    links,
  };
}
