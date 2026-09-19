import { delay, launchBrowser, attachDiagnostics, shot } from "./lib.mjs";
import { client, WEBSITE, listProjects, writeEvidence, writeLog } from "./qa13-lib.mjs";

const c = client();
const log = [];
const say = (s) => { log.push(s); console.log(s); };

async function main() {
  const projects = await listProjects(c);
  say(`projects (${projects.length}): ${JSON.stringify(projects.map((p) => ({ id: p._id, title: p.title, demo: p.isDemoProject })))}`);

  const { browser } = await launchBrowser(1440, 900);
  const page = await browser.newPage();
  const diag = attachDiagnostics(page);
  await page.goto(WEBSITE, { waitUntil: "domcontentloaded", timeout: 60000 });
  await delay(1500);

  const openProbe = await page.evaluate(() => {
    const plain = window.open("", "_blank", "width=300,height=200");
    const plainText = plain ? "handle" : "null";
    if (plain) plain.close();
    const noopener = window.open("", "_blank", "noopener,noreferrer,width=900,height=1000");
    const noopenerText = noopener ? "handle" : "null";
    if (noopener) noopener.close();
    const noopenerOnly = window.open("", "_blank", "noopener");
    const noopenerOnlyText = noopenerOnly ? "handle" : "null";
    if (noopenerOnly) noopenerOnly.close();
    return { plainText, noopenerText, noopenerOnlyText, userAgent: navigator.userAgent };
  });
  say(`window.open probe: ${JSON.stringify(openProbe)}`);

  await shot(page, "fix4-qa13-00-live-shell.png");
  writeEvidence("00-probe", { projects, openProbe, diagnostics: {
    pageErrors: diag.pageErrors.slice(0, 5),
    failedRequests: diag.failedRequests.slice(0, 5),
  } });
  writeLog("00-probe", log);
  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });