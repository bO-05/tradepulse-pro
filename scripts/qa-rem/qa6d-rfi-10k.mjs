// QA-6d: RFI 10000-char body retest now that QA package has contractors (isolates guest-bug from length path).
import {
  launchBrowser,
  attachDiagnostics,
  shot,
  waitForAppReady,
  delay,
  BASE_URL,
  writeLog,
  bodyText,
  clickButtonByText,
} from "./qa1-lib.mjs";
import { ConvexHttpClient } from "convex/browser";

const client = new ConvexHttpClient("https://brainy-skunk-440.convex.cloud");
const LOG = [];
const ev = (s) => {
  LOG.push(s);
  console.log(s);
};
const QA_PROJECT_ID = "jx76zg0y52h5akc52gq4wwx0z58ehxvy";
const QA_PACKAGE_ID = "k178m859p5zhg6h6vaebh80qms8eh129";

async function run() {
  const { browser } = await launchBrowser();
  try {
    ev("=== QA-6d RFI 10k retest (contractors present) ===");
    ev(`UTC: ${new Date().toISOString()}`);
    const page = await browser.newPage();
    const diag = attachDiagnostics(page);
    await page.goto(BASE_URL, { waitUntil: "load", timeout: 60000 });
    await waitForAppReady(page);
    await page.evaluate((id) => {
      const s = document.querySelector('select[aria-label="Select Commercial Construction Project"]');
      const o = [...s.options].find((x) => x.value === id);
      if (o) {
        s.value = id;
        s.dispatchEvent(new Event("change", { bubbles: true }));
      }
    }, QA_PROJECT_ID);
    await delay(2500);
    await clickButtonByText(page, "Pre-Bid Q&A");
    await delay(2000);

    const formInfo = await page.evaluate(() => {
      const form = [...document.querySelectorAll("form")].find((f) => (f.textContent || "").includes("Subject / Scope Topic"));
      if (!form) return null;
      const sel = form.querySelector("select");
      return {
        options: sel ? [...sel.options].map((o) => ({ v: o.value, t: o.textContent.trim() })) : [],
        submitDisabled: form.querySelector('button[type="submit"]').disabled,
      };
    });
    ev(`form select options: ${JSON.stringify(formInfo)}`);

    // choose first real contractor
    await page.evaluate(() => {
      const form = [...document.querySelectorAll("form")].find((f) => (f.textContent || "").includes("Subject / Scope Topic"));
      const sel = form.querySelector("select");
      const opt = [...sel.options].find((o) => !o.value.startsWith("guest"));
      if (opt) {
        sel.value = opt.value;
        sel.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });
    await page.evaluate((q) => {
      const form = [...document.querySelectorAll("form")].find((f) => (f.textContent || "").includes("Subject / Scope Topic"));
      const lab = [...form.querySelectorAll("label")].find((l) => l.textContent.trim() === "Subject / Scope Topic");
      const input = lab.parentElement.querySelector("input");
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, "QA-6d 10k RFI body");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      const lab2 = [...form.querySelectorAll("label")].find((l) => l.textContent.trim() === "Subcontractor Question");
      const ta = lab2.parentElement.querySelector("textarea");
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(ta, q);
      ta.dispatchEvent(new Event("input", { bubbles: true }));
      ta.dispatchEvent(new Event("change", { bubbles: true }));
      return { subject: input.value, bodyLen: ta.value.length };
    }, "Q".repeat(10000));
    await delay(500);
    const t0 = Date.now();
    await page.evaluate(() => {
      const form = [...document.querySelectorAll("form")].find((f) => (f.textContent || "").includes("Subject / Scope Topic"));
      form.querySelector('button[type="submit"]').click();
    });
    let errs = [];
    let rfiSeen = false;
    for (let i = 0; i < 40; i++) {
      await delay(3000);
      const bt = await bodyText(page);
      if (/QA-6d 10k RFI body/.test(bt)) rfiSeen = true;
      errs = diag.consoleLogs.filter((l) => l.type === "error").map((l) => l.text.split("\n")[0]);
      if (rfiSeen) break;
    }
    ev(`submitted; rfiVisibleAfter=${rfiSeen ? Date.now() - t0 + "ms" : "NOT within 120s"}`);
    ev(`consoleErrors=${JSON.stringify(errs.slice(-3))} pageErrors=${diag.pageErrors.length}`);
    const convos = await client.query("rfq:listConversations", { tradePackageId: QA_PACKAGE_ID });
    ev(
      `backend conversations=${convos.length}: ${convos
        .slice(0, 4)
        .map((c) => `[${c.status}] "${c.inboundSubject}" bodyLen=${(c.inboundBody || "").length}`)
        .join(" | ")}`
    );
    await shot(page, "remediation-qa6d-rfi-10k.png");
    await page.close();
  } finally {
    writeLog("remediation-qa6d-rfi-10k.txt", LOG);
    await browser.close();
  }
}
run().catch((e) => {
  LOG.push("PROBE FAILED: " + (e && e.stack ? e.stack : String(e)));
  writeLog("remediation-qa6d-rfi-10k.txt", LOG);
  console.error(e);
  process.exit(1);
});