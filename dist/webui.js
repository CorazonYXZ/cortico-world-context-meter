// src/webui/runtime-view.ts
function requestTotal(request) {
  const { input, output } = request;
  if (input === null || output === null || !Number.isSafeInteger(input) || !Number.isSafeInteger(output) || input < 0 || output < 0) return null;
  const total = input + output;
  return Number.isSafeInteger(total) ? total : null;
}
function mergedRows(report) {
  const tools = new Map(report.tools.map((tool) => [tool.id, tool]));
  const requests = new Map(report.requests.map((request) => [request.id, request]));
  const owners = /* @__PURE__ */ new Map();
  for (const request of requests.values()) {
    for (const id of new Set(request.tools)) {
      const tool = tools.get(id);
      if (!tool || tool.run !== request.run || tool.role !== request.role || tool.responseId !== null && request.responseId !== null && tool.responseId !== request.responseId) continue;
      const links = owners.get(id) ?? /* @__PURE__ */ new Set();
      links.add(request.id);
      owners.set(id, links);
    }
  }
  const rows = [];
  for (const request of requests.values()) {
    const matched = [];
    let pendingLinks = 0;
    for (const id of new Set(request.tools)) {
      const tool = tools.get(id), links = owners.get(id);
      if (tool && links?.size === 1 && links.has(request.id)) matched.push(tool);
      else pendingLinks++;
    }
    matched.sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
    rows.push({
      key: `request:${request.id}`,
      at: request.at,
      request,
      tools: matched,
      link: pendingLinks ? "ambiguous" : matched.length ? "matched" : "none",
      pendingLinks,
      candidateRequests: [],
      totalTokens: requestTotal(request)
    });
  }
  for (const tool of tools.values()) {
    const links = owners.get(tool.id);
    if (links?.size === 1) continue;
    rows.push({
      key: `tool:${tool.id}`,
      at: tool.at,
      request: null,
      tools: [tool],
      link: links && links.size > 1 ? "ambiguous" : "unmatched",
      pendingLinks: 0,
      candidateRequests: [...links ?? []],
      totalTokens: null
    });
  }
  return rows.sort((a, b) => b.at.localeCompare(a.at) || a.key.localeCompare(b.key));
}

