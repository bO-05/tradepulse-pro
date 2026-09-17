import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const targets = [];
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (/\.tsx?$/.test(entry.name)) targets.push(full);
  }
};
walk(path.join(root, "src"));

let changed = 0;
for (const file of targets) {
  let source = fs.readFileSync(file, "utf8");
  const original = source;
  source = source.replaceAll("err?.message", "getErrorMessage(err)");
  source = source.replaceAll("error?.message", "getErrorMessage(error)");
  source = source.replaceAll("e?.message", "getErrorMessage(e)");
  if (source !== original) {
    if (!source.includes("lib/errors")) {
      const importLine =
        file.includes(`${path.sep}components${path.sep}`)
          ? 'import { getErrorMessage } from "../lib/errors.ts";'
          : 'import { getErrorMessage } from "./lib/errors.ts";';
      const lines = source.split("\n");
      const firstImport = lines.findIndex((l) => l.startsWith("import "));
      if (firstImport >= 0) lines.splice(firstImport, 0, importLine);
      else lines.unshift(importLine);
      source = lines.join("\n");
    }
    fs.writeFileSync(file, source, "utf8");
    changed += 1;
    console.log("updated:", path.relative(root, file));
  }
}
console.log(`done. files changed: ${changed}`);