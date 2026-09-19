import { launchBrowser, attachDiagnostics, waitForAppReady, shot, setInputValue, delay } from "./lib.mjs";
import { client, readEvidence, writeEvidence, writeLog, sleep } from "./qa14-lib.mjs";

const c = client();
const log = [];
const say = (s) => { log.push(s); console.log(s); };
const fx = readEvidence("fixtures");

const NAME_A = fx.editTargetName; // "AUDIT-QA14 Edit Target Plumbing"
const NAME_B = "AUDIT-QA14 B-Edit Plumbing";
const EMAIL_A = fx.editTargetEmail; // qa14.edit@qa14.invalid
const EMAIL_B = "qa14.b-edit@qa14.invalid";

async function contractorNow() {
  const list = (await c.query("contractors:listByPackage", { tradePackageId: fx.futureControlPackageId })) || [];
  return list.find((x) => x.contactEmail === EMAIL_A || x.contactEmail === EMAIL_B || x.companyName === NAME_A || x.companyName === NAME_B) || null;
}

async function openEditModal(page) {
  const opened = await page.evaluate((name) => {
    const buttons = [...document.querySelectorAll('button[title="Edit contractor info"]')];
    const btn = buttons.find((b) => {
      let n = b;
      for (let i = 0; i < 6 && n; i++) {
        n = n.parentElement;
        if (n && (n.textContent || "").includes(name)) return true;
      }
      return false;
    });
    if (!btn) return { ok: false, buttons: buttons.length };
    btn.scrollIntoView({ block: "center" });
    btn.click();
    return { ok: true };
  }, NAME_A);
  if (opened.ok) {
    await page.waitForSelector('input[aria-label="Company name"]', { timeout: 15000 });
  }
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
    const btn = dialog
      ? [...dialog.querySelectorAll("button")].find((b) => (b.textContent || "").includes("Save Changes"))
      : null;
    if (!btn) return { ok: false };
    if (btn.disabled) return { ok: false, disabled: true };
    btn.click();
    return { ok: true, label: btn.textContent.trim() };
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
    const btn = [...document.querySelectorAll("button[aria-pressed]")].find((b) =>
      (b.textContent || "").includes(name)
    );
    if (!btn) return { ok: false };
    btn.scrollIntoView({ block: "center" });
    btn.click();
    return { ok: true, text: btn.textContent.trim(), pressed: btn.getAttribute("aria-pressed") };
  }, tradeName);
  if (res.ok) await delay(1500);
  return res;
}

async function main() {
  const result = { startedAt: new Date().toISOString(), names: { NAME_A, NAME_B, EMAIL_A, EMAIL_B } };
  const before = await contractorNow();
  result.before = before;
  say(`backend before: ${before?.companyName} / ${before?.contactEmail} (${before?._id})`);

  const { browser } = await launchBrowser(1440, 900);
  const pageA = await browser.newPage();
  const pageB = await browser.newPage();
  const diagA = attachDiagnostics(pageA);
  const diagB = attachDiagnostics(pageB);

  const url = `https://brainy-skunk-440.convex.site/?project=${fx.tzProjectId}&tab=discovery&qa14=1`;
  for (const [label, page] of [["A", pageA], ["B", pageB]]) {
    await page.evaluateOnNewDocument((pid) => {
      window.localStorage.setItem("tradepulse.selectedProjectId", pid);
    }, fx.tzProjectId);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    await waitForAppReady(page);
    const sel = await selectPackage(page, "AUDIT-QA14 Control Future Plumbing");
    result[`selectPackage${label}`] = sel;
    say(`tab ${label} package switch: ${JSON.stringify(sel)}`);
    await page.waitForFunction(
      (name) => document.body.innerText.includes(name),
      { timeout: 30000 },
      NAME_A
    );
    say(`tab ${label} loaded discovery with contractor visible`);
  }

  // Tab A opens the edit modal first and leaves it untouched.
  const openedA = await openEditModal(pageA);
  result.openedA = openedA;
  const formABefore = await readForm(pageA);
  result.formABefore = formABefore;
  await shot(pageA, "fix4-qa14-concurrent-A-modal-open.png");
  say(`A modal open: ${JSON.stringify(formABefore)}`);

  // Tab B edits the same contractor and saves.
  const openedB = await openEditModal(pageB);
  result.openedB = openedB;
  await setInputValue(pageB, 'input[aria-label="Company name"]', NAME_B);
  await setInputValue(pageB, 'input[aria-label="Contact email"]', EMAIL_B);
  const bSaved = await clickSave(pageB);
  result.bSaved = bSaved;
  const afterB = await waitBackend((x) => x.companyName === NAME_B && x.contactEmail === EMAIL_B);
  result.afterB = afterB;
  await shot(pageB, "fix4-qa14-concurrent-B-saved.png");
  say(`B saved: backend=${afterB?.companyName} / ${afterB?.contactEmail}`);

  // Tab A (stale modal still showing the original values) hits Save.
  await pageA.bringToFront();
  const formAAtSave = await readForm(pageA);
  result.formAAtSave = formAAtSave;
  const aSaved = await clickSave(pageA);
  result.aSaved = aSaved;
  await delay(1200);
  const afterA = await waitBackend((x) => x.companyName === NAME_A, 5000);
  result.afterA = afterA;
  await shot(pageA, "fix4-qa14-concurrent-A-stale-save.png");
  await pageB.bringToFront();
  await delay(800);
  await shot(pageB, "fix4-qa14-concurrent-B-after-A-save.png");
  say(`A saved stale form: backend=${afterA?.companyName} / ${afterA?.contactEmail}`);

  result.clobbered = Boolean(afterB && afterA && afterA.companyName === NAME_A && afterA.contactEmail === EMAIL_A && (afterB.companyName !== afterA.companyName));
  result.consoleA = diagA.consoleLogs.slice(-10);
  result.pageErrorsA = diagA.pageErrors;
  result.consoleB = diagB.consoleLogs.slice(-10);
  result.pageErrorsB = diagB.pageErrors;

  writeEvidence("concurrent-edit", result);
  writeLog("concurrent-edit", log);
  await browser.close();
  console.log(`clobbered=${result.clobbered}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});