/**
 * QA9 J2c: verify escalated RFI appears in the UI PM Review Queue.
 * Evidence: evidence/fix4-qa9-j2c-*.json
 */
import { client, launchBrowser, waitForAppReady, delay, selectProjectByTitle, shot, writeEvidence, FIXTURE_TAG } from "./qa9-lib.mjs";

const c = client();
const PROJECT = `${FIXTURE_TAG}-J2-RFI`;
const proj = (await c.query("projects:listProjects", {})).find((p) => p.title === PROJECT);
const result = { journey: "J2c", data: {} };
const { browser } = await launchBrowser(1440, 950);
const page = await browser.newPage();
try {
  await page.goto("https://brainy-skunk-440.convex.site/", { waitUntil: "domcontentloaded", timeout: 60000 });
  await waitForAppReady(page);
  await selectProjectByTitle(page, PROJECT);
  await delay(1400);
  await page.keyboard.press("Digit3");
  await page.waitForSelector('select[aria-label="Target trade package for this RFI"]', { timeout: 15000 });
  await delay(800);
  const q1 = await page.evaluate(() => [...document.querySelectorAll("main button")].map((b) => (b.textContent || "").trim()).filter((t) => t.includes("Queue") || t.includes("Approved for Addendum")));
  result.data.buttonsBeforeActivate = q1;
  const activated = await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").includes("QA9 Electrical") && (x.textContent || "").length < 40);
    if (!b) return false;
    b.click();
    return true;
  });
  result.data.activated = activated;
  await delay(1500);
  result.data.pageText = (await page.evaluate(() => document.body.innerText)).split("\n").filter((l) => /Queue|waiver|escalat|PM Review/i.test(l)).slice(0, 20);
  await shot(page, "fix4-qa9-j2c-queue.png");
  const q2 = await page.evaluate(() => [...document.querySelectorAll("main button")].map((b) => (b.textContent || "").trim()).filter((t) => t.includes("Queue") || t.includes("Approved for Addendum")));
  result.data.buttonsAfterActivate = q2;
} catch (err) {
  result.crash = String(err?.message ?? err);
} finally {
  writeEvidence("j2c-rfi", result);
  await browser.close();
}
console.log(JSON.stringify(result.data, null, 1).slice(0, 2000), result.crash ?? "");