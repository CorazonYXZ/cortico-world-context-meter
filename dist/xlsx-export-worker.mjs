// src/excel/worker.ts
import { parentPort, workerData } from "node:worker_threads";

// src/excel/xlsx.ts
import ExcelJS from "exceljs/dist/exceljs.min.js";
var labels = {
  id: "\u6807\u8BC6",
  run: "\u8FD0\u884C\u6807\u8BC6",
  round: "\u8F6E\u6B21",
  responseId: "\u54CD\u5E94\u6807\u8BC6",
  callId: "\u8C03\u7528\u6807\u8BC6",
  role: "\u89D2\u8272\uFF0F\u6765\u6E90",
  model: "\u6A21\u578B",
  at: "\u5B8C\u6210\u65F6\u95F4\uFF08ISO\uFF09",
  startedAt: "\u5F00\u59CB\u65F6\u95F4\uFF08ISO\uFF09",
  durationMs: "\u8017\u65F6 ms",
  outcome: "\u72B6\u6001",
  basis: "\u56DE\u6267\u7C7B\u578B",
  boundary: "\u8DE8\u8FB9\u754C\uFF0F\u8D77\u70B9\u672A\u77E5",
  input: "\u8F93\u5165",
  output: "\u8F93\u51FA",
  cachedInput: "\u7F13\u5B58\u8F93\u5165",
  uncachedInput: "\u672A\u7F13\u5B58\u8F93\u5165",
  reasoning: "\u63A8\u7406\u8F93\u51FA",
  totalTokens: "\u603B token\uFF08\u8F93\u5165\uFF0B\u8F93\u51FA\uFF09",
  tool: "\u5DE5\u5177",
  owner: "World \u6765\u6E90",
  failed: "\u8BB0\u5F55\u5931\u8D25",
  textTokens: "\u6587\u672C\u4F30\u7B97 token",
  textBasis: "\u6587\u672C\u4F9D\u636E",
  imageCount: "\u56FE\u7247\u9644\u4EF6",
  imageTokens: "\u5B9E\u9645\u56FE\u7247 token",
  flashImageUpperBound: "Flash \u6761\u4EF6\u4E0A\u9650",
  name: "\u5305\u540D",
  kind: "\u7C7B\u522B",
  status: "\u5B8C\u6574\u6027",
  toolCount: "\u5DE5\u5177\u6570",
  toolTokens: "\u5DE5\u5177\u58F0\u660E token",
  promptTokens: "\u6A21\u677F token",
  share: "\u5DF2\u7EDF\u8BA1\u5360\u6BD4",
  issues: "\u8986\u76D6\u63D0\u793A",
  calls: "\u6B21\u6570",
  perMinute: "\u6BCF\u5206\u949F\u6B21\u6570",
  failures: "\u5931\u8D25\u6B21\u6570",
  measuredTexts: "\u5DF2\u8BA1\u6587\u672C",
  unknownTexts: "\u672A\u77E5\u6587\u672C",
  requestId: "\u8BF7\u6C42\u6807\u8BC6",
  toolId: "\u5DE5\u5177\u8BB0\u5F55\u6807\u8BC6",
  linked: "\u5DE5\u5177\u8BB0\u5F55\u5DF2\u7559\u5B58",
  key: "\u9879\u76EE",
  value: "\u503C"
};
async function xlsxBuffer(data, language = "zh") {
  const zh = language.startsWith("zh"), workbook = new ExcelJS.Workbook();
  workbook.creator = "token\u8BA1\u6570";
  workbook.created = new Date(data.exportedAt);
  function sheet(name, en, keys, rows) {
    const ws = workbook.addWorksheet(zh ? name : en, { views: [{ state: "frozen", ySplit: 1 }] });
    ws.columns = keys.map((key) => ({ header: zh ? labels[key] ?? key : key, key, width: key === "key" ? 35 : key === "value" ? 80 : /Id$|^id$|^at$|At$/.test(key) ? 30 : 20 }));
    for (const row of rows) ws.addRow(keys.map((key) => row[key] ?? null));
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(ws.rowCount, 1), column: keys.length } };
    ws.eachRow((row, n) => {
      row.font = { name: "Calibri", size: 11, color: { argb: "FF2D4639" }, bold: n === 1 };
      row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: n === 1 ? "FFE1E1D1" : n % 2 ? "FFF5F5F0" : "FFEEEFE6" } };
      row.alignment = { vertical: "top", wrapText: true };
      row.eachCell((cell) => {
        if (typeof cell.value === "number") cell.numFmt = "0.########";
      });
    });
    ws.getRow(1).height = 30;
    return ws;
  }
  const overview = [];
  const add = (key, value) => overview.push({ key, value });
  add(zh ? "\u8BF4\u660E" : "Notes", zh ? "\u7A7A\u767D\u8868\u793A\u672A\u77E5\u3002\u603B token = \u8F93\u5165\uFF0B\u8F93\u51FA\uFF1B\u7F13\u5B58\u3001\u63A8\u7406\u548C\u5DE5\u5177\u6587\u672C\u4E0D\u91CD\u590D\u7D2F\u52A0\u3002\u53EA\u5BFC\u51FA\u9009\u4E2D\u7A97\u53E3\uFF0C\u4E0D\u5408\u5E76\u591A\u6B21\u89C2\u5BDF\u3002" : "Blank means unknown. Total = input + output. Cache, reasoning and tool estimates are not added again. One selected observation only.");
  add("schemaVersion", data.schemaVersion);
  for (const [key, value] of Object.entries(data.extension)) add(`extension.${key}`, value);
  add("exportedAt", data.exportedAt);
  for (const [key, value] of Object.entries(data.selection)) add(`selection.${key}`, value);
  const runtime = data.runtime;
  for (const key of ["state", "profile", "startedAt", "endedAt", "updatedAt", "durationMs", "run", "truncated"]) add(`runtime.${key}`, runtime[key]);
  for (const [key, value] of Object.entries(runtime.totals)) add(`totals.${key}`, value);
  for (const [key, value] of Object.entries(runtime.sources)) add(`sources.${key}`, value);
  for (const [key, value] of Object.entries(runtime.issues)) add(`issues.${key}`, value ?? null);
  for (const [key, value] of Object.entries(runtime.meterCoverage)) {
    add(`meterCoverage.${key}.known`, value.known);
    add(`meterCoverage.${key}.unknown`, value.unknown);
  }
  for (const [key, value] of Object.entries(data.limits)) add(`limits.${key}`, value);
  if (data.static) for (const key of ["profile", "estimatedAt", "directoryStatus", "measuredTokens", "completeCount", "partialCount", "unavailableCount"]) add(`static.${key}`, data.static[key]);
  else add("static", null);
  data.notes.forEach((note, i) => add(`note.${i + 1}`, note));
  sheet("\u6982\u89C8", "Overview", ["key", "value"], overview);
  const requestKeys = ["id", "run", "round", "responseId", "role", "model", "at", "startedAt", "durationMs", "outcome", "basis", "boundary", "input", "output", "cachedInput", "uncachedInput", "reasoning", "totalTokens"];
  sheet("\u6A21\u578B\u8BF7\u6C42", "Requests", requestKeys, runtime.requests.map((r) => Object.fromEntries(requestKeys.map((k) => [k, r[k]]))));
  const toolKeys = ["id", "run", "round", "responseId", "callId", "at", "startedAt", "tool", "owner", "role", "durationMs", "failed", "boundary", "textTokens", "textBasis", "imageCount", "imageTokens", "flashImageUpperBound"];
  sheet("\u5DE5\u5177\u660E\u7EC6", "Tools", toolKeys, runtime.tools.map((t) => Object.fromEntries(toolKeys.map((k) => [k, t[k]]))));
  const ids = new Set(runtime.tools.map((t) => t.id));
  sheet("\u8BF7\u6C42\u5DE5\u5177\u5173\u8054", "Request tool links", ["requestId", "toolId", "linked"], runtime.requests.flatMap((r) => r.tools.map((id) => ({ requestId: r.id, toolId: id, linked: ids.has(id) }))));
  sheet("World \u6C47\u603B", "World summary", ["owner", "calls", "perMinute", "durationMs", "failures", "textTokens", "measuredTexts", "unknownTexts", "imageCount"], runtime.groups);
  sheet(
    "\u9759\u6001\u6392\u884C",
    "Static ranking",
    ["name", "kind", "status", "toolCount", "toolTokens", "promptTokens", "totalTokens", "share", "issues"],
    data.static?.rows.map((r) => ({ ...r, issues: r.issues.join("; ") })) ?? []
  );
  return new Uint8Array(await workbook.xlsx.writeBuffer()).buffer;
}

// src/excel/worker.ts
if (!parentPort) throw new Error("E_XLSX_START");
var port = parentPort;
port.postMessage({ type: "started" });
try {
  const bytes = await xlsxBuffer(workerData.report, workerData.language);
  port.postMessage({ type: "result", bytes }, [bytes]);
} catch {
  port.postMessage({ type: "failed" });
} finally {
  port.close();
}
