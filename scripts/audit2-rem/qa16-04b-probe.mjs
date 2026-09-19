import { launchBrowser, attachDiagnostics, waitForAppReady, delay, clickButtonByText } from "./lib.mjs";
import { client, readEvidence, writeEvidence } from "./qa16-lib.mjs";

const fx = readEvidence("fixtures");
const c = client();
const out = {};

const dumpInteractive = (page) =>
  page.evaluate(() => {
    const btns = [...document.querySelectorAll("button")].map((b) => ({
      t: (b.textContent || "").trim().slice(0, 70),
      title: b.getAttribute("title"),
      disabled: b.disabled,
    }));
    const clickables = [...document.querySelectorAll("div,li,a")].filter((el) => {
      const cls = String(el.className || "");
      return (cls.includes("cursor-pointer") || el.getAttribute("role") === "button") && (el.textContent || "").trim().length > 0 && (el.textContent || "").trim().length < 400;
    }).slice(0, 25).map((el) => ({ tag: el.tagName, role: el.getAttribute("role"), cls: String(el.className).slice(0, 60), text: (el.textContent || "").trim().slice(0, 90) }));
    return { btns, clickables };
  });

async function main() {
  const { browser } = await launchBrowser(1500, 950);
  const page = await browser.newPage();
  const diag = attachDiagnostics(page);

  await page.goto(`https://brainy-skunk-440.convex.site/?project=${fx.projectA.id}&tab=leveling&qa16=probe`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await waitForAppReady(page);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => (x.getAttribute("title") || "").includes("Close Demo Tour") || (x.textContent || "").trim() === "Dismiss");
    b?.click();
  });
  await delay(1200);
  out.leveling = await dumpInteractive(page);

  // packages tab
  await clickButtonByText(page, "CSI Scoping");
  await delay(900);
  out.packages = await dumpInteractive(page);
  out.packageCards = await page.evaluate(() =>
    [...document.querySelectorAll("div")].filter((d) => /AUDIT-QA16/.test(d.textContent || "") && d.querySelector('button[title="Delete Trade Package"]')).slice(0, 10).map((d) => ({ text: (d.textContent || "").slice(0, 140), hasTrash: true, cls: String(d.className).slice(0, 50) }))
  );

  // backlog: conversations public query for B
  try {
    out.bConversations = await c.query("rfq:listConversations", { tradePackageId: fx.projectB.package });
  } catch (e) { out.bConversationsError = String(e).slice(0, 200); }

  out.diag = { errors: diag.consoleLogs.filter((l) => l.type === "error").length, pageErrors: diag.pageErrors.slice(0, 5) };
  writeEvidence("probe", out);
  console.log(JSON.stringify(out, null, 1).slice(0, 12000));
  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });