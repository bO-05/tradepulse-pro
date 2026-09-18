/**
 * QA8 UI verification — A6-01 focus trap stacking, A6-02 accessible names,
 * A6-03 contrast, A5-01 Audit tab claim scan, A5-02 inline confirm error,
 * plus Contracts register/viewer hunt (download/print/filter/executed banner).
 * Fixture: AUDIT-QA8-unaward-2026-09-18 (created and deleted here).
 * Evidence: evidence/fix4-qa8-20-ui.json + screenshots.
 */
import fs from "node:fs";
import path from "node:path";
import {
  attachDiagnostics,
  clickHeaderTab,
  delay,
  getSelectorState,
  gotoDemo,
  launchBrowser,
  selectProjectByTitle,
  writeJson,
} from "./qa6-lib.mjs";
import { STACK_PROBE, armOpenerBySelector, armOpenerByText, axScan, tabSweep } from "./qa6-lib.mjs";
import { shot } from "./lib.mjs";
import { client, fixtureName } from "./qa8-lib.mjs";

const c = client();
const prefix = fixtureName("unaward");
const out = {
  url: "https://brainy-skunk-440.convex.site",
  viewport: "1440x900",
  startedAt: new Date().toISOString(),
  fixture: { title: prefix },
  items: {},
  contracts: {},
};
const lines = [];
const record = (id, label, obj) => {
  out.items[id] = obj;
  lines.push(`${id} ${label}: ${JSON.stringify(obj).slice(0, 400)}`);
};

