import { setTimeout as delay } from "node:timers/promises";
import { launchBrowser, waitForAppReady, shot, writeJson } from "./lib.mjs";
import { ConvexHttpClient } from "convex/browser";

const R = { startedAt: new Date().toISOString() };
const http = new ConvexHttpClient("https://brainy-skunk-440.convex.cloud");
const FIXTURE = "AUDIT-5-F3-BEFORE-2026-09-18";
const EMPTY = "AUDIT-5-EMPTY-2026-09-18";

const run = async () => {
  const { browser } = await launchBrowser(1440, 900);
  const page = await browser.newPage();
  const closeTour = async () => {
    await page.evaluate(() => { const b = [...document.querySelectorAll("button")].find((x) => (x.getAttribute("title") || "").includes("Close Demo Tour") || (x.textContent || "").trim() === "Dismiss"); b?.click(); });
    await delay(300);
  };
  const selectProject = async (needle) => {
    await page.evaluate((n) => {
      const s = document.querySelector('select[aria-label="Select Commercial Construction Project"]');
      const o = [...s.options].find((x) => x.textContent.includes(n));
      s.value = o.value; s.dispatchEvent(new Event("change", { bubbles: true }));
    }, needle);
    await delay(1700);
  };
  const clickTab = async (prefix) => {
    await page.evaluate((p) => { const b = [...document.querySelectorAll("button")].find((x) => (x.getAttribute("title") || "").startsWith(p)); b?.click(); }, prefix);
    await delay(900);
  };
  try {
    await page.goto("https://brainy-skunk-440.convex.site/", { waitUntil: "domcontentloaded", timeout: 60000 });
    await waitForAppReady(page);
    await delay(1200);
    await closeTour();

    // ---------- F12
    await selectProject("The Domain Tower B");
    R.f12 = {
      compact: await page.evaluate(() => (document.querySelector("main")?.innerText || "").split("\n").slice(0, 8).join(" | ")),
      bareBuyoutCounter: await page.evaluate(() => /Buyout: \d+\/\d+ Awarded/.test(document.body.innerText)),
    };
    await page.evaluate(() => { [...document.querySelectorAll("button")].find((b) => (b.textContent || "").includes("Expand 6-Card KPI View"))?.click(); });
    await delay(600);
    R.f12.expandedHasSubcontractAwards = await page.evaluate(() => document.body.innerText.includes("SUBCONTRACT AWARDS") || document.body.innerText.includes("Subcontract Awards"));
    await shot(page, "fix4-after-F12-subcontract-wording.png");
    await page.evaluate(() => { [...document.querySelectorAll("button")].find((b) => (b.textContent || "").includes("Compact Mode"))?.click(); });
    await delay(400);

    // ---------- F5 leveling + discovery
    await clickTab("04:");
    R.f5 = {
      levelingCTAs: await page.evaluate(() => [...document.querySelectorAll("main button")].map((b) => ({ t: (b.textContent || "").trim().slice(0, 60), cls: (b.className || "").toString().slice(0, 40) })).filter((b) => /Advance|Skip ahead|Scope Clash Engine/i.test(b.t))),
    };
    await shot(page, "fix4-after-F5-leveling.png");
    await clickTab("02:");
    R.f5.discoveryCTAs = await page.evaluate(() => [...document.querySelectorAll("main button")].map((b) => ({ t: (b.textContent || "").trim().slice(0, 60), cls: (b.className || "").toString().slice(0, 40) })).filter((b) => /Advance|Skip|Proceed/i.test(b.t)));
    await shot(page, "fix4-after-F5-discovery.png");

    // ---------- Empty state (F5)
    await selectProject(EMPTY);
    await clickTab("01:");
    R.f5.emptyState = await page.evaluate(() => {
      const t = document.body.innerText;
      return {
        hasRunSpec: t.includes("Run AI Spec Breakdown"),
        hasGuidance: t.includes("in the header above to get started"),
        headerHasSpecCTA: [...document.querySelectorAll("main button, header button")].some((b) => (b.textContent || "").includes("AI Spec Breakdown (Auto-Scope)")),
      };
    });
    await shot(page, "fix4-after-F5-empty-state.png");

    // ---------- F9 tour copy
    await selectProject("The Domain Tower B");
    await page.evaluate(() => { const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").includes("Demo Tour")); if (b) b.click(); });
    await delay(800);
    await page.evaluate(() => { [...document.querySelectorAll("button")].find((x) => (x.getAttribute("title") || "").startsWith("01:"))?.click(); });
    await delay(800);
    R.f9 = await page.evaluate(() => {
      const t = document.body.innerText;
      return {
        cue: (t.match(/Cue:[^\n]{0,340}/) || [])[0] || null,
        dedicatedClaim: /dedicated programmatic/i.test(t),
        keyMetric: (t.match(/\d+ CSI Trade Packages? •[^\n]*/) || [])[0] || null,
      };
    });
    await shot(page, "fix4-after-F9-tour-copy.png");
    await closeTour();

    // ---------- F10 generated reply formatting
    const fixtureProject = (await http.query("projects:listProjects", {})).find((p) => p.title.includes(FIXTURE));
    const pkgs = await http.query("tradePackages:listByProject", { projectId: fixtureProject._id });
    const div26 = pkgs.find((p) => p.csiDivision.startsWith("26"));
    const convos = await http.query("rfq:listConversations", { tradePackageId: div26._id });
    const latest = convos.find((c) => c.inboundSubject.includes("F1 persistence check"));
    R.f10 = {
      subject: latest?.inboundSubject || null,
      isMarkdownStructured: latest ? /(^|\n)(#{1,4} |\*\*)/.test(latest.autonomousReply) : null,
      replyHead: latest?.autonomousReply?.slice(0, 160) || null,
    };

    // ---------- F8 live discovery attempt (one run on the audit fixture only)
    try {
      const discovery = await http.action("contractorDiscovery:discoverSubcontractors", { tradePackageId: div26._id });
      await delay(4000);
      const contractors = await http.query("contractors:listByPackage", { tradePackageId: div26._id });
      const dangling = contractors.filter((c) => /\b(?:and|or|for|in|on|at|to|with|by|from|of|the)\s*$/i.test(c.companyName) || (/,/.test(c.companyName) && c.companyName.split(/\s+/).length >= 5 && !/\b(?:inc|llc|corp|group|associates|partners|systems?|services?|industries|solutions|technologies|engineering|construction|contractors?|electric(?:al)?|plumbing|mechanical|hvac)\b/i.test(c.companyName)));
      R.f8 = {
        discoveryResult: { success: discovery?.success, insertedCount: discovery?.insertedCount, source: discovery?.source },
        contractorCount: contractors.length,
        names: contractors.map((c) => c.companyName),
        danglingNames: dangling.map((c) => c.companyName),
      };
    } catch (e) {
      R.f8 = { error: String(e && e.message ? e.message : e).slice(0, 300) };
    }
    await writeJson("fix4-after-f5-f8-f9-f10-f12.json", R);
  } catch (e) {
    R.error = String(e && e.stack ? e.stack : e);
    writeJson("fix4-after-f5-f8-f9-f10-f12.json", R);
  } finally {
    await browser.close();
  }
  console.log(JSON.stringify(R, null, 2).slice(0, 12000));
};
run();