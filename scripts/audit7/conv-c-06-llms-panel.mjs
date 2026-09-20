/**
 * CONV-C 06 (audit-6 check 7): Diagnostics /llms.txt panel — badge truth and
 * <pre> content equality with the live endpoint body.
 */
import fs from "node:fs";
import path from "node:path";
import { openApp, clickTab, writeEvidence, delay } from "./lib.mjs";

const out = { startedAt: new Date().toISOString() };
const liveRes = await fetch("https://brainy-skunk-440.convex.site/llms.txt", { redirect: "follow" });
const liveBody = await liveRes.text();
out.live = { status: liveRes.status, bytes: liveBody.length, sha: null };

const { browser, page } = await openApp(1440, 900);
try {
  await clickTab(page, "Evals & Architecture");
  await delay(2500);
  // wait for the panel to settle (badge text present)
  for (let i = 0; i < 30; i++) {
    const t = await page.evaluate(() => document.body.innerText);
    if (/Live endpoint content \(fetched now\)|Live fetch unavailable/.test(t)) break;
    await delay(500);
  }
  out.panel = await page.evaluate(() => {
    const heading = [...document.querySelectorAll("h3")].find((h) => /Discoverability Endpoint/.test(h.textContent || ""));
    let card = heading;
    for (let i = 0; i < 8 && card && !card.querySelector("pre"); i++) card = card.parentElement;
    const text = card ? card.innerText : "";
    const badge = (text.split("\n").find((l) => /Live endpoint content|Live fetch unavailable|Fetching/.test(l)) || "").trim();
    const pre = card ? card.querySelector("pre") : null;
    const endpoint = (text.split("\n").find((l) => /GET https?:\/\//.test(l)) || "").trim();
    return {
      heading: heading ? heading.textContent.trim() : null,
      badge,
      endpoint,
      preText: pre ? pre.textContent : null,
      preBytes: pre ? pre.textContent.length : 0,
    };
  });
  await page.screenshot({ path: path.join(process.cwd(), "evidence", "fix6-conv-c-06-llms-panel.png") });

  const a = (out.panel.preText || "").replace(/\r\n/g, "\n").trim();
  const b = liveBody.replace(/\r\n/g, "\n").trim();
  out.compare = {
    equal: a === b,
    panelBytes: a.length,
    liveBytes: b.length,
    firstDiffIndex: a === b ? -1 : (() => {
      const n = Math.min(a.length, b.length);
      for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i;
      return n;
    })(),
    panelSnippet: a.slice(0, 300),
    liveSnippet: b.slice(0, 300),
  };
  // verify the panel's fetch is same-origin app response (compare against an in-page fetch too)
  out.inPageFetchMatches = await page.evaluate(async (expected) => {
    const r = await fetch("/llms.txt");
    const t = await r.text();
    return { status: r.status, equal: t.replace(/\r\n/g, "\n").trim() === expected.replace(/\r\n/g, "\n").trim() };
  }, liveBody);
} catch (err) {
  out.error = String(err?.stack ?? err);
} finally {
  await browser.close();
}
writeEvidence("fix6-conv-c-06-llms-panel.json", out);
console.log(JSON.stringify({ live: out.live, panel: { heading: out.panel?.heading, badge: out.panel?.badge, endpoint: out.panel?.endpoint, preBytes: out.panel?.preBytes }, compare: out.compare, inPageFetchMatches: out.inPageFetchMatches, error: out.error }, null, 1));