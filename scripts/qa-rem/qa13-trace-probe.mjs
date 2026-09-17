// QA-13 trace data-flow probe: capture WebSocket frames + drawer DOM for item 7a.
// Usage: node scripts/qa-rem/qa13-trace-probe.mjs
import {
  launchBrowser,
  attachDiagnostics,
  shot,
  waitForAppReady,
  delay,
  BASE_URL,
  writeLog,
} from "./qa1-lib.mjs";

const LOG = [];
const ev = (s) => {
  LOG.push(s);
  console.log(s);
};
const J = (o, max = 500) => {
  const s = typeof o === "string" ? o : JSON.stringify(o);
  return s.length > max ? s.slice(0, max) + "..." : s;
};

async function run() {
  const { browser } = await launchBrowser();
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(30000);
    attachDiagnostics(page);
    await page.evaluateOnNewDocument(() => {
      try {
        localStorage.setItem("tradepulse.tourDismissed", "1");
      } catch (e) {}
    });

    const frames = [];
    page.on("websocket", (ws) => {
      ws.on("framereceived", (event) => {
        const payload = typeof event === "string" ? event : event.payload;
        if (payload && typeof payload === "string") frames.push(payload);
      });
    });

    ev("### trace data-flow probe");
    await page.goto(`${BASE_URL}/?tab=diagnostics`, { waitUntil: "domcontentloaded" });
    await waitForAppReady(page);
    await delay(3500);

    const handles = await page.$$("button");
    let clicked = false;
    for (const h of handles) {
      const t = await h.evaluate((el) => (el.textContent || "").trim());
      if (t === "Inspect") {
        await h.evaluate((el) => el.scrollIntoView({ block: "center" }));
        await h.click();
        clicked = true;
        break;
      }
    }
    await delay(2000);
    ev(`clicked Inspect=${clicked}; captured ws frames=${frames.length}`);

    const evalFrames = frames.filter((f) => f.includes("getLatestEvalRun") || f.includes("systemPrompt"));
    ev(`frames mentioning getLatestEvalRun/systemPrompt: ${evalFrames.length}`);
    let sysPromptFrame = null;
    for (const f of evalFrames) {
      if (f.includes("systemPrompt")) {
        sysPromptFrame = f;
        break;
      }
    }
    if (sysPromptFrame) {
      const idx = sysPromptFrame.indexOf("systemPrompt");
      ev(`WS frame contains systemPrompt. Snippet: ${J(sysPromptFrame.slice(Math.max(0, idx - 80), idx + 200), 320)}`);
      ev(`WS frame contains rawResponse: ${sysPromptFrame.includes("rawResponse")}`);
    } else {
      ev("NO captured WS frame contained systemPrompt (may be a query response not captured or field absent).");
      const anyTrace = frames.find((f) => f.includes("agentTraces") || f.includes("case-23-02") || f.includes("hill-country"));
      if (anyTrace) {
        ev(`A frame mentions traces; snippet: ${J(anyTrace, 400)}`);
      }
    }

    const dom = await page.evaluate(() => {
      const trs = [...document.querySelectorAll("tr")];
      const drawerTr = trs.find((tr) => (tr.innerText || "").includes("Execution Trace:"));
      if (!drawerTr) return { drawerFound: false };
      const pres = [...drawerTr.querySelectorAll("pre")].map((p) => (p.textContent || "").length);
      const labels = [...drawerTr.querySelectorAll("span")].map((s) => (s.textContent || "").trim()).filter(Boolean);
      return {
        drawerFound: true,
        htmlHasSystemPrompt: drawerTr.outerHTML.includes("System Prompt"),
        htmlHasRawModelResponse: drawerTr.outerHTML.includes("Raw Model Response"),
        preLengths: pres,
        labels: labels.slice(0, 30),
        htmlSnippet: drawerTr.outerHTML.slice(0, 1200),
      };
    });
    ev(`drawer DOM: ${J(dom, 2200)}`);
    await shot(page, "remediation-qa13-item7a-trace-dom-probe.png");

    const logPath = writeLog("remediation-qa13-trace-probe-log.txt", LOG);
    console.log(`Wrote ${logPath}`);
  } finally {
    await browser.close();
  }
}

run().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});