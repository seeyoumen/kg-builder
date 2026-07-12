// Frontend for the KG Builder.
// Drives the three-step pipeline and renders the live graph from the DB.

const $ = (id) => document.getElementById(id);

// --- graph (vis-network) ----------------------------------------------------

const nodes = new vis.DataSet([]);
const edges = new vis.DataSet([]);

const network = new vis.Network(
  $("graph"),
  { nodes, edges },
  {
    nodes: {
      shape: "dot",
      size: 18,
      borderWidth: 2,
      font: { color: "#e6ebf5", size: 14, face: "Segoe UI" },
    },
    edges: {
      arrows: "to",
      color: { color: "#5b6b8c", highlight: "#6ea8fe", hover: "#6ea8fe" },
      font: { color: "#9fb0d0", size: 11, strokeWidth: 0, background: "rgba(13,18,29,0.75)" },
      smooth: { type: "continuous" },
      width: 1.5,
      hoverWidth: 1,
    },
    // Softer, springy force-directed layout that spreads out and doesn't clump.
    physics: {
      enabled: true,
      solver: "forceAtlas2Based",
      forceAtlas2Based: {
        gravitationalConstant: -60,
        centralGravity: 0.008,
        springLength: 120,
        springConstant: 0.08,
        damping: 0.5,
        avoidOverlap: 0.6,
      },
      stabilization: { enabled: true, iterations: 150, fit: true },
      minVelocity: 0.6,
    },
    interaction: {
      hover: true,
      tooltipDelay: 120,
      zoomView: true, // scroll to zoom
      dragView: true, // drag the background to pan
      dragNodes: true, // drag nodes around
      zoomSpeed: 0.7,
      multiselect: true,
      navigationButtons: false, // we provide our own styled controls
    },
  }
);

// Double-click a node to zoom in on it.
network.on("doubleClick", (params) => {
  if (params.nodes.length) {
    network.focus(params.nodes[0], { scale: 1.5, animation: { duration: 400 } });
  }
});

// --- graph controls (zoom / fit / freeze) -----------------------------------

function zoomBy(factor) {
  network.moveTo({ scale: network.getScale() * factor, animation: { duration: 180 } });
}
$("zoom-in").addEventListener("click", () => zoomBy(1.3));
$("zoom-out").addEventListener("click", () => zoomBy(1 / 1.3));
$("zoom-fit").addEventListener("click", () => network.fit({ animation: { duration: 300 } }));

let physicsOn = true;
$("btn-physics").addEventListener("click", () => {
  physicsOn = !physicsOn;
  network.setOptions({ physics: { enabled: physicsOn } });
  $("btn-physics").textContent = physicsOn ? "❄ freeze" : "▶ resume";
});

// --- highlighting (used by the query feature) -------------------------------

let activeHighlight = null;

function applyHighlight(h) {
  activeHighlight = h;
  const ns = new Set(h.nodeIds || []);
  const es = new Set(h.edgeIds || []);
  nodes.update(nodes.getIds().map((id) => ({ id, opacity: ns.size ? (ns.has(id) ? 1 : 0.12) : 1 })));
  edges.update(
    edges.getIds().map((id) => ({
      id,
      color: { color: es.has(id) ? "#7ee0b8" : "#2a344b", highlight: "#7ee0b8" },
      width: es.has(id) ? 2.6 : 0.6,
    }))
  );
  if (ns.size) network.fit({ nodes: [...ns], animation: { duration: 500 } });
}

function clearHighlight() {
  activeHighlight = null;
  nodes.update(nodes.getIds().map((id) => ({ id, opacity: 1 })));
  edges.update(edges.getIds().map((id) => ({ id, color: { color: "#5b6b8c", highlight: "#6ea8fe" }, width: 1.5 })));
}

// --- tabs -------------------------------------------------------------------

function setTab(which) {
  const build = which === "build";
  $("tab-build").hidden = !build;
  $("tab-ask").hidden = build;
  $("tab-btn-build").classList.toggle("active", build);
  $("tab-btn-ask").classList.toggle("active", !build);
}
$("tab-btn-build").addEventListener("click", () => setTab("build"));
$("tab-btn-ask").addEventListener("click", () => setTab("ask"));

// --- ask the graph (NL -> Cypher -> run -> highlight -> summary) ------------

