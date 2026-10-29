// src/runtime/worker.ts
import { parentPort, workerData } from "node:worker_threads";

// src/tokenizer.ts
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { Tokenizer } from "@huggingface/tokenizers";

// src/types.ts
function isProfile(value) {
  return value === "v41" || value === "v4";
}

// src/tokenizer.ts
var hashes = {
  v41: "81f64d1248a68ce3663e07ab3ee48b851e5df0e32d27cb98e4c9a268151e8d99",
  v4: "97d2f31b020d18b5aee5c9b3d5b4efb10ea210f3fe3f7dffe3f1cd90542d6b19"
};
var cache = /* @__PURE__ */ new Map();
function loadCounter(profile) {
  if (!isProfile(profile)) return Promise.reject(new Error("Unsupported tokenizer profile."));
  let pending = cache.get(profile);
  if (!pending) {
    pending = (async () => {
      const bytes = await readFile(new URL("../assets/tokenizers/" + profile + "/tokenizer.json", import.meta.url));
      if (createHash("sha256").update(bytes).digest("hex") !== hashes[profile]) throw new Error("Bundled tokenizer checksum mismatch.");
      const tokenizer = new Tokenizer(JSON.parse(bytes.toString("utf8")), {});
      return (text) => tokenizer.encode(text, { add_special_tokens: false }).ids.length;
    })();
    cache.set(profile, pending);
    pending.catch(() => cache.delete(profile));
  }
  return pending;
}

// src/runtime/accumulator.ts
import { createHash as createHash2 } from "node:crypto";

// src/estimate.ts
var object = (v) => !!v && typeof v === "object" && !Array.isArray(v);

// src/runtime/tail.ts
import { open, realpath } from "node:fs/promises";
import { join } from "node:path";

// src/files.ts
import { extname, isAbsolute, relative, resolve, sep } from "node:path";
function contained(root, path) {
  const part = relative(root, path);
  return part !== "" && part !== ".." && !part.startsWith(`..${sep}`) && !isAbsolute(part);
}

