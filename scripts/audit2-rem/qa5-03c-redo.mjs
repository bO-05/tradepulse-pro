import { delay, q, openApp, shot, writeJson, clickTab, selectProject, selectPackageCard } from "./qa5-common.mjs";
import fs from "node:fs";

const FIX = JSON.parse(fs.readFileSync("evidence/fix4-qa5-fixture.json", "utf8"));
const PROJECT_ID = FIX.projectId;
const concretePkg = FIX.state.packages.find((p) => p.csiDivision === "03 30 00");
const c1Name = "QA5 Concrete Partners LLC";
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

async function captureToast(page, fragments, timeout = 9000) {
  const t0 = Date.now();
  const seen = [];
  while (Date.now() - t0 < timeout) {
    const toast = await page.evaluate(() => {
      const el = document.querySelector('[role="status"][aria-live="polite"]');
      return el ? el.textContent.trim() : null;
    });
    if (toast && !seen.includes(toast)) seen.push(toast);
    if (toast && fragments.some((f) => toast.includes(f))) return { found: toast, seen, ms: Date.now() - t0 };
    await delay(120);
  }
  return { found: null, seen };
}

async function clickConfirm(page, dialogText, confirmLabel) {
  for (let i = 0; i < 24; i++) {
    const b = await page.evaluate(
      (dt, cl) => {
        const d = [...document.querySelectorAll('[role="alertdialog"]')].pop();
        if (d && d.textContent.includes(dt)) {
          const btn = [...d.querySelectorAll("button")].find((x) => (x.textContent || "").trim() === cl);
          if (btn) {
            const r = btn.getBoundingClientRect();
            return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
          }
        }
        return null;
      },
      dialogText,
      confirmLabel
    );
    if (b) {
      await page.mouse.click(b.x, b.y);
      return true;
    }
    await delay(250);
  }
  return false;
}

const bidSnapshot = async () =>
  (await q("bids:listByPackage", { tradePackageId: concretePkg._id })).map((b) => ({ id: b._id, name: b.subcontractorName, awarded: b.isAwarded }));
const agreementSnapshot = async () =>
  (await q("agreements:listAgreements", { projectId: PROJECT_ID }))
    .filter((a) => a.tradePackageId === concretePkg._id)
    .map((a) => ({ id: a._id, status: a.status, sum: a.contractSum, number: a.agreementNumber }));

const run = async () => {
  const { browser, page } = await openApp();
  try {
    await selectProject(page, PROJECT_ID);
    await clickTab(page, "01:");
    await selectPackageCard(page, concretePkg.tradeName);
    await clickTab(page, "04:");
    await delay(1500);

    OUT.before = { bids: await bidSnapshot(), agreements: await agreementSnapshot() };

    // (a) award a different bid after an executed agreement exists
    const a = await cardButtonBox(page, "QA5 Solid Structures Inc.", { text: "Award" });
    OUT.a_click = a;
    if (a) {
      await page.mouse.click(a.x, a.y);
      await delay(400);
      await shot(page, "fix4-qa5-item1-a-award-other.png");
      OUT.a_toast = await captureToast(page, ["Award failed"], 12000);
    }
    OUT.a_after = { bids: await bidSnapshot(), agreements: await agreementSnapshot() };

    // dismiss any dialog accidentally opened
    await page.keyboard.press("Escape");
    await delay(400);

    // (b) unaward executed bid
    const b = await cardButtonBox(page, c1Name, { text: "Unaward" });
    OUT.b_click = b;
    if (b) {
      await page.mouse.click(b.x, b.y);
      OUT.b_dialog = await clickConfirm(page, "Unaward proposal", "Unaward proposal");
      await shot(page, "fix4-qa5-item1-b-unaward.png");
      OUT.b_toast = await captureToast(page, ["Unaward failed"], 12000);
    }
    OUT.b_after = { bids: await bidSnapshot(), agreements: await agreementSnapshot() };

    // (c) delete executed bid
    const c = await cardButtonBox(page, c1Name, { title: "Delete proposal" });
    OUT.c_click = c;
    if (c) {
      await page.mouse.click(c.x, c.y);
      OUT.c_dialog = await clickConfirm(page, "Delete proposal", "Delete proposal");
      await shot(page, "fix4-qa5-item1-c-delete-bid.png");
      OUT.c_toast = await captureToast(page, ["Delete failed"], 12000);
    }
    OUT.c_after = { bids: await bidSnapshot(), agreements: await agreementSnapshot() };

    OUT.executedIntact = (await agreementSnapshot()).some((x) => x.status === "executed");
    writeJson("fix4-qa5-item1-refusals-abc.json", OUT);
    console.log(JSON.stringify(OUT, null, 2));
  } catch (e) {
    OUT.error = String(e && e.stack ? e.stack : e);
    writeJson("fix4-qa5-item1-refusals-abc.json", OUT);
    console.error(OUT.error);
  } finally {
    await browser.close();
  }
};
run();