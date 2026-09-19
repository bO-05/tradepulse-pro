import { ConvexHttpClient } from "convex/browser";

const R = { startedAt: new Date().toISOString() };
const http = new ConvexHttpClient("https://brainy-skunk-440.convex.cloud");

const run = async () => {
  try {
    const projects = await http.query("projects:listProjects", {});
    const leftover = projects.filter((p) => /^AUDIT-QA11-EXEC/.test(p.title) || p.title === "AUDIT-QA11-EXEC");
    R.found = leftover.map((p) => ({ id: p._id, title: p.title }));
    for (const project of leftover) {
      const pkgs = await http.query("tradePackages:listByProject", { projectId: project._id });
      for (const pkg of pkgs) {
        const agreements = await http.query("agreements:listAgreements", { projectId: project._id });
        for (const agr of agreements.filter((a) => a.tradePackageId === pkg._id && a.status === "executed")) {
          const res = await http.mutation("agreements:voidExecutedAgreement", {
            agreementId: agr._id,
            reason: "QA fixture cleanup after the round-3 immutability test; external amendment not applicable.",
          });
          R.voided = R.voided || [];
          R.voided.push({ agreement: agr.agreementNumber, res });
        }
      }
      const del = await http.mutation("projects:deleteProject", { projectId: project._id });
      R.deleted = R.deleted || [];
      R.deleted.push({ title: project.title, del });
    }
    const after = await http.query("projects:listProjects", {});
    R.remaining = after.map((p) => p.title);
    R.onlyExpected = after.every((p) => p.isDemoProject || /^(GC-AUDIT|AUDIT-5|AUDIT-QA)/.test(p.title));
  } catch (e) {
    R.error = String(e && e.stack ? e.stack : e).slice(0, 500);
  }
  console.log(JSON.stringify(R, null, 2).slice(0, 6000));
};
run();