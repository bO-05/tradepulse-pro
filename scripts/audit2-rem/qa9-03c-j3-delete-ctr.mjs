/**
 * QA9 J3c: delete a bidless contractor via UI (allowed path), scoped to the card.
 * Evidence: evidence/fix4-qa9-j3c-*.json
 */
import { client, launchBrowser, waitForAppReady, delay, selectProjectByTitle, clickByText, shot, writeEvidence, FIXTURE_TAG } from "./qa9-lib.mjs";

const c = client();
const PROJECT = `${FIXTURE_TAG}-J3-BIDS`;
const proj = (await c.query("projects:listProjects", {})).find((p) => p.title === PROJECT);
const result = { journey: "J3c", data: {} };
const { browser } = await launchBrowser(1440, 950);
const page = await browser.newPage();
try {
  await page.goto("https://brainy-skunk-440.convex.site/", { waitUntil: "domcontentloaded", timeout: 60000 });
  await waitForAppReady(page);
  await selectProjectByTitle(page, PROJECT);
  await delay(1500);
  await page.keyboard.press("Digit2");
  await delay(1500);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").includes("QA9 Buyout Lifecycle"));
    if (b) b.click();
  });
  await delay(1200);
  const opened = await page.evaluate(() => {
    const cards = [...document.querySelectorAll("div")]
      .filter((d) => d.querySelector('button[title="Delete contractor"]') && (d.textContent || "").includes("QA9 Lifecycle Low"))
      .sort((a, b) => a.textContent.length - b.textContent.length);
    const card = cards[0];
    if (!card) return false;
    const b = card.querySelector('button[title="Delete contractor"]');
    b.scrollIntoView({ block: "center" }); b.click(); return true;
  });
  result.data.opened = opened;
  if (opened) {
    await delay(600);
    await clickByText(page, "Remove contractor", { exact: true });
    await delay(3000);
    result.data.toast = await page.evaluate(() => { const el = document.querySelector('[role="status"]'); return el ? el.innerText.trim() : null; });
  }
  const remaining = (await c.query("contractors:listByProject", { projectId: proj._id })).map((x) => x.companyName).filter((n) => n.includes("QA9 Lifecycle") || n.includes("QA9 Buyout"));
  result.data.remaining = remaining;
  await shot(page, "fix4-qa9-j3c.png");
} catch (err) {
  result.crash = String(err?.message ?? err);
} finally {
  writeEvidence("j3c-bids", result);
  await browser.close();
}
console.log(JSON.stringify(result.data));