import { ConvexHttpClient } from "convex/browser";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export const URL =
  process.env.QA7_CONVEX_URL || "https://brainy-skunk-440.convex.cloud";
export const WEBSITE = "https://brainy-skunk-440.convex.site";
export const EVIDENCE_DIR = path.resolve("evidence");
export const FIXTURE_DATE = "2026-09-18";

export function client() {
  const raw = new ConvexHttpClient(URL);
  return {
    raw,
    query: (name, args) => withRetry(() => raw.query(name, args), 3),
    // Mutations get a single network retry; cleanup sweeps by title prefix absorb
    // any rare duplicate created by a lost response.
    mutation: (name, args) => withRetry(() => raw.mutation(name, args), 2),
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
      const transient = /fetch failed|ECONNRESET|socket hang up|network|ETIMEDOUT|EAI_AGAIN/i.test(msg);
      if (!transient) throw err;
      await new Promise((r) => setTimeout(r, 600 * (i + 1)));
    }
  }
  throw last;
}

export function fixtureName(purpose) {
  return `AUDIT-QA7-${purpose}-${FIXTURE_DATE}`;
}

export function writeEvidence(name, obj) {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const file = path.join(EVIDENCE_DIR, `fix4-qa7-${name}.json`);
  fs.writeFileSync(file, JSON.stringify(obj, null, 2));
  console.log(`[evidence] ${file}`);
  return file;
}

export function writeLog(name, lines) {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const file = path.join(EVIDENCE_DIR, `fix4-qa7-${name}.log`);
  fs.writeFileSync(file, lines.join("\n"));
  console.log(`[log] ${file}`);
  return file;
}

/**
 * Runs a Convex call, capturing either the value or a structured failure.
 * ConvexError data (the human-readable guard message) is preserved.
 */
export async function call(label, fn) {
  try {
    const value = await fn();
    const entry = { label, ok: true, value };
    console.log(`  PASS  ${label}`);
    return entry;
  } catch (err) {
    const data = err && typeof err === "object" && "data" in err ? err.data : null;
    const entry = {
      label,
      ok: false,
      data: typeof data === "string" ? data : data == null ? null : JSON.stringify(data),
      message: err?.message ?? String(err),
      name: err?.name ?? null,
    };
    console.log(`  FAIL  ${label} :: ${entry.data ?? entry.message.split("\n")[0]}`);
    return entry;
  }
}

export function expectOk(entry, label) {
  return { label, expected: "success", observed: entry.ok ? "success" : entry.data ?? entry.message, ok: entry.ok };
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

/** Read-only table dump through the Convex CLI, pinned to the PROD deployment. */
export function cliDump(table, limit = 5000) {
  const args = ["convex", "data", table, "--prod", "--limit", String(limit), "--format", "jsonArray"];
  try {
    const out = execFileSync("npx", args, {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      shell: process.platform === "win32",
    });
    const trimmed = out.trim();
    if (!trimmed) return [];
    const parsed = JSON.parse(trimmed);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch (err) {
    const stdout = err?.stdout ? String(err.stdout).trim() : "";
    if (stdout) {
      try {
        const parsed = JSON.parse(stdout);
        return Array.isArray(parsed) ? parsed : [parsed];
      } catch {
        /* fall through */
      }
    }
    throw new Error(`cliDump(${table}) failed: ${err?.message ?? err}`);
  }
}

/** Deletes a fixture project (and cascades) via the public API; returns outcome. */
export async function deleteFixtureProject(c, projectId, note) {
  const res = await call(`deleteProject ${note ?? projectId}`, () =>
    c.mutation("projects:deleteProject", { projectId })
  );
  return res;
}

export function isQa7Title(title) {
  return typeof title === "string" && /^AUDIT-QA7-/.test(title);
}