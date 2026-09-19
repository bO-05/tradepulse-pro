import { launchBrowser, attachDiagnostics, waitForAppReady, delay, shot } from "./lib.mjs";
import { readEvidence, writeEvidence, writeLog } from "./qa18-lib.mjs";

const fx = readEvidence("fixtures");
const BASE = "https://brainy-skunk-440.convex.site";
const log = [];
const say = (s) => { log.push(s); console.log(s); };
const out = {};

async function focusInfo(page) {
  return page.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body) return { tag: "BODY" };
    return {
      tag: el.tagName,
      aria: el.getAttribute("aria-label"),
      text: (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 70),
      type: el.getAttribute("type"),
      disabled: el.disabled === true,
      tabindex: el.getAttribute("tabindex"),
      inDialog: !!el.closest('[role="dialog"]'),
    };
  });
}

async function tabThrough(page, steps, label) {
  const seq = [];
  for (let i = 0; i < steps; i++) {
    await page.keyboard.press("Tab");
    const info = await focusInfo(page);
    seq.push(info);
  }
  say(`[${label}] focus sequence (${seq.length}):`);
  seq.forEach((s, i) => say(`  ${i + 1}. ${s.tag} aria=${s.aria || "-"} text="${s.text}" dialog=${s.inDialog}`));
  return seq;
}

async function main() {
  const { browser } = await launchBrowser(1440, 950);
  const page = await browser.newPage();
  const diag = attachDiagnostics(page);
  await page.goto(`${BASE}/?project=${fx.vol.id}&tab=packages&qa18=kbd`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await waitForAppReady(page, 60000);
  await page.evaluate(() => document.body.focus());

  const nonFocusableClickables = await page.evaluate(() => {
    const candidates = [...document.querySelectorAll("div, span, li, h3, p")].filter((el) => {
      const s = getComputedStyle(el);
      return s.cursor === "pointer" && !el.closest("button") && !el.closest("a") && !el.closest("select") && !el.closest("label");
    });
    return candidates.slice(0, 40).map((el) => ({
      tag: el.tagName,
      text: (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 60),
      tabindex: el.getAttribute("tabindex"),
      role: el.getAttribute("role"),
    }));
  });
  say(`non-focusable pointer-cursor elements on Packages tab: ${nonFocusableClickables.length}`);
  nonFocusableClickables.slice(0, 20).forEach((e) => say(`  <${e.tag}> tabindex=${e.tabindex} role=${e.role} "${e.text}"`));
  out.nonFocusableClickables = nonFocusableClickables;

  const seq1 = await tabThrough(page, 45, "packages-tab");
  out.seqPackages = seq1;
  await shot(page, "fix4-qa18-kbd-packages.png");

  // Find whether a package card is reachable in the sequence
  const pkgReached = seq1.some((s) => s.text.includes("AUDIT-QA18-VOL Package"));
  say(`package card reached via Tab in first 45 stops: ${pkgReached}`);
  out.packageCardReached = pkgReached;

  // Move focus to stepper Bid Leveling button via keyboard: reset focus then tab until match
  const reach = async (matcher, max = 120) => {
    await page.evaluate(() => document.body.focus());
    for (let i = 0; i < max; i++) {
      await page.keyboard.press("Tab");
      const info = await focusInfo(page);
      if (matcher(info)) return { found: true, stops: i + 1, info };
    }
    return { found: false };
  };

  const lvlBtn = await reach((i) => i.tag === "BUTTON" && i.text.includes("Bid Leveling"));
  say(`reach Bid Leveling stepper: ${JSON.stringify(lvlBtn)}`);
  out.reachLevelingStepper = lvlBtn;
  if (lvlBtn.found) {
    await page.keyboard.press("Enter");
    await delay(1500);
  }

  const ingestBtn = await reach((i) => i.tag === "BUTTON" && i.text.includes("Ingest Quote"));
  say(`reach Ingest Quote button: ${JSON.stringify(ingestBtn)}`);
  out.reachIngestButton = ingestBtn;
  if (ingestBtn.found) {
    await page.keyboard.press("Enter");
    await delay(600);
    const dialogOpen = await page.evaluate(() => !!document.querySelector('[role="dialog"]'));
    const focusInDialog = await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'));
    say(`ingest dialog open=${dialogOpen} focusInsideOnOpen=${focusInDialog}`);
    out.ingestDialog = { dialogOpen, focusInDialog };
    await shot(page, "fix4-qa18-kbd-ingest.png");
    const seqDlg = [];
    for (let i = 0; i < 14; i++) {
      await page.keyboard.press("Tab");
      seqDlg.push(await focusInfo(page));
    }
    say(`ingest dialog tab seq:`);
    seqDlg.forEach((s, i) => say(`  ${i + 1}. ${s.tag} aria=${s.aria || "-"} "${s.text}"`));
    out.ingestDialogSeq = seqDlg;
    await page.keyboard.press("Escape");
    await delay(400);
    const closed = await page.evaluate(() => !document.querySelector('[role="dialog"]'));
    say(`ingest closed after Escape=${closed}`);
    out.ingestEscape = closed;
  }

  // QnA RFI reachability
  const qnaBtn = await reach((i) => i.tag === "BUTTON" && i.text.includes("Pre-Bid Q&A"));
  say(`reach Pre-Bid Q&A stepper: ${JSON.stringify(qnaBtn)}`);
  out.reachQnaStepper = qnaBtn;
  if (qnaBtn.found) {
    await page.keyboard.press("Enter");
    await delay(1500);
    const rfiTarget = await reach((i) => i.aria === "Target trade package for this RFI", 150);
    say(`reach RFI target select: ${JSON.stringify(rfiTarget)}`);
    out.reachRfiTarget = rfiTarget;
    const rfiQuestion = await reach((i) => i.aria === "Subcontractor question", 150);
    say(`reach RFI question textarea: ${JSON.stringify(rfiQuestion)}`);
    out.reachRfiQuestion = rfiQuestion;
  }

  // package cards inside a package view - keyboard selection check
  const cardInfo = await page.evaluate(() => {
    const cards = [...document.querySelectorAll("h3")].filter((h) => (h.textContent || "").includes("AUDIT-QA18-VOL Package"));
    const card = cards[0] ? cards[0].closest("div.cursor-pointer") : null;
    if (!card) return { found: false, cards: cards.length };
    return { found: true, tabindex: card.getAttribute("tabindex"), role: card.getAttribute("role"), tag: card.tagName };
  });
  say(`package card element: ${JSON.stringify(cardInfo)}`);
  out.packageCardEl = cardInfo;

  out.pageErrors = diag.pageErrors.slice(0, 5);
  writeEvidence("keyboard", out);
  writeLog("keyboard", log);
  await browser.close();
  console.log("done");
}

main().catch((e) => {
  console.error(e);
  writeLog("keyboard-crash", [String(e && e.stack ? e.stack : e)]);
  process.exit(1);
});