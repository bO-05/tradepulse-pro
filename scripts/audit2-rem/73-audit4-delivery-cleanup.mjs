import { launchBrowser, attachDiagnostics, waitForAppReady, shot, writeJson, delay } from "./lib.mjs";
import { ConvexHttpClient } from "convex/browser";

const R = { startedAt: new Date().toISOString() };
const http = new ConvexHttpClient("https://brainy-skunk-440.convex.cloud");
const FIXTURE = "AUDIT-4-2026-09-18";

const run = async () => {
  const { browser } = await launchBrowser(1440, 900);
  const page = await browser.newPage();
  attachDiagnostics(page);
  try {
    // 1) direct action run: delivery log truth
    const projects = await http.query("projects:listProjects", {});
    const fixture = projects.find((p) => p.title === FIXTURE);
    const pkgs = await http.query("tradePackages:listByProject", { projectId: fixture._id });
    const pkg = pkgs.find((p) => p.tradeName === "AUDIT-4 Electrical");
    const res = await http.action("rfqActions:dispatchRfqsWithNotification", { tradePackageId: pkg._id });
    const logs = await http.query("auditLogs:listRecentLogs", { projectId: fixture._id, limit: 10 });
    R.deliveryLog = {
      emailsSent: res.emailsSent,
      dispatchedCount: res.dispatchedCount,
      deliveryConfigured: res.deliveryConfigured,
      failures: (res.deliveryFailures || []).slice(0, 3),
      recentTitles: logs.map((l) => l.title).slice(0, 5),
      latestDelivery: logs.find((l) => l.title.startsWith("AgentMail Delivery")) || null,
    };

    // 2) screenshot the fixed sponsor cards
    await page.goto("https://brainy-skunk-440.convex.site/", { waitUntil: "domcontentloaded", timeout: 60000 });
    await waitForAppReady(page);
    await delay(1500);
    await page.evaluate(() => { const b = [...document.querySelectorAll("button")].find((x) => (x.getAttribute("title") || "").includes("Close Demo Tour") || (x.textContent || "").trim() === "Dismiss"); b?.click(); });
    await page.evaluate(() => { [...document.querySelectorAll("button")].find((x) => (x.textContent || "").includes("Evals & Architecture"))?.click(); });
    await delay(1500);
    await page.evaluate(() => { const el = [...document.querySelectorAll("h3")].find((h) => (h.textContent || "").includes("Sponsor Cards") || (h.textContent || "").includes("Integration")); if (el) el.scrollIntoView({ block: "start" }); else window.scrollTo(0, document.body.scrollHeight); });
    await delay(600);
    R.sponsorText = await page.evaluate(() => {
      const t = document.body.innerText;
      const idx = t.indexOf("OpenAI\nBYOK") >= 0 ? t.indexOf("OpenAI\nBYOK") : t.indexOf("Adapter Ready");
      return {
        openaiAdapter: t.includes("Adapter Ready / Key Required"),
        firecrawlProvenance: t.includes("provenance-first"),
        noTdlrClaim: !t.includes("TDLR & TSBPE"),
        noRubricClaim: !t.includes("satisfying 100% of the hackathon judging rubric"),
      };
    });
    await shot(page, "audit4-sponsor-cards-fixed.png", { full: true });

    // 3) cleanup all AUDIT-* on prod
    const all = await http.query("projects:listProjects", {});
    const deleted = [];
    for (const p of all) {
      if (p.title.startsWith("AUDIT-")) { await http.mutation("projects:deleteProject", { projectId: p._id }); deleted.push(p.title); }
    }
    const after = await http.query("projects:listProjects", {});
    R.cleanup = { deleted, remaining: after.map((p) => p.title) };
    writeJson("audit4-delivery-and-cleanup.json", R);
  } catch (e) {
    R.error = String(e && e.stack ? e.stack : e);
    writeJson("audit4-delivery-and-cleanup.json", R);
  } finally {
    await browser.close();
  }
  console.log(JSON.stringify(R, null, 2).slice(0, 7000));
};
run();