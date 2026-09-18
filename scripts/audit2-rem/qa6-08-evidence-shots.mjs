// QA6-08: visual evidence for the two remaining issues found in QA6
// (A6-01 stacked-confirm Tab escape; A6-03 amber-600 contrast) + AX focus shots.
import {
  armOpenerByText,
  clickHeaderTab,
  delay,
  gotoDemo,
  launchBrowser,
  shot,
  writeJson,
} from "./qa6-lib.mjs";

const run = async () => {
  const { browser } = await launchBrowser(1440, 900);
  const page = await browser.newPage();
  const out = { startedAt: new Date().toISOString() };
  try {
    await gotoDemo(page);

    // A6-03: coordination amber-600 button
    await clickHeaderTab(page, "05: Scope Clash");
    await delay(500);
    const amber = await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) => (x.innerText || "").includes("Assign to Div 23 (HVAC)"));
      if (!b) return null;
      b.scrollIntoView({ block: "center" });
      const r = b.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, text: b.innerText.trim(), className: b.className, color: getComputedStyle(b).color, bg: getComputedStyle(b).backgroundColor };
    });
    out.amber = amber;
    await delay(250);
    await shot(page, "fix4-qa6-08-amber600-coordination.png");

    // A6-01: dock -> reset confirm -> Tab once -> focus lands on dock, not confirm
    await page.evaluate(() => window.scrollTo(0, 0));
    await delay(250);
    const dock = await armOpenerByText(page, "60s Judge Dock");
    await page.mouse.click(dock.x, dock.y);
    await delay(600);
    const reset = await armOpenerByText(page, "Reset Demo Data");
    await page.mouse.click(reset.x, reset.y);
    await delay(600);
    await page.keyboard.press("Tab");
    await delay(250);
    out.afterOneTab = await page.evaluate(() => {
      const focus = document.activeElement;
      const ds = [...document.querySelectorAll('[role="dialog"],[role="alertdialog"]')].filter((e) => e.getBoundingClientRect().width > 0);
      const top = ds[ds.length - 1];
      return {
        topRole: top ? top.getAttribute("role") : null,
        focused: (focus.getAttribute("aria-label") || (focus.innerText || "").trim() || "").slice(0, 70),
        focusInsideTop: top ? top.contains(focus) : false,
        visibleDialogs: ds.length,
      };
    });
    await shot(page, "fix4-qa6-08-confirm-tab-escape.png");
    await page.keyboard.press("Escape");
    await delay(400);
    await page.keyboard.press("Escape");
    await delay(300);

    await page.evaluate(() => window.scrollTo(0, 0));
    await delay(250);
    console.log(JSON.stringify(out, null, 1));
    await writeJson("fix4-qa6-08-evidence-shots.json", out);
  } finally {
    await browser.close();
  }
};
run();