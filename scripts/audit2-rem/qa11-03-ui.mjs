import fs from "node:fs";
import path from "node:path";
import {
  attachDiagnostics,
  clickHeaderTab,
  delay,
  selectProjectByTitle,
  waitForAppReady,
} from "./qa6-lib.mjs";
import { BASE_URL, launchBrowser, shot } from "./lib.mjs";
import { client, readEvidence, writeEvidence, writeLog } from "./qa11-lib.mjs";

const c = client();
const F = readEvidence("fixtures");
const B = readEvidence("backend");
const log = [];
const say = (s) => { log.push(s); console.log(s); };
const results = [];
const record = (name, pass, detail) => {
  results.push({ name, pass: Boolean(pass), detail });
  say(`${pass ? "FIXED" : "NOT-FIXED"}  ${name} :: ${detail}`);
};

const statusText = async (page) =>
  page.evaluate(() => {
    const el = [...document.querySelectorAll('[role="status"]')].find((e) => e.getBoundingClientRect().width > 0);
    return el ? el.innerText.trim() : null;
  });

async function waitToast(page, timeout = 6000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const t = await statusText(page);
    if (t) return t;
    await delay(250);
  }
  return null;
}

async function selectStage(page, tabId) {
  return page.evaluate((id) => {
    const sel = document.querySelector('select[aria-label="Navigate procurement stage"]');
    if (!sel) return { ok: false };
    sel.value = id;
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    return { ok: true };
  }, tabId);
}

async function switchPackageInLeveling(page, packageTitle) {
  const res = await page.evaluate((title) => {
    const btn = [...document.querySelectorAll("main button")].find((b) => (b.innerText || "").includes(title));
    if (!btn) return { ok: false, reason: "package switch button not found" };
    btn.click();
    return { ok: true, text: btn.innerText.trim().replace(/\s+/g, " ").slice(0, 60) };
  }, packageTitle);
  await delay(1000);
  return res;
}

async function clickMainButton(page, textPattern, opts = {}) {
  return page.evaluate(
    (pattern, exact) => {
      const rx = new RegExp(pattern);
      const btns = [...document.querySelectorAll("main button")].filter((b) => {
        const t = (b.innerText || "").trim();
        if (exact) return t === pattern;
        return rx.test(t) && !b.disabled;
      });
      const b = btns[0];
      if (!b) return { ok: false, reason: "not found", sample: [...document.querySelectorAll("main button")].map((x) => x.innerText.trim().replace(/\s+/g, " ")).filter(Boolean).slice(0, 40) };
      b.scrollIntoView({ block: "center" });
      b.click();
      return { ok: true, text: (b.innerText || "").trim().replace(/\s+/g, " ").slice(0, 80) };
    },
    textPattern,
    Boolean(opts.exact)
  );
}

async function clickConfirm(page, labelPattern) {
  const btn = await page.evaluate((pattern) => {
    const rx = new RegExp(pattern);
    const dlg = [...document.querySelectorAll('[role="alertdialog"]')].filter((e) => e.getBoundingClientRect().width > 0).pop();
    if (!dlg) return null;
    const b = [...dlg.querySelectorAll("button")].find((x) => rx.test((x.innerText || "").trim()));
    if (!b) return null;
    b.click();
    return { ok: true, text: (b.innerText || "").trim() };
  }, labelPattern);
  await delay(2500);
  return btn;
}

