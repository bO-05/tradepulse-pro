// QA-13 final follow-up: item 7a (case-insensitive drawer assert) + item 7b (certify RFI via UI).
// Usage: node scripts/qa-rem/qa13-final-followup.mjs
import {
  launchBrowser,
  attachDiagnostics,
  shot,
  waitForAppReady,
  delay,
  BASE_URL,
  writeLog,
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
const J = (o, max = 700) => {
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

    // ---- 7a final ----
    ev("### ITEM 7a final (case-insensitive drawer assert)");
    await page.goto(`${BASE_URL}/?tab=diagnostics`, { waitUntil: "domcontentloaded" });
    await waitForAppReady(page);
    await delay(3000);
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
    await delay(1500);
    const drawer = await page.evaluate(() => {
      const trs = [...document.querySelectorAll("tr")];
      const tr = trs.find((x) => (x.innerText || "").includes("Execution Trace:"));
      if (!tr) return { found: false };
      const text = tr.innerText;
      return {
        found: true,
        systemPromptVisible: /system prompt/i.test(text),
        rawResponseVisible: /raw model response/i.test(text),
        providerCostVisible: /cost:\s*\$/i.test(text),
        preLengths: [...tr.querySelectorAll("pre")].map((p) => (p.textContent || "").length),
        header: text.split("\n").slice(0, 4).join(" | "),
      };
    });
    ev(`[7a] drawer=${J(drawer)}`);
    await shot(page, "remediation-qa13-item7a-trace-drawer-final.png");
    const item7aOk = drawer.found && drawer.systemPromptVisible && drawer.rawResponseVisible && drawer.providerCostVisible;
    record("ITEM 7a trace drawer fields", item7aOk ? "PASS" : "FAIL", J({ clicked, drawer }));

    // ---- 7b final ----
    ev("");
    ev("### ITEM 7b final (certify RFI via UI)");
    const convs = await client.query("rfq:listConversations", { tradePackageId: fixture.pkg26 });
    const target = convs.find((c) => (c.inboundSubject || "").startsWith("QA-REM QA13 RFI"));
    ev(`[7b] target conversation: ${J(target && { id: target._id, subj: target.inboundSubject, status: target.status, pmBy: target.pmCertifiedBy })}`);
    await page.goto(`${BASE_URL}/?project=${fixture.clashProjectId}&tab=qna`, { waitUntil: "domcontentloaded" });
    await waitForAppReady(page);
    await delay(2500);
    const cardSeen = await page.evaluate((subj) => document.body.innerText.includes(subj), target.inboundSubject);
    ev(`[7b] card visible=${cardSeen}`);
    const approveClick = await page.evaluate(() => {
      const buttons = [...document.querySelectorAll("button")];
      const candidates = buttons.filter((b) => /^(Save & )?Approve for Addendum$/.test((b.textContent || "").trim()));
      if (candidates.length === 0) {
        return { ok: false, reason: "no exact Approve for Addendum button", available: buttons.map((b) => (b.textContent || "").trim()).filter(Boolean).slice(0, 80) };
      }
      candidates[0].scrollIntoView({ block: "center" });
      candidates[0].click();
      return { ok: true, text: (candidates[0].textContent || "").trim(), count: candidates.length };
    });
    ev(`[7b] approve click=${J(approveClick)}`);
    let certifiedSeen = false;
    if (approveClick.ok) {
      certifiedSeen = await page
        .waitForFunction(() => /Certified by Project Manager/i.test(document.body.innerText), { timeout: 20000 })
        .then(() => true)
        .catch(() => false);
    }
    await delay(800);
    await shot(page, "remediation-qa13-item7b-rfi-certified-final.png");
    const after = (await client.query("rfq:listConversations", { tradePackageId: fixture.pkg26 })).find((c) => c._id === target._id);
    ev(`[7b] backend after: ${J(after && { status: after.status, pmBy: after.pmCertifiedBy, pmAt: after.pmCertifiedAt })}`);
    const item7bOk = certifiedSeen && after && after.pmCertifiedBy === "Project Manager" && Boolean(after.pmCertifiedAt);
    record("ITEM 7b certified RFI PM name", item7bOk ? "PASS" : cardSeen ? "FAIL" : "BLOCKED", J({ cardSeen, approveClick, certifiedSeen, backend: after && { pmBy: after.pmCertifiedBy, pmAt: after.pmCertifiedAt } }));

    ev("");
    ev(`[diag] console errors=${diag.consoleLogs.filter((l) => l.type === "error").length} pageerrors=${diag.pageErrors.length} failedRequests=${diag.failedRequests.length}`);
    for (const e of diag.consoleLogs.filter((l) => l.type === "error")) ev(`  [console.error] ${e.text}`);
    for (const p of diag.pageErrors) ev(`  [pageerror] ${p}`);
    for (const f of diag.failedRequests) ev(`  [failedRequest] ${f}`);

    const logPath = writeLog("remediation-qa13-final-followup-log.txt", LOG);
    console.log(`Wrote ${logPath}`);
    fs.writeFileSync(path.join(EVIDENCE_DIR, "remediation-qa13-final-followup-results.json"), JSON.stringify(RESULTS, null, 2), "utf8");
  } finally {
    await browser.close();
  }
}

run().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});