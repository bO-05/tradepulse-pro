/**
 * QA9 J1 follow-up: robust dispatch (with/without contractors) + double add-contractor
 * diagnostics on the J1 fixture project. Evidence: evidence/fix4-qa9-j1b-*.json
 */
import {
  client, launchBrowser, attachDiagnostics, diagnosticsSummary, waitForAppReady, delay,
  selectProjectByTitle, currentProjectLabel, typeInto, clickByText, shot, writeEvidence, text as bodyText, FIXTURE_TAG,
} from "./qa9-lib.mjs";

const c = client();
const PROJECT = `${FIXTURE_TAG}-J1-ESTIMATOR`;
const MANUAL_DIV = "10 00 00";
const MANUAL_TRADE = "Specialties & Signage QA9";
const log = []; const problems = [];
const step = (s) => { log.push(s); console.log("STEP:", s); };

const projects = await c.query("projects:listProjects", {});
const proj = projects.find((p) => p.title === PROJECT);
if (!proj) throw new Error("J1 fixture missing");
let pkgs = await c.query("tradePackages:listByProject", { projectId: proj._id });
let manualPkg = pkgs.find((p) => p.tradeName === MANUAL_TRADE);
if (!manualPkg) throw new Error("manual package missing");

const { browser } = await launchBrowser(1440, 950);
const page = await browser.newPage();
const diag = attachDiagnostics(page);
const result = { journey: "J1b", projectId: proj._id, steps: log, findings: [] };

async function toastNow(timeout = 7000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const t = await page.evaluate(() => {
      const el = document.querySelector('[role="status"]');
      return el ? el.innerText.trim() : null;
    });
    if (t) return t;
    await delay(150);
  }
  return null;
}

async function clickDispatchInCard(cardText) {
  const hit = await page.evaluate((ct) => {
    const buttons = [...document.querySelectorAll('button')].filter((b) => (b.getAttribute("title") || "").includes("Dispatch RFQ"));
    for (const b of buttons) {
      let node = b;
      for (let i = 0; i < 8 && node; i++) {
        if ((node.textContent || "").includes(ct)) {
          b.scrollIntoView({ block: "center" });
          const r = b.getBoundingClientRect();
          return { ok: true, x: r.left + r.width / 2, y: r.top + r.height / 2, title: b.title };
        }
        node = node.parentElement;
      }
    }
    return { ok: false, titles: buttons.map((b) => b.title) };
  }, cardText);
  if (!hit.ok) return hit;
  await page.mouse.click(hit.x, hit.y);
  return hit;
}

async function countContractors() {
  const all = await c.query("contractors:listByProject", { projectId: proj._id });
  return all.filter((x) => x.tradePackageId === manualPkg._id);
}