const MOBILE_SCAN = (longNeedle) => {
  const vw = document.documentElement.clientWidth;
  const vh = document.documentElement.clientHeight;
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 1 && r.height > 1 && cs.display !== "none" && cs.visibility !== "hidden" && parseFloat(cs.opacity) > 0.05;
  };
  const inScrollableX = (el) => {
    let p = el.parentElement;
    while (p && p !== document.body) {
      const ox = getComputedStyle(p).overflowX;
      if (ox === "auto" || ox === "scroll" || ox === "hidden") return true;
      p = p.parentElement;
    }
    return false;
  };
  const overflowers = [];
  for (const el of document.querySelectorAll("body *")) {
    if (!visible(el) || el.closest(".fixed.inset-0")) continue;
    const r = el.getBoundingClientRect();
    if ((r.right > vw + 1 || r.left < -1) && !inScrollableX(el)) {
      overflowers.push({
        tag: el.tagName.toLowerCase(),
        text: (el.innerText || "").trim().replace(/\s+/g, " ").slice(0, 70),
        left: Math.round(r.left),
        right: Math.round(r.right),
      });
    }
  }
  const awardButtons = [...document.querySelectorAll("main button")].filter(
    (b) => /Award/.test(b.innerText || "") && !b.disabled && visible(b) && !/Awarded/.test(b.innerText || "")
  );
  let scanned = null;
  for (const btn of awardButtons) {
    let node = btn;
    let hasLong = false;
    for (let i = 0; i < 8 && node; i++) {
      if ((node.innerText || "").includes(longNeedle)) { hasLong = true; break; }
      node = node.parentElement;
    }
    if (!hasLong) continue;
    btn.scrollIntoView({ block: "center" });
    const r = btn.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const hit = document.elementFromPoint(cx, cy);
    scanned = {
      text: btn.innerText.trim().replace(/\s+/g, " ").slice(0, 90),
      rect: { left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), bottom: Math.round(r.bottom) },
      inViewportX: r.left >= -1 && r.right <= vw + 1,
      inViewportY: r.top >= -1 && r.bottom <= vh + 1,
      hitIsButton: Boolean(hit && (btn === hit || btn.contains(hit))),
    };
    break;
  }
  return {
    viewport: { w: vw, h: vh },
    docOverflowX: document.documentElement.scrollWidth - vw,
    overflowersTotal: overflowers.length,
    overflowers: overflowers.slice(0, 6),
    longNamePresent: document.body.innerText.includes(longNeedle),
    awardCta: scanned,
  };
};

async function deepLinkRun(browser, projectId, { slow }) {
  const ctx = typeof browser.createBrowserContext === "function"
    ? await browser.createBrowserContext()
    : await browser.createIncognitoBrowserContext();
  const page = await ctx.newPage();
  await page.evaluateOnNewDocument(() => {
    window.__qa11UrlLog = [window.location.href];
    setInterval(() => {
      try {
        const log = window.__qa11UrlLog;
        if (log[log.length - 1] !== window.location.href) log.push(window.location.href);
      } catch {}
    }, 100);
  });
  let cdp = null;
  if (slow) {
    cdp = await page.target().createCDPSession();
    await cdp.send("Network.enable");
    await cdp.send("Network.setBlockedURLs", { urls: ["*convex.cloud*"] });
  }
  await page.goto(`${BASE_URL}/?project=${projectId}&tab=leveling`, { waitUntil: "domcontentloaded", timeout: 60000 });
  if (slow) {
    await delay(9500);
    await cdp.send("Network.setBlockedURLs", { urls: [] });
  }
  let ready = true;
  try {
    await page.waitForFunction(
      (id) => {
        const sel = document.querySelector('select[aria-label="Select Commercial Construction Project"]');
        return Boolean(sel && [...sel.options].some((o) => o.value === id));
      },
      { timeout: 60000 },
      projectId
    );
  } catch {
    ready = false;
  }
  await delay(3000);
  const state = await page.evaluate((id) => {
    const sel = document.querySelector('select[aria-label="Select Commercial Construction Project"]');
    const params = new URLSearchParams(window.location.search);
    return {
      href: window.location.href,
      urlProjectParam: params.get("project"),
      urlTabParam: params.get("tab"),
      selectorValue: sel ? sel.value : null,
      selectorSelectedText: sel && sel.selectedIndex >= 0 ? sel.options[sel.selectedIndex].textContent.trim() : null,
      selectorHasProject: sel ? [...sel.options].some((o) => o.value === id) : false,
      urlLog: window.__qa11UrlLog,
    };
  }, projectId);
  await shot(page, slow ? "fix4-qa11-A9-03-slow-deeplink.png" : "fix4-qa11-A9-03-fast-deeplink.png");
  await ctx.close();
  return { ready, ...state };
}

