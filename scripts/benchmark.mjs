import { pathToFileURL } from "node:url";

export function median(values) {
  if (!values.length) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function parseArgs(argv) {
  const result = {
    baseUrl: "http://127.0.0.1:4000",
    presets: ["custom", "draft", "standard"],
    runs: 2,
    timeoutMs: 2 * 60 * 60 * 1000,
    run: false,
    label: "",
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      const value = argv[++i];
      if (!value) throw new Error(`${arg} needs a value`);
      return value;
    };
    if (arg === "--source") result.source = next();
    else if (arg === "--base-url") result.baseUrl = next().replace(/\/$/, "");
    else if (arg === "--presets") result.presets = next().split(",").map((v) => v.trim()).filter(Boolean);
    else if (arg === "--runs") result.runs = Number(next());
    else if (arg === "--timeout-minutes") result.timeoutMs = Number(next()) * 60_000;
    else if (arg === "--label") result.label = next();
    else if (arg === "--run") result.run = true;
    else if (arg === "--help" || arg === "-h") result.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  const valid = new Set(["custom", "draft", "standard", "final"]);
  if (result.presets.some((preset) => !valid.has(preset))) throw new Error("Presets must be custom, draft, standard, or final");
  if (!Number.isInteger(result.runs) || result.runs < 1 || result.runs > 20) throw new Error("--runs must be 1-20");
  if (!Number.isFinite(result.timeoutMs) || result.timeoutMs < 60_000) throw new Error("--timeout-minutes must be at least 1");
  return result;
}

export function summarize(records) {
  const byPreset = new Map();
  for (const item of records) {
    const bucket = byPreset.get(item.preset) ?? [];
    bucket.push(item.record);
    byPreset.set(item.preset, bucket);
  }
  return [...byPreset].map(([preset, rows]) => ({
    preset,
    runs: rows.length,
    totalMs: median(rows.map((row) => row.performance?.totalMs).filter(Number.isFinite)),
    executionMs: median(rows.map((row) => row.performance?.executionMs).filter(Number.isFinite)),
    queueMs: median(rows.map((row) => row.performance?.queueMs).filter(Number.isFinite)),
    outputMs: median(rows.map((row) => row.performance?.outputMs).filter(Number.isFinite)),
  }));
}

async function request(baseUrl, path, init) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!response.ok) throw new Error(`${init?.method ?? "GET"} ${path}: ${response.status} ${await response.text()}`);
  return response.json();
}

async function waitForGeneration(baseUrl, id, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const record = await request(baseUrl, `/api/generations/${encodeURIComponent(id)}`);
    if (["completed", "failed", "canceled"].includes(record.status)) return record;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error(`Timed out waiting for ${id}`);
}

function fmt(ms) {
  if (!Number.isFinite(ms)) return "n/a";
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function printHelp() {
  console.log(`Latent fixed-seed benchmark

Dry-run plan (does not use the GPU):
  npm run benchmark -- --source <generation-id>

Execute alternating A/B runs:
  npm run benchmark -- --source <generation-id> --presets custom,draft,standard --runs 2 --run

Options: --label <name> --base-url <url> --timeout-minutes <n>
The source may be an original, upscale, or enhanced image; Latent follows its reuse lineage.`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) return printHelp();
  if (!options.source) throw new Error("--source <generation-id> is required");

  const source = await request(options.baseUrl, `/api/generations/${encodeURIComponent(options.source)}`);
  const reuse = await request(options.baseUrl, `/api/generations/${encodeURIComponent(options.source)}/reuse-settings`);
  const plan = [];
  for (let round = 1; round <= options.runs; round++) {
    for (const preset of options.presets) plan.push({ preset, round });
  }
  console.log(`Pipeline: ${source.pipelineName} (${reuse.pipelineId})`);
  console.log(`Plan: ${plan.map((item) => `${item.preset}#${item.round}`).join(" → ")}`);
  if (options.label) console.log(`Label: ${options.label}`);
  if (!options.run) {
    console.log("Dry run only. Add --run to queue these GPU jobs sequentially.");
    return;
  }

  const completed = [];
  for (const item of plan) {
    console.log(`\nQueuing ${item.preset} run ${item.round}/${options.runs}…`);
    const response = await request(options.baseUrl, "/api/generate", {
      method: "POST",
      body: JSON.stringify({
        pipelineId: reuse.pipelineId,
        values: reuse.params,
        seedMode: "fixed",
        batch: 1,
        qualityPreset: item.preset === "custom" ? undefined : item.preset,
      }),
    });
    const id = response.generationIds?.[0];
    if (!id) throw new Error("Latent did not return a generation id");
    const record = await waitForGeneration(options.baseUrl, id, options.timeoutMs);
    if (record.status !== "completed") throw new Error(`${id} ended as ${record.status}: ${record.error ?? "unknown error"}`);
    if (!record.performance) throw new Error(`${id} has no telemetry; restart Latent on this build before benchmarking`);
    await request(options.baseUrl, `/api/generations/${encodeURIComponent(id)}/tags`, {
      method: "POST",
      body: JSON.stringify({ name: options.label ? `benchmark:${options.label}` : "benchmark" }),
    });
    completed.push({ ...item, record });
    console.log(`${id}: total ${fmt(record.performance.totalMs)}, execution ${fmt(record.performance.executionMs)}, output ${fmt(record.performance.outputMs)}`);
  }

  console.log("\nMedian results");
  console.table(summarize(completed).map((row) => ({
    preset: row.preset,
    runs: row.runs,
    total: fmt(row.totalMs),
    execution: fmt(row.executionMs),
    queue: fmt(row.queueMs),
    output: fmt(row.outputMs),
  })));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`Benchmark failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
