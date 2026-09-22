/**
 * Demo recorder (`scripts/qa/record-demo.mjs`).
 *
 * Records the live TradePulse Pro app from a browser tab using the Chrome DevTools
 * Protocol screencast (no extra dependencies beyond puppeteer-core + ffmpeg), while
 * you or an agent drives the demo in the opened window. Frames are captured on
 * change with per-frame timestamps and muxed at their real display durations, so
 * static screens hold and the output keeps true pacing.
 *
 * Usage:
 *   node scripts/qa/record-demo.mjs --duration 30          # automated, 30 seconds
 *   node scripts/qa/record-demo.mjs                       # drive it yourself; press Enter to stop
 *   node scripts/qa/record-demo.mjs --headless --duration 20
 *   node scripts/qa/record-demo.mjs --url http://127.0.0.1:5173
 *
 * Output: evidence/demo-recordings/<timestamp>/demo-<timestamp>.mp4 (plus the
 * mux command if ffmpeg is missing). The temporary frames are deleted after a
 * successful mux unless --keep-frames is passed.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import puppeteer from "puppeteer-core";
import { REPO_ROOT, EVIDENCE_DIR, BASE_URL } from "./lib.mjs";

const BROWSER_CANDIDATES = [
  process.env.QA_CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].filter(Boolean);

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  const value = process.argv[index + 1];
  return value && !value.startsWith("--") ? value : true;
}

const WIDTH = Number(arg("width", 1920));
const HEIGHT = Number(arg("height", 1080));
const DURATION = arg("duration", null);
const URL = String(arg("url", BASE_URL));
const HEADLESS = Boolean(arg("headless", false));
const KEEP_FRAMES = Boolean(arg("keep-frames", false));
const OUT_DIR =
  typeof arg("out", null) === "string"
    ? path.resolve(String(arg("out", null)))
    : path.join(EVIDENCE_DIR, "demo-recordings", new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19));

function ffmpegPath() {
  const probe = spawnSync("ffmpeg", ["-version"], { encoding: "utf8", shell: true });
  return probe.status === 0 ? "ffmpeg" : null;
}

async function main() {
  const executablePath = BROWSER_CANDIDATES.find((candidate) => fs.existsSync(candidate));
  if (!executablePath) throw new Error("No Chrome/Edge found. Set QA_CHROME_PATH.");

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const profileDir = path.join(OUT_DIR, ".chrome-profile");
  const framesDir = path.join(OUT_DIR, "frames");
  fs.mkdirSync(framesDir, { recursive: true });

  const browser = await puppeteer.launch({
    headless: HEADLESS ? true : false,
    executablePath,
    userDataDir: profileDir,
    protocolTimeout: 300000,
    args: [
      "--no-sandbox",
      "--hide-scrollbars",
      "--autoplay-policy=no-user-gesture-required",
      `--window-size=${WIDTH},${HEIGHT}`,
    ],
    defaultViewport: { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1 },
  });

  const page = await browser.newPage();
  await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page
    .waitForSelector('select[aria-label="Select Commercial Construction Project"]', { timeout: 60000 })
    .catch(() => {});
  await delay(1500);

  const client = await page.createCDPSession();
  await client.send("Page.enable");

  const timestamps = [];
  let frameCount = 0;
  client.on("Page.screencastFrame", async (frame) => {
    frameCount += 1;
    const framePath = path.join(framesDir, `frame-${String(frameCount).padStart(5, "0")}.jpg`);
    try {
      fs.writeFileSync(framePath, Buffer.from(frame.data, "base64"));
      timestamps.push(Date.now());
    } catch (err) {
      console.warn("frame write failed:", err?.message ?? err);
    }
    try {
      await client.send("Page.screencastFrameAck", { sessionId: frame.sessionId });
    } catch {
      // session already stopped
    }
  });

  await client.send("Page.startScreencast", {
    format: "jpeg",
    quality: 85,
    maxWidth: WIDTH,
    maxHeight: HEIGHT,
    everyNthFrame: 1,
  });

  const startedAt = Date.now();
  console.log(`Recording ${URL} at ${WIDTH}x${HEIGHT} -> ${OUT_DIR}`);
  console.log("Drive the demo in the opened window. Static screens are captured once and held.");

  if (DURATION) {
    const seconds = Number(DURATION);
    const ticker = setInterval(() => {
      const elapsed = ((Date.now() - startedAt) / 1000).toFixed(0);
      process.stdout.write(`\rrecording… ${elapsed}s, ${frameCount} frames`);
    }, 1000);
    await delay(seconds * 1000);
    clearInterval(ticker);
  } else {
    console.log("Press Enter here when the demo is finished.");
    await new Promise((resolve) => process.stdin.once("data", resolve));
  }

  const elapsedSeconds = Math.max(0.5, (Date.now() - startedAt) / 1000);
  await client.send("Page.stopScreencast").catch(() => {});
  await browser.close();

  console.log(`\nCaptured ${frameCount} frames over ${elapsedSeconds.toFixed(1)}s (${(frameCount / elapsedSeconds).toFixed(1)} fps average).`);

  if (frameCount === 0) {
    console.error("No frames captured; nothing to mux. Is the page rendering?");
    process.exit(1);
  }

  // Variable-duration concat so static screens hold for their real time.
  const concatPath = path.join(framesDir, "frames.txt");
  const lines = [];
  for (let i = 1; i <= frameCount; i += 1) {
    const file = `frame-${String(i).padStart(5, "0")}.jpg`;
    const next = timestamps[i] ?? (timestamps[i - 1] + 1000);
    const prev = timestamps[i - 1] ?? startedAt;
    const duration = Math.min(10, Math.max(0.04, (next - prev) / 1000));
    lines.push(`file '${file}'`, `duration ${duration.toFixed(3)}`);
  }
  lines.push(`file 'frame-${String(frameCount).padStart(5, "0")}.jpg'`);
  fs.writeFileSync(concatPath, lines.join("\n") + "\n", "utf8");

  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const outFile = path.join(OUT_DIR, `demo-${stamp}.mp4`);
  const ffmpeg = ffmpegPath();

  if (!ffmpeg) {
    console.log(`ffmpeg not found. Mux manually:\n  cd "${framesDir}" && ffmpeg -y -f concat -safe 0 -i frames.txt -vsync vfr -c:v libx264 -pix_fmt yuv420p -crf 20 "${outFile}"`);
    return;
  }

  const mux = spawnSync(
    "ffmpeg",
    [
      "-y",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      concatPath,
      "-fps_mode",
      "vfr",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-crf",
      "20",
      "-movflags",
      "+faststart",
      outFile,
    ],
    { encoding: "utf8" }
  );

  if (mux.status !== 0) {
    console.error("ffmpeg mux failed:\n" + (mux.stderr || "").split("\n").slice(-8).join("\n"));
    console.log(`Frames kept at ${framesDir}; mux manually.`);
    return;
  }

  const size = fs.statSync(outFile).size;
  console.log(`\nSaved ${outFile} (${(size / 1024 / 1024).toFixed(1)} MB, ${elapsedSeconds.toFixed(1)}s)`);
  console.log("Add your voiceover in an editor (or record narration separately) and export 1080p.");

  if (!KEEP_FRAMES) {
    fs.rmSync(framesDir, { recursive: true, force: true });
    fs.rmSync(profileDir, { recursive: true, force: true });
    console.log("Temporary frames/profile removed (--keep-frames to retain).");
  }
}

main().catch(async (error) => {
  console.error(error?.stack ?? error);
  process.exit(1);
});