// src/runtime/tail.ts
var RUN_ID = /^r-\d{8}-\d{6}-[a-f0-9]{4}$/;
var RECORD_LIMIT = 16 * 1024 * 1024;
var CHUNK = 64 * 1024;
var LogFiles = class {
  constructor(directory, audit) {
    this.directory = directory;
    this.audit = audit;
  }
  directory;
  audit;
  root = null;
  async file(name2) {
    if (name2 !== "usage.jsonl" && name2 !== "runs/index.jsonl" && !/^runs\/r-\d{8}-\d{6}-[a-f0-9]{4}\/(toolcalls|transcript)\.jsonl$/.test(name2))
      throw Object.assign(new Error("unsafe_path"), { code: "UNSAFE" });
    this.root ??= await realpath(this.directory);
    const candidate = join(this.root, ...name2.split("/"));
    const actual = await realpath(candidate);
    const same = process.platform === "win32" ? actual.toLowerCase() === candidate.toLowerCase() : actual === candidate;
    if (!contained(this.root, actual) || !same) throw Object.assign(new Error("unsafe_path"), { code: "UNSAFE" });
    this.audit?.(actual);
    const handle = await open(actual, "r");
    try {
      const stat = await handle.stat();
      if (!stat.isFile()) throw Object.assign(new Error("unsafe_path"), { code: "UNSAFE" });
      return { handle, stat };
    } catch (error) {
      await handle.close();
      throw error;
    }
  }
};
function issueFor(error) {
  return error.code === "UNSAFE" ? "unsafe_path" : "unreadable_source";
}
var Tail = class {
  constructor(files, name2, note) {
    this.files = files;
    this.name = name2;
    this.note = note;
  }
  files;
  name;
  note;
  state = "unavailable";
  offset = 0;
  identity = null;
  parts = [];
  length = 0;
  dropping = false;
  missingReported = false;
  backlog = false;
  get incomplete() {
    return this.backlog || this.length > 0;
  }
  key(stat) {
    return `${stat.dev}:${stat.ino}:${stat.birthtimeMs}`;
  }
  async baseline() {
    try {
      const { handle, stat } = await this.files.file(this.name);
      try {
        this.offset = stat.size;
        this.identity = this.key(stat);
        this.state = "ready";
        if (stat.size) {
          const byte = Buffer.alloc(1);
          await handle.read(byte, 0, 1, stat.size - 1);
          this.dropping = byte[0] !== 10;
        }
      } finally {
        await handle.close();
      }
    } catch (error) {
      this.failed(error);
    }
  }
  failed(error) {
    if (error.code === "ENOENT") {
      this.state = "missing";
      if (!this.missingReported) {
        this.note("missing_source");
        this.missingReported = true;
      }
    } else {
      this.state = "unreadable";
      this.note(issueFor(error));
    }
  }
  async poll(accept, active = () => true) {
    if (!active()) return;
    let opened;
    try {
      opened = await this.files.file(this.name);
    } catch (error) {
      this.failed(error);
      return;
    }
    const { handle, stat } = opened;
    try {
      if (!active()) return;
      if (this.identity !== null && (this.key(stat) !== this.identity || stat.size < this.offset)) {
        this.note("source_changed");
        this.state = "changed";
        this.offset = stat.size;
        this.identity = this.key(stat);
        this.parts = [];
        this.length = 0;
        this.dropping = false;
        this.backlog = false;
        if (stat.size && active()) {
          const byte = Buffer.alloc(1);
          await handle.read(byte, 0, 1, stat.size - 1);
          this.dropping = byte[0] !== 10;
        }
        return;
      }
      this.identity = this.key(stat);
      this.state = "ready";
      const end = Math.min(stat.size, this.offset + 4 * 1024 * 1024);
      while (this.offset < end && active()) {
        const bytes = Buffer.alloc(Math.min(CHUNK, end - this.offset));
        const { bytesRead } = await handle.read(bytes, 0, bytes.length, this.offset);
        if (!bytesRead) break;
        this.offset += bytesRead;
        if (!active()) return;
        this.feed(bytes.subarray(0, bytesRead), accept);
      }
      this.backlog = this.offset < stat.size;
    } finally {
      await handle.close();
    }
  }
  feed(bytes, accept) {
    let start = 0;
    while (start < bytes.length) {
      const lf = bytes.indexOf(10, start);
      const end = lf === -1 ? bytes.length : lf;
      const part = bytes.subarray(start, end);
      if (!this.dropping) {
        this.length += part.length;
        if (this.length > RECORD_LIMIT) {
          this.parts = [];
          this.length = 0;
          this.dropping = true;
          this.note("oversized_record");
        } else this.parts.push(part);
      }
      if (lf === -1) break;
      if (!this.dropping && this.length) {
        let value;
        try {
          value = JSON.parse(Buffer.concat(this.parts, this.length).toString("utf8"));
        } catch {
          this.note("invalid_record");
          value = void 0;
        }
        if (value !== void 0) accept(value);
      }
      this.parts = [];
      this.length = 0;
      this.dropping = false;
      start = lf + 1;
    }
  }
};
async function currentRun(files, pid, note) {
  let opened;
  try {
    opened = await files.file("runs/index.jsonl");
  } catch (error) {
    note(error.code === "ENOENT" ? "missing_source" : issueFor(error));
    return null;
  }
  const { handle, stat } = opened;
  try {
    const start = Math.max(0, stat.size - 64 * 1024);
    const bytes = Buffer.alloc(stat.size - start);
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, start);
    let lines = bytes.subarray(0, bytesRead).toString("utf8").split("\n");
    if (start) lines = lines.slice(1);
    const closed = /* @__PURE__ */ new Set();
    for (const line of lines.reverse()) {
      if (!line.trim()) continue;
      let row;
      try {
        row = JSON.parse(line);
      } catch {
        note("invalid_record");
        continue;
      }
      if (!row || typeof row !== "object" || typeof row.run !== "string" || !RUN_ID.test(row.run)) continue;
      if (typeof row.endedAt === "string") {
        closed.add(row.run);
        continue;
      }
      if (row.pid === pid && !closed.has(row.run)) return row.run;
    }
    note("missing_source");
    return null;
  } finally {
    await handle.close();
  }
}

// src/runtime/types.ts
function emptyRuntime(profile = "v41") {
  return {
    state: "off",
    profile,
    startedAt: null,
    endedAt: null,
    updatedAt: null,
    durationMs: 0,
    run: null,
    sources: { usage: "unavailable", index: "unavailable", tools: "unavailable", transcript: "unavailable" },
    issues: {},
    requests: [],
    tools: [],
    groups: [],
    truncated: false,
    totals: {
      input: null,
      output: null,
      cachedInput: null,
      uncachedInput: null,
      reasoning: null,
      providerRequests: 0,
      reportedRecords: 0,
      boundaryRequests: 0,
      toolCalls: 0,
      boundaryTools: 0
    }
  };
}

