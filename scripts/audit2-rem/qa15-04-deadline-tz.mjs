/**
 * QA15 live UI + HTTP: A14-01 bid-deadline validation honors the user's LOCAL
 * calendar day (emulated America/New_York), while a deadline two days in the
 * past is still refused.
 */
import {
  launchBrowser,
  attachDiagnostics,
  waitForAppReady,
  shot,
  delay,
  setInputValue,
} from "./lib.mjs";
import { client, readEvidence, writeEvidence, writeLog, call, zonedDate, zonedDateTime, addDays } from "./qa15-lib.mjs";

const c = client();
const F = readEvidence("fixtures");
const log = [];
const say = (s) => { log.push(s); console.log(s); };
const results = [];
const record = (name, pass, detail) => {
  results.push({ name, pass: Boolean(pass), detail });
  say(`${pass ? "PASS" : "FAIL"}  ${name} :: ${detail}`);
};

const TZ = "America/New_York";
const UI_CSI = "12 00 00";
const HTTP_OK_CSI = "13 00 00";
const HTTP_BAD_CSI = "14 00 00";

async function purgeCsi(csi) {
  const pkgs = (await c.query("tradePackages:listByProject", { projectId: F.cron.projectId })) || [];
  for (const pkg of pkgs.filter((p) => p.csiDivision.trim().startsWith(csi.slice(0, 2)))) {
    try { await c.mutation("tradePackages:deleteTradePackage", { tradePackageId: pkg._id }); } catch (err) { say(`purge ${csi} failed: ${err?.data ?? err?.message ?? err}`); }
  }
}

