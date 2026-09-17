import {
  launchBrowser, attachDiagnostics, waitForAppReady, getSelectorState, shot, writeJson,
  bodyText, delay, selectProjectByTitle,
} from "./lib.mjs";

const FIXTURE = `AUDIT-REMED-${new Date().toISOString().slice(0, 10)}`;

const run = async () => {
  const { browser } = await launchBrowser(1440, 900);
  const page = await browser.newPage();
  const diag = attachDiagnostics(page);
  const out = { fixture: FIXTURE, startedAt: new Date().toISOString(), checks: {}, net: [] };
  page.on("request", (r) => {
    const u = r.url();
    if (!u.includes("convex.cloud") && !u.includes("convex.site")) out.net.push(`${r.method()} ${u}`);
  });

  try {
    await page.goto("https://brainy-skunk-440.convex.site/", { waitUntil: "domcontentloaded", timeout: 60000 });
    await waitForAppReady(page);

    // ---------- Create fixture project
    await page.evaluate(() => {
      [...document.querySelectorAll("button")].find((b) => (b.textContent || "").trim() === "New Project")?.click();
    });
    await delay(800);
    const modal = await page.evaluate(() => {
      const dlg = document.querySelector('[role="dialog"]');
      if (!dlg) return null;
      const inputs = [...dlg.querySelectorAll("input,textarea")];
      return { count: inputs.length, types: inputs.map((i) => i.type || i.tagName) };
    });
    out.checks["create-modal"] = modal;
    // Fill via real DOM events
    await page.evaluate((title) => {
      const dlg = document.querySelector('[role="dialog"]');
      const inputs = [...dlg.querySelectorAll("input")];
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      const set = (el, v) => { setter.call(el, v); el.dispatchEvent(new Event("input", { bubbles: true })); };
      set(inputs[0], title);
      const ta = dlg.querySelector("textarea");
      if (ta) {
        const tset = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
        tset.call(ta, "AUDIT FIXTURE SPEC. SECTION 26 00 00 - ELECTRICAL: switchgear, conduit, low voltage control wiring.");
        ta.dispatchEvent(new Event("input", { bubbles: true }));
      }
    }, FIXTURE);
    await delay(300);
    const submitted = await page.evaluate(() => {
      const btn = [...document.querySelectorAll("button")].find((b) => (b.textContent || "").includes("Create Commercial Project"));
      if (!btn || btn.disabled) return { ok: false, disabled: btn ? btn.disabled : null };
      btn.click();
      return { ok: true };
    });
    out.checks["create-submit"] = submitted;
    await delay(4000);
    out.selectorAfterCreate = await getSelectorState(page);
    const opts = out.selectorAfterCreate?.options || [];
    out.fixtureProject = opts.find((o) => o.text.includes("AUDIT-REMED"));
    await shot(page, "fix-newproject-created.png");

    if (!out.fixtureProject) throw new Error("Fixture project creation failed: " + JSON.stringify(out.selectorAfterCreate));

    // ---------- Select fixture
    await selectProjectByTitle(page, "AUDIT-REMED");
    await delay(1500);

    // ---------- BUG-02/36 tour on empty project
    await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").includes("Demo Tour"));
      if (b && !b.className.includes("ring")) b.click();
    });
    await delay(900);
    out.checks["BUG-02/36"] = await page.evaluate(() => {
      const t = document.body.innerText;
      const tourLine = t.match(/Cue:[\s\S]{0,400}/);
      const metric = t.match(/\d+ CSI Trade Packages • Dedicated AgentMail Inboxes/);
      const savings = t.match(/\$61k-\$96k Net GC Savings[^\n]*/);
      const counts = {
        pkgs: (t.match(/(\d+) Pkgs/) || [])[1],
        subs: (t.match(/(\d+) Subs/) || [])[1],
        rfis: (t.match(/(\d+) RFIs/) || [])[1],
        bids: (t.match(/(\d+) Bids/) || [])[1],
      };
      return { tourMetric: metric ? metric[0] : null, savings: savings ? savings[0] : null, liveCounts: counts, cue: tourLine ? tourLine[0].slice(0, 300) : null };
    });
    await shot(page, "fix-BUG02-tour-empty-project.png");

    // Scene 04 check on empty project
    await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) => (x.getAttribute("title") || "").startsWith("04:"));
      b?.click();
    });
    await delay(1000);
    out.checks["BUG-36"] = await page.evaluate(() => {
      const t = document.body.innerText;
      const cue = t.match(/Cue:"?[\s\S]{0,500}/);
      return { cue: cue ? cue[0].slice(0, 400) : null, hasLiveMatrix: t.includes("Real-Time Forensic Bid Leveling Matrix") };
    });
    await shot(page, "fix-BUG36-tour-scene4.png");
    // close tour
    await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) => (x.getAttribute("title") || "") === "Close Demo Tour");
      b?.click();
    });
    await delay(500);

    // ---------- BUG-16 discovery on fixture
    await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) => (x.getAttribute("title") || "").includes("Discovery"));
      b?.click();
    });
    await delay(800);
    out.net.length = 0;
    const disc = await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").includes("Create Trade Package"));
      return { hasDiscoverButton: !!b };
    });
    out.checks["BUG-16-setup"] = disc;
    // No packages on fixture; need a package first. Create one manually.
    await page.evaluate(() => {
      [...document.querySelectorAll("button")].find((b) => (b.textContent || "").trim() === "Create Trade Package")?.click();
    });
    await delay(700);
    await page.evaluate(() => {
      const dlg = [...document.querySelectorAll('[role="dialog"]')].pop();
      const inputs = [...dlg.querySelectorAll("input,textarea")];
      const iset = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      const tset = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
      for (const el of inputs) {
        const label = (el.closest("div")?.querySelector("label")?.textContent || "").toLowerCase();
        if (label.includes("trade name") || label.includes("name")) { iset.call(el, "Electrical Systems"); el.dispatchEvent(new Event("input", { bubbles: true })); }
        if (label.includes("summary")) { tset.call(el, "AUDIT fixture electrical scope."); el.dispatchEvent(new Event("input", { bubbles: true })); }
      }
    });
    await delay(300);
    const pkgSubmit = await page.evaluate(() => {
      const dlg = [...document.querySelectorAll('[role="dialog"]')].pop();
      const btns = [...dlg.querySelectorAll("button")];
      const btn = btns.find((b) => (b.textContent || "").toLowerCase().includes("create") && !(b.textContent || "").toLowerCase().includes("trade package"));
      if (!btn) return { ok: false, options: btns.map((b) => b.textContent.trim()) };
      btn.click();
      return { ok: true };
    });
    out.checks["create-package"] = pkgSubmit;
    await delay(2500);
    await shot(page, "fix-BUG16-before-discovery.png");

    const discoverClicked = await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").includes("Discover Trade Contractors"));
      if (!b) return { ok: false };
      b.click();
      return { ok: true, disabled: b.disabled };
    });
    out.checks["discover-click"] = discoverClicked;
    await delay(30000);
    out.checks["BUG-16"] = await page.evaluate(() => {
      const rows = [...document.querySelectorAll("div")].filter((d) => (d.innerText || "").includes("REGISTRY VERIFICATION"));
      const text = document.body.innerText;
      const banner = text.match(/Trade Directory \(\d+ of \d+\)/);
      const verified = text.match(/(\d+) Verified Trades/);
      return {
        banner: banner ? banner[0] : null,
        verifiedBanner: verified ? verified[0] : null,
        rows: rows.slice(0, 8).map((r) => r.innerText.replace(/\n/g, " | ").slice(0, 260)),
      };
    });
    out.netAfterDiscovery = [...out.net];
    await shot(page, "fix-BUG16-discovery-fixture.png", { full: true });

    // ---------- BUG-07: dispatch RFQs with 0 contractors on a NEW package
    await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").trim() === "Create Trade Package");
      b?.click();
    });
    await delay(700);
    await page.evaluate(() => {
      const dlg = [...document.querySelectorAll('[role="dialog"]')].pop();
      const inputs = [...dlg.querySelectorAll("input,textarea")];
      const iset = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      const tset = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
      for (const el of inputs) {
        const label = (el.closest("div")?.querySelector("label")?.textContent || "").toLowerCase();
        if (label.includes("trade name") || label.includes("name")) { iset.call(el, "AUDIT Zero Sub Package"); el.dispatchEvent(new Event("input", { bubbles: true })); }
        if (label.includes("summary")) { tset.call(el, "AUDIT zero-contractor dispatch test."); el.dispatchEvent(new Event("input", { bubbles: true })); }
      }
    });
    await delay(300);
    await page.evaluate(() => {
      const dlg = [...document.querySelectorAll('[role="dialog"]')].pop();
      [...dlg.querySelectorAll("button")].find((b) => (b.textContent || "").toLowerCase().includes("create") && !(b.textContent || "").toLowerCase().includes("trade package"))?.click();
    });
    await delay(2500);
    // click dispatch on the zero-sub package
    const dispatch = await page.evaluate(() => {
      const cards = [...document.querySelectorAll("div")].filter((d) => (d.innerText || "").includes("AUDIT Zero Sub Package"));
      const card = cards[cards.length - 1];
      if (!card) return { ok: false, reason: "card not found" };
      const btn = [...card.querySelectorAll("button")].find((b) => (b.textContent || "").includes("Dispatch RFQs"));
      if (!btn) return { ok: false, reason: "button not found" };
      btn.click();
      return { ok: true };
    });
    out.checks["BUG-07-click"] = dispatch;
    await delay(6000);
    out.checks["BUG-07"] = await page.evaluate(() => {
      const t = document.body.innerText;
      const toast = t.match(/RFQs[^\n]{0,140}/g);
      return { toasts: toast ? toast.slice(0, 5) : [] };
    });
    await shot(page, "fix-BUG07-zero-dispatch.png");

    // ---------- BUG-04: auto-scope empty submit
    await page.evaluate(() => {
      [...document.querySelectorAll("button")].find((b) => (b.textContent || "").includes("AI Spec Breakdown"))?.click();
    });
    await delay(800);
    out.checks["BUG-04"] = await page.evaluate(() => {
      const dlg = [...document.querySelectorAll('[role="dialog"]')].pop();
      if (!dlg) return { dialog: false };
      const btn = [...dlg.querySelectorAll("button")].find((b) => (b.textContent || "").includes("Auto-Generate Trade Packages"));
      return { dialog: true, submitDisabled: btn ? btn.disabled : null, label: btn ? btn.textContent.trim() : null };
    });
    await page.evaluate(() => {
      const dlg = [...document.querySelectorAll('[role="dialog"]')].pop();
      const btn = [...dlg.querySelectorAll("button")].find((b) => (b.textContent || "").includes("Auto-Generate Trade Packages"));
      btn?.click();
    });
    await delay(2500);
    out.checks["BUG-04"].afterClick = await page.evaluate(() => ({ dialogOpen: !!document.querySelector('[role="dialog"]') }));
    await shot(page, "fix-BUG04-empty-spec.png");
    await page.evaluate(() => {
      const dlg = [...document.querySelectorAll('[role="dialog"]')].pop();
      dlg?.querySelector('button[aria-label], button')?.click();
    });
    await delay(400);

    writeJson("fix-verify-fixture-1.json", out);
  } catch (e) {
    out.error = String(e && e.stack ? e.stack : e);
    writeJson("fix-verify-fixture-1.json", out);
  } finally {
    out.diag = { consoleErrors: diag.consoleLogs.filter((l) => l.type === "error").slice(0, 10), pageErrors: diag.pageErrors, failedRequests: diag.failedRequests.slice(0, 10) };
    await browser.close();
  }
  console.log(JSON.stringify(out, null, 2).slice(0, 12000));
};

run();