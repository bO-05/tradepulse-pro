import fs from "node:fs";
import path from "node:path";
import { launchBrowser, attachDiagnostics, waitForAppReady, shot, writeJson, delay, getSelectorState } from "./lib.mjs";
import { ConvexHttpClient } from "convex/browser";

const EV = "D:/Repo/ALL HACKATHONS/Convex/Convex all gas/evidence";
const DL = path.join(EV, "audit4-downloads");
fs.mkdirSync(DL, { recursive: true });
const FIXTURE = "AUDIT-4-2026-09-18";
const S = { set: (k, v) => (R[k] = v) };
const R = { startedAt: new Date().toISOString(), fixture: FIXTURE };
const http = new ConvexHttpClient("https://brainy-skunk-440.convex.cloud");

const run = async () => {
  const { browser } = await launchBrowser(1440, 900);
  const page = await browser.newPage();
  const diag = attachDiagnostics(page);
  const client = await page.target().createCDPSession();
  await client.send("Page.setDownloadBehavior", { behavior: "allow", downloadPath: DL }).catch(() => {});

  const clickByText = async (t, exact = false) => page.evaluate(({ t, exact }) => {
    const b = [...document.querySelectorAll("button")].find((x) => { const s = (x.textContent || "").trim(); return exact ? s === t : s.includes(t); });
    if (!b) return { ok: false };
    b.click();
    return { ok: true, text: (b.textContent || "").trim() };
  }, { t, exact });
  const clickTab = async (p) => { await page.evaluate((pp) => { const b = [...document.querySelectorAll("button")].find((x) => (x.getAttribute("title") || "").startsWith(pp)); b?.click(); }, p); await delay(900); };
  const closeTour = async () => { await page.evaluate(() => { const b = [...document.querySelectorAll("button")].find((x) => (x.getAttribute("title") || "").includes("Close Demo Tour") || (x.textContent || "").trim() === "Dismiss"); b?.click(); }); await delay(300); };

  try {
    await page.goto("https://brainy-skunk-440.convex.site/", { waitUntil: "domcontentloaded", timeout: 60000 });
    await waitForAppReady(page);
    await delay(1500);
    await closeTour();

    // ---------- Demo regression (read-only)
    const demo = {};
    demo.selector = await getSelectorState(page);
    demo.kpi = await page.evaluate(() => {
      const t = document.body.innerText;
      return {
        buyout: (t.match(/Buyout: (\d+)\/(\d+) Awarded/) || []).slice(1),
        gaps: (t.match(/Gaps Exposed: \+?\$([\d,]+)/) || [])[1] || null,
        leveledLabel: /best bid per package/.test(t),
        deceptive: (t.match(/(\d+) Deceptive Bid/) || [])[1] || null,
      };
    });
    demo.stepperAward = await page.evaluate(() => (document.body.innerText.match(/(\d+)\/(\d+) Awarded/) || []).slice(1));
    demo.demoCounts = await page.evaluate(() => {
      const t = document.body.innerText;
      return { pkgs: (t.match(/(\d+) Pkgs/) || [])[1], subs: (t.match(/(\d+) Subs/) || [])[1], rfis: (t.match(/(\d+) RFIs/) || [])[1], bids: (t.match(/(\d+) Bids/) || [])[1], clashes: (t.match(/(\d+) Clashes/) || [])[1] };
    });
    await shot(page, "audit4-demo-landing.png");

    // tour live cue
    await page.evaluate(() => { const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").includes("Demo Tour")); if (b && !b.className.includes("ring")) b.click(); });
    await delay(800);
    await page.evaluate(() => { [...document.querySelectorAll("button")].find((x) => (x.getAttribute("title") || "").startsWith("04:"))?.click(); });
    await delay(1000);
    demo.tourCue = await page.evaluate(() => (document.body.innerText.match(/Cue:"?[^\n]{0,300}/) || [])[0] || null);
    await shot(page, "audit4-tour-scene4.png");
    await closeTour();

    // contracts + audit timestamps + evals
    await clickTab("06:");
    demo.contracts = await page.evaluate(() => { const t = document.body.innerText; return { sum: (t.match(/ACTIVE CONTRACTED SUM\s*\$?([\d,]+)/) || [])[1] || null, lds: (t.match(/LDs: \$([\d,]+)\/day/) || [])[1] || null }; });
    await clickTab("07:");
    demo.auditTimestamps = await page.evaluate(() => (document.body.innerText.match(/(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{2}, \d{4}, [^\n]{0,40}/g) || []).slice(0, 3));
    await page.evaluate(() => { [...document.querySelectorAll("button")].find((x) => (x.textContent || "").includes("Evals & Architecture"))?.click(); });
    await delay(1500);
    demo.evals = await page.evaluate(() => {
      const t = document.body.innerText;
      return {
        honestTitle: t.includes("Bid Extraction & ADR-0003 Normalization Check"),
        holdoutKpi: t.includes("Holdout — Answer Not In Prompt"),
        holdoutLine: ((t.match(/Holdout — Answer Not In Prompt\n([\s\S]{0,90})/) || [])[1] || "").replace(/\n/g, " | "),
        noParity: !t.includes("PARITY ACHIEVED") && !t.includes("Zero Cheating"),
        openaiAdapterLabel: t.includes("Adapter ready — OPENAI_API_KEY not set"),
        runId: (t.match(/Run ID: eval_\d+/) || [])[0] || null,
      };
    });
    await shot(page, "audit4-evals.png", { full: true });
    R.demo = demo;

    // ---------- Responsive / zoom / modal / keyboard
    const resp = {};
    for (const w of [320, 375, 768, 1024, 1440]) {
      await page.setViewport({ width: w, height: 900, deviceScaleFactor: 1 });
      await delay(400);
      resp[w] = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    }
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
    await delay(300);
    // 200% zoom equivalent
    await page.setViewport({ width: 720, height: 450, deviceScaleFactor: 1 });
    await delay(400);
    resp.zoom200 = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
    await delay(300);
    S.set("responsive", resp);

    await page.evaluate(() => { [...document.querySelectorAll("button")].find((b) => (b.textContent || "").trim() === "New Project")?.click(); });
    await delay(700);
    R.newProjectModal = await page.evaluate(() => {
      const dlg = document.querySelector('[role="dialog"]');
      if (!dlg) return null;
      const r = dlg.getBoundingClientRect();
      return { top: Math.round(r.top), inHeader: !!dlg.closest("header"), fieldsVisible: [...dlg.querySelectorAll("input,textarea")].every((f) => { const fr = f.getBoundingClientRect(); return fr.top >= 0 && fr.bottom <= window.innerHeight; }) };
    });
    await shot(page, "audit4-newproject-modal.png");
    await page.keyboard.press("Escape");
    await delay(400);
    R.newProjectFocusRestored = await page.evaluate(() => (document.activeElement?.textContent || "").trim() === "New Project");

    await page.evaluate(() => { [...document.querySelectorAll("button")].find((x) => (x.textContent || "").includes("60s Judge Dock"))?.click(); });
    await delay(800);
    let escaped = false;
    for (let i = 0; i < 14; i++) { await page.keyboard.press("Tab"); const inside = await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]')); if (!inside) escaped = true; }
    await page.keyboard.press("Escape");
    await delay(500);
    R.judgeDockFocus = { escaped, restored: await page.evaluate(() => (document.activeElement?.textContent || "").includes("60s Judge Dock")), closed: await page.evaluate(() => !document.querySelector('[role="dialog"]')) };

    // ---------- Fixture: triple-click create
    const before = await getSelectorState(page);
    await page.evaluate(() => { [...document.querySelectorAll("button")].find((b) => (b.textContent || "").trim() === "New Project")?.click(); });
    await delay(600);
    await page.evaluate((v) => {
      const dlg = document.querySelector('[role="dialog"]');
      const input = [...dlg.querySelectorAll("input")].find((i) => (i.placeholder || "").toLowerCase().includes("innovation")) || dlg.querySelector("input");
      const iset = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      iset.call(input, v); input.dispatchEvent(new Event("input", { bubbles: true }));
    }, FIXTURE);
    await delay(200);
    await page.evaluate(() => { const dlg = document.querySelector('[role="dialog"]'); const btn = [...dlg.querySelectorAll("button")].find((b) => (b.textContent || "").includes("Create Commercial Project")); btn.click(); btn.click(); btn.click(); });
    await delay(6000);
    const after = await getSelectorState(page);
    const fixtureOpt = after.options.find((o) => o.text.includes(FIXTURE));
    R.doubleSubmit = { delta: after.options.length - before.options.length, instances: after.options.filter((o) => o.text.includes(FIXTURE)).length, found: !!fixtureOpt };
    await shot(page, "audit4-double-submit.png");
    if (!fixtureOpt) throw new Error("fixture not created");
    await page.evaluate((val) => { const s = document.querySelector('select[aria-label="Select Commercial Construction Project"]'); s.value = val; s.dispatchEvent(new Event("change", { bubbles: true })); }, fixtureOpt.value);
    await delay(1500);
    R.fixtureId = fixtureOpt.value;

    // empty title / negative budget
    await page.evaluate(() => { [...document.querySelectorAll("button")].find((b) => (b.textContent || "").trim() === "New Project")?.click(); });
    await delay(600);
    await page.evaluate(() => { const dlg = document.querySelector('[role="dialog"]'); const input = dlg.querySelector("input"); const iset = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; iset.call(input, "   "); input.dispatchEvent(new Event("input", { bubbles: true })); });
    await page.evaluate(() => { const dlg = document.querySelector('[role="dialog"]'); [...dlg.querySelectorAll("button")].find((b) => (b.textContent || "").includes("Create Commercial Project"))?.click(); });
    await delay(500);
    R.whitespaceTitle = await page.evaluate(() => ({ open: !!document.querySelector('[role="dialog"]'), error: (document.querySelector('[role="dialog"]')?.innerText.match(/required/i) || [])[0] || null }));
    await page.keyboard.press("Escape");
    await delay(300);

    // ---------- Fixture package + zero-recipient dispatch + upload/download
    await clickTab("01:");
    await clickByText("Create Trade Package");
    await delay(700);
    await page.evaluate(() => {
      const h = [...document.querySelectorAll("h3")].find((el) => (el.textContent || "").includes("Create CSI Trade Package"));
      let dlg = h; for (let i = 0; i < 6 && dlg && dlg.parentElement; i++) { dlg = dlg.parentElement; if (dlg.querySelector("input")) break; }
      const iset = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      const tset = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
      for (const el of dlg.querySelectorAll("input,textarea")) {
        const label = (el.closest("div")?.querySelector("label")?.textContent || "").toLowerCase();
        if (label.includes("csi division")) { iset.call(el, "26 00 00"); el.dispatchEvent(new Event("input", { bubbles: true })); }
        if (label.includes("trade package name")) { iset.call(el, "AUDIT-4 Electrical"); el.dispatchEvent(new Event("input", { bubbles: true })); }
        if (label.includes("scope summary")) { tset.call(el, "Audit scope."); el.dispatchEvent(new Event("input", { bubbles: true })); }
      }
    });
    await delay(300);
    await clickByText("Create Package", true);
    await delay(2500);
    await page.evaluate(() => {
      const cards = [...document.querySelectorAll("div")].filter((d) => (d.innerText || "").includes("AUDIT-4 Electrical") && (d.innerText || "").includes("Dispatch RFQs"));
      const card = cards[cards.length - 1];
      const btn = card ? [...card.querySelectorAll("button")].find((b) => (b.textContent || "").includes("Dispatch RFQs")) : null;
      if (btn) { btn.click(); btn.click(); }
    });
    await delay(2500);
    R.zeroDispatch = { toast: await page.evaluate(() => document.querySelector('[role="status"]')?.textContent || null) };
    const pkgs = await http.query("tradePackages:listByProject", { projectId: fixtureOpt.value });
    const pkg = pkgs.find((p) => p.tradeName === "AUDIT-4 Electrical");
    const logs = await http.query("auditLogs:listRecentLogs", { projectId: fixtureOpt.value, limit: 30 });
    R.zeroDispatch.backendStatus = pkg?.status;
    R.zeroDispatch.dispatchedEvents = logs.filter((l) => l.eventType === "rfq_dispatched").length;
    await shot(page, "audit4-zero-dispatch.png");

    // upload + download truth
    await page.evaluate(() => { const select = [...document.querySelectorAll("select")].find((s) => [...s.options].some((o) => o.value === "spec")); if (select) { select.value = "spec"; select.dispatchEvent(new Event("change", { bubbles: true })); } });
    const up = path.join(EV, "audit4-upload-proof.txt");
    fs.writeFileSync(up, "AUDIT4-STORED-BYTES-PROOF 2026-09-18");
    const input = await page.$("input#convex-file-upload");
    await input.uploadFile(up);
    let uploaded = false;
    for (let i = 0; i < 15; i++) { await delay(1000); uploaded = await page.evaluate(() => document.body.innerText.includes("audit4-upload-proof.txt")); if (uploaded) break; }
    R.upload = { visible: uploaded };
    await page.evaluate(() => { const rows = [...document.querySelectorAll("div")].filter((d) => (d.innerText || "").includes("audit4-upload-proof.txt") && (d.innerText || "").includes("Download")); const row = rows[rows.length - 1]; row ? [...row.querySelectorAll("button")].find((b) => (b.textContent || "").includes("Download"))?.click() : null; });
    await delay(4500);
    const dls = fs.existsSync(DL) ? fs.readdirSync(DL) : [];
    const target = dls.find((f) => f.includes("audit4-upload-proof"));
    R.download = { file: target || null, trueBytes: target ? fs.readFileSync(path.join(DL, target), "utf8").includes("AUDIT4-STORED-BYTES-PROOF") : null };

    // preview caption
    await page.evaluate(() => { const rows = [...document.querySelectorAll("div")].filter((d) => (d.innerText || "").includes("audit4-upload-proof.txt") && (d.innerText || "").includes("Preview")); const row = rows[rows.length - 1]; row ? [...row.querySelectorAll("button")].find((b) => (b.textContent || "").includes("Preview"))?.click() : null; });
    await delay(1200);
    R.previewCaption = await page.evaluate(() => { const t = document.body.innerText; return { falseClaim: t.includes("100% Real"), truthful: /Stored in Convex _storage/.test(t), showsBytes: t.includes("AUDIT4-STORED-BYTES-PROOF") }; });
    await page.keyboard.press("Escape");
    await delay(400);

    // discovery provenance on fixture
    await clickTab("02:");
    await clickByText("Discover Trade Contractors");
    await delay(35000);
    R.discovery = await page.evaluate(() => {
      const t = document.body.innerText;
      return {
        claimsTdlr: /Active \/ Verified \(TDLR\)/.test(t),
        unverifiedLabels: (t.match(/Unverified[^\n]*/g) || []).slice(0, 4),
        fakePattern: (t.match(/TX-26-20\d{3}/g) || []).slice(0, 3),
        contactNotPublished: t.includes("Contact not published"),
        banner: (t.match(/Trade Directory \([^\n]*\)/) || [])[0] || null,
      };
    });
    await shot(page, "audit4-discovery.png", { full: true });

    // backend reconciliation
    const demoProject = (await http.query("projects:listProjects", {})).find((p) => p.isDemoProject);
    const demoBids = await http.query("bids:listAllProjectBids", { projectId: demoProject._id });
    const demoAgreements = await http.query("agreements:listAgreements", { projectId: demoProject._id });
    const demoPkgs = await http.query("tradePackages:listByProject", { projectId: demoProject._id });
    const effective = (pid) => { const list = demoBids.filter((b) => b.tradePackageId === pid).sort((a, b) => (a.isAwarded === b.isAwarded ? a.leveledTotalCost - b.leveledTotalCost : b.isAwarded ? 1 : -1)); return list[0]; };
    const buyout = demoPkgs.reduce((s, p) => { const b = effective(p._id); return s + (b ? b.leveledTotalCost : p.budgetEstimate); }, 0);
    const awarded = new Set(demoAgreements.filter((a) => a.status !== "superseded").map((a) => a.tradePackageId));
    R.backend = {
      demoProject: demoProject.title,
      packages: demoPkgs.length,
      bids: demoBids.length,
      agreements: demoAgreements.map((a) => ({ n: a.agreementNumber, status: a.status, sum: a.contractSum, ld: a.liquidatedDamagesDaily })),
      computedBuyout: buyout,
      computedAwarded: [...awarded].length,
      providerAvailability: await http.query("llmRouter:getProviderAvailability", {}),
    };

    R.diag = { consoleErrors: diag.consoleLogs.filter((l) => l.type === "error").map((l) => l.text.slice(0, 120)).slice(0, 8), pageErrors: diag.pageErrors.slice(0, 5), failedRequests: diag.failedRequests.slice(0, 5) };
    writeJson("audit4-regression.json", R);
  } catch (e) {
    R.error = String(e && e.stack ? e.stack : e);
    writeJson("audit4-regression.json", R);
  } finally {
    await browser.close();
  }
  console.log(JSON.stringify(R, null, 2).slice(0, 14000));
};
run();