async function main() {
  const now = new Date();
  const localDate = zonedDate(now, TZ);
  const utcToday = now.toISOString().slice(0, 10);
  const twoDaysAgo = addDays(utcToday, -2);

  await purgeCsi(UI_CSI);
  await purgeCsi(HTTP_OK_CSI);
  await purgeCsi(HTTP_BAD_CSI);

  const { browser } = await launchBrowser(1440, 900);
  const page = await browser.newPage();
  const diag = attachDiagnostics(page);
  await page.emulateTimezone(TZ);
  await page.evaluateOnNewDocument((pid) => {
    window.localStorage.setItem("tradepulse.selectedProjectId", pid);
  }, F.cron.projectId);
  await page.goto(`https://brainy-skunk-440.convex.site/?project=${F.cron.projectId}&tab=packages&qa15=tz`, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await waitForAppReady(page);

  const opened = await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find((b) => (b.textContent || "").includes("Create Trade Package"));
    if (!btn) return { ok: false };
    btn.click();
    return { ok: true };
  });
  if (!opened.ok) throw new Error("Create Trade Package button not found");
  await page.waitForSelector('input[aria-label="Bid deadline"]', { timeout: 15000 });

  const before = await page.evaluate(() => {
    const input = document.querySelector('input[aria-label="Bid deadline"]');
    const browserLocalDate = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    return {
      min: input.getAttribute("min"),
      value: input.value,
      browserLocalDate,
      browserUtcDate: new Date().toISOString().slice(0, 10),
      pageOffsetMinutes: new Date().getTimezoneOffset(),
    };
  });
  say(`[${TZ}] min=${before.min} local=${before.browserLocalDate} utc=${before.browserUtcDate}`);
  await shot(page, "fix4-qa15-A14-01-date-input-min.png");

  const setLocalToday = await page.evaluate((d) => {
    const input = document.querySelector('input[aria-label="Bid deadline"]');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    setter.call(input, d);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return {
      value: input.value,
      valid: input.validity.valid,
      rangeUnderflow: input.validity.rangeUnderflow,
      validationMessage: input.validationMessage,
    };
  }, before.browserLocalDate);
  say(`set local today -> ${JSON.stringify(setLocalToday)}`);

  record(
    "A14-01-ui-min-is-local-date",
    before.min === before.browserLocalDate &&
      (before.browserLocalDate !== before.browserUtcDate || before.min === before.browserUtcDate) &&
      setLocalToday.valid === true &&
      setLocalToday.rangeUnderflow === false,
    `min=${before.min}; localDate=${before.browserLocalDate}; utcDate=${before.browserUtcDate}; set=${JSON.stringify(setLocalToday)}`
  );

  // Fill the rest of the form and submit with the local "today".
  await setInputValue(page, 'input[aria-label="CSI division number"]', UI_CSI);
  await setInputValue(page, 'input[aria-label="Trade package name"]', "AUDIT-QA15 Local Today UI");
  await setInputValue(page, 'input[aria-label="Budget estimate in dollars"]', "250000");
  await setInputValue(page, 'textarea[aria-label="Scope summary"]', "QA15 A14-01 UI local-today acceptance probe.");
  await setInputValue(page, 'textarea[aria-label="Mandatory inclusions, one per line"]', "QA15 inclusion A");
  await delay(400);
  const submit = await page.evaluate(() => {
    const dialog = document.querySelector('[aria-labelledby="create-package-title"]');
    const btn = dialog ? [...dialog.querySelectorAll("button")].find((b) => (b.textContent || "").trim() === "Create Package") : null;
    if (!btn) return { ok: false };
    if (btn.disabled) return { ok: false, disabled: true };
    btn.click();
    return { ok: true };
  });
  await delay(2500);
  const afterSubmit = await page.evaluate(() => ({
    dialogOpen: Boolean(document.querySelector('[aria-labelledby="create-package-title"]')),
    validationMessage: document.querySelector('input[aria-label="Bid deadline"]')?.validationMessage ?? null,
    errorText: document.querySelector('[aria-labelledby="create-package-title"] [role="alert"]')?.textContent ?? null,
    status: [...document.querySelectorAll('[role="status"]')].map((e) => e.innerText.trim()).filter(Boolean).slice(-2),
  }));

  const pkgs = (await c.query("tradePackages:listByProject", { projectId: F.cron.projectId })) || [];
  const uiPkg = pkgs.find((p) => p.tradeName === "AUDIT-QA15 Local Today UI") || null;
  record(
    "A14-01-ui-submits-local-today",
    submit.ok && Boolean(uiPkg) && uiPkg.bidDeadline === before.browserLocalDate,
    `submit=${JSON.stringify(submit)}; afterSubmit=${JSON.stringify(afterSubmit)}; storedPkg=${uiPkg ? `${uiPkg._id}:${uiPkg.bidDeadline}:${uiPkg.status}` : null}; expected=${before.browserLocalDate}`
  );

  // ---- HTTP probes (fresh on this run)
  const httpLocalToday = await call(`HTTP createTradePackage(deadline=${localDate})`, () =>
    c.mutation("tradePackages:createTradePackage", {
      projectId: F.cron.projectId,
      csiDivision: HTTP_OK_CSI,
      tradeName: "AUDIT-QA15 HTTP Local Today",
      budgetEstimate: 100_000,
      scopeSummary: "QA15 A14-01 HTTP local-today probe.",
      mandatoryInclusions: ["probe"],
      bidDeadline: localDate,
    })
  );
  const httpTwoDaysAgo = await call(`HTTP createTradePackage(deadline=${twoDaysAgo})`, () =>
    c.mutation("tradePackages:createTradePackage", {
      projectId: F.cron.projectId,
      csiDivision: HTTP_BAD_CSI,
      tradeName: "AUDIT-QA15 HTTP Two Days Ago",
      budgetEstimate: 100_000,
      scopeSummary: "QA15 A14-01 HTTP past refusal probe.",
      mandatoryInclusions: ["probe"],
      bidDeadline: twoDaysAgo,
    })
  );
  const localTodayPkg = httpLocalToday.ok
    ? ((await c.query("tradePackages:listByProject", { projectId: F.cron.projectId })) || []).find((p) => p.tradeName === "AUDIT-QA15 HTTP Local Today")
    : null;
  const badPkg = ((await c.query("tradePackages:listByProject", { projectId: F.cron.projectId })) || []).find((p) => p.tradeName === "AUDIT-QA15 HTTP Two Days Ago");
  record(
    "A14-01-http-local-today-accepted-two-days-ago-rejected",
    httpLocalToday.ok &&
      localTodayPkg &&
      localTodayPkg.bidDeadline === localDate &&
      !httpTwoDaysAgo.ok &&
      /cannot be in the past/i.test(`${httpTwoDaysAgo.data ?? ""} ${httpTwoDaysAgo.message ?? ""}`) &&
      !badPkg,
    `localToday=${JSON.stringify(httpLocalToday)}; stored=${localTodayPkg ? localTodayPkg.bidDeadline : null}; twoDaysAgo=${JSON.stringify(httpTwoDaysAgo)}; badCreated=${Boolean(badPkg)}`
  );

  const diagnostics = {
    consoleErrors: diag.consoleLogs.filter((l) => l.type === "error").map((e) => e.text.slice(0, 200)),
    pageErrors: diag.pageErrors.slice(0, 10),
    pageErrorCount: diag.pageErrors.length,
    failedRequests: diag.failedRequests.slice(0, 10),
  };
  say(`diagnostics: ${JSON.stringify({ consoleErrors: diagnostics.consoleErrors.length, pageErrors: diagnostics.pageErrorCount })}`);

  writeEvidence("deadline-tz", {
    results,
    clock: { timezone: TZ, localDate, utcToday, twoDaysAgo, localNow: zonedDateTime(now, TZ), utcNow: now.toISOString() },
    input: before,
    setLocalToday,
    submit,
    afterSubmit,
    uiPackage: uiPkg ? { id: uiPkg._id, bidDeadline: uiPkg.bidDeadline, status: uiPkg.status } : null,
    httpLocalToday,
    httpTwoDaysAgo,
    httpLocalTodayPackage: localTodayPkg ? { id: localTodayPkg._id, bidDeadline: localTodayPkg.bidDeadline } : null,
    diagnostics,
  });
  writeLog("deadline-tz", log);
  console.log(`\nresults: ${results.filter((r) => r.pass).length}/${results.length} passed`);
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  writeLog("deadline-tz-crash", [String(e?.stack ?? e)]);
  process.exit(1);
});