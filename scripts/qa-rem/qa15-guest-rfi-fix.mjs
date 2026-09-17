// QA-15 item 2b: guest RFI on a ZERO-contractor package (Div 23 of the QA-15 O1 fixture).
// Also captures full console-error text during the flow.
// Usage: node scripts/qa-rem/qa15-guest-rfi-fix.mjs
import fs from "node:fs";
import path from "node:path";
import { ConvexHttpClient } from "convex/browser";
import { launchBrowser, EVIDENCE_DIR, BASE_URL, waitForAppReady, shot, delay, setInputValue, clickButtonByText } from "./qa1-lib.mjs";

const BACKEND = process.env.QA_BACKEND_URL || "https://brainy-skunk-440.convex.cloud";
const client = new ConvexHttpClient(BACKEND);
const SUBJECT = `QA-15 guest RFI zero-contractor pkg ${Date.now()}`;

const LOG = [];
const OUT = { startedAt: new Date().toISOString(), items: {}, steps: {} };
const ev = (s) => {
  LOG.push(s);
  console.log(s);
};

async function dismissTour(page) {
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button[title]")].find((x) =>
      /Close Demo Tour|Close Teleprompter/i.test(x.getAttribute("title") || "")
    );
    if (b) b.click();
  });
  await delay(250);
}
async function bodyHas(page, text) {
  return page.evaluate((t) => document.body.innerText.includes(t), text);
}

