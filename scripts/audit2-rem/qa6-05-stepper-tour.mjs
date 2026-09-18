// QA6-05: stepper 6th stage visibility at 1440x900 + tour talk-track cue visible chars.
import {
  BASE_URL,
  armOpenerByText,
  delay,
  gotoDemo,
  launchBrowser,
  shot,
  writeJson,
  writeLog,
} from "./qa6-lib.mjs";

const STEPPER_PROBE = () => {
  const rect = (el) => {
    const r = el.getBoundingClientRect();
    return { left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), bottom: Math.round(r.bottom), w: Math.round(r.width), h: Math.round(r.height) };
  };
  const btns = [...document.querySelectorAll("header button")].filter((b) => (b.innerText || "").trim());
  const idx = btns.findIndex((b) => (b.innerText || "").includes("Subcontracts"));
  if (idx < 0) return { error: "Subcontracts button not found" };
  const btn = btns[idx];
  const spans = [...btn.querySelectorAll("span")].map((s) => {
    const cs = getComputedStyle(s);
    return {
      text: (s.innerText || "").trim().slice(0, 40),
      rect: rect(s),
      clientW: s.clientWidth,
      scrollW: s.scrollWidth,
      whiteSpace: cs.whiteSpace,
      overflow: cs.overflow,
      textOverflow: cs.textOverflow,
    };
  });
  const labelSpan = [...btn.querySelectorAll("span")].find((s) => (s.innerText || "").trim() === "Subcontracts");
  const ancestors = [];
  let cur = btn.parentElement;
  while (cur && cur !== document.body) {
    const cs = getComputedStyle(cur);
    const r = cur.getBoundingClientRect();
    ancestors.push({
      tag: cur.tagName.toLowerCase(),
      cls: (cur.className || "").toString().slice(0, 90),
      rect: { left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), bottom: Math.round(r.bottom) },
      clientW: cur.clientWidth,
      scrollW: cur.scrollWidth,
      overflowX: cs.overflowX,
      overflowY: cs.overflowY,
      flexWrap: cs.flexWrap,
    });
    if (ancestors.length >= 7) break;
    cur = cur.parentElement;
  }
  const br = btn.getBoundingClientRect();
  const lr = labelSpan ? labelSpan.getBoundingClientRect() : null;
  const clipping = ancestors.filter((a) => a.overflowX !== "visible");
  return {
    button: { text: (btn.innerText || "").trim().replace(/\s+/g, " ").slice(0, 60), rect: rect(btn), ariaCurrent: btn.getAttribute("aria-current") },
    label: labelSpan
      ? { text: labelSpan.innerText.trim(), rect: { left: Math.round(lr.left), right: Math.round(lr.right), w: Math.round(lr.width) }, clientW: labelSpan.clientWidth, scrollW: labelSpan.scrollWidth }
      : null,
    spans,
    ancestors,
    clippingAncestors: clipping.map((a) => ({ cls: a.cls, rect: a.rect, clientW: a.clientW, scrollW: a.scrollW, overflowX: a.overflowX })),
    withinViewport: br.right <= window.innerWidth + 1 && br.left >= -1 && br.bottom <= window.innerHeight + 1,
    clippedByAncestor: ancestors.some((a) => a.overflowX !== "visible" && br.right > a.rect.right + 1),
    midWordClip: labelSpan ? labelSpan.scrollWidth > labelSpan.clientWidth + 1 : null,
    docOverflowX: document.documentElement.scrollWidth > window.innerWidth + 1,
  };
};

