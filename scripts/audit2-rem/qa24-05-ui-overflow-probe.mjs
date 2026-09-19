/**
 * QA24-05 probe: classify the 375px Contracts Register status-filter overflow.
 * REGISTER now has 3 superseded agreements (chip present); REPEAT has none
 * (chip absent) as the control.
 */
import { launchBrowser, attachDiagnostics, waitForAppReady, shot, delay } from "./lib.mjs";
import { readEvidence, writeEvidence, writeLog } from "./qa24-lib.mjs";

const F = readEvidence("fixtures");
const BASE = "https://brainy-skunk-440.convex.site";
const log = [];
const say = (s) => { log.push(s); console.log(s); };
const results = [];
const record = (id, name, pass, detail) => {
  results.push({ id, name, pass: Boolean(pass), detail });
  say(`${pass ? "PASS" : "FAIL"}  ${id} ${name} :: ${JSON.stringify(detail).slice(0, 1200)}`);
};

const PROBE = () => {
  const vw = document.documentElement.clientWidth;
  const insideScroller = (el) => {
    let n = el.parentElement;
    while (n && n !== document.body) {
      const ox = getComputedStyle(n).overflowX;
      if (ox === "auto" || ox === "scroll" || ox === "hidden") return true;
      n = n.parentElement;
    }
    return false;
  };
  const offenders = [...document.querySelectorAll("body *")]
    .map((el) => ({ el, r: el.getBoundingClientRect(), cs: getComputedStyle(el) }))
    .filter(({ r, cs }) => r.width > 0 && r.height > 0 && cs.display !== "none" && cs.visibility !== "hidden")
    .filter(({ r }) => r.right > vw + 0.5)
    .filter(({ el }) => !insideScroller(el))
    .map(({ el, r }) => ({ tag: el.tagName, text: (el.innerText || "").trim().replace(/\s+/g, " ").slice(0, 60), right: Math.round(r.right) }));
  const statusSpan = [...document.querySelectorAll("span")].find((s) => (s.textContent || "").trim() === "Status:");
  const statusRow = statusSpan ? statusSpan.parentElement : null;
  const toolbar = statusRow ? statusRow.parentElement : null;
  return {
    vw,
    docOverflowX: document.documentElement.scrollWidth - vw,
    offenders: offenders.slice(0, 8),
    offendersTotal: offenders.length,
    statusRow: statusRow
      ? {
          clientWidth: statusRow.clientWidth,
          scrollWidth: statusRow.scrollWidth,
          flexWrap: getComputedStyle(statusRow).flexWrap,
          right: Math.round(statusRow.getBoundingClientRect().right),
          chipLabels: [...statusRow.querySelectorAll("button")].map((b) => (b.innerText || "").trim()),
          chipRights: [...statusRow.querySelectorAll("button")].map((b) => Math.round(b.getBoundingClientRect().right)),
        }
      : null,
    toolbar: toolbar
      ? { clientWidth: toolbar.clientWidth, scrollWidth: toolbar.scrollWidth, flexWrap: getComputedStyle(toolbar).flexWrap }
      : null,
  };
};

async function probe(page, projectId, tag) {
  await page.setViewport({ width: 375, height: 812, deviceScaleFactor: 1 });
  await page.goto(`${BASE}/?project=${projectId}&tab=contracts&qa24=${tag}`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await waitForAppReady(page, 60000);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => (x.getAttribute("title") || "").includes("Close Demo Tour") || (x.textContent || "").trim() === "Dismiss");
    b?.click();
  });
  await delay(1800);
  const m = await page.evaluate(PROBE);
  await shot(page, `fix4-qa24-toolbar-375-${tag}.png`);
  return m;
}

async function main() {
  const { browser } = await launchBrowser(1500, 950);
  const page = await browser.newPage();
  const diag = attachDiagnostics(page);
  try {
    const reg = await probe(page, F.register.id, "register-superseded-chip");
    const rep = await probe(page, F.repeat.id, "repeat-no-chip");
    record(
      "A24-05.1",
      "375px register toolbar overflows when the Superseded chip is present (all-superseded register), from the non-wrapping Status chip row",
      reg.docOverflowX > 0 && reg.statusRow && reg.statusRow.scrollWidth > reg.statusRow.clientWidth &&
        reg.statusRow.flexWrap === "nowrap" && reg.statusRow.chipLabels.some((c) => /Superseded/.test(c)),
      { reg }
    );
    record(
      "A24-05.2",
      "control: same toolbar with only 3 chips (no agreements -> no Superseded chip) still overflows / or not",
      true,
      { rep }
    );
    record("A24-05.3", "probe diagnostics", diag.pageErrors.length === 0, {
      pageErrors: diag.pageErrors.slice(0, 4).map((x) => x.slice(0, 180)),
    });
  } catch (err) {
    record("A24-05.ERR", "probe aborted", false, { error: String(err?.stack ?? err).slice(0, 700) });
  } finally {
    writeEvidence("ui-overflow", { results, summary: { pass: results.filter((r) => r.pass).length, total: results.length } });
    writeLog("ui-overflow", log);
    await browser.close();
    console.log(`ui overflow: ${results.filter((r) => r.pass).length}/${results.length}`);
  }
}

main().catch((e) => {
  console.error(e);
  writeLog("ui-overflow-crash", [String(e?.stack ?? e)]);
  process.exit(1);
});