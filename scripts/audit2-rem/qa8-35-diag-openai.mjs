/** QA8 focused — Diagnostics must report OpenAI adapter unavailable (no key). */
import { clickHeaderTab, delay, gotoDemo, launchBrowser, writeJson } from "./qa6-lib.mjs";
import { shot } from "./lib.mjs";
import { writeEvidence } from "./qa8-lib.mjs";

const out = { ranAt: new Date().toISOString(), checks: [] };
const checks = [];
const add = (id, label, ok, observed) => {
  checks.push({ id, label, ok, observed: String(observed).slice(0, 400) });
  console.log(`${ok ? "PASS" : "FAIL"}  ${id} ${label} :: ${String(observed).slice(0, 250)}`);
};

const { browser } = await launchBrowser(1440, 900);
const page = await browser.newPage();
try {
  await gotoDemo(page);
  await clickHeaderTab(page, "Evals & Architecture");
  await delay(1800);
  const selected = await page.evaluate(() => {
    const cards = [...document.querySelectorAll("div")].filter((d) => {
      const t = d.innerText || "";
      return /OpenAI GPT-4o/.test(t) && /BYOK Adapter/.test(t) && t.length < 700;
    });
    const card = cards[cards.length - 1];
    if (!card) return null;
    card.click();
    return card.innerText.replace(/\s+/g, " ").slice(0, 200);
  });
  await delay(700);
  const selectedNow = await page.evaluate(() => {
    const cards = [...document.querySelectorAll("div")].filter((d) => {
      const t = d.innerText || "";
      return /OpenAI GPT-4o/.test(t) && /BYOK Adapter/.test(t) && t.length < 700;
    });
    const card = cards[cards.length - 1];
    return card ? /Selected/.test(card.innerText) : null;
  });
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => /Run Token Diagnostics/.test(x.innerText));
    if (b) b.click();
  });
  await delay(3000);
  const result = await page.evaluate(() => {
    const text = document.body.innerText;
    const m = text.match(/Diagnostic unavailable[\s\S]{0,500}/) || text.match(/Live measurement[\s\S]{0,300}/) || text.match(/Offline fallback[\s\S]{0,300}/);
    return {
      unavailable: /Diagnostic unavailable/.test(text),
      noCall: /No call was made/.test(text),
      adapterMessage: /The openai adapter is wired and ready, but no API key is configured/.test(text),
      block: m ? m[0].replace(/\s+/g, " ").slice(0, 420) : null,
    };
  });
  await shot(page, "fix4-qa8-35-diag-openai.png");
  out.selectedCard = selected;
  out.selectedNow = selectedNow;
  out.result = result;
  add("H-DIAG-1", "OpenAI card selectable and diagnostic reports unavailable honestly", selectedNow === true && result.unavailable && result.noCall && result.adapterMessage, JSON.stringify({ selectedNow, ...result }).slice(0, 350));
} catch (err) {
  out.fatal = String(err?.stack ?? err);
  console.error("FATAL", err);
} finally {
  await browser.close();
  out.checks = checks;
  writeEvidence("35-diag-openai", out);
  writeJson("fix4-qa8-35-diag-openai.json", out);
  console.log(`\nQA8-35 done. failed=${checks.filter((c) => !c.ok).length}`);
}