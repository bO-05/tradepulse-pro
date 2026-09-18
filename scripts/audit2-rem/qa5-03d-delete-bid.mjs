import { delay, q, openApp, shot, writeJson, clickTab, selectProject, selectPackageCard } from "./qa5-common.mjs";
import fs from "node:fs";

const FIX = JSON.parse(fs.readFileSync("evidence/fix4-qa5-fixture.json", "utf8"));
const PROJECT_ID = FIX.projectId;
const concretePkg = FIX.state.packages.find((p) => p.csiDivision === "03 30 00");
const c1Name = "QA5 Concrete Partners LLC";
const OUT = { startedAt: new Date().toISOString() };

const run = async () => {
  const { browser, page } = await openApp();
  try {
    await selectProject(page, PROJECT_ID);
    await clickTab(page, "01:");
    await selectPackageCard(page, concretePkg.tradeName);
    await clickTab(page, "04:");
    await delay(1500);

    const c = await page.evaluate((name) => {
      const h = [...document.querySelectorAll("h3")].find((x) => (x.textContent || "").trim().includes(name));
      if (!h) return null;
      let root = h.closest(".rounded-xl") || h.parentElement;
      for (let i = 0; i < 5 && root; i++) {
        const btn = [...root.querySelectorAll("button")].find((b) => (b.getAttribute("title") || "") === "Delete proposal");
        if (btn) {
          btn.scrollIntoView({ block: "center" });
          const r = btn.getBoundingClientRect();
          return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        }
        root = root.parentElement;
      }
      return null;
    }, c1Name);
    OUT.c_click = c;
    await page.mouse.click(c.x, c.y);
    await delay(600);
    OUT.dialogText = await page.evaluate(() => {
      const d = [...document.querySelectorAll('[role="alertdialog"]')].pop();
      return d ? d.textContent.replace(/\s+/g, " ").trim().slice(0, 300) : null;
    });
    const confirm = await page.evaluate(() => {
      const d = [...document.querySelectorAll('[role="alertdialog"]')].pop();
      if (!d) return null;
      const btn = [...d.querySelectorAll("button")].find((x) => (x.textContent || "").trim() === "Delete proposal");
      if (!btn) return null;
      const r = btn.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    OUT.c_dialog = Boolean(confirm);
    if (confirm) await page.mouse.click(confirm.x, confirm.y);
    let toast = null;
    for (let i = 0; i < 80; i++) {
      await delay(120);
      const t = await page.evaluate(() => {
        const el = document.querySelector('[role="status"][aria-live="polite"]');
        return el ? el.textContent.trim() : null;
      });
      if (t && t.includes("Delete failed")) {
        toast = t;
        break;
      }
    }
    OUT.c_toast = toast;
    await shot(page, "fix4-qa5-item1-c-delete-bid.png");
    OUT.after = {
      bids: (await q("bids:listByPackage", { tradePackageId: concretePkg._id })).map((b) => ({ id: b._id, name: b.subcontractorName, awarded: b.isAwarded })),
      agreements: (await q("agreements:listAgreements", { projectId: PROJECT_ID }))
        .filter((a) => a.tradePackageId === concretePkg._id)
        .map((a) => ({ id: a._id, status: a.status })),
    };
    writeJson("fix4-qa5-item1-c-delete-bid.json", OUT);
    console.log(JSON.stringify(OUT, null, 2));
  } catch (e) {
    OUT.error = String(e && e.stack ? e.stack : e);
    writeJson("fix4-qa5-item1-c-delete-bid.json", OUT);
    console.error(OUT.error);
  } finally {
    await browser.close();
  }
};
run();