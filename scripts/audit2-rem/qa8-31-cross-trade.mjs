/**
 * QA8 hunt — Cross-trade coordination: scan, deduct, assign, persistence after
 * reload, and duplicate-deduction probe (same clashId, different description).
 * Fixture: AUDIT-QA8-cross-2026-09-18.
 */
import { attachDiagnostics, clickHeaderTab, delay, gotoDemo, launchBrowser, selectProjectByTitle, writeJson } from "./qa6-lib.mjs";
import { shot } from "./lib.mjs";
import { client, fixtureName, writeEvidence } from "./qa8-lib.mjs";

const c = client();
const prefix = fixtureName("cross");
const out = { ranAt: new Date().toISOString(), checks: [], ui: {}, backend: {} };
const checks = [];
const addCheck = (id, label, ok, observed) => {
  checks.push({ id, label, ok, observed: String(observed).slice(0, 400) });
  console.log(`${ok ? "PASS" : "FAIL"}  ${id} ${label} :: ${String(observed).slice(0, 250)}`);
};
const clickButton = (page, text) =>
  page.evaluate((needle) => {
    const b = [...document.querySelectorAll("button")].find((x) => x.innerText.includes(needle));
    if (!b) return { ok: false, available: [...document.querySelectorAll("button")].map((x) => x.innerText.trim()).filter(Boolean).slice(0, 80) };
    b.scrollIntoView({ block: "center" });
    const r = b.getBoundingClientRect();
    return { ok: true, x: r.left + r.width / 2, y: r.top + r.height / 2, text: b.innerText.trim().slice(0, 60) };
  }, text);

