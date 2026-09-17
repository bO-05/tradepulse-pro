import { spawnSync } from "node:child_process";
import path from "node:path";

const cwd = "D:/Repo/ALL HACKATHONS/Convex/Convex all gas";
const main = path.join(cwd, "node_modules/convex/bin/main.js");

const run = (args) => {
  const res = spawnSync(process.execPath, [main, "run", ...args], { encoding: "utf8", cwd, shell: false });
  return { status: res.status, out: (res.stdout || "").trim().slice(0, 900), err: (res.stderr || "").trim().slice(0, 900) };
};

console.log("=== dev: createInbox (probe) ===");
console.log(JSON.stringify(run(["--component", "agentmail", "lib:createInbox", JSON.stringify({ request: { username: `audit-probe-${Date.now().toString().slice(-5)}` } })]), null, 2));
console.log("=== dev: listInboxes via component ===");
console.log(JSON.stringify(run(["--component", "agentmail", "lib:listInboxes", "{}"]), null, 2));