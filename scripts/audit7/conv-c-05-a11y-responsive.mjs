/**
 * CONV-C 05 (audit-6 check 6): responsive overflow at 375px and 720px, dialog
 * a11y contract (role, aria-modal, Escape close + focus restore) and console
 * error / pageerror counts while loading every tab.
 */
import fs from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { launchBrowser, waitForAppReady } from "../qa/lib.mjs";
import { BASE, q, writeEvidence } from "./lib.mjs";

const TABS = [
  "CSI Scoping",
  "Discovery",
  "Pre-Bid Q&A",
  "Bid Leveling",
  "Scope Clash",
  "Subcontracts",
  "Live Activity Audit",
  "Evals & Architecture",
];
const out = { startedAt: new Date().toISOString(), tabs: TABS };
const { browser } = await launchBrowser(1440, 900);
const page = await browser.newPage();
const consoleErrors = [];
const consoleWarnings = [];
const pageErrors = [];
const failedRequests = [];
page.on("console", (m) => {
  if (m.type() === "error") consoleErrors.push({ text: m.text().slice(0, 500), url: page.url() });
  if (m.type() === "warning") consoleWarnings.push(m.text().slice(0, 300));
});
page.on("pageerror", (e) => pageErrors.push(String(e && e.message ? e.message : e).slice(0, 500)));
page.on("requestfailed", (r) => failedRequests.push(`${r.method()} ${r.url().slice(0, 160)} :: ${r.failure()?.errorText || "?"}`));
await page.evaluateOnNewDocument(() => {
  try {
    localStorage.setItem("tradepulse.tourDismissed", "1");
  } catch {}
});

const clickTab = async (label) => {
  const ok = await page.evaluate((p) => {
    const b = [...document.querySelectorAll("button")].find((x) => {
      const t = x.getAttribute("title") || "";
      return t.startsWith(p) || t.includes(p) || (x.textContent || "").trim().includes(p);
    });
    if (!b) return false;
    b.scrollIntoView({ block: "center" });
    b.click();
    return true;
  }, label);
  await delay(1400);
  return ok;
};
const closeTour = async () => {
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find(
      (x) => (x.getAttribute("title") || "").includes("Close Demo Tour") || (x.textContent || "").trim() === "Dismiss"
    );
    b?.click();
  });
  await delay(200);
};

