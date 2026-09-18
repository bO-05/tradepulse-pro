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
    const executed = (await q("agreements:listAgreements", { projectId: PROJECT_ID })).find(
      (a) => a.tradePackageId === concretePkg._id && a.status === "executed"
    );
    const lines = executed.contractText.split("\n").filter((l) => /AIA|official|licensed/i.test(l));
    OUT.aiaLines = lines;
    OUT.positiveClaimScan = lines.filter((l) => /(^|[^t])\bis an official AIA|official AIA form(?! )|licensed AIA form(?! )/.test(l) && !/not an official|not an AIA-licensed|not a licensed AIA/.test(l));

    await selectProject(page, PROJECT_ID);
    await clickTab(page, "01:");
    await selectPackageCard(page, concretePkg.tradeName);
    await clickTab(page, "04:");
    await delay(1500);
    const inspect = await page.evaluate((name) => {
      const h = [...document.querySelectorAll("h3")].find((x) => (x.textContent || "").trim().includes(name));
      let root = h?.closest(".rounded-xl") || h?.parentElement;
      for (let i = 0; i < 5 && root; i++) {
        const btn = [...root.querySelectorAll("button")].find((b) => (b.textContent || "").includes("Inspect Draft"));
        if (btn) {
          btn.scrollIntoView({ block: "center" });
          const r = btn.getBoundingClientRect();
          return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        }
        root = root.parentElement;
      }
      return null;
    }, c1Name);
    if (inspect) {
      await page.mouse.click(inspect.x, inspect.y);
      await delay(2500);
      OUT.viewer = await page.evaluate(() => {
        const body = document.body.innerText;
        const pre = document.querySelector("pre");
        return {
          executedBanner: body.includes("Execution recorded in TradePulse") || body.includes("RECORDED • SIGNATURE REQUIRED"),
          footerNotLicensed: body.includes("not an AIA-licensed form"),
          hasNotice: body.includes("not an official AIA document"),
          preLen: pre ? pre.innerText.length : 0,
        };
      });
      await shot(page, "fix4-qa5-item4-agreement-viewer.png");
    } else {
      OUT.viewer = { error: "Inspect Draft not found" };
    }
    writeJson("fix4-qa5-item4-probe.json", OUT);
    console.log(JSON.stringify(OUT, null, 2));
  } catch (e) {
    OUT.error = String(e && e.stack ? e.stack : e);
    writeJson("fix4-qa5-item4-probe.json", OUT);
    console.error(OUT.error);
  } finally {
    await browser.close();
  }
};
run();