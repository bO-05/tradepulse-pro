import { ConvexHttpClient } from "convex/browser";

const url = process.argv[2] || "https://brainy-skunk-440.convex.cloud";
const client = new ConvexHttpClient(url);

const projects = await client.query("projects:listProjects", {});
const mine = projects.filter((p) => p.title.startsWith("QA-REM-QA9-"));
console.log(`total projects: ${projects.length}; QA-REM-QA9-* candidates: ${mine.length}`);
for (const p of mine) console.log(`  candidate: ${p.title} (${p._id})`);

let deleted = 0;
for (const p of mine) {
  if (p.isDemoProject) {
    console.log(`SKIP demo-flagged: ${p.title}`);
    continue;
  }
  try {
    await client.mutation("projects:deleteProject", { projectId: p._id });
    deleted += 1;
    console.log(`deleted: ${p.title}`);
  } catch (err) {
    console.log(`FAILED to delete ${p.title}: ${err?.data ? JSON.stringify(err.data) : err?.message}`);
  }
}

const after = await client.query("projects:listProjects", {});
console.log(`\ndeleted ${deleted}/${mine.length}; remaining projects: ${after.length}`);
for (const p of after) console.log(`- ${p.title} (demo=${p.isDemoProject})`);
process.exitCode = deleted === mine.length ? 0 : 1;