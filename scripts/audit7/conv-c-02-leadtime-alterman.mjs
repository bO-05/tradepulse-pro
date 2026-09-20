/**
 * CONV-C 02 (audit-6 check 3): lead-time arithmetic on the demo's Alterman card.
 * Read-only.
 */
import fs from "node:fs";
import path from "node:path";
import { openApp, clickTab, selectProject, selectRibbonPackage, q, writeEvidence, delay, clickText } from "./lib.mjs";

const out = { startedAt: new Date().toISOString() };
const { browser, page } = await openApp(1440, 900);
try {
  const projects = (await q("projects:listProjects", {})) || [];
  const demo = projects.find((p) => /The Domain Tower B/i.test(p.title));
  await selectProject(page, demo._id);
  await delay(1800);
  await clickTab(page, "04:");
  await delay(1500);
  out.packageSelected = await selectRibbonPackage(page, "Electrical & Lighting Systems");
  await delay(1500);

  out.cardCapture = await page.evaluate(() => {
    const h = [...document.querySelectorAll("h3")].find((x) => /Alterman/i.test(x.textContent || ""));
    if (!h) return { found: false };
    let node = h;
    for (let i = 0; i < 8 && node; i++) {
      node = node.parentElement;
      if (node && /Forensic Scope Normalization/.test(node.innerText || "")) break;
    }
    if (!node) return { found: true, cardText: null, note: "card container not found" };
    const cardText = node.innerText.replace(/\n+/g, " | ");
    const leadLine = (node.innerText.match(/Lead Time \([^)]*\):[^\n]*/g) || []).map((s) => s.trim());
    const arithmetic = (node.innerText.match(/\([0-9]+\s*[−\-×x*]\s*[0-9]+\s*[−\-]\s*\$[\d,]+\s*=\s*\+?\$[\d,]+\)/g) || []).map((s) => s.trim());
    return { found: true, cardText, leadLine, arithmetic };
  });
  await page.screenshot({ path: path.join(process.cwd(), "evidence", "fix6-conv-c-02-leadtime-card.png") });

  // Table view cross-check
  out.tableToggle = await clickText(page, "Table View");
  await delay(1200);
  out.tableRow = await page.evaluate(() => {
    const rows = [...document.querySelectorAll("tr")];
    const lead = rows.find((r) => /Equipment Lead Time/.test(r.innerText || ""));
    if (!lead) return null;
    const headers = [...(lead.closest("table")?.querySelectorAll("thead th") || [])].map((t) => t.innerText.replace(/\n+/g, " ").trim());
    const cells = [...lead.querySelectorAll("td")].map((t) => t.innerText.replace(/\n+/g, " | ").trim());
    const altIdx = headers.findIndex((h) => /Alterman/i.test(h));
    return { headers, cells, altermanCell: altIdx >= 0 ? cells[altIdx] : null };
  });
  await page.screenshot({ path: path.join(process.cwd(), "evidence", "fix6-conv-c-02-leadtime-table.png") });

  // Backend field cross-check for the same card
  const pkgs = (await q("tradePackages:listByProject", { projectId: demo._id })) || [];
  const div26 = pkgs.find((p) => /^26/.test(p.csiDivision));
  const bids = (await q("bids:listAllProjectBids", { projectId: demo._id })) || [];
  const alt = bids.find((b) => /Alterman/i.test(b.subcontractorName));
  out.backend = alt
    ? {
        csiDivision: div26?.csiDivision,
        subcontractorName: alt.subcontractorName,
        baseBidAmount: alt.baseBidAmount,
        longLeadEquipmentWeeks: alt.longLeadEquipmentWeeks,
        leadTimeTargetWeeks: alt.leadTimeTargetWeeks ?? null,
        leadTimePenalty: alt.leadTimePenalty,
        leveledTotalCost: alt.leveledTotalCost,
      }
    : null;
} catch (err) {
  out.error = String(err?.stack ?? err);
} finally {
  await browser.close();
}
writeEvidence("fix6-conv-c-02-leadtime-alterman.json", out);
console.log(JSON.stringify({ packageSelected: out.packageSelected, leadLine: out.cardCapture?.leadLine, arithmetic: out.cardCapture?.arithmetic, altermanCell: out.tableRow?.altermanCell, backend: out.backend, error: out.error }, null, 1));