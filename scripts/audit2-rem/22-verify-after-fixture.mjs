import fs from "node:fs";
import path from "node:path";
import {
  launchBrowser, attachDiagnostics, waitForAppReady, shot, writeJson, delay, getSelectorState,
} from "./lib.mjs";

const EV = "D:/Repo/ALL HACKATHONS/Convex/Convex all gas/evidence";
const DL = path.join(EV, "downloads-after");
fs.mkdirSync(DL, { recursive: true });
const FIXTURE = "AUDIT-AFTER-2026-09-17";

const run = async () => {
  const { browser } = await launchBrowser(1440, 900);
  const page = await browser.newPage();
  const diag = attachDiagnostics(page);
  const results = { fixture: FIXTURE };
  const client = await page.target().createCDPSession();
  await client.send("Page.setDownloadBehavior", { behavior: "allow", downloadPath: DL }).catch(() => {});

  const clickByText = async (t, exact = false) => page.evaluate(({ t, exact }) => {
    const b = [...document.querySelectorAll("button")].find((x) => { const s = (x.textContent || "").trim(); return exact ? s === t : s.includes(t); });
    if (!b) return { ok: false };
    b.click();
    return { ok: true, text: (b.textContent || "").trim() };
  }, { t, exact });
  const clickTab = async (titlePrefix) => {
    await page.evaluate((p) => { const b = [...document.querySelectorAll("button")].find((x) => (x.getAttribute("title") || "").startsWith(p)); b?.click(); }, titlePrefix);
    await delay(900);
  };
  const closeTour = async () => {
    await page.evaluate(() => { const b = [...document.querySelectorAll("button")].find((x) => (x.getAttribute("title") || "").includes("Close Demo Tour") || (x.textContent || "").trim() === "Dismiss"); b?.click(); });
    await delay(400);
  };
  const createPackage = async (name, csi) => {
    await clickByText("Create Trade Package");
    await delay(700);
    await page.evaluate(({ name, csi }) => {
      const h = [...document.querySelectorAll("h3")].find((el) => (el.textContent || "").includes("Create CSI Trade Package"));
      let dlg = h;
      for (let i = 0; i < 6 && dlg && dlg.parentElement; i++) { dlg = dlg.parentElement; if (dlg.querySelector("input")) break; }
      const iset = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      const tset = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
      for (const el of dlg.querySelectorAll("input,textarea")) {
        const label = (el.closest("div")?.querySelector("label")?.textContent || "").toLowerCase();
        if (label.includes("csi division")) { iset.call(el, csi); el.dispatchEvent(new Event("input", { bubbles: true })); }
        if (label.includes("trade package name")) { iset.call(el, name); el.dispatchEvent(new Event("input", { bubbles: true })); }
        if (label.includes("scope summary")) { tset.call(el, "AUDIT verification scope."); el.dispatchEvent(new Event("input", { bubbles: true })); }
      }
    }, { name, csi });
    await delay(300);
    await clickByText("Create Package", true);
    await delay(2500);
  };

  try {
    await page.goto(process.env.REM_BASE_URL || "http://localhost:4173/", { waitUntil: "domcontentloaded", timeout: 60000 });
    await waitForAppReady(page);
    await delay(1200);
    await closeTour();

    // ---------- create fixture
    await page.evaluate(() => { [...document.querySelectorAll("button")].find((b) => (b.textContent || "").trim() === "New Project")?.click(); });
    await delay(800);
    results.fixtureModalSet = await page.evaluate((title) => {
      const dlg = document.querySelector('[role="dialog"]');
      if (!dlg) return false;
      const titleInput = [...dlg.querySelectorAll("input")].find((i) => (i.placeholder || "").toLowerCase().includes("innovation")) || dlg.querySelector("input");
      const iset = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      iset.call(titleInput, title);
      titleInput.dispatchEvent(new Event("input", { bubbles: true }));
      return titleInput.value;
    }, FIXTURE);
    await delay(300);
    await page.evaluate(() => { const dlg = document.querySelector('[role="dialog"]'); [...dlg.querySelectorAll("button")].find((b) => (b.textContent || "").includes("Create Commercial Project"))?.click(); });
    let fixtureOpt = null;
    for (let i = 0; i < 20; i++) {
      await delay(1000);
      const sel = await getSelectorState(page);
      fixtureOpt = sel?.options.find((o) => o.text.includes("AUDIT-AFTER"));
      if (fixtureOpt) break;
    }
    results.fixtureOption = fixtureOpt;
    if (!fixtureOpt) throw new Error("fixture creation failed");

    await page.evaluate((val) => {
      const s = document.querySelector('select[aria-label="Select Commercial Construction Project"]');
      s.value = val; s.dispatchEvent(new Event("change", { bubbles: true }));
    }, fixtureOpt.value);
    await delay(1500);

    // ---------- BUG-02 tour on empty project
    await page.evaluate(() => { const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").includes("Demo Tour")); if (b && !b.className.includes("ring")) b.click(); });
    await delay(900);
    results["BUG-02"] = await page.evaluate(() => {
      const t = document.body.innerText;
      return {
        metric: (t.match(/No packages scoped yet[^\n]*|\d+ CSI Trade Packages[^\n]*/) || [])[0] || null,
        truthful: /No packages scoped yet/.test(t),
        claims4Verified: t.includes("4 Verified Specialty Contractors"),
        claimsTdlr: t.includes("100% TDLR Validated"),
      };
    });
    await shot(page, "after2-BUG02-empty-tour.png");
    await closeTour();

    // ---------- package + upload + download + preview (BUG-13/12/14)
    await clickTab("01:");
    await createPackage("AUDIT-AFTER Electrical", "26 00 00");
    const acceptSpec = await page.evaluate(() => {
      const select = [...document.querySelectorAll("select")].find((s) => [...s.options].some((o) => o.value === "spec"));
      select.value = "spec"; select.dispatchEvent(new Event("change", { bubbles: true }));
      const blueprintSelect = [...document.querySelectorAll("select")].find((s) => [...s.options].some((o) => o.value === "blueprint"));
      return { spec: document.querySelector("input#convex-file-upload")?.getAttribute("accept") };
    });
    await delay(400);
    const acceptBlueprint = await page.evaluate(() => {
      const select = [...document.querySelectorAll("select")].find((s) => [...s.options].some((o) => o.value === "blueprint"));
      select.value = "blueprint"; select.dispatchEvent(new Event("change", { bubbles: true }));
      return document.querySelector("input#convex-file-upload")?.getAttribute("accept");
    });
    await delay(300);
    results["BUG-13"] = { acceptSpec: acceptSpec.spec, acceptBlueprint };
    await page.evaluate(() => {
      const select = [...document.querySelectorAll("select")].find((s) => [...s.options].some((o) => o.value === "spec"));
      select.value = "spec"; select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const normalPath = path.join(EV, "after-upload-normal.txt");
    fs.writeFileSync(normalPath, "AUDIT-AFTER-UPLOAD-PROOF: stored bytes served verbatim. 2026-09-17.");
    const fileInput = await page.$("input#convex-file-upload");
    await fileInput.uploadFile(normalPath);
    let uploadRow = false;
    for (let i = 0; i < 15; i++) { await delay(1000); uploadRow = await page.evaluate(() => document.body.innerText.includes("after-upload-normal.txt")); if (uploadRow) break; }
    results["BUG-13"].uploadedRowVisible = uploadRow;

    await page.evaluate(() => {
      const rows = [...document.querySelectorAll("div")].filter((d) => (d.innerText || "").includes("after-upload-normal.txt") && (d.innerText || "").includes("Download"));
      const row = rows[rows.length - 1];
      row ? [...row.querySelectorAll("button")].find((b) => (b.textContent || "").includes("Download"))?.click() : null;
    });
    await delay(4500);
    const dlFiles = fs.existsSync(DL) ? fs.readdirSync(DL) : [];
    const dlTarget = dlFiles.find((f) => f.includes("after-upload-normal"));
    results["BUG-12"] = { downloads: dlFiles.slice(-5), servedTrueBytes: dlTarget ? fs.readFileSync(path.join(DL, dlTarget), "utf8").includes("AUDIT-AFTER-UPLOAD-PROOF") : null };

    await page.evaluate(() => {
      const rows = [...document.querySelectorAll("div")].filter((d) => (d.innerText || "").includes("after-upload-normal.txt") && (d.innerText || "").includes("Preview"));
      const row = rows[rows.length - 1];
      row ? [...row.querySelectorAll("button")].find((b) => (b.textContent || "").includes("Preview"))?.click() : null;
    });
    await delay(1200);
    results["BUG-14"] = await page.evaluate(() => {
      const t = document.body.innerText;
      return { falseClaim: t.includes("100% Real Construction Document Specification"), truthfulCaption: /Stored in Convex _storage/.test(t), storedTextShown: t.includes("AUDIT-AFTER-UPLOAD-PROOF") };
    });
    await shot(page, "after2-BUG14-preview.png");
    await page.keyboard.press("Escape");
    await delay(500);

    // ---------- BUG-15 stacked confirms
    await page.evaluate(() => {
      const rows = [...document.querySelectorAll("div")].filter((d) => (d.innerText || "").includes("after-upload-normal.txt"));
      const row = rows[rows.length - 1];
      row ? [...row.querySelectorAll("button")].find((b) => (b.getAttribute("title") || "").includes("Delete file"))?.click() : null;
    });
    await delay(700);
    await page.evaluate(() => { [...document.querySelectorAll("button")].find((x) => (x.getAttribute("title") || "").includes("Delete custom project"))?.click(); });
    await delay(800);
    results["BUG-15"] = await page.evaluate(() => [...document.querySelectorAll('[role="alertdialog"]')].map((d) => {
      const r = d.getBoundingClientRect();
      return { title: (d.querySelector("h2") || {}).textContent, top: Math.round(r.top), height: Math.round(r.height), z: getComputedStyle(d.parentElement).zIndex, inHeader: !!d.closest("header") };
    }));
    await shot(page, "after2-BUG15-stacked.png");
    await page.evaluate(() => { for (const d of [...document.querySelectorAll('[role="alertdialog"]')]) { [...d.querySelectorAll("button")].find((b) => (b.textContent || "").trim() === "Cancel")?.click(); } });
    await delay(600);

    // ---------- BUG-16 discovery
    await page.evaluate(() => { const b = [...document.querySelectorAll("button")].find((x) => (x.getAttribute("title") || "").includes("Discovery")); b?.click(); });
    await delay(900);
    await clickByText("Discover Trade Contractors");
    await delay(38000);
    results["BUG-16"] = await page.evaluate(() => {
      const t = document.body.innerText;
      return {
        claimsVerifiedTdlr: /Active \/ Verified \(TDLR\)/.test(t),
        claims100Tdlr: t.includes("100% TDLR Validated"),
        unverifiedLabels: (t.match(/Unverified[^\n]*/g) || []).slice(0, 5),
        fakeLicensePattern: (t.match(/TX-26-20\d{3}/g) || []).slice(0, 5),
        banner: (t.match(/Subcontractors Identified \([^\n]*\)|Trade Directory \([^\n]*\)/g) || []).slice(0, 2),
        provenanceNote: t.includes("Provenance shown per record"),
      };
    });
    await shot(page, "after2-BUG16-discovery.png", { full: true });

    // ---------- BUG-07 zero-recipient dispatch
    await clickTab("01:");
    await createPackage("AUDIT-AFTER Zero Sub", "23 00 00");
    await page.evaluate(() => {
      const cards = [...document.querySelectorAll("div")].filter((d) => (d.innerText || "").includes("AUDIT-AFTER Zero Sub") && (d.innerText || "").includes("Dispatch RFQs"));
      const card = cards[cards.length - 1];
      card ? [...card.querySelectorAll("button")].find((b) => (b.textContent || "").includes("Dispatch RFQs"))?.click() : null;
    });
    await delay(6000);
    results["BUG-07"] = await page.evaluate(() => {
      const t = document.body.innerText;
      const toast = document.querySelector('[role="status"]')?.textContent || null;
      const idx = t.indexOf("AUDIT-AFTER Zero Sub");
      return { toast, toastErrorTone: toast ? /No contractors/i.test(toast) : null, stillDraft: idx >= 0 ? /AUDIT-AFTER Zero Sub[\s\S]{0,260}?Draft/.test(t) : null };
    });
    await shot(page, "after2-BUG07-zero-dispatch.png");

    // ---------- BUG-08/09/10 RFI
    await page.evaluate(() => { const b = [...document.querySelectorAll("button")].find((x) => (x.getAttribute("title") || "").includes("Pre-Bid Q&A")); b?.click(); });
    await delay(1200);
    const subject = await page.$('input[placeholder*="Hoisting responsibility"]');
    const question = await page.$('textarea[placeholder*="scope coordination question"]');
    if (subject && question) {
      await subject.click({ clickCount: 3 });
      await page.keyboard.type("AUDIT-AFTER: Crane hoisting responsibility?");
      await question.click({ clickCount: 3 });
      await page.keyboard.type("AUDIT-AFTER TEST: Is crane hoisting and rigging to the penthouse included or excluded?");
      await delay(400);
      const t0 = Date.now();
      await page.evaluate(() => { [...document.querySelectorAll("button")].find((b) => (b.textContent || "").includes("Submit RFI"))?.click(); });
      await delay(1500);
      const pendingSeen = await page.evaluate(() => /RFI submitted\. The AI is analyzing/.test(document.body.innerText));
      let appearedAt = null;
      for (let i = 0; i < 40; i++) {
        await delay(1000);
        const count = await page.evaluate(() => (document.body.innerText.match(/All RFIs \((\d+)\)/) || [])[1]);
        if (count && Number(count) > 0) { appearedAt = Math.round((Date.now() - t0) / 1000); break; }
      }
      results["BUG-08"] = { pendingBannerSeen: pendingSeen, appearedAfterSeconds: appearedAt };
      results["BUG-09"] = await page.evaluate(() => {
        const t = document.body.innerText;
        return { rawBoldVisible: /\*\*[A-Za-z]/.test(t), rawHeadingVisible: /\n###\s/.test(t), renderedBoldPresent: !!document.querySelector("strong") };
      });
      results["BUG-10"] = await page.evaluate(() => {
        const t = document.body.innerText;
        return { fullDateTimes: (t.match(/(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{2}, \d{4}, [^\n]*/g) || []).slice(0, 3) };
      });
      await shot(page, "after2-BUG08-rfi.png", { full: true });

      // approve for addendum then issue
      await page.evaluate(() => { [...document.querySelectorAll("button")].find((b) => (b.textContent || "").trim() === "Approve for Addendum")?.click(); });
      await delay(2500);
      await page.evaluate(() => { [...document.querySelectorAll("button")].find((b) => (b.textContent || "").includes("Issue Legal Addendum"))?.click(); });
      await delay(9000);
      results["BUG-11"] = await page.evaluate(() => {
        const t = document.body.innerText;
        return {
          success: (t.match(/Pre-Bid Addendum NO\. 01 Successfully Issued[^\n]*/) || [])[0] || null,
          filename: (t.match(/ADDENDUM[A-Z0-9_.]*\.md/) || [])[0] || null,
          claimsAia401Addendum: t.includes("AIA A401 standard pre-bid legal addendum"),
          mentionsSeparateForm: t.includes("AIA Document A401 is the separate subcontract form"),
        };
      });
      await shot(page, "after2-BUG11-addendum.png", { full: true });
    } else {
      results["BUG-08"] = { error: "RFI form fields not found" };
    }

    // ---------- BUG-29 header badge vs tab count (same snapshot)
    results["BUG-29"] = await page.evaluate(() => {
      const t = document.body.innerText;
      const badge = (t.match(/(\d+) RFIs/) || [])[1];
      const tab = (t.match(/All RFIs \((\d+)\)/) || [])[1];
      return { headerBadge: badge, tabCount: tab, agree: badge === tab };
    });

    results.diag = { consoleErrors: diag.consoleLogs.filter((l) => l.type === "error").slice(0, 10), pageErrors: diag.pageErrors, failedRequests: diag.failedRequests.slice(0, 10) };
    writeJson("fix-verify-after-fixture.json", results);
  } catch (e) {
    results.error = String(e && e.stack ? e.stack : e);
    writeJson("fix-verify-after-fixture.json", results);
  } finally {
    await browser.close();
  }
  console.log(JSON.stringify(results, null, 2).slice(0, 14000));
};

run();