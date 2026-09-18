import { delay, openApp, shot, writeJson, selectProject, selectPackageCard, clickTab, clickText } from "./qa5-common.mjs";
import fs from "node:fs";

const FIX = JSON.parse(fs.readFileSync("evidence/fix4-qa5-fixture.json", "utf8"));
const concretePkg = FIX.state.packages.find((p) => p.csiDivision === "03 30 00");
const OUT = { startedAt: new Date().toISOString() };

const run = async () => {
  const { browser, page } = await openApp();
  try {
    await page.goto("https://brainy-skunk-440.convex.site/?qa5tiny=1", { waitUntil: "domcontentloaded", timeout: 60000 });
    await delay(3000);
    await selectProject(page, FIX.projectId);
    await clickTab(page, "01:");
    await selectPackageCard(page, concretePkg.tradeName);
    await clickTab(page, "04:");
    await delay(1200);
    await clickText(page, "Ingest Quote / PDF");
    await delay(800);
    OUT.selectDefault = await page.evaluate(() => {
      const s = document.querySelector('select[aria-label="Subcontractor or bidder for this proposal"]');
      return s ? s.value : null;
    });
    const box = await page.evaluate(() => {
      const ta = document.querySelector('textarea[aria-label="Proposal OCR text or pasted quote"]');
      ta.scrollIntoView({ block: "center" });
      const r = ta.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    await page.mouse.click(box.x, box.y);
    await page.keyboard.type("Subcontractor: Re\nBase Bid Price: $100", { delay: 1 });
    await page.mouse.click(10, 10);
    await delay(700);
    OUT.afterTinyBlur = await page.evaluate(() => {
      const s = document.querySelector('select[aria-label="Subcontractor or bidder for this proposal"]');
      const nameInput = document.querySelector('input[aria-label="New subcontractor company name"]');
      return { selectValue: s?.value ?? null, newName: nameInput?.value ?? null };
    });
    await shot(page, "fix4-qa5-item2-tiny-fragment-probe.png");
    writeJson("fix4-qa5-item2-tiny-probe.json", OUT);
    console.log(JSON.stringify(OUT, null, 2));
  } catch (e) {
    OUT.error = String(e && e.stack ? e.stack : e);
    writeJson("fix4-qa5-item2-tiny-probe.json", OUT);
    console.error(OUT.error);
  } finally {
    await browser.close();
  }
};
run();