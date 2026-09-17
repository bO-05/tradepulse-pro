import { ConvexHttpClient } from "convex/browser";

const url = process.argv[2] || "https://brainy-skunk-440.convex.cloud";
const client = new ConvexHttpClient(url);

const FINITE_CASES = [
  ["empty title", { title: "" }],
  ["whitespace title", { title: "   \t   " }],
  ["500-char title (boundary ok)", { title: "QA-REM-qa3-500-" + "x".repeat(484) }],
  ["501-char title (over)", { title: "QA-REM-qa3-501-" + "x".repeat(485) }],
  ["budget 0", { estBudget: 0 }],
  ["budget -5", { estBudget: -5 }],
  ["budget 1e12", { estBudget: 1e12 }],
  ["weeks 0", { targetCompletionWeeks: 0 }],
  ["weeks 99999", { targetCompletionWeeks: 99999 }],
  ["weeks 520.5 non-integer", { targetCompletionWeeks: 520.5 }],
  ["weeks 520 (boundary ok)", { targetCompletionWeeks: 520 }],
  ["location whitespace", { location: "   " }],
];

const base = {
  title: "QA-REM-qa3-validation",
  location: "Austin, TX",
  projectType: "QA Validation Probe",
  estBudget: 250000,
  targetCompletionWeeks: 12,
  specDocumentText: "QA-3 adversarial validation probe. Safe to delete.",
  isDemoProject: false,
};

console.log("DEPLOYMENT:", url);
console.log("UTC:", new Date().toISOString());

const before = await client.query("projects:listProjects", {});
console.log(`PROJECTS BEFORE: ${before.length}`);

const outcomes = [];
for (const [name, patch] of FINITE_CASES) {
  const args = { ...base, ...patch };
  const label = `case="${name}"`;
  try {
    const id = await client.mutation("projects:createProject", args);
    outcomes.push({ name, result: "ACCEPTED", detail: String(id) });
    console.log(`ACCEPTED : ${label} -> ${id}  (WRITE: title=${JSON.stringify(args.title)} budget=${args.estBudget} weeks=${args.targetCompletionWeeks})`);
  } catch (err) {
    const msg = String(err?.message || err).replace(/\s+/g, " ").slice(0, 300);
    outcomes.push({ name, result: "REJECTED", detail: msg });
    console.log(`REJECTED : ${label} -> ${msg}`);
  }
}

// NaN serializes to null over JSON; send raw HTTP-shaped object via fetch-less client arg
try {
  const id = await client.mutation("projects:createProject", { ...base, title: "QA-REM-qa3-nan-budget", estBudget: Number.NaN });
  console.log(`ACCEPTED : case="NaN budget" -> ${id}`);
  outcomes.push({ name: "NaN budget", result: "ACCEPTED", detail: String(id) });
} catch (err) {
  const msg = String(err?.message || err).replace(/\s+/g, " ").slice(0, 300);
  console.log(`REJECTED : case="NaN budget" -> ${msg}`);
  outcomes.push({ name: "NaN budget", result: "REJECTED", detail: msg });
}

const after = await client.query("projects:listProjects", {});
console.log(`PROJECTS AFTER: ${after.length} (delta=${after.length - before.length})`);
const createdByProbe = after.filter((p) => !before.some((b) => b._id === p._id));
for (const p of createdByProbe) {
  console.log(`NEW PROJECT WRITTEN BY PROBE: title=${JSON.stringify(p.title)} _id=${p._id}`);
}
const accepted = outcomes.filter((o) => o.result === "ACCEPTED");
console.log(`\nSUMMARY: ${outcomes.length - accepted.length}/${outcomes.length} adversarial cases rejected server-side; ${accepted.length} accepted`);
process.exitCode = 0;