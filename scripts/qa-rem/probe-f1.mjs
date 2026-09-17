import { ConvexHttpClient } from "convex/browser";

const url = process.argv[2] || "https://brainy-skunk-440.convex.cloud";
const client = new ConvexHttpClient(url);

const title = `QA-REM-F1-probe-${new Date().toISOString().slice(0, 10)}`;
const created = await client.mutation("projects:createProject", {
  title,
  location: "Austin, TX",
  projectType: "QA Probe",
  estBudget: 100000,
  targetCompletionWeeks: 10,
  specDocumentText: "QA probe for project persistence root cause.",
  isDemoProject: false,
});
console.log("DEPLOYMENT:", url);
console.log("CREATED:", created);
const list = await client.query("projects:listProjects", {});
console.log("COUNT:", list.length);
for (const p of list) {
  console.log(`- ${p.title} | demo=${p.isDemoProject} | _id=${p._id}`);
}
const found = list.some((p) => p.title === title);
console.log("PERSISTED:", found ? "YES" : "NO");