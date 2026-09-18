/**
 * QA8 hunt — Diagnostics error state for an unconfigured provider, Contracts
 * 375px/200%/keyboard sweep, websocket churn counter.
 * Read-only on demo; no fixture.
 */
import { attachDiagnostics, clickHeaderTab, delay, gotoDemo, launchBrowser, setViewport, writeJson } from "./qa6-lib.mjs";
import { shot } from "./lib.mjs";
import { writeEvidence } from "./qa8-lib.mjs";

const out = { ranAt: new Date().toISOString(), checks: [], diag: {}, contractsResp: {}, ws: {} };
const checks = [];
const add = (id, label, ok, observed) => {
  checks.push({ id, label, ok, observed: String(observed).slice(0, 400) });
  console.log(`${ok ? "PASS" : "FAIL"}  ${id} ${label} :: ${String(observed).slice(0, 250)}`);
};

const { browser } = await launchBrowser(1440, 900);
const page = await browser.newPage();
const diagnostics = attachDiagnostics(page);
const cdp = await page.createCDPSession();
let wsCreated = 0;
let wsFrames = 0;
cdp.on("Network.webSocketCreated", () => wsCreated++);
cdp.on("Network.webSocketFrameReceived", () => wsFrames++);
await cdp.send("Network.enable").catch(() => {});

try {
  await gotoDemo(page);

  // ---------------- Diagnostics provider error state
  await clickHeaderTab(page, "Evals & Architecture");
  await delay(1800);
  const diagText = await page.evaluate(() => document.body.innerText);
  out.diag.statuses = {
    openAiNotSet: /Adapter ready — OPENAI_API_KEY not set/i.test(diagText),
    liveConfiguredCount: (diagText.match(/Live — key configured/g) || []).length,
    openAiDisclaimer: /no key is configured on this deployment/i.test(diagText),
  };
  // select OpenAI card (card contains "OpenAI" and "BYOK")
  await page.evaluate(() => {
    const card = [...document.querySelectorAll("div")].find((d) => /OPENAI/.test(d.innerText) && /Selected|GPT-4o|Reference price/.test(d.innerText));
    if (card) card.click();
  });
  await delay(600);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => /Run Token Diagnostics/.test(x.innerText));
    if (b) b.click();
  });
  await delay(2500);
  const diagResult = await page.evaluate(() => {
    const text = document.body.innerText;
    return {
      unavailable: /Diagnostic unavailable/.test(text),
      noCall: /No call was made/.test(text),
      honestyMsg: /no API key is configured on this deployment|Add one with/.test(text),
      snippet: (text.match(/Diagnostic unavailable[\s\S]{0,400}/) || [""])[0].replace(/\s+/g, " ").slice(0, 400),
    };
  });
  out.diag.openAiDiagnostic = diagResult;
  await shot(page, "fix4-qa8-34-diagnostics-openai.png");
  add("H-DIAG-1", "unconfigured provider diagnostic reports unavailable honestly", diagResult.unavailable && diagResult.noCall, JSON.stringify(diagResult).slice(0, 300));

  // evals numbers source check
  const runRow = await page.evaluate(() => {
    const text = document.body.innerText;
    const m = text.match(/Run ID:\s*([^\s]+)/);
    return { runId: m ? m[1] : null, hasMape: /MAPE/.test(text), hasHoldout: /[Hh]oldout/.test(text) };
  });
  out.diag.evalRunRow = runRow;
  add("H-DIAG-2", "Evals numbers attributed with Run ID", !!runRow.runId, JSON.stringify(runRow));

  // ---------------- Contracts responsive + keyboard
  await clickHeaderTab(page, "06: Subcontracts");
  await delay(1200);
  await setViewport(page, 375, 800);
  await delay(900);
  const m375 = await page.evaluate(() => ({
    scrollW: document.documentElement.scrollWidth,
    innerW: window.innerWidth,
    overflowX: document.documentElement.scrollWidth - window.innerWidth,
  }));
  await shot(page, "fix4-qa8-34-375-contracts.png");
  let offscreen = 0;
  for (let i = 0; i < 25; i++) {
    await page.keyboard.press("Tab");
    await delay(25);
    const pos = await page.evaluate(() => {
      const a = document.activeElement;
      if (!a) return null;
      const r = a.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < window.innerHeight && r.right > 0 && r.left < window.innerWidth;
    });
    if (pos === false) offscreen++;
  }
  // open viewer at 375
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => /Inspect Draft/.test(x.innerText));
    if (b) b.click();
  });
  await delay(700);
  await shot(page, "fix4-qa8-34-375-contracts-viewer.png");
  const viewer375 = await page.evaluate(() => ({
    overflowX: document.documentElement.scrollWidth - window.innerWidth,
    scrollW: document.documentElement.scrollWidth,
    innerW: window.innerWidth,
  }));
  await page.keyboard.press("Escape");
  await delay(300);
  // 200%
  await setViewport(page, 720, 900);
  await delay(700);
  const m200 = await page.evaluate(() => ({
    scrollW: document.documentElement.scrollWidth,
    innerW: window.innerWidth,
    overflowX: document.documentElement.scrollWidth - window.innerWidth,
  }));
  await shot(page, "fix4-qa8-34-200pct-contracts.png");
  await setViewport(page, 1440, 900);
  await delay(500);
  out.contractsResp = { m375, m200, keyboardOffscreen: offscreen, viewer375 };
  add("H-RESP-contracts", "contracts 375px no horizontal overflow", m375.overflowX <= 2, JSON.stringify(m375));
  add("H-KB-contracts", "contracts keyboard tab stays in viewport", offscreen === 0, `offscreen=${offscreen}/25`);
  add("H-RESP-contracts-200", "contracts 200% no horizontal overflow", m200.overflowX <= 2, JSON.stringify(m200));
  add("H-RESP-contracts-viewer", "A401 viewer at 375px no horizontal overflow", viewer375.overflowX <= 2, JSON.stringify(viewer375));

  await delay(1500);
  out.ws = { created: wsCreated, framesReceived: wsFrames };
  add("H-WS-1", "single websocket created (no churn) during session", wsCreated <= 2, `created=${wsCreated} frames=${wsFrames}`);
  out.diagnostics = {
    pageErrors: diagnostics.pageErrors,
    failedRequests: diagnostics.failedRequests,
    consoleErrors: diagnostics.consoleLogs.filter((l) => l.type === "error").map((l) => l.text.slice(0, 200)),
    requestCount: diagnostics.requests.length,
  };
} catch (err) {
  out.fatal = String(err?.stack ?? err);
  console.error("FATAL", err);
} finally {
  await browser.close();
  out.checks = checks;
  writeEvidence("34-diag-contracts-resp", out);
  writeJson("fix4-qa8-34-diag-contracts-resp.json", out);
  const failed = checks.filter((k) => !k.ok);
  console.log(`\nQA8-34 done. checks=${checks.length} failed=${failed.length} ws=${JSON.stringify(out.ws)}`);
  for (const f of failed) console.log(`  FAIL ${f.id} ${f.label}: observed=${f.observed}`);
}