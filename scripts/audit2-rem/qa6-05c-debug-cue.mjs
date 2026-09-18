import { gotoDemo, launchBrowser, delay } from "./qa6-lib.mjs";

const run = async () => {
  const { browser } = await launchBrowser(1440, 900);
  const page = await browser.newPage();
  try {
    await gotoDemo(page);
    await delay(400);
    const info = await page.evaluate(() => {
      const cueBtn = [...document.querySelectorAll("button")].find((b) => (b.getAttribute("title") || "").includes("full presenter script"));
      if (!cueBtn) return { error: "no cue button" };
      const span = cueBtn.querySelector("span.truncate");
      const cs = span ? getComputedStyle(span) : null;
      let rangeInfo = null;
      if (span) {
        const tn = [];
        const walk = (n) => {
          for (const c of n.childNodes) {
            if (c.nodeType === 3 && c.textContent.trim().length > 1) tn.push(c);
            else if (c.nodeType === 1) walk(c);
          }
        };
        walk(span);
        const textNode = tn[tn.length - 1];
        const r = document.createRange();
        r.setStart(textNode, 0);
        r.setEnd(textNode, textNode.length);
        const rects = [...r.getClientRects()].map((x) => ({ l: Math.round(x.left), r: Math.round(x.right), t: Math.round(x.top), b: Math.round(x.bottom), w: Math.round(x.width) }));
        rangeInfo = { textLen: textNode.length, rects, fullW: Math.round(r.getBoundingClientRect().width), fullH: Math.round(r.getBoundingClientRect().height) };
      }
      const truncateRule = (() => {
        for (const sheet of document.styleSheets) {
          let rules;
          try {
            rules = sheet.cssRules;
          } catch {
            continue;
          }
          for (const rule of rules) {
            if (rule.selectorText && rule.selectorText.includes(".truncate") && rule.selectorText.includes("white-space")) return rule.cssText;
          }
        }
        return null;
      })();
      return {
        btnHtml: cueBtn.outerHTML.slice(0, 400),
        spanClass: span ? span.className : null,
        spanOuter: span ? span.outerHTML.slice(0, 160) : null,
        computed: cs
          ? {
              whiteSpace: cs.whiteSpace,
              textOverflow: cs.textOverflow,
              overflow: cs.overflow,
              display: cs.display,
              width: cs.width,
              height: cs.height,
              minWidth: cs.minWidth,
              flex: cs.flex,
              overflowWrap: cs.overflowWrap,
              wordBreak: cs.wordBreak,
            }
          : null,
        spanRect: span ? span.getBoundingClientRect().toJSON() : null,
        rangeInfo,
        truncateRule,
      };
    });
    console.log(JSON.stringify(info, null, 1));
  } finally {
    await browser.close();
  }
};
run();