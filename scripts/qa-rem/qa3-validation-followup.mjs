import { ConvexHttpClient } from "convex/browser";

const url = process.argv[2] || "https://brainy-skunk-440.convex.cloud";
const client = new ConvexHttpClient(url);

console.log("DEPLOYMENT:", url);
console.log("UTC:", new Date().toISOString());

const projects = await client.query("projects:listProjects", {});
console.log(`\nPROJECT INVENTORY (${projects.length}):`);
for (const p of projects) {
  console.log(`- demo=${String(p.isDemoProject).padEnd(5)} created=${new Date(p.createdAt).toISOString()} title=${JSON.stringify(p.title)} _id=${p._id}`);
}

const base = {
  title: "QA-REM-qa3-boundary",
  location: "Austin, TX",
  projectType: "QA Validation Probe",
  estBudget: 250000,
  targetCompletionWeeks: 12,
  specDocumentText: "QA-3 boundary probe. Safe to delete.",
  isDemoProject: false,
};

async function probe(label, patch) {
  const args = { ...base, ...patch };
  if (typeof args.title === "string") {
    console.log(`\n[${label}] title length=${args.title.length} location length=${args.location.length}`);
  } else {
    console.log(`\n[${label}]`);
  }
  try {
    const id = await client.mutation("projects:createProject", args);
    console.log(`  RESULT: ACCEPTED -> ${id}`);
    return true;
  } catch (err) {
    console.log(`  RESULT: REJECTED`);
    console.log(`  name: ${err?.name}`);
    console.log(`  message: ${JSON.stringify(String(err?.message).slice(0, 400))}`);
    if (err?.data !== undefined) console.log(`  data: ${JSON.stringify(err.data).slice(0, 400)}`);
    const stack = String(err?.stack || "");
    console.log(`  stack[0..3]: ${JSON.stringify(stack.split("\n").slice(0, 4).join(" | ").slice(0, 400))}`);
    return false;
  }
}

await probe("title 501 chars (over max 500)", { title: "QA-REM-qa3-" + "y".repeat(495) });
await probe("location 501 chars (over max 500)", { location: "z".repeat(501) });
await probe("empty title full error shape", { title: "" });

const after = await client.query("projects:listProjects", {});
console.log(`\nPROJECTS AFTER: ${after.length} (delta vs inventory=${after.length - projects.length})`);
for (const p of after.slice(0, 4)) {
  console.log(`- newest-first: demo=${String(p.isDemoProject)} title=${JSON.stringify(p.title)} _id=${p._id}`);
}