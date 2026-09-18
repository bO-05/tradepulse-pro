/**
 * QA9 cleanup: delete every AUDIT-QA9-* fixture project and verify removal.
 * Evidence: evidence/fix4-qa9-99-cleanup.json
 */
import { client, writeEvidence, delay } from "./qa9-lib.mjs";

const c = client();
const before = await c.query("projects:listProjects", {});
const targets = before.filter((p) => p.title.includes("AUDIT-QA9-"));
const results = [];
for (const p of targets) {
  try {
    await c.mutation("projects:deleteProject", { projectId: p._id });
    results.push({ title: p.title, deleted: true });
  } catch (e) {
    results.push({ title: p.title, deleted: false, error: String(e?.data ?? e?.message ?? e).slice(0, 160) });
  }
  await delay(300);
}
const after = await c.query("projects:listProjects", {});
const leftovers = after.filter((p) => p.title.includes("AUDIT-QA9-"));
writeEvidence("99-cleanup", { deleted: results, leftovers: leftovers.map((p) => p.title), projectCount: after.length });
console.log(`deleted ${results.filter((r) => r.deleted).length}/${targets.length}; leftovers=${leftovers.length}`);