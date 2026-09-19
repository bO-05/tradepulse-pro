/**
 * QA19-04: A17-03 — Pre-Bid Q&A at 320px must have zero page-level horizontal
 * overflow (the queue filter row wraps). Probes LIVE (2 packages) and DEADLINE
 * (long package names).
 */
import { launchBrowser, attachDiagnostics, waitForAppReady, shot, delay } from "./lib.mjs";
import { client, readEvidence, writeEvidence, writeLog } from "./qa19-lib.mjs";

const F = readEvidence("fixtures");
const log = [];
const say = (s) => { log.push(s); console.log(s); };
const out = {};

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
    .map(({ el, r, cs }) => ({
      tag: el.tagName,
      cls: String(el.className || "").slice(0, 100),
      text: (el.innerText || el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 70),
      right: Math.round(r.right * 10) / 10,
      overflowX: cs.overflowX,
    }));
  const filterLabel = [...document.querySelectorAll("span")].find((s) => (s.textContent || "").includes("Queue Filter"));
  const filterRow = filterLabel ? filterLabel.closest("div") : null;
  const chips = filterRow ? [...filterRow.querySelectorAll("button")] : [];
  const chipTops = chips.map((b) => Math.round(b.getBoundingClientRect().top));
  return {
    vw,
    scrollW: document.documentElement.scrollWidth,
    bodyScrollW: document.body.scrollWidth,
    pageOverflow: document.documentElement.scrollWidth - vw,
    bodyOverflow: document.body.scrollWidth - vw,
    offenders,
    filterRow: filterRow
      ? {
          clientWidth: filterRow.clientWidth,
          scrollWidth: filterRow.scrollWidth,
          flexWrap: getComputedStyle(filterRow).flexWrap,
          chipCount: chips.length,
          distinctChipRows: new Set(chipTops).size,
        }
      : null,
  };
};

async function probe(projectId, tag) {
  const { browser } = await launchBrowser(1440, 950);
  const page = await browser.newPage();
  const diag = attachDiagnostics(page);
  await page.goto(`https://brainy-skunk-440.convex.site/?project=${projectId}&tab=qna&qa19=${tag}`, {
    waitUntil: "domcontentloaded",
    timeout: 90000,
  });
  await waitForAppReady(page, 60000);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find(
      (x) => (x.getAttribute("title") || "").includes("Close Demo Tour") || (x.textContent || "").trim() === "Dismiss"
    );
    b?.click();
  });
  await delay(600);
  await page.setViewport({ width: 320, height: 700, deviceScaleFactor: 1 });
  await delay(1200);
  const m = await page.evaluate(PROBE);
  say(`[${tag}] vw=${m.vw} scrollW=${m.scrollW} pageOverflow=${m.pageOverflow} offenders=${m.offenders.length} filterRow=${JSON.stringify(m.filterRow)}`);
  for (const o of m.offenders.slice(0, 6)) say(`   ${o.tag}.${o.cls.slice(0, 60)} right=${o.right} text="${o.text}"`);
  await shot(page, `fix4-qa19-mobile-qna-320-${tag}.png`, { full: true });
  const res = { tag, projectId, ...m, pageErrors: diag.pageErrors.slice(0, 3) };
  await browser.close();
  return res;
}

async function main() {
  const liveQna = await probe(F.live.id, "live");
  const deadlineQna = await probe(F.deadline.id, "deadline-longnames");

  const results = [
    {
      name: "A17-03.live-qna-320-zero-page-overflow",
      pass: liveQna.pageOverflow <= 0 && liveQna.bodyOverflow <= 0,
      detail: { pageOverflow: liveQna.pageOverflow, bodyOverflow: liveQna.bodyOverflow, scrollW: liveQna.scrollW, vw: liveQna.vw },
    },
    {
      name: "A17-03.live-qna-offenders-zero",
      pass: liveQna.offenders.length === 0,
      detail: { offenders: liveQna.offenders.slice(0, 3) },
    },
    {
      name: "A17-03.deadline-longnames-qna-320-zero-page-overflow",
      pass: deadlineQna.pageOverflow <= 0 && deadlineQna.bodyOverflow <= 0,
      detail: {
        pageOverflow: deadlineQna.pageOverflow,
        bodyOverflow: deadlineQna.bodyOverflow,
        scrollW: deadlineQna.scrollW,
        vw: deadlineQna.vw,
      },
    },
    {
      name: "A17-03.deadline-longnames-offenders-zero",
      pass: deadlineQna.offenders.length === 0,
      detail: { offenders: deadlineQna.offenders.slice(0, 3) },
    },
  ];
  for (const r of results) say(`${r.pass ? "PASS" : "FAIL"}  ${r.name} :: ${JSON.stringify(r.detail)}`);

  writeEvidence("mobile", { capturedAt: new Date().toISOString(), liveQna, deadlineQna, results });
  writeLog("mobile", log);
  console.log(`results: ${results.filter((r) => r.pass).length}/${results.length}`);
  if (results.some((r) => !r.pass)) process.exitCode = 2;
}

main().catch((e) => {
  console.error(e);
  writeLog("mobile-crash", [String(e?.stack ?? e)]);
  process.exit(1);
});