const EXAMPLE_QUESTIONS = [
  "Who won the Nobel Prize in Physics?",
  "What did Marie Curie discover?",
  "Show everything connected to Apple Inc.",
  "Who founded Apple?",
];
$("q-examples").innerHTML = EXAMPLE_QUESTIONS.map((q) => `<button class="ex" type="button">${esc(q)}</button>`).join("");
$("q-examples").addEventListener("click", (e) => {
  if (e.target.classList.contains("ex")) $("question").value = e.target.textContent;
});

$("btn-gen-cypher").addEventListener("click", async () => {
  const question = $("question").value.trim();
  if (!question) return toast("Type a question first.", "err");
  const btn = $("btn-gen-cypher");
  const orig = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner"></span>Writing Cypher…`;
  $("card-query-cypher").hidden = true;
  $("card-results").hidden = true;
  try {
    const res = await fetch("/api/query/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question, mode: $("match-mode").value }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "failed to generate query");
    $("query-cypher").value = data.cypher;
    $("card-query-cypher").hidden = false;
  } catch (err) {
    toast(err.message, "err");
  } finally {
    btn.disabled = false;
    btn.innerHTML = orig;
  }
});

$("btn-run-query").addEventListener("click", async () => {
  const cypher = $("query-cypher").value.trim();
  const question = $("question").value.trim();
  if (!cypher) return;
  const btn = $("btn-run-query");
  const orig = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner"></span>Running & summarizing…`;
  try {
    const res = await fetch("/api/query/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question, cypher }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "query failed");
    applyHighlight(data.highlight || { nodeIds: [], edgeIds: [] });
    renderResults(data);
    $("card-results").hidden = false;
  } catch (err) {
    toast(err.message, "err");
  } finally {
    btn.disabled = false;
    btn.innerHTML = orig;
  }
});

$("btn-clear-hl").addEventListener("click", clearHighlight);

function renderResults(data) {
  $("answer").textContent = data.summary || "(no answer)";
  const m = data.matched || { nodes: 0, edges: 0 };
  $("match-count").textContent = `(${m.nodes} nodes · ${m.edges} rels)`;

  const rels = (data.relationships || []).map(
    (r) =>
      `<li><span class="n">${esc(r.from)}</span><span class="t">${esc(r.type)}</span><span class="n">${esc(r.to)}</span></li>`
  );
  const nodesOnly =
    !rels.length && data.nodes
      ? data.nodes.map((n) => `<li><span class="n">${esc(n.name)}</span> <span class="t">${esc(n.label)}</span></li>`)
      : [];
  const vals = (data.values || []).map((v) => `<li>${esc(String(v))}</li>`);
  $("results").innerHTML = [...rels, ...nodesOnly, ...vals].join("") || "<li>(nothing matched)</li>";
}

// Sync a DataSet to the incoming array without wiping everything (keeps layout
// stable and lets newly inserted nodes animate in).
function sync(dataset, items) {
  const incoming = new Set(items.map((i) => i.id));
  dataset.update(items);
  const stale = dataset.getIds().filter((id) => !incoming.has(id));
  if (stale.length) dataset.remove(stale);
}

function renderGraph(graph) {
  sync(nodes, graph.nodes || []);
  sync(edges, graph.edges || []);
  const n = (graph.nodes || []).length;
  $("graph-stats").textContent = `${n} nodes · ${(graph.edges || []).length} edges`;
  // Re-measure the container (defends against a stale size) and frame the nodes.
  network.setSize("100%", "100%");
  if (activeHighlight) applyHighlight(activeHighlight);
  else if (n > 0) network.fit({ animation: { duration: 400 } });
}

// --- websocket (live updates) -----------------------------------------------

function connectWS() {
  const ws = new WebSocket(`ws://${location.host}/ws`);
  ws.onopen = () => setConn("live", "ok");
  ws.onclose = () => {
    setConn("disconnected — retrying", "bad");
    setTimeout(connectWS, 2000);
  };
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.type === "graph") renderGraph(msg.graph);
  };
}

function setConn(text, cls) {
  const el = $("conn");
  el.textContent = text;
  el.className = "conn " + cls;
}

// --- pipeline state ---------------------------------------------------------

let samples = [];
let sampleIdx = 0;
let extraction = null;
let cypherScript = "";

function showSample(i) {
  const s = samples[i];
  if (!s) return;
  $("text").value = s.text;
  $("sample-hint").textContent = s.shares ? `${s.title} — ${s.shares}` : s.title || "";
}

async function loadSamples() {
  samples = await (await fetch("/api/samples")).json();
  if (samples.length) showSample(0);
}