let projectId;
try {
  // ------------------------------------------------------------- fixture setup
  projectId = await c.mutation("projects:createProject", {
    title: prefix,
    location: "Austin, TX",
    projectType: "Class-A Commercial Mixed-Use",
    estBudget: 2_000_000,
    targetCompletionWeeks: 40,
    specDocumentText: "QA8 UI fixture spec.",
    isDemoProject: false,
  });
  const pkg = await c.mutation("tradePackages:createTradePackage", {
    projectId,
    csiDivision: "26 00 00",
    tradeName: "QA8 Electrical",
    budgetEstimate: 1_200_000,
    scopeSummary: "QA8 scope.",
    mandatoryInclusions: ["Code compliance"],
    bidDeadline: "2026-10-31",
  });
  const contractorId = await c.mutation("contractors:createContractor", {
    tradePackageId: pkg,
    companyName: "QA8 Unaward Co",
    contactEmail: "unaward@qa8.test",
    phone: "+1 (512) 555-0188",
    licenseNumber: "TX-QA8-UNAWARD",
    licenseStatus: "Active / Verified",
    sourceUrl: "https://qa8.test/unaward",
    rfqStatus: "invited",
  });
  const bidRes = await c.mutation("bids:submitDirectBid", {
    tradePackageId: pkg,
    contractorId,
    subcontractorName: "QA8 Unaward Co",
    baseBidAmount: 1_050_000,
  });
  const gen = await c.mutation("agreements:generateAgreement", { bidId: bidRes.bidId, tradePackageId: pkg });
  await c.mutation("agreements:executeAgreement", { agreementId: gen._id });
  out.fixture.projectId = projectId;
  out.fixture.packageId = pkg;
  out.fixture.agreementNumber = gen.agreementNumber;

  const { browser } = await launchBrowser(1440, 900);
  const page = await browser.newPage();
  const diagnostics = attachDiagnostics(page);
  try {
    const demo = await gotoDemo(page);
    out.demo = demo;

    // -------------------------------------------------------------- A6-01
    const dock = await armOpenerByText(page, "60s Judge Dock");
    await page.mouse.click(dock.x, dock.y);
    await delay(650);
    const dockOpen = await page.evaluate(STACK_PROBE);
    const reset = await armOpenerByText(page, "Reset Demo Data");
    await page.mouse.click(reset.x, reset.y);
    await delay(650);
    const confirmOpen = await page.evaluate(STACK_PROBE);
    const confirmTabs = await tabSweep(page, { times: 30, mode: "top" });
    const confirmTabBack = await tabSweep(page, { times: 10, mode: "top", shift: true });
    await shot(page, "fix4-qa8-20-A6-01-confirm-tabtrap.png");
    await page.keyboard.press("Escape");
    await delay(500);
    const afterFirst = await page.evaluate(STACK_PROBE);
    await page.keyboard.press("Escape");
    await delay(500);
    const afterSecond = await page.evaluate(STACK_PROBE);
    await shot(page, "fix4-qa8-20-A6-01-after-escape.png");
    record("A6_01", "judge dock reset confirm tab trap", {
      dockOpened: dockOpen.dialogCount === 1,
      confirmRole: confirmOpen.topRole,
      confirmLabel: confirmOpen.topLabelledbyText,
      tabForwardOutsideStops: confirmTabs.outside,
      tabForwardStops: confirmTabs.stops.length,
      tabBackwardOutsideStops: confirmTabBack.outside,
      firstTabStop: confirmTabs.first,
      afterFirstEscape: { role: afterFirst.topRole, dialogs: afterFirst.dialogCount, label: afterFirst.topLabelledbyText },
      afterSecondEscape: { dialogs: afterSecond.dialogCount, overlays: afterSecond.overlayCount, bodyOverflow: afterSecond.bodyOverflowComputed },
    });

    // -------------------------------------------------------------- A6-02
    await clickHeaderTab(page, "02: Discovery");
    const axClient = await page.createCDPSession();
    const scanDialog = async (id, name, arm) => {
      await page.evaluate(() => window.scrollTo(0, 0));
      await delay(250);
      const op = await arm();
      if (!op) {
        record(id, name, { error: "opener not found" });
        return;
      }
      await page.mouse.click(op.x, op.y);
      await delay(700);
      const rootSel = await page.evaluate(() => {
        const ds = [...document.querySelectorAll('[role="dialog"]')].filter((e) => e.getBoundingClientRect().width > 0);
        const d = ds[ds.length - 1];
        if (!d) return null;
        d.setAttribute("data-qa8-dialog", "1");
        return '[data-qa8-dialog="1"]';
      });
      if (!rootSel) {
        record(id, name, { error: "no dialog", opener: op });
        return;
      }
      const scan = await axScan(page, axClient, rootSel, "input,select,textarea");
      await shot(page, `fix4-qa8-20-${id}.png`);
      await page.evaluate(() => document.querySelector('[data-qa8-dialog="1"]')?.removeAttribute("data-qa8-dialog"));
      await page.keyboard.press("Escape");
      await delay(450);
      record(id, name, {
        visibleCount: scan.visibleCount,
        unnamedCount: scan.unnamedCount,
        unnamed: scan.unnamed.map((u) => `${u.tag}${u.type ? "[" + u.type + "]" : ""}:${u.ariaLabel ?? "NO-NAME"}`),
        namedSample: scan.named.slice(0, 8).map((n) => `${n.role}:${n.name}`),
      });
    };
    await scanDialog("A6_02_add", "add contractor accessible names", () => armOpenerByText(page, "Add Contractor Manually"));
    await scanDialog("A6_02_edit", "edit contractor accessible names", () =>
      armOpenerBySelector(page, 'button[title="Edit contractor info"]')
    );

    // -------------------------------------------------------------- A6-03
    await clickHeaderTab(page, "05: Scope Clash");
    await delay(900);
    const contrast = await page.evaluate(() => {
      const lum = (c) => {
        const [r, g, b] = c.map((v) => {
          v /= 255;
          return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
        });
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      const parse = (s) => (s.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
      const btns = [...document.querySelectorAll("button")].filter((b) => /Assign to Div/.test(b.innerText));
      return btns.map((b) => {
        const cs = getComputedStyle(b);
        const fg = parse(cs.color);
        const bg = parse(cs.backgroundColor);
        const L1 = Math.max(lum(fg), lum(bg));
        const L2 = Math.min(lum(fg), lum(bg));
        return {
          text: b.innerText.trim().replace(/\s+/g, " ").slice(0, 40),
          color: cs.color,
          bg: cs.backgroundColor,
          ratio: Number(((L1 + 0.05) / (L2 + 0.05)).toFixed(2)),
          fontSize: cs.fontSize,
          fontWeight: cs.fontWeight,
        };
      });
    });
    const hvac = contrast.find((b) => /Div 23/.test(b.text)) || null;
    await shot(page, "fix4-qa8-20-A6-03-clash-contrast.png");
    record("A6_03", "scope clash assign button contrast", {
      hvac,
      allAssignButtons: contrast,
      pass: !!hvac && hvac.ratio >= 4.5,
    });

    // -------------------------------------------------------------- A5-01 UI
    await clickHeaderTab(page, "Live Activity Audit");
    await delay(1200);
    const auditUi = await page.evaluate(() => {
      const text = document.body.innerText;
      const tdlrLines = text
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => /TDLR/i.test(l));
      return {
        tdlrLineCount: tdlrLines.length,
        tdlrLines: tdlrLines.slice(0, 12),
        cronCardMentionsRegistry: /no registry lookup is performed|recorded contractor license statuses/i.test(text),
      };
    });
    await shot(page, "fix4-qa8-20-A5-01-audit-tdlr.png");
    record("A5_01_ui", "audit tab TDLR scan", auditUi);

    // -------------------------------------------------------------- Contracts (executed)
    await selectProjectByTitle(page, prefix);
    await delay(1600);
    await clickHeaderTab(page, "06: Subcontracts");
    await delay(1200);
    const register = await page.evaluate((agrNo) => {
      const text = document.body.innerText;
      return {
        hasAgreementNumber: text.includes(agrNo),
        executedBadge: /Execution Status Recorded/i.test(text),
        executedSummary: /Execution Statuses Recorded/i.test(text),
        rows: [...document.querySelectorAll("tbody tr")].map((tr) => tr.innerText.replace(/\s+/g, " ").slice(0, 120)),
      };
    }, gen.agreementNumber);
    await shot(page, "fix4-qa8-20-contracts-register.png");
    out.contracts.register = register;

    // search filter
    const searchSel = 'input[placeholder="Search by agreement #, subcontractor, trade, or CSI division..."]';
    await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      setter.call(el, "zzz-no-match-qa8");
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }, searchSel);
    await delay(500);
    const emptyState = await page.evaluate(() => document.body.innerText.includes("No agreements match your search criteria."));
    await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      setter.call(el, "");
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }, searchSel);
    await delay(500);
    out.contracts.filter = { noMatchEmptyState: emptyState };

    // status filter chips
    const statusFilters = await page.evaluate(() => {
      const btns = [...document.querySelectorAll("button")].filter((b) => /Execution Status Recorded|Pending Execution|Active Contracts/.test(b.innerText));
      return btns.map((b) => b.innerText.trim());
    });
    out.contracts.statusFilters = statusFilters;

    // viewer + download + print
    await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) => /Inspect Draft/.test(x.innerText));
      if (b) b.click();
    });
    await delay(700);
    const viewer = await page.evaluate(() => {
      const dlg = [...document.querySelectorAll("div.fixed.inset-0")].filter((e) => e.getBoundingClientRect().width > 0).pop();
      const text = dlg ? dlg.innerText : "";
      return {
        open: !!dlg,
        title: (dlg?.querySelector("h3")?.innerText || "").replace(/\s+/g, " ").slice(0, 80),
        executedBanner: /Execution recorded in TradePulse/i.test(text),
        signatureRequired: /SIGNATURE REQUIRED|signature verification required/i.test(text),
        hasGoodPhrase: /this A401-style Subcontract Agreement draft/.test(text),
        hasBadPhrase: /this AIA Document A401 Agreement/.test(text),
        fileText: text.slice(0, 600),
      };
    });
    await shot(page, "fix4-qa8-20-contracts-viewer.png");
    out.contracts.viewer = viewer;

    // print interception
    await page.evaluate(() => {
      window.__qa8PrintCalls = 0;
      window.print = () => {
        window.__qa8PrintCalls += 1;
      };
    });
    await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) => (x.getAttribute("title") || "") === "Print agreement or save as PDF");
      if (b) b.click();
    });
    await delay(400);
    out.contracts.printCalls = await page.evaluate(() => window.__qa8PrintCalls);

    // download interception
    const downloadDir = path.resolve("evidence", "fix4-qa8-downloads");
    fs.mkdirSync(downloadDir, { recursive: true });
    const cdp = await page.createCDPSession();
    await cdp.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: downloadDir, eventsEnabled: true });
    const suggestions = [];
    cdp.on("Browser.downloadWillBegin", (e) => suggestions.push(e.suggestedFilename));
    await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) => (x.getAttribute("title") || "") === "Download subcontract agreement text file");
      if (b) b.click();
    });
    await delay(1500);
    const files = fs.existsSync(downloadDir) ? fs.readdirSync(downloadDir) : [];
    let downloaded = null;
    if (files.length) {
      const p = path.join(downloadDir, files[0]);
      const txt = fs.readFileSync(p, "utf8");
      downloaded = {
        file: files[0],
        bytes: Buffer.byteLength(txt, "utf8"),
        startsGood: txt.includes("this A401-style Subcontract Agreement draft"),
        hasBadPhrase: txt.includes("this AIA Document A401 Agreement"),
        fileNameClaimsAIA: /AIA_A401/i.test(files[0]),
      };
    }
    out.contracts.download = { suggestedFilenames: suggestions, downloaded };

    // selector state: close then reopen and check selected agreement remains consistent
    await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) => /Close Viewer/.test(x.innerText));
      if (b) b.click();
    });
    await delay(400);
    const viewerClosed = await page.evaluate(() => !document.body.innerText.includes("Close Viewer"));
    out.contracts.viewerClosedAfterClose = viewerClosed;

    // -------------------------------------------------------------- A5-02
    await selectProjectByTitle(page, prefix);
    await delay(1500);
    await clickHeaderTab(page, "04: Bid Leveling");
    await delay(1500);
    const unawardBtn = await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) => /^Unaward$/.test(x.innerText.trim()));
      if (!b) return { ok: false, buttons: [...document.querySelectorAll("button")].map((x) => x.innerText.trim()).filter(Boolean).slice(0, 60) };
      b.scrollIntoView({ block: "center" });
      const r = b.getBoundingClientRect();
      return { ok: true, x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    out.items.A5_02 = { unawardButton: unawardBtn };
    if (unawardBtn.ok) {
      await page.mouse.click(unawardBtn.x, unawardBtn.y);
      await delay(650);
      const confirm = await page.evaluate(STACK_PROBE);
      const confirmBtn = await page.evaluate(() => {
        const dlg = [...document.querySelectorAll('[role="alertdialog"]')].filter((e) => e.getBoundingClientRect().width > 0).pop();
        const b = dlg && [...dlg.querySelectorAll("button")].find((x) => /Unaward proposal/i.test(x.innerText));
        if (!b) return null;
        const r = b.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      });
      out.items.A5_02.confirm = { role: confirm.topRole, label: confirm.topLabelledbyText, confirmBtnFound: !!confirmBtn };
      if (confirmBtn) {
        await page.mouse.click(confirmBtn.x, confirmBtn.y);
        await delay(2000);
        const after = await page.evaluate(() => {
          const dlgs = [...document.querySelectorAll('[role="alertdialog"],[role="dialog"]')].filter((e) => e.getBoundingClientRect().width > 0);
          const top = dlgs[dlgs.length - 1];
          const alert = top ? top.querySelector('[role="alert"]') : null;
          const toasts = [...document.querySelectorAll('[role="status"],[role="alert"]')].filter((e) => {
            const r = e.getBoundingClientRect();
            return r.width > 0 && (!top || !top.contains(e));
          });
          return {
            dialogsOpen: dlgs.length,
            topRole: top?.getAttribute("role") ?? null,
            topLabel: (top?.querySelector("h1,h2,h3")?.innerText || "").slice(0, 60),
            inlineAlertPresent: !!alert,
            inlineAlertText: alert ? alert.innerText.trim().slice(0, 240) : null,
            outsideAlerts: toasts.map((t) => t.innerText.trim().slice(0, 200)).slice(0, 4),
          };
        });
        out.items.A5_02.afterConfirm = after;
        await shot(page, "fix4-qa8-20-A5-02-unaward-confirm.png");
        await page.keyboard.press("Escape");
        await delay(400);
      }
    }
    record("A5_02", "executed unaward inline error", out.items.A5_02);

    // ------------------------------------------------------------- diagnostics
    await delay(500);
    const errors = diagnostics.consoleLogs.filter((l) => l.type === "error");
    const dupCounts = {};
    for (const r of diagnostics.requests) {
      const key = `${r.method} ${r.url}`;
      dupCounts[key] = (dupCounts[key] || 0) + 1;
    }
    const duplicates = Object.entries(dupCounts)
      .filter(([, n]) => n > 1)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([k, n]) => `${n}x ${k}`);
    out.diagnostics = {
      consoleErrors: errors.map((e) => e.text.slice(0, 200)),
      pageErrors: diagnostics.pageErrors,
      failedRequests: diagnostics.failedRequests,
      requestCount: diagnostics.requests.length,
      topDuplicates: duplicates,
    };
  } finally {
    await browser.close();
  }
} catch (err) {
  out.fatal = String(err?.stack ?? err);
  console.error("FATAL", err);
} finally {
  const all = await c.query("projects:listProjects", {});
  const mine = all.filter((p) => p.title.startsWith("AUDIT-QA8-"));
  out.cleanup = { deleted: [], leftover: [] };
  for (const p of mine) {
    try {
      await c.mutation("projects:deleteProject", { projectId: p._id });
      out.cleanup.deleted.push(p._id);
    } catch (err) {
      out.cleanup.deleted.push(`${p._id}:FAILED:${err?.message ?? err}`);
    }
  }
  await delay(1200);
  const after = await c.query("projects:listProjects", {});
  out.cleanup.leftover = after.filter((p) => p.title.startsWith("AUDIT-QA8-")).map((p) => p._id);
  writeJson("fix4-qa8-20-ui.json", out);
  console.log(lines.join("\n"));
  console.log(`cleanup: deleted=${out.cleanup.deleted.length} leftover=${out.cleanup.leftover.length}`);
  if (out.contracts.download?.downloaded) console.log(`download: ${JSON.stringify(out.contracts.download.downloaded)}`);
}