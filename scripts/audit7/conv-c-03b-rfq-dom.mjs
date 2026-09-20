/**
 * CONV-C 03b: precise DOM evidence for (a) the dispatch-button copy, (b) the live
 * license-status labels + provenance header on Discovery, and (c) the stale audit
 * rows visible in the public demo stream. Read-only; no dispatch click.
 */
import fs from "node:fs";
import path from "node:path";
import { openApp, clickTab, selectProject, selectRibbonPackage, writeEvidence, delay } from "./lib.mjs";

const out = { startedAt: new Date().toISOString() };
const { browser, page } = await openApp(1440, 900);
try {
  const projects = (await page.evaluate(async () => {
    const r = await fetch("/api/query", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: "projects:listProjects", args: {}, format: "json" }) });
    return r.ok ? await r.json() : null;
  }).catch(() => null)) || null;
  // projects are not needed from the UI; pick the demo through the real selector text
  const demoId = await page.evaluate(() => {
    const s = document.querySelector('select[aria-label="Select Commercial Construction Project"]');
    const opt = s ? [...s.options].find((o) => /The Domain Tower B/i.test(o.textContent)) : null;
    return opt ? opt.value : null;
  });
  out.demoId = demoId;
  if (demoId) {
    await page.evaluate((pid) => {
      const s = document.querySelector('select[aria-label="Select Commercial Construction Project"]');
      s.value = pid;
      s.dispatchEvent(new Event("change", { bubbles: true }));
    }, demoId);
    await delay(1800);
  }
  out.uiProjectsFetched = Boolean(projects);

  // (a) Packages: all Dispatch buttons
  await clickTab(page, "01:");
  await delay(1400);
  out.dispatchButtons = await page.evaluate(() =>
    [...document.querySelectorAll("button")]
      .filter((b) => /Dispatch RFQs/.test(b.textContent || ""))
      .map((b) => ({ text: b.textContent.trim(), title: b.getAttribute("title"), disabled: b.disabled }))
  );

  // (b) Discovery: provenance header + per-contractor license labels
  await clickTab(page, "02:");
  await delay(1600);
  await selectRibbonPackage(page, "Electrical & Lighting Systems");
  await delay(1200);
  out.discovery = await page.evaluate(() => {
    const main = document.querySelector("main") || document.body;
    const text = main.innerText;
    const provenanceLine = (text.split("\n").find((l) => /provenance/i.test(l)) || "").trim();
    const licenseLabels = [...new Set((text.match(/Active \/ Verified \([^)]*\)/g) || []))];
    const rows = [...document.querySelectorAll("h3, h4")]
      .filter((h) => /Electric|Alterman|Plumbing|Industries|Brandt|Bergelectric|Southland|Dynamic|Kent|Limbach|Daniel/i.test(h.textContent || ""))
      .map((h) => h.textContent.trim());
    const disclaimer = (text.split("\n").find((l) => /verify licensing/i.test(l)) || "").trim();
    return { provenanceLine, disclaimer, licenseLabels, rowHeadings: rows };
  });
  await page.screenshot({ path: path.join(process.cwd(), "evidence", "fix6-conv-c-03b-discovery-license.png") });

  // (c) Audit tab: capture the exact stale rows and scroll them into view
  await clickTab(page, "Live Activity Audit");
  await delay(1800);
  out.audit = await page.evaluate(() => {
    const text = (document.querySelector("main") || document.body).innerText;
    const lines = text.split("\n").map((s) => s.trim()).filter(Boolean);
    return {
      tdlrRows: lines.filter((l) => /TDLR|verified active|registry/i.test(l)),
      dispatchClaim: lines.filter((l) => /via AgentMail and TDLR/i.test(l)),
      cronCard: lines.filter((l) => /no registry lookup is performed/i.test(l)),
    };
  });
  out.scrolled = await page.evaluate(() => {
    const el = [...document.querySelectorAll("*")].find((n) => n.children.length === 0 && /via AgentMail and TDLR registry/i.test(n.textContent || ""));
    if (!el) return false;
    el.scrollIntoView({ block: "center" });
    return true;
  });
  await delay(600);
  await page.screenshot({ path: path.join(process.cwd(), "evidence", "fix6-conv-c-03b-audit-stale-rows.png") });
} catch (err) {
  out.error = String(err?.stack ?? err);
} finally {
  await browser.close();
}
writeEvidence("fix6-conv-c-03b-rfq-dom.json", out);
console.log(JSON.stringify({ dispatchButtons: out.dispatchButtons, discovery: out.discovery, audit: out.audit, scrolled: out.scrolled, error: out.error }, null, 1));