// QA6-06: selected-state ARIA (aria-current / aria-pressed) + prefers-reduced-motion behavior.
import {
  BASE_URL,
  armOpenerByText,
  clickHeaderTab,
  delay,
  gotoDemo,
  launchBrowser,
  shot,
  writeJson,
  writeLog,
} from "./qa6-lib.mjs";

const STATE_PROBE = () => {
  const vis = (el) => {
    const r = el.getBoundingClientRect();
    return r.width > 1 && r.height > 1 && getComputedStyle(el).display !== "none";
  };
  const stepper = [...document.querySelectorAll("header button[aria-current]")].map((b) => ({
    value: b.getAttribute("aria-current"),
    text: (b.innerText || "").trim().replace(/\s+/g, " ").slice(0, 50),
  }));
  const pressed = [...document.querySelectorAll("[aria-pressed]")].filter(vis).map((b) => ({
    value: b.getAttribute("aria-pressed"),
    text: (b.innerText || b.getAttribute("title") || "").trim().replace(/\s+/g, " ").slice(0, 50),
  }));
  return {
    headerAriaCurrent: stepper,
    headerAriaCurrentCount: stepper.length,
    tradeChips: { total: pressed.length, true: pressed.filter((p) => p.value === "true").length, false: pressed.filter((p) => p.value === "false").length, sample: pressed.slice(0, 8) },
  };
};

const MOTION_PROBE = () => {
  const anims = [];
  for (const el of document.querySelectorAll("*")) {
    const cs = getComputedStyle(el);
    if (cs.animationName && cs.animationName !== "none") {
      anims.push({
        tag: el.tagName.toLowerCase(),
        cls: (el.className || "").toString().slice(0, 80),
        name: cs.animationName,
        duration: cs.animationDuration,
        durationS: parseFloat(cs.animationDuration) * (cs.animationDuration.includes("ms") ? 0.001 : 1),
        iteration: cs.animationIterationCount,
      });
    }
  }
  const transitions = [...document.querySelectorAll("*")]
    .map((el) => getComputedStyle(el))
    .filter((cs) => cs.transitionDuration && cs.transitionDuration !== "0s")
    .map((cs) => cs.transitionDuration);
  const maxDuration = (list) => Math.max(0, ...list.map((d) => parseFloat(d) * (d.includes("ms") ? 0.001 : 1)));
  return {
    mediaMatches: matchMedia("(prefers-reduced-motion: reduce)").matches,
    animationCount: anims.length,
    infiniteAnimations: anims.filter((a) => a.iteration === "infinite"),
    maxAnimationDurationS: maxDuration(anims.map((a) => a.duration)),
    transitionCount: transitions.length,
    maxTransitionDurationS: maxDuration(transitions),
  };
};

const run = async () => {
  const { browser } = await launchBrowser(1440, 900);
  const out = { url: BASE_URL, viewport: "1440x900", startedAt: new Date().toISOString() };
  const lines = [];
  try {
    const page = await browser.newPage();
    out.project = await gotoDemo(page);

    out.states = await page.evaluate(STATE_PROBE);
    lines.push(`ARIA-CURRENT header stepper count=${out.states.headerAriaCurrentCount} :: ${JSON.stringify(out.states.headerAriaCurrent)}`);

    out.tradeChips = {};
    for (const [id, label] of [
      ["discovery", "02: Discovery"],
      ["qna", "03: Pre-Bid"],
      ["leveling", "04: Bid Leveling"],
    ]) {
      await clickHeaderTab(page, label);
      await delay(300);
      const p = await page.evaluate(STATE_PROBE);
      out.tradeChips[id] = p.tradeChips;
      lines.push(`TRADE CHIPS ${id}: total=${p.tradeChips.total} true=${p.tradeChips.true} false=${p.tradeChips.false}`);
    }

    await page.evaluate(() => window.scrollTo(0, 0));
    await delay(200);
    const cueAlready = await page.evaluate(() =>
      [...document.querySelectorAll("button")].some((b) => (b.getAttribute("title") || "").includes("full presenter script"))
    );
    if (!cueAlready) {
      const tourOpen = await armOpenerByText(page, "Demo Tour");
      if (tourOpen) {
        await page.mouse.click(tourOpen.x, tourOpen.y);
        await delay(800);
      }
    }
    if (
      await page.evaluate(() =>
        [...document.querySelectorAll("button")].some((b) => (b.getAttribute("title") || "").includes("full presenter script"))
      )
    ) {
      out.tourPills = await page.evaluate(() => {
        const vis = (el) => el.getBoundingClientRect().width > 1;
        return [...document.querySelectorAll('[aria-current="step"]')].filter(vis).map((b) => ({
          value: b.getAttribute("aria-current"),
          text: (b.innerText || b.getAttribute("title") || "").trim().slice(0, 40),
        }));
      });
      lines.push(`TOUR PILLS aria-current=step count=${out.tourPills.length} :: ${JSON.stringify(out.tourPills)}`);
      await shot(page, "fix4-qa6-06-states.png");
      await page.evaluate(() => {
        const b = [...document.querySelectorAll("button")].find((x) => (x.getAttribute("title") || "") === "Close Demo Tour");
        if (b) b.click();
      });
      await delay(300);
    }

    // ---- reduced motion (fresh page) ----
    const rm = await browser.newPage();
    await rm.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
    await gotoDemo(rm);
    out.reducedMotion = await rm.evaluate(MOTION_PROBE);
    const rmCue = await rm.evaluate(() =>
      [...document.querySelectorAll("button")].some((b) => (b.getAttribute("title") || "").includes("full presenter script"))
    );
    if (!rmCue) {
      const rmTour = await armOpenerByText(rm, "Demo Tour");
      if (rmTour) {
        await rm.mouse.click(rmTour.x, rmTour.y);
        await delay(600);
      }
    }
    out.reducedMotionWithTour = await rm.evaluate(MOTION_PROBE);
    await shot(rm, "fix4-qa6-06-reduced-motion.png");
    lines.push(
      `REDUCED-MOTION mediaMatches=${out.reducedMotion.mediaMatches} animations=${out.reducedMotion.animationCount} infinite=${out.reducedMotion.infiniteAnimations.length} maxAnimDur=${out.reducedMotion.maxAnimationDurationS}s maxTransDur=${out.reducedMotion.maxTransitionDurationS}s`
    );
    lines.push(
      `REDUCED-MOTION+tour animations=${out.reducedMotionWithTour.animationCount} infinite=${out.reducedMotionWithTour.infiniteAnimations.length} maxAnimDur=${out.reducedMotionWithTour.maxAnimationDurationS}s`
    );
    lines.push(`   infinite samples: ${JSON.stringify(out.reducedMotionWithTour.infiniteAnimations.slice(0, 6))}`);
    console.log(lines[lines.length - 3]);
    console.log(lines[lines.length - 2]);
    console.log(lines[lines.length - 1]);

    writeJson("fix4-qa6-06-states-motion.json", out);
    writeLog("fix4-qa6-06-states-motion.log", lines);
  } finally {
    await browser.close();
  }
};
run();