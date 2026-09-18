import {
  launchBrowser, attachDiagnostics, waitForAppReady, shot, writeJson, delay, getSelectorState, writeLog,
} from "./lib.mjs";

const FIXTURE = "AUDIT-ADV-2026-09-18";
const results = { startedAt: new Date().toISOString() };

const run = async () => {
  const { browser } = await launchBrowser(1440, 900);
  const page = await browser.newPage();
  const diag = attachDiagnostics(page);

  const clickByText = async (t, exact = false) => page.evaluate(({ t, exact }) => {
    const b = [...document.querySelectorAll("button")].find((x) => { const s = (x.textContent || "").trim(); return exact ? s === t : s.includes(t); });
    if (!b) return { ok: false };
    b.click();
    return { ok: true, text: (b.textContent || "").trim(), disabled: b.disabled };
  }, { t, exact });

  const openNewProject = async () => {
    await page.evaluate(() => { [...document.querySelectorAll("button")].find((b) => (b.textContent || "").trim() === "New Project")?.click(); });
    await delay(700);
  };
  const setTitle = async (value) => page.evaluate((v) => {
    const dlg = document.querySelector('[role="dialog"]');
    const input = [...dlg.querySelectorAll("input")].find((i) => (i.placeholder || "").toLowerCase().includes("innovation")) || dlg.querySelector("input");
    const iset = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    iset.call(input, v);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    return input.value.length;
  }, value);
  const submitNewProject = async () => page.evaluate(() => {
    const dlg = document.querySelector('[role="dialog"]');
    [...dlg.querySelectorAll("button")].find((b) => (b.textContent || "").includes("Create Commercial Project"))?.click();
  });

  try {
    // ---------- 1. Double-submit create project
    await page.goto("https://brainy-skunk-440.convex.site/", { waitUntil: "domcontentloaded", timeout: 60000 });
    await waitForAppReady(page);
    await delay(1200);
    await page.evaluate(() => { const b = [...document.querySelectorAll("button")].find((x) => (x.getAttribute("title") || "").includes("Close Demo Tour") || (x.textContent || "").trim() === "Dismiss"); b?.click(); });
    await delay(300);
    const before = await getSelectorState(page);
    await openNewProject();
    await setTitle(FIXTURE);
    await delay(200);
    // two clicks in the same tick
    await page.evaluate(() => {
      const dlg = document.querySelector('[role="dialog"]');
      const btn = [...dlg.querySelectorAll("button")].find((b) => (b.textContent || "").includes("Create Commercial Project"));
      btn.click(); btn.click();
    });
    let fixtureOpt = null;
    for (let i = 0; i < 15; i++) {
      await delay(1000);
      const sel = await getSelectorState(page);
      fixtureOpt = sel?.options.find((o) => o.text.includes(FIXTURE));
      if (fixtureOpt) break;
    }
    const afterDouble = await getSelectorState(page);
    results.doubleSubmit = {
      beforeCount: before.options.length,
      afterCount: afterDouble.options.length,
      delta: afterDouble.options.length - before.options.length,
      fixtureFound: !!fixtureOpt,
    };
    if (!fixtureOpt) throw new Error("fixture not created; aborting adversarial pass");

    await page.evaluate((val) => {
      const s = document.querySelector('select[aria-label="Select Commercial Construction Project"]');
      s.value = val; s.dispatchEvent(new Event("change", { bubbles: true }));
    }, fixtureOpt.value);
    await delay(1500);

    // ---------- 2. Garbage inputs
    await openNewProject();
    await setTitle("   ");
    await submitNewProject();
    await delay(600);
    results.whitespaceTitle = await page.evaluate(() => ({
      dialogOpen: !!document.querySelector('[role="dialog"]'),
      error: (document.querySelector('[role="dialog"]')?.innerText.match(/required|must be|could not/i) || [])[0] || null,
    }));
    await page.keyboard.press("Escape");
    await delay(400);

    await openNewProject();
    await setTitle("<img src=x onerror=window.__xss=1>Audit XSS");
    await page.evaluate(() => {
      const dlg = document.querySelector('[role="dialog"]');
      const budget = [...dlg.querySelectorAll("input")].find((i) => i.type === "number");
      const iset = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      iset.call(budget, "-1");
      budget.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await submitNewProject();
    await delay(600);
    results.negativeBudget = await page.evaluate(() => ({
      dialogOpen: !!document.querySelector('[role="dialog"]'),
      error: (document.querySelector('[role="dialog"]')?.innerText.match(/positive|must be/i) || [])[0] || null,
    }));
    await page.keyboard.press("Escape");
    await delay(400);

    // ---------- 3. Create package, then double-click dispatch RFQs (zero recipients)
    await page.evaluate(() => { const b = [...document.querySelectorAll("button")].find((x) => (x.getAttribute("title") || "").startsWith("01:")); b?.click(); });
    await delay(900);
    await clickByText("Create Trade Package");
    await delay(700);
    await page.evaluate(() => {
      const h = [...document.querySelectorAll("h3")].find((el) => (el.textContent || "").includes("Create CSI Trade Package"));
      let dlg = h;
      for (let i = 0; i < 6 && dlg && dlg.parentElement; i++) { dlg = dlg.parentElement; if (dlg.querySelector("input")) break; }
      const iset = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      const tset = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
      for (const el of dlg.querySelectorAll("input,textarea")) {
        const label = (el.closest("div")?.querySelector("label")?.textContent || "").toLowerCase();
        if (label.includes("csi division")) { iset.call(el, "26 00 00"); el.dispatchEvent(new Event("input", { bubbles: true })); }
        if (label.includes("trade package name")) { iset.call(el, "AUDIT-ADV Electrical"); el.dispatchEvent(new Event("input", { bubbles: true })); }
        if (label.includes("scope summary")) { tset.call(el, "Adversarial scope."); el.dispatchEvent(new Event("input", { bubbles: true })); }
      }
    });
    await delay(300);
    await clickByText("Create Package", true);
    await delay(2500);
    await page.evaluate(() => {
      const cards = [...document.querySelectorAll("div")].filter((d) => (d.innerText || "").includes("AUDIT-ADV Electrical") && (d.innerText || "").includes("Dispatch RFQs"));
      const card = cards[cards.length - 1];
      const btn = card ? [...card.querySelectorAll("button")].find((b) => (b.textContent || "").includes("Dispatch RFQs")) : null;
      if (btn) { btn.click(); btn.click(); }
    });
    await delay(2500);
    results.doubleDispatch = await page.evaluate(() => {
      const toast = document.querySelector('[role="status"]')?.textContent || null;
      const t = document.body.innerText;
      const blockIdx = t.indexOf("AUDIT-ADV Electrical");
      return { toast, block: blockIdx >= 0 ? t.slice(blockIdx, blockIdx + 240).replace(/\n+/g, " | ") : null };
    });
    await shot(page, "adv-double-dispatch.png");

    // ---------- 4. Mid-flow refresh during RFI submit
    await page.evaluate(() => { const b = [...document.querySelectorAll("button")].find((x) => (x.getAttribute("title") || "").startsWith("03:")); b?.click(); });
    await delay(1000);
    const subject = await page.$('input[placeholder*="Hoisting responsibility"]');
    const question = await page.$('textarea[placeholder*="scope coordination question"]');
    if (subject && question) {
      await subject.click({ clickCount: 3 });
      await page.keyboard.type("AUDIT-ADV: Refresh race test");
      await question.click({ clickCount: 3 });
      await page.keyboard.type("AUDIT-ADV TEST: does a mid-submit refresh duplicate or lose this RFI?");
      await delay(300);
      await page.evaluate(() => { [...document.querySelectorAll("button")].find((b) => (b.textContent || "").includes("Submit RFI"))?.click(); });
      await delay(400);
      await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
      await waitForAppReady(page);
      await delay(2000);
      await page.evaluate(() => { const b = [...document.querySelectorAll("button")].find((x) => (x.getAttribute("title") || "").startsWith("03:")); b?.click(); });
      await delay(1200);
      let countAfter = "0";
      for (let i = 0; i < 20; i++) {
        await delay(1500);
        countAfter = await page.evaluate(() => (document.body.innerText.match(/All RFIs \((\d+)\)/) || [])[1] || "0");
        if (Number(countAfter) > 0) break;
      }
      results.refreshRace = { rfiCountAfter: countAfter };
      await shot(page, "adv-refresh-race.png", { full: true });
    } else {
      results.refreshRace = { error: "fields not found" };
    }

    // ---------- 5. Back button after tab navigation
    await page.evaluate(() => { const b = [...document.querySelectorAll("button")].find((x) => (x.getAttribute("title") || "").startsWith("04:")); b?.click(); });
    await delay(800);
    const beforeBack = await page.evaluate(() => window.location.href);
    await page.goBack();
    await delay(1000);
    results.backButton = {
      before: beforeBack,
      after: await page.evaluate(() => window.location.href),
      activeTab: await page.evaluate(() => (document.querySelector('button[class*="ring-emerald"]')?.textContent || "").slice(0, 60)),
    };

    // ---------- 6. 200% zoom equivalent (720 CSS px)
    await page.setViewport({ width: 720, height: 450, deviceScaleFactor: 1 });
    await delay(600);
    results.zoom200 = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth, overflow: document.documentElement.scrollWidth - window.innerWidth }));
    await shot(page, "adv-zoom-720.png");
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
    await delay(400);

    // ---------- 7. Keyboard-only open + close of New Project
    await page.evaluate(() => document.body.focus());
    let keyboardOpen = false;
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press("Tab");
      const focused = await page.evaluate(() => (document.activeElement?.textContent || "").trim());
      if (focused === "New Project") { await page.keyboard.press("Enter"); keyboardOpen = true; break; }
    }
    await delay(700);
    results.keyboard = {
      reachedButton: keyboardOpen,
      dialogOpen: await page.evaluate(() => !!document.querySelector('[role="dialog"]')),
      firstFocusInDialog: await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]')),
    };
    await page.keyboard.press("Escape");
    await delay(500);
    results.keyboard.focusRestored = await page.evaluate(() => (document.activeElement?.textContent || "").trim() === "New Project");

    // ---------- cleanup: delete fixture via header delete
    await page.evaluate((val) => {
      const s = document.querySelector('select[aria-label="Select Commercial Construction Project"]');
      s.value = val; s.dispatchEvent(new Event("change", { bubbles: true }));
    }, fixtureOpt.value);
    await delay(1500);
    await page.evaluate(() => { [...document.querySelectorAll("button")].find((x) => (x.getAttribute("title") || "").includes("Delete custom project"))?.click(); });
    await delay(700);
    await page.evaluate(() => {
      const d = document.querySelector('[role="alertdialog"]');
      [...d.querySelectorAll("button")].find((b) => (b.textContent || "").includes("Delete project"))?.click();
    });
    await delay(2500);
    const finalSel = await getSelectorState(page);
    results.cleanup = { options: finalSel.options.map((o) => o.text), fixtureGone: !finalSel.options.some((o) => o.text.includes(FIXTURE)) };

    results.diag = { consoleErrors: diag.consoleLogs.filter((l) => l.type === "error").slice(0, 8), pageErrors: diag.pageErrors.slice(0, 5), failedRequests: diag.failedRequests.slice(0, 5) };
    writeJson("fix-adversarial-pass.json", results);
    writeLog("fix-adversarial-log.txt", [`Adversarial pass ${results.startedAt}`, JSON.stringify(results, null, 2)]);
  } catch (e) {
    results.error = String(e && e.stack ? e.stack : e);
    writeJson("fix-adversarial-pass.json", results);
  } finally {
    await browser.close();
  }
  console.log(JSON.stringify(results, null, 2).slice(0, 12000));
};
run();