import { launchBrowser, attachDiagnostics, waitForAppReady, shot, delay } from "./lib.mjs";
import { readEvidence, writeEvidence, writeLog, zonedDate, zonedDateTime } from "./qa14-lib.mjs";

const log = [];
const say = (s) => { log.push(s); console.log(s); };
const fx = readEvidence("fixtures");

async function run(timezone) {
  const { browser } = await launchBrowser(1440, 900);
  const page = await browser.newPage();
  const diag = attachDiagnostics(page);
  await page.emulateTimezone(timezone);
  await page.evaluateOnNewDocument((pid) => {
    window.localStorage.setItem("tradepulse.selectedProjectId", pid);
  }, fx.tzProjectId);
  await page.goto(`https://brainy-skunk-440.convex.site/?project=${fx.tzProjectId}&tab=packages&qa14=tz`, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await waitForAppReady(page);

  const opened = await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find((b) =>
      (b.textContent || "").includes("Create Trade Package")
    );
    if (!btn) return { ok: false };
    btn.click();
    return { ok: true };
  });
  if (!opened.ok) throw new Error("Create Trade Package button not found");
  await page.waitForSelector('input[aria-label="Bid deadline"]', { timeout: 15000 });

  const before = await page.evaluate(() => {
    const input = document.querySelector('input[aria-label="Bid deadline"]');
    const localDate = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    return {
      min: input.getAttribute("min"),
      value: input.value,
      browserLocalDate: localDate,
      browserUtcDate: new Date().toISOString().slice(0, 10),
      pageOffsetMinutes: new Date().getTimezoneOffset(),
    };
  });
  say(`[${timezone}] min=${before.min} localDate=${before.browserLocalDate} value=${before.value}`);

  // Try to choose the user's local "today" the way a user would.
  const setLocalToday = await page.evaluate((localDate) => {
    const input = document.querySelector('input[aria-label="Bid deadline"]');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    setter.call(input, localDate);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return {
      value: input.value,
      valid: input.validity.valid,
      rangeUnderflow: input.validity.rangeUnderflow,
      validationMessage: input.validationMessage,
    };
  }, before.browserLocalDate);
  say(`[${timezone}] set local today -> valid=${setLocalToday.valid} underflow=${setLocalToday.rangeUnderflow} msg="${setLocalToday.validationMessage}"`);
  await shot(page, `fix4-qa14-ui-tz-${timezone.replace(/\W+/g, "_")}-local-today.png`);

  const mutationsBefore = diag.requests.filter((r) => r.url.includes("/api/mutation")).length;
  const submitted = await page.evaluate(() => {
    const buttons = [...document.querySelectorAll("button")];
    const btn = buttons.find((b) => (b.textContent || "").trim() === "Create Package");
    if (!btn) return { ok: false };
    btn.click();
    return { ok: true };
  });
  await delay(1200);
  const afterSubmit = await page.evaluate(() => ({
    dialogOpen: Boolean(document.querySelector('[aria-labelledby="create-package-title"]')),
    inputValue: document.querySelector('input[aria-label="Bid deadline"]')?.value ?? null,
    validationMessage: document.querySelector('input[aria-label="Bid deadline"]')?.validationMessage ?? null,
    activeLabel: document.activeElement ? document.activeElement.getAttribute("aria-label") : null,
    errorText: document.querySelector('[aria-labelledby="create-package-title"] [role="alert"]')?.textContent ?? null,
  }));
  const mutationsAfter = diag.requests.filter((r) => r.url.includes("/api/mutation")).length;

  // Control: the UTC "today" the app's own min asks for is valid.
  const control = await page.evaluate((minDate) => {
    const input = document.querySelector('input[aria-label="Bid deadline"]');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    setter.call(input, minDate);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return { value: input.value, valid: input.validity.valid, rangeUnderflow: input.validity.rangeUnderflow };
  }, before.min);
  say(`[${timezone}] control min-date valid=${control.valid}`);
  await shot(page, `fix4-qa14-ui-tz-${timezone.replace(/\W+/g, "_")}-control-min.png`);

  const result = {
    timezone,
    nodeUtcDate: new Date().toISOString().slice(0, 10),
    nodeZonedDate: zonedDate(new Date(), timezone),
    nodeZonedNow: zonedDateTime(new Date(), timezone),
    input: before,
    setLocalToday,
    submitted,
    afterSubmit,
    mutationRequestsOnInvalidSubmit: mutationsAfter - mutationsBefore,
    controlMinDate: control,
    consoleErrors: diag.consoleLogs.filter((l) => l.type === "error").slice(-5),
    pageErrors: diag.pageErrors.slice(-5),
  };
  await browser.close();
  return result;
}

const result = {
  capturedAt: new Date().toISOString(),
  newYork: await run("America/New_York"),
};
writeEvidence("ui-tz", result);
writeLog("ui-tz", log);
console.log("done");