async function main() {
  ev("=== QA-15 GUEST RFI (zero-contractor package) ===");
  ev(`UTC: ${new Date().toISOString()}`);
  const projects = await client.query("projects:listProjects", {});
  const fixture = projects.find((p) => p.title.startsWith("QA-REM-QA15-O1-"));
  const packages = await client.query("tradePackages:listByProject", { projectId: fixture._id });
  const hvac = packages.find((p) => String(p.csiDivision).startsWith("23"));
  const ctBefore = await client.query("contractors:listByPackage", { tradePackageId: hvac._id });
  const cvBefore = await client.query("rfq:listConversations", { tradePackageId: hvac._id });
  ev(`fixture=${fixture._id} hvac=${hvac._id}(${hvac.tradeName}) contractorsBefore=${ctBefore.length} convosBefore=${cvBefore.length}`);

  const { browser } = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1600, height: 1000 });
    const consoleErrors = [];
    page.on("console", (m) => {
      if (m.type() === "error") consoleErrors.push(m.text());
    });
    page.on("pageerror", (e) => consoleErrors.push(`PAGEERROR ${String(e?.message || e)}`));
    await page.goto(`${BASE_URL}/?project=${fixture._id}&tab=packages`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await waitForAppReady(page, 45000);
    await dismissTour(page);
    await delay(800);
    const cardClick = await page.evaluate((tradeName) => {
      const h3 = [...document.querySelectorAll("h3")].find((x) => (x.textContent || "").trim() === tradeName);
      if (!h3) return { ok: false, h3s: [...document.querySelectorAll("h3")].map((x) => x.textContent.trim()).slice(0, 20) };
      (h3.closest("div[class*='cursor-pointer']") || h3.closest("div")).click();
      return { ok: true };
    }, "QA-15 HVAC");
    await delay(700);
    await clickButtonByText(page, "Pre-Bid Q&A");
    await delay(1000);
    const formState = await page.evaluate(() => {
      const select = [...document.querySelectorAll("select")].find((s) =>
        [...s.options].some((o) => o.value === "guest_contractor")
      );
      return {
        guestOptionPresent: Boolean(select),
        selectOptions: select ? [...select.options].map((o) => ({ value: o.value, text: o.textContent.trim() })) : [],
      };
    });
    const setGuest = await page.evaluate(() => {
      const select = [...document.querySelectorAll("select")].find((s) =>
        [...s.options].some((o) => o.value === "guest_contractor")
      );
      if (!select) return false;
      select.value = "guest_contractor";
      select.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    });
    await setInputValue(page, 'input[placeholder="e.g. Hoisting responsibility for switchgear"]', SUBJECT);
    await setInputValue(
      page,
      'textarea[placeholder="Ask a technical or scope coordination question..."]',
      "Guest inquiry (no registered bidder): who provides the duct smoke detector sampling tubes and FACP interlocks?"
    );
    await delay(300);
    await shot(page, "remediation-qa15-reg-06-guest-rfi-form.png");
    const t0 = Date.now();
    const submit = await clickButtonByText(page, "Submit RFI for Clarification");
    let toastOk = false;
    let toastFail = null;
    {
      const deadline = Date.now() + 25000;
      while (Date.now() < deadline) {
        const text = await page.evaluate(() => document.body.innerText);
        if (text.includes("RFI submitted to TradePulse autonomous AI clarification engine")) {
          toastOk = true;
          break;
        }
        const m = text.match(/RFI clarification failed:[^\n]*/);
        if (m) {
          toastFail = m[0];
          break;
        }
        await delay(400);
      }
    }
    let subjectVisible = false;
    let convo = null;
    {
      const deadline = Date.now() + 150000;
      while (Date.now() < deadline) {
        if (!subjectVisible) subjectVisible = await bodyHas(page, SUBJECT);
        const convos = await client.query("rfq:listConversations", { tradePackageId: hvac._id });
        convo = convos.find((c) => (c.inboundSubject || "").includes("QA-15 guest RFI zero-contractor pkg")) || null;
        if (convo && subjectVisible) break;
        await delay(2000);
      }
    }
    await shot(page, "remediation-qa15-reg-07-guest-rfi-submitted.png");
    const ctAfter = await client.query("contractors:listByPackage", { tradePackageId: hvac._id });
    let convoContractor = null;
    if (convo?.contractorId) {
      const all = ctAfter;
      convoContractor = all.find((c) => c._id === convo.contractorId) || null;
    }
    ev(`cardClick=${JSON.stringify(cardClick)} guestOption=${formState.guestOptionPresent} setGuest=${setGuest} submit=${JSON.stringify(submit)}`);
    ev(`toastOk=${toastOk} toastFail=${toastFail} subjectVisible=${subjectVisible} convo=${Boolean(convo)} (${Date.now() - t0}ms)`);
    ev(`contractorsAfter=${ctAfter.length} [${ctAfter.map((c) => `${c.companyName}:${c.licenseStatus}`).join(" | ")}]`);
    ev(`convo contractor=${convoContractor ? `${convoContractor.companyName} (${convoContractor.licenseStatus})` : "none"}`);
    ev(`console errors during flow (${consoleErrors.length}): ${JSON.stringify(consoleErrors.slice(0, 8))}`);

    OUT.steps = {
      fixture: fixture._id,
      hvac: hvac._id,
      hvacName: hvac.tradeName,
      contractorsBefore: ctBefore.length,
      convosBefore: cvBefore.length,
      cardClick,
      formState,
      setGuest,
      submit,
      toastOk,
      toastFail,
      subjectVisible,
      convo: convo ? { status: convo.status, subject: convo.inboundSubject, contractorId: convo.contractorId ?? null, replyLen: (convo.autonomousReply || "").length } : null,
      convoContractor: convoContractor ? { companyName: convoContractor.companyName, licenseStatus: convoContractor.licenseStatus } : null,
      contractorsAfter: ctAfter.map((c) => ({ companyName: c.companyName, licenseStatus: c.licenseStatus })),
      consoleErrors,
    };
    OUT.items.guest_option_present = formState.guestOptionPresent === true;
    OUT.items.guest_rfi_accepted =
      setGuest === true &&
      toastOk === true &&
      subjectVisible === true &&
      Boolean(convo) &&
      Boolean(convoContractor) &&
      /Guest/i.test(convoContractor.companyName);
    OUT.items.flow_console_errors_zero = consoleErrors.length === 0;
  } finally {
    await browser.close();
  }
  const failed = Object.entries(OUT.items).filter(([, v]) => !v).map(([k]) => k);
  OUT.finishedAt = new Date().toISOString();
  OUT.overall = failed.length === 0 ? "PASS" : "FAIL";
  ev("");
  ev(`ITEMS: ${Object.entries(OUT.items).map(([k, v]) => `${k}=${v ? "PASS" : "FAIL"}`).join(" | ")}`);
  ev(`OVERALL: ${OUT.overall}${failed.length ? ` (failed: ${failed.join(", ")})` : ""}`);
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  fs.writeFileSync(path.join(EVIDENCE_DIR, "remediation-qa15-guest-rfi-fix.txt"), LOG.join("\n") + "\n", "utf8");
  fs.writeFileSync(path.join(EVIDENCE_DIR, "remediation-qa15-guest-rfi-fix.json"), JSON.stringify(OUT, null, 2), "utf8");
  process.exitCode = failed.length === 0 ? 0 : 1;
}

main().catch((e) => {
  console.error("FATAL", e);
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  fs.writeFileSync(path.join(EVIDENCE_DIR, "remediation-qa15-guest-rfi-fix.txt"), LOG.join("\n") + `\nFATAL: ${e?.stack || e?.message}\n`, "utf8");
  process.exit(1);
});