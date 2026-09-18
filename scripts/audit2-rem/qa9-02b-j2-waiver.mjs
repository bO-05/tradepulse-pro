/**
 * QA9 J2b: redo the waiver-escalation RFI with full submit diagnostics.
 * Evidence: evidence/fix4-qa9-j2b-*.json
 */
import { client, launchBrowser, attachDiagnostics, diagnosticsSummary, waitForAppReady, delay, selectProjectByTitle, typeInto, clickByText, shot, writeEvidence, FIXTURE_TAG } from "./qa9-lib.mjs";

const c = client();
const PROJECT = `${FIXTURE_TAG}-J2-RFI`;
const proj = (await c.query("projects:listProjects", {})).find((p) => p.title === PROJECT);
const pkgB = (await c.query("tradePackages:listByProject", { projectId: proj._id })).find((p) => p.csiDivision === "26 00 00");
const result = { journey: "J2b", data: {} };
const problems = [];
const { browser } = await launchBrowser(1440, 950);
const page = await browser.newPage();
const diag = attachDiagnostics(page);

async function convos() { return c.query("rfq:listConversations", { tradePackageId: pkgB._id }); }

try {
  await page.goto("https://brainy-skunk-440.convex.site/", { waitUntil: "domcontentloaded", timeout: 60000 });
  await waitForAppReady(page);
  await selectProjectByTitle(page, PROJECT);
  await delay(1400);
  await page.keyboard.press("Digit3");
  await page.waitForSelector('select[aria-label="Target trade package for this RFI"]', { timeout: 15000 });
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").includes("QA9 Electrical"));
    if (b) b.click();
  });
  await delay(1200);
  await page.evaluate((v) => {
    const sel = document.querySelector('select[aria-label="Target trade package for this RFI"]');
    sel.value = v; sel.dispatchEvent(new Event("change", { bubbles: true }));
  }, pkgB._id);
  await delay(400);
  await typeInto(page, 'input[aria-label="RFI subject or scope topic"]', "QA9 waiver escalation probe 2");
  await typeInto(page, 'textarea[aria-label="Subcontractor question"]', "We request a waiver of liquidated damages for late energization caused by utility delays.");
  const pre = await page.evaluate(() => {
    const subj = document.querySelector('input[aria-label="RFI subject or scope topic"]');
    const q = document.querySelector('textarea[aria-label="Subcontractor question"]');
    const btn = [...document.querySelectorAll("button")].find((b) => (b.textContent || "").includes("Submit RFI for Clarification"));
    return { subject: subj?.value, question: (q?.value || "").slice(0, 60), btnDisabled: btn?.disabled, btnFound: !!btn };
  });
  result.data.preSubmit = pre;
  const before = (await convos()).length;
  result.data.convosBefore = before;
  await clickByText(page, "Submit RFI for Clarification", { exact: true });
  await delay(600);
  result.data.toastAfter = await page.evaluate(() => { const el = document.querySelector('[role="status"]'); return el ? el.innerText.trim() : null; });
  const start = Date.now();
  let hit = null;
  while (Date.now() - start < 150000) {
    const list = await convos().catch(() => []);
    hit = list.find((x) => (x.inboundSubject || "").includes("waiver escalation probe 2"));
    if (hit && hit.status !== "pending_analysis") break;
    await delay(3000);
  }
  result.data.rfi = hit ? { id: hit._id, status: hit.status, confidence: hit.confidenceScore, reply: (hit.autonomousReply || "").slice(0, 200), error: hit.analysisError || null } : null;
  if (!hit) problems.push({ id: "A9-32", sev: "High", title: "Waiver RFI submit produced no conversation record" });
  else if (hit.status !== "escalated_to_pm") problems.push({ id: "A9-33", sev: "High", title: "Waiver RFI not escalated", detail: `status=${hit.status}` });
  await delay(1200);
  result.data.pmQueueText = await page.evaluate(() => [...document.querySelectorAll("main button")].map((b) => (b.textContent || "").trim()).filter((t) => t.includes("PM Review Queue") || t.includes("Review PM Queue"))[0] || null);
  await shot(page, "fix4-qa9-j2b-waiver.png");
  result.console = diagnosticsSummary(diag);
} catch (err) {
  problems.push({ id: "A9-90", sev: "High", title: "J2b crashed: " + (err?.message ?? String(err)).split("\n")[0] });
} finally {
  result.findings = problems;
  result.verdict = problems.some((p) => p.sev === "High") ? "blocked" : problems.length ? "complete-with-issues" : "complete";
  writeEvidence("j2b-rfi", result);
  await browser.close();
}
console.log(`J2b verdict=${result.verdict}`, JSON.stringify(result.data.rfi ?? {}));