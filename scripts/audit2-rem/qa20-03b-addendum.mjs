/**
 * QA20-03b addendum surface: certify the journey RFI, capture the enabled
 * addendum claim tooltip, issue the addendum, inspect the generated file.
 */
import { launchBrowser, attachDiagnostics, waitForAppReady, shot, delay } from "./lib.mjs";
import { client, readEvidence, writeEvidence, writeLog } from "./qa20-lib.mjs";

const F = readEvidence("fixtures");
const c = client();
const BASE = "https://brainy-skunk-440.convex.site";
const log = [];
const say = (s) => { log.push(s); console.log(s); };
const out = {};
const results = [];
const record = (id, name, pass, detail) => {
  results.push({ id, name, pass: Boolean(pass), detail });
  say(`${pass ? "PASS" : "FAIL"}  ${id} ${name} :: ${JSON.stringify(detail).slice(0, 700)}`);
};

async function main() {
  const convs = (await c.query("rfq:listConversations", { tradePackageId: F.journey.packageId })) || [];
  const clarified = convs.find((x) => x.status === "clarified");
  if (!clarified) throw new Error("no clarified RFI on journey package");
  if (!clarified.pmCertifiedAt) {
    await c.mutation("rfq:reviewEscalatedRfi", {
      conversationId: clarified._id,
      status: "clarified",
      reviewNote: "QA20 copy-sweep certification.",
    });
    say(`certified ${clarified._id}`);
  }
  await delay(1200);

  const { browser } = await launchBrowser(1440, 950);
  const page = await browser.newPage();
  const diag = attachDiagnostics(page);
  await page.goto(`${BASE}/?project=${F.journey.id}&tab=qna&qa20=addendum`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await waitForAppReady(page, 60000);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => (x.getAttribute("title") || "").includes("Close Demo Tour") || (x.textContent || "").trim() === "Dismiss");
    b?.click();
  });
  await delay(1200);

  const btn = await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => /Addendum/i.test(x.textContent || ""));
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { text: (b.textContent || "").trim(), title: b.getAttribute("title"), disabled: b.disabled, x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  out.addendumButton = btn;
  record(
    "A20-03b.1",
    "certified RFI enables addendum button and its tooltip claims 'official AIA/CSI'",
    btn && !btn.disabled && /official\s+AIA/i.test(btn.title || ""),
    { disabled: btn?.disabled, title: btn?.title }
  );
  if (btn) {
    await page.mouse.move(btn.x, btn.y);
    await delay(1200);
    await shot(page, "fix4-qa20-addendum-enabled-hover.png");
  }

  const before = ((await c.query("files:listFilesByProject", { projectId: F.journey.id })) || []).filter((f) => f.fileType === "addendum").length;
  if (btn && !btn.disabled) {
    await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) => /Addendum/i.test(x.textContent || ""));
      b?.click();
    });
    const start = Date.now();
    while (Date.now() - start < 90000) {
      const files = ((await c.query("files:listFilesByProject", { projectId: F.journey.id })) || []).filter((f) => f.fileType === "addendum");
      if (files.length > before) break;
      await delay(1500);
    }
    await delay(2500);
    await shot(page, "fix4-qa20-addendum-issued.png");
  }
  const files = ((await c.query("files:listFilesByProject", { projectId: F.journey.id })) || []).filter((f) => f.fileType === "addendum");
  const latest = files[0] || null;
  out.addendumFile = latest ? { fileName: latest.fileName, by: latest.uploadedBy, chars: latest.textContent?.length, text: latest.textContent } : null;
  record(
    "A20-03b.2",
    "generated addendum text inspected for binding/official claims",
    Boolean(latest),
    {
      fileName: latest?.fileName,
      hasLegallyBinding: /legally binding/i.test(latest?.textContent || ""),
      hasOfficialAia: /official\s+AIA/i.test(latest?.textContent || ""),
      hasSignatureClaim: /signature/i.test(latest?.textContent || ""),
    }
  );

  out.diagnostics = { pageErrors: diag.pageErrors.slice(0, 8), consoleErrors: diag.consoleLogs.filter((l) => l.type === "error").slice(0, 8) };
  writeEvidence("addendum", { results, out, summary: { pass: results.filter((r) => r.pass).length, total: results.length } });
  writeLog("addendum", log);
  await browser.close();
  console.log(`addendum: ${results.filter((r) => r.pass).length}/${results.length}`);
}

main().catch((e) => {
  console.error(e);
  writeLog("addendum-crash", [String(e?.stack ?? e)]);
  process.exit(1);
});