// src/runtime/accumulator.ts
var LIMIT = 1e4;
var digest = (...values) => createHash2("sha256").update(JSON.stringify(values)).digest("hex").slice(0, 24);
var name = (value, fallback = "unknown") => typeof value === "string" && /^[a-zA-Z0-9_.@+-]{1,120}$/.test(value) ? value : fallback;
var id = (value) => typeof value === "string" && value.length > 0 && value.length <= 512 ? digest(value) : null;
var meter = (value) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
var date = (value) => typeof value === "string" && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
var sum = (values) => {
  if (!values.some((v) => v !== null)) return null;
  const n = values.reduce((s, v) => s + (v ?? 0), 0);
  return Number.isSafeInteger(n) ? n : null;
};
var offsetDate = (at, offset) => {
  const date2 = new Date(Date.parse(at) + offset);
  return Number.isFinite(date2.getTime()) ? date2.toISOString() : null;
};
var Accumulator = class {
  constructor(profile, startMs, count, run) {
    this.startMs = startMs;
    this.count = count;
    this.report = emptyRuntime(profile);
    this.report.startedAt = new Date(startMs).toISOString();
    this.report.state = "recording";
    this.report.run = run;
  }
  startMs;
  count;
  report;
  requests = /* @__PURE__ */ new Map();
  tools = /* @__PURE__ */ new Map();
  results = /* @__PURE__ */ new Map();
  seenResults = /* @__PURE__ */ new Set();
  boundaries = /* @__PURE__ */ new Set();
  note = (issue) => {
    this.report.issues[issue] = (this.report.issues[issue] ?? 0) + 1;
  };
  capacity(map, keyExists = false) {
    if (keyExists || map.size < LIMIT) return true;
    this.report.truncated = true;
    if (!this.report.issues.retention_limit) this.note("retention_limit");
    return false;
  }
  validRun(value) {
    return typeof value === "string" && RUN_ID.test(value) && (!this.report.run || value === this.report.run);
  }
  usage(value) {
    if (!object(value) || value.version !== 2 || !this.validRun(value.run)) {
      this.note("invalid_record");
      return;
    }
    const at = date(value.ts);
    const attempt = object(value.attempt) ? value.attempt : null;
    const key = id(attempt?.id ?? value.recordId);
    if (!key || !at) {
      this.note("invalid_record");
      return;
    }
    if (this.requests.has(key)) return;
    if (!this.capacity(this.requests)) return;
    const m = attempt && object(attempt.meters) ? attempt.meters : null;
    const meters = m ? { input: meter(m.input), output: meter(m.output), cachedInput: meter(m.cachedInput), uncachedInput: meter(m.uncachedInput), reasoning: meter(m.reasoning) } : attempt ? { input: null, output: null, cachedInput: null, uncachedInput: null, reasoning: null } : { input: meter(value.promptTokens), output: meter(value.completionTokens), cachedInput: meter(value.cacheHitTokens), uncachedInput: meter(value.cacheMissTokens), reasoning: meter(value.reasoningTokens) };
    if (Object.values(meters).some((v) => v === null)) this.note("missing_meter");
    if (meters.input !== null && ((meters.cachedInput ?? 0) > meters.input || (meters.uncachedInput ?? 0) > meters.input || meters.cachedInput !== null && meters.uncachedInput !== null && meters.cachedInput + meters.uncachedInput !== meters.input)) {
      meters.cachedInput = null;
      meters.uncachedInput = null;
      this.note("invalid_record");
    }
    if (meters.output !== null && meters.reasoning !== null && meters.reasoning > meters.output) {
      meters.reasoning = null;
      this.note("invalid_record");
    }
    const startedAt = date(attempt?.startedAt);
    const durationMs = meter(attempt?.elapsedMs);
    const finished = startedAt !== null && durationMs !== null ? offsetDate(startedAt, durationMs) : at;
    if (finished === null) {
      this.note("invalid_record");
      return;
    }
    if (Date.parse(finished) < this.startMs) return;
    const request = {
      ...meters,
      id: key,
      run: value.run,
      round: meter(value.round),
      responseId: id(attempt?.responseId),
      role: name(value.role),
      model: name(value.model),
      at: finished,
      startedAt,
      durationMs,
      outcome: typeof attempt?.outcome === "string" && ["completed", "incomplete", "failed", "aborted", "discarded"].includes(attempt.outcome) ? attempt.outcome : !attempt ? "reported" : "unknown",
      basis: attempt ? "provider" : "reported",
      // Reports without a request start cannot prove that their entire usage belongs to the window.
      boundary: startedAt === null || durationMs === null || Date.parse(startedAt) < this.startMs,
      tools: []
    };
    this.requests.set(key, request);
  }
  tool(value) {
    if (!object(value) || !this.validRun(value.run)) {
      this.note("invalid_record");
      return;
    }
    const at = date(value.ts);
    const durationMs = meter(value.durMs);
    if (!at || typeof value.tool !== "string") {
      this.note("invalid_record");
      return;
    }
    if (Date.parse(at) < this.startMs) return;
    const callId = id(value.call), seq = meter(value.seq);
    if (callId === null && seq === null) {
      this.note("invalid_record");
      return;
    }
    const key = digest(value.run, callId ?? `seq:${seq}`);
    const existing = this.tools.get(key);
    if (existing) {
      if (existing.tool !== name(value.tool) || existing.owner !== name(value.mod, "persona-core") || existing.durationMs !== durationMs) this.note("conflicting_record");
      return;
    }
    if (!this.capacity(this.tools)) return;
    const startedAt = durationMs !== null ? offsetDate(at, -durationMs) : null;
    const resultKey = callId ? digest(value.run, callId) : null;
    const paired = resultKey ? this.results.get(resultKey) : void 0;
    if (resultKey && paired) this.results.delete(resultKey);
    let textTokens = null;
    let textBasis = null;
    if (paired) {
      textTokens = paired.textTokens;
      textBasis = "transcript";
    } else if (typeof value.receipt === "string" && meter(value.chars) === value.receipt.length) {
      textTokens = this.count(value.receipt);
      textBasis = "complete_receipt";
    }
    const imageCount = paired?.imageCount ?? (value.blobs === void 0 || value.blobs === 0 ? 0 : null);
    this.tools.set(key, {
      id: key,
      run: value.run,
      round: meter(value.round),
      responseId: id(value.resp),
      callId,
      at,
      startedAt,
      tool: name(value.tool),
      owner: name(value.mod, "persona-core"),
      role: name(value.role),
      durationMs,
      failed: value.failed === void 0 ? false : value.failed === true ? true : null,
      boundary: startedAt === null || Date.parse(startedAt) < this.startMs,
      textTokens,
      textBasis,
      imageCount,
      imageTokens: null,
      flashImageUpperBound: this.upper(imageCount)
    });
  }
  transcript(value) {
    if (!object(value) || !this.validRun(value.run)) {
      this.note("invalid_record");
      return;
    }
    if (value.kind === "boundary") {
      if (typeof value.event === "string" && ["handoff", "clear", "prefix-reload", "ephemeral-drop", "orphan-result-drop"].includes(value.event)) {
        const key2 = digest(value.run, value.ts, value.event);
        if (this.capacity(this.boundaries, this.boundaries.has(key2))) this.boundaries.add(key2);
      }
      return;
    }
    if (value.kind !== "item" || !object(value.item)) {
      this.note("invalid_record");
      return;
    }
    const item = value.item;
    if (item.type !== "function_call_output") return;
    const at = date(value.ts), callId = id(item.call_id);
    if (!at || !callId) {
      this.note("invalid_record");
      return;
    }
    if (Date.parse(at) < this.startMs) return;
    const key = digest(value.run, callId);
    if (this.seenResults.has(key)) return;
    if (!this.capacity(this.seenResults)) return;
    this.seenResults.add(key);
    let textTokens = null;
    let explicitImages = 0;
    if (typeof item.output === "string") textTokens = this.count(item.output);
    else if (Array.isArray(item.output)) {
      const texts = [];
      let valid = true;
      for (const part of item.output) {
        if (!object(part)) {
          valid = false;
          continue;
        }
        if (["input_text", "output_text", "text"].includes(String(part.type)) && typeof part.text === "string") texts.push(part.text);
        else if (part.type === "input_image") explicitImages++;
        else valid = false;
      }
      if (valid) textTokens = this.count(texts.join(""));
      else this.note("invalid_record");
    } else this.note("invalid_record");
    let imageCount = object(value.context) ? explicitImages : null;
    const blobs = object(value.context) ? value.context.blobs : void 0;
    if (Array.isArray(blobs)) {
      if (blobs.every((b) => object(b) && typeof b.mime === "string") && imageCount !== null) imageCount += blobs.filter((b) => b.mime.startsWith("image/")).length;
      else imageCount = null;
    } else if (blobs !== void 0) imageCount = null;
    const summary = { textTokens, imageCount };
    const tool = this.tools.get(key);
    if (tool) {
      tool.textTokens = textTokens;
      tool.textBasis = "transcript";
      tool.imageCount = imageCount;
      tool.flashImageUpperBound = this.upper(imageCount);
    } else if (this.capacity(this.results)) this.results.set(key, summary);
  }
  upper(images) {
    return this.report.profile === "v41" && images !== null ? images * 1024 : null;
  }
  snapshot(now = Date.now(), stopped = false) {
    this.report.durationMs = Math.max(0, now - this.startMs);
    this.report.updatedAt = new Date(now).toISOString();
    if (stopped) {
      this.report.state = "stopped";
      this.report.endedAt = this.report.updatedAt;
    }
    const tools = [...this.tools.values()].sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
    const requests = [...this.requests.values()].sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
    const responseTools = /* @__PURE__ */ new Map(), roundTools = /* @__PURE__ */ new Map(), roundWithoutResponse = /* @__PURE__ */ new Map();
    const add = (map, key, value) => {
      const list = map.get(key) ?? [];
      list.push(value);
      map.set(key, list);
    };
    for (const tool of tools) {
      if (tool.responseId !== null) add(responseTools, JSON.stringify([tool.run, tool.role, tool.responseId]), tool.id);
      if (tool.round !== null) {
        const key = JSON.stringify([tool.run, tool.role, tool.round]);
        add(roundTools, key, tool.id);
        if (tool.responseId === null) add(roundWithoutResponse, key, tool.id);
      }
    }
    for (const request of requests) {
      const roundKey = JSON.stringify([request.run, request.role, request.round]);
      request.tools = request.responseId !== null ? [
        ...responseTools.get(JSON.stringify([request.run, request.role, request.responseId])) ?? [],
        ...request.round === null ? [] : roundWithoutResponse.get(roundKey) ?? []
      ] : request.round === null ? [] : roundTools.get(roundKey) ?? [];
    }
    const inside = requests.filter((r) => !r.boundary && r.basis === "provider");
    const insideTools = tools.filter((t) => !t.boundary);
    this.report.requests = requests;
    this.report.tools = tools;
    const grouped = /* @__PURE__ */ new Map();
    for (const tool of insideTools) {
      const list = grouped.get(tool.owner) ?? [];
      list.push(tool);
      grouped.set(tool.owner, list);
    }
    this.report.groups = [...grouped].map(([owner, list]) => ({
      owner,
      calls: list.length,
      perMinute: this.report.durationMs > 0 ? list.length * 6e4 / this.report.durationMs : null,
      durationMs: sum(list.map((t) => t.durationMs)),
      failures: list.some((t) => t.failed === null) ? null : list.filter((t) => t.failed).length,
      textTokens: sum(list.map((t) => t.textTokens)),
      measuredTexts: list.filter((t) => t.textTokens !== null).length,
      unknownTexts: list.filter((t) => t.textTokens === null).length,
      imageCount: list.some((t) => t.imageCount === null) ? null : sum(list.map((t) => t.imageCount))
    })).sort((a, b) => (b.textTokens ?? -1) - (a.textTokens ?? -1) || b.calls - a.calls || a.owner.localeCompare(b.owner));
    for (const field of ["input", "output", "cachedInput", "uncachedInput", "reasoning"]) this.report.totals[field] = sum(inside.map((r) => r[field]));
    Object.assign(this.report.totals, {
      providerRequests: inside.length,
      reportedRecords: requests.filter((r) => r.basis === "reported").length,
      boundaryRequests: requests.filter((r) => r.boundary && r.basis === "provider").length,
      toolCalls: insideTools.length,
      boundaryTools: tools.length - insideTools.length
    });
    const unmatched = tools.filter((t) => t.textTokens === null).length + this.results.size;
    if (unmatched) this.report.issues.unmatched_result = unmatched;
    else delete this.report.issues.unmatched_result;
    return structuredClone(this.report);
  }
};

