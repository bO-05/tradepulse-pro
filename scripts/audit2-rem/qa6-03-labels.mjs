// QA6-03: accessible-name audit (CDP Accessibility.getPartialAXTree) for form controls in
// New Project, Create Trade Package, AI Spec, Add/Edit Contractor, Ingest Quote, and page
// selects on Packages / Q&A / Diagnostics tabs.
import {
  BASE_URL,
  armOpenerBySelector,
  armOpenerByText,
  axScan,
  clickHeaderTab,
  delay,
  gotoDemo,
  launchBrowser,
  shot,
  writeJson,
  writeLog,
} from "./qa6-lib.mjs";

const run = async () => {
  const { browser } = await launchBrowser(1440, 900);
  const page = await browser.newPage();
  const client = await page.createCDPSession();
  const out = { url: BASE_URL, viewport: "1440x900", startedAt: new Date().toISOString(), cases: {} };
  const lines = [];
  try {
    out.project = await gotoDemo(page);

    const scanOpenDialog = async (id, arm) => {
      await page.evaluate(() => window.scrollTo(0, 0));
      await delay(200);
      const op = await arm();
      if (!op) {
        out.cases[id] = { error: "opener not found" };
        lines.push(`${id}: OPENER NOT FOUND`);
        return null;
      }
      await page.mouse.click(op.x, op.y);
      await delay(650);
      const rootSel = await page.evaluate(() => {
        const ds = [...document.querySelectorAll('[role="dialog"]')].filter((e) => e.getBoundingClientRect().width > 0);
        const d = ds[ds.length - 1];
        if (!d) return null;
        d.setAttribute("data-qa6-dialog", "1");
        return '[data-qa6-dialog="1"]';
      });
      if (!rootSel) {
        out.cases[id] = { error: "no visible dialog after click", opener: op };
        lines.push(`${id}: NO DIALOG OPEN`);
        return null;
      }
      const scan = await axScan(page, client, rootSel, "input,select,textarea");
      await shot(page, `fix4-qa6-03-labels-${id}.png`);
      await page.evaluate(() => {
        const d = document.querySelector('[data-qa6-dialog="1"]');
        if (d) d.removeAttribute("data-qa6-dialog");
      });
      await page.keyboard.press("Escape");
      await delay(500);
      const closed = await page.evaluate(() => [...document.querySelectorAll('[role="dialog"],[role="alertdialog"]')].filter((e) => e.getBoundingClientRect().width > 0).length);
      if (closed > 0) {
        await page.evaluate(() => {
          const ds = [...document.querySelectorAll('[role="dialog"]')].filter((e) => e.getBoundingClientRect().width > 0);
          const d = ds[ds.length - 1];
          const b = d && [...d.querySelectorAll("button")].find((x) => /cancel|close/i.test((x.getAttribute("aria-label") || "") + " " + (x.innerText || "")));
          if (b) b.click();
        });
        await delay(400);
      }
      out.cases[id] = { opener: op, scan };
      const unnamedDesc = scan.unnamed.map((u) => `${u.tag}${u.type ? "[" + u.type + "]" : ""}:${u.placeholder || u.nativeLabel || "no-name"}`).join(" | ");
      const l = `${id}: visible=${scan.visibleCount} unnamed=${scan.unnamedCount}${scan.unnamedCount ? " :: " + unnamedDesc : ""}`;
      lines.push(l);
      console.log(l);
      return scan;
    };

    await scanOpenDialog("new-project", () => armOpenerByText(page, "New Project", true));

    await clickHeaderTab(page, "01: CSI Scoping");
    await scanOpenDialog("create-package", () => armOpenerByText(page, "Create Trade Package"));
    await scanOpenDialog("ai-spec", () => armOpenerByText(page, "AI Spec Breakdown"));

    await clickHeaderTab(page, "02: Discovery");
    await scanOpenDialog("add-contractor", () => armOpenerByText(page, "Add Contractor Manually"));
    await scanOpenDialog("edit-contractor", () => armOpenerBySelector(page, 'button[title="Edit contractor info"]'));

    await clickHeaderTab(page, "04: Bid Leveling");
    await scanOpenDialog("ingest-quote", () => armOpenerByText(page, "Ingest Quote / PDF"));

    out.pageSelects = {};
    for (const [id, label] of [
      ["packages", "01: CSI Scoping"],
      ["qna", "03: Pre-Bid"],
      ["diagnostics", "Evals & Architecture"],
    ]) {
      await clickHeaderTab(page, label);
      const scan = await axScan(page, client, "main", "select");
      const headerScan = await axScan(page, client, "header", "select");
      const allUnnamed = [...scan.unnamed, ...headerScan.unnamed];
      out.pageSelects[id] = { main: scan, header: headerScan, combinedUnnamedCount: allUnnamed.length };
      const l = `selects[${id}]: mainVisible=${scan.visibleCount} mainUnnamed=${scan.unnamedCount} headerVisible=${headerScan.visibleCount} headerUnnamed=${headerScan.unnamedCount}`;
      lines.push(l);
      console.log(l);
      await shot(page, `fix4-qa6-03-selects-${id}.png`);
    }

    writeJson("fix4-qa6-03-labels.json", out);
    writeLog("fix4-qa6-03-labels.log", lines);
  } finally {
    await browser.close();
  }
};
run();