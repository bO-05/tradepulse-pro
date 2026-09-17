import fs from "node:fs";
import path from "node:path";
import { launchBrowser, attachDiagnostics, waitForAppReady, shot, writeJson, delay, getSelectorState } from "./lib.mjs";

const EV = "D:/Repo/ALL HACKATHONS/Convex/Convex all gas/evidence";
const DL = path.join(EV, "downloads-after2");
fs.mkdirSync(DL, { recursive: true });

const run = async () => {
  const { browser } = await launchBrowser(1440, 900);
  const page = await browser.newPage();
  const diag = attachDiagnostics(page);
  const results = {};
  const client = await page.target().createCDPSession();
  await client.send("Page.setDownloadBehavior", { behavior: "allow", downloadPath: DL }).catch(() => {});

  const clickTab = async (prefix) => {
    await page.evaluate((p) => { const b = [...document.querySelectorAll("button")].find((x) => (x.getAttribute("title") || "").startsWith(p)); b?.click(); }, prefix);
    await delay(900);
  };

  try {
    await page.goto(process.env.REM_BASE_URL || "http://localhost:4173/", { waitUntil: "domcontentloaded", timeout: 60000 });
    await waitForAppReady(page);
    await delay(1200);
    await page.evaluate(() => { const b = [...document.querySelectorAll("button")].find((x) => (x.getAttribute("title") || "").includes("Close Demo Tour") || (x.textContent || "").trim() === "Dismiss"); b?.click(); });
    await delay(300);
    const sel = await getSelectorState(page);
    const fixture = sel?.options.find((o) => o.text.includes("AUDIT-AFTER"));
    await page.evaluate((val) => {
      const s = document.querySelector('select[aria-label="Select Commercial Construction Project"]');
      s.value = val; s.dispatchEvent(new Event("change", { bubbles: true }));
    }, fixture.value);
    await delay(1500);

    // ---------- BUG-12 download stored bytes
    await clickTab("01:");
    const download = await page.evaluate(() => {
      const rows = [...document.querySelectorAll("div")].filter((d) => (d.innerText || "").includes("after-upload-normal.txt") && (d.innerText || "").includes("Download"));
      const row = rows[rows.length - 1];
      if (!row) return { ok: false };
      [...row.querySelectorAll("button")].find((b) => (b.textContent || "").includes("Download"))?.click();
      return { ok: true };
    });
    await delay(5000);
    const dlFiles = fs.existsSync(DL) ? fs.readdirSync(DL) : [];
    const dlTarget = dlFiles.find((f) => f.includes("after-upload-normal"));
    results["BUG-12"] = {
      click: download,
      downloads: dlFiles.slice(-5),
      servedTrueBytes: dlTarget ? fs.readFileSync(path.join(DL, dlTarget), "utf8").includes("AUDIT-AFTER-UPLOAD-PROOF") : null,
    };
    await shot(page, "after3-BUG12-download.png");

    // ---------- BUG-07 zero-sub dispatch (capture toast quickly)
    const dispatch = await page.evaluate(() => {
      const cards = [...document.querySelectorAll("div")].filter((d) => (d.innerText || "").includes("AUDIT-AFTER Zero Sub") && (d.innerText || "").includes("Dispatch RFQs"));
      const card = cards[cards.length - 1];
      if (!card) return { ok: false, cards: cards.length };
      [...card.querySelectorAll("button")].find((b) => (b.textContent || "").includes("Dispatch RFQs"))?.click();
      return { ok: true };
    });
    results["BUG-07-click"] = dispatch;
    await delay(1200);
    results["BUG-07"] = await page.evaluate(() => {
      const toast = document.querySelector('[role="status"]')?.textContent || null;
      const idx = document.body.innerText.indexOf("AUDIT-AFTER Zero Sub");
      const block = idx >= 0 ? document.body.innerText.slice(idx, idx + 400) : "";
      return { toast, errorTone: toast ? /No RFQ invitations were sent/i.test(toast) : null, blockHasDraft: /Draft/.test(block), blockHasDispatched: /RFQs Dispatched/.test(block) };
    });
    await shot(page, "after3-BUG07-dispatch.png");

    // ---------- BUG-08/09/10 RFI
    await page.evaluate(() => { const b = [...document.querySelectorAll("button")].find((x) => (x.getAttribute("title") || "").includes("Pre-Bid Q&A")); b?.click(); });
    await delay(1200);
    const subject = await page.$('input[placeholder*="Hoisting responsibility"]');
    const question = await page.$('textarea[placeholder*="scope coordination question"]');
    results.rfiFields = { subject: !!subject, question: !!question };
    if (subject && question) {
      await subject.click({ clickCount: 3 });
      await page.keyboard.type("AUDIT-AFTER: Crane hoisting responsibility?");
      await question.click({ clickCount: 3 });
      await page.keyboard.type("AUDIT-AFTER TEST: Is crane hoisting and rigging to the penthouse included or excluded?");
      await delay(400);
      results.rfiButtonDisabled = await page.evaluate(() => {
        const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").includes("Submit RFI"));
        return b ? b.disabled : null;
      });
      const t0 = Date.now();
      await page.evaluate(() => { [...document.querySelectorAll("button")].find((b) => (b.textContent || "").includes("Submit RFI"))?.click(); });
      await delay(1500);
      const pendingSeen = await page.evaluate(() => /RFI submitted\. The AI is analyzing/.test(document.body.innerText));
      await shot(page, "after3-BUG08-pending-banner.png");
      let appearedAt = null;
      for (let i = 0; i < 45; i++) {
        await delay(1000);
        const count = await page.evaluate(() => (document.body.innerText.match(/All RFIs \((\d+)\)/) || [])[1]);
        if (count && Number(count) > 0) { appearedAt = Math.round((Date.now() - t0) / 1000); break; }
      }
      results["BUG-08"] = { pendingBannerSeen: pendingSeen, appearedAfterSeconds: appearedAt };
      results["BUG-09"] = await page.evaluate(() => {
        const t = document.body.innerText;
        return { rawBoldVisible: /\*\*[A-Za-z]/.test(t), rawHeadingVisible: /\n###\s/.test(t), strongElements: document.querySelectorAll("#root strong, body strong").length };
      });
      results["BUG-10"] = await page.evaluate(() => ({
        fullDateTimes: (document.body.innerText.match(/(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{2}, \d{4}, [^\n]*/g) || []).slice(0, 3),
      }));
      await shot(page, "after3-BUG08-rfi-card.png", { full: true });

      // ---------- BUG-29 counts
      results["BUG-29"] = await page.evaluate(() => {
        const t = document.body.innerText;
        return { headerBadge: (t.match(/(\d+) RFIs/) || [])[1], tabCount: (t.match(/All RFIs \((\d+)\)/) || [])[1] };
      });

      // ---------- BUG-11 addendum
      await page.evaluate(() => { [...document.querySelectorAll("button")].find((b) => (b.textContent || "").trim() === "Approve for Addendum")?.click(); });
      await delay(2500);
      await page.evaluate(() => { [...document.querySelectorAll("button")].find((b) => (b.textContent || "").includes("Issue Legal Addendum"))?.click(); });
      await delay(10000);
      results["BUG-11"] = await page.evaluate(() => {
        const t = document.body.innerText;
        return {
          success: (t.match(/Pre-Bid Addendum NO\. 01 Successfully Issued[^\n]*/) || [])[0] || null,
          filename: (t.match(/ADDENDUM[A-Z0-9_.]*\.md/) || [])[0] || null,
          claimsAia401Addendum: t.includes("AIA A401 standard pre-bid legal addendum"),
          mentionsSeparateForm: t.includes("AIA A401 is the separate subcontract form"),
          error: (t.match(/Addendum generation failed[^\n]*/) || [])[0] || null,
        };
      });
      await shot(page, "after3-BUG11-addendum.png", { full: true });
    }

    // ---------- BUG-35 contrast (excluding gradient backgrounds)
    results["BUG-35"] = await page.evaluate(() => {
      const parse = (c) => { const m = c.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/); return m ? [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]] : null; };
      const lum = (rgb) => { const s = rgb.slice(0, 3).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * s[0] + 0.7152 * s[1] + 0.0722 * s[2]; };
      const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };
      const blend = (fg, bg, extra) => { const a = fg[3] * (extra ?? 1); return [fg[0] * a + bg[0] * (1 - a), fg[1] * a + bg[1] * (1 - a), fg[2] * a + bg[2] * (1 - a), 1]; };
      const bgOf = (el) => { let cur = el; while (cur) { const cs = getComputedStyle(cur); if (cs.backgroundImage && cs.backgroundImage !== "none") return null; if (cs.backgroundColor && !cs.backgroundColor.includes("rgba(0, 0, 0, 0)")) { const bg = parse(cs.backgroundColor); if (bg && bg[3] > 0.9) return bg; } cur = cur.parentElement; } return [10, 15, 29, 1]; };
      const fails = [];
      for (const el of document.querySelectorAll("span,p,div,li,td,th,label,code")) {
        const txt = (el.childNodes.length && [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 3)) ? el.innerText : "";
        if (!txt || txt.length > 100) continue;
        const cs = getComputedStyle(el);
        const bg = bgOf(el);
        if (!bg) continue;
        const fs = parseFloat(cs.fontSize);
        if (fs > 12.5) continue;
        const fg0 = parse(cs.color);
        if (!fg0) continue;
        const effOpacity = (() => { let cur = el, o = 1; while (cur && cur !== document.body) { o *= parseFloat(getComputedStyle(cur).opacity || "1"); cur = cur.parentElement; } return o; })();
        const fg = blend(fg0, bg, effOpacity);
        const r = ratio(fg, bg);
        if (r < 4.5) fails.push({ text: txt.slice(0, 50), ratio: Math.round(r * 100) / 100, fontSize: cs.fontSize, color: cs.color });
      }
      return { failCount: fails.length, sample: fails.slice(0, 6) };
    });

    results.diag = { consoleErrors: diag.consoleLogs.filter((l) => l.type === "error").slice(0, 10), pageErrors: diag.pageErrors, failedRequests: diag.failedRequests.slice(0, 10) };
    writeJson("fix-verify-after-focused.json", results);
  } catch (e) {
    results.error = String(e && e.stack ? e.stack : e);
    writeJson("fix-verify-after-focused.json", results);
  } finally {
    await browser.close();
  }
  console.log(JSON.stringify(results, null, 2).slice(0, 14000));
};
run();