async function main() {
  const { browser } = await launchBrowser(1440, 900);
  const page = await browser.newPage();
  const diagnostics = attachDiagnostics(page);

  // ------------------------------------------------------------ A10-07 UI truth (MAIN, Scope Clash)
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await waitForAppReady(page);
  await selectProjectByTitle(page, "AUDIT-QA11-MAIN");
  await delay(1800);
  await clickHeaderTab(page, "05: Scope Clash");
  await delay(1800);
  const clashUi = await page.evaluate(() => {
    const label = [...document.querySelectorAll("span")].find((s) => s.textContent.trim() === "Recoverable Buyout Credits");
    const card = label ? label.closest("div.rounded-xl") : null;
    const valueEl = card ? card.querySelector(".font-mono") : null;
    const doubleBuyCard = [...document.querySelectorAll("div.rounded-xl")].find((d) => /Redundant Double-Buys/.test(d.innerText));
    const discCard = [...document.querySelectorAll("div.rounded-xl")].find((d) => /Disconnect Switches/.test(d.innerText));
    return {
      kpiValue: valueEl ? valueEl.innerText.trim() : null,
      deductedBadges: [...document.querySelectorAll("span")].filter((s) => /Credit Deducted & Leveled/i.test(s.innerText)).length,
      doubleBuyValue: doubleBuyCard ? (doubleBuyCard.innerText.match(/\$[\d,]+/) || [null])[0] : null,
      disconnectResolution: discCard ? discCard.innerText.split("\n").filter((l) => /Deducted/.test(l)) : null,
      bodyHasStatic38500: document.body.innerText.includes("$38,500"),
      bodySnippet: document.body.innerText.split("\n").filter((l) => /\$48|\$38|\$12,000|\$9,999|Credits/.test(l)).slice(0, 12),
    };
  });
  await shot(page, "fix4-qa11-A10-07-buyout-credits.png");
  const expectedUi = `$${B.expectedUiCreditTotal.toLocaleString("en-US")}`;
  record(
    "A10-07-ui-credit-truth",
    clashUi.kpiValue === expectedUi,
    `UI Recoverable Buyout Credits=${clashUi.kpiValue} expected=${expectedUi} (backend resolution ${B.expectedUiCreditTotal}); deductedCards=${clashUi.deductedBadges}; doubleBuyKpi=${clashUi.doubleBuyValue}; snippet=${JSON.stringify(clashUi.bodySnippet)}`
  );

  // ------------------------------------------------------------ HUNT normal award / unaward UI (MAIN elec)
  await clickHeaderTab(page, "04: Bid Leveling");
  await delay(1500);
  const pkgSwitch = await switchPackageInLeveling(page, "QA11 Electrical Main");
  await delay(500);
  let state = await page.evaluate(() => ({
    awarded: document.body.innerText.includes("Contract Awarded • Draft Generated"),
    hasUnaward: [...document.querySelectorAll("main button")].some((b) => /^Unaward$/.test(b.innerText.trim())),
    trade: (document.body.innerText.match(/CSI ([0-9 ]+)/) || [])[1],
  }));
  const steps = { pkgSwitch, start: state };
  if (!state.awarded) {
    const aw = await clickMainButton(page, "^Award|Award Subcontract & Draft Agreement|Award Compliant Winner");
    steps.award = aw;
    await delay(2800);
    await page.keyboard.press("Escape");
    await delay(600);
    state = await page.evaluate(() => ({ awarded: document.body.innerText.includes("Contract Awarded • Draft Generated") }));
    steps.afterAward = state;
  }
  const unawardClick = await clickMainButton(page, "^Unaward$");
  steps.unaward = unawardClick;
  if (unawardClick.ok) {
    await delay(700);
    steps.confirm = await clickConfirm(page, "^Unaward proposal$");
    steps.toast = await waitToast(page, 5000);
  }
  const afterUnaward = await page.evaluate(() => ({
    awarded: document.body.innerText.includes("Contract Awarded • Draft Generated"),
    bodyHasPackage: document.body.innerText.includes("QA11 Electrical Main"),
  }));
  steps.afterUnaward = afterUnaward;
  await shot(page, "fix4-qa11-hunt-award-unaward.png");
  record(
    "HUNT-ui-award-unaward-normal",
    pkgSwitch.ok && state.awarded === true && unawardClick.ok && steps.confirm && afterUnaward.awarded === false &&
      typeof steps.toast === "string" && /unawarded/i.test(steps.toast),
    `pkgSwitch=${pkgSwitch.ok} awardedAfterAward=${state.awarded} unawardClicked=${unawardClick.ok} toast=${JSON.stringify(steps.toast)} afterUnawardAwarded=${afterUnaward.awarded}`
  );
  const reAward = await clickMainButton(page, "^Award|Award Subcontract & Draft Agreement|Award Compliant Winner");
  await delay(2800);
  const reAwardState = await page.evaluate(() => document.body.innerText.includes("Contract Awarded • Draft Generated"));
  const reAwardKpi = await waitToast(page, 4000);
  await shot(page, "fix4-qa11-hunt-reaward.png");
  await page.keyboard.press("Escape");
  await delay(400);
  record(
    "HUNT-ui-reaward-normal",
    reAward.ok && reAwardState === true,
    `clicked=${reAward.ok} awarded=${reAwardState} toast=${JSON.stringify(reAwardKpi)}`
  );

  // ------------------------------------------------------------ A10-08 mobile long-name
  const hvacSwitch = await switchPackageInLeveling(page, "QA11 HVAC Main");
  await delay(800);
  const longNeedle = "Veritably Unreasonably Long";
  const mobileResults = {};
  for (const [label, w, h] of [["320", 320, 700], ["375", 375, 812]]) {
    await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
    await delay(800);
    await selectStage(page, "leveling");
    await delay(1200);
    mobileResults[label] = await page.evaluate(MOBILE_SCAN, longNeedle);
    await shot(page, `fix4-qa11-A10-08-${label}.png`);
  }
  const m320 = mobileResults["320"];
  const m375 = mobileResults["375"];
  record(
    "A10-08-mobile-overflow-cta",
    hvacSwitch.ok &&
      m320.longNamePresent &&
      m375.longNamePresent &&
      m320.docOverflowX === 0 &&
      m375.docOverflowX === 0 &&
      m320.awardCta &&
      m320.awardCta.inViewportX &&
      m320.awardCta.hitIsButton &&
      m375.awardCta &&
      m375.awardCta.inViewportX &&
      m375.awardCta.hitIsButton,
    `hvacSwitch=${hvacSwitch.ok}; 320: overflowX=${m320.docOverflowX} overflowers=${m320.overflowersTotal} long=${m320.longNamePresent} cta=${JSON.stringify(m320.awardCta)}; 375: overflowX=${m375.docOverflowX} overflowers=${m375.overflowersTotal} long=${m375.longNamePresent} cta=${JSON.stringify(m375.awardCta)}`
  );
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  await delay(600);

  // ------------------------------------------------------------ A9-01 zero-contractor dispatch
  await selectProjectByTitle(page, "AUDIT-QA11-PLAIN");
  await delay(1800);
  await clickHeaderTab(page, "01: CSI Scoping");
  await delay(1000);
  const dispatchZero = await clickMainButton(page, "Dispatch RFQs", { exact: "Dispatch RFQs" });
  const dispatchZeroResult = await page.evaluate((needle) => {
    const cards = [...document.querySelectorAll("main div")].filter((d) => (d.innerText || "").includes(needle) && d.querySelector("button"));
    const card = cards[cards.length - 1];
    if (!card) return null;
    const btn = [...card.querySelectorAll("button")].find((b) => (b.innerText || "").trim() === "Dispatch RFQs");
    if (!btn) return null;
    btn.click();
    return { ok: true };
  }, "QA11 Electrical Plain");
  await delay(1800);
  const toastZero = await waitToast(page, 6000);
  await shot(page, "fix4-qa11-A9-01-zero-contractor-dispatch.png");
  record(
    "A9-01-zero-contractor-dispatch",
    Boolean(dispatchZeroResult) &&
      typeof toastZero === "string" &&
      /No contractors have been discovered/i.test(toastZero) &&
      !/Something went wrong/i.test(toastZero),
    `toast=${JSON.stringify(toastZero)}`
  );

  // ------------------------------------------------------------ HUNT normal dispatch with contractors
  await selectProjectByTitle(page, "AUDIT-QA11-MAIN");
  await delay(1800);
  await clickHeaderTab(page, "01: CSI Scoping");
  await delay(1000);
  const dispatchMainResult = await page.evaluate((needle) => {
    const cards = [...document.querySelectorAll("main div")].filter((d) => (d.innerText || "").includes(needle) && d.querySelector("button"));
    const card = cards[cards.length - 1];
    if (!card) return null;
    const btn = [...card.querySelectorAll("button")].find((b) => (b.innerText || "").trim() === "Dispatch RFQs");
    if (!btn) return null;
    btn.click();
    return { ok: true };
  }, "QA11 Electrical Main");
  await delay(3000);
  const toastDispatch = await waitToast(page, 6000);
  await shot(page, "fix4-qa11-hunt-normal-dispatch.png");
  record(
    "HUNT-normal-dispatch-contractors",
    Boolean(dispatchMainResult) &&
      typeof toastDispatch === "string" &&
      !/Something went wrong/i.test(toastDispatch) &&
      /RFQ/i.test(toastDispatch),
    `toast=${JSON.stringify(toastDispatch)}`
  );

  // ------------------------------------------------------------ A9-02 UI guard + normal delete file
  await selectProjectByTitle(page, "AUDIT-QA11-INGEST");
  await delay(1800);
  await clickHeaderTab(page, "01: CSI Scoping");
  await delay(1200);
  const fileGuard = await page.evaluate(() => {
    const h = [...document.querySelectorAll("h4")].find((x) => /AUDIT-QA11-Quote\.txt/.test(x.innerText));
    if (!h) return { found: false };
    const row = h.closest("div.p-4") || h.parentElement.parentElement.parentElement;
    const btn = row.querySelector('button[title="Delete file from storage"]');
    if (!btn) return { found: true, btn: false };
    btn.click();
    return { found: true, btn: true };
  });
  let guardBanner = null;
  let guardVisibility = null;
  if (fileGuard.btn) {
    await delay(700);
    await clickConfirm(page, "^Delete file$");
    guardVisibility = await page.evaluate(() => {
      const bannerSpan = [...document.querySelectorAll("span")].find((s) => /Delete failed:|File deleted from storage/.test(s.innerText));
      let occluded = null;
      if (bannerSpan) {
        const r = bannerSpan.getBoundingClientRect();
        const x = Math.min(Math.max(r.left + 5, 1), window.innerWidth - 2);
        const y = Math.min(Math.max(r.top + 2, 1), window.innerHeight - 2);
        const top = document.elementFromPoint(x, y);
        occluded = top ? !(bannerSpan === top || bannerSpan.contains(top)) : null;
      }
      const dlg = [...document.querySelectorAll('[role="alertdialog"]')].filter((e) => e.getBoundingClientRect().width > 0).pop();
      const inline = dlg ? dlg.querySelector('[role="alert"]') : null;
      return {
        bannerText: bannerSpan ? bannerSpan.innerText.trim() : null,
        bannerOccluded: occluded,
        dialogOpen: Boolean(dlg),
        inlineAlert: inline ? inline.innerText.trim() : null,
      };
    });
    guardBanner = guardVisibility.bannerText;
  }
  await shot(page, "fix4-qa11-A9-02-file-delete-guard.png");
  const guardReasonVisible =
    guardVisibility &&
    ((guardVisibility.bannerOccluded === false && /linked to a bid/i.test(guardVisibility.bannerText || "")) ||
      /linked to a bid/i.test(guardVisibility.inlineAlert || ""));
  record(
    "A9-02-ui-linked-file-guard",
    fileGuard.found &&
      typeof guardBanner === "string" &&
      /linked to a bid/i.test(guardBanner) &&
      !/Something went wrong/i.test(guardBanner) &&
      guardReasonVisible,
    `guardReasonInDom=${/linked to a bid/i.test(guardBanner || "")}; visibleToUser=${guardReasonVisible}; bannerOccluded=${guardVisibility ? guardVisibility.bannerOccluded : null}; dialogOpen=${guardVisibility ? guardVisibility.dialogOpen : null}; inlineAlert=${JSON.stringify(guardVisibility ? guardVisibility.inlineAlert : null)}`
  );

  // normal delete flow: remove bid in leveling, then delete the file successfully
  await clickHeaderTab(page, "04: Bid Leveling");
  await delay(1500);
  await page.keyboard.press("Escape");
  await delay(300);
  const ingSwitch = await switchPackageInLeveling(page, "QA11 Electrical Ingest");
  const ingLevelingState = await page.evaluate(() => ({
    hasDel: [...document.querySelectorAll("main button[title='Delete proposal'], main button[title='Delete Bid Proposal']")].some((b) => b.getBoundingClientRect().width > 0),
    bodyHasIngest: document.body.innerText.includes("QA11 Electrical Ingest"),
  }));
  const delBid = await page.evaluate(() => {
    const b = [...document.querySelectorAll("main button[title='Delete proposal'], main button[title='Delete Bid Proposal']")].find((x) => x.getBoundingClientRect().width > 0);
    if (!b) return { ok: false };
    b.click();
    return { ok: true };
  });
  let bidDeleted = false;
  if (delBid.ok) {
    await delay(700);
    await clickConfirm(page, "^Delete proposal$");
    bidDeleted = !(await page.evaluate(() => document.body.innerText.includes("AUDIT-QA11 Ingest Electric")));
  }
  await selectProjectByTitle(page, "AUDIT-QA11-INGEST");
  await delay(1200);
  await clickHeaderTab(page, "01: CSI Scoping");
  await delay(1200);
  const fileRow2 = await page.evaluate(() => {
    const h = [...document.querySelectorAll("h4")].find((x) => /AUDIT-QA11-Quote\.txt/.test(x.innerText));
    if (!h) return null;
    const row = h.closest("div.p-4") || h.parentElement.parentElement.parentElement;
    const btn = row.querySelector('button[title="Delete file from storage"]');
    if (!btn) return null;
    btn.click();
    return true;
  });
  let normalFileBanner = null;
  let fileGone = false;
  if (fileRow2) {
    await delay(700);
    await clickConfirm(page, "^Delete file$");
    normalFileBanner = await page.evaluate(() => {
      const el = [...document.querySelectorAll("span")].find((s) => /Delete failed:|File deleted from storage/.test(s.innerText));
      return el ? el.innerText.trim() : null;
    });
    fileGone = !(await page.evaluate(() => document.body.innerText.includes("AUDIT-QA11-Quote.txt")));
  }
  record(
    "HUNT-normal-bid-and-file-delete",
    (ingSwitch.ok || ingLevelingState.hasDel) &&
      bidDeleted &&
      fileRow2 &&
      typeof normalFileBanner === "string" &&
      /File deleted from storage/i.test(normalFileBanner),
    `ingSwitch=${ingSwitch.ok} hasDel=${ingLevelingState.hasDel} bidDeleted=${bidDeleted} fileBanner=${JSON.stringify(normalFileBanner)} fileGone=${fileGone}`
  );

  // ------------------------------------------------------------ A8-01 download filename
  await selectProjectByTitle(page, "AUDIT-QA11-CYCLE");
  await delay(2200);
  await clickHeaderTab(page, "06: Subcontracts");
  await delay(1800);
  const downloadDir = path.resolve("evidence", "fix4-qa11-downloads");
  fs.mkdirSync(downloadDir, { recursive: true });
  for (const f of fs.existsSync(downloadDir) ? fs.readdirSync(downloadDir) : []) {
    try { fs.unlinkSync(path.join(downloadDir, f)); } catch {}
  }
  const inspectBtn = await page.evaluate(() => {
    const b = [...document.querySelectorAll("main button")].find((x) => /Inspect Draft/.test(x.innerText || ""));
    if (!b) return null;
    b.click();
    return true;
  });
  await delay(1000);
  const cdp = await page.target().createCDPSession();
  await cdp.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: downloadDir, eventsEnabled: true });
  const suggestions = [];
  cdp.on("Browser.downloadWillBegin", (e) => suggestions.push(e.suggestedFilename));
  await page.evaluate(() => {
    window.__qa11Dl = null;
    const orig = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      try { window.__qa11Dl = this.getAttribute("download"); } catch {}
      return orig.apply(this, arguments);
    };
  });
  const dlBtn = await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => (x.getAttribute("title") || "") === "Download subcontract agreement text file");
    if (!b) return null;
    b.click();
    return true;
  });
  await delay(2000);
  const hookedName = await page.evaluate(() => window.__qa11Dl);
  const diskFiles = fs.existsSync(downloadDir) ? fs.readdirSync(downloadDir) : [];
  const finalName = suggestions[0] || hookedName || diskFiles[0] || null;
  await shot(page, "fix4-qa11-A8-01-contract-download.png");
  record(
    "A8-01-download-filename",
    Boolean(inspectBtn && dlBtn) && typeof finalName === "string" && !/AIA_A401/i.test(finalName) && /A401-style/i.test(finalName),
    `inspect=${Boolean(inspectBtn)} download=${Boolean(dlBtn)} suggested=${JSON.stringify(suggestions)} hooked=${JSON.stringify(hookedName)} disk=${JSON.stringify(diskFiles)}`
  );

  // ------------------------------------------------------------ A8-02 audit header + A8-04 source check
  await page.keyboard.press("Escape");
  await delay(400);
  await clickHeaderTab(page, "Live Activity Audit");
  await delay(1500);
  const auditUi = await page.evaluate(() => {
    const text = document.body.innerText;
    return {
      headerHasAiaSubcontractAwards: /AIA subcontract awards/i.test(text),
      headerHasA401Drafts: /A401-style subcontract drafts/i.test(text),
      aiaAwardTitles: (text.match(/AIA A401[^\n]*/g) || []).slice(0, 6),
      ingestFailedRows: [...document.querySelectorAll("span")].filter((s) => /bid ingest failed/i.test(s.innerText)).length,
    };
  });
  await shot(page, "fix4-qa11-A8-02-audit-header.png");
  record(
    "A8-02-audit-header-wording",
    auditUi.headerHasA401Drafts && !auditUi.headerHasAiaSubcontractAwards,
    `hasA401Drafts=${auditUi.headerHasA401Drafts} hasAIA-subcontract-awards=${auditUi.headerHasAiaSubcontractAwards} residualAiaTitles=${JSON.stringify(auditUi.aiaAwardTitles)}`
  );
  const streamSrc = fs.readFileSync(path.resolve("src/components/ActivityAuditStreamView.tsx"), "utf8");
  const iconOk = /case "bid_ingest_failed":\s*\n\s*return <AlertTriangle[^>]*text-rose-400/.test(streamSrc);
  const badgeOk = /case "bid_ingest_failed":\s*\n\s*return "bg-rose-950\/80 text-rose-300 border-rose-800\/60"/.test(streamSrc);
  record(
    "A8-04-ingest-failed-icon-source",
    iconOk && badgeOk,
    `icon=${iconOk} badge=${badgeOk} liveRows=${auditUi.ingestFailedRows} (writer is internalAction-only; no public path to create one)`
  );

  // ------------------------------------------------------------ A5-02 executed unaward inline
  await selectProjectByTitle(page, "AUDIT-QA11-EXEC");
  await delay(1800);
  await clickHeaderTab(page, "04: Bid Leveling");
  await delay(1500);
  const unawardExec = await clickMainButton(page, "^Unaward$");
  let a502 = { found: unawardExec.ok };
  if (unawardExec.ok) {
    await delay(700);
    a502.confirm = await clickConfirm(page, "^Unaward proposal$");
    a502.after = await page.evaluate(() => {
      const dlgs = [...document.querySelectorAll('[role="alertdialog"]')].filter((e) => e.getBoundingClientRect().width > 0);
      const top = dlgs[dlgs.length - 1];
      const alert = top ? top.querySelector('[role="alert"]') : null;
      return {
        dialogOpen: Boolean(top),
        dialogsOpen: dlgs.length,
        inlineAlert: alert ? alert.innerText.trim() : null,
        outsideAlerts: [...document.querySelectorAll('[role="status"]')].map((e) => e.innerText.trim()).slice(0, 3),
        confirmButtonText: top ? ([...top.querySelectorAll("button")].map((b) => b.innerText.trim()).filter((t) => /Unaward|Working/.test(t))[0] || null) : null,
      };
    });
    await shot(page, "fix4-qa11-A5-02-unaward-inline.png");
  }
  record(
    "A5-02-unaward-inline-refusal",
    a502.found &&
      a502.confirm &&
      a502.after &&
      a502.after.dialogOpen &&
      typeof a502.after.inlineAlert === "string" &&
      /Executed agreements are immutable/i.test(a502.after.inlineAlert),
    `inlineAlert=${JSON.stringify(a502.after ? a502.after.inlineAlert : null)} dialogOpen=${a502.after ? a502.after.dialogOpen : null} outside=${JSON.stringify(a502.after ? a502.after.outsideAlerts : null)}`
  );
  await page.keyboard.press("Escape");
  await delay(400);

  // ------------------------------------------------------------ A9-03 deep link
  const fast = await deepLinkRun(browser, F.plainProjectId, { slow: false });
  record(
    "A9-03-deep-link-fast",
    fast.ready && fast.urlProjectParam === F.plainProjectId && fast.selectorValue === F.plainProjectId,
    `urlProject=${fast.urlProjectParam} selectorValue=${fast.selectorValue} selectedText=${JSON.stringify(fast.selectorSelectedText)} urlLog=${JSON.stringify(fast.urlLog)}`
  );
  const slow = await deepLinkRun(browser, F.plainProjectId, { slow: true });
  const slowKept = slow.urlProjectParam === F.plainProjectId && slow.selectorValue === F.plainProjectId;
  const slowRewrites = (slow.urlLog || []).filter((u) => !u.includes(`project=${F.plainProjectId}`));
  record(
    "A9-03-deep-link-slow-boot",
    slow.ready && slowKept && slowRewrites.length === 0,
    `ready=${slow.ready} urlProject=${slow.urlProjectParam} selectorValue=${slow.selectorValue} rewrites=${JSON.stringify(slowRewrites)} urlLog=${JSON.stringify(slow.urlLog)}`
  );

  // ------------------------------------------------------------ diagnostics
  await delay(500);
  const consoleErrors = diagnostics.consoleLogs
    .filter((l) => l.type === "error")
    .map((e) => e.text.slice(0, 200));
  const uiDiag = {
    consoleErrors,
    consoleErrorCount: consoleErrors.length,
    pageErrors: diagnostics.pageErrors.slice(0, 10),
    failedRequests: diagnostics.failedRequests.slice(0, 15),
    requestCount: diagnostics.requests.length,
  };
  say(`ui diagnostics: ${JSON.stringify({ consoleErrors: consoleErrors.length, pageErrors: uiDiag.pageErrors.length, failedRequests: uiDiag.failedRequests.length })}`);

  writeEvidence("ui", {
    results,
    clashUi,
    steps,
    mobileResults,
    auditUi,
    download: { suggestions, hookedName, diskFiles, finalName },
    deepLink: { fast, slow },
    a502: a502.after,
    diagnostics: uiDiag,
  });
  writeLog("ui", log);
  console.log(`\nui results: ${results.filter((r) => r.pass).length}/${results.length} passed`);
  await browser.close();
}

main().catch(async (e) => {
  console.error(e);
  writeLog("ui-crash", [String(e?.stack ?? e)]);
  process.exit(1);
});