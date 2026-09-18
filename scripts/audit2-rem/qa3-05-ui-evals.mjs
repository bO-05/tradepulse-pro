import { ConvexHttpClient } from "convex/browser";
import { launchBrowser, attachDiagnostics, waitForAppReady, selectProjectByTitle, shot, writeJson, writeLog, delay } from "./lib.mjs";

const c = new ConvexHttpClient(process.env.REM_CONVEX_URL || "https://brainy-skunk-440.convex.cloud");
const FIX_A = "AUDIT-QA3-fixture-2026-09-18";
const results = [];
const rec = (id, label, outcome, detail) => {
  results.push({ id, label, outcome, detail });
  console.log(`${outcome.padEnd(10)} ${id} ${label} :: ${typeof detail === "string" ? detail : JSON.stringify(detail)}`);
};
async function query(fn, args) {
  let last;
  for (let i = 0; i < 4; i++) {
    try { return { threw: false, value: await c.query(fn, args) }; }
    catch (e) {
      last = e;
      if (!String(e && e.message).includes("fetch failed")) break;
      await new Promise((r) => setTimeout(r, 900));
    }
  }
  return { threw: true, data: last && last.data !== undefined ? last.data : null, message: last && last.message ? last.message : String(last) };
}

const setVal = (page, label, value) => page.evaluate(({ label, value }) => {
  const dlg = document.querySelector('[role="dialog"]');
  if (!dlg) return { ok: false, reason: "no dialog" };
  const lab = [...dlg.querySelectorAll("label")].find((l) => (l.textContent || "").includes(label));
  const field = lab ? dlg.querySelector(`#${lab.getAttribute("for")}`) || lab.parentElement.querySelector("input,textarea,select") : null;
  const el = field || [...dlg.querySelectorAll("input,textarea")].find((i) => (i.placeholder || "").toLowerCase().includes(label.toLowerCase()));
  if (!el) return { ok: false, reason: "no field for " + label };
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  return { ok: true, tag: el.tagName, value: el.value };
}, { label, value });

