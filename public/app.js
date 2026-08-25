// Frontend for the KG Builder.
// Drives the three-step pipeline and renders the live graph from the DB.
// 知识图谱构建器前端
// 驱动三步流程并从数据库渲染实时图谱

const $ = (id) => document.getElementById(id);

// --- graph (vis-network) ----------------------------------------------------
// --- 图谱（vis-network）-----------------------------------------------------

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
      zoomView: true, // 滚动缩放
      dragView: true, // 拖拽背景平移
      dragNodes: true, // 拖拽节点
      zoomSpeed: 0.7,
      multiselect: true,
      navigationButtons: false, // 我们提供自己的样式控件
    },
  }
);

// Double-click a node to zoom in on it.
// 双击节点以放大查看
network.on("doubleClick", (params) => {
  if (params.nodes.length) {
    network.focus(params.nodes[0], { scale: 1.5, animation: { duration: 400 } });
  }
});

// --- graph controls (zoom / fit / freeze) -----------------------------------
// --- 图谱控制（缩放/适应/冻结）----------------------------------------------

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
  $("btn-physics").textContent = physicsOn ? "❄ 冻结" : "▶ 恢复";
});

// --- highlighting (used by the query feature) -------------------------------
// --- 高亮（用于查询功能）----------------------------------------------------

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
// --- 选项卡 -----------------------------------------------------------------

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
// --- 查询图谱（自然语言 -> Cypher -> 运行 -> 高亮 -> 总结）-------------------

const EXAMPLE_QUESTIONS = [
  "谁获得了诺贝尔物理学奖？",
  "居里夫人发现了什么？",
  "显示与苹果公司相关的所有内容",
  "谁创立了苹果？",
];
$("q-examples").innerHTML = EXAMPLE_QUESTIONS.map((q) => `<button class="ex" type="button">${esc(q)}</button>`).join("");
$("q-examples").addEventListener("click", (e) => {
  if (e.target.classList.contains("ex")) $("question").value = e.target.textContent;
});

$("btn-gen-cypher").addEventListener("click", async () => {
  const question = $("question").value.trim();
  if (!question) return toast("请先输入问题。", "err");
  const btn = $("btn-gen-cypher");
  const orig = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner"></span>正在编写 Cypher…`;
  $("card-query-cypher").hidden = true;
  $("card-results").hidden = true;
  try {
    const res = await fetch("/api/query/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question, mode: $("match-mode").value }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "生成查询失败");
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
  btn.innerHTML = `<span class="spinner"></span>正在运行并总结…`;
  try {
    const res = await fetch("/api/query/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question, cypher }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "查询失败");
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
  $("answer").textContent = data.summary || "(无答案)";
  const m = data.matched || { nodes: 0, edges: 0 };
  $("match-count").textContent = `(${m.nodes} 个节点 · ${m.edges} 个关系)`;

  const rels = (data.relationships || []).map(
    (r) =>
      `<li><span class="n">${esc(r.from)}</span><span class="t">${esc(r.type)}</span><span class="n">${esc(r.to)}</span></li>`
  );
  const nodesOnly =
    !rels.length && data.nodes
      ? data.nodes.map((n) => `<li><span class="n">${esc(n.name)}</span> <span class="t">${esc(n.label)}</span></li>`)
      : [];
  const vals = (data.values || []).map((v) => `<li>${esc(String(v))}</li>`);
  $("results").innerHTML = [...rels, ...nodesOnly, ...vals].join("") || "<li>(无匹配结果)</li>";
}

// Sync a DataSet to the incoming array without wiping everything (keeps layout
// stable and lets newly inserted nodes animate in).
// 同步 DataSet 以保留布局稳定性，并使新插入的节点带动画效果
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
  $("graph-stats").textContent = `${n} 个节点 · ${(graph.edges || []).length} 个关系`;
  // Re-measure the container (defends against a stale size) and frame the nodes.
  network.setSize("100%", "100%");
  if (activeHighlight) applyHighlight(activeHighlight);
  else if (n > 0) network.fit({ animation: { duration: 400 } });
}

// --- websocket (live updates) -----------------------------------------------
// --- WebSocket（实时更新）---------------------------------------------------

function connectWS() {
  const ws = new WebSocket(`ws://${location.host}/ws`);
  ws.onopen = () => setConn("已连接", "ok");
  ws.onclose = () => {
    setConn("已断开 — 重试中", "bad");
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
// --- 流程状态 ----------------------------------------------------------------

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
// 步骤 1 -> 2：提取
$("btn-extract").addEventListener("click", async () => {
  const text = $("text").value.trim();
  if (!text) return toast("请先输入一些文本。", "err");

  const btn = $("btn-extract");
  const original = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner"></span>正在提取… (Claude 正在阅读)`;
  resetPipeline();

  try {
    const res = await fetch("/api/extract", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "提取失败");

    extraction = data.extraction;
    cypherScript = data.script;
    renderExtraction(extraction, data.links || []);
    $("card-extract").hidden = false;
    const ln = (data.links || []).length;
    toast(`已提取 ${extraction.nodes.length} 个实体${ln ? `，其中 ${ln} 个已链接到现有图谱` : ""}。`, "ok");
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
        ? `已匹配到现有节点（提取名称：${esc(n.linkedFrom)}）`
        : "已在图谱中 — 正在连接";
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
          : `<li><span class="n">${esc(l.to)}</span><span class="method">已在图谱中</span></li>`
      )
      .join("");
    wrap.hidden = false;
  } else {
    wrap.hidden = true;
  }
}

// Step 2 -> 3 : Preview Cypher
// 步骤 2 -> 3：预览 Cypher
$("btn-preview").addEventListener("click", () => {
  $("cypher").textContent = cypherScript;
  $("card-cypher").hidden = false;
  $("card-cypher").scrollIntoView({ behavior: "smooth", block: "nearest" });
});

// Step 3 : Insert
// 步骤 3：插入
$("btn-insert").addEventListener("click", async () => {
  if (!extraction) return;
  const btn = $("btn-insert");
  const original = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner"></span>正在插入…`;
  try {
    const res = await fetch("/api/insert", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ extraction }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "插入失败");
    if (data.graph) renderGraph(data.graph); // WS also pushes this
    toast(`已执行 ${data.inserted} 条 Cypher 语句。图谱已更新。`, "ok");
  } catch (err) {
    toast(err.message, "err");
  } finally {
    btn.disabled = false;
    btn.innerHTML = original;
  }
});

// Clear graph
// 清空图谱
$("btn-clear").addEventListener("click", async () => {
  if (!confirm("确定要删除数据库中的所有节点和关系吗？")) return;
  try {
    const res = await fetch("/api/clear", { method: "POST" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "清空失败");
    renderGraph(data.graph);
    toast("图谱已清空。", "ok");
  } catch (err) {
    toast(err.message, "err");
  }
});

// --- little helpers ---------------------------------------------------------
// --- 辅助函数 ----------------------------------------------------------------

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
// --- 启动 -------------------------------------------------------------------

loadSamples();
connectWS();
