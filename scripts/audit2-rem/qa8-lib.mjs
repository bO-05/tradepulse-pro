import { ConvexHttpClient } from "convex/browser";
import fs from "node:fs";
import path from "node:path";

export const URL = process.env.QA8_CONVEX_URL || "https://brainy-skunk-440.convex.cloud";
export const WEBSITE = "https://brainy-skunk-440.convex.site";
export const EVIDENCE_DIR = path.resolve("evidence");
export const FIXTURE_DATE = "2026-09-18";

export function client() {
  const raw = new ConvexHttpClient(URL);
  return {
    raw,
    query: (name, args) => raw.query(name, args),
    mutation: (name, args) => raw.mutation(name, args),
    action: (name, args) => raw.action(name, args),
  };
}

export function fixtureName(purpose) {
  return `AUDIT-QA8-${purpose}-${FIXTURE_DATE}`;
}

export function writeEvidence(name, obj) {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const file = path.join(EVIDENCE_DIR, `fix4-qa8-${name}.json`);
  fs.writeFileSync(file, JSON.stringify(obj, null, 2));
  console.log(`[evidence] ${file}`);
  return file;
}

export function writeLog(name, lines) {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const file = path.join(EVIDENCE_DIR, `fix4-qa8-${name}.log`);
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

export function isQa8Title(title) {
  return typeof title === "string" && /^AUDIT-QA8-/.test(title);
}