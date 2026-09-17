// QA-13 focused follow-up: item 7a (trace drawer) + item 7b (certified RFI PM name).
// Usage: node scripts/qa-rem/qa13-followup.mjs
import {
  launchBrowser,
  attachDiagnostics,
  shot,
  waitForAppReady,
  delay,
  BASE_URL,
  writeLog,
  bodyText,
} from "./qa1-lib.mjs";
import { ConvexHttpClient } from "convex/browser";
import fs from "node:fs";
import path from "node:path";

const EVIDENCE_DIR =
  "D:/Repo/ALL HACKATHONS/Convex/Convex all gas/doc/tradepulse audits/outputs/evidence";
const fixture = JSON.parse(
  fs.readFileSync(path.join(EVIDENCE_DIR, "remediation-qa13-fixtures.json"), "utf8")
);
const client = new ConvexHttpClient(fixture.backend);
const LOG = [];
const ev = (s) => {
  LOG.push(s);
  console.log(s);
};
const J = (o, max = 900) => {
  const s = JSON.stringify(o);
  return s.length > max ? s.slice(0, max) + "..." : s;
};
const RESULTS = [];
const record = (item, verdict, detail) => {
  RESULTS.push({ item, verdict, detail });
  ev(`>>> ${item}: ${verdict} :: ${detail}`);
};