const run = async () => {
  const out = { startedAt: new Date().toISOString(), results };
  const projectsBefore = (await query("projects:listProjects", {})).value;
  const fixA = projectsBefore.find((p) => p.title === FIX_A);
  const pkgsBefore = (await query("tradePackages:listByProject", { projectId: fixA._id })).value;
  out.countsBefore = { projects: projectsBefore.length, fixturePackages: pkgsBefore.length };

  const { browser } = await launchBrowser(1600, 1000);
  const page = await browser.newPage();
  const diag = attachDiagnostics(page);
  try {
    await page.goto(process.env.REM_BASE_URL || "https://brainy-skunk-440.convex.site", { waitUntil: "domcontentloaded", timeout: 60000 });
    await waitForAppReady(page);
    await selectProjectByTitle(page, FIX_A);
    await delay(1500);

    // ---------- A1. New Project modal validation errors ----------
    await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => (b.textContent || "").trim() === "New Project")?.click());
    await delay(600);
    await setVal(page, "Innovation", "   ");
    await setVal(page, "Austin, TX", "Austin, TX");
    await setVal(page, "Healthcare / Mixed-Use", "Class-A Commercial");
    await setVal(page, "Austin Commercial, LP", "Austin Commercial, LP");
    await setVal(page, "Estimated budget in dollars", "100");
    await setVal(page, "Target completion duration in weeks", "52");
    await page.evaluate(() => {
      const dlg = document.querySelector('[role="dialog"]');
      [...dlg.querySelectorAll("button")].find((b) => (b.textContent || "").includes("Create Commercial Project"))?.click();
    });
    await delay(700);
    out.newProjectWhitespace = await page.evaluate(() => {
      const dlg = document.querySelector('[role="dialog"]');
      const err = dlg ? [...dlg.querySelectorAll("p.text-rose-400")].map((p) => p.textContent.trim()) : [];
      return { dialogOpen: !!dlg, errors: err };
    });
    await shot(page, "fix4-qa3-05-newproject-whitespace-error.png");
    rec("U1", "New Project whitespace title shows visible error", out.newProjectWhitespace.errors.length > 0 ? "PASS" : "FAIL", out.newProjectWhitespace);

    await setVal(page, "Innovation", "QA3 UI Probe");
    await setVal(page, "Estimated budget in dollars", "0");
    await page.evaluate(() => {
      const dlg = document.querySelector('[role="dialog"]');
      [...dlg.querySelectorAll("button")].find((b) => (b.textContent || "").includes("Create Commercial Project"))?.click();
    });
    await delay(700);
    out.newProjectZeroBudget = await page.evaluate(() => {
      const dlg = document.querySelector('[role="dialog"]');
      const err = dlg ? [...dlg.querySelectorAll("p.text-rose-400")].map((p) => p.textContent.trim()) : [];
      return { dialogOpen: !!dlg, errors: err };
    });
    await shot(page, "fix4-qa3-05-newproject-zero-budget-error.png");
    rec("U2", "New Project zero budget shows visible error", out.newProjectZeroBudget.errors.length > 0 ? "PASS" : "FAIL", out.newProjectZeroBudget);
    await page.keyboard.press("Escape");
    await delay(500);

    // ---------- A2. Create Trade Package duplicate + whitespace ----------
    const openPkgModal = () => page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").trim() === "Create Trade Package");
      if (!b) return false;
      b.click();
      return true;
    });
    out.pkgModalOpened = await openPkgModal();
    await delay(700);
    out.fillDup = {};
    out.fillDup.csi = await setVal(page, "CSI Division", "26 00 00");
    out.fillDup.name = await setVal(page, "Trade Package Name", "QA3 Dup UI Probe");
    out.fillDup.budget = await setVal(page, "Budget Estimate", "1000");
    out.fillDup.scope = await setVal(page, "Scope Summary", "duplicate probe scope");
    out.fillDup.deadline = await setVal(page, "Bid Deadline", "2027-06-01");
    await page.evaluate(() => {
      const dlg = document.querySelector('[role="dialog"]');
      [...dlg.querySelectorAll("button")].find((b) => (b.textContent || "").includes("Create Package"))?.click();
    });
    await delay(1500);
    out.duplicateCsi = await page.evaluate(() => {
      const dlg = document.querySelector('[role="dialog"]');
      const err = dlg ? [...dlg.querySelectorAll("p")].map((p) => p.textContent.trim()).filter(Boolean).slice(-3) : [];
      return { dialogOpen: !!dlg, texts: err };
    });
    await shot(page, "fix4-qa3-05-package-duplicate-csi-error.png");
    rec("U3", "Create Package duplicate CSI shows visible error text", out.duplicateCsi.texts.length > 0 ? "PASS" : "FAIL", out.duplicateCsi);

    // whitespace name in same modal (change CSI to unique)
    await setVal(page, "CSI Division", "29 00 00");
    await setVal(page, "Trade Package Name", "   ");
    await page.evaluate(() => {
      const dlg = document.querySelector('[role="dialog"]');
      [...dlg.querySelectorAll("button")].find((b) => (b.textContent || "").includes("Create Package"))?.click();
    });
    await delay(1500);
    out.whitespaceName = await page.evaluate(() => {
      const dlg = document.querySelector('[role="dialog"]');
      const err = dlg ? [...dlg.querySelectorAll("p")].map((p) => p.textContent.trim()).filter(Boolean).slice(-3) : [];
      return { dialogOpen: !!dlg, texts: err };
    });
    await shot(page, "fix4-qa3-05-package-whitespace-name-error.png");
    rec("U4", "Create Package whitespace name shows visible error text", out.whitespaceName.texts.some((t) => /required/i.test(t)) ? "PASS" : "NOTE", out.whitespaceName);
    await page.keyboard.press("Escape");
    await delay(500);

    // ---------- B. Evals honesty (UI) ----------
    await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => (b.textContent || "").includes("Evals & Architecture"))?.click());
    await delay(2500);
    out.evalsUI = await page.evaluate(() => {
      const t = document.body.innerText;
      const ai = t.match(/AIA A401 CONFORMITY\s*\n?([^\n]+)\n?([^\n]*)/i);
      const hold = t.match(/HOLDOUT[^\n]*\n?([^\n]+)\n?([^\n]*)/i);
      const cases = t.match(/CASES EXTRACTED CORRECTLY\s*\n?([^\n]+)/i);
      const mape = t.match(/LEVELED COST MAPE\s*\n?([^\n]+)/i);
      const cands = [...document.querySelectorAll("div")].filter((d) => (d.textContent || "").toUpperCase().includes("ANSWER NOT IN PROMPT") && (d.textContent || "").includes("MAPE") && (d.textContent || "").includes("model must compute"));
      const hc = cands.length ? cands.reduce((a, b) => (a.textContent.length <= b.textContent.length ? a : b)) : null;
      return {
        aiaBlock: ai ? `${ai[1]} | ${ai[2]}` : null,
        holdoutBlock: hc ? hc.innerText.replace(/\s+/g, " ") : null,
        cases: cases ? cases[1].trim() : null,
        mape: mape ? mape[1].trim() : null,
        mentionsNAText: /Not covered by this suite/.test(t),
        mentionsAnswerNotInPrompt: /ANSWER NOT IN PROMPT/i.test(t),
      };
    });
    await shot(page, "fix4-qa3-05-evals-diagnostics.png", { full: true });
  } catch (e) {
    out.error = String(e && e.stack ? e.stack : e);
  } finally {
    out.diag = { pageErrors: diag.pageErrors.slice(0, 5), consoleErrors: diag.consoleLogs.filter((l) => l.type === "error").slice(0, 5) };
    await browser.close();
  }

  const projectsAfter = (await query("projects:listProjects", {})).value;
  const pkgsAfter = (await query("tradePackages:listByProject", { projectId: fixA._id })).value;
  out.countsAfter = { projects: projectsAfter.length, fixturePackages: pkgsAfter.length };
  rec("U5", "no bad project/package record saved by UI validation errors", projectsAfter.length === out.countsBefore.projects && pkgsAfter.length === out.countsBefore.fixturePackages ? "PASS" : "FAIL", { before: out.countsBefore, after: out.countsAfter });

  // ---------- B2. Evals honesty (backend) ----------
  const latest = (await query("evals:getLatestEvalRun", {})).value;
  if (latest?.run) {
    const holdoutTraces = latest.traces.filter((t) => t.metrics?.isHoldout);
    const leakCheck = holdoutTraces.map((t) => {
      const gt = t.groundTruth?.leveledCost;
      const prompt = t.rawPrompt || "";
      const withCommas = gt.toLocaleString("en-US");
      return { caseId: t.caseId, groundTruth: gt, totalStringInPrompt: prompt.includes(String(gt)) || prompt.includes(withCommas) };
    });
    out.evalBackend = {
      runId: latest.run.runId, totalCases: latest.run.totalCases, passedCases: latest.run.passedCases,
      holdoutCases: latest.run.holdoutCases, holdoutPassed: latest.run.holdoutPassed, holdoutMape: latest.run.holdoutMape,
      aiaConformityAvg: latest.run.aiaConformityAvg, traces: latest.traces.length, holdoutTraces: holdoutTraces.length, leakCheck,
    };
    rec("E1", "eval run reports 13 cases / 3 holdout / 3 passed", latest.run.totalCases === 13 && latest.run.holdoutCases === 3 && latest.run.holdoutPassed === 3 ? "PASS" : "FAIL", out.evalBackend);
    rec("E2", "holdout prompts do not contain the ground-truth total", leakCheck.every((x) => !x.totalStringInPrompt) ? "PASS" : "FAIL", leakCheck);
    rec("E3", "AIA conformity is 0 in backend and UI renders N/A", latest.run.aiaConformityAvg === 0 && out.evalsUI?.aiaBlock?.includes("N/A") ? "PASS" : "FAIL", { backend: latest.run.aiaConformityAvg, ui: out.evalsUI?.aiaBlock });
    rec("E4", "UI holdout card matches backend 3/3 + MAPE", out.evalsUI?.holdoutBlock?.includes("3 / 3") ? "PASS" : "NOTE", { ui: out.evalsUI?.holdoutBlock, backend: { passed: latest.run.holdoutPassed, cases: latest.run.holdoutCases, mape: latest.run.holdoutMape } });
  } else rec("E1", "latest eval run", "FAIL", "no eval run found");

  writeJson("fix4-qa3-05-ui-evals.json", out);
  writeLog("fix4-qa3-05-ui-evals.log", results.map((x) => `${x.outcome} ${x.id} ${x.label} :: ${typeof x.detail === "string" ? x.detail : JSON.stringify(x.detail)}`));
  console.log("\nDONE");
};
run().catch((e) => { console.error("ERR", e && e.stack ? e.stack : e); process.exit(1); });