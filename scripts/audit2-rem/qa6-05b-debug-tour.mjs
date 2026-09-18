import { gotoDemo, launchBrowser, delay, armOpenerByText, shot } from "./qa6-lib.mjs";

const run = async () => {
  const { browser } = await launchBrowser(1440, 900);
  const page = await browser.newPage();
  try {
    await gotoDemo(page);
    const before = await page.evaluate(() => ({
      demoButtons: [...document.querySelectorAll("button")].filter((b) => (b.innerText || "").includes("Demo Tour")).map((b) => ({ text: b.innerText.trim(), title: b.getAttribute("title"), rect: b.getBoundingClientRect().toJSON() })),
      cueButtons: [...document.querySelectorAll("button")].filter((b) => (b.getAttribute("title") || "").includes("presenter script")).length,
    }));
    console.log("BEFORE", JSON.stringify(before, null, 1));
    const op = await armOpenerByText(page, "Demo Tour");
    console.log("OPENER", JSON.stringify(op));
    await page.mouse.click(op.x, op.y);
    await delay(900);
    const after = await page.evaluate(() => ({
      cueButtons: [...document.querySelectorAll("button")].filter((b) => (b.getAttribute("title") || "").includes("presenter script")).map((b) => ({ title: b.getAttribute("title"), rect: b.getBoundingClientRect().toJSON(), html: b.outerHTML.slice(0, 200) })),
      anyCue: [...document.querySelectorAll("button")].filter((b) => (b.getAttribute("title") || "").toLowerCase().includes("script")).map((b) => ({ title: b.getAttribute("title"), text: (b.innerText || "").slice(0, 60) })),
      bodyHasScene: document.body.innerText.includes("Scene 01/06"),
      dismiss: [...document.querySelectorAll("button")].filter((b) => (b.getAttribute("title") || "").includes("Close Teleprompter") || (b.innerText || "").includes("Dismiss")).map((b) => ({ title: b.getAttribute("title"), text: b.innerText.trim().slice(0, 30) })),
    }));
    console.log("AFTER", JSON.stringify(after, null, 1));
    await shot(page, "fix4-qa6-05b-debug-tour.png");
  } finally {
    await browser.close();
  }
};
run();