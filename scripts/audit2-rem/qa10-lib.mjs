import { ConvexHttpClient } from "convex/browser";
import fs from "node:fs";
import path from "node:path";

export const URL =
  process.env.QA10_CONVEX_URL || "https://brainy-skunk-440.convex.cloud";
export const WEBSITE = "https://brainy-skunk-440.convex.site";
export const EVIDENCE_DIR = path.resolve("evidence");
export const FIXTURE_DATE = "2026-09-19";
export const PREFIX = "AUDIT-QA10-";

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
      await new Promise((r) => setTimeout(r, 600 * (i + 1)));
    }
  }
  throw last;
}

export function fixtureName(purpose) {
  return `${PREFIX}${purpose}-${FIXTURE_DATE}`;
}

export function isQa10Title(title) {
  return typeof title === "string" && title.startsWith(PREFIX);
}

export function writeEvidence(name, obj) {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const file = path.join(EVIDENCE_DIR, `fix4-qa10-${name}.json`);
  fs.writeFileSync(file, JSON.stringify(obj, null, 2));
  console.log(`[evidence] ${file}`);
  return file;
}

export function writeLog(name, lines) {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const file = path.join(EVIDENCE_DIR, `fix4-qa10-${name}.log`);
  fs.writeFileSync(file, lines.join("\n") + "\n");
  console.log(`[log] ${file}`);
  return file;
}

export function readEvidence(name) {
  const file = path.join(EVIDENCE_DIR, `fix4-qa10-${name}.json`);
  return JSON.parse(fs.readFileSync(file, "utf8"));
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
    console.log(`  FAIL  ${label} :: ${(entry.data ?? entry.message).toString().split("\n")[0]}`);
    return entry;
  }
}

export function expectReject(entry, pattern, label) {
  const text = `${entry.data ?? ""} ${entry.message ?? ""}`;
  const matched = !entry.ok && (!pattern || pattern.test(text));
  return {
    label,
    expected: pattern ? `rejected matching ${pattern}` : "rejected",
    observed: entry.ok ? "SUCCEEDED (unexpected)" : entry.data ?? entry.message.split("\n")[0],
    ok: matched,
  };
}

export function expectOk(entry, label) {
  return {
    label,
    expected: "rejection",
    observed: entry.ok ? "SUCCEEDED (unexpected)" : entry.data ?? entry.message.split("\n")[0],
    ok: entry.ok,
  };
}

/** valid-format but nonexistent Convex id: flip a character in the hex-like suffix */
export function corruptId(id, position = 24) {
  const chars = "0123456789abcdefghijklmnopqrstuvwxyz";
  const idx = Math.min(position, id.length - 1);
  const cur = id[idx];
  const next = chars[(chars.indexOf(cur) + 7) % chars.length];
  return id.slice(0, idx) + next + id.slice(idx + 1);
}

export async function listQa10Projects(c) {
  const projects = await c.query("projects:listProjects", {});
  return (projects || []).filter((p) => isQa10Title(p.title));
}

export async function fullFixtureState(c, projectId) {
  const [project, packages, files, recentLogs, agreements] = await Promise.all([
    c.query("projects:getProject", { projectId }),
    c.query("tradePackages:listByProject", { projectId }),
    c.query("files:listFilesByProject", { projectId }),
    c.query("auditLogs:listRecentLogs", { projectId, limit: 500 }),
    c.query("agreements:listAgreements", { projectId }),
  ]);
  const logs = recentLogs || [];
  const contractors = await c.query("contractors:listByProject", { projectId });
  const bids = await c.query("bids:listAllProjectBids", { projectId });
  let conversations = [];
  for (const pkg of packages || []) {
    const list = await c.query("rfq:listConversations", { tradePackageId: pkg._id });
    conversations = conversations.concat(list || []);
  }
  let clashResolutions = [];
  try {
    clashResolutions = await c.raw.query("coordination:detectCrossTradeClashes", { projectId });
  } catch {
    clashResolutions = null;
  }
  return { project, packages, contractors, bids, conversations, files, logs, agreements, clashes: clashResolutions };
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}