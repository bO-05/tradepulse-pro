import fs from "node:fs";
import { launchBrowser, attachDiagnostics, waitForAppReady, shot, writeJson, delay, getSelectorState } from "./lib.mjs";
import { ConvexHttpClient } from "convex/browser";

const R = { startedAt: new Date().toISOString() };
const http = new ConvexHttpClient("https://brainy-skunk-440.convex.cloud");
const FIXTURE = "AUDIT-4-2026-09-18";

const run = async () => {
  const { browser } = await launchBrowser(1440, 900);
  const ctxA = await browser.createBrowserContext();
  const ctxB = await browser.createBrowserContext();
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();
  const diagA = attachDiagnostics(pageA);

  const setup = async (page) => {
    await page.goto("https://brainy-skunk-440.convex.site/", { waitUntil: "domcontentloaded", timeout: 60000 });
    await waitForAppReady(page);
    await delay(1200);
    await page.evaluate(() => { const b = [...document.querySelectorAll("button")].find((x) => (x.getAttribute("title") || "").includes("Close Demo Tour") || (x.textContent || "").trim() === "Dismiss"); b?.click(); });
    await delay(300);
    const sel = await getSelectorState(page);
    const fixture = sel?.options.find((o) => o.text.includes(FIXTURE));
    if (!fixture) throw new Error("fixture not found for " + (sel?.options || []).map((o) => o.text).join(","));
    await page.evaluate((v) => { const s = document.querySelector('select[aria-label="Select Commercial Construction Project"]'); s.value = v; s.dispatchEvent(new Event("change", { bubbles: true })); }, fixture.value);
    await delay(1200);
    // open Q&A
    await page.evaluate(() => { const b = [...document.querySelectorAll("button")].find((x) => (x.getAttribute("title") || "").startsWith("03:")); b?.click(); });
    await delay(1200);
  };

  try {
    // backend verify jev-created package
    const projects = await http.query("projects:listProjects", {});
    const fixture = projects.find((p) => p.title === FIXTURE);
    const pkgs = await http.query("tradePackages:listByProject", { projectId: fixture._id });
    R.backendFixture = { id: fixture._id, packages: pkgs.map((p) => ({ name: p.tradeName, csi: p.csiDivision, budget: p.budgetEstimate, status: p.status, shared: p.agentMailboxShared || false })) };

    await setup(pageA);
    await setup(pageB);
    await shot(pageA, "audit4-realtime-A-before.png");
    R.countsBefore = await Promise.all([pageA, pageB].map((p) => p.evaluate(() => (document.body.innerText.match(/All RFIs \((\d+)\)/) || [])[1] || "0")));

    const subject = "AUDIT-4 REALTIME " + Date.now();
    const sA = await pageA.$('input[placeholder*="Hoisting responsibility"]');
    const qA = await pageA.$('textarea[placeholder*="scope coordination question"]');
    await sA.click({ clickCount: 3 });
    await pageA.keyboard.type(subject);
    await qA.click({ clickCount: 3 });
    await pageA.keyboard.type("AUDIT-4 realtime propagation test. Does this question appear in both contexts?");
    await delay(300);
    const t0 = Date.now();
    await pageA.evaluate(() => { [...document.querySelectorAll("button")].find((b) => (b.textContent || "").includes("Submit RFI"))?.click(); });
    await pageA.keyboard.press("PageDown").catch(() => {});

    let seenA = null, seenB = null;
    for (let i = 0; i < 45; i++) {
      await delay(1000);
      const [a, b] = await Promise.all([pageA, pageB].map((p) => p.evaluate((s) => document.body.innerText.includes(s), subject)));
      if (a && !seenA) seenA = Date.now() - t0;
      if (b && !seenB) seenB = Date.now() - t0;
      if (seenA && seenB) break;
    }
    R.realtime = { subject, seenInAms: seenA, seenInBms: seenB, propagationMs: seenA !== null && seenB !== null ? Math.abs(seenB - seenA) : null };

    // full timestamps on the RFI card in A
    R.rfiTimestamps = await pageA.evaluate(() => (document.body.innerText.match(/(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{2}, \d{4}, [^\n]{0,40}/g) || []).slice(0, 2));
    await shot(pageA, "audit4-realtime-A-after.png", { full: true });
    await shot(pageB, "audit4-realtime-B-after.png", { full: true });

    // keyboard-only: switch project with keyboard, open Judge Dock, close
    await pageA.evaluate(() => document.body.focus());
    let sawSelector = false, sawDock = false;
    for (let i = 0; i < 30; i++) {
      await pageA.keyboard.press("Tab");
      const label = await pageA.evaluate(() => (document.activeElement?.getAttribute("aria-label") || document.activeElement?.textContent || "").trim().slice(0, 40));
      if (label.includes("Select Commercial Construction Project")) sawSelector = true;
      if (label.includes("60s Judge Dock")) { sawDock = true; await pageA.keyboard.press("Enter"); break; }
    }
    await delay(700);
    const dockOpen = await pageA.evaluate(() => !!document.querySelector('[role="dialog"]'));
    await pageA.keyboard.press("Escape");
    await delay(500);
    R.keyboard = { sawSelector, sawDock, dockOpen, dockClosed: await pageA.evaluate(() => !document.querySelector('[role="dialog"]')), focusAfter: await pageA.evaluate(() => (document.activeElement?.textContent || "").trim().slice(0, 30)) };

    R.diag = { consoleErrors: diagA.consoleLogs.filter((l) => l.type === "error").map((l) => l.text.slice(0, 100)).slice(0, 5) };
    writeJson("audit4-realtime.json", R);
  } catch (e) {
    R.error = String(e && e.stack ? e.stack : e);
    writeJson("audit4-realtime.json", R);
  } finally {
    await browser.close();
  }
  console.log(JSON.stringify(R, null, 2).slice(0, 9000));
};
run();