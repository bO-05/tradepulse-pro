// QA6-01: dialog contract on the three formerly-bare modals
// (Ingest Quote / PDF, Add Contractor Manually, Edit Contractor) + background scroll lock.
import {
  BASE_URL,
  attachDiagnostics,
  armOpenerBySelector,
  armOpenerByText,
  clickHeaderTab,
  delay,
  focusRestoreProbe,
  gotoDemo,
  launchBrowser,
  shot,
  STACK_PROBE,
  tabSweep,
  wheelProbe,
  writeJson,
  writeLog,
} from "./qa6-lib.mjs";

const run = async () => {
  const { browser } = await launchBrowser(1440, 900);
  const page = await browser.newPage();
  const diag = attachDiagnostics(page);
  const out = { url: BASE_URL, viewport: "1440x900", startedAt: new Date().toISOString(), cases: {} };
  const lines = [];
  try {
    out.project = await gotoDemo(page);
    lines.push(`project selected: ${JSON.stringify(out.project)}`);

    const caseRun = async (id, arm) => {
      const rec = { id };
      await page.evaluate(() => window.scrollTo(0, 0));
      await delay(250);
      await page.evaluate(() => window.scrollTo(0, Math.min(600, Math.max(0, (document.scrollingElement.scrollHeight || 0) - window.innerHeight))));
      await delay(250);
      const armRes = await arm();
      rec.opener = armRes;
      if (!armRes) {
        rec.error = "opener not found";
        out.cases[id] = rec;
        lines.push(`${id}: OPENER NOT FOUND`);
        return rec;
      }
      await page.mouse.click(armRes.x, armRes.y);
      await delay(600);
      rec.open = await page.evaluate(STACK_PROBE);
      rec.aria = await page.evaluate(() => {
        const ds = [...document.querySelectorAll('[role="dialog"]')].filter((e) => e.getBoundingClientRect().width > 0);
        const d = ds[ds.length - 1];
        if (!d) return null;
        const lb = d.getAttribute("aria-labelledby");
        const resolved = lb
          ? lb.split(/\s+/).map((rid) => (document.getElementById(rid) || {}).innerText || "").join(" ").trim()
          : null;
        return {
          role: d.getAttribute("role"),
          ariaModal: d.getAttribute("aria-modal"),
          labelledby: lb,
          labelledbyResolved: resolved,
          labelledbyText: resolved ? resolved.replace(/\s+/g, " ").slice(0, 90) : null,
          id: d.id || null,
        };
      });
      rec.openerFocusedAfterClick = await page.evaluate(() => document.activeElement === window.__qa6Opener);
      await shot(page, `fix4-qa6-01-${id}-open.png`);
      rec.tabForward = await tabSweep(page, { times: 40 });
      rec.tabBackward = await tabSweep(page, { times: 8, shift: true });
      rec.wheelOpen = await wheelProbe(page);
      await page.keyboard.press("Escape");
      await delay(500);
      rec.afterEscape = await page.evaluate(STACK_PROBE);
      rec.escapeClosed = rec.afterEscape.overlayCount === 0 && rec.afterEscape.dialogCount === 0;
      rec.focusRestored = await focusRestoreProbe(page);
      rec.wheelAfterClose = await wheelProbe(page);
      await shot(page, `fix4-qa6-01-${id}-after.png`);
      if (!rec.escapeClosed) {
        await page.evaluate(() => {
          const ds = [...document.querySelectorAll('[role="dialog"]')].filter((e) => e.getBoundingClientRect().width > 0);
          const d = ds[ds.length - 1];
          const b =
            d &&
            [...d.querySelectorAll("button")].find((x) =>
              /cancel|close/i.test((x.getAttribute("aria-label") || "") + " " + (x.innerText || ""))
            );
          if (b) b.click();
        });
        await delay(450);
      }
      const line = `${id}: role=${rec.aria && rec.aria.role} modal=${rec.aria && rec.aria.ariaModal} label="${rec.aria && rec.aria.labelledbyText}" ` +
        `focusIn=${rec.open.activeInsideTop} tabOut=${rec.tabForward.outside} shiftOut=${rec.tabBackward.outside} ` +
        `bodyLocked=${rec.open.bodyOverflowComputed === "hidden"} docScrollOnWheel=${rec.wheelOpen.documentScrollChanged} ` +
        `escClosed=${rec.escapeClosed} focusRestored=${rec.focusRestored.identity} bodyUnlocked=${rec.afterEscape.bodyOverflowComputed !== "hidden"}`;
      lines.push(line);
      console.log(line);
      out.cases[id] = rec;
      return rec;
    };

    await clickHeaderTab(page, "04: Bid Leveling");
    await caseRun("ingest-quote", () => armOpenerByText(page, "Ingest Quote / PDF"));
    await clickHeaderTab(page, "02: Discovery");
    await caseRun("add-contractor", () => armOpenerByText(page, "Add Contractor Manually"));
    await caseRun("edit-contractor", () => armOpenerBySelector(page, 'button[title="Edit contractor info"]'));

    out.diagnostics = { pageErrors: diag.pageErrors, consoleErrors: diag.consoleLogs.filter((l) => l.type === "error").slice(0, 20), failedRequests: diag.failedRequests.slice(0, 10) };
    writeJson("fix4-qa6-01-dialog-contract.json", out);
    writeLog("fix4-qa6-01-dialog-contract.log", lines);
  } finally {
    await browser.close();
  }
};
run();