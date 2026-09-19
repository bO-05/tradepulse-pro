/**
 * QA17-04: A16-02 long trade-name / ribbon behavior at 320px & 375px.
 * Discovery + Pre-Bid Q&A page-level overflow, chip truncation, 10-package ribbon,
 * short-name unchanged, plus edge-length hunt in packages/leveling/contracts/CSV/tour.
 */
import fs from "node:fs";
import path from "node:path";
import { launchBrowser, attachDiagnostics, waitForAppReady, shot, delay } from "./lib.mjs";
import { client, readEvidence, writeEvidence, writeLog, EVIDENCE_DIR } from "./qa17-lib.mjs";

const c = client();
const F = readEvidence("fixtures");
const log = [];
const say = (s) => { log.push(s); console.log(s); };
const results = [];
const record = (name, pass, detail) => {
  results.push({ name, pass: Boolean(pass), detail });
  say(`${pass ? "PASS" : "FAIL"}  ${name} :: ${JSON.stringify(detail).slice(0, 420)}`);
};

const MEASURE = () => {
  const de = document.documentElement;
  const vw = de.clientWidth;
  const pageOverflow = de.scrollWidth > vw + 1;
  const bodyOverflow = document.body.scrollWidth > vw + 1;
  const wide = [...document.querySelectorAll("body *")]
    .filter((el) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden" || r.width === 0 || r.height === 0) return false;
      return r.right > vw + 2 || r.left < -2;
    })
    .slice(0, 8)
    .map((el) => ({ tag: el.tagName, text: (el.innerText || "").trim().replace(/\s+/g, " ").slice(0, 60), right: Math.round(el.getBoundingClientRect().right), left: Math.round(el.getBoundingClientRect().left) }));
  const tbl = document.body.innerText;
  const label = [...document.querySelectorAll("span,div")].find((e) => (e.textContent || "").trim() === "Select Trade:");
  const ribbon = label ? label.parentElement : null;
  const chips = ribbon ? [...ribbon.querySelectorAll("button")] : [];
  const chipInfo = chips.map((b, i) => {
    const spans = [...b.querySelectorAll("span")];
    const nameSpan = spans.find((s) => String(s.className || "").includes("truncate")) || spans[spans.length - 1] || null;
    const cs = nameSpan ? getComputedStyle(nameSpan) : null;
    const r = b.getBoundingClientRect();
    return {
      i,
      pressed: b.getAttribute("aria-pressed"),
      title: b.getAttribute("title"),
      spanTitle: nameSpan ? nameSpan.getAttribute("title") : null,
      nameText: nameSpan ? nameSpan.textContent.trim() : null,
      text: (b.innerText || "").trim().replace(/\s+/g, " ").slice(0, 90),
      scrollW: nameSpan ? nameSpan.scrollWidth : null,
      clientW: nameSpan ? nameSpan.clientWidth : null,
      truncated: nameSpan ? nameSpan.scrollWidth > nameSpan.clientWidth + 1 : false,
      ellipsis: cs ? cs.textOverflow : null,
      maxW: cs ? cs.maxWidth : null,
      chipW: Math.round(r.width),
    };
  });
  return {
    vw,
    pageOverflow,
    bodyOverflow,
    scrollW: de.scrollWidth,
    wide,
    hasUndefined: /\bundefined\b/.test(tbl),
    hasNaN: /\bNaN\b/.test(tbl),
    ribbonFound: Boolean(ribbon),
    ribbonScrollW: ribbon ? ribbon.scrollWidth : null,
    ribbonClientW: ribbon ? ribbon.clientWidth : null,
    chipCount: chips.length,
    chips: chipInfo,
    longChip: chipInfo.find((x) => (x.nameText || "").startsWith("AUDIT-QA17 Long-Name")) || null,
    shortChip: chipInfo.find((x) => (x.nameText || "") === "AUDIT-QA17 Short 05") || null,
  };
};

