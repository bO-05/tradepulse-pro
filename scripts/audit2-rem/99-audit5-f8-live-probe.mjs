import { setTimeout as delay } from "node:timers/promises";
import { writeJson } from "./lib.mjs";
import { ConvexHttpClient } from "convex/browser";

const R = { startedAt: new Date().toISOString() };
const http = new ConvexHttpClient("https://brainy-skunk-440.convex.cloud");
const FIXTURE = "AUDIT-5-F3-BEFORE-2026-09-18";

const run = async () => {
  try {
    const fixtureProject = (await http.query("projects:listProjects", {})).find((p) => p.title.includes(FIXTURE));
    const pkgId = await http.mutation("tradePackages:createTradePackage", {
      projectId: fixtureProject._id,
      csiDivision: "25 00 00",
      tradeName: "AUDIT F8 Clean Probe AV",
      budgetEstimate: 100000,
      scopeSummary: "Probe package for the F8 sanitizer live check.",
      mandatoryInclusions: ["None"],
      bidDeadline: "2026-10-31",
    });
    R.packageId = pkgId;
    const discovery = await http.action("contractorDiscovery:discoverSubcontractors", { tradePackageId: pkgId });
    await delay(4000);
    const contractors = await http.query("contractors:listByPackage", { tradePackageId: pkgId });
    const JUNK = [
      /\b(?:hotline|near me|on instagram|on facebook)\b/i,
      /^(?:get|find|hire|call|need|looking for)\b/i,
      /\bin\s+[A-Z][a-zA-Z]+$/,
      /\b(?:and|or|for|in|on|at|to|with|by|from|of|the)\s*$/i,
    ];
    R.discovery = { success: discovery?.success, insertedCount: discovery?.insertedCount, discoveredCount: discovery?.discoveredCount };
    R.names = contractors.map((c) => c.companyName);
    R.junkStored = R.names.filter((n) => JUNK.some((rx) => rx.test(n)));
    writeJson("fix4-after-f8-live-probe.json", R);
  } catch (e) {
    R.error = String(e && e.stack ? e.stack : e).slice(0, 400);
    writeJson("fix4-after-f8-live-probe.json", R);
  }
  console.log(JSON.stringify(R, null, 2).slice(0, 6000));
};
run();
