/**
 * QA21-06 A20-01: addendum claim + generated file author.
 *  - UI label "Issue Pre-Bid Addendum NO. 01"; tooltip no longer claims official AIA/CSI
 *  - generated addendum file author = pre-bid clarification engine, not "Legal"
 */
import { launchBrowser, attachDiagnostics, waitForAppReady, delay, shot } from "./lib.mjs";
import { client, readEvidence, writeEvidence, writeLog } from "./qa21-lib.mjs";

const F = readEvidence("01-fixtures");
const BASE = "https://brainy-skunk-440.convex.site";
const log = [];
const say = (s) => { log.push(s); console.log(s); };
const results = [];
const record = (id, name, pass, detail) => {
  results.push({ id, name, pass: Boolean(pass), detail });
  say(`${pass ? "PASS" : "FAIL"}  ${id} ${name} :: ${JSON.stringify(detail).slice(0, 900)}`);
};

const EXPECTED_LABEL = "📜 Issue Pre-Bid Addendum NO. 01";
const EXPECTED_TITLE = "Compile PM-certified RFIs into a TradePulse-generated CSI-style addendum (not an AIA document)";
const EXPECTED_AUTHOR = "TradePulse Pre-Bid Clarification Engine (generated addendum)";

async function main() {
  const c = client();

  // Idempotent re-certification in case a late autonomous run re-touched the RFI.
  await c.mutation("rfq:reviewEscalatedRfi", {
    conversationId: F.addendum.conversationId,
    status: "clarified",
    reviewNote: "QA21 A20-01 verification: certified for addendum generation.",
  });

  const generated = await c.action("files:generatePreBidAddendum", { projectId: F.addendum.id });
  say(`addendum action: ${JSON.stringify({ success: generated?.success, fileName: generated?.fileName, qaCount: generated?.qaCount, csiDivisionCount: generated?.csiDivisionCount })}`);
  const files = (await c.query("files:listFilesByProject", { projectId: F.addendum.id })) || [];
  const addendumFiles = files.filter((f) => f.fileType === "addendum");
  const latest = addendumFiles[0] || null;
  const text = latest?.textContent || "";

  record(
    "A20-01.backend-file-author",
    "generated addendum file author is the clarification engine (no 'Legal')",
    Boolean(latest) &&
      latest.uploadedBy === EXPECTED_AUTHOR &&
      !/legal/i.test(latest.uploadedBy) &&
      /Prepared by:[*\s]*TradePulse Pro Pre-Bid Clarification Engine/i.test(text) &&
      !/TradePulse Legal/i.test(text),
    {
      fileName: latest?.fileName,
      uploadedBy: latest?.uploadedBy,
      hasPreparedBy: /Prepared by:[*\s]*TradePulse Pro Pre-Bid Clarification Engine/i.test(text),
      textHead: text.split("\n").slice(0, 6),
    }
  );

  // ---- UI ----
  const { browser } = await launchBrowser(1440, 950);
  const page = await browser.newPage();
  const diag = attachDiagnostics(page);
  await page.goto(`${BASE}/?project=${F.addendum.id}&tab=qna&qa21=addendum`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await waitForAppReady(page, 60000);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find(
      (x) => (x.getAttribute("title") || "").includes("Close Demo Tour") || (x.textContent || "").trim() === "Dismiss"
    );
    b?.click();
  });
  await delay(2000);

  const btn = await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => /Addendum NO\. 01/i.test(x.textContent || "") || /Addendum/i.test(x.getAttribute("title") || ""));
    if (!b) return { found: false, buttons: [...document.querySelectorAll("button")].map((x) => (x.textContent || "").replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, 40) };
    return {
      found: true,
      label: (b.textContent || "").replace(/\s+/g, " ").trim(),
      title: b.getAttribute("title"),
      disabled: b.disabled,
      ariaLabel: b.getAttribute("aria-label"),
    };
  });
  say(`addendum button: ${JSON.stringify(btn)}`);
  await shot(page, "fix4-qa21-addendum.png");

  record(
    "A20-01.ui-label",
    "button label is 'Issue Pre-Bid Addendum NO. 01' and enabled after certification",
    btn.found && btn.label === EXPECTED_LABEL && btn.disabled === false,
    btn
  );
  record(
    "A20-01.ui-tooltip",
    "tooltip is the TradePulse-generated CSI-style wording (no 'official AIA/CSI')",
    btn.found && btn.title === EXPECTED_TITLE && !/official AIA|AIA\/CSI/i.test(btn.title || ""),
    { title: btn.title, expected: EXPECTED_TITLE }
  );

  // Page-level claim scan inside the QnA tab context (button + nearby header).
  const pageClaims = await page.evaluate(() => {
    const t = document.body.innerText;
    return {
      mentionsOfficialAia: /official AIA\/CSI/i.test(t),
      mentionsIssueLegal: /Issue Legal Addendum/i.test(t),
      hasNewLabel: t.includes("Issue Pre-Bid Addendum NO. 01"),
    };
  });
  record(
    "A20-01.page-claims",
    "no residual 'official AIA/CSI' or 'Issue Legal Addendum' claim in the QnA view",
    !pageClaims.mentionsOfficialAia && !pageClaims.mentionsIssueLegal && pageClaims.hasNewLabel,
    pageClaims
  );

  const out = {
    generated: { success: generated?.success, fileName: generated?.fileName, qaCount: generated?.qaCount, csiDivisionCount: generated?.csiDivisionCount, addendumNumber: generated?.addendumNumber },
    addendumFile: latest ? { _id: latest._id, fileName: latest.fileName, uploadedBy: latest.uploadedBy, fileType: latest.fileType } : null,
    results,
    pageErrors: diag.pageErrors.slice(0, 5),
    summary: { pass: results.filter((r) => r.pass).length, total: results.length },
  };
  writeEvidence("06-addendum", out);
  writeLog("06-addendum", log);
  await browser.close();
  console.log(`addendum: ${results.filter((r) => r.pass).length}/${results.length}`);
  if (results.some((r) => !r.pass)) process.exitCode = 2;
}

main().catch((e) => {
  console.error(e);
  writeLog("06-addendum-crash", [String(e?.stack ?? e)]);
  process.exit(1);
});