async function dismissTour(page) {
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => (x.getAttribute("title") || "").includes("Close Demo Tour") || (x.textContent || "").trim() === "Dismiss");
    b?.click();
  });
  await delay(400);
}

async function openTab(page, projectId, tab) {
  await page.goto(`https://brainy-skunk-440.convex.site/?project=${projectId}&tab=${tab}&qa17=name`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await waitForAppReady(page);
  await dismissTour(page);
  await delay(900);
}

async function measureAt(page, w, h) {
  await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
  await delay(500);
  return page.evaluate(MEASURE);
}

async function main() {
  const { browser } = await launchBrowser(1440, 950);
  const page = await browser.newPage();
  const diag = attachDiagnostics(page);
  const dlDir = path.join(EVIDENCE_DIR, "fix4-qa17-downloads-name");
  fs.mkdirSync(dlDir, { recursive: true });
  const cdp = await page.createCDPSession();
  await cdp.send("Page.setDownloadBehavior", { behavior: "allow", downloadPath: dlDir });
  const out = { sizes: {}, hunt: {}, csv: null, tour: null, downloads: [] };
  try {
    for (const tab of ["discovery", "qna"]) {
      await openTab(page, F.name.id, tab);
      out.sizes[tab] = {};
      for (const [label, w, h] of [["320", 320, 700], ["375", 375, 760]]) {
        const m = await measureAt(page, w, h);
        out.sizes[tab][label] = m;
        await shot(page, `fix4-qa17-${tab}-${label}.png`, { full: true });
        record(
          `A16-02.${tab}.${label}.zero-page-overflow`,
          !m.pageOverflow && !m.bodyOverflow,
          { pageOverflow: m.pageOverflow, scrollW: m.scrollW, vw: m.vw, wide: m.wide.slice(0, 4) }
        );
      }
      const m375 = out.sizes[tab]["375"];
      record(
        `A16-02.${tab}.ribbon-10-chips`,
        m375.ribbonFound && m375.chipCount === 10,
        { chipCount: m375.chipCount, ribbonScrollW: m375.ribbonScrollW, ribbonClientW: m375.ribbonClientW }
      );
      record(
        `A16-02.${tab}.long-chip-truncates`,
        Boolean(m375.longChip && m375.longChip.truncated && m375.longChip.ellipsis === "ellipsis" && (m375.longChip.nameText || "").length > 10),
        m375.longChip
      );
      record(
        `A16-02.${tab}.short-chip-unchanged`,
        Boolean(m375.shortChip && !m375.shortChip.truncated && m375.shortChip.nameText === "AUDIT-QA17 Short 05"),
        m375.shortChip
      );
    }

    // ---- hunt: packages (cards) ----
    await openTab(page, F.name.id, "packages");
    const pkg320 = await measureAt(page, 320, 700);
    await shot(page, "fix4-qa17-hunt-packages-320.png", { full: true });
    const longCard = await page.evaluate(() => {
      const els = [...document.querySelectorAll("main div")].filter((d) => (d.innerText || "").includes("AUDIT-QA17 Long-Name"));
      const card = els.sort((a, b) => a.innerText.length - b.innerText.length)[0];
      if (!card) return null;
      return { scrollW: card.scrollWidth, clientW: card.clientWidth, overflow: card.scrollWidth > card.clientWidth + 1, text: (card.innerText || "").slice(0, 80) };
    });
    out.hunt.packages = { ...pkg320, longCard };
    record("HUNT.packages-320-zero-page-overflow", !pkg320.pageOverflow && !pkg320.hasUndefined, { pageOverflow: pkg320.pageOverflow, hasUndefined: pkg320.hasUndefined, longCard });

    // ---- hunt: leveling ----
    await openTab(page, F.name.id, "leveling");
    const lvl320 = await measureAt(page, 320, 700);
    const lvl375 = await measureAt(page, 375, 760);
    await shot(page, "fix4-qa17-hunt-leveling-320.png", { full: true });
    out.hunt.leveling = { lvl320, lvl375 };
    record("HUNT.leveling-mobile-zero-page-overflow", !lvl320.pageOverflow && !lvl375.pageOverflow, { o320: lvl320.pageOverflow, o375: lvl375.pageOverflow, longChip320: lvl320.longChip, wide: lvl320.wide.slice(0, 4) });

    // ---- hunt: CSV with 500-char name (long package selected by default) ----
    await page.setViewport({ width: 1440, height: 950, deviceScaleFactor: 1 });
    await delay(500);
    const csvClick = await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").includes("Export Leveling CSV") && !x.disabled);
      if (!b) return { ok: false };
      b.scrollIntoView({ block: "center" });
      b.click();
      return { ok: true };
    });
    await delay(1600);
    const csvFiles = fs.existsSync(dlDir) ? fs.readdirSync(dlDir).filter((f) => f.endsWith(".csv")) : [];
    let csv = null;
    if (csvFiles.length) {
      const content = fs.readFileSync(path.join(dlDir, csvFiles[csvFiles.length - 1]), "utf8");
      const header = content.split(/\r?\n/)[0];
      const hasLong = content.includes(F.name.longName);
      csv = { file: csvFiles[csvFiles.length - 1], bytes: content.length, header, hasLongName: hasLong, longNameLen: F.name.longName.length };
    }
    out.csv = { csvClick, csv };
    record("HUNT.csv-500char-name-intact", Boolean(csv && csv.hasLongName), csv);

    // ---- hunt: contracts (long-name agreement row) ----
    await openTab(page, F.name.id, "contracts");
    const con320 = await measureAt(page, 320, 700);
    await shot(page, "fix4-qa17-hunt-contracts-320.png", { full: true });
    const longRow = await page.evaluate((name) => {
      const tr = [...document.querySelectorAll("tr")].find((t) => (t.innerText || "").includes(name.slice(0, 60)));
      if (!tr) return null;
      return { text: (tr.innerText || "").replace(/\s+/g, " ").slice(0, 120), scrollW: tr.scrollWidth, clientW: tr.clientWidth };
    }, F.name.longName);
    out.hunt.contracts = { con320, longRow };
    record("HUNT.contracts-320-zero-page-overflow", !con320.pageOverflow, { pageOverflow: con320.pageOverflow, longRow, wide: con320.wide.slice(0, 4) });

    // ---- hunt: tour with long package selected ----
    await page.setViewport({ width: 375, height: 760, deviceScaleFactor: 1 });
    await openTab(page, F.name.id, "leveling");
    const tourOpen = await page.evaluate(() => {
      const b = [...document.querySelectorAll("header button")].find((x) => (x.getAttribute("title") || "").includes("Demo Tour"));
      if (!b) return false;
      b.click();
      return true;
    });
    await delay(900);
    const tourM = tourOpen ? await page.evaluate(MEASURE) : null;
    out.tour = { tourOpen, tourM };
    await shot(page, "fix4-qa17-hunt-tour-375.png");
    record("HUNT.tour-open-no-flow-regression", !tourOpen || (tourM && !tourM.pageOverflow), { tourOpen, pageOverflow: tourM ? tourM.pageOverflow : null, chipCount: tourM ? tourM.chipCount : null });

    out.diagnostics = { pageErrors: diag.pageErrors.slice(0, 10), consoleErrors: diag.consoleLogs.filter((l) => l.type === "error").map((l) => l.text.slice(0, 160)).slice(0, 6) };
    record("A16-02.zero-pageerrors", diag.pageErrors.length === 0, { pageErrors: diag.pageErrors.length });
  } finally {
    await browser.close();
  }

  writeEvidence("mobile-longname", { capturedAt: new Date().toISOString(), longName: F.name.longName, longNameLen: F.name.longName.length, ...out, results });
  writeLog("mobile-longname", log);
  console.log(`results: ${results.filter((r) => r.pass).length}/${results.length}`);
}

main().catch((e) => {
  console.error(e);
  writeLog("mobile-longname-crash", [String(e?.stack ?? e)]);
  process.exit(1);
});