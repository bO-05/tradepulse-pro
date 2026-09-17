import { spawnSync } from "node:child_process";

const run = (args) => {
  const res = spawnSync("npx", ["convex", "run", ...args], { encoding: "utf8", shell: true, cwd: "D:/Repo/ALL HACKATHONS/Convex/Convex all gas" });
  return { status: res.status, out: (res.stdout || "").trim().slice(0, 600), err: (res.stderr || "").trim().slice(0, 600) };
};

console.log("=== dev: listCachedInboxes ===");
console.log(JSON.stringify(run(["--component", "agentmail", "lib:listCachedInboxes", "{}"])));
console.log("=== dev: createInbox (probe) ===");
console.log(JSON.stringify(run(["--component", "agentmail", "lib:createInbox", '{"request":{"username":"audit-probe-1"}}'])));
console.log("=== prod: createInbox (probe) ===");
console.log(JSON.stringify(run(["--component", "agentmail", "lib:createInbox", '{"request":{"username":"audit-probe-1"}}', "--prod"])));
console.log("=== firecrawl component sanity (dev) ===");
console.log(JSON.stringify(run(["--component", "firecrawl", "lib:listSearches", "{}"])));