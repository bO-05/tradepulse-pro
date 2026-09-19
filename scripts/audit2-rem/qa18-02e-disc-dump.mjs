import { launchBrowser, waitForAppReady, delay } from "./lib.mjs";
import { readEvidence, writeEvidence, writeLog } from "./qa18-lib.mjs";

const fx = readEvidence("fixtures");
const BASE = "https://brainy-skunk-440.convex.site";
const log = [];
const say = (s) => { log.push(s); console.log(s); };

const { browser } = await launchBrowser(1440, 950);
const page = await browser.newPage();
page.on("pageerror", (e) => say("PAGEERROR " + e.message));
page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") say(`CONSOLE ${m.type()}: ${m.text().slice(0, 300)}`); });
await page.goto(`${BASE}/?project=${fx.vol.id}&tab=discovery&qa18=dump`, { waitUntil: "domcontentloaded", timeout: 90000 });
await waitForAppReady(page, 60000);
await delay(3000);

const dump = await page.evaluate(() => ({
  main: document.querySelector("main") ? document.querySelector("main").innerText.slice(0, 2500) : null,
  body: document.body.innerText.slice(0, 3500),
  mainChildren: document.querySelector("main") ? document.querySelector("main").children.length : 0,
  html: document.querySelector("main") ? document.querySelector("main").innerHTML.length : 0,
}));
say("=== MAIN ===\n" + dump.main);
say("=== MAIN CHILDREN: " + dump.mainChildren + " htmlLen=" + dump.html + " ===");
writeEvidence("disc-dump", dump);
writeLog("disc-dump", log);
await browser.close();
console.log("done");