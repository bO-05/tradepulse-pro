// QA6-02: Escape stacking (Judge Dock -> Reset confirm -> Escape), Escape for AI Spec /
// Create Trade Package, and scroll lock behind dock + confirm.
import {
  BASE_URL,
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
  const out = { url: BASE_URL, viewport: "1440x900", startedAt: new Date().toISOString(), cases: {} };
  const lines = [];
  try {
    out.project = await gotoDemo(page);
    await page.evaluate(() => window.scrollTo(0, 0));
    await delay(300);

    // ---- Item 2: Judge Dock -> Reset confirm -> Escape stacking ----
    const dock = await armOpenerByText(page, "60s Judge Dock");
    await page.evaluate(() => {
      window.__qa6DockOpener = window.__qa6Opener;
    });
    await page.mouse.click(dock.x, dock.y);
    await delay(650);
    const dockOpen = await page.evaluate(STACK_PROBE);
    const dockWheel = await wheelProbe(page);
    await shot(page, "fix4-qa6-02-dock-open.png");

    const reset = await armOpenerByText(page, "Reset Demo Data");
    await page.mouse.click(reset.x, reset.y);
    await delay(650);
    const confirmOpen = await page.evaluate(STACK_PROBE);
    const confirmWheel = await wheelProbe(page);
    const confirmTabs = await tabSweep(page, { times: 14, mode: "top" });
    await shot(page, "fix4-qa6-02-confirm-over-dock.png");

    // elementFromPoint click-through check on top dialog center
    const stacking = await page.evaluate(() => {
      const ds = [...document.querySelectorAll('[role="dialog"],[role="alertdialog"]')].filter((e) => e.getBoundingClientRect().width > 0);
      const top = ds[ds.length - 1];
      const r = top.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return { topRole: top.getAttribute("role"), topZ: getComputedStyle(top.parentElement).zIndex, hitInsideTop: top.contains(hit), hitTag: hit ? hit.tagName.toLowerCase() : null };
    });

    await page.keyboard.press("Escape");
    await delay(550);
    const afterFirstEscape = await page.evaluate(STACK_PROBE);
    const focusAfterFirst = await focusRestoreProbe(page);
    const unlockedAfterFirst = await page.evaluate(() => getComputedStyle(document.body).overflow);
    await shot(page, "fix4-qa6-02-after-first-escape.png");

    await page.keyboard.press("Escape");
    await delay(550);
    const afterSecondEscape = await page.evaluate(STACK_PROBE);
    const focusAfterSecond = await page.evaluate(() => {
      const a = document.activeElement;
      const op = window.__qa6DockOpener;
      const scrub = (el) => (!el ? null : (el.getAttribute("aria-label") || el.innerText || el.getAttribute("title") || "").trim().replace(/\s+/g, " ").slice(0, 80));
      return { active: scrub(a), opener: scrub(op), identity: !!op && a === op };
    });
    const wheelAfterSecond = await wheelProbe(page);
    await shot(page, "fix4-qa6-02-after-second-escape.png");

    out.cases.judgeResetStack = {
      dockOpener: dock,
      dockOpen,
      dockWheel,
      confirmOpen,
      confirmWheel,
      confirmTabs,
      stacking,
      afterFirstEscape,
      focusAfterFirst,
      unlockedAfterFirst,
      afterSecondEscape,
      focusAfterSecond,
      wheelAfterSecond,
    };
    lines.push(
      `STACK dock(open=${dockOpen.overlayCount}) confirm(open=${confirmOpen.overlayCount} role=${confirmOpen.topRole} label="${confirmOpen.topLabelledbyText}" focusIn=${confirmOpen.activeInsideTop} tabsOut=${confirmTabs.outside}) ` +
        `bodyLocked=${confirmOpen.bodyOverflowComputed === "hidden"} docScrollLocked=${!confirmWheel.documentScrollChanged} topZ=${stacking.topZ} clickThrough=${!stacking.hitInsideTop}`
    );
    lines.push(
      `STACK esc#1 -> overlays=${afterFirstEscape.overlayCount} dialogues=${afterFirstEscape.dialogCount} topRole=${afterFirstEscape.topRole} focusReset=${focusAfterFirst.identity} ("${focusAfterFirst.active}") stillLocked=${unlockedAfterFirst === "hidden"}`
    );
    lines.push(
      `STACK esc#2 -> overlays=${afterSecondEscape.overlayCount} dialogues=${afterSecondEscape.dialogCount} focusDockOpener=${focusAfterSecond.identity} ("${focusAfterSecond.active}") bodyUnlocked=${afterSecondEscape.bodyOverflowComputed !== "hidden"} wheelScrollsAgain=${wheelAfterSecond.documentScrollChanged}`
    );
    console.log(lines[lines.length - 3]);
    console.log(lines[lines.length - 2]);
    console.log(lines[lines.length - 1]);

    // ---- Item 3: Escape for AI Spec Breakdown and Create Trade Package ----
    await clickHeaderTab(page, "01: CSI Scoping");
    const escCase = async (id, text) => {
      const rec = {};
      await page.evaluate(() => window.scrollTo(0, 0));
      await delay(250);
      const op = await armOpenerByText(page, text);
      rec.opener = op;
      if (!op) {
        rec.error = "opener not found";
        out.cases[id] = rec;
        lines.push(`${id}: OPENER NOT FOUND`);
        return;
      }
      await page.mouse.click(op.x, op.y);
      await delay(600);
      rec.open = await page.evaluate(STACK_PROBE);
      rec.openAria = await page.evaluate(() => {
        const ds = [...document.querySelectorAll('[role="dialog"]')].filter((e) => e.getBoundingClientRect().width > 0);
        const d = ds[ds.length - 1];
        if (!d) return null;
        const lb = d.getAttribute("aria-labelledby");
        return {
          role: d.getAttribute("role"),
          ariaModal: d.getAttribute("aria-modal"),
          labelledby: lb,
          labelledbyResolved: lb ? !!(document.getElementById(lb) && document.getElementById(lb).innerText.trim()) : null,
        };
      });
      rec.tabs = await tabSweep(page, { times: 24, mode: "top" });
      await shot(page, `fix4-qa6-02-${id}-open.png`);
      await page.keyboard.press("Escape");
      await delay(500);
      rec.afterEscape = await page.evaluate(STACK_PROBE);
      rec.escapeClosed = rec.afterEscape.overlayCount === 0 && rec.afterEscape.dialogCount === 0;
      rec.focusRestored = await focusRestoreProbe(page);
      rec.bodyUnlocked = rec.afterEscape.bodyOverflowComputed !== "hidden";
      await shot(page, `fix4-qa6-02-${id}-after.png`);
      if (!rec.escapeClosed) {
        await page.evaluate(() => {
          const ds = [...document.querySelectorAll('[role="dialog"]')].filter((e) => e.getBoundingClientRect().width > 0);
          const d = ds[ds.length - 1];
          const b = d && [...d.querySelectorAll("button")].find((x) => /cancel|close/i.test((x.getAttribute("aria-label") || "") + " " + (x.innerText || "")));
          if (b) b.click();
        });
        await delay(450);
      }
      out.cases[id] = rec;
      const l = `${id}: role=${rec.openAria && rec.openAria.role} modal=${rec.openAria && rec.openAria.ariaModal} focusIn=${rec.open.activeInsideTop} tabOut=${rec.tabs.outside} escClosed=${rec.escapeClosed} focusRestored=${rec.focusRestored.identity} bodyUnlocked=${rec.bodyUnlocked}`;
      lines.push(l);
      console.log(l);
    };
    await escCase("ai-spec", "AI Spec Breakdown");
    await escCase("create-package", "Create Trade Package");

    writeJson("fix4-qa6-02-escape-stacking.json", out);
    writeLog("fix4-qa6-02-escape-stacking.log", lines);
  } finally {
    await browser.close();
  }
};
run();