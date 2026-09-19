import { ConvexHttpClient } from "convex/browser";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const URL = "https://brainy-skunk-440.convex.cloud";
export const WEBSITE = "https://brainy-skunk-440.convex.site";
export const PREFIX = "AUDIT-QA11-";
export const EVIDENCE_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "evidence"
);

export function client() {
  const raw = new ConvexHttpClient(URL);
  return {
    raw,
    query: (name, args) => withRetry(() => raw.query(name, args), 3),
    mutation: (name, args) => withRetry(() => raw.mutation(name, args), 2),
    action: (name, args) => withRetry(() => raw.action(name, args), 2),
  };
}

export async function withRetry(fn, attempts = 3) {
  let last;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      const msg = String(err?.message ?? err);
      const transient = /fetch failed|ECONNRESET|socket hang up|network|ETIMEDOUT|EAI_AGAIN|timeout/i.test(msg);
      if (!transient) throw err;
      await new Promise((r) => setTimeout(r, 700 * (i + 1)));
    }
  }
  throw last;
}

export function fixtureTitle(purpose) {
  return `${PREFIX}${purpose}`;
}

export function writeEvidence(name, obj) {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const file = path.join(EVIDENCE_DIR, `fix4-qa11-${name}.json`);
  fs.writeFileSync(file, JSON.stringify(obj, null, 2));
  console.log(`[evidence] ${file}`);
  return file;
}

export function readEvidence(name) {
  return JSON.parse(fs.readFileSync(path.join(EVIDENCE_DIR, `fix4-qa11-${name}.json`), "utf8"));
}

export function hasEvidence(name) {
  return fs.existsSync(path.join(EVIDENCE_DIR, `fix4-qa11-${name}.json`));
}

export function writeLog(name, lines) {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const file = path.join(EVIDENCE_DIR, `fix4-qa11-${name}.log`);
  fs.writeFileSync(file, lines.join("\n") + "\n");
  console.log(`[log] ${file}`);
  return file;
}

export async function call(label, fn) {
  try {
    const value = await fn();
    console.log(`  PASS  ${label}`);
    return { label, ok: true, value };
  } catch (err) {
    const data = err && typeof err === "object" && "data" in err ? err.data : null;
    const entry = {
      label,
      ok: false,
      data: typeof data === "string" ? data : data == null ? null : JSON.stringify(data),
      message: err?.message ?? String(err),
      name: err?.name ?? null,
    };
    console.log(`  FAIL  ${label} :: ${String(entry.data ?? entry.message).split("\n")[0]}`);
    return entry;
  }
}

export function expectReject(entry, pattern, label) {
  const text = `${entry.data ?? ""} ${entry.message ?? ""}`;
  const matched = !entry.ok && (!pattern || pattern.test(text));
  return {
    label: label || entry.label,
    expected: pattern ? `rejected matching ${pattern}` : "rejected",
    observed: entry.ok ? "SUCCEEDED (unexpected)" : String(entry.data ?? entry.message).split("\n")[0],
    ok: matched,
  };
}

export function expectOk(entry, label) {
  return {
    label: label || entry.label,
    expected: "succeeds",
    observed: entry.ok ? "succeeded" : String(entry.data ?? entry.message).split("\n")[0],
    ok: entry.ok,
  };
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function listProjects(c) {
  return (await c.query("projects:listProjects", {})) || [];
}

export async function findProjectByTitle(c, title) {
  return (await listProjects(c)).find((p) => p.title === title) || null;
}

export async function projectSnapshot(c, projectId) {
  const [project, packages, agreements, bids, contractors, files, logs] = await Promise.all([
    c.query("projects:getProject", { projectId }),
    c.query("tradePackages:listByProject", { projectId }),
    c.query("agreements:listAgreements", { projectId }),
    c.query("bids:listAllProjectBids", { projectId }),
    c.query("contractors:listByProject", { projectId }),
    c.query("files:listFilesByProject", { projectId }),
    c.query("auditLogs:listRecentLogs", { projectId, limit: 500 }),
  ]);
  return {
    project,
    packages: packages || [],
    agreements: agreements || [],
    bids: bids || [],
    contractors: contractors || [],
    files: files || [],
    logs: logs || [],
  };
}

export function snapDigest(snap) {
  return {
    projectFound: Boolean(snap.project),
    packageIds: snap.packages.map((p) => p._id).sort(),
    agreementIds: snap.agreements.map((a) => `${a._id}:${a.status}`).sort(),
    bidIds: snap.bids.map((b) => `${b._id}:${b.isAwarded}:${b.leveledTotalCost}`).sort(),
    contractorIds: snap.contractors.map((c) => c._id).sort(),
    fileIds: snap.files.map((f) => f._id).sort(),
    logCount: snap.logs.length,
  };
}