try {
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await waitForAppReady(page, 60000);
  await delay(800);
  await closeTour();
  const projects = (await q("projects:listProjects", {})) || [];
  const demo = projects.find((p) => /The Domain Tower B/i.test(p.title));
  out.demoId = demo?._id ?? null;
  if (demo) {
    await page.evaluate((pid) => {
      const s = document.querySelector('select[aria-label="Select Commercial Construction Project"]');
      s.value = pid;
      s.dispatchEvent(new Event("change", { bubbles: true }));
    }, demo._id);
    await delay(1800);
  }

  // --- every tab at 1440: load + console error accounting ---
  out.tabErrors = {};
  for (const t of TABS) {
    const before = consoleErrors.length;
    const beforePE = pageErrors.length;
    const ok = await clickTab(t);
    out.tabErrors[t] = {
      clicked: ok,
      newConsoleErrors: consoleErrors.length - before,
      newPageErrors: pageErrors.length - beforePE,
      samples: consoleErrors.slice(before).map((e) => e.text),
    };
  }
  await page.screenshot({ path: path.join(process.cwd(), "evidence", "fix6-conv-c-05-1440.png") });

  // --- overflow sweep ---
  out.overflow = {};
  for (const [w, h] of [
    [375, 812],
    [720, 900],
    [1440, 900],
  ]) {
    await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
    await delay(500);
    const rows = [];
    for (const t of TABS) {
      await clickTab(t);
      await delay(1100);
      const m = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        bodyScrollWidth: document.body.scrollWidth,
        innerWidth: window.innerWidth,
      }));
      rows.push({ tab: t, ...m, overflow: m.scrollWidth - m.innerWidth, ok: m.scrollWidth <= m.innerWidth + 1 });
      if (!m.scrollWidth <= m.innerWidth + 1) {
        await page.screenshot({ path: path.join(process.cwd(), "evidence", `fix6-conv-c-05-overflow-${w}-${t.replace(/\W+/g, "-")}.png`) });
      }
    }
    out.overflow[w] = rows;
    if (w !== 1440) await page.screenshot({ path: path.join(process.cwd(), "evidence", `fix6-conv-c-05-${w}.png`) });
  }
  out.overflowViolations = Object.entries(out.overflow).flatMap(([w, rows]) => rows.filter((r) => !r.ok).map((r) => ({ width: Number(w), ...r })));

  // --- dialog contract ---
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  await delay(500);
  await clickTab("CSI Scoping");
  out.dialog = await page.evaluate(async () => {
    const b = [...document.querySelectorAll("button")].find((x) => /New Project/.test(x.textContent || ""));
    if (!b) return { opened: false, reason: "New Project button missing" };
    b.scrollIntoView({ block: "center" });
    const r = b.getBoundingClientRect();
    window.__convCOpener = b;
    return { opened: true, x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  if (out.dialog.opened) {
    await page.mouse.click(out.dialog.x, out.dialog.y);
    await delay(900);
    out.dialogState = await page.evaluate(() => {
      const dialogs = [...document.querySelectorAll('[role="dialog"],[role="alertdialog"]')].filter(
        (d) => d.getBoundingClientRect().width > 1 && d.getBoundingClientRect().height > 1
      );
      const d = dialogs[dialogs.length - 1];
      if (!d) return { present: false };
      const active = document.activeElement;
      return {
        present: true,
        role: d.getAttribute("role"),
        ariaModal: d.getAttribute("aria-modal"),
        labelledBy: d.getAttribute("aria-labelledby"),
        title: (d.querySelector("h2,h3") || {}).textContent?.trim() || null,
        focusInside: d.contains(active),
        activeElementTag: active ? active.tagName + (active.getAttribute("aria-label") ? `[${active.getAttribute("aria-label")}]` : "") : null,
        openerIsActive: active === window.__convCOpener,
      };
    });
    await page.screenshot({ path: path.join(process.cwd(), "evidence", "fix6-conv-c-05-dialog.png") });
    await page.keyboard.press("Escape");
    await delay(700);
    out.afterEscape = await page.evaluate(() => {
      const dialogs = [...document.querySelectorAll('[role="dialog"],[role="alertdialog"]')].filter(
        (d) => d.getBoundingClientRect().width > 1 && d.getBoundingClientRect().height > 1
      );
      return {
        dialogStillOpen: dialogs.length > 0,
        focusRestoredToOpener: document.activeElement === window.__convCOpener,
        activeElementTag: document.activeElement ? document.activeElement.tagName : null,
        activeText: (document.activeElement?.textContent || "").trim().slice(0, 60),
      };
    });
  }

  out.consoleErrorTotal = consoleErrors.length;
  out.pageErrorTotal = pageErrors.length;
  out.consoleErrors = consoleErrors;
  out.pageErrors = pageErrors;
  out.failedRequestCount = failedRequests.length;
  out.failedRequests = [...new Set(failedRequests)].slice(0, 20);
  out.consoleWarningCount = consoleWarnings.length;
} catch (err) {
  out.error = String(err?.stack ?? err);
} finally {
  await browser.close();
}
writeEvidence("fix6-conv-c-05-a11y-responsive.json", out);
console.log(
  JSON.stringify(
    {
      tabErrors: out.tabErrors,
      overflowViolations: out.overflowViolations,
      overflowSummary: Object.fromEntries(Object.entries(out.overflow).map(([w, rows]) => [w, rows.map((r) => `${r.tab}:${r.overflow}`)])),
      dialogState: out.dialogState,
      afterEscape: out.afterEscape,
      consoleErrorTotal: out.consoleErrorTotal,
      pageErrorTotal: out.pageErrorTotal,
      pageErrors: out.pageErrors,
      failedRequestCount: out.failedRequestCount,
      error: out.error,
    },
    null,
    1
  )
);