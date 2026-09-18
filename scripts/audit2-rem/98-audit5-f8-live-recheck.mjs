import { setTimeout as delay } from "node:timers/promises";
import { writeJson } from "./lib.mjs";
import { ConvexHttpClient } from "convex/browser";

const R = { startedAt: new Date().toISOString() };
const http = new ConvexHttpClient("https://brainy-skunk-440.convex.cloud");
const FIXTURE = "AUDIT-5-F3-BEFORE-2026-09-18";

const run = async () => {
  try {
    const fixtureProject = (await http.query("projects:listProjects", {})).find((p) => p.title.includes(FIXTURE));
    const pkgs = await http.query("tradePackages:listByProject", { projectId: fixtureProject._id });
    const div26 = pkgs.find((p) => p.csiDivision.startsWith("26"));
    const before = await http.query("contractors:listByPackage", { tradePackageId: div26._id });
    const discovery = await http.action("contractorDiscovery:discoverSubcontractors", { tradePackageId: div26._id });
    await delay(4000);
    const after = await http.query("contractors:listByPackage", { tradePackageId: div26._id });
    const JUNK = [
      /\b(?:hotline|near me|on instagram|on facebook)\b/i,
      /^(?:get|find|hire|call|need|looking for)\b/i,
      /\bin\s+[A-Z][a-zA-Z]+$/,
    ];
    R.before = before.map((c) => c.companyName);
    R.discovery = { success: discovery?.success, insertedCount: discovery?.insertedCount, source: discovery?.source };
    R.after = after.map((c) => c.companyName);
    R.junkStillStored = R.after.filter((n) => JUNK.some((rx) => rx.test(n)));
    writeJson("fix4-after-f8-live.json", R);
  } catch (e) {
    R.error = String(e && e.stack ? e.stack : e).slice(0, 400);
    writeJson("fix4-after-f8-live.json", R);
  }
  console.log(JSON.stringify(R, null, 2).slice(0, 6000));
};
run();