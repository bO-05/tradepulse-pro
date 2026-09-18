import {
  BASE_URL,
  launchBrowser,
  attachDiagnostics,
  shot,
  waitForAppReady,
  getSelectorState,
  selectProjectByTitle,
  bodyText,
  writeJson,
  writeLog,
  delay,
} from "./lib.mjs";

const log = [];
const say = (s) => {
  console.log(s);
  log.push(s);
};

const TABS = ["packages", "discovery", "qna", "leveling", "coordination", "contracts", "audit", "diagnostics"];

function clean(text) {
  return text.replace(/\r/g, "").split("\n").map((l) => l.trimEnd()).join("\n");
}

const { browser, executablePath } = await launchBrowser();
say(`EXECUTABLE: ${executablePath}`);
say(`BASE: ${BASE_URL}`);
const page = await browser.newPage();
const diag = attachDiagnostics(page);
const result = { recon: {}, tabs: {}, tooltips: {}, timestamp: new Date().toISOString() };

try {
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await waitForAppReady(page);
  const sel0 = await getSelectorState(page);
  result.recon.initialSelector = sel0;
  say(`INITIAL SELECTED: ${sel0 && sel0.selectedText}`);
  say(`PROJECT OPTIONS (${sel0 ? sel0.options.length : 0}): ${JSON.stringify(sel0 ? sel0.options.map((o) => o.text) : [])}`);

  const pick = await selectProjectByTitle(page, "Domain Tower B");
  say(`SELECT DOMAIN: ${JSON.stringify(pick)}`);
  await delay(1500);

  for (const tab of TABS) {
    const clicked = await page.evaluate((name) => {
      const btns = [...document.querySelectorAll("button")];
      const match = btns.find((b) => (b.getAttribute("title") || "").includes(name) || (b.textContent || "").includes(name));
      if (!match) return false;
      match.click();
      return true;
    }, tab === "packages" ? "CSI Scoping" : tab === "discovery" ? "Discovery" : tab === "qna" ? "Pre-Bid Q&A" : tab === "leveling" ? "Bid Leveling" : tab === "coordination" ? "Scope Clash" : tab === "contracts" ? "Subcontracts" : tab === "audit" ? "Live Activity Audit" : "Evals & Architecture");
    await delay(1200);
    const text = clean(await bodyText(page));
    const tooltips = await page.evaluate(() =>
      [...document.querySelectorAll("[title]")].map((el) => ({
        title: el.getAttribute("title"),
        tag: el.tagName,
        text: (el.textContent || "").trim().slice(0, 120),
      }))
    );
    const aria = await page.evaluate(() =>
      [...document.querySelectorAll("[aria-label]")].map((el) => ({
        label: el.getAttribute("aria-label"),
        tag: el.tagName,
        text: (el.textContent || "").trim().slice(0, 120),
      }))
    );
    const p = await shot(page, `fix4-qa4-tab-${tab}.png`, { full: true });
    result.tabs[tab] = { clicked, text, tooltips, aria, bodyLength: text.length };
    result.tooltips[tab] = tooltips;
    say(`TAB ${tab}: clicked=${clicked} chars=${text.length} shot=${p} tooltips=${tooltips.length} aria=${aria.length}`);
  }

  result.recon.diag = {
    consoleErrors: diag.consoleLogs.filter((m) => m.type === "error").map((m) => m.text.slice(0, 300)),
    pageErrors: diag.pageErrors.slice(0, 10),
    failedRequests: diag.failedRequests.slice(0, 10),
  };
  say(`DIAG ERRORS: ${JSON.stringify(result.recon.diag)}`);
} catch (e) {
  say(`RECON ERROR: ${e.stack || e}`);
  result.recon.error = String(e.stack || e);
} finally {
  writeJson("fix4-qa4-recon.json", result);
  writeLog("fix4-qa4-recon-log.txt", log);
  await browser.close();
}