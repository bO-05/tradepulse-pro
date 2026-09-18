import { delay, q, http, openApp, shot, writeJson, clickText, clickTab, selectProject, selectPackageCard } from "./qa5-common.mjs";
import fs from "node:fs";

const FIX = JSON.parse(fs.readFileSync("evidence/fix4-qa5-fixture.json", "utf8"));
const PROJECT_ID = FIX.projectId;
const concretePkg = FIX.state.packages.find((p) => p.csiDivision === "03 30 00");
const c1 = FIX.state.contractors.find((c) => c.companyName === "QA5 Concrete Partners LLC");

const OUT = { startedAt: new Date().toISOString() };

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

async function captureToast(page, fragments, timeout = 7000) {
  const t0 = Date.now();
  const seen = [];
  while (Date.now() - t0 < timeout) {
    const toast = await page.evaluate(() => {
      const el = document.querySelector('[role="status"][aria-live="polite"]');
      return el ? el.textContent.trim() : null;
    });
    if (toast && !seen.includes(toast)) seen.push(toast);
    if (toast && fragments.some((f) => toast.includes(f))) return { found: toast, seen };
    await delay(150);
  }
  return { found: null, seen };
}

const run = async () => {
  const { browser, page } = await openApp();
  try {
    await selectProject(page, PROJECT_ID);
    await clickTab(page, "01:");
    await selectPackageCard(page, concretePkg.tradeName);
    await clickTab(page, "04:");
    await delay(1500);

    // ---------- Award C1 + execute
    const awardBox = await cardButtonBox(page, c1.companyName, { text: "Award" });
    OUT.awardClick = awardBox;
    if (!awardBox) throw new Error("C1 Award & Draft button not found");
    await page.mouse.click(awardBox.x, awardBox.y);

    let agreement = null;
    for (let i = 0; i < 60; i++) {
      await delay(1200);
      const agrs = await q("agreements:listAgreements", { projectId: PROJECT_ID });
      agreement = agrs.find((a) => a.tradePackageId === concretePkg._id && a.subcontractorName === c1.companyName && a.status !== "superseded");
      if (agreement) break;
    }
    OUT.generatedAgreement = agreement
      ? { id: agreement._id, number: agreement.agreementNumber, status: agreement.status, sum: agreement.contractSum }
      : null;
    if (!agreement) throw new Error("agreement was not generated");

    const execBox = await clickText(page, "Record External Execution");
    OUT.executeClick = execBox;
    const dlg1 = await (async () => {
      for (let i = 0; i < 20; i++) {
        const ok = await page.evaluate(() => {
          const d = [...document.querySelectorAll('[role="alertdialog"]')].pop();
          if (d && d.textContent.includes("Record external execution")) {
            const b = [...d.querySelectorAll("button")].find((x) => (x.textContent || "").trim() === "Record execution");
            if (b) {
              const r = b.getBoundingClientRect();
              return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
            }
          }
          return null;
        });
        if (ok) return ok;
        await delay(250);
      }
      return null;
    })();
    OUT.executeDialogFound = Boolean(dlg1);
    await page.mouse.click(dlg1.x, dlg1.y);
    let executed = null;
    for (let i = 0; i < 40; i++) {
      await delay(1000);
      executed = await q("agreements:getAgreementByBid", { bidId: agreement.bidId });
      if (executed?.status === "executed") break;
    }
    OUT.executed = executed ? { id: executed._id, status: executed.status, number: executed.agreementNumber } : null;
    await shot(page, "fix4-qa5-item1-executed.png");

    const bidSnapshot = async () => {
      const bids = await q("bids:listByPackage", { tradePackageId: concretePkg._id });
      return bids.map((b) => ({ id: b._id, name: b.subcontractorName, awarded: b.isAwarded, rev: b.revisionNumber }));
    };
    const agreementSnapshot = async () => {
      const agrs = await q("agreements:listAgreements", { projectId: PROJECT_ID });
      return agrs
        .filter((a) => a.tradePackageId === concretePkg._id)
        .map((a) => ({ id: a._id, status: a.status, number: a.agreementNumber, bidId: a.bidId, sum: a.contractSum }));
    };
    OUT.beforeAttempts = { bids: await bidSnapshot(), agreements: await agreementSnapshot(), packageStatus: (await q("tradePackages:getPackage", { tradePackageId: concretePkg._id })).status };

    // ---------- (a) award a different bid must be refused with visible explanation
    const otherAward = await cardButtonBox(page, "QA5 Solid Structures Inc.", { text: "Award" });
    OUT.attemptA_click = otherAward;
    if (otherAward) {
      await page.mouse.click(otherAward.x, otherAward.y);
      OUT.attemptA = await captureToast(page, ["Award failed"], 8000);
    } else {
      OUT.attemptA = { found: null, error: "award button not found" };
    }
    await shot(page, "fix4-qa5-item1-a-award-other.png");
    OUT.afterA = { bids: await bidSnapshot(), agreements: await agreementSnapshot() };

    // ---------- (b) unaward executed bid
    const unawardBox = await cardButtonBox(page, c1.companyName, { text: "Unaward" });
    OUT.attemptB_click = unawardBox;
    if (unawardBox) {
      await page.mouse.click(unawardBox.x, unawardBox.y);
      const confirmB = await (async () => {
        for (let i = 0; i < 20; i++) {
          const b = await page.evaluate(() => {
            const d = [...document.querySelectorAll('[role="alertdialog"]')].pop();
            if (d && d.textContent.includes("Unaward proposal")) {
              const btn = [...d.querySelectorAll("button")].find((x) => (x.textContent || "").trim() === "Unaward proposal");
              if (btn) {
                const r = btn.getBoundingClientRect();
                return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
              }
            }
            return null;
          });
          if (b) return b;
          await delay(250);
        }
        return null;
      })();
      OUT.attemptB_dialog = Boolean(confirmB);
      if (confirmB) await page.mouse.click(confirmB.x, confirmB.y);
      OUT.attemptB = await captureToast(page, ["Unaward failed"], 8000);
    } else {
      OUT.attemptB = { found: null, error: "unaward button not found" };
    }
    await shot(page, "fix4-qa5-item1-b-unaward.png");
    OUT.afterB = { bids: await bidSnapshot(), agreements: await agreementSnapshot() };

    // ---------- (c) delete executed bid
    const delBox = await cardButtonBox(page, c1.companyName, { title: "Delete proposal" });
    OUT.attemptC_click = delBox;
    if (delBox) {
      await page.mouse.click(delBox.x, delBox.y);
      const confirmC = await (async () => {
        for (let i = 0; i < 20; i++) {
          const b = await page.evaluate(() => {
            const d = [...document.querySelectorAll('[role="alertdialog"]')].pop();
            if (d && d.textContent.includes("Delete proposal")) {
              const btn = [...d.querySelectorAll("button")].find((x) => (x.textContent || "").trim() === "Delete proposal");
              if (btn) {
                const r = btn.getBoundingClientRect();
                return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
              }
            }
            return null;
          });
          if (b) return b;
          await delay(250);
        }
        return null;
      })();
      OUT.attemptC_dialog = Boolean(confirmC);
      if (confirmC) await page.mouse.click(confirmC.x, confirmC.y);
      OUT.attemptC = await captureToast(page, ["Delete failed"], 8000);
    } else {
      OUT.attemptC = { found: null, error: "delete button not found" };
    }
    await shot(page, "fix4-qa5-item1-c-delete-bid.png");
    OUT.afterC = { bids: await bidSnapshot(), agreements: await agreementSnapshot() };

    // ---------- (d) delete package containing executed contract
    await clickTab(page, "01:");
    await delay(1200);
    const pkgDel = await page.evaluate((name) => {
      const h = [...document.querySelectorAll("h3")].find((x) => (x.textContent || "").trim().includes(name));
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
    }, concretePkg.tradeName);
    OUT.attemptD_click = pkgDel;
    if (pkgDel) {
      await page.mouse.click(pkgDel.x, pkgDel.y);
      const dlg = await (async () => {
        for (let i = 0; i < 20; i++) {
          const b = await page.evaluate(() => {
            const d = [...document.querySelectorAll('[role="alertdialog"]')].pop();
            if (d && d.textContent.includes("Delete trade package")) {
              const btn = [...d.querySelectorAll("button")].find((x) => (x.textContent || "").trim() === "Delete package");
              if (btn) {
                const r = btn.getBoundingClientRect();
                return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
              }
            }
            return null;
          });
          if (b) return b;
          await delay(250);
        }
        return null;
      })();
      OUT.attemptD_dialog = Boolean(dlg);
      if (dlg) await page.mouse.click(dlg.x, dlg.y);
      OUT.attemptD = await captureToast(page, ["Error deleting trade package"], 9000);
    } else {
      OUT.attemptD = { found: null, error: "package delete not found" };
    }
    await shot(page, "fix4-qa5-item1-d-delete-package.png");
    OUT.afterD = {
      packages: (await q("tradePackages:listByProject", { projectId: PROJECT_ID })).map((p) => ({ csi: p.csiDivision, id: p._id })),
      agreements: await agreementSnapshot(),
    };

    // ---------- (e) delete contractor with executed subcontract (Discovery)
    await clickTab(page, "02:");
    await delay(1200);
    const cDel = await page.evaluate((name) => {
      const els = [...document.querySelectorAll("h3,h4,div")];
      const h = els.find((x) => (x.textContent || "").trim() === name && x.children.length === 0);
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
    }, c1.companyName);
    OUT.attemptE_click = cDel;
    if (cDel) {
      await page.mouse.click(cDel.x, cDel.y);
      const dlg = await (async () => {
        for (let i = 0; i < 20; i++) {
          const b = await page.evaluate(() => {
            const d = [...document.querySelectorAll('[role="alertdialog"]')].pop();
            if (d && d.textContent.includes("Remove contractor")) {
              const btn = [...d.querySelectorAll("button")].find((x) => (x.textContent || "").trim() === "Remove contractor");
              if (btn) {
                const r = btn.getBoundingClientRect();
                return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
              }
            }
            return null;
          });
          if (b) return b;
          await delay(250);
        }
        return null;
      })();
      OUT.attemptE_dialog = Boolean(dlg);
      if (dlg) await page.mouse.click(dlg.x, dlg.y);
      OUT.attemptE = await captureToast(page, ["Contractor removal failed"], 8000);
      await delay(800);
      OUT.attemptE_banner = await page.evaluate(() => {
        const el = [...document.querySelectorAll('[role="alert"]')].map((x) => x.textContent.trim()).filter((t) => t.includes("could not be removed") || t.includes("executed subcontract"));
        return el;
      });
    } else {
      OUT.attemptE = { found: null, error: "contractor delete not found" };
    }
    await shot(page, "fix4-qa5-item1-e-delete-contractor.png");

    OUT.final = {
      bids: await bidSnapshot(),
      agreements: await agreementSnapshot(),
      contractors: (await q("contractors:listByPackage", { tradePackageId: concretePkg._id })).map((c) => ({ id: c._id, name: c.companyName })),
      packageStatus: (await q("tradePackages:getPackage", { tradePackageId: concretePkg._id })).status,
    };
    OUT.executedIntact =
      OUT.final.agreements.some((a) => a.status === "executed" && a.id === OUT.executed?.id) &&
      OUT.final.bids.find((b) => b.name === c1.companyName)?.awarded === true;
    writeJson("fix4-qa5-item1-immutability.json", OUT);
    console.log(JSON.stringify(OUT, null, 2).slice(0, 8000));
  } catch (e) {
    OUT.error = String(e && e.stack ? e.stack : e);
    writeJson("fix4-qa5-item1-immutability.json", OUT);
    console.error("ERROR", OUT.error);
  } finally {
    await browser.close();
  }
};
run();