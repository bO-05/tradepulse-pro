import { launchBrowser, attachDiagnostics, waitForAppReady, shot, delay, clickButtonByText, selectProjectByTitle, setInputValue } from "./lib.mjs";
import { client, readEvidence, writeEvidence, writeLog, sleep } from "./qa16-lib.mjs";

const fx = readEvidence("fixtures");
const c = client();
const log = [];
const say = (s) => { log.push(s); console.log(s); };
const results = { steps: [] };
const step = (name, value) => { results.steps.push({ name, ...value }); say(`[${name}] ${JSON.stringify(value).slice(0, 300)}`); };

async function main() {
  const { browser } = await launchBrowser(1500, 950);
  const pageA = await browser.newPage();
  const pageB = await browser.newPage();
  const diagA = attachDiagnostics(pageA);
  const diagB = attachDiagnostics(pageB);

  const boot = async (page, projectId, label) => {
    await page.goto(`https://brainy-skunk-440.convex.site/?project=${projectId}&tab=packages&qa16=${label}`, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await waitForAppReady(page);
    await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find(
        (x) => (x.getAttribute("title") || "").includes("Close Demo Tour") || (x.textContent || "").trim() === "Dismiss"
      );
      b?.click();
    });
    await delay(700);
    const sel = await page.evaluate(() => {
      const s = document.querySelector('select[aria-label="Select Commercial Construction Project"]');
      return s ? { value: s.value, text: s.options[s.selectedIndex]?.textContent?.trim() } : null;
    });
    say(`[boot ${label}] selected=${JSON.stringify(sel)}`);
    return sel;
  };

  const selectPackage = (page, needle) =>
    page.evaluate((n) => {
      const nodes = [...document.querySelectorAll("button, [role=button], div")];
      const hit = nodes.find((el) => (el.textContent || "").includes(n) && (el.className || "").includes("cursor-pointer"));
      if (!hit) return { ok: false };
      hit.click();
      return { ok: true, text: (hit.textContent || "").slice(0, 80) };
    }, needle);

  const mainTextExcludingSelect = (page) =>
    page.evaluate(() => {
      const main = document.querySelector("main") || document.body;
      const clone = main.cloneNode(true);
      clone.querySelectorAll("select, option").forEach((n) => n.remove());
      return clone.innerText;
    });

  try {
    await boot(pageA, fx.projectA.id, "A");
    await boot(pageB, fx.projectB.id, "B");

    // 1) Award in A (leveling tab, package A-P2 HVAC)
    try {
      const tab = await clickButtonByText(pageA, "Bid Leveling");
      await delay(600);
      const pkg = await selectPackage(pageA, "AUDIT-QA16 HVAC");
      await delay(600);
      const award = await pageA.evaluate(() => {
        const btns = [...document.querySelectorAll("button")];
        const b = btns.find((x) => (x.getAttribute("title") || "").startsWith("Award the lowest leveled bidder"));
        if (!b) return { ok: false, titles: btns.map((x) => x.getAttribute("title")).filter(Boolean).slice(0, 20) };
        b.click();
        return { ok: true, title: b.getAttribute("title") };
      });
      await delay(2500);
      const snap = await c.query("agreements:listAgreements", { projectId: fx.projectA.id });
      step("award-in-A", { tab, pkg, award, agreementCount: snap.length, awarded: snap[0] ? { number: snap[0].agreementNumber, bid: snap[0].bidId } : null });
      await shot(pageA, "fix4-qa16-twotab-award-A.png");
    } catch (e) { step("award-in-A", { error: String(e).slice(0, 300) }); }

    // 2) RFI in B (qna tab)
    try {
      await clickButtonByText(pageB, "Pre-Bid Q&A");
      await delay(600);
      await setInputValue(pageB, 'input[aria-label="RFI subject or scope topic"]', "AUDIT-QA16-B RFI subject");
      await setInputValue(pageB, 'textarea[aria-label="Subcontractor question"]', "AUDIT-QA16-B: confirm fire pump controller wiring responsibility between Div 21 and Div 26.");
      await delay(200);
      const submit = await clickButtonByText(pageB, "Submit RFI");
      await delay(2500);
      const convos = (await c.query("rfq:listClarifiedConversationsForProject", { projectId: fx.projectB.id })) || [];
      const anyConvo = await c.query("rfq:listConversations", { tradePackageId: fx.projectB.package });
      step("rfi-in-B", { submit, conversationCount: (anyConvo || []).length });
      await shot(pageB, "fix4-qa16-twotab-rfi-B.png");
    } catch (e) { step("rfi-in-B", { error: String(e).slice(0, 300) }); }

    // 3) Delete package P4 in A via UI
    try {
      await clickButtonByText(pageA, "CSI Scoping");
      await delay(700);
      const trash = await pageA.evaluate(() => {
        const cards = [...document.querySelectorAll("div")].filter((d) => (d.textContent || "").includes("AUDIT-QA16 Delete Target"));
        for (const card of cards) {
          const b = card.querySelector('button[title="Delete Trade Package"]');
          if (b) { b.click(); return { ok: true }; }
        }
        return { ok: false };
      });
      await delay(500);
      const confirm = await clickButtonByText(pageA, "Delete package", { exact: true });
      await delay(1800);
      const p4 = await c.query("tradePackages:getPackage", { tradePackageId: fx.projectA.packages.p4 });
      step("delete-P4-A", { trash, confirm, p4StillExists: Boolean(p4) });
      await shot(pageA, "fix4-qa16-twotab-delete-A.png");
    } catch (e) { step("delete-P4-A", { error: String(e).slice(0, 300) }); }

    // 4) Add contractor manually in B
    try {
      await clickButtonByText(pageB, "Discovery");
      await delay(700);
      const opened = await clickButtonByText(pageB, "Add Contractor Manually");
      await delay(500);
      await setInputValue(pageB, 'input[aria-label="Company name"]', "AUDIT-QA16-B Manual Added Co");
      await setInputValue(pageB, 'input[aria-label="Contact email"]', "qa16.b.manual@qa16.invalid");
      await setInputValue(pageB, 'input[aria-label="Phone number"]', "+1 (312) 555-0188");
      await setInputValue(pageB, 'input[aria-label="State license or registration"]', "IL-QA16-7777");
      const statusSel = await pageB.evaluate(() => {
        const s = document.querySelector('select[aria-label="License verification status"]');
        if (!s) return { ok: false };
        const opt = [...s.options].find((o) => /active|verified/i.test(o.textContent));
        s.value = opt ? opt.value : s.options[0].value;
        s.dispatchEvent(new Event("change", { bubbles: true }));
        return { ok: true, value: s.value, text: s.options[s.selectedIndex]?.textContent };
      });
      await delay(200);
      const save = await pageB.evaluate(() => {
        const dlg = document.querySelector('[role="dialog"][aria-labelledby="add-contractor-title"]');
        if (!dlg) return { ok: false, reason: "modal gone" };
        const b = [...dlg.querySelectorAll("button")].find((x) => (x.textContent || "").trim() === "Add Contractor");
        if (!b) return { ok: false, buttons: [...dlg.querySelectorAll("button")].map((x) => x.textContent.trim()) };
        b.click();
        return { ok: true, disabled: b.disabled };
      });
      await delay(2000);
      const ctrs = (await c.query("contractors:listByPackage", { tradePackageId: fx.projectB.package })) || [];
      step("add-contractor-B", { opened, statusSel, save, names: ctrs.map((x) => x.companyName) });
      await shot(pageB, "fix4-qa16-twotab-add-B.png");
    } catch (e) { step("add-contractor-B", { error: String(e).slice(0, 300) }); }

    // 5) Cross-project leakage scan (main text minus select options)
    const textA = await mainTextExcludingSelect(pageA);
    const textB = await mainTextExcludingSelect(pageB);
    const selA = await pageA.evaluate(() => document.querySelector('select[aria-label="Select Commercial Construction Project"]')?.value);
    const selB = await pageB.evaluate(() => document.querySelector('select[aria-label="Select Commercial Construction Project"]')?.value);
    step("cross-leak-scan", {
      selA, selB,
      A_mentions_B_fixture: textA.includes("AUDIT-QA16-B"),
      B_mentions_A_fixture: /\bAUDIT-QA16 (Electrical|HVAC|Plumbing|Delete)/.test(textB),
      A_mentions_A: textA.includes("AUDIT-QA16-A") || textA.includes("AUDIT-QA16"),
    });

    // 6) Stale-id: open delete-confirm on a package, delete it from backend, then confirm in UI.
    try {
      await clickButtonByText(pageA, "CSI Scoping");
      await delay(700);
      const openDlg = await pageA.evaluate(() => {
        const cards = [...document.querySelectorAll("div")].filter((d) => (d.textContent || "").includes("AUDIT-QA16 Plumbing Draft"));
        for (const card of cards) {
          const b = card.querySelector('button[title="Delete Trade Package"]');
          if (b) { b.click(); return { ok: true }; }
        }
        return { ok: false };
      });
      await delay(400);
      await c.mutation("tradePackages:deleteTradePackage", { tradePackageId: fx.projectA.packages.p3 });
      await sleep(700);
      const confirm = await clickButtonByText(pageA, "Delete package", { exact: true });
      await delay(1800);
      const after = await pageA.evaluate(() => {
        const dlg = [...document.querySelectorAll('[role="dialog"]')].find((d) => (d.textContent || "").includes("Delete trade package"));
        return {
          dialogOpen: Boolean(dlg),
          alert: dlg ? (dlg.querySelector('[role="alert"]')?.textContent ?? null) : null,
          dlgText: dlg ? dlg.innerText.slice(0, 200) : null,
        };
      });
      step("stale-confirm-delete", { openDlg, confirm, after });
      await shot(pageA, "fix4-qa16-twotab-stale-delete.png");
    } catch (e) { step("stale-confirm-delete", { error: String(e).slice(0, 300) }); }

    results.diagA = { consoleErrors: diagA.consoleLogs.filter((l) => l.type === "error").map((l) => l.text).slice(0, 8), pageErrors: diagA.pageErrors.slice(0, 8), failed: diagA.failedRequests.slice(0, 8) };
    results.diagB = { consoleErrors: diagB.consoleLogs.filter((l) => l.type === "error").map((l) => l.text).slice(0, 8), pageErrors: diagB.pageErrors.slice(0, 8), failed: diagB.failedRequests.slice(0, 8) };
  } finally {
    await browser.close();
  }

  writeEvidence("twotab", results);
  writeLog("twotab", log);
  console.log("done");
}

main().catch((e) => {
  console.error(e);
  writeLog("twotab-crash", [String(e && e.stack ? e.stack : e)]);
  process.exit(1);
});