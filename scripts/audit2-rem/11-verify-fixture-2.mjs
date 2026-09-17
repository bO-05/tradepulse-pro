import {
  launchBrowser, attachDiagnostics, waitForAppReady, shot, writeJson, selectProjectByTitle, delay,
} from "./lib.mjs";

const run = async () => {
  const { browser } = await launchBrowser(1440, 900);
  const page = await browser.newPage();
  const diag = attachDiagnostics(page);
  const out = { startedAt: new Date().toISOString(), checks: {}, net: [] };
  page.on("request", (r) => {
    const u = r.url();
    if (!u.includes("convex.cloud") && !u.includes("convex.site") && !u.includes("localhost")) out.net.push(`${r.method()} ${u}`);
  });

  const clickTab = async (titlePrefix) => {
    await page.evaluate((p) => {
      const b = [...document.querySelectorAll("button")].find((x) => (x.getAttribute("title") || "").startsWith(p));
      b?.click();
    }, titlePrefix);
    await delay(900);
  };
  const clickByText = async (t, exact = false) => page.evaluate(({ t, exact }) => {
    const b = [...document.querySelectorAll("button")].find((x) => { const s = (x.textContent || "").trim(); return exact ? s === t : s.includes(t); });
    if (!b) return { ok: false };
    b.click();
    return { ok: true, text: (b.textContent || "").trim(), disabled: b.disabled };
  }, { t, exact });
  const fillModal = async (heading, values) => page.evaluate(({ heading, vals }) => {
    const h = [...document.querySelectorAll("h2,h3")].find((el) => (el.textContent || "").includes(heading));
    if (!h) return { ok: false, reason: "heading not found" };
    let dlg = h;
    for (let i = 0; i < 6 && dlg.parentElement; i++) { dlg = dlg.parentElement; if (dlg.querySelector("input,textarea") && dlg.className.includes("rounded")) break; }
    const iset = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    const tset = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
    const filled = [];
    for (const el of dlg.querySelectorAll("input,textarea")) {
      const label = (el.closest("div")?.querySelector("label")?.textContent || "").toLowerCase();
      for (const [key, val] of Object.entries(vals)) {
        if (label.includes(key)) {
          if (el.tagName === "TEXTAREA") { tset.call(el, val); el.dispatchEvent(new Event("input", { bubbles: true })); }
          else { iset.call(el, val); el.dispatchEvent(new Event("input", { bubbles: true })); }
          filled.push(label.trim());
        }
      }
    }
    return { ok: true, filled };
  }, { heading, vals: values });

  try {
    await page.goto("https://brainy-skunk-440.convex.site/", { waitUntil: "domcontentloaded", timeout: 60000 });
    await waitForAppReady(page);
    await selectProjectByTitle(page, "AUDIT-REMED");
    await delay(1500);
    // close tour if open
    await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) => (x.getAttribute("title") || "").includes("Close Demo Tour") || (x.textContent || "").includes("Dismiss"));
      b?.click();
    });
    await delay(400);

    out.pkgCountAtStart = await page.evaluate(() => (document.body.innerText.match(/(\d+) Pkgs/) || [])[1]);

    if (out.pkgCountAtStart === "0") {
      await clickByText("Create Trade Package");
      await delay(800);
      out["create-modal-fill"] = await fillModal("Create CSI Trade Package", { "csi division": "26 00 00", "trade package name": "AUDIT Electrical", "scope summary": "AUDIT verification scope.", "budget estimate": "1250000" });
      await delay(300);
      out["create-submit"] = await clickByText("Create Package", true);
      await delay(3000);
    }
    out.pkgBadgeAfter = await page.evaluate(() => (document.body.innerText.match(/(\d+) Pkgs/) || [])[1]);
    await shot(page, "fix-fixture-packages.png");

    // ---------- BUG-16 Discovery
    await clickTab("02:");
    out.net.length = 0;
    const disc = await clickByText("Discover Trade Contractors");
    out["discover-click"] = disc;
    if (disc.ok) await delay(35000);
    out["BUG-16"] = await page.evaluate(() => {
      const text = document.body.innerText;
      const banner = text.match(/Trade Directory \(\d+ of \d+\)/);
      const verified = text.match(/(\d+) Verified Trades/);
      const identified = text.match(/Subcontractors Identified \([^\n]*\)/);
      const rows = [];
      const blocks = [...document.querySelectorAll("div")].filter((d) => (d.innerText || "").includes("REGISTRY VERIFICATION"));
      for (const b of blocks.slice(0, 6)) rows.push(b.innerText.replace(/\n+/g, " | ").slice(0, 320));
      const claims = text.match(/Active \/ Verified \([^)]*\)/g);
      const emails = text.match(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi);
      return { banner: banner && banner[0], verified: verified && verified[0], identified: identified && identified[0], claims: claims && claims.slice(0, 8), emails: emails && [...new Set(emails)].slice(0, 10), rows };
    });
    out.netAfterDiscovery = [...out.net];
    await shot(page, "fix-BUG16-fixture-discovery-2.png", { full: true });

    // ---------- BUG-07 zero-sub package dispatch
    await clickTab("01:");
    await clickByText("Create Trade Package");
    await delay(800);
    out["zero-create"] = await fillModal("Create CSI Trade Package", { "csi division": "23 00 00", "trade package name": "AUDIT Zero Sub", "scope summary": "AUDIT zero-sub dispatch test.", "budget estimate": "850000" });
    await delay(300);
    await clickByText("Create Package", true);
    await delay(3000);
    const dispatch = await page.evaluate(() => {
      const cards = [...document.querySelectorAll("div")].filter((d) => (d.innerText || "").includes("AUDIT Zero Sub") && (d.innerText || "").includes("Dispatch RFQs"));
      const card = cards[cards.length - 1];
      const btn = card ? [...card.querySelectorAll("button")].find((b) => (b.textContent || "").includes("Dispatch RFQs")) : null;
      if (!btn) return { ok: false, cardFound: !!card };
      btn.click();
      return { ok: true, disabled: btn.disabled };
    });
    out["BUG-07-click"] = dispatch;
    await delay(7000);
    out["BUG-07"] = await page.evaluate(() => {
      const t = document.body.innerText;
      const m = t.match(/[^\n]*(RFQ|RFQs)[^\n]*/g) || [];
      const idx = t.indexOf("AUDIT Zero Sub");
      return { lines: [...new Set(m)].slice(0, 8), block: idx >= 0 ? t.slice(idx, idx + 420).replace(/\n+/g, " | ") : null };
    });
    await shot(page, "fix-BUG07-zero-dispatch-3.png");

    // ---------- BUG-04 empty auto-scope
    await clickByText("AI Spec Breakdown");
    await delay(800);
    out["BUG-04"] = await page.evaluate(() => {
      const h = [...document.querySelectorAll("h2,h3")].find((el) => (el.textContent || "").includes("AI Specification Breakdown"));
      if (!h) return { dialog: false };
      let dlg = h;
      for (let i = 0; i < 6 && dlg.parentElement; i++) { dlg = dlg.parentElement; if (dlg.querySelector("textarea")) break; }
      const btn = [...dlg.querySelectorAll("button")].find((b) => (b.textContent || "").includes("Auto-Generate Trade Packages"));
      return { dialog: true, submitDisabled: btn ? btn.disabled : null };
    });
    await page.evaluate(() => {
      const h = [...document.querySelectorAll("h2,h3")].find((el) => (el.textContent || "").includes("AI Specification Breakdown"));
      let dlg = h;
      for (let i = 0; i < 6 && dlg && dlg.parentElement; i++) { dlg = dlg.parentElement; if (dlg.querySelector("textarea")) break; }
      const btn = dlg ? [...dlg.querySelectorAll("button")].find((b) => (b.textContent || "").includes("Auto-Generate Trade Packages")) : null;
      btn?.click();
    });
    await delay(2500);
    out["BUG-04"].afterClick = await page.evaluate(() => {
      const h = [...document.querySelectorAll("h2,h3")].find((el) => (el.textContent || "").includes("AI Specification Breakdown"));
      return { dialogStillOpen: !!h, pkgBadge: (document.body.innerText.match(/(\d+) Pkgs/) || [])[1] };
    });
    await shot(page, "fix-BUG04-empty-spec-3.png");
    await page.keyboard.press("Escape");
    await delay(400);

    out.diag = { consoleErrors: diag.consoleLogs.filter((l) => l.type === "error").slice(0, 10), pageErrors: diag.pageErrors, failedRequests: diag.failedRequests.slice(0, 10) };
    writeJson("fix-verify-fixture-2.json", out);
  } catch (e) {
    out.error = String(e && e.stack ? e.stack : e);
    writeJson("fix-verify-fixture-2.json", out);
  } finally {
    await browser.close();
  }
  console.log(JSON.stringify(out, null, 2).slice(0, 14000));
};

run();