const TOUR_PROBE = () => {
  const rect = (el) => {
    const r = el.getBoundingClientRect();
    return { left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
  };
  const cueBtn = [...document.querySelectorAll("button")].find((b) => (b.getAttribute("title") || "").includes("full presenter script"));
  if (!cueBtn) return { error: "cue button not found" };
  const spans = [...cueBtn.querySelectorAll("span")];
  const span =
    spans.find((s) => s.querySelector("strong") && (s.querySelector("strong").innerText || "").trim() === "Cue:") ||
    cueBtn.querySelector("span.truncate") ||
    spans.find((s) => (s.className || "").toString().includes("truncate"));
  if (!span) return { error: "cue truncate span not found" };
  const textNodes = [];
  const walk = (n) => {
    for (const c of n.childNodes) {
      if (c.nodeType === 3 && c.textContent.trim().length > 1) textNodes.push(c);
      else if (c.nodeType === 1) walk(c);
    }
  };
  walk(span);
  const textNode = textNodes[textNodes.length - 1] || null;
  const text = textNode ? textNode.textContent : "";
  const spanRect = span.getBoundingClientRect();
  const strong = span.querySelector("strong");
  const strongW = strong ? strong.getBoundingClientRect().width : 0;
  let textFullW = 0;
  if (textNode) {
    const full = document.createRange();
    full.setStart(textNode, 0);
    full.setEnd(textNode, textNode.length);
    textFullW = Math.round(full.getBoundingClientRect().width);
  }
  let caretChars = null;
  try {
    const cr = document.caretRangeFromPoint(spanRect.right - 2, spanRect.top + spanRect.height / 2);
    if (cr && cr.startContainer === textNode) caretChars = cr.startOffset;
  } catch {}
  const avail = Math.max(0, spanRect.width - strongW);
  const proportional = textFullW > 0 ? Math.round(text.length * Math.min(1, avail / textFullW)) : 0;
  const visibleChars = caretChars != null && caretChars <= text.length ? Math.min(caretChars, proportional > 0 ? proportional + 8 : caretChars) : proportional;
  const visibleText = text.slice(0, visibleChars);
  const cs = getComputedStyle(cueBtn);
  const spanCs = getComputedStyle(span);
  const keyMetric = [...document.querySelectorAll("span")].find((s) => (s.className || "").toString().includes("2xl:inline-flex"));
  return {
    cueButton: { rect: rect(cueBtn), clientW: cueBtn.clientWidth, scrollW: cueBtn.scrollWidth, minWidth: cs.minWidth, flex: cs.flex, overflow: cs.overflow },
    cueSpan: {
      rect: rect(span),
      clientW: span.clientWidth,
      scrollW: span.scrollWidth,
      whiteSpace: spanCs.whiteSpace,
      textOverflow: spanCs.textOverflow,
      overflow: spanCs.overflow,
    },
    cueStrong: strong ? { text: strong.innerText, rect: rect(strong), width: Math.round(strongW) } : null,
    textLen: text.trim().length,
    textFullW,
    caretChars,
    visibleChars,
    visibleRatio: text.trim().length ? Math.round((visibleChars / text.trim().length) * 1000) / 1000 : 0,
    visibleTextSample: visibleText.replace(/\s+/g, " ").slice(0, 160),
    keyMetric: keyMetric
      ? { text: keyMetric.innerText.trim(), display: getComputedStyle(keyMetric).display, visible: keyMetric.getBoundingClientRect().width > 0, cls: (keyMetric.className || "").toString().slice(0, 90) }
      : null,
  };
};

const run = async () => {
  const { browser } = await launchBrowser(1440, 900);
  const page = await browser.newPage();
  const out = { url: BASE_URL, viewport: "1440x900", startedAt: new Date().toISOString() };
  const lines = [];
  try {
    out.project = await gotoDemo(page);
    await delay(400);
    out.stepper = await page.evaluate(STEPPER_PROBE);
    await shot(page, "fix4-qa6-05-stepper-1440.png");
    const s = out.stepper;
    lines.push(`STEPPER 6th: text="${s.button && s.button.text}" rect=${JSON.stringify(s.button && s.button.rect)} withinViewport=${s.withinViewport} clippedByAncestor=${s.clippedByAncestor} midWordClip=${s.midWordClip} labelClientW=${s.label && s.label.clientW} labelScrollW=${s.label && s.label.scrollW}`);
    (s.clippingAncestors || []).forEach((a) => lines.push(`   clipAncestor overflowX=${a.overflowX} clientW=${a.clientW} scrollW=${a.scrollW} rect=${JSON.stringify(a.rect)} cls=${a.cls}`));
    lines.push(`   docOverflowX=${s.docOverflowX}`);
    console.log(lines[lines.length - 1]);

    out.tourInitiallyOpen = await page.evaluate(() =>
      [...document.querySelectorAll("button")].some((b) => (b.getAttribute("title") || "").includes("full presenter script"))
    );
    if (!out.tourInitiallyOpen) {
      const tourOpen = await armOpenerByText(page, "Demo Tour");
      if (tourOpen) {
        await page.mouse.click(tourOpen.x, tourOpen.y);
        await delay(800);
      }
    }
    const cueReady = await page.evaluate(() =>
      [...document.querySelectorAll("button")].some((b) => (b.getAttribute("title") || "").includes("full presenter script"))
    );
    if (cueReady) {
      out.tour = await page.evaluate(TOUR_PROBE);
      await shot(page, "fix4-qa6-05-tour-cue-1440.png");
      const t = out.tour;
      lines.push(
        `TOUR CUE: visibleChars=${t.visibleChars}/${t.textLen} ratio=${t.visibleRatio} spanClientW=${t.cueSpan && t.cueSpan.clientW} spanScrollW=${t.cueSpan && t.cueSpan.scrollW} buttonMinWidth=${t.cueButton && t.cueButton.minWidth} keyMetricDisplay=${t.keyMetric && t.keyMetric.display} keyMetricVisible=${t.keyMetric && t.keyMetric.visible}`
      );
      lines.push(`   sample="${t.visibleTextSample}"`);
      console.log(lines[lines.length - 2]);
      console.log(lines[lines.length - 1]);
    } else {
      lines.push("TOUR: cue not found even after toggle attempt");
    }
    writeJson("fix4-qa6-05-stepper-tour.json", out);
    writeLog("fix4-qa6-05-stepper-tour.log", lines);
  } finally {
    await browser.close();
  }
};
run();