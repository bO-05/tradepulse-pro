/**
 * QA15 live UI: A14-02 two-tab stale contractor edit. Tab B saves first; the
 * stale Tab A save must be refused with a readable conflict message and must
 * not overwrite the newer value.
 */
import { launchBrowser, attachDiagnostics, waitForAppReady, shot, setInputValue, delay } from "./lib.mjs";
import { client, readEvidence, writeEvidence, writeLog, sleep } from "./qa15-lib.mjs";

const c = client();
const F = readEvidence("fixtures");
const log = [];
const say = (s) => { log.push(s); console.log(s); };
const results = [];
const record = (name, pass, detail) => {
  results.push({ name, pass: Boolean(pass), detail });
  say(`${pass ? "PASS" : "FAIL"}  ${name} :: ${detail}`);
};

const NAME_A = F.editTargetName;
const EMAIL_A = F.editTargetEmail;
const NAME_B = "AUDIT-QA15 B-Edit Earthwork";
const EMAIL_B = "qa15.b-edit@qa15.invalid";

async function contractorNow() {
  const list = (await c.query("contractors:listByPackage", { tradePackageId: F.edit.packageId })) || [];
  return list.find((x) => x._id === F.edit.contractorId) || null;
}

async function resetToA() {
  const cur = await contractorNow();
  if (cur && cur.companyName === NAME_A && cur.contactEmail === EMAIL_A) return cur;
  await c.mutation("contractors:updateContractor", {
    contractorId: F.edit.contractorId,
    companyName: NAME_A,
    contactEmail: EMAIL_A,
    phone: "+1 (212) 555-0155",
    licenseNumber: "NY-QA15-0001",
    licenseStatus: "Active / Verified (QA15)",
    sourceUrl: "https://qa15.example.invalid",
    rfqStatus: cur ? cur.rfqStatus : "invited",
  });
  return await contractorNow();
}

async function openEditModal(page, name) {
  const opened = await page.evaluate((needle) => {
    const vis = (e) => {
      const r = e.getBoundingClientRect();
      return r.width > 1 && r.height > 1;
    };
    const buttons = [...document.querySelectorAll('button[title="Edit contractor info"]')].filter(vis);
    const btn = buttons.find((b) => {
      let n = b;
      for (let i = 0; i < 6 && n; i++) {
        n = n.parentElement;
        if (n && (n.textContent || "").includes(needle)) return true;
      }
      return false;
    });
    if (!btn) return { ok: false, count: buttons.length };
    btn.scrollIntoView({ block: "center" });
    btn.click();
    return { ok: true };
  }, name);
  if (opened.ok) await page.waitForSelector('input[aria-label="Company name"]', { timeout: 15000 });
  return opened;
}

async function readForm(page) {
  return page.evaluate(() => ({
    companyName: document.querySelector('input[aria-label="Company name"]')?.value ?? null,
    contactEmail: document.querySelector('input[aria-label="Contact email"]')?.value ?? null,
  }));
}

async function clickSave(page) {
  return page.evaluate(() => {
    const dialog = document.querySelector('[aria-labelledby="edit-contractor-title"]');
    const btn = dialog ? [...dialog.querySelectorAll("button")].find((b) => (b.textContent || "").includes("Save Changes")) : null;
    if (!btn) return { ok: false, reason: "save button not found" };
    if (btn.disabled) return { ok: false, disabled: true };
    btn.click();
    return { ok: true };
  });
}

async function waitBackend(predicate, timeoutMs = 12000) {
  const start = Date.now();
  let last = null;
  while (Date.now() - start < timeoutMs) {
    last = await contractorNow();
    if (last && predicate(last)) return last;
    await sleep(400);
  }
  return last;
}

async function selectPackage(page, tradeName) {
  const res = await page.evaluate((name) => {
    const btn = [...document.querySelectorAll("button[aria-pressed]")].find((b) => (b.textContent || "").includes(name));
    if (!btn) return { ok: false };
    btn.scrollIntoView({ block: "center" });
    btn.click();
    return { ok: true, text: btn.textContent.trim() };
  }, tradeName);
  if (res.ok) await delay(1500);
  return res;
}

