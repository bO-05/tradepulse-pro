import { delay, q, http, openApp, shot, writeJson, clickTab, selectProject, selectPackageCard, parseCsv } from "./qa5-common.mjs";
import fs from "node:fs";

const FIX = JSON.parse(fs.readFileSync("evidence/fix4-qa5-fixture.json", "utf8"));
const PROJECT_ID = FIX.projectId;
const concretePkg = FIX.state.packages.find((p) => p.csiDivision === "03 30 00");
const plumbingPkg = FIX.state.packages.find((p) => p.csiDivision === "22 00 00");
const c1 = FIX.state.contractors.find((c) => c.companyName === "QA5 Concrete Partners LLC");
const c3 = FIX.state.contractors.find((c) => c.companyName === "QA5 Flow Systems LLC");
const c4 = FIX.state.contractors.find((c) => c.companyName === "QA5 Pipeworks Group Inc.");
const OUT = { startedAt: new Date().toISOString() };

async function captureToast(page, fragments, timeout = 9000) {
  const t0 = Date.now();
  const seen = [];
  while (Date.now() - t0 < timeout) {
    const toast = await page.evaluate(() => {
      const el = document.querySelector('[role="status"][aria-live="polite"]');
      return el ? el.textContent.trim() : null;
    });
    if (toast && !seen.includes(toast)) seen.push(toast);
    if (toast && fragments.some((f) => toast.includes(f))) return { found: toast, seen };
    await delay(120);
  }
  return { found: null, seen };
}

async function cardButtonBox(page, cardName, spec) {
  return page.evaluate(
    (name, s) => {
      const h = [...document.querySelectorAll("h3")].find((x) => (x.textContent || "").trim().includes(name));
      if (!h) return null;
      let root = h.closest(".rounded-xl") || h.parentElement;
      for (let i = 0; i < 5 && root; i++) {
        const btns = [...root.querySelectorAll("button")];
        const match = btns.find((b) => {
          const t = (b.textContent || "").trim();
          const title = b.getAttribute("title") || "";
          return s.text ? t.includes(s.text) : title.includes(s.title);
        });
        if (match) {
          match.scrollIntoView({ block: "center" });
          const r = match.getBoundingClientRect();
          return { x: r.left + r.width / 2, y: r.top + r.height / 2, label: (match.textContent || match.getAttribute("title") || "").trim() };
        }
        root = root.parentElement;
      }
      return null;
    },
    cardName,
    spec
  );
}

