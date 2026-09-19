import { ConvexHttpClient } from "convex/browser";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const URL = "https://brainy-skunk-440.convex.cloud";
export const WEBSITE = "https://brainy-skunk-440.convex.site";
export const PREFIX = "AUDIT-QA13-";
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
  const file = path.join(EVIDENCE_DIR, `fix4-qa13-${name}.json`);
  fs.writeFileSync(file, JSON.stringify(obj, null, 2));
  console.log(`[evidence] ${file}`);
  return file;
}

export function readEvidence(name) {
  return JSON.parse(fs.readFileSync(path.join(EVIDENCE_DIR, `fix4-qa13-${name}.json`), "utf8"));
}

export function writeLog(name, lines) {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const file = path.join(EVIDENCE_DIR, `fix4-qa13-${name}.log`);
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

export async function deleteProjectHard(c, projectId) {
  const agreements = (await c.query("agreements:listAgreements", { projectId })) || [];
  for (const a of agreements) {
    if (a.status === "executed") {
      try {
        await c.mutation("agreements:voidExecutedAgreement", {
          agreementId: a._id,
          reason: "QA13 cleanup: void recorded execution before fixture teardown.",
        });
      } catch (err) {
        console.log(`  void during cleanup failed for ${a._id}: ${err?.data ?? err?.message ?? err}`);
      }
    }
  }
  try {
    await c.mutation("projects:deleteProject", { projectId });
    return { deleted: true };
  } catch (err) {
    return { deleted: false, error: String(err?.data ?? err?.message ?? err) };
  }
}