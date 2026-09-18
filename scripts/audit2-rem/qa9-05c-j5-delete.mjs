/**
 * QA9 J5c: delete file — allowed (spec) vs linked-to-bid guard (quote) + error text.
 * Evidence: evidence/fix4-qa9-j5c-*.json
 */
import { client, launchBrowser, waitForAppReady, delay, selectProjectByTitle, clickByText, shot, writeEvidence, FIXTURE_TAG } from "./qa9-lib.mjs";

const c = client();
const PROJECT = `${FIXTURE_TAG}-J5-FILES`;
const proj = (await c.query("projects:listProjects", {})).find((p) => p.title === PROJECT);
const result = { journey: "J5c", data: {} };
const { browser } = await launchBrowser(1440, 950);
const page = await browser.newPage();
try {
  await page.goto("https://brainy-skunk-440.convex.site/", { waitUntil: "domcontentloaded", timeout: 60000 });
  await waitForAppReady(page);
  await selectProjectByTitle(page, PROJECT);
  await delay(1500);
  await page.keyboard.press("Digit1");
  await page.waitForSelector('select[aria-label="Document type for upload"]', { timeout: 15000 });
  await delay(700);
  const openDelete = async (name) => page.evaluate((n) => {
    const rows = [...document.querySelectorAll("div")].filter((d) => (d.textContent || "").includes(n) && d.querySelector('button[title="Delete file from storage"]')).sort((a, b) => a.textContent.length - b.textContent.length);
    if (!rows[0]) return false;
    rows[0].querySelector('button[title="Delete file from storage"]').click();
    return true;
  }, name);

  // spec delete (allowed)
  result.data.specOpen = await openDelete("QA9_J5_Spec.txt");
  await delay(700);
  result.data.specConfirm = await clickByText(page, "Delete file", { exact: true });
  await delay(3000);
  let files = await c.query("files:listFilesByProject", { projectId: proj._id });
  result.data.afterSpecDelete = files.map((f) => f.fileName);
  result.data.specStatus = await page.evaluate(() => document.body.innerText.split("\n").filter((l) => /deleted|Delete failed/i.test(l)).slice(0, 3).join(" | "));
  await shot(page, "fix4-qa9-j5c-spec-deleted.png");

  // quote delete (linked to bid -> guard)
  result.data.quoteOpen = await openDelete("QA9_J5_Quote.txt");
  await delay(700);
  result.data.quoteConfirm = await clickByText(page, "Delete file", { exact: true });
  await delay(3000);
  files = await c.query("files:listFilesByProject", { projectId: proj._id });
  result.data.afterQuoteDelete = files.map((f) => f.fileName);
  result.data.quoteDialogText = await page.evaluate(() => {
    const dlg = document.querySelector('[role="dialog"]');
    return dlg ? dlg.innerText.split("\n").filter(Boolean).slice(-4).join(" | ") : null;
  });
  result.data.quoteStatus = await page.evaluate(() => document.body.innerText.split("\n").filter((l) => /deleted|Delete failed|linked to a bid|Something went wrong/i.test(l)).slice(0, 4).join(" | "));
  await shot(page, "fix4-qa9-j5c-quote-guard.png");
} catch (err) {
  result.crash = String(err?.message ?? err);
} finally {
  writeEvidence("j5c-files", result);
  await browser.close();
}
console.log(JSON.stringify(result.data, null, 1).slice(0, 2000));