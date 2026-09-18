// QA6-07: hunt for NEW issues after the fix round: clipped text, focus loss, scroll-lock
// side effects, stacking, keyboard traps, console/page errors across a full read-only pass.
import {
  BASE_URL,
  armOpenerBySelector,
  armOpenerByText,
  attachDiagnostics,
  CLIP_SCAN,
  clickHeaderTab,
  delay,
  gotoDemo,
  launchBrowser,
  shot,
  wheelProbe,
  writeJson,
  writeLog,
} from "./qa6-lib.mjs";

const run = async () => {
  const { browser } = await launchBrowser(1440, 900);
  const page = await browser.newPage();
  const diag = attachDiagnostics(page);
  const out = { url: BASE_URL, viewport: "1440x900", startedAt: new Date().toISOString(), clipped: {}, modals: {}, afterAll: null };
  const lines = [];
  try {
    out.project = await gotoDemo(page);

    const tabs = [
      ["packages", "01: CSI Scoping"],
      ["discovery", "02: Discovery"],
      ["qna", "03: Pre-Bid"],
      ["leveling", "04: Bid Leveling"],
      ["coordination", "05: Scope Clash"],
      ["contracts", "06: Subcontracts"],
      ["audit", "Live Activity Audit"],
      ["diagnostics", "Evals & Architecture"],
    ];
    for (const [id, label] of tabs) {
      await clickHeaderTab(page, label);
      await delay(350);
      const clips = await page.evaluate(CLIP_SCAN);
      out.clipped[id] = clips;
      if (clips.length) lines.push(`CLIP ${id}: ${clips.length} :: ${clips.map((c) => JSON.stringify(c.text)).join(", ")}`);
      else lines.push(`CLIP ${id}: 0`);
    }

    const modalPass = async (id, arm) => {
      await page.evaluate(() => window.scrollTo(0, 0));
      await delay(250);
      const op = await arm();
      const rec = { opener: op };
      if (!op) {
        rec.error = "opener not found";
        out.modals[id] = rec;
        lines.push(`MODAL ${id}: OPENER NOT FOUND`);
        return;
      }
      await page.mouse.click(op.x, op.y);
      await delay(600);
      rec.openOverlays = await page.evaluate(() => [...document.querySelectorAll("div.fixed.inset-0")].filter((e) => e.getBoundingClientRect().width > 0).length);
      rec.clips = await page.evaluate(CLIP_SCAN);
      await page.keyboard.press("Escape");
      await delay(500);
      rec.closed = await page.evaluate(() => [...document.querySelectorAll('[role="dialog"],[role="alertdialog"]')].filter((e) => e.getBoundingClientRect().width > 0).length === 0);
      rec.focusAfter = await page.evaluate(() => {
        const a = document.activeElement;
        return {
          tag: a ? a.tagName.toLowerCase() : null,
          isBody: a === document.body,
          name: a ? (a.getAttribute("aria-label") || (a.innerText || "").trim() || a.getAttribute("title") || "").slice(0, 60) : null,
        };
      });
      rec.bodyOverflowAfter = await page.evaluate(() => getComputedStyle(document.body).overflow);
      if (!rec.closed) {
        await page.evaluate(() => {
          const ds = [...document.querySelectorAll('[role="dialog"]')].filter((e) => e.getBoundingClientRect().width > 0);
          const d = ds[ds.length - 1];
          const b = d && [...d.querySelectorAll("button")].find((x) => /cancel|close/i.test((x.getAttribute("aria-label") || "") + " " + (x.innerText || "")));
          if (b) b.click();
        });
        await delay(450);
      }
      out.modals[id] = rec;
      lines.push(
        `MODAL ${id}: overlays=${rec.openOverlays} clips=${rec.clips.length} closedByEsc=${rec.closed} focusLostToBody=${rec.focusAfter.isBody} focus="${rec.focusAfter.name}" bodyOverflowAfter=${rec.bodyOverflowAfter}`
      );
    };

    await clickHeaderTab(page, "01: CSI Scoping");
    await modalPass("new-project", () => armOpenerByText(page, "New Project", true));
    await modalPass("create-package", () => armOpenerByText(page, "Create Trade Package"));
    await modalPass("ai-spec", () => armOpenerByText(page, "AI Spec Breakdown"));
    await clickHeaderTab(page, "02: Discovery");
    await modalPass("add-contractor", () => armOpenerByText(page, "Add Contractor Manually"));
    await modalPass("edit-contractor", () => armOpenerBySelector(page, 'button[title="Edit contractor info"]'));
    await clickHeaderTab(page, "04: Bid Leveling");
    await modalPass("ingest-quote", () => armOpenerByText(page, "Ingest Quote / PDF"));
    await page.evaluate(() => window.scrollTo(0, 0));
    await delay(200);
    await modalPass("judge-dock", () => armOpenerByText(page, "60s Judge Dock"));

    // keyboard reachability with no modal open
    await clickHeaderTab(page, "01: CSI Scoping");
    await page.evaluate(() => {
      if (document.body) document.body.focus();
    });
    const kb = [];
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press("Tab");
      await delay(60);
      kb.push(
        await page.evaluate(() => {
          const a = document.activeElement;
          return a ? (a.getAttribute("aria-label") || (a.innerText || "").trim() || a.getAttribute("title") || a.tagName).slice(0, 50) : null;
        })
      );
    }
    out.keyboardAfterClose = kb;
    lines.push(`KEYBOARD after close: ${JSON.stringify(kb)}`);

    out.afterAll = await wheelProbe(page, 720, 500, 600);
    out.afterAll.bodyOverflow = await page.evaluate(() => getComputedStyle(document.body).overflow);
    lines.push(`AFTER ALL: wheelScrolls=${out.afterAll.documentScrollChanged} bodyOverflow=${out.afterAll.bodyOverflow} scrollY=${out.afterAll.after.y}`);
    await shot(page, "fix4-qa6-07-hunt-final.png");

    out.diagnostics = {
      pageErrors: diag.pageErrors,
      consoleErrors: diag.consoleLogs.filter((l) => l.type === "error").slice(0, 30),
      consoleWarnings: diag.consoleLogs.filter((l) => l.type === "warning").slice(0, 10),
      failedRequests: diag.failedRequests.slice(0, 20),
    };
    lines.push(`DIAG pageErrors=${diag.pageErrors.length} consoleErrors=${out.diagnostics.consoleErrors.length} failedRequests=${diag.failedRequests.length}`);

    writeJson("fix4-qa6-07-hunt.json", out);
    writeLog("fix4-qa6-07-hunt.log", lines);
  } finally {
    await browser.close();
  }
};
run();