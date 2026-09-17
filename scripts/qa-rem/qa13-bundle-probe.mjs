// QA-13 live bundle string probe (read-only).
const base = "https://brainy-skunk-440.convex.site";
const html = await (await fetch(base + "/")).text();
const scripts = [...html.matchAll(/src="([^"]+\.js)"/g)].map((m) => m[1]);
console.log("index bytes:", html.length, "scripts:", scripts.join(", "));
const needles = [
  "System Prompt",
  "Raw Model Response",
  "Auto-provisioned when the cycle runs",
  "Go to CSI Scoping",
  "Loading trade packages",
  "Rev ",
  "Certified by ",
  "No package selected",
];
for (const s of scripts) {
  const u = new URL(s, base).href;
  const txt = await (await fetch(u)).text();
  console.log(`\n${u} bytes=${txt.length}`);
  for (const n of needles) console.log(`  ${n.includes(" ") ? `"${n}"` : n}: ${txt.includes(n)}`);
}