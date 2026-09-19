import { ConvexHttpClient } from "convex/browser";

const R = { startedAt: new Date().toISOString() };
const http = new ConvexHttpClient("https://brainy-skunk-440.convex.cloud");

const run = async () => {
  try {
    const before = await http.query("projects:listProjects", {});
    R.before = [];
    for (const p of before) {
      const pkgs = await http.query("tradePackages:listByProject", { projectId: p._id });
      const bids = await http.query("bids:listAllProjectBids", { projectId: p._id });
      const agreements = await http.query("agreements:listAgreements", { projectId: p._id });
      R.before.push({ id: p._id, title: p.title, demo: p.isDemoProject, packages: pkgs.length, bids: bids.length, agreements: agreements.length });
    }
    const toDelete = before.filter((p) => !p.isDemoProject);
    R.deleted = [];
    for (const p of toDelete) {
      try {
        const res = await http.mutation("projects:deleteProject", { projectId: p._id });
        R.deleted.push({ title: p.title, res });
      } catch (e) {
        R.deleted.push({ title: p.title, error: String(e && e.message ? e.message : e).slice(0, 200) });
      }
    }
    const after = await http.query("projects:listProjects", {});
    R.after = after.map((p) => ({ title: p.title, demo: p.isDemoProject }));
    R.onlyDemo = after.length === 1 && after[0].isDemoProject === true;
  } catch (e) {
    R.error = String(e && e.stack ? e.stack : e).slice(0, 400);
  }
  console.log(JSON.stringify(R, null, 2).slice(0, 6000));
};
run();