$("btn-next").addEventListener("click", () => {
  if (!samples.length) return;
  sampleIdx = (sampleIdx + 1) % samples.length;
  showSample(sampleIdx);
  resetPipeline();
});

function resetPipeline() {
  extraction = null;
  cypherScript = "";
  $("card-extract").hidden = true;
  $("card-cypher").hidden = true;
  $("links-wrap").hidden = true;
}

// Step 1 -> 2 : Extract
$("btn-extract").addEventListener("click", async () => {
  const text = $("text").value.trim();
  if (!text) return toast("Enter some text first.", "err");

  const btn = $("btn-extract");
  const original = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner"></span>Extracting… (Claude is reading)`;
  resetPipeline();

  try {
    const res = await fetch("/api/extract", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "extraction failed");

    extraction = data.extraction;
    cypherScript = data.script;
    renderExtraction(extraction, data.links || []);
    $("card-extract").hidden = false;
    const ln = (data.links || []).length;
    toast(`Extracted ${extraction.nodes.length} entities${ln ? `, linked ${ln} to existing` : ""}.`, "ok");
  } catch (err) {
    toast(err.message, "err");
  } finally {
    btn.disabled = false;
    btn.innerHTML = original;
  }
});

function renderExtraction(ex, links = []) {
  $("node-count").textContent = `(${ex.nodes.length})`;
  $("rel-count").textContent = `(${ex.relationships.length})`;

  const nameById = new Map(ex.nodes.map((n) => [n.id, n.name]));

  $("nodes").innerHTML = ex.nodes
    .map((n) => {
      const renamed = n.linked && n.linkedFrom && n.linkedFrom.toLowerCase() !== String(n.name).toLowerCase();
      const title = renamed
        ? `matched an existing node (extracted as: ${esc(n.linkedFrom)})`
        : "already in the graph — connecting to it";
      const badge = n.linked ? ` <span class="link-badge" title="${title}">🔗</span>` : "";
      return `<li>${esc(n.name)}<span class="type">${esc(n.label)}</span>${badge}</li>`;
    })
    .join("");

  $("rels").innerHTML = ex.relationships
    .map(
      (r) =>
        `<li><span class="n">${esc(nameById.get(r.from) || r.from)}</span>` +
        `<span class="t">${esc(r.type)}</span>` +
        `<span class="n">${esc(nameById.get(r.to) || r.to)}</span></li>`
    )
    .join("");

  const wrap = $("links-wrap");
  if (links.length) {
    $("link-count").textContent = `(${links.length})`;
    $("links").innerHTML = links
      .map((l) =>
        l.renamed
          ? `<li><span class="n">${esc(l.from)}</span> → <span class="n">${esc(l.to)}</span>` +
            `<span class="method">${esc(l.method)} · ${l.score}</span></li>`
          : `<li><span class="n">${esc(l.to)}</span><span class="method">already in graph</span></li>`
      )
      .join("");
    wrap.hidden = false;
  } else {
    wrap.hidden = true;
  }
}

// Step 2 -> 3 : Preview Cypher
$("btn-preview").addEventListener("click", () => {
  $("cypher").textContent = cypherScript;
  $("card-cypher").hidden = false;
  $("card-cypher").scrollIntoView({ behavior: "smooth", block: "nearest" });
});

// Step 3 : Insert
$("btn-insert").addEventListener("click", async () => {
  if (!extraction) return;
  const btn = $("btn-insert");
  const original = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner"></span>Inserting…`;
  try {
    const res = await fetch("/api/insert", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ extraction }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "insert failed");
    if (data.graph) renderGraph(data.graph); // WS also pushes this
    toast(`Ran ${data.inserted} Cypher statements. Graph updated.`, "ok");
  } catch (err) {
    toast(err.message, "err");
  } finally {
    btn.disabled = false;
    btn.innerHTML = original;
  }
});

// Clear graph
$("btn-clear").addEventListener("click", async () => {
  if (!confirm("Delete all nodes and relationships from the database?")) return;
  try {
    const res = await fetch("/api/clear", { method: "POST" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "clear failed");
    renderGraph(data.graph);
    toast("Graph cleared.", "ok");
  } catch (err) {
    toast(err.message, "err");
  }
});

// --- little helpers ---------------------------------------------------------

let toastTimer = null;
function toast(msg, cls = "") {
  const el = $("toast");
  el.textContent = msg;
  el.className = "toast " + cls;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 3500);
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

// --- boot -------------------------------------------------------------------

loadSamples();
connectWS();