try {
  await page.goto("https://brainy-skunk-440.consvex.site/".replace("consvex", "convex"), { waitUntil: "domcontentloaded", timeout: 60000 }).catch(async () => {
    await page.goto("https://brainy-skunk-440.convex.site/", { waitUntil: "domcontentloaded", timeout: 60000 });
  });
  await waitForAppReady(page);
  const sel = await selectProjectByTitle(page, PROJECT);
  result.selected = sel;
  await delay(1200);

  // packages tab
  await clickByText(page, "CSI Scoping", { exact: false });
  await delay(1200);

  // 1. Dispatch with NO contractors -> error toast expected, status unchanged
  const before = await countContractors();
  const click1 = await clickDispatchInCard(MANUAL_TRADE);
  const t1 = await toastNow(8000);
  result.data = { dispatchEmpty: { click: click1, toast: t1, beforeStatus: manualPkg.status } };
  const still = (await c.query("tradePackages:listByProject", { projectId: proj._id })).find((p) => p._id === manualPkg._id);
  result.data.dispatchEmpty.statusAfter = still?.status;
  step(`dispatch-empty click=${JSON.stringify(click1)} toast=${JSON.stringify(t1)} status=${still?.status}`);
  if (t1 && /delivered|recorded/i.test(t1)) problems.push({ id: "A9-10", sev: "High", title: "Dispatch to zero contractors reported success", detail: t1 });
  if (!t1) problems.push({ id: "A9-11", sev: "Medium", title: "Dispatch with no contractors produced no toast/feedback", detail: "silent click" });
  await shot(page, "fix4-qa9-j1b-dispatch-empty.png");

  // 2. Add 2 contractors manually with full diagnostics
  await clickByText(page, "Advance to Contractor Discovery", { exact: false }).catch(() => {});
  await delay(1000);
  await page.evaluate((t) => {
    const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").includes(t));
    if (b) b.click();
  }, MANUAL_TRADE);
  await delay(800);

  result.data.addAttempts = [];
  for (const co of [
    { name: "QA9 Granite Peak Mech", email: "bids@qa9-granitepeak.test", phone: "(208) 555-0233", lic: "ID-QA9-1001" },
    { name: "QA9 Riverstone Electric", email: "estimating@qa9-riverstone.test", phone: "(208) 555-0244", lic: "ID-QA9-1002" },
  ]) {
    const open = await clickByText(page, "Add Contractor Manually", { exact: true });
    await delay(700);
    const modalOpen = await page.evaluate(() => !!document.querySelector('#add-contractor-title, [aria-labelledby="add-contractor-title"]'));
    let fill = null; let submitState = null; let toast = null;
    if (modalOpen) {
      await typeInto(page, 'input[placeholder="e.g. Rosendin Electric, Inc."]', co.name);
      await typeInto(page, 'input[placeholder="estimating@rosendin.com"]', co.email);
      await typeInto(page, 'input[placeholder="(512) 835-2400"]', co.phone);
      await typeInto(page, 'input[placeholder="e.g. TECL-38492"]', co.lic);
      fill = await page.evaluate(() => {
        const vals = [...document.querySelectorAll('input')].map((i) => i.value).filter(Boolean);
        const btn = [...document.querySelectorAll("button")].find((b) => (b.textContent || "").includes("Add to Directory"));
        return { inputs: vals, submitDisabled: btn ? btn.disabled : null, submitText: btn ? btn.textContent.trim() : null };
      });
      await clickByText(page, "Add to Directory", { exact: true });
      toast = await toastNow(8000);
      await delay(400);
    }
    const current = await countContractors();
    const modalStillOpen = await page.evaluate(() => !!document.querySelector('[aria-labelledby="add-contractor-title"]'));
    const entry = { co: co.name, open, modalOpen, fill, toast, countAfter: current.length, names: current.map((x) => x.companyName), modalStillOpen };
    result.data.addAttempts.push(entry);
    step(`add ${co.name}: modal=${modalOpen} fill=${JSON.stringify(fill)} toast=${JSON.stringify(toast)} count=${current.length}`);
    if (!modalOpen) problems.push({ id: "A9-12", sev: "Medium", title: "Add Contractor modal did not open", detail: co.name });
  }
  if (result.data.addAttempts[1] && result.data.addAttempts[1].countAfter === result.data.addAttempts[0].countAfter) {
    problems.push({ id: "A9-13", sev: "Medium", title: "Second manual contractor add silently dropped", detail: JSON.stringify(result.data.addAttempts[1]) });
  }

  // 3. Dispatch WITH contractors
  await clickByText(page, "CSI Scoping", { exact: false });
  await delay(1200);
  const click2 = await clickDispatchInCard(MANUAL_TRADE);
  const t2 = await toastNow(10000);
  const pkgNow = (await c.query("tradePackages:listByProject", { projectId: proj._id })).find((p) => p._id === manualPkg._id);
  const ctrs = await countContractors();
  result.data.dispatchWith = { click: click2, toast: t2, statusAfter: pkgNow?.status, contractorStatuses: ctrs.map((x) => `${x.companyName}:${x.rfqStatus}`) };
  step(`dispatch-with click=${JSON.stringify(click2)} toast=${JSON.stringify(t2)} status=${pkgNow?.status}`);
  if (!click2.ok) problems.push({ id: "A9-14", sev: "Medium", title: "Dispatch button unreachable on manual package card" });
  await shot(page, "fix4-qa9-j1b-dispatch-with.png");

  // 4. Invite one contractor (UI) then delete it
  await clickByText(page, "Advance to Contractor Discovery", { exact: false }).catch(() => {});
  await delay(1000);
  const inv = await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").includes("Invite to Bid"));
    if (!b) return false;
    b.scrollIntoView({ block: "center" }); b.click(); return true;
  });
  await delay(3500);
  const afterInvite = await countContractors();
  result.data.afterInvite = afterInvite.map((x) => `${x.companyName}:${x.rfqStatus}`);
  step(`invite click=${inv} statuses=${result.data.afterInvite.join(", ")}`);

  const del = await page.evaluate(() => {
    const b = document.querySelector('button[title="Delete contractor"]');
    if (!b) return false;
    b.scrollIntoView({ block: "center" }); b.click(); return true;
  });
  if (del) {
    await delay(500);
    await clickByText(page, "Remove contractor", { exact: true });
    await delay(2500);
    result.data.afterDelete = (await countContractors()).map((x) => x.companyName);
    step(`delete contractor -> remaining=${result.data.afterDelete.length}`);
  }
  await shot(page, "fix4-qa9-j1b-final.png");
  result.console = diagnosticsSummary(diag);
} catch (err) {
  problems.push({ id: "A9-90", sev: "High", title: "J1b crashed: " + (err?.message ?? String(err)).split("\n")[0] });
  await shot(page, "fix4-qa9-j1b-crash.png").catch(() => {});
} finally {
  result.findings = problems;
  result.verdict = problems.some((p) => p.sev === "High") ? "blocked" : problems.length ? "complete-with-issues" : "complete";
  writeEvidence("j1b-estimator", result);
  await browser.close();
}
console.log(`J1b verdict=${result.verdict} findings=${problems.length}`);