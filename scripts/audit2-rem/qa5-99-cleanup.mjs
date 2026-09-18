import { delay, q, openApp, shot, writeJson, selectProject, clickTab } from "./qa5-common.mjs";
import fs from "node:fs";

const FIX = JSON.parse(fs.readFileSync("evidence/fix4-qa5-fixture.json", "utf8"));
const TITLE = "AUDIT-QA5-VERIFY-2026-09-18";
const OUT = { startedAt: new Date().toISOString(), projectId: FIX.projectId };

const run = async () => {
  const { browser, page } = await openApp();
  try {
    await selectProject(page, FIX.projectId);
    await delay(1000);
    OUT.currentTitle = await page.evaluate(() => {
      const s = document.querySelector('select[aria-label="Select Commercial Construction Project"]');
      return s?.selectedOptions?.[0]?.textContent?.trim() || null;
    });
    if (!OUT.currentTitle?.includes(TITLE)) throw new Error("fixture project is not selected; refusing cleanup");

    const del = await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) => (x.getAttribute("title") || "") === "Delete custom project");
      if (!b) return null;
      const r = b.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    OUT.deleteButton = Boolean(del);
    if (del) {
      await page.mouse.click(del.x, del.y);
      await delay(600);
      const confirm = await page.evaluate(() => {
        const d = [...document.querySelectorAll('[role="alertdialog"]')].pop();
        if (!d) return null;
        const btn = [...d.querySelectorAll("button")].find((x) => (x.textContent || "").trim() === "Delete project");
        if (!btn) return null;
        const r = btn.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      });
      OUT.dialog = Boolean(confirm);
      if (confirm) await page.mouse.click(confirm.x, confirm.y);
      let gone = false;
      for (let i = 0; i < 40; i++) {
        await delay(1000);
        const projects = await q("projects:listProjects", {});
        gone = !projects.some((p) => p._id === FIX.projectId);
        if (gone) break;
      }
      OUT.projectGone = gone;
      await shot(page, "fix4-qa5-cleanup.png");
      if (!gone) {
        // fallback (same mutation the UI calls)
        await q("projects:getProject", { projectId: FIX.projectId });
        const res = await (await import("convex/browser")).ConvexHttpClient
          ? null
          : null;
        console.log("project still present; UI delete did not complete");
      }
    }
    const projects = await q("projects:listProjects", {});
    OUT.remainingTitles = projects.map((p) => p.title);
    const childPkgs = await q("tradePackages:listByProject", { projectId: FIX.projectId });
    OUT.childPackagesRemaining = childPkgs.length;
    writeJson("fix4-qa5-cleanup.json", OUT);
    console.log(JSON.stringify(OUT, null, 2));
  } catch (e) {
    OUT.error = String(e && e.stack ? e.stack : e);
    writeJson("fix4-qa5-cleanup.json", OUT);
    console.error(OUT.error);
  } finally {
    await browser.close();
  }
};
run();