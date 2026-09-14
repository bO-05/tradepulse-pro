import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

function getFiles(dir, exts = [".ts", ".tsx", ".json", ".mjs", ".py", ".md", ".html"]) {
  let results = [];
  const list = fs.readdirSync(dir);
  for (const file of list) {
    if (file === "node_modules" || file === ".git" || file === "dist" || file === ".agents") continue;
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      results = results.concat(getFiles(filePath, exts));
    } else if (exts.includes(path.extname(filePath))) {
      results.push(filePath);
    }
  }
  return results;
}

const files = getFiles(rootDir);
const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const urlRegex = /https?:\/\/[^\s'\"`<>]+/g;

const emailMap = new Map();
const urlMap = new Map();

for (const file of files) {
  const relPath = path.relative(rootDir, file).replace(/\\/g, "/");
  if (relPath === "scripts/scan-urls-emails.mjs") continue;
  const content = fs.readFileSync(file, "utf-8");
  let match;
  while ((match = emailRegex.exec(content)) !== null) {
    const em = match[0];
    if (!emailMap.has(em)) emailMap.set(em, []);
    emailMap.get(em).push(relPath);
  }
  while ((match = urlRegex.exec(content)) !== null) {
    const u = match[0].replace(/[,\);]+$/, "");
    if (!urlMap.has(u)) urlMap.set(u, []);
    urlMap.get(u).push(relPath);
  }
}

console.log(`=== EMAILS FOUND (${emailMap.size}) ===`);
for (const [em, fileList] of Array.from(emailMap.entries()).sort()) {
  const uniqueFiles = Array.from(new Set(fileList));
  console.log(`${em} -> [${uniqueFiles.slice(0, 3).join(", ")}${uniqueFiles.length > 3 ? "..." : ""}]`);
}

console.log(`\n=== URLS FOUND (${urlMap.size}) ===`);
for (const [u, fileList] of Array.from(urlMap.entries()).sort()) {
  const uniqueFiles = Array.from(new Set(fileList));
  console.log(`${u} -> [${uniqueFiles.slice(0, 3).join(", ")}${uniqueFiles.length > 3 ? "..." : ""}]`);
}
