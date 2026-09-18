import { delay, openApp, selectProject, selectPackageCard, clickTab } from "./qa5-common.mjs";
import fs from "node:fs";
const FIX = JSON.parse(fs.readFileSync("evidence/fix4-qa5-fixture.json", "utf8"));
const concretePkg = FIX.state.packages.find((p) => p.csiDivision === "03 30 00");
const run = async () => {
  const { browser, page } = await openApp();
  try {
    await selectProject(page, FIX.projectId);
    await clickTab(page, "01:");
    await delay(500);
    await selectPackageCard(page, concretePkg.tradeName);
    await clickTab(page, "04:");
    await delay(2500);
    const info = await page.evaluate(() => {
      const h3s = [...document.querySelectorAll("h3")].map((h) => h.textContent.trim()).slice(0, 40);
      const buttons = [...document.querySelectorAll("button")].map((b) => ({
        t: (b.textContent || "").trim().replace(/\s+/g, " ").slice(0, 50),
        title: b.getAttribute("title"),
      })).filter((b) => b.t || b.title).slice(0, 80);
      return { h3s, buttons, bodyHead: document.body.innerText.slice(0, 1500) };
    });
    console.log(JSON.stringify(info, null, 2).slice(0, 6000));
  } finally {
    await browser.close();
  }
};
run();