const run = async () => {
  const { browser, page } = await openApp();
  try {
    // ---------- updateBidAdjustments guard messages via ConvexError.data
    const concreteBids = await q("bids:listByPackage", { tradePackageId: concretePkg._id });
    const c1Bid = concreteBids.find((b) => b.contractorId === c1._id);
    OUT.adjustGuards = {};
    const guard = async (label, args) => {
      try {
        await http.mutation("bids:updateBidAdjustments", args);
        OUT.adjustGuards[label] = { threw: false };
      } catch (e) {
        OUT.adjustGuards[label] = { threw: true, data: e.data ?? null, message: String(e.message || e).slice(0, 160) };
      }
    };
    await guard("negativeImpact", { bidId: c1Bid._id, identifiedExclusions: [{ description: "QA5 neg", costImpact: -5, severity: "minor" }] });
    await guard("badCoi", { bidId: c1Bid._id, identifiedExclusions: [], coiComplianceStatus: "bogus" });
    await guard("executedLock", { bidId: c1Bid._id, identifiedExclusions: [{ description: "QA5 exec probe", costImpact: 12345, severity: "moderate" }] });
    const afterProbe = (await q("bids:listByPackage", { tradePackageId: concretePkg._id })).find((b) => b.contractorId === c1._id);
    OUT.adjustGuards.rollbackIntact =
      afterProbe.leveledTotalCost === c1Bid.leveledTotalCost &&
      JSON.stringify(afterProbe.identifiedExclusions) === JSON.stringify(c1Bid.identifiedExclusions);

    // ---------- Normal contractor deletion (fresh contractor, no bids/conversations)
    const freshContractorId = await http.mutation("contractors:createContractor", {
      tradePackageId: plumbingPkg._id,
      companyName: "QA5 Cleanup Target LLC",
      contactEmail: "bids@qa5cleanup.example",
      licenseNumber: "QA5-LIC-7777",
      licenseStatus: "Active & Verified",
      sourceUrl: "https://qa5cleanup.example.com",
      rfqStatus: "discovered",
    });
    OUT.normalContractorDelete = { contractorId: freshContractorId };

    // ---------- Setup plumbing bids and award/unaward regression
    const c3BidId = await http.mutation("bids:submitDirectBid", {
      tradePackageId: plumbingPkg._id,
      contractorId: c3._id,
      subcontractorName: c3.companyName,
      baseBidAmount: 735000,
      longLeadEquipmentWeeks: 9,
    });
    const c4BidId = await http.mutation("bids:submitDirectBid", {
      tradePackageId: plumbingPkg._id,
      contractorId: c4._id,
      subcontractorName: c4.companyName,
      baseBidAmount: 762000,
      longLeadEquipmentWeeks: 12,
    });
    OUT.plumbingSetup = { c3BidId, c4BidId };

    await selectProject(page, PROJECT_ID);
    await clickTab(page, "01:");
    await selectPackageCard(page, plumbingPkg.tradeName);
    await clickTab(page, "02:");
    await delay(1200);

    const cDelete = await page.evaluate(() => {
      const h = [...document.querySelectorAll("h4")].find((x) => (x.textContent || "").trim() === "QA5 Cleanup Target LLC");
      if (!h) return null;
      const row = h.closest(".p-4") || h.parentElement.parentElement.parentElement;
      const btn = [...row.querySelectorAll("button")].find((b) => (b.getAttribute("title") || "") === "Delete contractor");
      if (!btn) return null;
      btn.scrollIntoView({ block: "center" });
      const r = btn.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    OUT.normalContractorDelete.deleteButton = Boolean(cDelete);
    if (cDelete) {
      await page.mouse.click(cDelete.x, cDelete.y);
      await delay(500);
      const confirm = await page.evaluate(() => {
        const d = [...document.querySelectorAll('[role="alertdialog"]')].pop();
        if (!d) return null;
        const btn = [...d.querySelectorAll("button")].find((x) => (x.textContent || "").trim() === "Remove contractor");
        if (!btn) return null;
        const r = btn.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      });
      OUT.normalContractorDelete.dialog = Boolean(confirm);
      if (confirm) await page.mouse.click(confirm.x, confirm.y);
      OUT.normalContractorDelete.toast = await captureToast(page, ["Contractor removed", "removal failed"], 9000);
      await delay(1000);
      OUT.normalContractorDelete.thatIdGone = !(await q("contractors:listByPackage", { tradePackageId: plumbingPkg._id })).some(
        (c) => c._id === freshContractorId
      );
      await shot(page, "fix4-qa5-item7-normal-contractor-delete.png");
    }

    // ---------- Normal award then unaward (generated, not executed)
    await clickTab(page, "04:");
    await delay(1500);
    const award = await cardButtonBox(page, c3.companyName, { text: "Award" });
    OUT.normalUnaward = { awardButton: award };
    if (award) {
      await page.mouse.click(award.x, award.y);
      let agr = null;
      for (let i = 0; i < 50; i++) {
        await delay(1000);
        const agrs = await q("agreements:listAgreements", { projectId: PROJECT_ID });
        agr = agrs.find((a) => a.tradePackageId === plumbingPkg._id && a.bidId === c3BidId);
        if (agr) break;
      }
      OUT.normalUnaward.generated = agr ? { id: agr._id, status: agr.status, number: agr.agreementNumber } : null;
      // close the viewer so the card action buttons are clickable
      await page.evaluate(() => {
        const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").trim() === "Close Viewer");
        b?.click();
      });
      await delay(800);
      const unaward = await cardButtonBox(page, c3.companyName, { text: "Unaward" });
      OUT.normalUnaward.unawardButton = unaward;
      if (unaward) {
        await page.mouse.click(unaward.x, unaward.y);
        await delay(500);
        const confirm = await page.evaluate(() => {
          const d = [...document.querySelectorAll('[role="alertdialog"]')].pop();
          if (!d) return null;
          const btn = [...d.querySelectorAll("button")].find((x) => (x.textContent || "").trim() === "Unaward proposal");
          if (!btn) return null;
          const r = btn.getBoundingClientRect();
          return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        });
        OUT.normalUnaward.dialog = Boolean(confirm);
        if (confirm) await page.mouse.click(confirm.x, confirm.y);
        OUT.normalUnaward.toast = await captureToast(page, ["Contract unawarded", "Unaward failed"], 9000);
        await delay(1200);
        OUT.normalUnaward.after = {
          c3Awarded: (await q("bids:listByPackage", { tradePackageId: plumbingPkg._id })).find((b) => b._id === c3BidId)?.isAwarded,
          agreementStatus: (await q("agreements:listAgreements", { projectId: PROJECT_ID })).find((a) => a.bidId === c3BidId)?.status,
          packageStatus: (await q("tradePackages:getPackage", { tradePackageId: plumbingPkg._id })).status,
        };
        await shot(page, "fix4-qa5-item7-normal-unaward.png");
      }
    }

    // ---------- Normal CSV export parses
    await page.evaluate(() => {
      const orig = URL.createObjectURL.bind(URL);
      window.__qa5Blobs2 = [];
      URL.createObjectURL = (blob) => {
        window.__qa5Blobs2.push(blob);
        return orig(blob);
      };
    });
    const exportClick = await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").includes("Export Leveling CSV"));
      if (!b) return null;
      b.scrollIntoView({ block: "center" });
      const r = b.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    OUT.normalCsv = { exportButton: Boolean(exportClick) };
    if (exportClick) {
      await page.mouse.click(exportClick.x, exportClick.y);
      await delay(1200);
      const csvText = await page.evaluate(async () => {
        const blobs = window.__qa5Blobs2 || [];
        if (!blobs.length) return null;
        return await blobs[blobs.length - 1].text();
      });
      if (csvText) {
        fs.writeFileSync("evidence/fix4-qa5-item5-normal-leveling.csv", csvText, "utf8");
        const rows = parseCsv(csvText);
        OUT.normalCsv.rows = rows.length;
        OUT.normalCsv.allConsistent = rows.every((r) => r.length === rows[0].length);
        OUT.normalCsv.headerCols = rows[0].length;
        OUT.normalCsv.dataRows = rows.slice(1).map((r) => ({ name: r[1], base: r[4], status: r[15] }));
      }
      await shot(page, "fix4-qa5-item5-normal-csv.png");
    }

    // ---------- Revision badge still rendered on concrete leveling page
    await clickTab(page, "01:");
    await selectPackageCard(page, concretePkg.tradeName);
    await clickTab(page, "04:");
    await delay(1500);
    OUT.revisionBadge = {
      rev2Shown: await page.evaluate(() => document.body.innerText.includes("Rev 2")),
      sourceFileBadgeShown: await page.evaluate(() => document.body.innerText.includes("source file")),
    };

    writeJson("fix4-qa5-item7-regressions.json", OUT);
    console.log(JSON.stringify(OUT, null, 2));
  } catch (e) {
    OUT.error = String(e && e.stack ? e.stack : e);
    writeJson("fix4-qa5-item7-regressions.json", OUT);
    console.error(OUT.error);
  } finally {
    await browser.close();
  }
};
run();