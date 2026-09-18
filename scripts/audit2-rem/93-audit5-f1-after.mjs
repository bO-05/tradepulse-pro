import { setTimeout as delay } from "node:timers/promises";
import { launchBrowser, waitForAppReady, shot, writeJson } from "./lib.mjs";
import { ConvexHttpClient } from "convex/browser";

const R = { startedAt: new Date().toISOString() };
const http = new ConvexHttpClient("https://brainy-skunk-440.convex.cloud");
const FIXTURE = "AUDIT-5-F3-BEFORE-2026-09-18";

const run = async () => {
  const { browser } = await launchBrowser(1440, 900);
  const page = await browser.newPage();
  const closeTour = async () => {
    await page.evaluate(() => { const b = [...document.querySelectorAll("button")].find((x) => (x.getAttribute("title") || "").includes("Close Demo Tour") || (x.textContent || "").trim() === "Dismiss"); b?.click(); });
    await delay(300);
  };
  try {
    const projects = await http.query("projects:listProjects", {});
    const fixtureProject = projects.find((p) => p.title.includes(FIXTURE));
    const pkgs = await http.query("tradePackages:listByProject", { projectId: fixtureProject._id });
    const div26 = pkgs.find((p) => p.csiDivision.startsWith("26"));
    R.fixture = { projectId: fixtureProject._id, packageId: div26._id, existingRfis: (await http.query("rfq:listConversations", { tradePackageId: div26._id })).length };

    await page.goto("https://brainy-skunk-440.convex.site/", { waitUntil: "domcontentloaded", timeout: 60000 });
    await waitForAppReady(page);
    await delay(1200);
    await closeTour();

    await page.evaluate((pid) => {
      const s = document.querySelector('select[aria-label="Select Commercial Construction Project"]');
      s.value = pid; s.dispatchEvent(new Event("change", { bubbles: true }));
    }, fixtureProject._id);
    await delay(1800);
    await page.evaluate(() => { const b = [...document.querySelectorAll("button")].find((x) => (x.getAttribute("title") || "").startsWith("03:")); b?.click(); });
    await delay(900);

    const boxes = await page.evaluate(() => {
      const form = [...document.querySelectorAll("form")].slice(-1)[0];
      const i = form.querySelector('input[type="text"]');
      const ta = form.querySelector("textarea");
      i.scrollIntoView({ block: "center" });
      const ri = i.getBoundingClientRect(); const rt = ta.getBoundingClientRect();
      return { i: { x: ri.left + ri.width / 2, y: ri.top + ri.height / 2 }, t: { x: rt.left + rt.width / 2, y: rt.top + rt.height / 2 } };
    });
    await page.mouse.click(boxes.i.x, boxes.i.y);
    await page.keyboard.type("AUDIT F1 persistence check", { delay: 6 });
    await page.mouse.click(boxes.t.x, boxes.t.y);
    await page.keyboard.type("Confirm the temporary power distribution responsibility survives a refresh mid-analysis.", { delay: 4 });

    const t0 = Date.now();
    const btn = await page.evaluate(() => {
      const form = [...document.querySelectorAll("form")].slice(-1)[0];
      const b = form.querySelector('button[type="submit"]');
      b.scrollIntoView({ block: "center" });
      const r = b.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    await page.mouse.click(btn.x, btn.y);

    // Poll backend fast: the row must exist almost immediately, before analysis ends
    const timeline = [];
    let row = null;
    for (let i = 0; i < 120; i++) {
      await delay(400);
      const convos = await http.query("rfq:listConversations", { tradePackageId: div26._id });
      const found = convos.find((c) => c.inboundSubject.includes("F1 persistence check"));
      timeline.push({ ms: Date.now() - t0, exists: !!found, status: found?.status || null, replyLen: found?.autonomousReply?.length || 0 });
      if (found && found.status === "pending_analysis" && !R.firstSeen) {
        R.firstSeen = { ms: Date.now() - t0, status: found.status, questionPreserved: found.inboundQuestion.includes("temporary power") };
        R.inflightPanel = await page.evaluate(() => document.body.innerText.includes("RFI saved. The AI is analyzing"));
        await shot(page, "fix4-after-F1-pending-row.png");
      }
      if (found && found.status !== "pending_analysis") { row = found; break; }
      if (Date.now() - t0 > 150000) break;
    }
    R.timelineHead = timeline.slice(0, 8);
    R.final = row ? { ms: Date.now() - t0, status: row.status, questionPreserved: row.inboundQuestion.includes("temporary power"), replyLen: row.autonomousReply.length } : null;
    await shot(page, "fix4-after-F1-completed.png");
    writeJson("fix4-after-f1.json", R);
  } catch (e) {
    R.error = String(e && e.stack ? e.stack : e);
    writeJson("fix4-after-f1.json", R);
  } finally {
    await browser.close();
  }
  console.log(JSON.stringify(R, null, 2).slice(0, 8000));
};
run();