// src/runtime/session.ts
var ObservationSession = class {
  constructor(options) {
    this.options = options;
    this.now = options.now ?? Date.now;
  }
  options;
  active = false;
  accumulator = null;
  tails = {};
  polling = null;
  now;
  async start() {
    const count = await this.options.counter();
    const notes = [];
    const files = new LogFiles(this.options.dataDir, this.options.audit);
    const run = await currentRun(files, this.options.pid, (issue) => notes.push(issue));
    const note = (issue) => this.accumulator ? this.accumulator.note(issue) : notes.push(issue);
    this.tails.usage = new Tail(files, "usage.jsonl", note);
    if (run) {
      this.tails.tools = new Tail(files, `runs/${run}/toolcalls.jsonl`, note);
      this.tails.transcript = new Tail(files, `runs/${run}/transcript.jsonl`, note);
    }
    for (const tail of Object.values(this.tails)) await tail.baseline();
    this.accumulator = new Accumulator(this.options.profile, this.now(), count, run);
    this.accumulator.report.sources.index = run ? "ready" : "unavailable";
    for (const issue of notes) this.accumulator.note(issue);
    this.active = true;
    return this.snapshot();
  }
  async poll() {
    if (!this.active) return this.snapshot();
    if (!this.polling) {
      this.polling = (async () => {
        const a = this.accumulator;
        for (const kind of ["usage", "tools", "transcript"]) {
          if (!this.active) break;
          const tail = this.tails[kind];
          if (!tail) continue;
          await tail.poll((value) => {
            if (this.active) a[kind === "tools" ? "tool" : kind](value);
          }, () => this.active);
        }
      })();
    }
    try {
      await this.polling;
    } finally {
      this.polling = null;
    }
    return this.snapshot();
  }
  snapshot(stopped = false) {
    const a = this.accumulator;
    if (!a) throw new Error("Observation is not initialized.");
    for (const kind of ["usage", "tools", "transcript"]) a.report.sources[kind] = this.tails[kind]?.state ?? "unavailable";
    const missing = Object.values(a.report.sources).filter((s) => s === "missing" || s === "unavailable").length;
    if (missing) a.report.issues.missing_source = missing;
    else delete a.report.issues.missing_source;
    return a.snapshot(this.now(), stopped);
  }
  async stop() {
    if (this.polling) await this.polling;
    if (this.active) await this.poll();
    this.active = false;
    if (Object.values(this.tails).some((t) => t.incomplete)) this.accumulator?.note("stop_incomplete");
    return this.snapshot(true);
  }
};