let projectId;
try {
  projectId = await c.mutation("projects:createProject", {
    title: prefix,
    location: "Austin, TX",
    projectType: "Class-A Commercial Mixed-Use",
    estBudget: 2_500_000,
    targetCompletionWeeks: 40,
    specDocumentText: "QA8 cross-trade fixture.",
    isDemoProject: false,
  });
  const mkPkg = async (csi, name) =>
    await c.mutation("tradePackages:createTradePackage", {
      projectId,
      csiDivision: csi,
      tradeName: name,
      budgetEstimate: 1_000_000,
      scopeSummary: `${name} QA8 scope.`,
      mandatoryInclusions: ["Code compliance"],
      bidDeadline: "2026-10-31",
    });
  const mkContractor = async (pkg, name, tag) =>
    await c.mutation("contractors:createContractor", {
      tradePackageId: pkg,
      companyName: name,
      contactEmail: `${tag}@qa8.test`,
      phone: "+1 (512) 555-0188",
      licenseNumber: `TX-QA8-${tag.toUpperCase()}`,
      licenseStatus: "Active / Verified",
      sourceUrl: `https://qa8.test/${tag}`,
      rfqStatus: "invited",
    });
  const p26 = await mkPkg("26 00 00", "QA8 Cross Electrical");
  const p23 = await mkPkg("23 00 00", "QA8 Cross Mechanical");
  const c26 = await mkContractor(p26, "QA8 Elec Co", "elec");
  const c23 = await mkContractor(p23, "QA8 Mech Co", "mech");
  await c.mutation("bids:submitDirectBid", { tradePackageId: p26, contractorId: c26, subcontractorName: "QA8 Elec Co", baseBidAmount: 1_000_000 });
  const mechBid = await c.mutation("bids:submitDirectBid", { tradePackageId: p23, contractorId: c23, subcontractorName: "QA8 Mech Co", baseBidAmount: 1_000_000 });
  out.fixture = { projectId, p26, p23, mechBidId: mechBid.bidId };

  const { browser } = await launchBrowser(1440, 900);
  const page = await browser.newPage();
  const diagnostics = attachDiagnostics(page);
  try {
    await gotoDemo(page);
    await selectProjectByTitle(page, prefix);
    await delay(1600);
    await clickHeaderTab(page, "05: Scope Clash");
    await delay(1500);

    const detected = await page.evaluate(() => {
      const text = document.body.innerText;
      return {
        hasVfd: text.includes("Variable Frequency Drives"),
        deductButtons: [...document.querySelectorAll("button")].filter((b) => /1-Click Deduct Credit/.test(b.innerText)).map((b) => b.innerText.trim()),
        assignButtons: [...document.querySelectorAll("button")].filter((b) => /Assign to Div/.test(b.innerText)).map((b) => b.innerText.trim()),
        activeClashes: (text.match(/Active Clashes:?\s*(\d+)/i) || [])[1] ?? null,
      };
    });
    out.ui.detected = detected;
    addCheck("H-XT-1", "cross-trade scan surfaces double-buys with deduct CTAs", detected.hasVfd && detected.deductButtons.length > 0, JSON.stringify(detected).slice(0, 300));
    await shot(page, "fix4-qa8-31-cross-detected.png");

    // UI deduct #1
    const deductBtn = await clickButton(page, "1-Click Deduct Credit");
    if (deductBtn.ok) {
      await page.mouse.click(deductBtn.x, deductBtn.y);
      await delay(2500);
      const after = await page.evaluate(() => document.body.innerText);
      out.ui.afterDeductBadge = /Deducted \$[\d,]+ credit alternate/.test(after);
      out.ui.afterDeductToastLike = /Deduct Credit applied/.test(after);
      await shot(page, "fix4-qa8-31-cross-deducted.png");
      addCheck("H-XT-2", "UI deduct shows resolved state", out.ui.afterDeductBadge, `badge=${out.ui.afterDeductBadge}`);
    } else {
      addCheck("H-XT-2", "UI deduct button found", false, JSON.stringify(deductBtn));
    }

    // reload persistence
    await page.reload({ waitUntil: "domcontentloaded" });
    await delay(2500);
    await selectProjectByTitle(page, prefix);
    await delay(1500);
    await clickHeaderTab(page, "05: Scope Clash");
    await delay(1500);
    const persisted = await page.evaluate(() => {
      const text = document.body.innerText;
      return {
        badge: /Deducted \$[\d,]+ credit alternate/.test(text),
        deductButtonsRemaining: [...document.querySelectorAll("button")].filter((b) => /1-Click Deduct Credit/.test(b.innerText)).length,
      };
    });
    out.ui.persisted = persisted;
    addCheck("H-XT-3", "deducted state persists across reload and CTA is gone", persisted.badge && persisted.deductButtonsRemaining === 1, JSON.stringify(persisted));

    // backend duplicate probe
    const bidBefore = (await c.query("bids:listByPackage", { tradePackageId: p23 })).find((b) => b._id === out.fixture.mechBidId);
    const clashTitle = "Variable Frequency Drives (VFDs) for AHUs & Pumps";
    const sameAgain = await c
      .mutation("coordination:deductDoubleBuyCredit", {
        projectId,
        clashId: "clash-vfd-01",
        tradePackageId: p23,
        deductAmount: 38500,
        description: clashTitle,
      })
      .then((v) => ({ ok: true, v }))
      .catch((e) => ({ ok: false, m: e.message }));
    const afterSame = (await c.query("bids:listByPackage", { tradePackageId: p23 })).find((b) => b._id === out.fixture.mechBidId);
    const diffDesc = await c
      .mutation("coordination:deductDoubleBuyCredit", {
        projectId,
        clashId: "clash-vfd-01",
        tradePackageId: p23,
        deductAmount: 38500,
        description: "VFD",
      })
      .then((v) => ({ ok: true, v }))
      .catch((e) => ({ ok: false, m: e.message }));
    const afterDiff = (await c.query("bids:listByPackage", { tradePackageId: p23 })).find((b) => b._id === out.fixture.mechBidId);
    out.backend.duplicate = {
      before: { ve: (bidBefore.valueEngineeringAlternates || []).map((v) => ({ d: v.description, c: v.costDeduct })), leveled: bidBefore.leveledTotalCost },
      sameAgain: { result: sameAgain, ve: (afterSame.valueEngineeringAlternates || []).map((v) => ({ d: v.description, c: v.costDeduct })), leveled: afterSame.leveledTotalCost },
      diffDesc: { result: diffDesc, ve: (afterDiff.valueEngineeringAlternates || []).map((v) => ({ d: v.description, c: v.costDeduct })), leveled: afterDiff.leveledTotalCost },
    };
    const dedupedSame = (afterSame.valueEngineeringAlternates || []).length === (bidBefore.valueEngineeringAlternates || []).length;
    const doubleApplied = (afterDiff.valueEngineeringAlternates || []).length > (afterSame.valueEngineeringAlternates || []).length;
    addCheck("H-XT-4", "same-description repeat does not stack", dedupedSame, `ve=${(afterSame.valueEngineeringAlternates || []).length} leveled=${afterSame.leveledTotalCost}`);
    addCheck(
      "H-XT-5",
      "different-description repeat on the SAME clashId/amount does not stack",
      !doubleApplied,
      `veBefore=${(afterSame.valueEngineeringAlternates || []).length} veAfter=${(afterDiff.valueEngineeringAlternates || []).length} leveled=${afterDiff.leveledTotalCost}`
    );

    // assign void via UI (second void card)
    const assignBtn = await clickButton(page, "Assign to Div 26 (Electrical)");
    if (assignBtn.ok) {
      await page.mouse.click(assignBtn.x, assignBtn.y);
      await delay(2500);
      const assignments = await page.evaluate(() => {
        const text = document.body.innerText;
        return { assignedBadge: /Assigned to .* — Included in mandatory scope/.test(text) };
      });
      const pkg26 = await c.query("tradePackages:getPackage", { tradePackageId: p26 });
      out.ui.assign = { ui: assignments, inclusions: pkg26.mandatoryInclusions };
      await shot(page, "fix4-qa8-31-cross-assigned.png");
      addCheck(
        "H-XT-6",
        "void assign adds mandatory inclusion and shows assigned state",
        assignments.assignedBadge && (pkg26.mandatoryInclusions || []).length > 1,
        JSON.stringify(out.ui.assign).slice(0, 300)
      );
    } else {
      addCheck("H-XT-6", "assign button found", false, JSON.stringify(assignBtn));
    }

    await delay(400);
    const errors = diagnostics.consoleLogs.filter((l) => l.type === "error");
    out.diagnostics = {
      consoleErrors: errors.map((e) => e.text.slice(0, 220)),
      pageErrors: diagnostics.pageErrors,
      failedRequests: diagnostics.failedRequests,
      requestCount: diagnostics.requests.length,
    };
  } finally {
    await browser.close();
  }
} catch (err) {
  out.fatal = String(err?.stack ?? err);
  console.error("FATAL", err);
} finally {
  const all = await c.query("projects:listProjects", {});
  out.cleanup = { deleted: [], leftover: [] };
  for (const p of all.filter((p) => p.title.startsWith("AUDIT-QA8-"))) {
    try {
      await c.mutation("projects:deleteProject", { projectId: p._id });
      out.cleanup.deleted.push(p._id);
    } catch (err) {
      out.cleanup.deleted.push(`${p._id}:FAILED:${err?.message ?? err}`);
    }
  }
  await delay(1200);
  out.cleanup.leftover = (await c.query("projects:listProjects", {})).filter((p) => p.title.startsWith("AUDIT-QA8-")).map((p) => p._id);
  out.checks = checks;
  writeEvidence("31-cross-trade", out);
  writeJson("fix4-qa8-31-cross-trade.json", out);
  const failed = checks.filter((k) => !k.ok);
  console.log(`\nQA8-31 done. checks=${checks.length} failed=${failed.length} cleanupLeftover=${out.cleanup.leftover.length}`);
  for (const f of failed) console.log(`  FAIL ${f.id} ${f.label}: observed=${f.observed}`);
}