/**
 * QA17-04b: localize the 5px Pre-Bid Q&A page overflow at 320px.
 * Compares long-name project vs short-name project vs short-package selection.
 */
import { launchBrowser, attachDiagnostics, waitForAppReady, shot, delay } from "./lib.mjs";
import { client, readEvidence, writeEvidence, writeLog } from "./qa17-lib.mjs";

const F = readEvidence("fixtures");
const c = client();
const log = [];
const say = (s) => { log.push(s); console.log(s); };

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
    .map((el) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return { el, r, cs };
    })
    .filter(({ r, cs }) => r.width > 0 && r.height > 0 && cs.display !== "none" && cs.visibility !== "hidden")
    .filter(({ r }) => r.right > vw + 0.5)
    .filter(({ el }) => !insideScroller(el))
    .map(({ el, r, cs }) => ({
      tag: el.tagName,
      cls: String(el.className || "").slice(0, 90),
      text: (el.innerText || el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 70),
      left: Math.round(r.left * 10) / 10,
      right: Math.round(r.right * 10) / 10,
      width: Math.round(r.width * 10) / 10,
      overflowX: cs.overflowX,
      parentTag: el.parentElement ? el.parentElement.tagName : null,
      parentCls: el.parentElement ? String(el.parentElement.className || "").slice(0, 90) : null,
    }));
  const widest = [...document.querySelectorAll("body *")]
    .map((el) => ({ el, r: el.getBoundingClientRect() }))
    .filter(({ r }) => r.width > 0)
    .sort((a, b) => b.r.right - a.r.right)
    .slice(0, 6)
    .map(({ el, r }) => ({ tag: el.tagName, text: (el.innerText || "").slice(0, 50).replace(/\s+/g, " "), right: Math.round(r.right), cls: String(el.className || "").slice(0, 60) }));
  return { vw, scrollW: document.documentElement.scrollWidth, bodyScrollW: document.body.scrollWidth, offenders, widest };
};

async function probe(projectId, tab, tag) {
  const { browser } = await launchBrowser(1440, 950);
  const page = await browser.newPage();
  const diag = attachDiagnostics(page);
  try {
    await page.goto(`https://brainy-skunk-440.convex.site/?project=${projectId}&tab=${tab}&qa17=probe`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await waitForAppReady(page);
    await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) => (x.getAttribute("title") || "").includes("Close Demo Tour") || (x.textContent || "").trim() === "Dismiss");
      b?.click();
    });
    await page.setViewport({ width: 320, height: 700, deviceScaleFactor: 1 });
    await delay(800);
    const m = await page.evaluate(PROBE);
    say(`[${tag}] vw=${m.vw} scrollW=${m.scrollW} offenders=${m.offenders.length}`);
    for (const o of m.offenders.slice(0, 5)) say(`   ${o.tag}.${o.cls.slice(0, 40)} right=${o.right} text="${o.text}"`);
    await shot(page, `fix4-qa17-probe-${tag}.png`, { full: true });
    return { tag, projectId, ...m, pageErrors: diag.pageErrors.slice(0, 3) };
  } finally {
    await browser.close();
  }
}

async function main() {
  const nameShortSelected = await (async () => {
    const r = await probe(F.name.id, "qna", "name-default");
    return r;
  })();
  const deadlineShortNames = await probe(F.deadline.id, "qna", "deadline-shortnames");
  const discoveryName = await probe(F.name.id, "discovery", "name-discovery");

  writeEvidence("overflow-probe", { capturedAt: new Date().toISOString(), nameShortSelected, deadlineShortNames, discoveryName });
  writeLog("overflow-probe", log);
}

main().catch((e) => {
  console.error(e);
  writeLog("overflow-probe-crash", [String(e?.stack ?? e)]);
  process.exit(1);
});