async function main() {
  const result = { startedAt: new Date().toISOString(), names: { NAME_A, NAME_B, EMAIL_A, EMAIL_B } };
  const before = await resetToA();
  result.before = before ? { id: before._id, companyName: before.companyName, contactEmail: before.contactEmail, updatedAt: before.updatedAt } : null;
  say(`backend before: ${before?.companyName} / ${before?.contactEmail} updatedAt=${before?.updatedAt}`);

  const { browser } = await launchBrowser(1440, 900);
  const pageA = await browser.newPage();
  const pageB = await browser.newPage();
  const diagA = attachDiagnostics(pageA);
  const diagB = attachDiagnostics(pageB);

  const url = `https://brainy-skunk-440.convex.site/?project=${F.mainProjectId}&tab=discovery&qa15=concurrent`;
  for (const [label, page] of [["A", pageA], ["B", pageB]]) {
    await page.evaluateOnNewDocument((pid) => {
      window.localStorage.setItem("tradepulse.selectedProjectId", pid);
    }, F.mainProjectId);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    await waitForAppReady(page);
    const sel = await selectPackage(page, F.edit.packageName);
    result[`selectPackage${label}`] = sel;
    say(`tab ${label} package switch: ${JSON.stringify(sel)}`);
    await page.waitForFunction((name) => document.body.innerText.includes(name), { timeout: 30000 }, NAME_A);
    say(`tab ${label} loaded discovery with contractor visible`);
  }

  const openedA = await openEditModal(pageA, NAME_A);
  result.openedA = openedA;
  result.formABefore = await readForm(pageA);
  await shot(pageA, "fix4-qa15-A14-02-A-modal-open.png");
  say(`A modal open: ${JSON.stringify(result.formABefore)}`);

  const openedB = await openEditModal(pageB, NAME_A);
  result.openedB = openedB;
  await setInputValue(pageB, 'input[aria-label="Company name"]', NAME_B);
  await setInputValue(pageB, 'input[aria-label="Contact email"]', EMAIL_B);
  const bSaved = await clickSave(pageB);
  result.bSaved = bSaved;
  const afterB = await waitBackend((x) => x.companyName === NAME_B && x.contactEmail === EMAIL_B);
  result.afterB = afterB ? { companyName: afterB.companyName, contactEmail: afterB.contactEmail, updatedAt: afterB.updatedAt } : null;
  await shot(pageB, "fix4-qa15-A14-02-B-saved.png");
  say(`B saved: backend=${afterB?.companyName} / ${afterB?.contactEmail} updatedAt=${afterB?.updatedAt}`);

  await pageA.bringToFront();
  const formAAtSave = await readForm(pageA);
  result.formAAtSave = formAAtSave;
  const aSaved = await clickSave(pageA);
  result.aSaved = aSaved;
  await delay(2500);

  const staleUi = await pageA.evaluate(() => {
    const alerts = [...document.querySelectorAll('[role="alert"]')]
      .map((e) => (e.innerText || "").trim())
      .filter(Boolean);
    const dialog = document.querySelector('[aria-labelledby="edit-contractor-title"]');
    return {
      alerts,
      conflictAlert: alerts.find((t) => /changed in another session/i.test(t)) || null,
      editModalOpen: Boolean(dialog),
      actionErrorShown: alerts.some((t) => /Contractor action failed/i.test(t)),
    };
  });
  result.staleUi = staleUi;
  const afterA = await contractorNow();
  result.afterA = afterA ? { companyName: afterA.companyName, contactEmail: afterA.contactEmail, updatedAt: afterA.updatedAt } : null;
  await shot(pageA, "fix4-qa15-A14-02-A-stale-refused.png");
  await pageB.bringToFront();
  await delay(800);
  await shot(pageB, "fix4-qa15-A14-02-B-after-A-save.png");
  say(`A stale save refused? alert=${JSON.stringify(staleUi.conflictAlert)} backendAfter=${afterA?.companyName} / ${afterA?.contactEmail}`);

  record(
    "A14-02-stale-edit-readable-conflict-and-no-overwrite",
    Boolean(before && before.companyName === NAME_A) &&
      openedA.ok &&
      openedB.ok &&
      bSaved.ok &&
      afterB &&
      afterB.companyName === NAME_B &&
      afterB.contactEmail === EMAIL_B &&
      aSaved.ok &&
      staleUi.editModalOpen &&
      typeof staleUi.conflictAlert === "string" &&
      /changed in another session/i.test(staleUi.conflictAlert) &&
      afterA &&
      afterA.companyName === NAME_B &&
      afterA.contactEmail === EMAIL_B,
    `before=${before?.companyName}; Aopened=${openedA.ok}; Bopened=${openedB.ok}; Bsaved=${bSaved.ok}; afterB=${afterB?.companyName}/${afterB?.contactEmail}; Asaved=${aSaved.ok}; modalOpen=${staleUi.editModalOpen}; conflictAlert=${JSON.stringify(staleUi.conflictAlert)}; afterA=${afterA?.companyName}/${afterA?.contactEmail}; clobbered=${Boolean(afterA && afterA.companyName === NAME_A)}`
  );

  result.diagA = { consoleErrors: diagA.consoleLogs.filter((l) => l.type === "error").map((e) => e.text.slice(0, 200)), pageErrors: diagA.pageErrors };
  result.diagB = { consoleErrors: diagB.consoleLogs.filter((l) => l.type === "error").map((e) => e.text.slice(0, 200)), pageErrors: diagB.pageErrors };
  writeEvidence("concurrent-edit", { results, ...result });
  writeLog("concurrent-edit", log);
  console.log(`\nresults: ${results.filter((r) => r.pass).length}/${results.length} passed`);
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  writeLog("concurrent-edit-crash", [String(e?.stack ?? e)]);
  process.exit(1);
});