async function run() {
  const { browser } = await launchBrowser();
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(30000);
    const diag = attachDiagnostics(page);
    await page.evaluateOnNewDocument(() => {
      try {
        localStorage.setItem("tradepulse.tourDismissed", "1");
      } catch (e) {}
    });

    // ---- 7a ----
    ev("### ITEM 7a retry: trace drawer fields");
    await page.goto(`${BASE_URL}/?tab=diagnostics`, { waitUntil: "domcontentloaded" });
    await waitForAppReady(page);
    await delay(2500);
    await page
      .waitForFunction(() => document.body.innerText.includes("Case-by-Case Forensic Audit Trail"), { timeout: 25000 })
      .catch(() => {});
    const rowInfo = await page.evaluate(() => {
      const buttons = [...document.querySelectorAll("button")];
      const inspectBtns = buttons.filter((b) => (b.textContent || "").trim() === "Inspect");
      return { inspectCount: inspectBtns.length, bodyHasTable: document.body.innerText.includes("Case-by-Case Forensic Audit Trail") };
    });
    ev(`[7a] inspect buttons found=${rowInfo.inspectCount}; table=${rowInfo.bodyHasTable}`);
    // click the first Inspect via a real puppeteer click on the element handle
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
    ev(`[7a] clicked first Inspect=${clicked}`);
    await delay(1500);
    const drawerInfo = await page.evaluate(() => {
      const trs = [...document.querySelectorAll("tr")];
      const drawerTr = trs.find((tr) => (tr.innerText || "").includes("Execution Trace:"));
      return {
        drawerFound: Boolean(drawerTr),
        drawerText: drawerTr ? drawerTr.innerText.slice(0, 900) : null,
        hasSystemPrompt: drawerTr ? drawerTr.innerText.includes("System Prompt") : false,
        hasRawResponse: drawerTr ? drawerTr.innerText.includes("Raw Model Response") : false,
        hasCost: drawerTr ? /Cost: \$/.test(drawerTr.innerText) : false,
      };
    });
    ev(`[7a] drawer=${J({ drawerFound: drawerInfo.drawerFound, hasSystemPrompt: drawerInfo.hasSystemPrompt, hasRawResponse: drawerInfo.hasRawResponse, hasCost: drawerInfo.hasCost })}`);
    ev(`[7a] drawer text: ${J(drawerInfo.drawerText, 900)}`);
    await shot(page, "remediation-qa13-item7a-trace-drawer-retry.png");
    const item7aOk = drawerInfo.hasSystemPrompt && drawerInfo.hasRawResponse && drawerInfo.hasCost;
    record("ITEM 7a trace drawer fields", item7aOk ? "PASS" : "FAIL", J(drawerInfo));

    // ---- 7b ----
    ev("");
    ev("### ITEM 7b retry: certified RFI PM name");
    const convsBefore = await client.query("rfq:listConversations", { tradePackageId: fixture.pkg26 });
    const targetConv = convsBefore.find((c) => (c.inboundSubject || "").startsWith("QA-REM QA13 RFI"));
    ev(`[7b] backend RFI conversation: ${J(targetConv && { id: targetConv._id, status: targetConv.status, subj: targetConv.inboundSubject, pmBy: targetConv.pmCertifiedBy })}`);
    await page.goto(`${BASE_URL}/?project=${fixture.clashProjectId}&tab=qna`, { waitUntil: "domcontentloaded" });
    await waitForAppReady(page);
    await delay(2500);
    let body = await bodyText(page);
    const cardSeen = targetConv ? body.includes(targetConv.inboundSubject) : false;
    ev(`[7b] RFI card visible in UI=${cardSeen}`);
    await shot(page, "remediation-qa13-item7b-rfi-card.png");
    let approveRes = null;
    if (cardSeen) {
      approveRes = await page.evaluate((subj) => {
        const buttons = [...document.querySelectorAll("button")];
        const approve = buttons.find((b) => /Approve/.test(b.textContent || ""));
        if (!approve) return { ok: false, reason: "approve button not found", available: buttons.map((b) => (b.textContent || "").trim()).filter(Boolean).slice(0, 60) };
        approve.scrollIntoView({ block: "center" });
        approve.click();
        return { ok: true, text: (approve.textContent || "").trim() };
      }, targetConv.inboundSubject);
      ev(`[7b] approve click: ${J(approveRes)}`);
    }
    let certifiedSeen = false;
    if (approveRes && approveRes.ok) {
      certifiedSeen = await page
        .waitForFunction(() => document.body.innerText.includes("Certified by Project Manager"), { timeout: 20000 })
        .then(() => true)
        .catch(() => false);
    }
    await delay(1000);
    await shot(page, "remediation-qa13-item7b-rfi-certified.png");
    const afterConv = (await client.query("rfq:listConversations", { tradePackageId: fixture.pkg26 })).find(
      (c) => c._id === (targetConv && targetConv._id)
    );
    ev(`[7b] backend after approve: ${J(afterConv && { status: afterConv.status, pmBy: afterConv.pmCertifiedBy, pmAt: afterConv.pmCertifiedAt })}`);
    const item7bOk = certifiedSeen && afterConv && afterConv.pmCertifiedBy === "Project Manager" && afterConv.pmCertifiedAt;
    record("ITEM 7b certified RFI PM name", item7bOk ? "PASS" : cardSeen ? "FAIL" : "BLOCKED", J({ cardSeen, approveRes, certifiedSeen, backend: afterConv && { pmBy: afterConv.pmCertifiedBy, pmAt: afterConv.pmCertifiedAt } }));

    ev("");
    ev(`[diag] console errors=${diag.consoleLogs.filter((l) => l.type === "error").length} pageerrors=${diag.pageErrors.length} failedRequests=${diag.failedRequests.length}`);
    for (const e of diag.consoleLogs.filter((l) => l.type === "error")) ev(`  [console.error] ${e.text}`);
    for (const p of diag.pageErrors) ev(`  [pageerror] ${p}`);
    for (const f of diag.failedRequests) ev(`  [failedRequest] ${f}`);

    const logPath = writeLog("remediation-qa13-followup-log.txt", LOG);
    console.log(`Wrote ${logPath}`);
    fs.writeFileSync(path.join(EVIDENCE_DIR, "remediation-qa13-followup-results.json"), JSON.stringify(RESULTS, null, 2), "utf8");
  } finally {
    await browser.close();
  }
}

run().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});