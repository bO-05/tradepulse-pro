import { ConvexHttpClient } from "convex/browser";

const url = process.argv[2] || "https://brainy-skunk-440.convex.cloud";
const client = new ConvexHttpClient(url);

const projects = await client.query("projects:listProjects", {});
const junk = projects.filter(
  (p) =>
    !p.isDemoProject &&
    (p.title.startsWith("QA-REM") ||
      p.title === "QA Test Tower - Temporary Audit" ||
      p.title.startsWith("Pass2 GC E2E") ||
      p.title.startsWith("Production Audit Temporary"))
);
console.log(`total projects: ${projects.length}; cleanup candidates: ${junk.length}`);
let deleted = 0;
for (const p of junk) {
  try {
    await client.mutation("projects:deleteProject", { projectId: p._id });
    deleted += 1;
    console.log(`deleted: ${p.title}`);
  } catch (err) {
    console.log(`FAILED to delete ${p.title}: ${err?.data ? JSON.stringify(err.data) : err?.message}`);
  }
}
const after = await client.query("projects:listProjects", {});
console.log(`\ndeleted ${deleted}/${junk.length}; remaining projects: ${after.length}`);
for (const p of after) console.log(`- ${p.title} (demo=${p.isDemoProject})`);
process.exitCode = deleted === junk.length ? 0 : 1;