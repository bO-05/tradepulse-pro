import { delay, q, openApp, shot, writeJson, clickTab, selectProject, bodyText } from "./qa5-common.mjs";
import fs from "node:fs";

const FIX = JSON.parse(fs.readFileSync("evidence/fix4-qa5-fixture.json", "utf8"));
const PROJECT_ID = FIX.projectId;
const OUT = { startedAt: new Date().toISOString() };

async function snapshot(projectId) {
  const packages = await q("tradePackages:listByProject", { projectId });
  const bids = await q("bids:listAllProjectBids", { projectId });
  const contractors = await q("contractors:listByProject", { projectId });
  const agreements = await q("agreements:listAgreements", { projectId });
  let conversations = 0;
  for (const p of packages) conversations += (await q("rfq:listConversations", { tradePackageId: p._id })).length;
  const logs = await q("auditLogs:listRecentLogs", { projectId, limit: 100 });
  return {
    packages: packages.length,
    bids: bids.length,
    contractors: contractors.length,
    agreements: agreements.length,
    conversations,
    auditLogs: logs.length,
  };
}

async function clickButtonText(page, text) {
  return page.evaluate((t) => {
    const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").includes(t));
    if (!b) return false;
    b.scrollIntoView({ block: "center" });
    const r = b.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, text);
}

async function readSimConfirm(page) {
  return page.evaluate(() => {
    const d = [...document.querySelectorAll('[role="alertdialog"]')].pop();
    if (!d) return null;
    const title = d.querySelector("h2")?.textContent?.trim() || "";
    return { title, text: d.textContent.replace(/\s+/g, " ").trim() };
  });
}

async function cancelDialog(page) {
  const b = await page.evaluate(() => {
    const d = [...document.querySelectorAll('[role="alertdialog"]')].pop();
    if (!d) return null;
    const btn = [...d.querySelectorAll("button")].find((x) => (x.textContent || "").trim() === "Cancel");
    if (!btn) return null;
    const r = btn.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  if (b) await page.mouse.click(b.x, b.y);
  return Boolean(b);
}

const run = async () => {
  const { browser, page } = await openApp();
  try {
    await selectProject(page, PROJECT_ID);
    await delay(800);
    const dockBtn = await clickButtonText(page, "60s Judge Dock");
    OUT.dockButton = Boolean(dockBtn);
    await page.mouse.click(dockBtn.x, dockBtn.y);
    await delay(900);
    OUT.dockOpen = await page.evaluate(() => document.body.innerText.includes("60-Second Executive Demo & Simulation Engine"));
    const text = await bodyText(page);
    OUT.targetProjectShown = text.includes("AUDIT-QA5-VERIFY-2026-09-18") && text.includes("(custom project)");
    OUT.warningShown = text.includes("Simulations write real records");
    OUT.confirmationCopyShown = text.includes("Each action asks for confirmation");
    OUT.targetPackageShown = /Target CSI Trade Package:/.test(text);
    await shot(page, "fix4-qa5-item3-dock-open.png");

    const before = await snapshot(PROJECT_ID);
    OUT.before = before;

    const attempts = [];
    for (const label of [
      "Simulate Inbound RFI",
      "Simulate Deceptive Bid",
      "Simulate Compliant Bid",
      "1-Click Run Full Autonomous Procurement Lifecycle",
    ]) {
      const box = await clickButtonText(page, label);
      if (!box) {
        attempts.push({ label, error: "button not found" });
        continue;
      }
      await page.mouse.click(box.x, box.y);
      await delay(700);
      const dialog = await readSimConfirm(page);
      const shotName = "fix4-qa5-item3-confirm-" + label.replace(/[^a-z0-9]+/gi, "-").toLowerCase() + ".png";
      await shot(page, shotName);
      const cancelled = dialog ? await cancelDialog(page) : false;
      await delay(600);
      const after = await snapshot(PROJECT_ID);
      attempts.push({
        label,
        dialogTitle: dialog?.title || null,
        dialogMentionsProject: dialog?.text?.includes("AUDIT-QA5-VERIFY-2026-09-18") || false,
        dialogMentionsWrites: dialog?.text?.includes("writes simulated packages") || false,
        cancelled,
        countsUnchanged: JSON.stringify(after) === JSON.stringify(before),
        after,
        screenshot: shotName,
      });
    }
    OUT.attempts = attempts;
    await shot(page, "fix4-qa5-item3-after-cancels.png");

    // close dock
    await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").trim() === "Close Dock");
      b?.click();
    });
    await delay(500);

    // ---------- demo project: warning banner + confirm gate must be absent (no live write performed)
    const projects = await q("projects:listProjects", {});
    const demo = projects.find((p) => p.isDemoProject);
    await selectProject(page, demo._id);
    await delay(1200);
    const dockBtn2 = await clickButtonText(page, "60s Judge Dock");
    if (dockBtn2) await page.mouse.click(dockBtn2.x, dockBtn2.y);
    await delay(900);
    const demoText = await bodyText(page);
    OUT.demo = {
      projectId: demo._id,
      targetShown: demoText.includes(demo.title) && demoText.includes("(demo)"),
      warningAbsent: !demoText.includes("Simulations write real records"),
      confirmationCopyAbsent: !demoText.includes("Each action asks for confirmation"),
      note: "No scenario clicked on the demo project to honor the no-touch constraint; confirmation-skip is verified in source (JudgeSimulationDock.tsx: if (!isDemoProject) setSimConfirm(...)).",
    };
    await shot(page, "fix4-qa5-item3-demo-dock.png");
    await page.keyboard.press("Escape");
    writeJson("fix4-qa5-item3-dock.json", OUT);
    console.log(JSON.stringify(OUT, null, 2));
  } catch (e) {
    OUT.error = String(e && e.stack ? e.stack : e);
    writeJson("fix4-qa5-item3-dock.json", OUT);
    console.error(OUT.error);
  } finally {
    await browser.close();
  }
};
run();