// src/runtime/worker.ts
if (!parentPort) throw new Error("Observer requires a worker.");
var port = parentPort;
var timer;
var closing = false;
var session;
var fail = () => {
  port.postMessage({ type: "failed" });
  port.close();
};
if (!workerData || typeof workerData.dataDir !== "string" || !isProfile(workerData.profile) || !Number.isSafeInteger(workerData.pid)) fail();
else {
  session = new ObservationSession({
    dataDir: workerData.dataDir,
    profile: workerData.profile,
    pid: workerData.pid,
    counter: () => loadCounter(workerData.profile)
  });
  const current = session;
  const tick = async () => {
    if (closing) return;
    try {
      const report = await current.poll();
      if (!closing) port.postMessage({ type: "report", report });
    } catch {
      if (!closing) {
        closing = true;
        fail();
      }
      return;
    }
    if (!closing) timer = setTimeout(() => {
      void tick();
    }, 1e3);
  };
  port.on("message", async (message) => {
    if (message?.type !== "stop" || closing) return;
    closing = true;
    if (timer) clearTimeout(timer);
    try {
      const report = await current.stop();
      port.postMessage({ type: "report", report });
      port.close();
    } catch {
      fail();
    }
  });
  try {
    const report = await current.start();
    if (!closing) {
      port.postMessage({ type: "report", report });
      timer = setTimeout(() => {
        void tick();
      }, 1e3);
    }
  } catch {
    closing = true;
    fail();
  }
}
