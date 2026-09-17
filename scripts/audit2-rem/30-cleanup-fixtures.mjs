import { ConvexHttpClient } from "convex/browser";

const targets = [
  { label: "dev", url: "https://brilliant-ferret-962.convex.cloud" },
  { label: "prod", url: "https://brainy-skunk-440.convex.cloud" },
];

const main = async () => {
  for (const target of targets) {
    const c = new ConvexHttpClient(target.url);
    const projects = await c.query("projects:listProjects", {});
    console.log(`[${target.label}] projects:`, projects.map((p) => p.title).join(" | ") || "(none)");
    for (const project of projects) {
      if (!project.title.startsWith("AUDIT-")) continue;
      try {
        await c.mutation("projects:deleteProject", { projectId: project._id });
        console.log(`[${target.label}] deleted fixture: ${project.title}`);
      } catch (e) {
        console.log(`[${target.label}] FAILED to delete ${project.title}: ${e.message}`);
      }
    }
    const after = await c.query("projects:listProjects", {});
    console.log(`[${target.label}] remaining:`, after.map((p) => p.title).join(" | ") || "(none)");
  }
};

main().catch((e) => { console.error("ERR", e.message); process.exit(1); });