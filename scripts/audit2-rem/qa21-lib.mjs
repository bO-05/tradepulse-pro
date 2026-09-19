import { ConvexHttpClient } from "convex/browser";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const URL = "https://brainy-skunk-440.convex.cloud";
export const WEBSITE = "https://brainy-skunk-440.convex.site";
export const PREFIX = "AUDIT-QA21-";
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
  const file = path.join(EVIDENCE_DIR, `fix4-qa21-${name}.json`);
  fs.writeFileSync(file, JSON.stringify(obj, null, 2));
  console.log(`[evidence] ${file}`);
  return file;
}

export function readEvidence(name) {
  return JSON.parse(fs.readFileSync(path.join(EVIDENCE_DIR, `fix4-qa21-${name}.json`), "utf8"));
}

export function writeLog(name, lines) {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const file = path.join(EVIDENCE_DIR, `fix4-qa21-${name}.log`);
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

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function listProjects(c) {
  return (await c.query("projects:listProjects", {})) || [];
}

export async function findProjectByTitle(c, title) {
  return (await listProjects(c)).find((p) => p.title === title) || null;
}

/**
 * Purge ONLY AUDIT-QA21-* fixtures. Never touches demo/GC-AUDIT/AUDIT-5-* or any
 * other AUDIT-QA* project.
 */
export async function purgeQa21(c, say = console.log) {
  const projects = await listProjects(c);
  let purged = 0;
  for (const p of projects.filter((x) => String(x.title).startsWith(PREFIX))) {
    const agrs = (await c.query("agreements:listAgreements", { projectId: p._id })) || [];
    for (const a of agrs.filter((x) => x.status === "executed")) {
      try {
        await c.mutation("agreements:voidExecutedAgreement", {
          agreementId: a._id,
          reason: "QA21 fixture teardown: void recorded execution before deleting the fixture.",
        });
      } catch (err) {
        say(`purge void ${a.agreementNumber} failed: ${err?.data ?? err?.message}`);
      }
    }
    try {
      await c.mutation("projects:deleteProject", { projectId: p._id });
      purged += 1;
      say(`purged ${p.title} (${p._id})`);
    } catch (err) {
      say(`purge ${p.title} FAILED: ${err?.data ?? err?.message}`);
    }
    await sleep(150);
  }
  return purged;
}

export async function projectSnapshot(c, projectId) {
  const [project, packages, agreements, bids, contractors, logs] = await Promise.all([
    c.query("projects:getProject", { projectId }),
    c.query("tradePackages:listByProject", { projectId }),
    c.query("agreements:listAgreements", { projectId }),
    c.query("bids:listAllProjectBids", { projectId }),
    c.query("contractors:listByProject", { projectId }).catch(() => null),
    c.query("auditLogs:listRecentLogs", { projectId, limit: 400 }),
  ]);
  return {
    project,
    packages: packages || [],
    agreements: agreements || [],
    bids: bids || [],
    contractors: contractors || [],
    logs: logs || [],
  };
}

export function utcDate(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

export function plusDays(n) {
  const d = new Date(Date.now() + n * 86400000);
  return d.toISOString().slice(0, 10);
}