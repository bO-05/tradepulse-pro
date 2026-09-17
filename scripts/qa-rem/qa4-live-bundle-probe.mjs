import fs from "node:fs";

const base = "https://brainy-skunk-440.convex.site";
const html = await (await fetch(base + "/")).text();
const assetMatch = html.match(/\/assets\/[A-Za-z0-9._-]+\.js/);
if (!assetMatch) {
  console.log("NO ASSET MATCH; html head:", html.slice(0, 400));
  process.exit(1);
}
const assetUrl = base + assetMatch[0];
console.log("ASSET:", assetUrl);
const js = await (await fetch(assetUrl)).text();
console.log("BUNDLE_BYTES:", js.length);
fs.writeFileSync("C:/Users/user/AppData/Local/Temp/opencode/qa4-live-bundle.js", js, "utf8");

const needles = [
  "instanceof ConvexError",
  "ConvexError",
  "err?.data",
  "err.data",
  "error.data",
  "Server Error",
  "Error creating package",
  "CSI division must use the format",
  "Called by client",
];
for (const n of needles) {
  const idx = js.indexOf(n);
  console.log(`${n}: ${idx >= 0 ? "FOUND at " + idx : "not found"}`);
}
// Surrounding context for a few
for (const n of ["Error creating package", "instanceof ConvexError"]) {
  const idx = js.indexOf(n);
  if (idx >= 0) console.log(`\nCONTEXT [${n}]:\n`, js.slice(Math.max(0, idx - 300), idx + 300).replace(/\n/g, " "));
}