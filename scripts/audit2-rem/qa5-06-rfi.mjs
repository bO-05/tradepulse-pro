import { delay, q, http, openApp, shot, writeJson, clickTab, selectProject, selectPackageCard } from "./qa5-common.mjs";
import fs from "node:fs";

const FIX = JSON.parse(fs.readFileSync("evidence/fix4-qa5-fixture.json", "utf8"));
const PROJECT_ID = FIX.projectId;
const hvacPkg = FIX.state.packages.find((p) => p.csiDivision === "23 00 00");
const c6 = FIX.state.contractors.find((c) => c.companyName === "QA5 Thermal Works LLC");
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

const run = async () => {
  const { browser, page } = await openApp();
  try {
    await selectProject(page, PROJECT_ID);
    await clickTab(page, "01:");
    await selectPackageCard(page, hvacPkg.tradeName);
    await clickTab(page, "03:");
    await delay(1200);

    OUT.freshPackage = {
      routingShown: await page.evaluate(() => document.body.innerText.includes("Routing to: CSI 23 00 00")),
      existingRfis: (await q("rfq:listConversations", { tradePackageId: hvacPkg._id })).length,
      existingBids: (await q("bids:listByPackage", { tradePackageId: hvacPkg._id })).length,
    };

    const subject = "QA5 RFI temporary power responsibility";
    const question =
      "Does Division 23 carry the temporary power distribution board for the rooftop units, or is it a GC-furnished item?";
    await page.evaluate(
      (s, qu) => {
        const setVal = (el, val) => {
          const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
          const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
          setter.call(el, val);
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
        };
        setVal(document.querySelector('[aria-label="RFI subject or scope topic"]'), s);
        setVal(document.querySelector('[aria-label="Subcontractor question"]'), qu);
      },
      subject,
      question
    );
    await delay(400);

    const t0 = Date.now();
    const submit = await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").includes("Submit RFI for Clarification"));
      b.scrollIntoView({ block: "center" });
      const r = b.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    await page.mouse.click(submit.x, submit.y);

    const timeline = [];
    let first = null;
    let final = null;
    for (let i = 0; i < 300; i++) {
      await delay(300);
      const convos = await q("rfq:listConversations", { tradePackageId: hvacPkg._id });
      const row = convos.find((c) => c.inboundSubject.includes("QA5 RFI temporary power"));
      if (row && !first) {
        first = { ms: Date.now() - t0, status: row.status };
        const pendingVisible = await page.evaluate(() => document.body.innerText.includes("RFI saved. The AI is analyzing"));
        OUT.pendingPanelVisible = pendingVisible;
        await shot(page, "fix4-qa5-item6-rfi-pending.png");
      }
      if (row && row.status !== "pending_analysis") {
        final = { ms: Date.now() - t0, status: row.status, replyLen: (row.autonomousReply || "").length, error: row.analysisError || null, questionPreserved: row.inboundQuestion.includes("temporary power distribution board") };
        break;
      }
      if (row && i % 10 === 0) timeline.push({ ms: Date.now() - t0, status: row.status });
      if (Date.now() - t0 > 150000) break;
    }
    OUT.item6 = { first, final, timelineHead: timeline.slice(0, 10) };
    await delay(1000);
    OUT.item6.cardRendered = await page.evaluate(() => document.body.innerText.includes("QA5 RFI temporary power"));
    await shot(page, "fix4-qa5-item6-rfi-final.png");

    const convos = await q("rfq:listConversations", { tradePackageId: hvacPkg._id });
    const rfiRow = convos.find((c) => c.inboundSubject.includes("QA5 RFI temporary power"));
    if (rfiRow) {
      const retryRes = await http.mutation("simulation:retryRfiAnalysis", { conversationId: rfiRow._id });
      OUT.item6.retryOnClarified = retryRes;
      OUT.item6.retryUiCodePath = fs
        .readFileSync("src/components/PreBidQnAView.tsx", "utf8")
        .includes("Retry analysis");
    }

    // ---------- updateBidAdjustments guarantees
    const c1 = FIX.state.contractors.find((c) => c.companyName === "QA5 Concrete Partners LLC");
    const c1Bid = (await q("bids:listByPackage", { tradePackageId: FIX.state.packages.find((p) => p.csiDivision === "03 30 00")._id })).find(
      (b) => b.contractorId === c1._id
    );
    const snapshot = { leveled: c1Bid.leveledTotalCost, lead: c1Bid.leadTimePenalty, coiStatus: c1Bid.coiComplianceStatus, exclusions: JSON.stringify(c1Bid.identifiedExclusions) };
    OUT.adjustGuards = {};
    try {
      await http.mutation("bids:updateBidAdjustments", {
        bidId: c1Bid._id,
        identifiedExclusions: [{ description: "QA5 negative", costImpact: -5, severity: "minor" }],
      });
      OUT.adjustGuards.negativeImpact = "NO ERROR (unexpected)";
    } catch (e) {
      OUT.adjustGuards.negativeImpact = String(e.message || e).slice(0, 220);
    }
    try {
      await http.mutation("bids:updateBidAdjustments", {
        bidId: c1Bid._id,
        identifiedExclusions: [],
        coiComplianceStatus: "bogus",
      });
      OUT.adjustGuards.badCoiStatus = "NO ERROR (unexpected)";
    } catch (e) {
      OUT.adjustGuards.badCoiStatus = String(e.message || e).slice(0, 220);
    }
    try {
      await http.mutation("bids:updateBidAdjustments", {
        bidId: c1Bid._id,
        identifiedExclusions: [{ description: "QA5 executed-lock probe", costImpact: 12345, severity: "moderate" }],
      });
      OUT.adjustGuards.executedLock = "NO ERROR (unexpected)";
    } catch (e) {
      OUT.adjustGuards.executedLock = String(e.message || e).slice(0, 220);
    }
    await delay(1200);
    const after = (await q("bids:listByPackage", { tradePackageId: FIX.state.packages.find((p) => p.csiDivision === "03 30 00")._id })).find(
      (b) => b.contractorId === c1._id
    );
    OUT.adjustGuards.rollbackIntact =
      after.leveledTotalCost === snapshot.leveled &&
      after.leadTimePenalty === snapshot.lead &&
      after.coiComplianceStatus === snapshot.coiStatus &&
      JSON.stringify(after.identifiedExclusions) === snapshot.exclusions;

    // ---------- Normal contractor deletion (no bids, no conversations)
    await clickTab(page, "02:");
    await delay(1200);
    const c6Delete = await page.evaluate((name) => {
      const h = [...document.querySelectorAll("h3,h4,div")].find((x) => x.children.length === 0 && (x.textContent || "").trim() === name);
      if (!h) return null;
      let root = h.closest(".rounded-xl") || h.parentElement;
      for (let i = 0; i < 6 && root; i++) {
        const btn = [...root.querySelectorAll("button")].find((b) => (b.getAttribute("title") || "") === "Delete contractor");
        if (btn) {
          btn.scrollIntoView({ block: "center" });
          const r = btn.getBoundingClientRect();
          return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        }
        root = root.parentElement;
      }
      return null;
    }, c6.companyName);
    OUT.normalContractorDelete = { found: Boolean(c6Delete) };
    if (c6Delete) {
      await page.mouse.click(c6Delete.x, c6Delete.y);
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
      OUT.normalContractorDelete.toast = await captureToast(page, ["Contractor removed", "removal failed"], 8000);
      await delay(1000);
      OUT.normalContractorDelete.stillExists = (await q("contractors:listByPackage", { tradePackageId: hvacPkg._id })).some(
        (c) => c._id === c6._id
      );
      await shot(page, "fix4-qa5-item7-normal-contractor-delete.png");
    }

    // ---------- Normal package deletion (no executed contract)
    await clickTab(page, "01:");
    await delay(1200);
    const pkgDelete = await page.evaluate((name) => {
      const h = [...document.querySelectorAll("h3")].find((x) => (x.textContent || "").trim() === name);
      if (!h) return null;
      let root = h.closest(".rounded-xl") || h.parentElement;
      for (let i = 0; i < 4 && root; i++) {
        const btn = [...root.querySelectorAll("button")].find((b) => (b.getAttribute("title") || "") === "Delete Trade Package");
        if (btn) {
          btn.scrollIntoView({ block: "center" });
          const r = btn.getBoundingClientRect();
          return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        }
        root = root.parentElement;
      }
      return null;
    }, hvacPkg.tradeName);
    OUT.normalPackageDelete = { found: Boolean(pkgDelete) };
    if (pkgDelete) {
      await page.mouse.click(pkgDelete.x, pkgDelete.y);
      await delay(500);
      const confirm = await page.evaluate(() => {
        const d = [...document.querySelectorAll('[role="alertdialog"]')].pop();
        if (!d) return null;
        const btn = [...d.querySelectorAll("button")].find((x) => (x.textContent || "").trim() === "Delete package");
        if (!btn) return null;
        const r = btn.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      });
      OUT.normalPackageDelete.dialog = Boolean(confirm);
      if (confirm) await page.mouse.click(confirm.x, confirm.y);
      OUT.normalPackageDelete.toast = await captureToast(page, ["Deleted trade package", "Error deleting"], 8000);
      await delay(1500);
      const pkgs = await q("tradePackages:listByProject", { projectId: PROJECT_ID });
      OUT.normalPackageDelete.packageGone = !pkgs.some((p) => p._id === hvacPkg._id);
      await shot(page, "fix4-qa5-item7-normal-package-delete.png");
    }

    writeJson("fix4-qa5-item6-item7.json", OUT);
    console.log(JSON.stringify(OUT, null, 2));
  } catch (e) {
    OUT.error = String(e && e.stack ? e.stack : e);
    writeJson("fix4-qa5-item6-item7.json", OUT);
    console.error(OUT.error);
  } finally {
    await browser.close();
  }
};
run();