// src/webui/ui.ts
function dateView(ctx, value) {
  const h = ctx.ui.h, locale = ctx.language === "zh" || ctx.language === "zh-Hant" ? "zh-CN" : "en-US";
  const date = new Date(value), root = h("span", "cm-datetime");
  root.title = value;
  root.append(
    h("span", "cm-clock", date.toLocaleTimeString(locale, { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" })),
    h("span", "cm-date", date.toLocaleDateString(locale))
  );
  return root;
}

// src/webui/runtime-sort.ts
var sortColumns = [
  "time",
  "tool",
  "input",
  "output",
  "cached",
  "uncached",
  "reasoning",
  "total",
  "link",
  "owner",
  "role",
  "model",
  "basis",
  "toolTime",
  "duration",
  "failed",
  "text",
  "textBasis",
  "images",
  "imageBound",
  "toolLink"
];
var defaultSort = { column: "time", direction: "desc" };
function isSort(value) {
  if (!value || typeof value !== "object") return false;
  const v = value;
  return sortColumns.includes(v.column) && (v.direction === "asc" || v.direction === "desc");
}
function toolsSum(row, key) {
  if (!row.tools.length || row.tools.some((t) => t[key] === null)) return null;
  const n = row.tools.reduce((n2, t) => n2 + t[key], 0);
  return Number.isSafeInteger(n) ? n : null;
}
function names(row, key) {
  return row.tools.length ? [...new Set(row.tools.map((t) => t[key]).filter((v) => v !== null))].map(String).sort().join(" | ") || null : null;
}
function sortValue(row, key) {
  const r = row.request;
  switch (key) {
    case "time":
      return Date.parse(row.at);
    case "tool":
      return names(row, "tool");
    case "owner":
      return names(row, "owner");
    case "input":
      return r?.input ?? null;
    case "output":
      return r?.output ?? null;
    case "cached":
      return r?.cachedInput ?? null;
    case "uncached":
      return r?.uncachedInput ?? null;
    case "reasoning":
      return r?.reasoning ?? null;
    case "total":
      return row.totalTokens;
    case "role":
      return r?.role ?? names(row, "role");
    case "model":
      return r?.model ?? null;
    case "basis":
      return r ? `${r.basis} | ${r.outcome}` : null;
    case "link":
      return r ? `${r.id} | ${r.tools.length} | ${r.boundary}` : null;
    case "toolLink":
      return row.tools.length ? `${[...r ? [r.id] : row.candidateRequests].sort().join(" | ")} | ${row.link} | ${row.tools.map((t) => String(t.boundary)).join(" | ")}` : null;
    case "toolTime":
      return row.tools.length ? Math.max(...row.tools.map((t) => Date.parse(t.at))) : null;
    case "duration":
      return toolsSum(row, "durationMs");
    case "text":
      return toolsSum(row, "textTokens");
    case "images":
      return toolsSum(row, "imageCount");
    case "imageBound":
      return toolsSum(row, "flashImageUpperBound");
    case "textBasis":
      return row.tools.some((t) => t.textBasis === null) ? null : names(row, "textBasis");
    case "failed":
      return row.tools.some((t) => t.failed === true) ? 1 : !row.tools.length || row.tools.some((t) => t.failed === null) ? null : 0;
  }
}
function sortRows(rows, choice, language = "zh") {
  const collator = new Intl.Collator(language, { numeric: true, sensitivity: "base" });
  return [...rows].sort((a, b) => {
    const av = sortValue(a, choice.column), bv = sortValue(b, choice.column);
    const missingA = av === null || typeof av === "number" && !Number.isFinite(av), missingB = bv === null || typeof bv === "number" && !Number.isFinite(bv);
    if (missingA !== missingB) return missingA ? 1 : -1;
    const compared = missingA ? 0 : typeof av === "number" && typeof bv === "number" ? av - bv : collator.compare(String(av), String(bv));
    return compared * (choice.direction === "asc" ? 1 : -1) || b.at.localeCompare(a.at) || a.key.localeCompare(b.key);
  });
}

// src/webui/runtime-pie-model.ts
var pieColors = ["#2D4639", "#4C6D5E", "#9BB69A", "#E1E1D1", "#F5F5F0", "#F1F8E9", "#DCEDC8", "#C5E1A5", "#A5D6A7", "#81C784"];
function pieSummary(report) {
  const buckets = /* @__PURE__ */ new Map();
  let eligible = 0, known = 0, unknown = 0, total = 0n;
  for (const row of mergedRows(report)) {
    if (!row.request || row.request.basis !== "provider" || row.request.boundary) continue;
    eligible++;
    if (row.totalTokens === null) {
      unknown++;
      continue;
    }
    known++;
    const types = new Map(row.tools.map((t) => [JSON.stringify(["tool", t.owner, t.tool]), t]));
    let key, kind, tool = "", owner = "";
    if (row.pendingLinks || row.link === "ambiguous") {
      key = "special:incomplete";
      kind = "incomplete";
    } else if (types.size > 1) {
      key = "special:shared";
      kind = "shared";
    } else if (types.size === 0) {
      key = "special:none";
      kind = "none";
    } else {
      const entry = types.entries().next().value;
      key = entry[0];
      kind = "tool";
      tool = entry[1].tool;
      owner = entry[1].owner;
    }
    const bucket = buckets.get(key) ?? { kind, tool, owner, tokens: 0n, requests: 0 };
    bucket.tokens += BigInt(row.totalTokens);
    bucket.requests++;
    buckets.set(key, bucket);
    total += BigInt(row.totalTokens);
  }
  if (total > BigInt(Number.MAX_SAFE_INTEGER)) return { state: "overflow", eligible, known, unknown, total: null, categories: [], slices: [] };
  const categories = [...buckets].map(([key, b]) => ({ ...b, key, tokens: Number(b.tokens) }));
  categories.sort((a, b) => b.tokens - a.tokens || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const slices = categories.length <= 10 ? categories.map((c) => ({ ...c, members: [] })) : [
    ...categories.slice(0, 9).map((c) => ({ ...c, members: [] })),
    {
      key: "special:other",
      kind: "other",
      tool: "",
      owner: "",
      tokens: categories.slice(9).reduce((sum, c) => sum + c.tokens, 0),
      requests: categories.slice(9).reduce((sum, c) => sum + c.requests, 0),
      members: categories.slice(9)
    }
  ];
  return { state: !eligible ? "empty" : !known ? "unknown" : total === 0n ? "zero" : "ready", eligible, known, unknown, total: Number(total), categories, slices };
}
function piePercent(tokens, total, language) {
  if (total <= 0) return "\u2014";
  const percent = tokens / total * 100;
  return percent > 0 && percent < 0.1 ? "\uFF1C0.1%" : `${percent.toLocaleString(language.startsWith("zh") ? "zh-CN" : "en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}
function ringPath(start, end) {
  const point = (radius, angle) => `${180 + radius * Math.cos(angle)},${180 + radius * Math.sin(angle)}`;
  const mid = (start + end) / 2, R = 152, r = 112;
  return `M ${point(R, start)} A ${R},${R} 0 0 1 ${point(R, mid)} A ${R},${R} 0 0 1 ${point(R, end)} L ${point(r, end)} A ${r},${r} 0 0 0 ${point(r, mid)} A ${r},${r} 0 0 0 ${point(r, start)} Z`;
}

// src/webui/runtime-pie.ts
var words = {
  zh: {
    title: "\u6309\u5173\u8054\u5DE5\u5177\u6C47\u603B\u7684\u8BF7\u6C42 token",
    total: "\u5DF2\u8BA1\u603B token",
    shared: "\u591A\u5DE5\u5177\u5171\u4EAB",
    none: "\u65E0\u5173\u8054\u5DE5\u5177",
    incomplete: "\u5173\u8054\u4E0D\u5B8C\u6574",
    other: "\u5176\u4ED6",
    note: "\u8FD9\u662F\u6309\u5173\u8054\u5DE5\u5177\u6C47\u603B\u7684\u8BF7\u6C42\u5171\u4EAB\u7528\u91CF\uFF0C\u4E0D\u4EE3\u8868\u5DE5\u5177\u72EC\u7ACB\u4EA7\u751F\u7684\u8D39\u7528\u3002",
    coverage: "\u7A97\u53E3\u5185\u4F9B\u5E94\u5546\u8BF7\u6C42",
    known: "\u8BA1\u6570\u5B8C\u6574",
    unknown: "\u8BA1\u6570\u672A\u77E5\uFF0C\u672A\u8BA1\u5165",
    requests: "\u5173\u8054\u8BF7\u6C42",
    source: "World \u6765\u6E90",
    empty: "\u6682\u65E0\u7A97\u53E3\u5185\u4F9B\u5E94\u5546\u8BF7\u6C42\u3002",
    allUnknown: "\u8BF7\u6C42\u8BA1\u6570\u5168\u90E8\u672A\u77E5\uFF0C\u6682\u65E0\u6CD5\u7ED8\u5236\u997C\u56FE\u3002",
    zero: "\u5DF2\u77E5\u8BF7\u6C42\u603B token \u4E3A 0\uFF0C\u4E0D\u7ED8\u5236\u6247\u533A\u3002",
    overflow: "\u5408\u8BA1\u8D85\u51FA\u5B89\u5168\u6570\u503C\u8303\u56F4\uFF0C\u6682\u65E0\u6CD5\u7ED8\u5236\u997C\u56FE\u3002",
    members: "\u67E5\u770B\u5176\u4ED6\u5206\u7C7B",
    limit: "\u4F7F\u7528\u5168\u90E8\u7559\u5B58\u8BF7\u6C42\uFF0C\u4E0D\u53D7\u8868\u683C\u6392\u5E8F\u53CA 200 \u884C\u663E\u793A\u4E0A\u9650\u5F71\u54CD\u3002\u672A\u77E5\u8BF7\u6C42\u4E0D\u8BA1\u5165\u4E2D\u5FC3\u603B\u6570\u6216\u5360\u6BD4\u3002"
  },
  en: {
    title: "Request tokens grouped by linked tool",
    total: "Counted total tokens",
    shared: "Shared by multiple tools",
    none: "No linked tool",
    incomplete: "Incomplete links",
    other: "Other",
    note: "Shared request usage grouped by linked tool, not the tool\u2019s independent cost.",
    coverage: "In-window provider requests",
    known: "Complete meters",
    unknown: "Unknown meters, excluded",
    requests: "Linked requests",
    source: "World source",
    empty: "No in-window provider requests yet.",
    allUnknown: "All request meters are unknown. No chart can be drawn.",
    zero: "Known request tokens total 0. No slices are drawn.",
    overflow: "The total exceeds the safe numeric range. No chart can be drawn.",
    members: "View other categories",
    limit: "Uses all retained requests, regardless of table sorting or the 200-row display limit. Unknown requests are excluded from the center total and percentages."
  }
};
var RuntimePie = class {
  constructor(ctx) {
    this.ctx = ctx;
    const h = ctx.ui.h;
    this.m = words[ctx.language.startsWith("zh") ? "zh" : "en"];
    const m = this.m;
    this.root = h("section", "cm-pie");
    this.root.hidden = true;
    this.root.setAttribute("aria-label", m.title);
    this.coverage = h("p", "cm-table-caption");
    this.state = h("p", "cm-pie-state");
    this.state.setAttribute("role", "status");
    this.layout = h("div", "cm-pie-layout");
    this.legend = h("div", "cm-pie-legend");
    this.legend.setAttribute("role", "group");
    this.legend.setAttribute("aria-label", m.title);
    const ns = "http://www.w3.org/2000/svg", document = ctx.root.ownerDocument;
    this.svg = document.createElementNS(ns, "svg");
    this.svg.setAttribute("viewBox", "0 0 360 360");
    this.svg.classList.add("cm-pie-svg");
    this.svg.setAttribute("role", "group");
    this.svg.setAttribute("aria-label", m.title);
    const label = document.createElementNS(ns, "text");
    label.setAttribute("x", "180");
    label.setAttribute("y", "169");
    label.setAttribute("text-anchor", "middle");
    label.classList.add("cm-pie-center-label");
    label.textContent = m.total;
    this.center = document.createElementNS(ns, "text");
    this.center.setAttribute("x", "180");
    this.center.setAttribute("y", "203");
    this.center.setAttribute("text-anchor", "middle");
    this.center.classList.add("cm-pie-center-total");
    this.arcs = document.createElementNS(ns, "g");
    this.svg.append(this.arcs, label, this.center);
    this.layout.append(this.legend, this.svg);
    this.details = h("details", "cm-pie-other");
    const summary = h("summary", null, m.members);
    this.members = h("div", "cm-pie-members");
    this.details.append(summary, this.members);
    this.details.hidden = true;
    this.root.append(h("p", "cm-table-caption", m.note), this.coverage, h("p", "cm-table-caption", m.limit), this.state, this.layout, this.details);
  }
  ctx;
  root;
  coverage;
  state;
  layout;
  legend;
  svg;
  center;
  arcs;
  details;
  members;
  colors = /* @__PURE__ */ new Map();
  active = null;
  window = null;
  m;
  number(value) {
    return value.toLocaleString(this.ctx.language.startsWith("zh") ? "zh-CN" : "en-US");
  }
  name(c) {
    return c.kind === "tool" ? c.tool : this.m[c.kind];
  }
  describe(c, total) {
    return `${this.name(c)}${c.owner ? ` \xB7 ${this.m.source}: ${c.owner}` : ""} \xB7 ${this.number(c.tokens)} token \xB7 ${piePercent(c.tokens, total, this.ctx.language)} \xB7 ${this.m.requests}: ${this.number(c.requests)}`;
  }
  highlight(key) {
    this.active = key;
    for (const item of this.root.querySelectorAll("[data-pie-key]")) {
      item.classList.toggle("cm-pie-active", item.dataset.pieKey === key);
      item.classList.toggle("cm-pie-muted", key !== null && item.dataset.pieKey !== key);
      if (item.getAttribute("role") === "button" || item.tagName === "BUTTON") item.setAttribute("aria-pressed", String(item.dataset.pieKey === key));
    }
  }
  update(report) {
    if (this.ctx.signal.aborted) return;
    if (this.window !== report.startedAt) {
      this.window = report.startedAt;
      this.active = null;
      this.details.open = false;
      this.colors.clear();
    }
    const model = pieSummary(report), m = this.m;
    this.root.dataset.state = model.state;
    this.root.dataset.total = model.total === null ? "" : String(model.total);
    this.coverage.textContent = `${m.coverage}: ${this.number(model.eligible)} \xB7 ${m.known}: ${this.number(model.known)} \xB7 ${m.unknown}: ${this.number(model.unknown)}`;
    this.state.textContent = model.state === "empty" ? m.empty : model.state === "unknown" ? m.allUnknown : model.state === "zero" ? m.zero : model.state === "overflow" ? m.overflow : "";
    this.state.hidden = model.state === "ready";
    this.layout.hidden = model.state === "empty" || model.state === "unknown" || model.state === "overflow";
    this.svg.style.display = model.state === "ready" ? "" : "none";
    this.center.textContent = model.total === null ? "\u2014" : this.number(model.total);
    const keys = new Set(model.slices.map((s) => s.key)), used = new Set([...this.colors].filter(([key]) => keys.has(key)).map(([, color]) => color));
    for (const key of [...this.colors.keys()]) if (!keys.has(key)) this.colors.delete(key);
    for (const slice of model.slices) if (!this.colors.has(slice.key)) {
      const color = pieColors.find((c) => !used.has(c));
      this.colors.set(slice.key, color);
      used.add(color);
    }
    if (this.active && !keys.has(this.active)) this.active = null;
    const active = this.active;
    const document = this.ctx.root.ownerDocument, focused = document.activeElement;
    const focusKey = this.root.contains(focused) ? focused?.dataset.pieKey : void 0;
    const focusArc = focused?.namespaceURI === "http://www.w3.org/2000/svg";
    const top = this.members.scrollTop;
    this.legend.replaceChildren();
    this.arcs.replaceChildren();
    this.members.replaceChildren();
    const h = this.ctx.ui.h;
    let angle = -Math.PI / 2;
    for (const slice of model.slices) {
      const description = this.describe(slice, model.total ?? 0), button = h("button", "cm-pie-item");
      button.type = "button";
      button.dataset.pieKey = slice.key;
      button.title = description;
      const swatch = h("span", "cm-pie-swatch");
      swatch.style.backgroundColor = this.colors.get(slice.key);
      swatch.setAttribute("aria-hidden", "true");
      const name = h("span", "cm-pie-name", this.name(slice)), text2 = h("span", "cm-pie-text");
      text2.append(name);
      if (slice.owner) text2.append(h("span", "cm-pie-source", `${m.source}: ${slice.owner}`));
      text2.append(h("span", "cm-pie-values", `${this.number(slice.tokens)} token \xB7 ${piePercent(slice.tokens, model.total ?? 0, this.ctx.language)} \xB7 ${m.requests}: ${this.number(slice.requests)}`));
      button.append(swatch, text2);
      button.setAttribute("aria-label", description);
      button.addEventListener("mouseenter", () => this.highlight(slice.key));
      button.addEventListener("focus", () => this.highlight(slice.key));
      button.addEventListener("click", () => this.highlight(slice.key));
      button.addEventListener("keydown", (event) => {
        if (event.key === "Escape") this.highlight(null);
      });
      this.legend.append(button);
      if (model.state === "ready" && slice.tokens > 0) {
        const next = angle + slice.tokens / model.total * Math.PI * 2, path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        path.setAttribute("d", ringPath(angle, next));
        path.setAttribute("fill", this.colors.get(slice.key));
        path.setAttribute("tabindex", "0");
        path.setAttribute("role", "button");
        path.setAttribute("aria-label", description);
        path.dataset.pieKey = slice.key;
        const title = document.createElementNS("http://www.w3.org/2000/svg", "title");
        title.textContent = description;
        path.append(title);
        path.addEventListener("mouseenter", () => this.highlight(slice.key));
        path.addEventListener("focus", () => this.highlight(slice.key));
        path.addEventListener("click", () => this.highlight(slice.key));
        path.addEventListener("keydown", (event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            this.highlight(slice.key);
          }
          if (event.key === "Escape") this.highlight(null);
        });
        this.arcs.append(path);
        angle = next;
      }
      for (const member of slice.members) {
        const row = h("div", "cm-pie-member");
        row.append(h("strong", null, this.name(member)), h("span", null, `${m.source}: ${member.owner || "\u2014"}`), h("span", "cm-pie-values", `${this.number(member.tokens)} token \xB7 ${piePercent(member.tokens, model.total ?? 0, this.ctx.language)} \xB7 ${m.requests}: ${this.number(member.requests)}`));
        this.members.append(row);
      }
    }
    this.details.hidden = !model.slices.some((s) => s.members.length);
    this.members.scrollTop = top;
    if (focusKey) {
      const candidates = [...this.root.querySelectorAll("[data-pie-key]")];
      const next = candidates.find((e) => e.dataset.pieKey === focusKey && e.namespaceURI === "http://www.w3.org/2000/svg" === focusArc);
      next?.focus({ preventScroll: true });
    }
    this.highlight(active);
  }
};

// src/webui/runtime-table.ts
var simple = ["time", "tool", "input", "output", "cached", "uncached", "reasoning", "total", "link"];
var detailed = [...simple, "owner", "role", "model", "basis", "toolTime", "duration", "failed", "text", "textBasis", "images", "imageBound", "toolLink"];
var toolColumns = ["tool", "owner", "toolTime", "duration", "failed", "text", "textBasis", "images", "imageBound", "toolLink"];
var numeric = /* @__PURE__ */ new Set(["input", "output", "cached", "uncached", "reasoning", "total", "duration", "text", "images", "imageBound"]);
var messages = {
  zh: {
    title: "\u8BF7\u6C42\u4E0E\u5173\u8054\u5DE5\u5177",
    simple: "\u7B80\u5355",
    detailed: "\u8BE6\u7EC6",
    pie: "\u997C\u56FE",
    view: "\u6570\u636E\u663E\u793A\u65B9\u5F0F",
    shared: "\u8FD9\u91CC\u662F\u5173\u8054\u8BF7\u6C42\u7684\u5171\u4EAB\u7528\u91CF\uFF0C\u4E0D\u4EE3\u8868\u8BE5\u5DE5\u5177\u72EC\u7ACB\u4EA7\u751F\u7684\u8D39\u7528\u3002\u603B token = \u8F93\u5165\uFF0B\u8F93\u51FA\uFF0C\u7F13\u5B58\u548C\u63A8\u7406\u4E0D\u91CD\u590D\u76F8\u52A0\u3002",
    none: "\u5C1A\u65E0\u8BB0\u5F55\u3002",
    noTools: "\u672A\u5173\u8054\u5DE5\u5177\uFF0F\u65E0\u53EF\u89C1\u660E\u7EC6",
    unmatched: "\u672A\u5173\u8054\u8BF7\u6C42",
    ambiguous: "\u5173\u8054\u4E0D\u552F\u4E00",
    pending: "\u5F85\u914D\u5BF9\u5DE5\u5177",
    details: "\u5DE5\u5177\u660E\u7EC6",
    expand: "\u5C55\u5F00",
    collapse: "\u6536\u8D77",
    perTool: "\u591A\u4E2A\u5DE5\u5177\uFF0C\u8BF7\u5C55\u5F00\u9010\u9879\u660E\u7EC6",
    detailNote: "\u9010\u5DE5\u5177\u4FE1\u606F\uFF1B\u8BF7\u6C42\u7528\u91CF\u53EA\u5728\u4E3B\u884C\u663E\u793A\u4E00\u6B21\u3002",
    inside: "\u7A97\u53E3\u5185",
    cross: "\u8DE8\u8FB9\u754C\uFF0F\u8D77\u70B9\u672A\u77E5",
    provider: "\u4F9B\u5E94\u5546\u56DE\u6267",
    reported: "\u6269\u5C55\u81EA\u62A5\uFF0C\u5355\u5217",
    full: "\u5B8C\u6574\u7ED3\u679C\u6D41\u6C34",
    receipt: "\u5DF2\u9A8C\u8BC1\u5B8C\u6574\u7684\u77ED\u56DE\u6267",
    unknown: "\u672A\u77E5",
    yes: "\u662F",
    no: "\u5426",
    shown: "\u5F53\u524D\u663E\u793A",
    rows: "\u884C",
    requests: "\u8BF7\u6C42",
    unlinked: "\u672A\u5173\u8054\u5DE5\u5177",
    limit: "\u6BCF\u5F20\u8868\u6700\u591A\u663E\u793A 200 \u884C\uFF0C\u5173\u8054\u4E0E\u6C47\u603B\u4F7F\u7528\u5168\u90E8\u7559\u5B58\u8BB0\u5F55\u3002",
    headers: {
      time: "\u5B8C\u6210\u65F6\u95F4",
      tool: "\u5DE5\u5177",
      input: "\u8F93\u5165",
      output: "\u8F93\u51FA",
      cached: "\u7F13\u5B58\u8F93\u5165",
      uncached: "\u672A\u7F13\u5B58\u8F93\u5165",
      reasoning: "\u63A8\u7406\u8F93\u51FA",
      total: "\u603B token\uFF08\u8F93\u5165\uFF0B\u8F93\u51FA\uFF09",
      link: "\u672C\u54CD\u5E94\u53D1\u8D77\u7684\u5DE5\u5177\uFF0F\u8FB9\u754C",
      owner: "World \u6765\u6E90",
      role: "\u89D2\u8272\uFF0F\u6765\u6E90",
      model: "\u6A21\u578B",
      basis: "\u56DE\u6267\u7C7B\u578B\uFF0F\u72B6\u6001",
      toolTime: "\u5DE5\u5177\u5B8C\u6210\u65F6\u95F4",
      duration: "\u5DE5\u5177\u8017\u65F6 ms",
      failed: "\u8BB0\u5F55\u5931\u8D25",
      text: "\u6587\u672C\u4F30\u7B97 token",
      textBasis: "\u6587\u672C\u4F9D\u636E",
      images: "\u56FE\u7247\u9644\u4EF6",
      imageBound: "Flash \u6761\u4EF6\u4E0A\u9650",
      toolLink: "\u5DE5\u5177\u8BF7\u6C42\u5173\u8054\uFF0F\u8FB9\u754C"
    }
  },
  en: {
    title: "Requests and linked tools",
    simple: "Simple",
    detailed: "Detailed",
    pie: "Pie chart",
    view: "Data view",
    shared: "Shared usage of a linked request, not this tool\u2019s independent cost. Total tokens = input + output; cache and reasoning are not added again.",
    none: "No records yet.",
    noTools: "No linked tool / details not visible",
    unmatched: "No linked request",
    ambiguous: "Ambiguous link",
    pending: "Pending tool links",
    details: "Tool details",
    expand: "Expand",
    collapse: "Collapse",
    perTool: "Multiple tools: expand for individual details",
    detailNote: "Individual tool details; request usage appears only once in the main row.",
    inside: "Within window",
    cross: "Cross-boundary / unknown start",
    provider: "Provider meters",
    reported: "World-reported, separate",
    full: "Full transcript result",
    receipt: "Verified complete short receipt",
    unknown: "Unknown",
    yes: "Yes",
    no: "No",
    shown: "Showing",
    rows: "rows",
    requests: "requests",
    unlinked: "unlinked tools",
    limit: "At most 200 rows per table. Joins and aggregates use all retained records.",
    headers: {
      time: "Completed",
      tool: "Tool",
      input: "Input",
      output: "Output",
      cached: "Cached input",
      uncached: "Uncached input",
      reasoning: "Reasoning output",
      total: "Total tokens (input + output)",
      link: "Tools initiated by response / boundary",
      owner: "World source",
      role: "Role / source",
      model: "Model",
      basis: "Meter basis / outcome",
      toolTime: "Tool completed",
      duration: "Tool duration ms",
      failed: "Marked failed",
      text: "Text token estimate",
      textBasis: "Text basis",
      images: "Image attachments",
      imageBound: "Conditional Flash bound",
      toolLink: "Tool request link / boundary"
    }
  }
};
var RuntimeTable = class {
  constructor(ctx) {
    this.ctx = ctx;
    const h = ctx.ui.h;
    this.m = messages[ctx.language === "zh" || ctx.language === "zh-Hant" ? "zh" : "en"];
    const m = this.m;
    try {
      const saved = ctx.memo?.get("context-meter.runtimeView", "simple");
      if (saved === "detailed" || saved === "pie") this.mode = saved;
    } catch {
    }
    try {
      const saved = ctx.memo?.get("context-meter.runtimeSort", null);
      if (isSort(saved)) this.sort = saved;
    } catch {
    }
    this.root = h("section", "cm-merged");
    const toolbar = h("div", "cm-table-toolbar"), toggle = h("div", "cm-view-toggle");
    toggle.setAttribute("role", "group");
    toggle.setAttribute("aria-label", m.view);
    this.buttons = { simple: ctx.ui.button(m.simple, { onClick: () => this.setMode("simple") }), detailed: ctx.ui.button(m.detailed, { onClick: () => this.setMode("detailed") }), pie: ctx.ui.button(m.pie, { onClick: () => this.setMode("pie") }) };
    for (const mode of ["simple", "detailed", "pie"]) {
      this.buttons[mode].dataset.view = mode;
      toggle.append(this.buttons[mode]);
    }
    toolbar.append(h("h3", null, m.title), toggle);
    this.caption = h("p", "cm-table-caption");
    this.frame = h("div", "cm-table-wrap cm-merged-scroll");
    this.frame.tabIndex = 0;
    this.frame.setAttribute("role", "region");
    this.frame.setAttribute("aria-label", m.title);
    this.table = h("table", "cm-table cm-merged-table");
    this.table.setAttribute("aria-label", m.title);
    this.head = h("thead");
    this.body = h("tbody");
    this.table.append(this.head, this.body);
    this.frame.append(this.table);
    this.interactions = h("div", "cm-interactions");
    const sortBox = h("details", "cm-disclosure cm-sort"), summary = h("summary", null, ctx.language.startsWith("zh") ? "\u6392\u5E8F" : "Sort");
    this.sortBox = sortBox;
    this.pie = new RuntimePie(ctx);
    this.shared = h("p", "cm-table-caption", m.shared);
    const zh = ctx.language.startsWith("zh"), content = h("div", "cm-disclosure-body");
    const column = h("select"), direction = h("select");
    column.dataset.sort = "column";
    direction.dataset.sort = "direction";
    column.setAttribute("aria-label", zh ? "\u6392\u5E8F\u5217" : "Sort column");
    direction.setAttribute("aria-label", zh ? "\u6392\u5E8F\u65B9\u5411" : "Sort direction");
    const refreshOptions = () => {
      column.replaceChildren();
      for (const key of sortColumns) {
        const o = h("option", null, m.headers[key] + (!this.columns.includes(key) ? zh ? "\uFF08\u8BE6\u7EC6\u5217\uFF09" : " (detailed column)" : ""));
        o.value = key;
        column.append(o);
      }
      column.value = this.sort.column;
    };
    for (const [value, text2] of [["desc", zh ? "\u964D\u5E8F" : "Descending"], ["asc", zh ? "\u5347\u5E8F" : "Ascending"]]) {
      const o = h("option", null, text2);
      o.value = value;
      direction.append(o);
    }
    direction.value = this.sort.direction;
    const change = () => {
      this.sort = { column: column.value, direction: direction.value };
      try {
        ctx.memo?.set("context-meter.runtimeSort", this.sort);
      } catch {
      }
      if (this.last) {
        this.update(this.last);
        this.frame.scrollTop = 0;
      }
    };
    column.addEventListener("change", change, { signal: ctx.signal });
    direction.addEventListener("change", change, { signal: ctx.signal });
    const reset = ctx.ui.button(zh ? "\u6062\u590D\u9ED8\u8BA4" : "Reset", { onClick: () => {
      column.value = "time";
      direction.value = "desc";
      change();
    } });
    content.append(column, direction, reset, h("p", "cm-muted", zh ? "\u591A\u5DE5\u5177\u6570\u503C\u6309\u5408\u8BA1\u6392\u5E8F\uFF0C\u4EFB\u4E00\u672A\u77E5\u5219\u653E\u672B\u5C3E\uFF1B\u5B8C\u6210\u65F6\u95F4\u53D6\u6700\u665A\uFF0C\u5931\u8D25\u6309\u4EFB\u4E00\u5931\u8D25\u3002\u4EC5\u6539\u53D8\u6392\u5E8F\uFF0C\u4E0D\u6539\u53D8\u9010\u5DE5\u5177\u6570\u636E\u6216\u8D39\u7528\u5F52\u5C5E\u3002" : "Multiple tools sort by sums; any unknown value sorts last. Latest tool completion and any-failed status are used. Individual data and cost attribution stay unchanged."));
    sortBox.append(summary, content);
    this.interactions.append(sortBox);
    this.root.append(toolbar, this.interactions, this.shared, this.caption, this.frame, this.pie.root);
    for (const button of Object.values(this.buttons)) button.addEventListener("click", refreshOptions, { signal: ctx.signal });
    refreshOptions();
    this.body.addEventListener("click", (event) => {
      const target = event.target;
      const button = target?.closest("button[data-expand]");
      const key = button?.dataset.expand;
      if (!key || !this.rowElements.has(key)) return;
      if (this.expanded.has(key)) this.expanded.delete(key);
      else this.expanded.add(key);
      this.renderRows(true);
    }, { signal: ctx.signal });
    this.renderHead();
  }
  ctx;
  root;
  frame;
  interactions;
  table;
  head;
  body;
  caption;
  buttons;
  pie;
  sortBox;
  shared;
  expanded = /* @__PURE__ */ new Set();
  rowElements = /* @__PURE__ */ new Map();
  focusButtons = /* @__PURE__ */ new Map();
  mode = "simple";
  last = null;
  visible = [];
  window = null;
  m;
  sort = { ...defaultSort };
  get columns() {
    return this.mode === "detailed" ? detailed : simple;
  }
  setMode(mode) {
    if (this.ctx.signal.aborted || this.mode === mode) return;
    this.mode = mode;
    try {
      this.ctx.memo?.set("context-meter.runtimeView", mode);
    } catch {
    }
    this.renderHead();
    if (this.last) {
      if (mode === "pie") this.pie.update(this.last);
      else this.renderRows(false);
    }
  }
  renderHead() {
    const h = this.ctx.ui.h, tr = h("tr");
    for (const key of this.columns) {
      const th = h("th", this.cellClass(key), this.m.headers[key]);
      th.scope = "col";
      th.dataset.column = key;
      if (key === "total") th.title = this.m.shared;
      tr.append(th);
    }
    this.head.replaceChildren(tr);
    this.table.classList.toggle("cm-detailed", this.mode === "detailed");
    const pie = this.mode === "pie";
    this.pie.root.hidden = !pie;
    this.frame.hidden = pie;
    this.sortBox.hidden = pie;
    this.caption.hidden = pie;
    this.shared.hidden = pie;
    for (const mode of ["simple", "detailed", "pie"]) this.buttons[mode].setAttribute("aria-pressed", String(mode === this.mode));
  }
  update(report) {
    if (this.ctx.signal.aborted) return;
    if (this.window !== report.startedAt) {
      this.expanded.clear();
      this.window = report.startedAt;
    }
    this.last = report;
    const all = sortRows(mergedRows(report), this.sort, this.ctx.language);
    this.visible = all.slice(0, 200);
    this.caption.textContent = `${this.m.shown} ${this.visible.length} / ${all.length} ${this.m.rows} \xB7 ${report.requests.length} ${this.m.requests} \xB7 ${all.filter((r) => !r.request).length} ${this.m.unlinked}. ${this.m.limit}`;
    if (this.mode === "pie") this.pie.update(report);
    else this.renderRows(true);
  }
  number(value) {
    return value === null ? "\u2014" : value.toLocaleString(this.ctx.language === "zh" || this.ctx.language === "zh-Hant" ? "zh-CN" : "en-US", { maximumFractionDigits: 1 });
  }
  cellClass(key) {
    return [numeric.has(key) ? "cm-number" : "", key === "tool" ? "cm-tool-frozen" : "", key === "total" ? "cm-total" : ""].filter(Boolean).join(" ");
  }
  toolLink(row, tool) {
    const refs = row.request ? [row.request.id] : row.candidateRequests;
    return `${refs.map((id) => id.slice(0, 8)).join(", ") || this.m.unmatched} \xB7 ${tool.boundary ? this.m.cross : this.m.inside}`;
  }
  toolValue(row, tool, key) {
    switch (key) {
      case "tool":
        return tool.tool;
      case "owner":
        return tool.owner;
      case "toolTime":
        return dateView(this.ctx, tool.at);
      case "duration":
        return this.number(tool.durationMs);
      case "failed":
        return tool.failed === null ? "\u2014" : tool.failed ? this.m.yes : this.m.no;
      case "text":
        return this.number(tool.textTokens);
      case "textBasis":
        return tool.textBasis === "transcript" ? this.m.full : tool.textBasis === "complete_receipt" ? this.m.receipt : this.m.unknown;
      case "images":
        return this.number(tool.imageCount);
      case "imageBound":
        return tool.flashImageUpperBound === null ? "\u2014" : `\u2264 ${this.number(tool.flashImageUpperBound)} *`;
      case "toolLink":
        return this.toolLink(row, tool);
      default:
        return "\u2014";
    }
  }
  toolCell(row) {
    const h = this.ctx.ui.h, root = h("div");
    if (!row.tools.length) root.append(h("span", "cm-muted", this.m.noTools));
    for (const tool of row.tools.slice(0, 200)) {
      const item = h("div", "cm-tool-item");
      item.append(h("span", "cm-tool-name", tool.tool), h("span", "cm-owner", tool.owner));
      root.append(item);
    }
    if (!row.request) root.append(h("span", "cm-issues", row.link === "ambiguous" ? this.m.ambiguous : this.m.unmatched));
    if (row.pendingLinks) root.append(h("span", "cm-issues", `${this.m.pending}: ${row.pendingLinks}`));
    if (row.tools.length > 200) root.append(h("span", "cm-issues", this.m.limit));
    if (this.mode === "detailed" && row.tools.length > 1) {
      const button = h("button", "cm-expand", `${this.expanded.has(row.key) ? this.m.collapse : this.m.expand} ${this.m.details} (${row.tools.length})`);
      button.type = "button";
      button.dataset.expand = row.key;
      button.dataset.focusKey = row.key;
      button.setAttribute("aria-expanded", String(this.expanded.has(row.key)));
      this.focusButtons.set(row.key, button);
      root.append(button);
    }
    return root;
  }
  value(row, key) {
    const request = row.request;
    if (key === "time") return dateView(this.ctx, row.at);
    if (key === "tool") return this.toolCell(row);
    if (key === "total") return this.number(row.totalTokens);
    if (["input", "output", "cached", "uncached", "reasoning"].includes(key)) {
      const fields = { input: "input", output: "output", cached: "cachedInput", uncached: "uncachedInput", reasoning: "reasoning" };
      return this.number(request?.[fields[key]] ?? null);
    }
    if (key === "link") return request ? `${request.id.slice(0, 8)} \xB7 ${request.tools.length} \xB7 ${request.boundary ? this.m.cross : this.m.inside}` : row.link === "ambiguous" ? `${this.m.ambiguous} (${row.candidateRequests.length})` : this.m.unmatched;
    if (key === "role") return request?.role ?? row.tools[0]?.role ?? "\u2014";
    if (key === "model") return request?.model ?? "\u2014";
    if (key === "basis") return request ? `${request.basis === "provider" ? this.m.provider : this.m.reported} / ${request.outcome}` : this.m.unmatched;
    if (key === "owner") return [...new Set(row.tools.map((t) => t.owner))].join(", ") || "\u2014";
    if (row.tools.length === 1) return this.toolValue(row, row.tools[0], key);
    return row.tools.length > 1 && key === "toolTime" ? this.m.perTool : "\u2014";
  }
  appendCell(tr, key, value) {
    const td = this.ctx.ui.h("td", this.cellClass(key));
    td.dataset.column = key;
    if (typeof value === "string") td.textContent = value;
    else td.append(value);
    tr.append(td);
  }
  details(row) {
    const h = this.ctx.ui.h, tr = h("tr", "cm-detail-row"), td = h("td");
    td.colSpan = this.columns.length;
    const panel = h("div", "cm-detail-panel"), table = h("table", "cm-table"), head = h("thead"), header = h("tr"), body = h("tbody");
    panel.append(h("p", "cm-muted", `${this.m.details} \xB7 ${row.request?.id.slice(0, 8) ?? ""}. ${this.m.detailNote} ${row.tools.length > 200 ? this.m.limit : ""}`));
    for (const key of toolColumns) {
      const th = h("th", this.cellClass(key), this.m.headers[key]);
      th.scope = "col";
      header.append(th);
    }
    head.append(header);
    for (const tool of row.tools.slice(0, 200)) {
      const child = h("tr");
      for (const key of toolColumns) this.appendCell(child, key, this.toolValue(row, tool, key));
      body.append(child);
    }
    table.append(head, body);
    panel.append(table);
    td.append(panel);
    tr.append(td);
    return tr;
  }
  renderRows(preserveHorizontal) {
    if (!this.last) return;
    const h = this.ctx.ui.h, top = this.frame.scrollTop, left = this.frame.scrollLeft;
    const frameTop = this.frame.getBoundingClientRect().top;
    let anchor = null;
    if (top > 0) for (const [key, row] of this.rowElements) {
      const rect = row.getBoundingClientRect();
      if (rect.height > 0 && rect.bottom > frameTop + this.head.getBoundingClientRect().height) {
        anchor = { key, offset: rect.top - frameTop };
        break;
      }
    }
    const focus = this.ctx.root.ownerDocument.activeElement;
    const focusKey = this.body.contains(focus) ? focus?.dataset.focusKey : void 0;
    this.rowElements.clear();
    this.focusButtons.clear();
    const rows = [];
    for (const row of this.visible) {
      const tr = h("tr", row.request ? null : "cm-orphan");
      tr.dataset.rowKey = row.key;
      tr.dataset.kind = row.request ? "request" : "unlinked";
      for (const key of this.columns) this.appendCell(tr, key, this.value(row, key));
      rows.push(tr);
      this.rowElements.set(row.key, tr);
      if (this.mode === "detailed" && row.tools.length > 1 && this.expanded.has(row.key)) rows.push(this.details(row));
    }
    if (!rows.length) {
      const tr = h("tr"), td = h("td", "cm-muted", this.m.none);
      td.colSpan = this.columns.length;
      tr.append(td);
      rows.push(tr);
    }
    this.body.replaceChildren(...rows);
    this.frame.scrollTop = top;
    if (anchor) {
      const next = this.rowElements.get(anchor.key);
      if (next) this.frame.scrollTop += next.getBoundingClientRect().top - this.frame.getBoundingClientRect().top - anchor.offset;
    }
    this.frame.scrollLeft = preserveHorizontal ? left : 0;
    if (focusKey) this.focusButtons.get(focusKey)?.focus({ preventScroll: true });
  }
};

// src/excel-protocol.ts
var XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
var EXPORT_CODES = [
  "E_EXPORT_DATA",
  "E_EXPORT_ARGS",
  "E_EXPORT_INTERFACE",
  "E_EXPORT_TRANSPORT",
  "E_EXPORT_DOWNLOAD",
  "E_XLSX_BUSY",
  "E_XLSX_START",
  "E_XLSX_GENERATE",
  "E_XLSX_TIMEOUT",
  "E_XLSX_CANCELLED",
  "E_XLSX_UNAVAILABLE"
];
function exportCode(value, fallback) {
  const message = value instanceof Error ? value.message : "";
  return EXPORT_CODES.find((code) => new RegExp(`\\b${code}\\b`).test(message)) ?? fallback;
}

// package.json
var package_default = {
  name: "cortico-world-context-meter",
  version: "0.5.3",
  type: "module",
  description: "\u9002\u7528\u4E8E Coopanion \u7684 DeepSeek Token \u7528\u91CF\u4F30\u7B97\u63D2\u4EF6\u3002\u53EF\u7528\u4E8E\u6D4B\u8BD5\u4E0D\u540C\u6269\u5C55\u5728\u9759\u6001\u4E0A\u4E0B\u6587\u548C\u52A8\u6001\u4EA4\u4E92\u4E2D\u7684 Token \u6D88\u8017\uFF0C\u5E2E\u52A9\u4F60\u5B9A\u4F4D Token \u4E3B\u8981\u6D88\u8017\u5728\u54EA\u91CC\u3002\u8BF7\u6CE8\u610F\uFF1A\u4F30\u7B97\u7ED3\u679C\u4EC5\u4F9B\u53C2\u8003\uFF0C\u5B9E\u9645\u7528\u91CF\u53EF\u80FD\u4E0E\u5B98\u7F51\u7EDF\u8BA1\u5B58\u5728\u5DEE\u5F02\u3002 A DeepSeek token usage estimation plugin for Coopanion. Test token consumption across different extensions in static contexts and dynamic interactions to identify where most tokens are used. Please note: estimates are for reference only; actual usage may differ from the official dashboard.",
  license: "MIT",
  author: "CorazonYXZ",
  repository: {
    type: "git",
    url: "git+https://github.com/CorazonYXZ/cortico-world-context-meter.git"
  },
  homepage: "https://github.com/CorazonYXZ/cortico-world-context-meter#readme",
  bugs: {
    url: "https://github.com/CorazonYXZ/cortico-world-context-meter/issues"
  },
  keywords: [
    "cortico-world",
    "cortico"
  ],
  engines: {
    node: ">=22"
  },
  packageManager: "pnpm@11.28.6",
  main: "./src/index.ts",
  cortico: {
    kind: "world",
    api: 6,
    displayName: "token\u8BA1\u6570",
    locales: { zh: { displayName: "token\u8BA1\u6570" }, en: { displayName: "Token count" } },
    webUiClient: "dist/webui.js",
    webUiStyle: "dist/webui.css",
    tags: ["diagnostics", "experimental"],
    describe: "describe.json"
  },
  files: [
    "src",
    "README.md",
    "CHANGELOG.md",
    "describe.json",
    "dist",
    "assets",
    "licenses",
    "provenance",
    "THIRD_PARTY_NOTICES.md",
    "SECURITY.md",
    "VALIDATION.md"
  ],
  scripts: {
    test: "vitest run",
    typecheck: "tsc --noEmit && tsc -p tsconfig.web.json",
    build: "node scripts/build.mjs",
    "check:extension": "node scripts/official-check.mjs",
    "check:security": "node scripts/security-check.mjs"
  },
  dependencies: { "@huggingface/tokenizers": "0.2.0" },
  devDependencies: {
    exceljs: "4.4.0",
    "@types/node": "^22.10.0",
    cortico: "0.2.9",
    esbuild: "0.28.2",
    jsdom: "26.1.0",
    "@types/jsdom": "21.1.7",
    mineflayer: "4.37.1",
    "mineflayer-pathfinder": "2.4.5",
    vec3: "0.2.0",
    tsx: "^4.19.2",
    typescript: "^5.7.2",
    vitest: "5.0.5",
    vite: "8.3.5"
  }
};

// src/webui/export.ts
var errors = {
  E_EXPORT_DATA: ["\u65E0\u6CD5\u53D6\u5F97\u6240\u9009\u7EDF\u8BA1\uFF0C\u8BF7\u68C0\u67E5\u8BE5\u8BB0\u5F55\u662F\u5426\u4ECD\u5B58\u5728\u3002", "Selected statistics are unavailable. Check that the session still exists."],
  E_EXPORT_ARGS: ["\u5BFC\u51FA\u53C2\u6570\u4E0D\u517C\u5BB9\uFF0C\u8BF7\u91CD\u65B0\u6253\u5F00\u9762\u677F\u3002", "Export parameters are incompatible. Reopen the panel."],
  E_EXPORT_INTERFACE: ["\u5BBF\u4E3B\u7F3A\u5C11\u6240\u9700\u7684\u4E8C\u8FDB\u5236\u5BFC\u51FA\u63A5\u53E3\u3002", "The host lacks the required binary export interface."],
  E_EXPORT_TRANSPORT: ["Excel \u6587\u4EF6\u4F20\u8F93\u5931\u8D25\uFF0C\u8BF7\u91CD\u8BD5\u3002", "Excel transfer failed. Please retry."],
  E_EXPORT_DOWNLOAD: ["\u6587\u4EF6\u5DF2\u53D6\u5F97\uFF0C\u4F46\u51C6\u5907\u4E0B\u8F7D\u5931\u8D25\uFF0C\u8BF7\u91CD\u8BD5\u3002", "The file was received but download preparation failed. Please retry."],
  E_XLSX_BUSY: ["\u5DF2\u6709 Excel \u6B63\u5728\u751F\u6210\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5\u3002", "An Excel export is already running. Retry after it finishes."],
  E_XLSX_START: ["\u672C\u673A Excel \u7EBF\u7A0B\u542F\u52A8\u5931\u8D25\uFF0C\u8BF7\u68C0\u67E5\u5B89\u88C5\u662F\u5426\u5B8C\u6574\u3002", "The local Excel worker could not start. Check the installation."],
  E_XLSX_GENERATE: ["\u672C\u673A Excel \u751F\u6210\u5931\u8D25\uFF0C\u8BF7\u5148\u4F7F\u7528 JSON \u5BFC\u51FA\u3002", "Local Excel generation failed. Use JSON export for now."],
  E_XLSX_TIMEOUT: ["Excel \u751F\u6210\u8D85\u8FC7 60 \u79D2\uFF0C\u8BF7\u91CD\u8BD5\u6216\u4F7F\u7528 JSON\u3002", "Excel generation exceeded 60 seconds. Retry or use JSON."],
  E_XLSX_CANCELLED: ["Excel \u5BFC\u51FA\u5DF2\u53D6\u6D88\u3002", "Excel export was cancelled."],
  E_XLSX_UNAVAILABLE: ["Excel \u5BFC\u51FA\u4E0D\u53EF\u7528\uFF0C\u8BF7\u91CD\u65B0\u542F\u7528\u6269\u5C55\u3002", "Excel export is unavailable. Re-enable the extension."]
};
function exportControls(ctx, selected = () => null) {
  const zh = ctx.language === "zh" || ctx.language === "zh-Hant";
  const prefix = `${zh ? "token\u8BA1\u6570" : "Token count"} v${package_default.version} \xB7 `;
  const format = ctx.ui.h("label", null, zh ? "\u5BFC\u51FA\u683C\u5F0F" : "Export format"), select = ctx.ui.h("select");
  select.dataset.exportFormat = "";
  select.setAttribute("aria-label", zh ? "\u5BFC\u51FA\u683C\u5F0F" : "Export format");
  for (const [value, name] of [["json", "JSON"], ["xlsx", "Excel (.xlsx)"]]) {
    const option = ctx.ui.h("option", null, name);
    option.value = value;
    select.append(option);
  }
  format.append(select);
  const notice = ctx.ui.h("p", "cm-muted cm-export-note");
  notice.hidden = true;
  notice.setAttribute("role", "status");
  notice.dataset.version = package_default.version;
  const button = ctx.ui.button(zh ? "\u5BFC\u51FA\u5168\u90E8\u7EDF\u8BA1" : "Export all statistics", { onClick: () => {
    void save();
  } });
  button.dataset.action = "export";
  let owner = null;
  async function save() {
    if (button.disabled || ctx.signal.aborted) return;
    button.disabled = true;
    select.disabled = true;
    delete notice.dataset.errorCode;
    const extension = select.value === "xlsx" ? "xlsx" : "json";
    let stage = extension === "xlsx" ? "E_EXPORT_TRANSPORT" : "E_EXPORT_DATA";
    notice.hidden = false;
    notice.textContent = extension === "xlsx" ? zh ? "\u6B63\u5728\u672C\u673A\u751F\u6210 Excel\u2026" : "Generating Excel locally\u2026" : zh ? "\u6B63\u5728\u53D6\u5F97\u7EDF\u8BA1\u2026" : "Preparing statistics\u2026";
    try {
      const id = selected(), document = ctx.root.ownerDocument, view = document.defaultView;
      let blob, at = (/* @__PURE__ */ new Date()).toISOString();
      if (extension === "xlsx") {
        if (typeof ctx.invokeBinary !== "function" || typeof ctx.notifyOnUnmount !== "function") throw new Error("E_EXPORT_INTERFACE");
        if (!owner) {
          owner = view.crypto.randomUUID();
          ctx.notifyOnUnmount("export.cancel", [owner]);
        }
        blob = await ctx.invokeBinary("export.xlsx", [id, ctx.language, owner]);
        if (ctx.signal.aborted) return;
        if (blob.type.split(";")[0] !== XLSX_MIME || blob.size < 4) throw new Error("E_EXPORT_TRANSPORT");
        const header = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
        if (header[0] !== 80 || header[1] !== 75) throw new Error("E_EXPORT_TRANSPORT");
      } else {
        const report = await ctx.invoke("export", id ? [id] : []);
        if (ctx.signal.aborted) return;
        stage = "E_EXPORT_DOWNLOAD";
        at = report.exportedAt;
        blob = new view.Blob([JSON.stringify(report, null, 2) + "\n"], { type: "application/json;charset=utf-8" });
      }
      if (ctx.signal.aborted) return;
      stage = "E_EXPORT_DOWNLOAD";
      const url = view.URL.createObjectURL(blob);
      let disposed = false;
      const resource = { dispose() {
        if (!disposed) {
          disposed = true;
          view.URL.revokeObjectURL(url);
        }
      } };
      ctx.own(resource);
      ctx.timeout(() => resource.dispose(), 6e4);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `token-count-${at.replace(/[^0-9TZ]/g, "-")}.${extension}`;
      anchor.hidden = true;
      ctx.root.append(anchor);
      try {
        anchor.click();
      } finally {
        anchor.remove();
      }
      notice.textContent = zh ? "\u5DF2\u751F\u6210\u5BFC\u51FA\u6587\u4EF6\u3002" : "Export file generated.";
    } catch (error) {
      if (!ctx.signal.aborted) {
        const code = exportCode(error, stage);
        notice.dataset.errorCode = code;
        notice.textContent = `${prefix}${errors[code][zh ? 0 : 1]} [${code}] ${zh ? "\u672A\u81EA\u52A8\u4E0A\u4F20\u4EFB\u4F55\u6570\u636E\u3002" : "No data was uploaded."}`;
      }
    } finally {
      if (!ctx.signal.aborted) {
        button.disabled = false;
        select.disabled = false;
      }
    }
  }
  return { button, notice, format };
}

// src/webui/history.ts
var HistoryControls = class {
  constructor(ctx, select) {
    this.ctx = ctx;
    this.select = select;
    const h = ctx.ui.h;
    this.zh = ctx.language.startsWith("zh");
    this.root = h("details", "cm-disclosure cm-history");
    this.root.dataset.control = "history";
    this.body = h("div", "cm-disclosure-body");
    this.root.append(h("summary", null, this.zh ? "\u5386\u53F2\u8BB0\u5F55" : "History"), this.body);
    this.root.addEventListener("toggle", () => {
      if (this.root.open) void this.refresh();
    }, { signal: ctx.signal });
  }
  ctx;
  select;
  root;
  selected = null;
  body;
  busy = false;
  zh;
  current() {
    this.selected = null;
    this.select(null);
  }
  async refresh() {
    if (this.busy || this.ctx.signal.aborted) return;
    this.busy = true;
    const h = this.ctx.ui.h;
    try {
      const data = await this.ctx.invoke("history.list", []);
      if (this.ctx.signal.aborted) return;
      this.body.replaceChildren();
      this.body.append(h("p", "cm-muted", this.zh ? "\u81EA\u52A8\u4FDD\u7559 7 \u5929\u3001\u6700\u591A 30 \u6B21\uFF0F64 MiB\uFF1B\u6E05\u7A7A\u5F53\u524D\u7ED3\u679C\u4E0D\u4F1A\u5220\u9664\u5386\u53F2\u3002\u5F02\u5E38\u9000\u51FA\u4EC5\u6062\u590D\u6700\u540E\u6210\u529F\u5FEB\u7167\u3002" : "Kept for 7 days, up to 30 sessions / 64 MiB. Clearing current results preserves history. Interrupted sessions recover only the last saved snapshot."));
      const controls = h("div", "cm-controls");
      controls.append(
        this.ctx.ui.button(this.zh ? "\u5237\u65B0\u5217\u8868" : "Refresh list", { onClick: () => {
          void this.refresh();
        } }),
        this.ctx.ui.button(this.zh ? "\u8FD4\u56DE\u5F53\u524D\u89C2\u5BDF" : "Back to current observation", { onClick: () => this.current() })
      );
      this.body.append(controls);
      if (data.warnings || data.saveFailed) this.body.append(h("p", "cm-warning", this.zh ? "\u90E8\u5206\u5386\u53F2\u65E0\u6CD5\u8BFB\u53D6\u6216\u4FDD\u5B58\uFF1B\u5185\u5B58\u4E2D\u7684\u5F53\u524D\u7ED3\u679C\u4ECD\u4FDD\u7559\u3002" : "Some history could not be read or saved; current in-memory results are retained."));
      if (!data.entries.length) this.body.append(h("p", "cm-muted", this.zh ? "\u5C1A\u65E0\u4E34\u65F6\u8BB0\u5F55\u3002" : "No saved sessions yet."));
      for (const entry of data.entries) this.body.append(this.row(entry));
    } catch {
      if (!this.ctx.signal.aborted) this.body.replaceChildren(h("p", "cm-warning", this.zh ? "\u5386\u53F2\u8BB0\u5F55\u6682\u4E0D\u53EF\u7528\uFF1B\u8BF7\u68C0\u67E5\u672C\u673A\u4FDD\u5B58\u72B6\u6001\u3002" : "History is unavailable. Check local storage."));
    } finally {
      this.busy = false;
    }
  }
  row(entry) {
    const { ctx, zh } = this, h = ctx.ui.h, row = h("div", "cm-history-row"), info = h("div"), actions = h("div", "cm-history-actions");
    const when = (value) => new Date(value).toLocaleString(zh ? "zh-CN" : "en-US", { hour12: false });
    const state = entry.status === "interrupted" ? zh ? "\u4E2D\u65AD\uFF0C\u4FDD\u5B58\u81F3" : "Interrupted; saved through" : entry.status === "recording" ? zh ? "\u89C2\u5BDF\u4E2D\uFF0C\u4FDD\u5B58\u81F3" : "Recording; saved through" : zh ? "\u5DF2\u505C\u6B62" : "Stopped";
    info.append(
      h("strong", null, entry.name),
      h("p", "cm-muted", `${when(entry.startedAt)} \u2014 ${when(entry.endedAt ?? entry.checkpointAt)}`),
      h("p", "cm-muted", `${entry.requests} ${zh ? "\u8BF7\u6C42" : "requests"} \xB7 ${entry.totalTokens === null ? "\u2014" : entry.totalTokens.toLocaleString()} token \xB7 ${state} ${when(entry.checkpointAt)} \xB7 ${entry.incomplete ? zh ? "\u7EDF\u8BA1\u53EF\u80FD\u4E0D\u5B8C\u6574" : "Coverage may be incomplete" : zh ? "\u65E0\u5DF2\u62A5\u544A\u7F3A\u5931" : "No reported gaps"}`)
    );
    const error = h("p", "cm-warning");
    error.setAttribute("role", "alert");
    const perform = async (fn) => {
      if (this.busy || ctx.signal.aborted) return;
      this.busy = true;
      error.textContent = "";
      try {
        await fn();
      } catch {
        if (!ctx.signal.aborted) error.textContent = zh ? "\u64CD\u4F5C\u5931\u8D25\uFF0C\u8BF7\u91CD\u8BD5\uFF1B\u672A\u66F4\u6539\u5176\u4ED6\u8BB0\u5F55\u3002" : "Operation failed. Please retry; other sessions were not changed.";
      } finally {
        this.busy = false;
      }
    };
    const view = ctx.ui.button(zh ? "\u67E5\u770B" : "View", { onClick: () => {
      void perform(async () => {
        const record = await ctx.invoke("history.get", [entry.id]);
        if (ctx.signal.aborted) return;
        this.selected = record;
        this.select(record);
      });
    } });
    view.dataset.historyView = entry.id;
    const edit = h("div", "cm-history-edit");
    edit.hidden = true;
    const input = h("input");
    input.value = entry.name;
    input.maxLength = 160;
    input.setAttribute("aria-label", zh ? "\u8BB0\u5F55\u540D\u79F0" : "Session name");
    edit.append(input, ctx.ui.button(zh ? "\u4FDD\u5B58\u540D\u79F0" : "Save name", { onClick: () => {
      void perform(async () => {
        const changed = await ctx.invoke("history.rename", [entry.id, input.value]);
        if (ctx.signal.aborted) return;
        entry.name = changed.name;
        info.querySelector("strong").textContent = changed.name;
        edit.hidden = true;
        if (this.selected?.entry.id === entry.id) {
          this.selected.entry.name = changed.name;
          this.selected.payload.selection.name = changed.name;
          this.select(this.selected);
        }
      });
    } }));
    const rename = ctx.ui.button(zh ? "\u91CD\u547D\u540D" : "Rename", { onClick: () => {
      edit.hidden = !edit.hidden;
      if (!edit.hidden) input.focus();
    } });
    let confirm = false;
    const remove = ctx.ui.button(zh ? "\u5220\u9664" : "Delete", { onClick: () => {
      if (!confirm) {
        confirm = true;
        remove.textContent = zh ? "\u786E\u8BA4\u5220\u9664\u6B64\u8BB0\u5F55" : "Confirm deletion";
        return;
      }
      void perform(async () => {
        await ctx.invoke("history.delete", [entry.id]);
        if (ctx.signal.aborted) return;
        if (this.selected?.entry.id === entry.id) this.current();
        row.remove();
        if (!this.body.querySelector(".cm-history-row")) this.body.append(h("p", "cm-muted", zh ? "\u5C1A\u65E0\u4E34\u65F6\u8BB0\u5F55\u3002" : "No saved sessions yet."));
      });
    } });
    remove.disabled = entry.status === "recording";
    actions.append(view, rename, remove);
    row.append(info, actions, edit, error);
    return row;
  }
};

// src/webui/runtime.ts
var text = {
  zh: {
    title: "\u8FD0\u884C\u89C2\u5BDF",
    privacyBefore: "\u5F00\u542F\u672C\u529F\u80FD\u540E\uFF0C\u65B0\u589E\u8FD0\u884C\u8BB0\u5F55",
    privacyMemory: "\u4EC5\u5728\u672C\u673A\u5185\u5B58\u5904\u7406",
    privacyMiddle: "\uFF1B\u5904\u7406\u65F6\u53EF\u80FD\u4E34\u65F6\u63A5\u89E6\u804A\u5929\u548C\u654F\u611F\u5DE5\u5177\u7ED3\u679C\uFF0C\u4F46\u6B63\u6587\u3001\u53C2\u6570\u3001\u6587\u4EF6\u8DEF\u5F84\u3001\u7F51\u9875\u5730\u5740\u5747",
    privacyPolicy: "\u4E0D\u5C55\u793A\u3001\u4E0D\u7559\u5B58\u3001\u4E0D\u4E0A\u4F20",
    privacyAfter: "\u3002",
    boundary: "\u8BF7\u6C42\u603B\u7528\u91CF\u4EE5\u5BBF\u4E3B\u4F9B\u5E94\u5546\u8BB0\u8D26\u503C\u4E3A\u51C6\uFF1B\u5DE5\u5177\u6587\u672C\u4EC5\u4E3A\u65B0\u589E\u5185\u5BB9\u4F30\u7B97\uFF0C\u4E0D\u80FD\u4E0E\u8BF7\u6C42\u603B\u7528\u91CF\u76F8\u52A0\uFF0C\u4E5F\u4E0D\u4EE3\u8868\u5B9E\u9645\u8D39\u7528\u5360\u6BD4\u3002",
    start: "\u5F00\u59CB\u89C2\u5BDF",
    stop: "\u505C\u6B62\u89C2\u5BDF",
    clear: "\u6E05\u7A7A\u7ED3\u679C",
    profile: "\u6587\u672C\u53C2\u8003\u5206\u8BCD\u5668",
    error: "\u64CD\u4F5C\u5931\u8D25\uFF0C\u5F53\u524D\u7ED3\u679C\u4ECD\u4FDD\u7559\u3002\u8BF7\u68C0\u67E5\u6269\u5C55\u662F\u5426\u542F\u7528\uFF0C\u4EE5\u53CA\u4E34\u65F6\u8BB0\u5F55\u7684\u4FDD\u5B58\u72B6\u6001\u3002",
    off: "\u672A\u5F00\u542F",
    starting: "\u51C6\u5907\u89C2\u5BDF",
    recording: "\u6B63\u5728\u89C2\u5BDF",
    stopped: "\u5DF2\u505C\u6B62",
    failed: "\u89C2\u5BDF\u5F02\u5E38",
    ready: "\u53EF\u8BFB",
    missing: "\u5C1A\u672A\u51FA\u73B0\uFF0F\u7F3A\u5931",
    unreadable: "\u4E0D\u53EF\u8BFB",
    changed: "\u6587\u4EF6\u66FE\u88AB\u66FF\u6362\u6216\u622A\u65AD",
    unavailable: "\u4E0D\u53EF\u7528",
    source: "\u6570\u636E\u6E90",
    usage: "\u8BF7\u6C42\u7528\u91CF",
    index: "\u5F53\u524D\u8FD0\u884C\u7D22\u5F15",
    tools: "\u5DE5\u5177\u8BB0\u5F55",
    transcript: "\u5B8C\u6574\u7ED3\u679C\u6D41\u6C34",
    duration: "\u89C2\u5BDF\u65F6\u957F\uFF08\u79D2\uFF09",
    calls: "\u7A97\u53E3\u5185\u4F9B\u5E94\u5546\u8BF7\u6C42",
    input: "\u5DF2\u77E5\u8F93\u5165 token",
    output: "\u5DF2\u77E5\u8F93\u51FA token",
    cached: "\u5176\u4E2D\u7F13\u5B58\u8F93\u5165",
    uncached: "\u5176\u4E2D\u672A\u7F13\u5B58\u8F93\u5165",
    reasoning: "\u5176\u4E2D\u63A8\u7406\u8F93\u51FA",
    reports: "\u6269\u5C55\u81EA\u62A5\u8BB0\u5F55",
    cross: "\u8DE8\u8FB9\u754C\uFF0F\u8D77\u70B9\u672A\u77E5\u7684\u8BF7\u6C42",
    crossTools: "\u8DE8\u8FB9\u754C\uFF0F\u8D77\u70B9\u672A\u77E5\u7684\u5DE5\u5177",
    coverage: "\u8986\u76D6\u63D0\u793A",
    unknown: "\u672A\u77E5",
    none: "\u5C1A\u65E0\u8BB0\u5F55\u3002",
    groupTitle: "\u6309\u6765\u6E90\u6C47\u603B\uFF1A\u5DE5\u5177\u9891\u6B21\u4E0E\u65B0\u589E\u6587\u672C\u4F53\u79EF",
    groupHeaders: ["World \u6765\u6E90", "\u6B21\u6570", "\u6B21\uFF0F\u5206\u949F", "\u7D2F\u8BA1\u8017\u65F6 ms", "\u8BB0\u5F55\u5931\u8D25", "\u5DF2\u77E5\u6587\u672C token", "\u5DF2\u8BA1\uFF0F\u672A\u77E5\u6587\u672C", "\u56FE\u7247\u9644\u4EF6"],
    note: "\u79BB\u5F00\u9762\u677F\u4ECD\u7EE7\u7EED\u89C2\u5BDF\uFF1B\u70B9\u51FB\u505C\u6B62\u6216\u505C\u7528\u6269\u5C55\u624D\u7ED3\u675F\u3002\u91CD\u542F\u9ED8\u8BA4\u5173\u95ED\u3002\u7EDF\u8BA1\u81EA\u52A8\u6682\u5B58\u672C\u673A 7 \u5929\uFF0C\u6700\u591A 30 \u6B21\uFF0F64 MiB\uFF1B\u6E05\u7A7A\u5F53\u524D\u7ED3\u679C\u4ECD\u53EF\u56DE\u770B\u5386\u53F2\uFF0C\u4E5F\u53EF\u624B\u52A8\u5BFC\u51FA\u3002",
    limits: "\u4EC5\u89C2\u5BDF\u6846\u67B6\u5DF2\u6709\u8BB0\u5F55\u3002\u540E\u53F0\u4EFB\u52A1\u53EF\u80FD\u53EA\u6709\u7528\u91CF\u3001\u6CA1\u6709\u64CD\u4F5C\u660E\u7EC6\uFF1B\u5DE5\u5177\u5185\u90E8\u672A\u4E0A\u62A5\u6B65\u9AA4\u4E0D\u53EF\u89C1\u3002\u672A\u8BB0\u8D26\u6216\u505C\u6B62\u65F6\u4ECD\u5728\u6267\u884C\u7684\u8C03\u7528\u4E0D\u4FDD\u8BC1\u6536\u9F50\u3002",
    image: "\u56FE\u7247\u5B9E\u9645 token \u672A\u77E5\uFF1BFlash \u6761\u4EF6\u4E0A\u9650 = \u65B0\u589E\u56FE\u7247\u4EF6\u6570 \xD7 1,024\uFF0C\u4EC5\u5047\u8BBE\u5168\u90E8\u4F5C\u4E3A\u56FE\u50CF\u53D1\u9001\uFF0C\u4E0D\u8BC1\u660E\u5DF2\u53D1\u9001\u6216\u8986\u76D6\u91CD\u590D\u643A\u5E26\u3002Pro \u4E0D\u663E\u793A\u6B64\u4E0A\u9650\u3002",
    totals: "\u6C47\u603B\u53EA\u7D2F\u8BA1\u8D77\u6B62\u53EF\u786E\u8BA4\u5728\u7A97\u53E3\u5185\u7684\u4F9B\u5E94\u5546\u8BF7\u6C42\uFF1B\u81EA\u62A5\u548C\u8DE8\u8FB9\u754C\u8BB0\u5F55\u5355\u5217\u3002\u7F3A\u5931\u8BA1\u6570\u4E0D\u66FF\u6362\u4E3A\u96F6\uFF0C\u5DF2\u77E5\u90E8\u5206\u53EF\u80FD\u4E0D\u5B8C\u6574\u3002",
    truncated: "\u5DF2\u8FBE\u5230\u5185\u5B58\u8BB0\u5F55\u4E0A\u9650\uFF1B\u540E\u7EED\u8BB0\u5F55\u4E0D\u518D\u5B8C\u6574\u3002",
    reference: "\u53C2\u8003",
    referenceNote: "V4.1 \u4F7F\u7528\u5B98\u65B9 recipe \u5BB6\u65CF\u53C2\u8003\uFF0C\u539F\u5BF9\u7167\u4E3A V4-Flash-Vision-Exp\uFF1B\u4E0D\u4FDD\u8BC1\u4E0E Flash \u670D\u52A1\u7AEF\u6216\u5F53\u524D\u8BF7\u6C42\u6A21\u578B\u7684\u5206\u8BCD\u76F8\u540C\u3002",
    displayed: "\u6BCF\u5F20\u8868\u6700\u591A\u5C55\u793A 200 \u6761\uFF1B\u6C47\u603B\u5305\u542B\u5168\u90E8\u7559\u5B58\u8BB0\u5F55\u3002"
  },
  en: {
    title: "Runtime observation",
    privacyBefore: "After enabling this feature, newly appended runtime records are processed ",
    privacyMemory: "only in local memory",
    privacyMiddle: "; processing may temporarily involve chat and sensitive tool results, but bodies, arguments, file paths and page URLs are ",
    privacyPolicy: "not displayed, retained or uploaded",
    privacyAfter: ".",
    boundary: "Request totals use host-recorded provider meters. Tool text is newly returned content estimated locally: do not add it to request totals or interpret it as a cost share.",
    start: "Start observation",
    stop: "Stop observation",
    clear: "Clear results",
    profile: "Text reference tokenizer",
    error: "Operation failed; current results are retained. Check World activation and history storage.",
    off: "Off",
    starting: "Starting",
    recording: "Recording",
    stopped: "Stopped",
    failed: "Observation error",
    ready: "Readable",
    missing: "Not yet present / missing",
    unreadable: "Unreadable",
    changed: "Previously replaced or truncated",
    unavailable: "Unavailable",
    source: "Sources",
    usage: "Request usage",
    index: "Current run index",
    tools: "Tool records",
    transcript: "Full-result transcript",
    duration: "Observed seconds",
    calls: "Provider requests within window",
    input: "Known input tokens",
    output: "Known output tokens",
    cached: "Cached input subset",
    uncached: "Uncached input subset",
    reasoning: "Reasoning output subset",
    reports: "World-reported records",
    cross: "Cross-boundary / unknown-start requests",
    crossTools: "Cross-boundary / unknown-start tools",
    coverage: "Coverage notices",
    unknown: "Unknown",
    none: "No records yet.",
    groupTitle: "By source: tool frequency and new text size",
    groupHeaders: ["World source", "Calls", "Per minute", "Total ms", "Marked failed", "Known text tokens", "Measured / unknown texts", "Image attachments"],
    note: "Leaving this panel keeps observation running. Stop it here or disable the extension. Restart defaults to off. Metadata is cached locally for 7 days, up to 30 sessions / 64 MiB. Clearing current results preserves history; manual export is also available.",
    limits: "Only existing host records are observed. Background requests may have usage without operation details. Unreported internal steps are invisible. Pending or unrecorded calls may be absent at stop.",
    image: "Actual image tokens are unknown. Conditional Flash bound = new image count \xD7 1,024, assuming all were sent as images. It does not prove delivery or include reuse. No such bound is shown for Pro.",
    totals: "Totals include only provider requests with a confirmed start and end within the window. Reports and cross-boundary calls are separate. Missing meters remain unknown; known sums may be partial.",
    truncated: "The in-memory record limit was reached; subsequent coverage is incomplete.",
    reference: "Reference",
    referenceNote: "V4.1 uses the official recipe family reference originally compared against V4-Flash-Vision-Exp. It may differ from Flash server-side tokenization or the model used in a request.",
    displayed: "Each table displays at most 200 rows; aggregates include all retained records."
  }
};
var issues = {
  missing_source: ["\u90E8\u5206\u6570\u636E\u6E90\u5C1A\u672A\u51FA\u73B0\u6216\u7F3A\u5931", "Some sources are missing or not yet present"],
  unreadable_source: ["\u90E8\u5206\u6570\u636E\u6E90\u4E0D\u53EF\u8BFB", "Some sources cannot be read"],
  unsafe_path: ["\u62D2\u7EDD\u4E86\u8D8A\u754C\u6216\u94FE\u63A5\u8DEF\u5F84", "An unsafe or linked path was rejected"],
  source_changed: ["\u6587\u4EF6\u53D1\u751F\u66FF\u6362\u6216\u622A\u65AD\uFF0C\u672A\u56DE\u8BFB\u65E7\u5185\u5BB9", "A file changed; previous content was not reread"],
  oversized_record: ["\u90E8\u5206\u8BB0\u5F55\u8D85\u8FC7 16 MiB\uFF0C\u672A\u8BA1\u5165", "Some records exceeded 16 MiB and were excluded"],
  invalid_record: ["\u90E8\u5206\u8BB0\u5F55\u683C\u5F0F\u6216\u8BA1\u6570\u4E0D\u5408\u683C", "Some records or meters are invalid"],
  unmatched_result: ["\u90E8\u5206\u5DE5\u5177\u7ED3\u679C\u672A\u80FD\u914D\u5BF9\u6216\u4E0D\u5B8C\u6574", "Some tool results are unmatched or incomplete"],
  missing_meter: ["\u90E8\u5206\u4F9B\u5E94\u5546\u8BA1\u6570\u7F3A\u5931", "Some provider meters are missing"],
  conflicting_record: ["\u90E8\u5206\u91CD\u590D\u6807\u8BC6\u53D1\u751F\u51B2\u7A81", "Some duplicate identities conflict"],
  retention_limit: ["\u8FBE\u5230\u5185\u5B58\u8BB0\u5F55\u4E0A\u9650", "The memory record limit was reached"],
  worker_failed: ["\u672C\u673A\u89C2\u5BDF\u7EBF\u7A0B\u5F02\u5E38", "The local observation worker failed"],
  stop_incomplete: ["\u505C\u6B62\u65F6\u672A\u53D6\u5F97\u6700\u7EC8\u5B8C\u6574\u5FEB\u7167", "A complete final snapshot was unavailable at stop"]
};
async function mountRuntime(ctx) {
  const zh = ctx.language === "zh" || ctx.language === "zh-Hant", m = text[zh ? "zh" : "en"], h = ctx.ui.h;
  const root = h("section", "context-meter cm-runtime");
  const intro = h("div", "cm-intro cm-copy-intro"), introList = h("ul", "cm-copy-list"), privacy = h("li");
  privacy.append(m.privacyBefore, h("strong", null, m.privacyMemory), m.privacyMiddle, h("strong", null, m.privacyPolicy), m.privacyAfter);
  introList.append(privacy, h("li", null, m.boundary));
  intro.append(introList);
  const status = h("p", "cm-status");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  const controls = h("div", "cm-controls"), label = h("label", null, m.profile), select = h("select", "field");
  select.setAttribute("aria-label", m.profile);
  for (const profile of ["v41", "v4"]) {
    const option = h("option", null, profile === "v41" ? "DeepSeek-V4.1-Flash / V4.1 reference" : "DeepSeek-V4-Pro / V4 reference");
    option.value = profile;
    select.append(option);
  }
  label.append(select);
  const start = ctx.ui.button(m.start, { onClick: () => {
    void action("start", [select.value]);
  } });
  start.classList.add("cm-primary");
  const stop = ctx.ui.button(m.stop, { onClick: () => {
    void action("stop");
  } });
  const clear = ctx.ui.button(m.clear, { onClick: () => {
    void action("clear");
  } });
  const exporter = exportControls(ctx, () => history.selected?.entry.id ?? null);
  controls.append(label, start, stop, clear, exporter.format, exporter.button);
  const stats = h("div"), groups = h("div"), error = h("p", "cm-warning");
  error.setAttribute("role", "alert");
  const merged = new RuntimeTable(ctx), notes = h("div", "cm-notes cm-copy-notes"), noteList = h("ul", "cm-copy-list");
  const historyBanner = h("div", "cm-history-banner");
  historyBanner.hidden = true;
  let live = null;
  const history = new HistoryControls(ctx, () => {
    if (live) render(live);
  });
  merged.interactions.prepend(history.root);
  for (const note of [m.note, m.totals, m.image, m.referenceNote, m.limits, m.displayed]) noteList.append(h("li", null, note));
  notes.append(noteList);
  root.append(h("h2", null, m.title), intro, controls, exporter.notice, status, historyBanner, error, stats, groups, merged.root, notes);
  ctx.root.append(root);
  let busy = false, recording = false;
  const number = (v) => v === null ? "\u2014" : v.toLocaleString(zh ? "zh-CN" : "en-US", { maximumFractionDigits: 1 });
  const stateText = { off: m.off, starting: m.starting, recording: m.recording, stopped: m.stopped, error: m.failed };
  const sourceText = { ready: m.ready, missing: m.missing, unreadable: m.unreadable, changed: m.changed, unavailable: m.unavailable };
  function table(title, headers, rows) {
    groups.append(h("h3", null, title));
    if (!rows.length) {
      groups.append(h("p", "cm-muted", m.none));
      return;
    }
    const wrap = h("div", "cm-table-wrap"), table2 = h("table", "cm-table"), head = h("thead"), tr = h("tr"), body = h("tbody");
    for (const [index, title2] of headers.entries()) {
      const th = h("th", index ? "cm-number" : null, title2);
      th.scope = "col";
      tr.append(th);
    }
    head.append(tr);
    for (const cells of rows.slice(0, 200)) {
      const row = h("tr");
      for (const [index, value] of cells.entries()) row.append(h("td", index ? "cm-number" : null, value));
      body.append(row);
    }
    table2.append(head, body);
    wrap.append(table2);
    groups.append(wrap);
  }
  function render(current) {
    live = current;
    recording = current.state === "recording" || current.state === "starting";
    const selected = history.selected, report = selected ? selected.payload.runtime : current;
    historyBanner.hidden = !selected;
    historyBanner.replaceChildren();
    if (selected) {
      historyBanner.append(
        h("strong", null, `${zh ? "\u6B63\u5728\u67E5\u770B\u5386\u53F2" : "Viewing history"}: ${selected.entry.name}`),
        h("p", "cm-muted", `${selected.entry.status === "interrupted" ? zh ? "\u4E2D\u65AD\uFF0C\u4FDD\u5B58\u81F3" : "Interrupted; saved through" : zh ? "\u5FEB\u7167\u4FDD\u5B58\u81F3" : "Snapshot saved through"} ${new Date(selected.entry.checkpointAt).toLocaleString(zh ? "zh-CN" : "en-US", { hour12: false })}${recording ? zh ? "\uFF1B\u5F53\u524D\u89C2\u5BDF\u4ECD\u5728\u540E\u53F0\u7EE7\u7EED\u3002" : "; current observation continues in the background." : ""}`),
        ctx.ui.button(zh ? "\u8FD4\u56DE\u5F53\u524D\u89C2\u5BDF" : "Back to current observation", { onClick: () => history.current() })
      );
    }
    select.value = current.profile;
    select.disabled = recording;
    start.disabled = recording;
    stop.disabled = !recording;
    clear.disabled = recording;
    const statusText = `${stateText[report.state]} \xB7 ${m.reference}: ${report.profile === "v41" ? "V4.1" : "V4"}`;
    if (status.textContent !== statusText) status.textContent = statusText;
    status.dataset.state = report.state;
    const oldFrame = groups.querySelector(".cm-table-wrap");
    const groupLeft = oldFrame?.scrollLeft ?? 0, groupTop = oldFrame?.scrollTop ?? 0;
    stats.replaceChildren();
    groups.replaceChildren();
    const summary = h("div", "cm-summary");
    for (const [label2, value] of [
      [m.duration, number(report.durationMs / 1e3)],
      [m.calls, number(report.totals.providerRequests)],
      [m.input, number(report.totals.input)],
      [m.output, number(report.totals.output)],
      [m.cached, number(report.totals.cachedInput)],
      [m.uncached, number(report.totals.uncachedInput)],
      [m.reasoning, number(report.totals.reasoning)],
      [m.reports, number(report.totals.reportedRecords)],
      [m.cross, number(report.totals.boundaryRequests)],
      [m.crossTools, number(report.totals.boundaryTools)]
    ]) {
      const card = h("div", "cm-stat");
      card.append(h("span", "cm-muted", label2), h("strong", null, value));
      summary.append(card);
    }
    stats.append(summary, h("p", "cm-muted", `${m.source}: ` + ["usage", "index", "tools", "transcript"].map((k) => `${m[k]}: ${sourceText[report.sources[k]]}`).join(" \xB7 ")));
    if (Object.keys(report.issues).length) {
      const notices = h("p", "cm-warning", m.coverage + ": " + Object.entries(report.issues).map(([key, n]) => `${issues[key]?.[zh ? 0 : 1] ?? m.unknown} (${n})`).join("\uFF1B"));
      stats.append(notices);
    }
    if (report.truncated) stats.append(h("p", "cm-warning", m.truncated));
    if (current.historySaveFailed) stats.append(h("p", "cm-warning", zh ? "\u4E34\u65F6\u8BB0\u5F55\u4FDD\u5B58\u5931\u8D25\uFF1B\u5F53\u524D\u7ED3\u679C\u4ECD\u5728\u5185\u5B58\uFF0C\u8BF7\u5148\u5BFC\u51FA\uFF0C\u68C0\u67E5\u672C\u673A\u4FDD\u5B58\u72B6\u6001\u540E\u518D\u6E05\u7A7A\u3002" : "History could not be saved. Current results remain in memory; export them and check storage before clearing."));
    table(m.groupTitle, m.groupHeaders, report.groups.map((g) => [g.owner, number(g.calls), number(g.perMinute), number(g.durationMs), number(g.failures), number(g.textTokens), `${g.measuredTexts} / ${g.unknownTexts}`, number(g.imageCount)]));
    const nextFrame = groups.querySelector(".cm-table-wrap");
    if (nextFrame) {
      nextFrame.scrollLeft = groupLeft;
      nextFrame.scrollTop = groupTop;
    }
    merged.update(report);
  }
  async function action(method, args = []) {
    if (busy || ctx.signal.aborted) return;
    busy = true;
    error.textContent = "";
    start.disabled = true;
    stop.disabled = true;
    clear.disabled = true;
    if (method !== "status") history.current();
    try {
      const report = await ctx.invoke(method, args);
      if (!ctx.signal.aborted) {
        render(report);
        if (method !== "status" && history.root.open) void history.refresh();
      }
    } catch {
      if (!ctx.signal.aborted) {
        error.textContent = m.error;
        if (method !== "status") try {
          const report = await ctx.invoke("status", []);
          if (!ctx.signal.aborted) render(report);
        } catch {
        }
      }
    } finally {
      busy = false;
      if (!ctx.signal.aborted) {
        start.disabled = recording;
        stop.disabled = !recording;
        clear.disabled = recording;
      }
    }
  }
  await action("status");
  if (!ctx.signal.aborted) ctx.interval(() => {
    if (recording) void action("status");
  }, 1e3);
}

// src/webui/client.ts
var messages2 = {
  zh: {
    title: "\u6269\u5C55\u9759\u6001\u4E0A\u4E0B\u6587\u6392\u884C",
    declaration: "\u58F0\u660E",
    before: "\uFF1A\u672C\u9875\u4EC5\u4E3A",
    warning: "\u9759\u6001\u4F30\u7B97\uFF0C\u4E0D\u662F\u5B9E\u9645\u8BF7\u6C42\u3001\u8D26\u5355\u6216\u8282\u7701\u91D1\u989D",
    scope: "\u3002\u7EDF\u8BA1\u53EA\u6BD4\u8F83\u5DF2\u5B89\u88C5\u5305\uFF08\u542B\u672A\u542F\u7528\u5305\uFF09\u81EA\u5E26\u7684\u5DE5\u5177\u58F0\u660E\u4E0E\u539F\u59CB\u63D0\u793A\u8BCD\u6A21\u677F\uFF0C\u4E0D\u5224\u65AD\u5F53\u524D\u5B9E\u9645\u53D1\u9001\u4E86\u54EA\u4E9B\u5185\u5BB9\uFF1B\u4E0D\u8BFB\u53D6\u804A\u5929\u3001\u8BB0\u5FC6\u3001\u5DE5\u5177\u56DE\u6267\u6216\u5BC6\u94A5\u3002\u9700\u8981\u52A8\u6001\u89C2\u5BDF\u8BF7\u79FB\u6B65\u201C\u8FD0\u884C\u89C2\u5BDF\u201D\u9875\u3002",
    tokenizer: "\u53C2\u8003\u5206\u8BCD\u5668",
    refresh: "\u5237\u65B0\u7EDF\u8BA1",
    loading: "\u6B63\u5728\u672C\u673A\u7EDF\u8BA1\u2026",
    failed: "\u7EDF\u8BA1\u5931\u8D25\uFF0C\u8BF7\u91CD\u8BD5\u3002",
    empty: "\u6CA1\u6709\u53D1\u73B0\u76F4\u63A5\u5B89\u88C5\u7684\u6269\u5C55\u3002",
    missing: "\u672A\u627E\u5230\u6846\u67B6\u6307\u5B9A\u7684\u6269\u5C55\u76EE\u5F55\u6216\u4F9D\u8D56\u6E05\u5355\u3002",
    unreadable: "\u65E0\u6CD5\u8BFB\u53D6\u6269\u5C55\u4F9D\u8D56\u6E05\u5355\uFF1B\u672A\u626B\u63CF\u5176\u4ED6\u76EE\u5F55\u3002",
    sum: "\u5DF2\u7EDF\u8BA1\u58F0\u660E token",
    coverage: "\u58F0\u660E\u5B8C\u6574 / \u90E8\u5206 / \u65E0\u6CD5\u8BC4\u4F30",
    updated: "\u7EDF\u8BA1\u65F6\u95F4",
    headers: ["\u5305\u540D", "\u7C7B\u522B", "\u5DE5\u5177\u6570", "\u5DE5\u5177\u58F0\u660E token", "\u6A21\u677F token", "\u5408\u8BA1", "\u5DF2\u7EDF\u8BA1\u5360\u6BD4", "\u6570\u636E\u5B8C\u6574\u6027"],
    complete: "\u5B8C\u6574\u58F0\u660E",
    partial: "\u90E8\u5206\u53EF\u8BC4\u4F30",
    unavailable: "\u65E0\u6CD5\u8BC4\u4F30",
    not_applicable: "\u4E0D\u9002\u7528",
    note: "\u201C\u5B8C\u6574\u201D\u4EC5\u8868\u793A\u58F0\u660E\u6570\u636E\u53EF\u89E3\u6790\uFF1B\u4E0D\u4EE3\u8868\u5B9E\u9645\u8FD0\u884C\u5185\u5BB9\u5B8C\u6574\u3002\u6A21\u677F\u53D8\u91CF\u4E0D\u5C55\u5F00\uFF0C\u5171\u4EAB\u534F\u8BAE\u5F00\u9500\u3001\u8F93\u51FA\u53CA\u7F13\u5B58\u8D39\u7528\u4E0D\u8BA1\u5165\u3002",
    profileNote: "V4.1 \u4E3A DeepSeek \u5B98\u65B9 recipe \u7684\u5BB6\u65CF\u53C2\u8003\u5206\u8BCD\u5668\uFF0C\u539F\u59CB\u5BF9\u7167\u6A21\u578B\u662F V4-Flash-Vision-Exp\uFF1B\u7528\u4E8E Flash \u7684\u6587\u672C\u4F53\u79EF\u6BD4\u8F83\uFF0C\u4E0D\u4FDD\u8BC1\u4E0E\u670D\u52A1\u7AEF\u8BA1\u6570\u76F8\u540C\u3002",
    pending: "\u5206\u8BCD\u5668\u5DF2\u9009\u62E9\uFF0C\u70B9\u51FB\u201C\u5237\u65B0\u7EDF\u8BA1\u201D\u540E\u5E94\u7528\u3002",
    resultProfile: "\u672C\u6B21\u7ED3\u679C\u53C2\u8003"
  },
  en: {
    title: "Declared context ranking",
    declaration: "Notice",
    before: ": This page provides only a ",
    warning: "static estimate, not actual requests, bills or savings",
    scope: ". It compares bundled tool declarations and raw prompt templates of installed packages, including inactive packages, without determining what is actually sent. It reads no chat, memory, tool results or keys. For dynamic observation, use the \u201CRuntime observation\u201D page.",
    tokenizer: "Reference tokenizer",
    refresh: "Refresh",
    loading: "Calculating locally\u2026",
    failed: "Scan failed. Please try again.",
    empty: "No directly installed extensions found.",
    missing: "The configured extension directory or dependency manifest was not found.",
    unreadable: "Cannot read the extension dependency manifest. No other directories were scanned.",
    sum: "Measured declaration tokens",
    coverage: "Complete / partial / unavailable",
    updated: "Scanned at",
    headers: ["Package", "Kind", "Tools", "Tool tokens", "Template tokens", "Total", "Measured share", "Data status"],
    complete: "Complete declarations",
    partial: "Partially measurable",
    unavailable: "Unavailable",
    not_applicable: "Not applicable",
    note: "\u201CComplete\u201D describes parsable declarations, not complete runtime coverage. Template variables stay unexpanded. Shared protocol overhead, output and cache charges are excluded.",
    profileNote: "V4.1 uses the DeepSeek official recipe family reference, originally compared against V4-Flash-Vision-Exp. It is a text-size reference for Flash, not a guarantee of server-side token counts.",
    pending: "Tokenizer selected. Click Refresh to apply.",
    resultProfile: "Reference used"
  }
};
var issueText = {
  manifest_unreadable: ["\u5305\u6E05\u5355\u4E0D\u53EF\u8BFB", "Package manifest unreadable"],
  invalid_manifest: ["\u5305\u58F0\u660E\u4E0D\u5408\u683C", "Invalid package manifest"],
  missing_description: ["\u672A\u58F0\u660E\u81EA\u63CF\u8FF0\u6587\u4EF6", "No self-description declared"],
  description_unreadable: ["\u81EA\u63CF\u8FF0\u4E0D\u53EF\u8BFB\u6216\u4E0D\u5408\u683C", "Self-description unreadable or invalid"],
  unsafe_path: ["\u58F0\u660E\u6587\u4EF6\u8DEF\u5F84\u4E0D\u5408\u683C", "Unsafe declaration path"],
  oversized_file: ["\u58F0\u660E\u6587\u4EF6\u8D85\u8FC7\u5927\u5C0F\u9650\u5236", "Declaration exceeds size limit"],
  invalid_tools: ["\u5DE5\u5177\u5217\u8868\u7F3A\u5931\u6216\u4E0D\u5408\u683C", "Tool list missing or invalid"],
  invalid_tool: ["\u90E8\u5206\u5DE5\u5177\u58F0\u660E\u4E0D\u5408\u683C", "Some tool declarations are invalid"],
  duplicate_tool: ["\u76F8\u540C\u5DE5\u5177\u5DF2\u53BB\u91CD", "Identical tools deduplicated"],
  conflicting_tool: ["\u540C\u540D\u51B2\u7A81\u5DE5\u5177\u672A\u8BA1\u5165", "Conflicting tool names excluded"],
  invalid_prompts: ["\u6A21\u677F\u5217\u8868\u4E0D\u5408\u683C", "Invalid template list"],
  invalid_prompt: ["\u90E8\u5206\u6A21\u677F\u4E0D\u5408\u683C", "Some templates are invalid"],
  duplicate_prompt: ["\u76F8\u540C\u6A21\u677F\u5DF2\u53BB\u91CD", "Identical templates deduplicated"],
  conflicting_prompt: ["\u540C\u540D\u51B2\u7A81\u6A21\u677F\u672A\u8BA1\u5165", "Conflicting template keys excluded"]
};
function profileLabel(profile) {
  return profile === "v41" ? "DeepSeek-V4.1-Flash / V4.1 reference" : "DeepSeek-V4-Pro / V4 reference";
}
async function mount(ctx) {
  const zh = ctx.language === "zh" || ctx.language === "zh-Hant";
  const m = messages2[zh ? "zh" : "en"];
  const h = ctx.ui.h;
  const wrapper = h("section", "context-meter");
  const title = h("h2", null, m.title);
  const declaration = h("p");
  declaration.append(h("strong", null, m.declaration), m.before, h("strong", null, m.warning), m.scope);
  const controls = h("div", "cm-controls");
  const label = h("label", null, m.tokenizer);
  const select = h("select", "field");
  select.setAttribute("aria-label", m.tokenizer);
  for (const profile of ["v41", "v4"]) {
    const option = h("option", null, profileLabel(profile));
    option.value = profile;
    select.append(option);
  }
  label.append(select);
  const refresh = ctx.ui.button(m.refresh, { onClick: () => {
    void run(select.value);
  } });
  refresh.classList.add("cm-primary");
  const exporter = exportControls(ctx);
  controls.append(label, refresh, exporter.format, exporter.button);
  const status = h("p", "cm-status");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  const results = h("div");
  select.addEventListener("change", () => {
    status.textContent = m.pending;
  }, { signal: ctx.signal });
  const intro = h("div", "cm-intro cm-copy-intro");
  intro.append(declaration);
  const notes = h("div", "cm-notes cm-copy-notes");
  notes.append(h("p", null, m.note), h("p", null, m.profileNote));
  wrapper.append(title, intro, controls, exporter.notice, status, results, notes);
  ctx.root.append(wrapper);
  let busy = false;
  const number = (n) => n === null ? "\u2014" : n.toLocaleString(zh ? "zh-CN" : "en-US");
  const cell = (text2) => h("td", null, text2);
  function render(report) {
    results.replaceChildren();
    select.value = report.profile;
    const summary = h("div", "cm-summary");
    for (const [label2, value] of [
      [m.sum, number(report.measuredTokens)],
      [m.coverage, `${report.completeCount} / ${report.partialCount} / ${report.unavailableCount}`],
      [m.resultProfile, profileLabel(report.profile)],
      [m.updated, report.estimatedAt]
    ]) {
      const card = h("div", "cm-stat" + (label2 === m.resultProfile || label2 === m.updated ? " cm-stat-text" : "")), strong = h("strong");
      if (label2 === m.updated) strong.append(dateView(ctx, value));
      else strong.textContent = value;
      card.append(h("span", "cm-muted", label2), strong);
      summary.append(card);
    }
    results.append(summary);
    if (report.directoryStatus !== "ok") {
      results.append(h("p", null, report.directoryStatus === "missing" ? m.missing : m.unreadable));
      return;
    }
    if (!report.rows.length) {
      results.append(h("p", null, m.empty));
      return;
    }
    const scroll = h("div", "cm-table-wrap");
    scroll.tabIndex = 0;
    scroll.setAttribute("role", "region");
    scroll.setAttribute("aria-label", m.title);
    const table = h("table", "cm-table");
    const head = h("thead");
    const header = h("tr");
    for (const [index, label2] of m.headers.entries()) {
      const th = h("th", index >= 2 && index <= 6 ? "cm-number" : null, label2);
      th.scope = "col";
      header.append(th);
    }
    head.append(header);
    const body = h("tbody");
    for (const row of report.rows) body.append(renderRow(row));
    table.append(head, body);
    scroll.append(table);
    results.append(scroll);
  }
  function renderRow(row) {
    const tr = h("tr");
    const statusCell = cell(m[row.status]);
    if (row.issues.length) {
      const notes2 = h("span", "cm-issues", row.issues.map((i) => issueText[i][zh ? 0 : 1]).join("\uFF1B"));
      statusCell.append(notes2);
    }
    tr.append(
      cell(row.name),
      cell(row.kind),
      cell(number(row.toolCount)),
      cell(number(row.toolTokens)),
      cell(number(row.promptTokens)),
      cell(number(row.totalTokens)),
      cell(row.share === null ? "\u2014" : `${(row.share * 100).toFixed(1)}%`),
      statusCell
    );
    for (const index of [2, 3, 4, 5, 6]) tr.children[index].classList.add("cm-number");
    return tr;
  }
  async function run(profile) {
    if (busy || ctx.signal.aborted) return;
    busy = true;
    refresh.disabled = true;
    select.disabled = true;
    status.textContent = m.loading;
    results.replaceChildren();
    try {
      const report = await ctx.invoke("scan", profile ? [profile] : []);
      if (ctx.signal.aborted) return;
      render(report);
      status.textContent = "";
    } catch {
      if (!ctx.signal.aborted) status.textContent = m.failed;
    } finally {
      busy = false;
      refresh.disabled = false;
      select.disabled = false;
    }
  }
  await run();
}
var client_default = { panels: { overview: { mount }, runtime: { mount: mountRuntime } } };
export {
  client_default as default,
  mount
};
